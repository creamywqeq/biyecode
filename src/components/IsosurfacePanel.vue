<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * 等值面控制面板
 * - 从当前数据集读取可选变量（默认 Temperature）
 * - 阈值范围使用该变量的原始 min/max
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("IsosurfacePanel: 缺少 FlowAppProvider");

const variableOptions = computed(() => {
  const stats = app.state.variableStats.value;
  return Object.keys(stats).map((name) => ({ label: name, value: name }));
});

const currentStat = computed(() => {
  const name = app.state.isoVariable.value;
  return name ? app.state.variableStats.value[name] : undefined;
});

const minValue = computed(() => currentStat.value?.min ?? 0);
const maxValue = computed(() => currentStat.value?.max ?? 1);
const step = computed(() => {
  const stat = currentStat.value;
  if (!stat) return 0.01;
  const span = stat.max - stat.min;
  return span > 0 ? span / 200 : 0.01;
});

// 变量切换时自动重置阈值为中间值
watch(
  () => app.state.isoVariable.value,
  (name) => {
    const stat = app.state.variableStats.value[name];
    if (stat) {
      const mid = (stat.min + stat.max) * 0.5;
      app.state.isosurfaceValue.value = mid;
    }
  },
);

function onApply() {
  const ds = app.state.dataset.value;
  const variable = app.state.isoVariable.value;
  const val = app.state.isosurfaceValue.value;
  if (!ds || !variable) return;
  const stat = app.state.variableStats.value[variable];
  console.time("extractIsosurface");
  app.renderer.setIsosurface(ds, variable, val, {
    dataMin: stat?.min,
    dataMax: stat?.max,
  });
  console.timeEnd("extractIsosurface");
}
</script>

<template>
  <div class="panel glass-panel">
    <div class="title">等值面 (Marching Cubes)</div>
    <div class="row">
      <span class="label">变量</span>
      <el-select
        v-model="app.state.isoVariable.value"
        size="small"
        class="iso-select"
        :disabled="variableOptions.length === 0"
      >
        <el-option
          v-for="opt in variableOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
    </div>
    <div class="row">
      <span class="label">阈值</span>
      <el-input-number
        v-model="app.state.isosurfaceValue.value"
        :min="minValue"
        :max="maxValue"
        :step="step"
        :precision="4"
        size="default"
        controls-position="right"
        class="iso-input"
      />
    </div>
    <div class="range-hint">
      范围 [{{ minValue.toPrecision(4) }}, {{ maxValue.toPrecision(4) }}]
    </div>
    <el-button type="primary" size="small" @click="onApply">提取等值面</el-button>
  </div>
</template>

<style scoped>
.panel {
  width: 280px;
  margin: 12px;
  padding: 14px 16px;
  color: var(--text-primary);
}
.title {
  font-weight: 600;
  margin-bottom: 10px;
  font-size: 15px;
  letter-spacing: -0.01em;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.label {
  font-size: 13px;
  min-width: 70px;
  color: var(--text-secondary);
}
.iso-select {
  flex: 1;
}
.range-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  margin-left: 80px;
}
.iso-input :deep(.el-input__wrapper) {
  background: var(--glass-bg) !important;
  box-shadow: 0 0 0 1px var(--glass-border) inset !important;
  transition: background 0.3s ease, box-shadow 0.3s ease;
}
.iso-input :deep(.el-input__inner) {
  color: var(--text-primary) !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  -webkit-text-fill-color: var(--text-primary) !important;
}
.iso-input :deep(.el-input__inner::placeholder) {
  color: var(--text-tertiary);
}
.iso-input :deep(.el-input-number__decrease),
.iso-input :deep(.el-input-number__increase) {
  background: var(--glass-bg) !important;
  border-color: var(--glass-border) !important;
  color: var(--text-primary) !important;
  transition: background 0.2s ease;
}
.iso-input :deep(.el-input-number__decrease:hover),
.iso-input :deep(.el-input-number__increase:hover) {
  background: var(--glass-bg-panel) !important;
  color: var(--accent) !important;
}
.panel :deep(.el-button--primary) {
  --el-button-bg-color: var(--accent);
  --el-button-border-color: var(--accent);
}
</style>
