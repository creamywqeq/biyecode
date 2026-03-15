<script setup lang="ts">
import { computed, inject } from "vue";
import type { TreeNodeData } from "element-plus";
import { FLOW_APP_KEY, type LayerId } from "../app/flowAppContext";

/**
 * SceneTree：类 Tecplot 左侧场景树
 * - 用 el-tree + checkbox 控制图层显隐
 * - 通过状态 state.layerVisible 驱动 FlowRenderer.setLayerVisible
 */

const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("SceneTree: 缺少 FlowAppProvider");

type Node = {
  id: string;
  label: string;
  layer?: LayerId;
  children?: Node[];
};

const treeData: Node[] = [
  {
    id: "root",
    label: "场景",
    children: [
      { id: "wireframe", label: "网格层", layer: "wireframe" },
      { id: "scalar", label: "云图层", layer: "scalar" },
      { id: "slice", label: "VTK 切片层", layer: "slice" },
      { id: "isosurface", label: "等值面层", layer: "isosurface" },
    ],
  },
];

const defaultChecked = computed(() => {
  const v = app.state.layerVisible.value;
  const ids: string[] = [];
  if (v.wireframe) ids.push("wireframe");
  if (v.scalar) ids.push("scalar");
  if (v.slice) ids.push("slice");
  if (v.isosurface) ids.push("isosurface");
  return ids;
});

// Element Plus Tree 勾选回调：把勾选状态写回 state.layerVisible
function onCheck(_: TreeNodeData, ctx: { checkedKeys: string[] }) {
  const keys = new Set(ctx.checkedKeys);
  app.state.layerVisible.value = {
    wireframe: keys.has("wireframe"),
    scalar: keys.has("scalar"),
    slice: keys.has("slice"),
    isosurface: keys.has("isosurface"),
  };
}
</script>

<template>
  <div class="panel glass-panel">
    <div class="title">场景树</div>
    <el-tree
      :data="treeData"
      node-key="id"
      show-checkbox
      default-expand-all
      :default-checked-keys="defaultChecked"
      @check="onCheck"
    />
  </div>
</template>

<style scoped>
.panel {
  width: 280px;
  max-height: calc(100vh - 180px);
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
.panel :deep(.el-tree) {
  background: transparent;
  color: inherit;
}
.panel :deep(.el-tree-node__content:hover) {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}
.panel :deep(.el-checkbox__inner) {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--glass-border-strong);
}
.panel :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background: var(--accent);
  border-color: var(--accent);
}
</style>

