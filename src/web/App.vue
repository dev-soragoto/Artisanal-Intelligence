<script setup lang="ts">
import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { apiDisplayBase, apiGet, apiPost, operatorWebSocketUrl } from './api';

type OutputChannel = 'thinking' | 'final';

interface PendingRequest {
  id: string;
  model: string;
  messages: unknown[];
  tools: unknown[];
  stream: boolean;
  createdAt: number;
  state: string;
  source: 'human' | 'upstream';
  sequence: number;
  reasoning: string;
  output: string;
}

interface PendingCommand {
  frame: Record<string, unknown>;
  resolve: () => void;
  reject: (error: Error) => void;
}

const status = ref('正在连接服务…');
const connected = ref(false);
const detail = ref('');
const authenticated = ref(false);
const authRequired = ref(false);
const password = ref('');
const activeRequest = ref<PendingRequest | null>(null);
const thinkingText = ref('');
const finalText = ref('');
const live = ref(false);
const composing = ref<Record<OutputChannel, boolean>>({ thinking: false, final: false });
const submitting = ref(false);
const operatorError = ref('');
const channelText: Record<OutputChannel, Ref<string>> = {
  thinking: thinkingText,
  final: finalText,
};
const liveShadow: Record<OutputChannel, string> = { thinking: '', final: '' };
const pendingCommands = new Map<string, PendingCommand>();
let liveQueue: Promise<void> = Promise.resolve();
let socket: WebSocket | undefined;
let healthTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPendingRequest(value: unknown): value is PendingRequest {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sequence === 'number' &&
    Array.isArray(value.messages) &&
    Array.isArray(value.tools)
  );
}

async function checkHealth() {
  try {
    const health = await apiGet<{ status: string }>('/api/health');
    if (health.status !== 'ok') throw new Error('Service unavailable');
    detail.value = `API · ${apiDisplayBase()}`;
  } catch (error) {
    connected.value = false;
    status.value = '服务未就绪';
    detail.value = `请检查服务地址并重试。${String(error)}`;
  }
}

function resetEditors() {
  thinkingText.value = '';
  finalText.value = '';
  liveShadow.thinking = '';
  liveShadow.final = '';
  composing.value.thinking = false;
  composing.value.final = false;
  live.value = false;
}

function applyRequest(value: unknown) {
  const next = isPendingRequest(value) ? value : null;
  if (next?.id !== activeRequest.value?.id) resetEditors();
  activeRequest.value = next && next.state === 'active' ? next : null;
}

