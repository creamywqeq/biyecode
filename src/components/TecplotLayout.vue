<script setup lang="ts">
import { computed, inject } from "vue";
import SceneTree from "./SceneTree.vue";
import LegendBar from "./LegendBar.vue";
import DataLoadPanel from "./DataLoadPanel.vue";
import ProbeTooltip from "./ProbeTooltip.vue";
import ProbeRecordPanel from "./ProbeRecordPanel.vue";
import IsosurfacePanel from "./IsosurfacePanel.vue";
import ThresholdPanel from "./ThresholdPanel.vue";
import SlicePanel from "./SlicePanel.vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * TecplotLayout：类 Tecplot 360 EX 布局
 * - 左侧：SceneTree + DataLoadPanel + IsosurfacePanel + ProbeRecordPanel
 * - 右侧：LegendBar（貌似 Tecplot 右侧色条）
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
      <ThresholdPanel v-if="hasDataset" />
      <SlicePanel v-if="hasDataset" />
      <IsosurfacePanel v-if="hasDataset" />
      <ProbeRecordPanel v-if="hasDataset" />
    </div>

    <!-- 右侧色条（仅在有数据时显示） -->
    <div v-if="hasDataset" class="right">
      <LegendBar />
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
.right,
.bottom,
.header {
  pointer-events: auto;
  z-index: 2;
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
.right {
  position: absolute;
  right: 16px;
  top: 120px;
  bottom: 32px;
  display: flex;
  align-items: center;
}
</style>

