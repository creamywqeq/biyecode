<script setup lang="ts">
import { computed, inject } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * LegendBar：图例 + 双滑块阈值
 * - 图例：蓝->红 渐变条（可替换为与 LUT 一致的 Turbo/Jet）
 * - slider：range [0,1]，拖拽实时更新 FlowRenderer shader uniforms（uMin/uMax）
 */

const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("LegendBar: 缺少 FlowAppProvider");

const range = computed({
  get: () => app.state.scalarThreshold01.value,
  set: (v: [number, number]) => {
    app.state.scalarThreshold01.value = v;
  },
});
</script>

<template>
  <div class="legend glass-panel">
    <div class="row">
      <div class="gradient" />
      <div class="minmax">
        <span>0</span>
        <span>1</span>
      </div>
    </div>

    <el-slider
      v-model="range"
      range
      :min="0"
      :max="1"
      :step="0.001"
      :show-tooltip="true"
    />
  </div>
</template>

<style scoped>
.legend {
  width: 420px;
  padding: 14px 18px;
  color: var(--text-primary);
}

.row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.gradient {
  height: 16px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: linear-gradient(90deg, #3b82f6 0%, #22c55e 40%, #eab308 65%, #ef4444 100%);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.1);
}

.minmax {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
}

.legend :deep(.el-slider__runway) {
  background: var(--glass-bg);
  border-radius: 6px;
}
.legend :deep(.el-slider__bar) {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.6), rgba(239, 68, 68, 0.6));
  border-radius: 6px;
}
.legend :deep(.el-slider__button) {
  border: 2px solid var(--accent);
  background: var(--glass-bg-header);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
}
.legend :deep(.el-slider__button:hover) {
  transform: scale(1.15);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.2);
}
</style>

