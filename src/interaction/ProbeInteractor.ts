import * as THREE from "three";
import type { FlowDataset } from "../flow";
import type { EventBus } from "../core/EventBus";

// three-mesh-bvh：用于加速 Raycasting（要求项目安装该依赖）
import { MeshBVH, acceleratedRaycast, SAH } from "three-mesh-bvh";

// 可选：点击生成 2D 标签（CSS2DObject）
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/**
 * Probe 事件定义
 * - hover：鼠标悬停实时更新（tooltip）
 * - click：点击生成固定查询点/标签
 */
export type ProbeEvents = {
  hover: {
    world: { x: number; y: number; z: number };
    cellId: number;
    value: number;
    variable: string;
    clientX: number;
    clientY: number;
  };
  click: {
    world: { x: number; y: number; z: number };
    cellId: number;
    value: number;
    variable: string;
    labelObject: CSS2DObject;
  };
  miss: {
    kind: "hover" | "click";
  };
};

/**
 * Phase 3 - 任意点探针（Raycaster + BVH + 形函数插值）
 *
 * 关键点：
 * - Raycaster 定位“击中的三角形”（faceIndex）
 * - faceIndex -> cellId：通过 triToCell 映射数组实现
 * - cellId -> 节点索引（从 FlowDataset.ElementSet 读取）
 * - 形函数插值：
 *   - Hexahedron：三线性等参单元（Trilinear），用 Newton 迭代求自然坐标（ξ,η,ζ）
 *   - Tetrahedron：线性（barycentric）
 */
export class ProbeInteractor {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmpWorld = new THREE.Vector3();
  private readonly tmpLocal = new THREE.Vector3();

  private highlight?: THREE.LineSegments;
  private labels = new THREE.Group();

  private enabled = true;
  private disposed = false;

  // BVH + 映射：triIndex -> cellId
  private triToCell?: Uint32Array;
  private pickMesh?: THREE.Mesh;

  constructor(
    private readonly domElement: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    private readonly dataset: FlowDataset,
    private readonly variableName: string,
    private readonly eventBus: EventBus<ProbeEvents>,
    options?: {
      /** 高亮颜色 */
      highlightColor?: THREE.ColorRepresentation;
      /** 高亮透明度 */
      highlightOpacity?: number;
      /** raycaster 阈值（点/线时有用，网格可不管） */
      threshold?: number;
    },
  ) {
    this.scene.add(this.labels);

    // BVH raycast 加速：给 Mesh 增强 raycast 函数
    (THREE.Mesh as any).prototype.raycast = acceleratedRaycast;
    this.raycaster.params.Line!.threshold = options?.threshold ?? 0.0;

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onClick = this.onClick.bind(this);
    domElement.addEventListener("pointermove", this.onPointerMove);
    domElement.addEventListener("click", this.onClick);

    // 默认高亮对象
    const material = new THREE.LineBasicMaterial({
      color: options?.highlightColor ?? 0xffcc00,
      transparent: true,
      opacity: options?.highlightOpacity ?? 0.9,
      depthTest: false,
    });
    const geom = new THREE.BufferGeometry();
    this.highlight = new THREE.LineSegments(geom, material);
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  /** 启用/禁用探针 */
  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.clearHoverState();
  }

  /** 设置用于插值的变量名（必须是节点标量且已归一化到 0~1 或原始值都可） */
  setVariable(name: string): void {
    (this as any).variableName = name;
  }

  /**
   * 设置用于拾取的 Mesh。
   *
   * 强烈建议使用“面片三角化几何”作为 pickMesh（例如 Phase2 的 scalarMesh），
   * 并同时提供 triToCell（每个三角形对应哪个单元）。
   */
  setPickMesh(pickMesh: THREE.Mesh, triToCell: Uint32Array): void {
    this.pickMesh = pickMesh;
    this.triToCell = triToCell;

    // 构建 BVH（一次性成本，后续 hover/click 将非常快）
    const geom = pickMesh.geometry as THREE.BufferGeometry;
    (geom as any).boundsTree = new MeshBVH(geom, { strategy: SAH });
  }

