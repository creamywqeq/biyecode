<script setup lang="ts">
import { inject, ref } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";
import { DataParser, DataNormalizer } from "../flow";

/**
 * 数据加载面板：加载示例 / 选择本地 .dat 文件
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("DataLoadPanel: 缺少 FlowAppProvider");

const loading = ref(false);
const error = ref("");

async function loadSample(id: 1 | 2 | 3) {
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`/sample${id}.dat`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const { dataset, variableNames } = await DataParser.parse(buf, { filename: `sample${id}.dat` });

    // 选第一个非坐标变量作为云图标量（如 P）
    const scalarName = variableNames.find((v) => !["X", "Y", "Z"].includes(v)) ?? variableNames[3];
    const raw = dataset.variables[scalarName];
    if (!raw) throw new Error(`变量 ${scalarName} 不存在`);

    const { min, max } = DataNormalizer.minMax(raw);
    const norm = DataNormalizer.normalizeTo01(raw, min, max);
    dataset.setVariable(scalarName, norm);

    app.state.dataset.value = dataset;
    app.state.activeScalar.value = scalarName;

    app.renderer.setWireframe(dataset);
    app.renderer.setScalarField(dataset, scalarName);

    const coords = dataset.nodes.coords;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < coords.length; i += 3) {
      cx += coords[i];
      cy += coords[i + 1];
      cz += coords[i + 2];
    }
    const n = dataset.nodes.nodeCount;
    app.state.slicePlane.value = {
      origin: [cx / n, cy / n, cz / n],
      normal: [0, 0, 1],
    };
    app.state.probeRecords.value = [];
    app.state.isosurfaceValue.value = 0.5;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

async function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  loading.value = true;
  error.value = "";
  try {
    const buf = await file.arrayBuffer();
    const { dataset, variableNames } = await DataParser.parse(buf, { filename: file.name });

    const scalarName = variableNames.find((v) => !["X", "Y", "Z"].includes(v)) ?? variableNames[3];
    const raw = dataset.variables[scalarName];
    if (!raw) throw new Error(`变量 ${scalarName} 不存在`);

    const { min, max } = DataNormalizer.minMax(raw);
    const norm = DataNormalizer.normalizeTo01(raw, min, max);
    dataset.setVariable(scalarName, norm);

    app.state.dataset.value = dataset;
    app.state.activeScalar.value = scalarName;

    app.renderer.setWireframe(dataset);
    app.renderer.setScalarField(dataset, scalarName);

    const coords = dataset.nodes.coords;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < coords.length; i += 3) {
      cx += coords[i];
      cy += coords[i + 1];
      cz += coords[i + 2];
    }
    const n = dataset.nodes.nodeCount;
    app.state.slicePlane.value = {
      origin: [cx / n, cy / n, cz / n],
      normal: [0, 0, 1],
    };
    app.state.probeRecords.value = [];
    app.state.isosurfaceValue.value = 0.5;
  } catch (err: any) {
    error.value = err?.message ?? String(err);
  } finally {
    loading.value = false;
    input.value = "";
  }
}
</script>

<template>
  <div class="panel glass-panel">
    <div class="title">数据加载</div>
    <div class="sample-btns">
      <el-button size="small" :loading="loading" @click="loadSample(1)">示例 1</el-button>
      <el-button size="small" :loading="loading" @click="loadSample(2)">示例 2</el-button>
      <el-button size="small" :loading="loading" @click="loadSample(3)">示例 3</el-button>
    </div>
    <el-button type="primary" size="small" :loading="loading">
      <label class="file-label">
        选择 .dat 文件
        <input type="file" accept=".dat,.tec" hidden @change="onFileSelect" />
      </label>
    </el-button>
    <div v-if="error" class="error">{{ error }}</div>
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
.sample-btns {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.panel :deep(.el-button) {
  margin-right: 8px;
  margin-bottom: 8px;
  border-radius: 10px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  --el-button-bg-color: rgba(255, 255, 255, 0.12);
  --el-button-border-color: var(--glass-border);
  --el-button-text-color: var(--text-primary);
}
.panel :deep(.el-button:hover) {
  --el-button-bg-color: rgba(255, 255, 255, 0.2);
  --el-button-border-color: var(--glass-border-strong);
}
.panel :deep(.el-button--primary) {
  --el-button-bg-color: rgba(59, 130, 246, 0.6);
  --el-button-border-color: rgba(59, 130, 246, 0.5);
  --el-button-text-color: #fff;
}
.panel :deep(.el-button--primary:hover) {
  --el-button-bg-color: rgba(59, 130, 246, 0.75);
}
.file-label {
  cursor: pointer;
}
.error {
  margin-top: 8px;
  font-size: 12px;
  color: #f87171;
}
</style>
