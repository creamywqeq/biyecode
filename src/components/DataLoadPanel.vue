<script setup lang="ts">
import { inject, ref } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";
import { DataParser, DataNormalizer } from "../flow";
import type { VariableStats } from "../app/flowAppContext";

/**
 * 数据加载面板：选择本地 .dat 文件（封面不再内置示例）
 */
const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("DataLoadPanel: 缺少 FlowAppProvider");

const loading = ref(false);
const error = ref("");

function pickPreferredVariable(variableNames: string[], dataset: any, prefer: string[]): string | undefined {
  const norm = (s: string) =>
    s.replace(/<\s*sup\s*>/gi, "^").replace(/<\s*\/\s*sup\s*>/gi, "").replace(/\s+/g, "").toLowerCase();
  const names = variableNames.filter((v) => !["X", "Y", "Z"].includes(v) && dataset.variables[v]);
  for (const key of prefer) {
    const k = norm(key);
    const hit = names.find((n) => norm(n).includes(k));
    if (hit) return hit;
  }
  return names[0];
}

function computeAllStats(dataset: any, variableNames: string[]): VariableStats {
  const stats: VariableStats = {};
  for (const name of variableNames) {
    if (["X", "Y", "Z"].includes(name)) continue;
    const arr = dataset.variables[name];
    if (!arr) continue;
    try {
      const { min, max } = DataNormalizer.minMax(arr);
      stats[name] = { min, max };
    } catch {
      // ignore variables without finite values
    }
  }
  return stats;
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  loading.value = true;
  error.value = "";
  try {
    let buf: ArrayBuffer | null = await file.arrayBuffer();
    await yieldToUI();
    const { dataset, variableNames } = await DataParser.parse(buf!, { filename: file.name });
    buf = null; // 释放大缓冲区，让 GC 回收
    await yieldToUI();

    // 默认主变量：Temperature 优先；等值面也默认 Temperature
    const tempPriority = ["Temperature", "Temp", "T(K)", "Pressure", "Density", "Ma"];
    const scalarName =
      pickPreferredVariable(variableNames, dataset, tempPriority) ??
      variableNames.find((v) => !["X", "Y", "Z"].includes(v) && dataset.variables[v]);
    if (!scalarName) throw new Error("未找到可用的标量变量");

    // 保留原始物理量，不再归一化，由 GPU shader 内部完成归一化
    const stats = computeAllStats(dataset, variableNames);

    app.state.dataset.value = dataset;
    app.state.activeScalar.value = scalarName;
    app.state.variableStats.value = stats;
    app.state.isoVariable.value = scalarName;
    const sStat = stats[scalarName];
    if (sStat) {
      app.state.scalarThreshold.value = [sStat.min, sStat.max];
      app.state.isosurfaceValue.value = (sStat.min + sStat.max) * 0.5;
    }
    await yieldToUI();

    app.renderer.setWireframe(dataset);
    await yieldToUI();
    app.renderer.setScalarField(dataset, scalarName, {
      dataMin: sStat?.min,
      dataMax: sStat?.max,
    });

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
    app.state.sliceAxis.value = "Z";
    app.state.probeRecords.value = [];
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
    <div class="hint">请选择本地 .dat 流场文件（如 flow00000.dat）</div>
    <el-button type="primary" size="small" :loading="loading">
      <label class="file-label">
        选择数据文件
        <input type="file" accept=".dat,.tec,.plt,.csv,.txt" hidden @change="onFileSelect" />
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
.hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 10px;
  line-height: 1.5;
}
.panel :deep(.el-button) {
  margin-right: 8px;
  margin-bottom: 8px;
  border-radius: 10px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  --el-button-bg-color: var(--glass-bg);
  --el-button-border-color: var(--glass-border);
  --el-button-text-color: var(--text-primary);
  --el-button-hover-bg-color: var(--glass-bg-panel);
  --el-button-hover-border-color: var(--glass-border-strong);
  --el-button-hover-text-color: var(--text-primary);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.panel :deep(.el-button:hover) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.panel :deep(.el-button:active) {
  transform: translateY(0);
}
.panel :deep(.el-button--primary) {
  --el-button-bg-color: var(--accent);
  --el-button-border-color: var(--accent);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: var(--accent-hover);
  --el-button-hover-border-color: var(--accent-hover);
}
.panel :deep(.el-button--primary:hover) {
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
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
