import { InferenceRequest, OutputSource, RequestSession } from './request-session.js';

export class BusyError extends Error {
  constructor() {
    super('Another inference request is already active');
    this.name = 'BusyError';
  }
}

export class RequestManager {
  private active?: RequestSession;

  create(request: InferenceRequest) {
    if (this.active) throw new BusyError();
    const session = new RequestSession(request);
    session.activate();
    this.active = session;
    return session;
  }

  current() {
    return this.active;
  }

  appendReasoning(id: string, text: string, source: OutputSource = 'human') {
    const session = this.requireActive(id);
    session.appendReasoning(text, source);
    return session;
  }

  appendText(id: string, text: string, source: OutputSource = 'human') {
    const session = this.requireActive(id);
    session.appendText(text, source);
    return session;
  }

  finish(id: string, source: OutputSource = 'human') {
    const session = this.requireActive(id);
    session.finish(source);
    return session;
  }

  submitFinal(id: string, text: string) {
    const session = this.requireActive(id);
    session.submitFinal(text);
    return session;
  }

  cancel(id: string, reason?: string) {
    const session = this.active;
    if (!session || session.id !== id) return;
    session.cancel(reason);
    this.active = undefined;
  }

  release(id: string) {
    if (this.active?.id === id) this.active = undefined;
  }

  private requireActive(id: string) {
    const session = this.active;
    if (!session || session.id !== id) throw new Error('Inference request not found');
    return session;
  }
}
