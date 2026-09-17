import { randomUUID } from 'node:crypto';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

export type RequestState = 'pending' | 'active' | 'finished' | 'cancelled' | 'timed_out' | 'failed';
export type OutputSource = 'human' | 'upstream';
export type LifecycleSource = OutputSource | 'client' | 'operator' | 'system';

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Correction {
  channel: 'thinking' | 'final';
  deleted: string;
  source: OutputSource;
}

export interface InferenceRequest {
  model: string;
  messages: unknown[];
  tools: FunctionToolDefinition[];
  stream: boolean;
}

interface EventMetadata {
  eventId: string;
  requestId: string;
  sequence: number;
  createdAt: number;
}

type RequestEventPayload =
  | { type: 'request_started'; source: 'client' }
  | { type: 'reasoning_delta'; text: string; source: OutputSource }
  | { type: 'text_delta'; text: string; source: OutputSource }
  | {
      type: 'correction';
      channel: 'thinking' | 'final';
      deleted: string;
      source: OutputSource;
    }
  | { type: 'tool_call'; toolCall: ToolCall; index: number; source: OutputSource }
  | { type: 'finish'; source: OutputSource }
  | { type: 'cancel'; reason: string; source: 'client' | 'operator' | 'system' }
  | { type: 'timeout'; reason: string; source: 'system' }
  | { type: 'failure'; reason: string; source: LifecycleSource };

export type RequestEvent = EventMetadata & RequestEventPayload;

export interface RequestSnapshot extends InferenceRequest {
  id: string;
  createdAt: number;
  state: RequestState;
  source: OutputSource;
  sequence: number;
  reasoning: string;
  output: string;
  corrections: Correction[];
  toolCalls: ToolCall[];
}

export interface CompletedOutput {
  reasoning: string;
  content: string;
  corrections: Correction[];
  toolCalls: ToolCall[];
}

export class ToolCallValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolCallValidationError';
  }
}

export class RequestTerminalError extends Error {
  constructor(
    readonly state: Extract<RequestState, 'cancelled' | 'timed_out' | 'failed'>,
    message: string,
  ) {
    super(message);
    this.name = 'RequestTerminalError';
  }
}

export class RequestSession {
  readonly id = `req_${randomUUID()}`;
  readonly createdAt = Date.now();
  readonly source: OutputSource = 'human';
  private state: RequestState = 'pending';
  private reasoning = '';
  private output = '';
  private readonly corrections: Correction[] = [];
  private readonly toolCalls: ToolCall[] = [];
  private readonly toolValidators = new Map<string, ValidateFunction>();
  private sequence = 0;
  private readonly events: RequestEvent[] = [];
  private readonly listeners = new Set<(event: RequestEvent) => void>();
  private readonly finalPromise: Promise<CompletedOutput>;
  private resolveFinal!: (output: CompletedOutput) => void;
  private rejectFinal!: (error: Error) => void;

