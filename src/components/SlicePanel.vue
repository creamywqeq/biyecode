<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * SlicePanel：仿 Tecplot 360 EX「Slice Details」对话框
 *
 * 对应 Tecplot 字段：
 * - Define slices using: X-Planes / Y-Planes / Z-Planes（轴向单选）
 * - Draw slices at: 1 Specified Value（单一切片位置）
 * - Position: 数值输入 + 滑块
 * - Min / Max: 数据集 bbox 在该轴上的范围（只读）
 *
 * 内部状态写到 state.slicePlane：
 *   normal = 选中轴的单位向量
 *   origin = 模型 bbox 中心，被选中轴坐标替换为 Position
 * 这样 FlowAppProvider 的 watch 会触发 VtkSlicer.slice() 重新计算。
 *
 * 手柄模式（平移 / 旋转）保留作为高级编辑手段。
 */

const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("SlicePanel: 缺少 FlowAppProvider");

// ---- 数据集 bbox（按轴拆三组 min/max） ----
const bounds = computed(() => {
  const ds = app.state.dataset.value;
  if (!ds) return null;
  const c = ds.nodes.coords;
  if (c.length < 3) return null;
  let xmn = Infinity, ymn = Infinity, zmn = Infinity;
  let xmx = -Infinity, ymx = -Infinity, zmx = -Infinity;
  for (let i = 0; i < c.length; i += 3) {
    const x = c[i], y = c[i + 1], z = c[i + 2];
    if (x < xmn) xmn = x; if (x > xmx) xmx = x;
    if (y < ymn) ymn = y; if (y > ymx) ymx = y;
    if (z < zmn) zmn = z; if (z > zmx) zmx = z;
  }
  return { x: [xmn, xmx], y: [ymn, ymx], z: [zmn, zmx], cx: (xmn + xmx) / 2, cy: (ymn + ymx) / 2, cz: (zmn + zmx) / 2 };
});

// ---- 当前轴向 ----
const axis = computed({
  get: () => {
    const a = app.state.sliceAxis.value;
    return a === "custom" ? "Z" : a;
  },
  set: (v: "X" | "Y" | "Z") => setAxis(v),
});

// ---- 当前轴范围 ----
const axisRange = computed<[number, number]>(() => {
  const b = bounds.value;
  if (!b) return [0, 1];
  if (axis.value === "X") return [b.x[0], b.x[1]];
  if (axis.value === "Y") return [b.y[0], b.y[1]];
  return [b.z[0], b.z[1]];
});

const axisMin = computed(() => axisRange.value[0]);
const axisMax = computed(() => axisRange.value[1]);
const sliderStep = computed(() => {
  const span = axisMax.value - axisMin.value;
  return span > 0 ? span / 500 : 0.01;
});

// ---- 当前 Position（沿所选轴的切片位置） ----
const position = computed({
  get: () => {
    const o = app.state.slicePlane.value?.origin ?? [0, 0, 0];
    return axis.value === "X" ? o[0] : axis.value === "Y" ? o[1] : o[2];
  },
  set: (v: number) => setPosition(v),
});

function setAxis(a: "X" | "Y" | "Z") {
  const b = bounds.value;
  const cur = app.state.slicePlane.value;
  const origin: [number, number, number] = cur ? [...cur.origin] : (b ? [b.cx, b.cy, b.cz] : [0, 0, 0]);
  // 切换轴时，把"非新轴坐标"重置到 bbox 中心，避免切片落在数据外侧
  if (b) {
    if (a === "X") { origin[1] = b.cy; origin[2] = b.cz; }
    else if (a === "Y") { origin[0] = b.cx; origin[2] = b.cz; }
    else { origin[0] = b.cx; origin[1] = b.cy; }
  }
  const normal: [number, number, number] = a === "X" ? [1, 0, 0] : a === "Y" ? [0, 1, 0] : [0, 0, 1];
  app.state.slicePlane.value = { origin, normal };
  app.state.sliceAxis.value = a;
}