  /** 清空所有点击生成的 3D 标签（侧边栏清空时调用） */
  clearLabels(): void {
    this.labels.clear();
  }

  /** 释放事件与对象 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.removeEventListener("click", this.onClick);
    if (this.highlight) {
      this.scene.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = undefined;
    }
    this.scene.remove(this.labels);
    this.labels.clear();
  }

  // -----------------------------
  // 鼠标交互：hover / click
  // -----------------------------

  private onPointerMove(e: PointerEvent): void {
    if (!this.enabled || this.disposed) return;
    const hit = this.raycast(e);
    if (!hit) {
      this.eventBus.emit("miss", { kind: "hover" });
      this.clearHoverState();
      return;
    }

    const { point, cellId } = hit;
    const value = this.interpolateAtWorld(point, cellId, this.variableName);
    this.updateHighlight(cellId);
    this.eventBus.emit("hover", {
      world: { x: point.x, y: point.y, z: point.z },
      cellId,
      value,
      variable: this.variableName,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  private onClick(e: MouseEvent): void {
    if (!this.enabled || this.disposed) return;
    const hit = this.raycast(e);
    if (!hit) {
      this.eventBus.emit("miss", { kind: "click" });
      return;
    }

    const { point, cellId } = hit;
    const value = this.interpolateAtWorld(point, cellId, this.variableName);
    const label = this.createLabel(point, `${this.variableName}: ${value.toFixed(6)}`);
    this.labels.add(label);

    this.eventBus.emit("click", {
      world: { x: point.x, y: point.y, z: point.z },
      cellId,
      value,
      variable: this.variableName,
      labelObject: label,
    });
  }

  private clearHoverState(): void {
    if (this.highlight) this.highlight.visible = false;
  }

  // -----------------------------
  // Raycast + BVH
  // -----------------------------

  private raycast(e: { clientX: number; clientY: number }): { point: THREE.Vector3; cellId: number } | null {
    if (!this.pickMesh || !this.triToCell) {
      // 没有设置 pickMesh，则无法进行单元定位
      return null;
    }

    const rect = this.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    this.raycaster.setFromCamera(this.ndc, this.camera);
    // BVH 支持 firstHitOnly 优化
    (this.raycaster as any).firstHitOnly = true;

    const hits = this.raycaster.intersectObject(this.pickMesh, false);
    if (!hits.length) return null;
    const h = hits[0];
    if (h.faceIndex == null) return null;

    const triId = h.faceIndex >>> 0;
    if (triId >= this.triToCell.length) return null;
    const cellId = this.triToCell[triId];

    this.tmpWorld.copy(h.point);
    return { point: this.tmpWorld.clone(), cellId };
  }

  // -----------------------------
  // 插值：Hex(Trilinear) / Tet(Barycentric)
  // -----------------------------

  private interpolateAtWorld(world: THREE.Vector3, cellId: number, variable: string): number {
    const values = this.dataset.variables[variable];
    if (!values) throw new Error(`ProbeInteractor: 不存在变量 ${variable}`);

    // 当前 FlowDataset Phase1 主要支持 FEBRICK（Hex）
    const el = this.dataset.elements;
    if (el.elementType === "FEBRICK") {
      return interpolateHexTrilinear(world, cellId, this.dataset, values);
    }
    throw new Error(`ProbeInteractor: 暂不支持单元类型 ${el.elementType}`);
  }

  // -----------------------------
  // 高亮与标签
  // -----------------------------

  private updateHighlight(cellId: number): void {
    if (!this.highlight) return;
    const geom = buildHexCellEdgeGeometry(this.dataset, cellId);
    this.highlight.geometry.dispose();
    this.highlight.geometry = geom;
    this.highlight.visible = true;
  }

  private createLabel(world: THREE.Vector3, text: string): CSS2DObject {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.padding = "8px 12px";
    div.style.borderRadius = "10px";
    div.style.background = "rgba(30, 35, 50, 0.85)";
    div.style.backdropFilter = "blur(12px)";
    div.style.webkitBackdropFilter = "blur(12px)";
    div.style.border = "1px solid rgba(255,255,255,0.18)";
    div.style.color = "rgba(255,255,255,0.95)";
    div.style.fontSize = "12px";
    div.style.whiteSpace = "nowrap";
    div.style.pointerEvents = "none";
    div.style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)";

    const obj = new CSS2DObject(div);
    obj.position.copy(world);
    return obj;
  }
}

// -----------------------------
// triId -> cellId 映射构建（供外部在生成 pickMesh 时调用）
// -----------------------------

/**
 * 为 FEBRICK 构建 “面片三角化” 的 triToCell 映射：
 * - 与 Phase2 的 buildFEBRICKSurfaceTrianglesGeometry 相同的三角化规则：
 *   每单元 6 个面，每面 2 个三角形 => 12 triangles
 */
export function buildHexTriToCell(elementsCount: number): Uint32Array {
  const trianglesPerCell = 12;
  const triToCell = new Uint32Array(elementsCount * trianglesPerCell);
  let p = 0;
  for (let c = 0; c < elementsCount; c++) {
    for (let t = 0; t < trianglesPerCell; t++) triToCell[p++] = c;
  }
  return triToCell;
}

// -----------------------------
// Hex 单元高亮（LineSegments）
// -----------------------------

const HEX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

function buildHexCellEdgeGeometry(dataset: FlowDataset, cellId: number): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const { nodes, elements } = dataset;
  const base = cellId * 8;
  const conn = elements.connectivity;
  const pos = nodes.coords;