  constructor(readonly request: InferenceRequest) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    for (const tool of request.tools) {
      const schema = tool.function.parameters ?? { type: 'object' };
      try {
        this.toolValidators.set(tool.function.name, ajv.compile(schema));
      } catch (error) {
        throw new ToolCallValidationError(
          `Invalid JSON Schema for tool ${tool.function.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.finalPromise = new Promise<CompletedOutput>((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
    // Streaming adapters consume events rather than this promise. Keep cancellation from
    // becoming an unhandled rejection while preserving rejection for awaiting callers.
    void this.finalPromise.catch(() => undefined);
  }

  activate() {
    if (this.state !== 'pending') throw new Error(`Cannot activate request in state ${this.state}`);
    this.state = 'active';
    return this.emit({ type: 'request_started', source: 'client' });
  }

  appendReasoning(text: string, source: OutputSource = 'human') {
    this.requireActive('append output');
    if (!text) return undefined;
    this.reasoning += text;
    return this.emit({ type: 'reasoning_delta', text, source });
  }

  appendText(text: string, source: OutputSource = 'human') {
    this.requireActive('append output');
    if (!text) return undefined;
    this.output += text;
    return this.emit({ type: 'text_delta', text, source });
  }

  correct(channel: 'thinking' | 'final', deleted: string, source: OutputSource = 'human') {
    this.requireActive('correct output');
    if (!deleted) return undefined;
    const correction = { channel, deleted, source } satisfies Correction;
    this.corrections.push(correction);
    return this.emit({ type: 'correction', ...correction });
  }

  appendToolCall(name: string, argumentsValue: unknown, source: OutputSource = 'human') {
    this.requireActive('append tool call');
    const validator = this.toolValidators.get(name);
    if (!validator) throw new ToolCallValidationError(`Unknown tool: ${name}`);
    let parsed = argumentsValue;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        throw new ToolCallValidationError('Tool arguments must be valid JSON');
      }
    }
    if (!validator(parsed)) {
      throw new ToolCallValidationError(formatSchemaErrors(name, validator.errors));
    }
    const toolCall: ToolCall = {
      id: `call_${randomUUID()}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(parsed) },
    };
    const index = this.toolCalls.push(toolCall) - 1;
    return this.emit({ type: 'tool_call', toolCall, index, source });
  }

  finish(source: OutputSource = 'human') {
    this.requireActive('finish request');
    this.state = 'finished';
    const event = this.emit({ type: 'finish', source });
    this.resolveFinal({
      reasoning: this.reasoning,
      content: this.output,
      corrections: [...this.corrections],
      toolCalls: [...this.toolCalls],
    });
    return event;
  }

  cancel(reason = 'Request cancelled', source: 'client' | 'operator' | 'system' = 'system') {
    if (this.isTerminal()) return undefined;
    this.state = 'cancelled';
    const event = this.emit({ type: 'cancel', reason, source });
    this.rejectFinal(new RequestTerminalError('cancelled', reason));
    return event;
  }

  timeout(reason = 'Request timed out') {
    if (this.isTerminal()) return undefined;
    this.state = 'timed_out';
    const event = this.emit({ type: 'timeout', reason, source: 'system' });
    this.rejectFinal(new RequestTerminalError('timed_out', reason));
    return event;
  }

  fail(reason = 'Request failed', source: LifecycleSource = 'system') {
    if (this.isTerminal()) return undefined;
    this.state = 'failed';
    const event = this.emit({ type: 'failure', reason, source });
    this.rejectFinal(new RequestTerminalError('failed', reason));
    return event;
  }

  waitForFinal() {
    return this.finalPromise;
  }

  subscribe(listener: (event: RequestEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  eventsAfter(sequence: number) {
    return this.events.filter((event) => event.sequence > sequence);
  }

  snapshot(): RequestSnapshot {
    return {
      id: this.id,
      createdAt: this.createdAt,
      state: this.state,
      source: this.source,
      sequence: this.sequence,
      reasoning: this.reasoning,
      output: this.output,
      corrections: [...this.corrections],
      toolCalls: [...this.toolCalls],
      ...this.request,
    };
  }

  private requireActive(action: string) {
    if (this.state !== 'active') throw new Error(`Cannot ${action} in state ${this.state}`);
  }

  private isTerminal() {
    return (
      this.state === 'finished' ||
      this.state === 'cancelled' ||
      this.state === 'timed_out' ||
      this.state === 'failed'
    );
  }

  private emit(event: RequestEventPayload): RequestEvent {
    const committed = {
      ...event,
      eventId: `evt_${randomUUID()}`,
      requestId: this.id,
      sequence: ++this.sequence,
      createdAt: Date.now(),
    } as RequestEvent;
    this.events.push(committed);
    for (const listener of this.listeners) listener(committed);
    return committed;
  }
}

function formatSchemaErrors(name: string, errors: ErrorObject[] | null | undefined) {
  const detail = (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
  return `Arguments for tool ${name} do not match its JSON Schema${detail ? `: ${detail}` : ''}`;
}
