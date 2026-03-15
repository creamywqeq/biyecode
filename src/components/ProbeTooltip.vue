<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * Hover Probe Tooltip：监听 EventBus hover/miss，在鼠标旁显示坐标与插值结果
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("ProbeTooltip: 缺少 FlowAppProvider");

const visible = ref(false);
const x = ref(0);
const y = ref(0);
const text = ref("");

const offset = 14;

function onHover(payload: {
  world: { x: number; y: number; z: number };
  value: number;
  variable: string;
  clientX: number;
  clientY: number;
}) {
  visible.value = true;
  x.value = payload.clientX + offset;
  y.value = payload.clientY + offset;
  text.value = `${payload.variable}: ${payload.value.toExponential(4)}\n(${payload.world.x.toFixed(3)}, ${payload.world.y.toFixed(3)}, ${payload.world.z.toFixed(3)})`;
}

function onMiss() {
  visible.value = false;
}

onMounted(() => {
  app.bus.on("hover", onHover);
  app.bus.on("miss", onMiss);
});

onBeforeUnmount(() => {
  app.bus.off("hover", onHover);
  app.bus.off("miss", onMiss);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="probe-tooltip glass-panel"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <pre>{{ text }}</pre>
    </div>
  </Teleport>
</template>

<style scoped>
.probe-tooltip {
  position: fixed;
  z-index: 10000;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  color: var(--text-primary);
  min-width: 180px;
}
.probe-tooltip pre {
  margin: 0;
  font-family: ui-monospace, monospace;
}
</style>
