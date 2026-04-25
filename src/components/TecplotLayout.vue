<script setup lang="ts">
import { computed, inject } from "vue";
import SceneTree from "./SceneTree.vue";
import LegendBar from "./LegendBar.vue";
import SliceGizmo from "./SliceGizmo.vue";
import DataLoadPanel from "./DataLoadPanel.vue";
import ProbeTooltip from "./ProbeTooltip.vue";
import ProbeRecordPanel from "./ProbeRecordPanel.vue";
import IsosurfacePanel from "./IsosurfacePanel.vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * TecplotLayout：类 Tecplot 布局
 * - 左侧：SceneTree + DataLoadPanel
 * - 底部居中：LegendBar
 * - SliceGizmo：仅在有数据时挂载，避免空场景异常
 */
const app = inject(FLOW_APP_KEY);
const hasDataset = computed(() => !!app?.state.dataset.value);
</script>

<template>
  <div class="overlay">
    <header class="header glass-header">
      <h1 class="title">基于 Vue+Three.js 的 Web 端流场后处理系统</h1>
      <span class="subtitle">轻量级 · 跨平台 · 借鉴 Tecplot 核心功能</span>
    </header>

    <div class="left">
      <DataLoadPanel />
      <SceneTree />
      <IsosurfacePanel v-if="hasDataset" />
      <ProbeRecordPanel v-if="hasDataset" />
    </div>

    <div class="bottom">
      <LegendBar />
    </div>

    <!-- 切片 Gizmo + 模式切换 -->
    <SliceGizmo v-if="hasDataset" />
    <div v-if="hasDataset" class="slice-mode glass-panel">
      <button
        :class="{ active: app?.state.sliceGizmoMode.value === 'translate' }"
        @click="app && (app.state.sliceGizmoMode.value = 'translate')"
      >
        平移
      </button>
      <button
        :class="{ active: app?.state.sliceGizmoMode.value === 'rotate' }"
        @click="app && (app.state.sliceGizmoMode.value = 'rotate')"
      >
        旋转
      </button>
    </div>
    <!-- Hover 探针 Tooltip -->
    <ProbeTooltip />
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 中心区域穿透到 3D 画布 */
  z-index: 1;
}

.left,
.bottom,
.header,
.slice-mode {
  pointer-events: auto;
  z-index: 2;
}

.slice-mode {
  position: absolute;
  right: 16px;
  top: 64px;
  display: flex;
  gap: 4px;
  padding: 6px 10px;
}
.slice-mode button {
  padding: 6px 14px;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.25s ease, border-color 0.25s ease, transform 0.2s ease, box-shadow 0.2s ease;
}
.slice-mode button:hover {
  background: var(--glass-bg-panel);
  border-color: var(--glass-border-strong);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.slice-mode button:active {
  transform: translateY(0);
}
.slice-mode button.active {
  background: rgba(59, 130, 246, 0.4);
  border-color: rgba(59, 130, 246, 0.6);
  color: #fff;
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.25);
}

.header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  z-index: 10;
}
.title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.subtitle {
  font-size: 13px;
  color: var(--text-secondary);
}

.left {
  position: absolute;
  left: 0;
  top: 60px;
  bottom: 0;
  min-width: 300px;
}

.bottom {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  min-width: 440px;
}
</style>

