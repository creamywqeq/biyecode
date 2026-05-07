<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";
import { turboColor } from "../renderer/FlowRenderer";

/**
 * LegendBar：纯展示型色条（Tecplot 360 EX 风格）
 * - 顶部：变量下拉，默认温度
 * - 中部：11 段离散 Turbo 色带 + 12 个边界数值刻度
 * - 不再嵌入阈值把手；阈值过滤逻辑请见独立的 ThresholdPanel
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("LegendBar: 缺少 FlowAppProvider");

const SEGMENTS = 11;

const variableOptions = computed(() => {
  const stats = app.state.variableStats.value;
  return Object.keys(stats).map((name) => ({ label: name, value: name }));
});

// 色条上下端点 = 当前颜色映射区间（state.scalarThreshold），
// 与 Tecplot 一致：用户在阈值面板调整 max/min，色条数值刻度同步变化。
const minValue = computed(() => app.state.scalarThreshold.value[0] ?? 0);
const maxValue = computed(() => app.state.scalarThreshold.value[1] ?? 1);

const stripes = computed(() => {
  const list: { rgb: string }[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (SEGMENTS - 1 - i) / (SEGMENTS - 1);
    const [r, g, b] = turboColor(t);
    list.push({
      rgb: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
    });
  }
  return list;
});

/** 12 个边界数值（自顶向下 = 自大向小） */
const boundaryValues = computed(() => {
  const lo = minValue.value;
  const hi = maxValue.value;
  const arr: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = (SEGMENTS - i) / SEGMENTS;
    arr.push(lo + t * (hi - lo));
  }
  return arr;
});

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return v.toExponential(3);
  return Number(v.toPrecision(4)).toString();
}

// 切换主变量时：同步渲染器 uDataMin/uDataMax 与阈值范围
watch(
  () => app.state.activeScalar.value,
  (name) => {
    if (!name) return;
    const stat = app.state.variableStats.value[name];
    if (!stat) return;
    app.state.scalarThreshold.value = [stat.min, stat.max];
    const ds = app.state.dataset.value;
    if (ds && ds.variables[name]) {
      app.renderer.setScalarField(ds, name, { dataMin: stat.min, dataMax: stat.max });
    }
  },
);
</script>

<template>
  <div class="legend glass-panel">
    <!-- 顶部：变量选择（默认温度） -->
    <div class="legend-header">
      <span class="legend-title">{{ app.state.activeScalar.value || "变量" }}</span>
      <el-select
        v-model="app.state.activeScalar.value"
        size="small"
        class="legend-select"
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

    <!-- 中部：色带 + 边界数值刻度 -->
    <div class="legend-body">
      <div class="bands">
        <div
          v-for="(seg, i) in stripes"
          :key="i"
          class="band"
          :style="{ background: seg.rgb }"
        />
      </div>
      <div class="value-axis">
        <span
          v-for="(v, i) in boundaryValues"
          :key="i"
          class="value-tick"
        >{{ fmt(v) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend {
  width: 180px;
  padding: 12px 12px;
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.legend-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.legend-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.legend-select {
  width: 100%;
}

.legend-body {
  display: flex;
  align-items: stretch;
  gap: 8px;
  height: 360px;
}

.bands {
  width: 32px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  overflow: hidden;
}
.band {
  flex: 1;
  border-bottom: 1px solid rgba(0, 0, 0, 0.18);
}
.band:last-child {
  border-bottom: none;
}

.value-axis {
  flex: 1;
  position: relative;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.value-tick {
  line-height: 1;
  white-space: nowrap;
}
</style>
