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
import type { FlowDataset } from "../flow";
import { MC_CASE_TABLE } from "./mc_case_table";

// 六面体 12 条边（顶点对），与 Marching Cubes 标准一致
const HEX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];

/** 在边上线性插值求等值点 */
function lerpEdge(
  pos: Float32Array,
  scalar: Float32Array,
  conn: Uint32Array,
  base: number,
  edgeIdx: number,
  iso: number,
): THREE.Vector3 {
  const [a, b] = HEX_EDGES[edgeIdx];
  const na = conn[base + a] * 3;
  const nb = conn[base + b] * 3;
  const va = scalar[conn[base + a]];
  const vb = scalar[conn[base + b]];
  const t = Math.abs(vb - va) < 1e-10 ? 0.5 : (iso - va) / (vb - va);
  const tClamp = Math.max(0, Math.min(1, t));
  return new THREE.Vector3(
    pos[na] + tClamp * (pos[nb] - pos[na]),
    pos[na + 1] + tClamp * (pos[nb + 1] - pos[na + 1]),
    pos[na + 2] + tClamp * (pos[nb + 2] - pos[na + 2]),
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
  const normals: number[] = [];

  for (let c = 0; c < nCell; c++) {
    const base = c * 8;
    // 标准 MC：value < iso 为 inside（bit=1）
    let cubeIndex = 0;
    for (let i = 0; i < 8; i++) {
      if (scalar[conn[base + i]] < isoValue) cubeIndex |= 1 << i;
    }

    const triBase = cubeIndex * 16;
    if (MC_CASE_TABLE[triBase] === -1) continue;

    const edgeVerts: (THREE.Vector3 | undefined)[] = [];
    for (let e = 0; e < 12; e++) {
      const [a, b] = HEX_EDGES[e];
      const va = scalar[conn[base + a]];
      const vb = scalar[conn[base + b]];
      if ((va < isoValue) !== (vb < isoValue)) {
        edgeVerts[e] = lerpEdge(pos, scalar, conn, base, e, isoValue);
      }
    }

    for (let i = 0; i < 15; i += 3) {
      const e0 = MC_CASE_TABLE[triBase + 1 + i];
      const e1 = MC_CASE_TABLE[triBase + 2 + i];
      const e2 = MC_CASE_TABLE[triBase + 3 + i];
      if (e0 === -1 || e1 === -1 || e2 === -1) break;

      const p0 = edgeVerts[e0];
      const p1 = edgeVerts[e1];
      const p2 = edgeVerts[e2];
      if (!p0 || !p1 || !p2) continue;

      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      const n = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z),
          new THREE.Vector3(p2.x - p0.x, p2.y - p0.y, p2.z - p0.z),
        )
        .normalize();
      normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geom;
}
