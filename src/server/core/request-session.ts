import { randomUUID } from 'node:crypto';

export type RequestState = 'pending' | 'active' | 'finished' | 'cancelled' | 'failed';
export type OutputSource = 'human' | 'upstream';

export interface InferenceRequest {
  model: string;
  messages: unknown[];
  tools: unknown[];
  stream: boolean;
}

export type OutputEvent =
  | { type: 'reasoning_delta'; text: string; source: OutputSource }
  | { type: 'text_delta'; text: string; source: OutputSource }
  | { type: 'finish'; source: OutputSource };

export interface RequestSnapshot extends InferenceRequest {
  id: string;
  createdAt: number;
  state: RequestState;
  source: OutputSource;
  reasoning: string;
  output: string;
}

export interface CompletedOutput {
  reasoning: string;
  content: string;
}

export class RequestSession {
  readonly id = `req_${randomUUID()}`;
  readonly createdAt = Date.now();
  readonly source: OutputSource = 'human';
  private state: RequestState = 'pending';
  private reasoning = '';
  private output = '';
  private readonly listeners = new Set<(event: OutputEvent) => void>();
  private readonly finalPromise: Promise<CompletedOutput>;
  private resolveFinal!: (output: CompletedOutput) => void;
  private rejectFinal!: (error: Error) => void;

  constructor(readonly request: InferenceRequest) {
    this.finalPromise = new Promise<CompletedOutput>((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
  }

  activate() {
    if (this.state !== 'pending') throw new Error(`Cannot activate request in state ${this.state}`);
    this.state = 'active';
  }

  appendReasoning(text: string, source: OutputSource = 'human') {
    if (this.state !== 'active') throw new Error(`Cannot append output in state ${this.state}`);
    if (!text) return;
    this.reasoning += text;
    this.emit({ type: 'reasoning_delta', text, source });
  }

  appendText(text: string, source: OutputSource = 'human') {
    if (this.state !== 'active') throw new Error(`Cannot append output in state ${this.state}`);
    if (!text) return;
    this.output += text;
    this.emit({ type: 'text_delta', text, source });
  }

  finish(source: OutputSource = 'human') {
    if (this.state !== 'active') throw new Error(`Cannot finish request in state ${this.state}`);
    this.state = 'finished';
    this.emit({ type: 'finish', source });
    this.resolveFinal({ reasoning: this.reasoning, content: this.output });
  }

  submitFinal(text: string) {
    this.appendText(text);
    this.finish();
  }

  cancel(reason = 'Request cancelled') {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed') return;
    this.state = 'cancelled';
    this.rejectFinal(new Error(reason));
  }

  waitForFinal() {
    return this.finalPromise;
  }

  subscribe(listener: (event: OutputEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RequestSnapshot {
    return {
      id: this.id,
      createdAt: this.createdAt,
      state: this.state,
      source: this.source,
      reasoning: this.reasoning,
      output: this.output,
      ...this.request,
    };
  }

  private emit(event: OutputEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
