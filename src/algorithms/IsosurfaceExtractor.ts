/**
 * 等值面提取 - Marching Cubes 算法
 *
 * 对 FEBRICK 六面体网格，逐单元应用 Marching Cubes，
 * 提取标量等于阈值的等值面并输出 BufferGeometry。
 *
 * 参考：Paul Bourke - Polygonising a scalar field
 * 查找表：webgpu-marching-cubes (Stanford/Paul Bourke)
 */
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FlowDataset } from "../flow";
import { MC_CASE_TABLE } from "./mc_case_table";

// 六面体 12 条边（顶点对），与 Marching Cubes 标准一致
const HEX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];

/** 在边上线性插值求等值点（直接写入扁平数组） */
function lerpEdgeInto(
  out: number[],
  pos: Float32Array,
  scalar: Float32Array,
  ia: number,
  ib: number,
  iso: number,
): void {
  const na = ia * 3;
  const nb = ib * 3;
  const va = scalar[ia];
  const vb = scalar[ib];
  const t = Math.abs(vb - va) < 1e-10 ? 0.5 : (iso - va) / (vb - va);
  const tt = Math.max(0, Math.min(1, t));
  out.push(
    pos[na] + tt * (pos[nb] - pos[na]),
    pos[na + 1] + tt * (pos[nb + 1] - pos[na + 1]),
    pos[na + 2] + tt * (pos[nb + 2] - pos[na + 2]),
  );
}

/**
 * 对 FEBRICK 网格提取等值面
 * @param dataset 流场数据集
 * @param scalarName 标量变量名（需已归一化到 0~1）
 * @param isoValue 等值面阈值（0~1）
 */