function transmit(frame: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

function handleSocketMessage(event: MessageEvent<string>) {
  let message: unknown;
  try {
    message = JSON.parse(event.data);
  } catch {
    operatorError.value = '服务返回了无效的 WebSocket 消息。';
    return;
  }
  if (!isRecord(message)) return;
  if (message.type === 'hello') {
    const previous = activeRequest.value;
    applyRequest(message.request);
    if (previous && activeRequest.value?.id === previous.id) {
      transmit({ type: 'resume', requestId: previous.id, afterSequence: previous.sequence });
    }
    for (const pending of pendingCommands.values()) transmit(pending.frame);
    return;
  }
  if (message.type === 'event' || message.type === 'replay') {
    applyRequest(message.request);
    return;
  }
  if (message.type === 'ack' && typeof message.commandId === 'string') {
    applyRequest(message.request);
    const pending = pendingCommands.get(message.commandId);
    if (pending) {
      pendingCommands.delete(message.commandId);
      pending.resolve();
    }
    return;
  }
  if (message.type === 'error') {
    const error = new Error(
      typeof message.error === 'string' ? message.error : 'Operator command failed',
    );
    operatorError.value = error.message;
    if (typeof message.commandId === 'string') {
      const pending = pendingCommands.get(message.commandId);
      if (pending) {
        pendingCommands.delete(message.commandId);
        pending.reject(error);
      }
    }
  }
}

function connectOperator() {
  if (stopped || !authenticated.value) return;
  clearTimeout(reconnectTimer);
  socket?.close();
  socket = new WebSocket(operatorWebSocketUrl());
  socket.addEventListener('open', () => {
    connected.value = true;
    status.value = '服务已连接';
    operatorError.value = '';
  });
  socket.addEventListener('message', handleSocketMessage);
  socket.addEventListener('close', () => {
    connected.value = false;
    status.value = '控制连接已断开，正在重连…';
    if (!stopped && authenticated.value) reconnectTimer = setTimeout(connectOperator, 1_000);
  });
  socket.addEventListener('error', () => {
    operatorError.value = 'Operator WebSocket 连接失败。';
  });
}

async function loadSession() {
  try {
    const session = await apiGet<{ authenticated: boolean; authRequired: boolean }>(
      '/operator/session',
    );
    authenticated.value = session.authenticated;
    authRequired.value = session.authRequired;
    if (session.authenticated) connectOperator();
    else status.value = '需要 Operator 登录';
  } catch (error) {
    operatorError.value = String(error);
  }
}

async function login() {
  if (!password.value || submitting.value) return;
  submitting.value = true;
  operatorError.value = '';
  try {
    await apiPost('/operator/login', { password: password.value });
    password.value = '';
    authenticated.value = true;
    connectOperator();
  } catch (error) {
    operatorError.value = String(error);
  } finally {
    submitting.value = false;
  }
}

function sendCommand(frame: Record<string, unknown>) {
  const commandId = crypto.randomUUID();
  const command = { ...frame, commandId };
  return new Promise<void>((resolve, reject) => {
    pendingCommands.set(commandId, { frame: command, resolve, reject });
    transmit(command);
  });
}

function queueDelta(requestId: string, channel: OutputChannel, text: string) {
  if (!text) return;
  liveQueue = liveQueue
    .then(() => sendCommand({ type: 'delta', requestId, channel, text }))
    .catch((error) => {
      operatorError.value = String(error);
    });
}

async function flushBuffered(channel: OutputChannel) {
  const current = activeRequest.value;
  const textRef = channelText[channel];
  const text = textRef.value;
  if (!current || !text) return;
  await sendCommand({ type: 'delta', requestId: current.id, channel, text });
  textRef.value = '';
}

async function sendBuffered(channel: OutputChannel) {
  if (!activeRequest.value || live.value || submitting.value || !channelText[channel].value) return;
  submitting.value = true;
  operatorError.value = '';
  try {
    await flushBuffered(channel);
  } catch (error) {
    operatorError.value = String(error);
  } finally {
    submitting.value = false;
  }
}

async function finishResponse() {
  const current = activeRequest.value;
  if (!current || submitting.value) return;
  submitting.value = true;
  operatorError.value = '';
  try {
    if (!live.value) {
      await flushBuffered('thinking');
      await flushBuffered('final');
    }
    await liveQueue;
    await sendCommand({ type: 'finish', requestId: current.id });
    if (activeRequest.value?.id === current.id) activeRequest.value = null;
    resetEditors();
  } catch (error) {
    operatorError.value = String(error);
  } finally {
    submitting.value = false;
  }
}

function toggleLive() {
  if (!activeRequest.value) return;
  operatorError.value = '';
  if (!live.value) {
    if (thinkingText.value || finalText.value) {
      operatorError.value = '请先发送或清空 Thinking / Final 的 Buffered 草稿，再进入 Live。';
      return;
    }
    liveShadow.thinking = '';
    liveShadow.final = '';
    live.value = true;
    return;
  }
  resetEditors();
}

function flushLiveInput(channel: OutputChannel) {
  const current = activeRequest.value;
  if (!current || !live.value || composing.value[channel]) return;
  const textRef = channelText[channel];
  const value = textRef.value;
  const shadow = liveShadow[channel];
  if (!value.startsWith(shadow)) {
    textRef.value = shadow;
    operatorError.value = `当前 Live ${channel} 是 append-only；删除纠正会在下一阶段接入。`;
    return;
  }
  const delta = value.slice(shadow.length);
  if (!delta) return;
  liveShadow[channel] = value;
  queueDelta(current.id, channel, delta);
}

function onCompositionEnd(channel: OutputChannel) {
  composing.value[channel] = false;
  flushLiveInput(channel);
}

function messageRole(message: unknown) {
  if (isRecord(message) && typeof message.role === 'string') return message.role.toUpperCase();
  return 'MESSAGE';
}

function messageBody(message: unknown) {
  if (isRecord(message) && typeof message.content === 'string') return message.content;
  return JSON.stringify(message, null, 2) ?? String(message);
}

onMounted(() => {
  void checkHealth();
  void loadSession();
  healthTimer = setInterval(() => void checkHealth(), 10_000);
});
onUnmounted(() => {
  stopped = true;
  clearInterval(healthTimer);
  clearTimeout(reconnectTimer);
  socket?.close();
  for (const pending of pendingCommands.values())
    pending.reject(new Error('Operator console closed'));
  pendingCommands.clear();
});
</script>

<template>
  <main>
    <header>
      <div>
        <p class="eyebrow">100% HANDCRAFTED INFERENCE</p>
        <h1>Artisanal Intelligence</h1>
      </div>
      <span class="status" :class="{ connected }" role="status">{{ status }}</span>
    </header>

    <section v-if="authRequired && !authenticated" class="conversation">
      <p class="eyebrow">OPERATOR LOGIN</p>
      <h2>登录人类推理终端</h2>
      <form class="login" @submit.prevent="login">
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="Operator password"
        />
        <button :disabled="submitting || !password" type="submit">登录</button>
      </form>
      <p v-if="operatorError" class="error" role="alert">{{ operatorError }}</p>
    </section>

    <template v-else>
      <section class="conversation">
        <template v-if="activeRequest">
          <div class="request-meta">
            <p class="eyebrow">INFERENCE REQUEST</p>
            <span
              >{{ activeRequest.model }} ·
              {{ activeRequest.stream ? 'SSE' : 'BUFFERED HTTP' }}</span
            >
          </div>
          <article v-for="(message, index) in activeRequest.messages" :key="index" class="message">
            <strong>{{ messageRole(message) }}</strong>
            <pre>{{ messageBody(message) }}</pre>
          </article>
          <article v-if="activeRequest.reasoning" class="message output-preview">
            <strong>ASSISTANT · THINKING · CONFIRMED</strong>
            <pre>{{ activeRequest.reasoning }}</pre>
          </article>
          <article v-if="activeRequest.output" class="message output-preview">
            <strong>ASSISTANT · FINAL · CONFIRMED</strong>
            <pre>{{ activeRequest.output }}</pre>
          </article>
          <p v-if="activeRequest.tools.length" class="muted">
            此请求提供 {{ activeRequest.tools.length }} 个工具；图形化 Tool Call 将在后续阶段接入。
          </p>
        </template>
        <template v-else>
          <p class="eyebrow">HUMAN OPERATOR CONSOLE</p>
          <h2>等待推理请求</h2>
          <p>把 OpenAI-compatible 客户端指向本服务，然后让它来问人。</p>
          <p class="muted">{{ detail }}</p>
        </template>
        <p v-if="operatorError" class="error" role="alert">{{ operatorError }}</p>
      </section>

      <section class="mode-bar">
        <button :disabled="!activeRequest" :class="{ live }" @click="toggleLive">
          Live {{ live ? 'ON' : 'OFF' }}
        </button>
        <span class="muted">
          {{
            live
              ? 'Thinking / Final 输入即提交；当前暂不允许修改已发送字符。'
              : 'Buffered：Thinking / Final 分别编辑、分别发送。'
          }}
        </span>
      </section>

      <section class="editors" aria-label="输出编辑器">
        <div class="editor">
          <div class="editor-header">
            <label for="thinking-output">Thinking</label>
            <button
              :disabled="!activeRequest || live || submitting || !thinkingText"
              @click="sendBuffered('thinking')"
            >
              发送 Thinking
            </button>
          </div>
          <textarea
            id="thinking-output"
            v-model="thinkingText"
            :disabled="!activeRequest || submitting"
            :placeholder="
              live
                ? 'Live Thinking：完成输入后立即发送 reasoning delta。'
                : 'Buffered Thinking：可以多次发送，不会结束响应。'
            "
            @input="flushLiveInput('thinking')"
            @compositionstart="composing.thinking = true"
            @compositionend="onCompositionEnd('thinking')"
          ></textarea>
        </div>

        <div class="editor">
          <div class="editor-header">
            <label for="final-output">Final</label>
            <button
              :disabled="!activeRequest || live || submitting || !finalText"
              @click="sendBuffered('final')"
            >
              发送 Final
            </button>
          </div>
          <textarea
            id="final-output"
            v-model="finalText"
            :disabled="!activeRequest || submitting"
            :placeholder="
              live
                ? 'Live Final：完成输入后立即发送 content delta。'
                : 'Buffered Final：可以多次发送，不会结束响应。'
            "
            @input="flushLiveInput('final')"
            @compositionstart="composing.final = true"
            @compositionend="onCompositionEnd('final')"
          ></textarea>
        </div>
      </section>

      <footer>
        <span>{{ activeRequest ? 'Human Operator 已接管当前请求' : '等待接入推理请求' }}</span>
        <div class="actions">
          <button :disabled="!activeRequest || submitting" @click="finishResponse">结束响应</button>
        </div>
      </footer>
    </template>
  </main>
</template>
