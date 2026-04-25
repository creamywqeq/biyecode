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

function pickBestScalar(variableNames: string[]): string {
  const names = variableNames.filter((v) => !["X", "Y", "Z"].includes(v));
  const keywords = ["Pressure", "Temp", "Temperature", "Ma", "Mach", "Density", "P", "U", "V", "W"];
  for (const key of keywords) {
    const hit = names.find((n) => n.toLowerCase().includes(key.toLowerCase()));
    if (hit) return hit;
  }
  return names[0] ?? variableNames[3] ?? variableNames[0] ?? "";
}

function ensureScalar(dataset: any, variableNames: string[], preferred?: string): string {
  const candidates = [preferred, ...variableNames, ...Object.keys(dataset.variables ?? {})].filter(Boolean) as string[];
  for (const name of candidates) {
    if (dataset.variables?.[name]) return name;
  }
  const fallback = Object.values(dataset.variables ?? {}).find((v: any) => v instanceof Float32Array) as Float32Array | undefined;
  if (fallback) {
    const key = preferred && preferred.length > 0 ? preferred : "Density(kg/m<sup>3</sup>)";
    dataset.variables[key] = fallback;
    return key;
  }
  const n = dataset.nodes?.nodeCount ?? 0;
  if (n > 0) {
    const synthetic = new Float32Array(n);
    for (let i = 0; i < n; i++) synthetic[i] = dataset.nodes.coords[i * 3 + 2] ?? 0;
    dataset.variables["Density(kg/m<sup>3</sup>)"] = synthetic;
    return "Density(kg/m<sup>3</sup>)";
  }
  return preferred ?? "";
}

function normalizeVarName(name: string): string {
  return name
    .replace(/<\s*sup\s*>/gi, "^")
    .replace(/<\s*\/\s*sup\s*>/gi, "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, "")
    .replace(/\(kg\/m3\)/i, "(kg/m^3)")
    .replace(/\(kg\/m\^3\)/i, "(kg/m^3)")
    .toLowerCase();
}

function pickDisplayScalar(variableNames: string[], dataset: any): string | undefined {
  const aliases = new Map<string, string>();
  for (const name of variableNames) aliases.set(normalizeVarName(name), name);

  const preferred = [
    "Density(kg/m^3)",
    "Pressure(N/m^2)",
    "Temperature(K)",
    "Ma(1)",
    "MiuL(N*s/m^2)",
  ];
  for (const p of preferred) {
    const hit = aliases.get(normalizeVarName(p));
    if (hit && dataset.variables[hit]) return hit;
  }

  const nonXYZ = variableNames.find((v) => !["X", "Y", "Z"].includes(v) && dataset.variables[v]);
  return nonXYZ ?? variableNames.find((v) => dataset.variables[v]);
}

async function loadSample(id: 1 | 2 | 3) {
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(`/sample${id}.dat`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const { dataset, variableNames } = await DataParser.parse(buf, { filename: `sample${id}.dat` });

    let scalarName = pickDisplayScalar(variableNames, dataset) ?? pickBestScalar(variableNames);
    scalarName = ensureScalar(dataset, variableNames, scalarName);
    let raw = dataset.variables[scalarName] ?? Object.values(dataset.variables)[0];
    if (!raw) {
      scalarName = ensureScalar(dataset, variableNames, scalarName);
      raw = dataset.variables[scalarName] ?? Object.values(dataset.variables)[0];
    }
    if (!raw) throw new Error(`变量 ${scalarName || "<unknown>"} 不存在`);

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

    let scalarName = pickDisplayScalar(variableNames, dataset) ?? pickBestScalar(variableNames);
    scalarName = ensureScalar(dataset, variableNames, scalarName);
    let raw = dataset.variables[scalarName] ?? Object.values(dataset.variables)[0];
    if (!raw) {
      scalarName = ensureScalar(dataset, variableNames, scalarName);
      raw = dataset.variables[scalarName] ?? Object.values(dataset.variables)[0];
    }
    if (!raw) throw new Error(`变量 ${scalarName || "<unknown>"} 不存在`);

    const { min, max } = DataNormalizer.minMax(raw);
    const norm = DataNormalizer.normalizeTo01(raw, min, max);
    dataset.setVariable(scalarName, norm);

    app.state.dataset.value = dataset;
    app.state.activeScalar.value = scalarName;
    await yieldToUI();

    app.renderer.setWireframe(dataset);
    await yieldToUI();
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