  const lineVerts = new Float32Array(HEX_EDGES.length * 2 * 3);
  let p = 0;
  for (const [aL, bL] of HEX_EDGES) {
    const a = conn[base + aL] * 3;
    const b = conn[base + bL] * 3;
    lineVerts[p++] = pos[a];
    lineVerts[p++] = pos[a + 1];
    lineVerts[p++] = pos[a + 2];
    lineVerts[p++] = pos[b];
    lineVerts[p++] = pos[b + 1];
    lineVerts[p++] = pos[b + 2];
  }
  geom.setAttribute("position", new THREE.BufferAttribute(lineVerts, 3));
  return geom;
}

// -----------------------------
// Hex 等参三线性插值（Newton 迭代）
// -----------------------------

/**
 * Hex 的 8 个节点自然坐标（ξ,η,ζ）取值为 ±1
 * 顶点顺序与 Tecplot FEBRICK 常见一致（与 Phase2 的 faces/edges一致）
 */
const HEX_NATURAL: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1], // 0
  [1, -1, -1], // 1
  [1, 1, -1], // 2
  [-1, 1, -1], // 3
  [-1, -1, 1], // 4
  [1, -1, 1], // 5
  [1, 1, 1], // 6
  [-1, 1, 1], // 7
];

function interpolateHexTrilinear(
  world: THREE.Vector3,
  cellId: number,
  dataset: FlowDataset,
  scalar: Float32Array,
): number {
  const { nodes, elements } = dataset;
  const conn = elements.connectivity;
  const base = cellId * 8;

  // 取 8 个节点坐标与标量
  const X = new Float64Array(8 * 3);
  const S = new Float64Array(8);
  for (let i = 0; i < 8; i++) {
    const ni = conn[base + i] * 3;
    X[i * 3] = nodes.coords[ni];
    X[i * 3 + 1] = nodes.coords[ni + 1];
    X[i * 3 + 2] = nodes.coords[ni + 2];
    S[i] = scalar[conn[base + i]];
  }

  // 初值：自然坐标中心
  let xi = 0.0;
  let eta = 0.0;
  let zeta = 0.0;

  // Newton-Raphson：求解 F(xi,eta,zeta) = x(world)
  // 迭代 8~15 次通常足够；若单元畸变较大可能需要更多或做阻尼
  const maxIter = 12;
  const tol = 1e-6;

  for (let iter = 0; iter < maxIter; iter++) {
    const { N, dN_dxi, dN_deta, dN_dzeta } = hexShape(xi, eta, zeta);

    // 计算映射位置 x(xi,eta,zeta) 与残差 r = x - world
    let px = 0,
      py = 0,
      pz = 0;
    let j00 = 0,
      j01 = 0,
      j02 = 0;
    let j10 = 0,
      j11 = 0,
      j12 = 0;
    let j20 = 0,
      j21 = 0,
      j22 = 0;

    for (let a = 0; a < 8; a++) {
      const ax = X[a * 3];
      const ay = X[a * 3 + 1];
      const az = X[a * 3 + 2];

      const Na = N[a];
      px += Na * ax;
      py += Na * ay;
      pz += Na * az;

      const dxi = dN_dxi[a];
      const deta = dN_deta[a];
      const dz = dN_dzeta[a];

      j00 += dxi * ax;
      j01 += deta * ax;
      j02 += dz * ax;

      j10 += dxi * ay;
      j11 += deta * ay;
      j12 += dz * ay;

      j20 += dxi * az;
      j21 += deta * az;
      j22 += dz * az;
    }

    const rx = px - world.x;
    const ry = py - world.y;
    const rz = pz - world.z;
    const err = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (err < tol) break;

    // 解 J * d = r，更新：u_{k+1} = u_k - d
    const d = solve3x3(j00, j01, j02, j10, j11, j12, j20, j21, j22, rx, ry, rz);
    if (!d) break; // 奇异 Jacobian，直接退出
    xi -= d[0];
    eta -= d[1];
    zeta -= d[2];

    // 为了数值稳定，适当 clamp（避免跑飞）
    xi = clamp(xi, -1.5, 1.5);
    eta = clamp(eta, -1.5, 1.5);
    zeta = clamp(zeta, -1.5, 1.5);
  }

  // 最终用 shape function 插值标量：s = Σ Na * Sa
  const { N } = hexShape(xi, eta, zeta);
  let out = 0;
  for (let a = 0; a < 8; a++) out += N[a] * S[a];
  return out;
}

