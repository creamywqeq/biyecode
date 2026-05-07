<script setup lang="ts">
import { computed, inject } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

/**
 * 点选打点记录：侧边栏表格
 * - 订阅 bus.on("click")，将每次点击的探针数据追加到 state.probeRecords
 * - 用 el-table 展示，含 XYZ 与 dat 文件中所有变量的插值结果
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("ProbeRecordPanel: 缺少 FlowAppProvider");

const variableNames = computed(() => Object.keys(app.state.variableStats.value));

function clearRecords() {
  app.clearProbeLabels();
  app.state.probeRecords.value = [];
}

function formatNum(v: number | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return v.toExponential(4);
  return v.toPrecision(6);
}
</script>

<template>
  <div class="panel glass-panel">
    <div class="title-row">
      <span class="title">探针查询记录</span>
      <el-button size="small" type="danger" text @click="clearRecords">清空</el-button>
    </div>
    <el-table
      :data="app.state.probeRecords.value"
      max-height="260"
      size="small"
      stripe
      class="record-table"
    >
      <el-table-column prop="id" label="#" width="40" />
      <el-table-column prop="x" label="X" width="86">
        <template #default="{ row }">{{ formatNum(row.x) }}</template>
      </el-table-column>
      <el-table-column prop="y" label="Y" width="86">
        <template #default="{ row }">{{ formatNum(row.y) }}</template>
      </el-table-column>
      <el-table-column prop="z" label="Z" width="86">
        <template #default="{ row }">{{ formatNum(row.z) }}</template>
      </el-table-column>
      <el-table-column
        v-for="name in variableNames"
        :key="name"
        :label="name"
        min-width="110"
      >
        <template #default="{ row }">{{ formatNum(row.values?.[name]) }}</template>
      </el-table-column>
    </el-table>
    <div v-if="!app.state.probeRecords.value.length" class="empty-hint">
      点击流场模型添加查询点
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: 320px;
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
.record-table {
  background: transparent !important;
}
.record-table :deep(.el-table__header-wrapper),
.record-table :deep(.el-table__body-wrapper) {
  background: transparent !important;
}
.record-table :deep(.el-table th.el-table__cell) {
  background: rgba(255, 255, 255, 0.08) !important;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}
.record-table :deep(.el-table td.el-table__cell) {
  color: var(--text-primary);
  font-size: 12px;
}
.record-table :deep(.el-table__row:hover > td) {
  background: rgba(255, 255, 255, 0.06) !important;
}
.record-table :deep(.el-table--striped .el-table__body tr.el-table__row--striped td) {
  background: rgba(255, 255, 255, 0.03) !important;
}
.empty-hint {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
