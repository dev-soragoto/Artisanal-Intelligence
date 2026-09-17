import type { InferenceRequest, RequestEvent, RequestSnapshot } from './request-session.js';
import { RequestSession } from './request-session.js';

export class BusyError extends Error {
  constructor() {
    super('Another inference request is already active');
    this.name = 'BusyError';
  }
}

export class CommandConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandConflictError';
  }
}

export type OperatorCommand =
  | {
      type: 'delta';
      commandId: string;
      requestId: string;
      channel: 'thinking' | 'final';
      text: string;
    }
  | { type: 'finish'; commandId: string; requestId: string }
  | { type: 'cancel'; commandId: string; requestId: string; reason?: string };

export interface CommandAck {
  type: 'ack';
  commandId: string;
  requestId: string;
  eventId: string;
  sequence: number;
  duplicate: boolean;
  request: RequestSnapshot;
}

export interface RequestManagerEvent {
  event: RequestEvent;
  request: RequestSnapshot;
}

interface StoredCommand {
  fingerprint: string;
  ack: CommandAck;
}

export interface RequestManagerOptions {
  requestTimeoutMs?: number;
  commandHistorySize?: number;
}

export class RequestManager {
  private active?: RequestSession;
  private timeout?: NodeJS.Timeout;
  private readonly listeners = new Set<(event: RequestManagerEvent) => void>();
  private readonly commands = new Map<string, StoredCommand>();
  private readonly requestTimeoutMs: number;
  private readonly commandHistorySize: number;

  constructor(options: RequestManagerOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 300_000;
    this.commandHistorySize = options.commandHistorySize ?? 1_024;
  }

  create(request: InferenceRequest) {
    if (this.active) throw new BusyError();
    const session = new RequestSession(request);
    this.active = session;
    session.subscribe((event) => {
      if (
        event.type === 'finish' ||
        event.type === 'cancel' ||
        event.type === 'timeout' ||
        event.type === 'failure'
      ) {
        this.clearTimeout();
      }
      this.emit({ event, request: session.snapshot() });
    });
    session.activate();
    if (this.requestTimeoutMs > 0) {
      this.timeout = setTimeout(() => {
        session.timeout(`Request timed out after ${this.requestTimeoutMs}ms`);
      }, this.requestTimeoutMs);
      this.timeout.unref();
    }
    return session;
  }

  current() {
    return this.active;
  }

  cancel(id: string, reason?: string, source: 'client' | 'operator' | 'system' = 'system') {
    const session = this.active;
    if (!session || session.id !== id) return undefined;
    return { session, event: session.cancel(reason, source) };
  }

  execute(command: OperatorCommand): CommandAck {
    const fingerprint = JSON.stringify(command);
    const stored = this.commands.get(command.commandId);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        throw new CommandConflictError('commandId was already used for a different command');
      }
      return { ...stored.ack, duplicate: true };
    }

    const session = this.requireActive(command.requestId);
    let event: RequestEvent | undefined;
    if (command.type === 'delta') {
      event =
        command.channel === 'thinking'
          ? session.appendReasoning(command.text)
          : session.appendText(command.text);
    } else if (command.type === 'finish') {
      event = session.finish();
    } else {
      event = session.cancel(command.reason ?? 'Request cancelled by operator', 'operator');
    }
    if (!event) throw new Error('Command did not produce an event');

    const ack: CommandAck = {
      type: 'ack',
      commandId: command.commandId,
      requestId: command.requestId,
      eventId: event.eventId,
      sequence: event.sequence,
      duplicate: false,
      request: session.snapshot(),
    };
    this.commands.set(command.commandId, { fingerprint, ack });
    this.trimCommandHistory();
    return ack;
  }

  eventsAfter(requestId: string, sequence: number) {
    const session = this.active;
    if (!session || session.id !== requestId) return [];
    return session.eventsAfter(sequence);
  }

  subscribe(listener: (event: RequestManagerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  release(id: string) {
    if (this.active?.id !== id) return;
    this.clearTimeout();
    this.active = undefined;
  }

  shutdown() {
    const session = this.active;
    if (session) session.cancel('Service is shutting down', 'system');
    this.release(session?.id ?? '');
  }

  private requireActive(id: string) {
    const session = this.active;
    if (!session || session.id !== id) throw new Error('Inference request not found');
    return session;
  }

  private emit(event: RequestManagerEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private clearTimeout() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private trimCommandHistory() {
    while (this.commands.size > this.commandHistorySize) {
      const oldest = this.commands.keys().next().value as string | undefined;
      if (!oldest) return;
      this.commands.delete(oldest);
    }
  }
}
