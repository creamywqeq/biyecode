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

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return v.toExponential(4);
  return v.toPrecision(6);
}

function onHover(payload: {
  world: { x: number; y: number; z: number };
  value: number;
  variable: string;
  values?: Record<string, number>;
  clientX: number;
  clientY: number;
}) {
  visible.value = true;
  x.value = payload.clientX + offset;
  y.value = payload.clientY + offset;
  const lines: string[] = [];
  lines.push(`(X, Y, Z) = (${payload.world.x.toFixed(4)}, ${payload.world.y.toFixed(4)}, ${payload.world.z.toFixed(4)})`);
  if (payload.values && Object.keys(payload.values).length > 0) {
    for (const [name, v] of Object.entries(payload.values)) {
      const star = name === payload.variable ? "▶ " : "  ";
      lines.push(`${star}${name}: ${fmt(v)}`);
    }
  } else {
    lines.push(`${payload.variable}: ${fmt(payload.value)}`);
  }
  text.value = lines.join("\n");
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