export function extractIsosurface(
  dataset: FlowDataset,
  scalarName: string,
  isoValue: number,
): THREE.BufferGeometry {
  const scalar = dataset.variables[scalarName];
  if (!scalar) throw new Error(`Isosurface: 变量 ${scalarName} 不存在`);

  const { nodes, elements } = dataset;
  const pos = nodes.coords;
  const conn = elements.connectivity;
  const nCell = elements.elementCount;

  const positions: number[] = [];
  const indices: number[] = [];
  // 全局边 -> vertexIndex；同一条网格边 (ia,ib) 上的等值点在不同单元间共享，
  // 由此得到“连续的、可计算光滑法线的”等值面。
  const edgeToVertex = new Map<number, number>();

  // 用 Float64 把 (lo, hi) 两个 32 位节点 ID 拼接为一个唯一 key
  // 注意 JS Number 53 位整数安全，足够 nodeCount < 2^26 ≈ 67M（CFD 场景足够）
  const NODE_BITS = 26;
  const KEY_MULT = 2 ** NODE_BITS;

  for (let c = 0; c < nCell; c++) {
    const base = c * 8;
    let cubeIndex = 0;
    for (let i = 0; i < 8; i++) {
      if (scalar[conn[base + i]] < isoValue) cubeIndex |= 1 << i;
    }

    // 查找表每行 16 个 int：首元素就是第一条边索引，-1 为终止哨兵。
    // cubeIndex=0 的行首即为 -1（无相交）。
    const triBase = cubeIndex * 16;
    if (MC_CASE_TABLE[triBase] === -1) continue;
    // 由于全 0 / 全 1 的 cube 已被早退过滤，这里至少有一个三角形。

    // 每条相交边求一次插值点，并按全局节点 id 去重
    const edgeVertIdx: number[] = new Array(12).fill(-1);
    for (let e = 0; e < 12; e++) {
      const [a, b] = HEX_EDGES[e];
      const ia = conn[base + a];
      const ib = conn[base + b];
      const va = scalar[ia];
      const vb = scalar[ib];
      if ((va < isoValue) === (vb < isoValue)) continue;

      const lo = ia < ib ? ia : ib;
      const hi = ia < ib ? ib : ia;
      const key = lo * KEY_MULT + hi;
      let vid = edgeToVertex.get(key);
      if (vid === undefined) {
        vid = positions.length / 3;
        lerpEdgeInto(positions, pos, scalar, ia, ib, isoValue);
        edgeToVertex.set(key, vid);
      }
      edgeVertIdx[e] = vid;
    }

    // 边索引从 triBase 起按 (e0,e1,e2) 三元组连续排列，遇 -1 终止。
    // 之前误用 triBase + 1 + i，导致每行少读一条三角形 / 绕序错乱，
    // 是等值面 "碎片化、有孔洞" 的根因。
    for (let i = 0; i < 15; i += 3) {
      const e0 = MC_CASE_TABLE[triBase + i];
      const e1 = MC_CASE_TABLE[triBase + i + 1];
      const e2 = MC_CASE_TABLE[triBase + i + 2];
      if (e0 === -1 || e1 === -1 || e2 === -1) break;

      const v0 = edgeVertIdx[e0];
      const v1 = edgeVertIdx[e1];
      const v2 = edgeVertIdx[e2];
      if (v0 < 0 || v1 < 0 || v2 < 0) continue;
      indices.push(v0, v1, v2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);

  // mergeVertices 兜底：在边-key 去重之外再用空间近邻去重，焊接浮点误差导致的微小缝隙
  let merged: THREE.BufferGeometry = geom;
  try {
    merged = mergeVertices(geom, 1e-5);
  } catch {
    merged = geom;
  }

  // 后处理：1 次中点细分 + 3 次拉普拉斯平滑，
  // 把 MC 输出的可见三角面片光顺成 Tecplot 风格的连续曲面
  const refined = subdivideMidpoint(merged);
  laplacianSmooth(refined, 3, 0.5);

  refined.computeVertexNormals();
  refined.computeBoundingBox();
  refined.computeBoundingSphere();
  return refined;
}

// -----------------------------
// 后处理：中点细分（1-to-4） + 拉普拉斯平滑
// -----------------------------

/**
 * 中点细分：每个三角形被拆成 4 个子三角形（在 3 条边的中点处插入新顶点），
 * 同一条边在两个相邻三角形之间共享同一个中点 -> 网格仍然是水密的。
 */
function subdivideMidpoint(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
  const idxAttr = geom.getIndex();
  if (!idxAttr) return geom;

  const oldPos = posAttr.array as Float32Array;
  const oldIdx = idxAttr.array as ArrayLike<number>;

  const newPositions: number[] = Array.from(oldPos);
  const newIndices: number[] = [];
  const edgeMidCache = new Map<number, number>(); // edgeKey -> midVertexIndex

  const KEY_MULT = 2 ** 26;

  function midpoint(a: number, b: number): number {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * KEY_MULT + hi;
    const cached = edgeMidCache.get(key);
    if (cached !== undefined) return cached;
    const mid = newPositions.length / 3;
    newPositions.push(
      (oldPos[a * 3] + oldPos[b * 3]) * 0.5,
      (oldPos[a * 3 + 1] + oldPos[b * 3 + 1]) * 0.5,
      (oldPos[a * 3 + 2] + oldPos[b * 3 + 2]) * 0.5,
    );
    edgeMidCache.set(key, mid);
    return mid;
  }

  for (let i = 0; i < oldIdx.length; i += 3) {
    const a = oldIdx[i], b = oldIdx[i + 1], c = oldIdx[i + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    // 4 个子三角形
    newIndices.push(a, ab, ca);
    newIndices.push(b, bc, ab);
    newIndices.push(c, ca, bc);
    newIndices.push(ab, bc, ca);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
  out.setIndex(newIndices);
  return out;
}

/**
 * 拉普拉斯平滑：每个顶点移向其 1-环邻居的平均位置，
 * 步长 lambda ∈ (0, 1)。多次迭代获得 Tecplot 风格的光顺曲面。
 */
function laplacianSmooth(
  geom: THREE.BufferGeometry,
  iterations: number,
  lambda: number,
): void {
  const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
  const idxAttr = geom.getIndex();
  if (!idxAttr) return;
  const pos = posAttr.array as Float32Array;
  const idx = idxAttr.array as ArrayLike<number>;
  const nVerts = pos.length / 3;

  // 1-环邻接
  const neighbors: Set<number>[] = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) neighbors[i] = new Set();
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }

  const tmp = new Float32Array(pos.length);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < nVerts; v++) {
      const ns = neighbors[v];
      if (ns.size === 0) {
        tmp[v * 3] = pos[v * 3];
        tmp[v * 3 + 1] = pos[v * 3 + 1];
        tmp[v * 3 + 2] = pos[v * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const n of ns) {
        sx += pos[n * 3];
        sy += pos[n * 3 + 1];
        sz += pos[n * 3 + 2];
      }
      const inv = 1 / ns.size;
      const ax = sx * inv, ay = sy * inv, az = sz * inv;
      tmp[v * 3] = pos[v * 3] + lambda * (ax - pos[v * 3]);
      tmp[v * 3 + 1] = pos[v * 3 + 1] + lambda * (ay - pos[v * 3 + 1]);
      tmp[v * 3 + 2] = pos[v * 3 + 2] + lambda * (az - pos[v * 3 + 2]);
    }
    pos.set(tmp);
  }
  posAttr.needsUpdate = true;
}