function setPosition(v: number) {
  const cur = app.state.slicePlane.value;
  if (!cur) return;
  const [mn, mx] = axisRange.value;
  const clamped = Math.min(mx, Math.max(mn, v));
  const origin: [number, number, number] = [...cur.origin];
  if (axis.value === "X") origin[0] = clamped;
  else if (axis.value === "Y") origin[1] = clamped;
  else origin[2] = clamped;
  app.state.slicePlane.value = { origin, normal: cur.normal };
}

function recenter() {
  const b = bounds.value;
  if (!b) return;
  const c = axis.value === "X" ? b.cx : axis.value === "Y" ? b.cy : b.cz;
  setPosition(c);
}

// 数据集就绪后，如尚未设置，初始化为 Z 中位切片
watch(
  bounds,
  (b) => {
    if (!b) return;
    const cur = app.state.slicePlane.value;
    const origin = cur?.origin ?? [0, 0, 0];
    const allZero = origin.every((v) => v === 0);
    if (allZero) {
      app.state.slicePlane.value = { origin: [b.cx, b.cy, b.cz], normal: [0, 0, 1] };
      app.state.sliceAxis.value = "Z";
    }
  },
  { immediate: true },
);

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  return Number(v.toPrecision(5)).toString();
}
</script>

<template>
  <div class="panel glass-panel">
    <div class="title-row">
      <span class="title">切片 (Slice Details)</span>
      <el-button size="small" text @click="recenter">居中</el-button>
    </div>

    <!-- 轴向：X / Y / Z -->
    <div class="row">
      <span class="label">定义轴</span>
      <el-radio-group v-model="axis" size="small" class="axis-group">
        <el-radio-button label="X" value="X" />
        <el-radio-button label="Y" value="Y" />
        <el-radio-button label="Z" value="Z" />
      </el-radio-group>
    </div>

    <!-- Position 数值 -->
    <div class="row">
      <span class="label">Position</span>
      <el-input-number
        v-model="position"
        :min="axisMin"
        :max="axisMax"
        :step="sliderStep"
        :precision="4"
        size="small"
        controls-position="right"
        class="num-input"
      />
    </div>

    <!-- Position 滑块 -->
    <el-slider
      v-model="position"
      :min="axisMin"
      :max="axisMax"
      :step="sliderStep"
      :show-tooltip="true"
      class="pos-slider"
    />

    <!-- Min / Max 只读显示（同 Tecplot 的 Min/Max 行） -->
    <div class="meta-row">
      <span>Min: <b>{{ fmt(axisMin) }}</b></span>
      <span>Max: <b>{{ fmt(axisMax) }}</b></span>
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
  margin-bottom: 10px;
}
.title {
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.label {
  font-size: 13px;
  min-width: 70px;
  color: var(--text-secondary);
}
.axis-group :deep(.el-radio-button__inner) {
  padding: 5px 14px;
}
.num-input {
  flex: 1;
}
.pos-slider {
  margin: 4px 8px 6px 8px;
}
.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 6px 0 10px 0;
  padding: 0 4px;
}
.meta-row b {
  color: var(--text-secondary);
  font-weight: 500;
}
.gizmo-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--glass-border);
  margin-bottom: 0;
}
.num-input :deep(.el-input__wrapper) {
  background: var(--glass-bg) !important;
  box-shadow: 0 0 0 1px var(--glass-border) inset !important;
}
.num-input :deep(.el-input__inner) {
  color: var(--text-primary) !important;
  -webkit-text-fill-color: var(--text-primary) !important;
}
.num-input :deep(.el-input-number__decrease),
.num-input :deep(.el-input-number__increase) {
  background: var(--glass-bg) !important;
  border-color: var(--glass-border) !important;
  color: var(--text-primary) !important;
}
</style>
