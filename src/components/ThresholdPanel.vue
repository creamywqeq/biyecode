<script setup lang="ts">
import { computed, inject } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * ColorRangePanel：颜色映射区间（Tecplot "Contour values at endpoints"）
 *
 * Tecplot 行为参考：
 * - 用户指定 [min, max]，云图与切片的颜色映射 LUT 被线性拉伸到这个区间
 * - 数值小于 min 的全部使用 LUT 起点颜色（蓝），大于 max 的使用终点颜色（红）
 * - 不丢弃像素（与 value blanking 区别开）
 * - 默认 = 当前主变量的全数据范围；用户可缩小到子区间以放大对比度
 *
 * 写入 state.scalarThreshold -> FlowAppProvider 同步到
 * FlowRenderer.setScalarRange 与 VtkSlicer.setScalarRange，
 * LegendBar 的数值刻度也跟随该区间。
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("ThresholdPanel: 缺少 FlowAppProvider");

const currentStat = computed(() => {
  const name = app.state.activeScalar.value;
  return name ? app.state.variableStats.value[name] : undefined;
});

const dataMin = computed(() => currentStat.value?.min ?? 0);
const dataMax = computed(() => currentStat.value?.max ?? 1);
const span = computed(() => Math.max(1e-12, dataMax.value - dataMin.value));
const sliderStep = computed(() => span.value / 1000);

const vmin = computed({
  get: () => app.state.scalarThreshold.value[0],
  set: (v: number) => {
    const cur = app.state.scalarThreshold.value;
    app.state.scalarThreshold.value = [Math.min(v, cur[1]), cur[1]];
  },
});
const vmax = computed({
  get: () => app.state.scalarThreshold.value[1],
  set: (v: number) => {
    const cur = app.state.scalarThreshold.value;
    app.state.scalarThreshold.value = [cur[0], Math.max(v, cur[0])];
  },
});

const range = computed({
  get: () => app.state.scalarThreshold.value,
  set: (v: [number, number]) => {
    app.state.scalarThreshold.value = v;
  },
});

function resetRange() {
  app.state.scalarThreshold.value = [dataMin.value, dataMax.value];
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return v.toExponential(3);
  return Number(v.toPrecision(5)).toString();
}
</script>

<template>
  <div class="panel glass-panel">
    <div class="title-row">
      <span class="title">颜色映射区间</span>
      <el-button size="small" text @click="resetRange">重置</el-button>
    </div>

    <div class="hint">
      <b>{{ app.state.activeScalar.value || "—" }}</b>
      ∈ [{{ fmt(vmin) }}, {{ fmt(vmax) }}] 内线性映射到色条；
      区间外的数值夹到端点颜色
    </div>

    <div class="row">
      <span class="label">最小</span>
      <el-input-number
        v-model="vmin"
        :min="dataMin"
        :max="vmax"
        :step="sliderStep"
        :precision="4"
        size="small"
        controls-position="right"
        class="num-input"
      />
    </div>
    <div class="row">
      <span class="label">最大</span>
      <el-input-number
        v-model="vmax"
        :min="vmin"
        :max="dataMax"
        :step="sliderStep"
        :precision="4"
        size="small"
        controls-position="right"
        class="num-input"
      />
    </div>

    <div class="row slider-row">
      <el-slider
        v-model="range"
        range
        :min="dataMin"
        :max="dataMax"
        :step="sliderStep"
        :show-tooltip="true"
      />
    </div>

    <div class="bounds">
      <span class="bounds-min">{{ fmt(dataMin) }}</span>
      <span class="bounds-label">数据范围</span>
      <span class="bounds-max">{{ fmt(dataMax) }}</span>
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: 280px;
  margin: 12px;
  padding: 14px 16px;
  color: var(--text-primary);
}
.title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.title {
  font-size: 14px;
  font-weight: 600;
}
.hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.slider-row {
  margin-top: 6px;
  padding: 0 4px;
}
.label {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 36px;
}
.num-input {
  flex: 1;
}
.bounds {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: var(--text-tertiary);
  padding: 4px 4px 0 4px;
}
.bounds-label {
  color: var(--text-secondary);
}
</style>
