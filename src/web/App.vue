<script setup lang="ts">
import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { apiDisplayBase, apiGet, apiPost } from './api';

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
  reasoning: string;
  output: string;
}

const status = ref('正在连接服务…');
const connected = ref(false);
const detail = ref('');
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
let liveQueue: Promise<void> = Promise.resolve();
let healthTimer: ReturnType<typeof setInterval> | undefined;
let requestTimer: ReturnType<typeof setInterval> | undefined;

async function checkHealth() {
  try {
    const health = await apiGet<{ status: string }>('/api/health');
    if (health.status !== 'ok') throw new Error('Service unavailable');
    connected.value = true;
    status.value = '服务已连接';
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

async function pollRequest() {
  try {
    const result = await apiGet<{ request: PendingRequest | null }>('/operator/request');
    operatorError.value = '';
    const next = result.request;
    if (next?.id !== activeRequest.value?.id) resetEditors();
    activeRequest.value = next;
  } catch (error) {
    operatorError.value = String(error);
  }
}

function queueDelta(requestId: string, channel: OutputChannel, text: string) {
  if (!text) return;
  liveQueue = liveQueue
    .then(async () => {
      await apiPost(`/operator/requests/${encodeURIComponent(requestId)}/delta`, { channel, text });
    })
    .catch((error) => {
      operatorError.value = String(error);
    });
}

async function flushBuffered(channel: OutputChannel) {
  const current = activeRequest.value;
  const textRef = channelText[channel];
  const text = textRef.value;
  if (!current || !text) return;
  await apiPost(`/operator/requests/${encodeURIComponent(current.id)}/delta`, { channel, text });
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
    await apiPost(`/operator/requests/${encodeURIComponent(current.id)}/finish`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  void pollRequest();
  healthTimer = setInterval(() => void checkHealth(), 10000);
  requestTimer = setInterval(() => void pollRequest(), 500);
});
onUnmounted(() => {
  clearInterval(healthTimer);
  clearInterval(requestTimer);
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

    <section class="conversation">
      <template v-if="activeRequest">
        <div class="request-meta">
          <p class="eyebrow">INFERENCE REQUEST</p>
          <span
            >{{ activeRequest.model }} · {{ activeRequest.stream ? 'SSE' : 'BUFFERED HTTP' }}</span
          >
        </div>
        <article v-for="(message, index) in activeRequest.messages" :key="index" class="message">
          <strong>{{ messageRole(message) }}</strong>
          <pre>{{ messageBody(message) }}</pre>
        </article>
        <article v-if="activeRequest.reasoning" class="message output-preview">
          <strong>ASSISTANT · THINKING · COMMITTED</strong>
          <pre>{{ activeRequest.reasoning }}</pre>
        </article>
        <article v-if="activeRequest.output" class="message output-preview">
          <strong>ASSISTANT · FINAL · COMMITTED</strong>
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
  </main>
</template>
