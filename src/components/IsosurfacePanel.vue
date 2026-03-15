<script setup lang="ts">
import { inject } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * 等值面控制面板
 * - 输入阈值（0~1），实时提取并显示等值面
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("IsosurfacePanel: 缺少 FlowAppProvider");

function onApply() {
  const ds = app.state.dataset.value;
  const scalar = app.state.activeScalar.value;
  const val = app.state.isosurfaceValue.value;
  if (!ds || !scalar) return;
  app.renderer.setIsosurface(ds, scalar, val);
}
</script>

<template>
  <div class="panel glass-panel">
    <div class="title">等值面 (Marching Cubes)</div>
    <div class="row">
      <span class="label">阈值 (0~1)</span>
      <el-input-number
        v-model="app.state.isosurfaceValue.value"
        :min="0"
        :max="1"
        :step="0.05"
        :precision="3"
        size="default"
        controls-position="right"
        class="iso-input"
      />
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
.iso-input :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 0 0 1px var(--glass-border) inset !important;
}
.iso-input :deep(.el-input__inner) {
  color: #ffffff !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  -webkit-text-fill-color: #ffffff !important;
}
.iso-input :deep(.el-input__inner::placeholder) {
  color: rgba(255, 255, 255, 0.5);
}
.iso-input :deep(.el-input-number__decrease),
.iso-input :deep(.el-input-number__increase) {
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: var(--glass-border) !important;
  color: var(--text-primary) !important;
}
.iso-input :deep(.el-input-number__decrease:hover),
.iso-input :deep(.el-input-number__increase:hover) {
  background: rgba(255, 255, 255, 0.18) !important;
  color: var(--accent) !important;
}
.panel :deep(.el-button--primary) {
  --el-button-bg-color: rgba(59, 130, 246, 0.6);
  --el-button-border-color: rgba(59, 130, 246, 0.5);
}
</style>