function hexShape(xi: number, eta: number, zeta: number): {
  N: Float64Array;
  dN_dxi: Float64Array;
  dN_deta: Float64Array;
  dN_dzeta: Float64Array;
} {
  const N = new Float64Array(8);
  const dN_dxi = new Float64Array(8);
  const dN_deta = new Float64Array(8);
  const dN_dzeta = new Float64Array(8);

  for (let a = 0; a < 8; a++) {
    const [sx, sy, sz] = HEX_NATURAL[a];
    const a1 = 1 + sx * xi;
    const a2 = 1 + sy * eta;
    const a3 = 1 + sz * zeta;
    N[a] = 0.125 * a1 * a2 * a3;
    dN_dxi[a] = 0.125 * sx * a2 * a3;
    dN_deta[a] = 0.125 * sy * a1 * a3;
    dN_dzeta[a] = 0.125 * sz * a1 * a2;
  }

  return { N, dN_dxi, dN_deta, dN_dzeta };
}

function solve3x3(
  a00: number,
  a01: number,
  a02: number,
  a10: number,
  a11: number,
  a12: number,
  a20: number,
  a21: number,
  a22: number,
  b0: number,
  b1: number,
  b2: number,
): [number, number, number] | null {
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;

  const invDet = 1 / det;
  const x =
    (b0 * (a11 * a22 - a12 * a21) -
      a01 * (b1 * a22 - a12 * b2) +
      a02 * (b1 * a21 - a11 * b2)) *
    invDet;
  const y =
    (a00 * (b1 * a22 - a12 * b2) -
      b0 * (a10 * a22 - a12 * a20) +
      a02 * (a10 * b2 - b1 * a20)) *
    invDet;
  const z =
    (a00 * (a11 * b2 - b1 * a21) -
      a01 * (a10 * b2 - b1 * a20) +
      b0 * (a10 * a21 - a11 * a20)) *
    invDet;
  return [x, y, z];
}

function clamp(x: number, a: number, b: number): number {
  if (x < a) return a;
  if (x > b) return b;
  return x;
}

