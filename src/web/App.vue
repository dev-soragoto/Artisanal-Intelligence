<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const status = ref('正在连接服务…');
const connected = ref(false);
const detail = ref('');
let healthTimer: ReturnType<typeof setInterval> | undefined;
async function checkHealth() {
  try {
    const health = await invoke<{ status: string; port: number }>('backend_health');
    if (health.status !== 'ok') throw new Error('Service unavailable');
    connected.value = true;
    status.value = '桌面服务已连接';
    detail.value = `本地 API · 127.0.0.1:${health.port}`;
  } catch (error) {
    connected.value = false;
    status.value = '后端未就绪';
    detail.value = `请检查端口占用并重启应用。${String(error)}`;
  }
}
onMounted(() => {
  void checkHealth();
  healthTimer = setInterval(() => void checkHealth(), 10000);
});
onUnmounted(() => clearInterval(healthTimer));
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
      <p class="eyebrow">HUMAN OPERATOR CONSOLE</p>
      <h2>能工智人，桌面就位</h2>
      <p>无需 GPU，大脑自备，馒头另购。</p>
      <p class="muted">当前为工程骨架。推理请求、实时输出与工具调用将在后续阶段接入。</p>
      <p class="muted" role="status">{{ detail }}</p>
    </section>
    <section class="editors" aria-label="输出编辑器预览">
      <label
        >Thinking<textarea disabled placeholder="推理接口接入后，在这里输入思考内容。"></textarea>
      </label>
      <label>Final<textarea disabled placeholder="在这里输入最终回复。"></textarea></label>
    </section>
    <footer><span>等待接入推理请求</span><button disabled>结束响应</button></footer>
  </main>
</template>
