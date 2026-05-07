import * as THREE from "three";
import type { FlowDataset } from "../flow";

/**
 * 六面体切片算法封装
 *
 * 说明：
 * - 原 vtkCutter + vtkPolyData 方案：对表面三角网格切割，得到的是平面与各三角形面的交线，
 *   导致切片呈碎片状、不连续。
 * - 本实现：直接对六面体单元做平面相交，每个与平面相交的单元输出一个凸多边形，
 *   切片连续、符合 Tecplot 等后处理软件的预期。
 */
export class VtkSlicer {
  private sliceMesh?: THREE.Mesh;
  /**
   * 切片指示底板：始终随当前切片平面位置/法向同步显示的一块半透明矩形。
   * 即使该平面没有切到任何单元（例如位于数据外部、或 Position 滑块拉到边界外），
   * 用户也能从这块底板直观看到 "切片现在在哪里、朝向如何"。
   * 渲染顺序低于实际切片几何，且 depthWrite=false，避免遮挡数据切片着色。
   */
  private guideMesh?: THREE.Mesh;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly material?: THREE.Material,
  ) {}

  /**
   * 计算切片并加入 Three.js 场景
   *
   * 使用原生六面体-平面相交算法，输出连续切片。
   */
  slice(
    dataset: FlowDataset,
    plane: { origin: [number, number, number]; normal: [number, number, number] },
    options?: {
      colorByScalar?: string;
      lutTexture?: THREE.DataTexture;
      opacity?: number;
      /** 该变量原始 min/max（与 FlowRenderer.uDataMin/Max 保持一致） */
      dataMin?: number;
      dataMax?: number;
    },
  ): THREE.Mesh {
    this.clear();

    const result = hexPlaneSlice(dataset, plane, options?.colorByScalar);
    const geom = result.geometry;

    const opacity = options?.opacity ?? 1.0;
    const scalarName = options?.colorByScalar;

    let material: THREE.Material;
    if (scalarName && options?.lutTexture && result.scalars) {
      geom.setAttribute("aScalar", new THREE.BufferAttribute(result.scalars, 1));
      // 若未传入 min/max，则现场计算切片点上的范围
      let dataMin = options?.dataMin ?? Number.POSITIVE_INFINITY;
      let dataMax = options?.dataMax ?? Number.NEGATIVE_INFINITY;
      if (options?.dataMin == null || options?.dataMax == null) {
        for (let i = 0; i < result.scalars.length; i++) {
          const v = result.scalars[i];
          if (!Number.isFinite(v)) continue;
          if (v < dataMin) dataMin = v;
          if (v > dataMax) dataMax = v;
        }
      }
      if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax) || dataMax <= dataMin) {
        dataMin = 0;
        dataMax = 1;
      }
      material = new THREE.ShaderMaterial({
        uniforms: {
          uLUT: { value: options.lutTexture },
          uOpacity: { value: opacity },
          uDataMin: { value: dataMin },
          uDataMax: { value: dataMax },
        },
        vertexShader: SLICE_SCALAR_VERTEX_GLSL,
        fragmentShader: SLICE_SCALAR_FRAGMENT_GLSL,
        transparent: opacity < 1,
        depthTest: true,
        depthWrite: opacity >= 1,
        side: THREE.DoubleSide,
      });
    } else {
      material =
        this.material ??
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: opacity < 1,
          opacity,
          side: THREE.DoubleSide,
        });
    }

    this.sliceMesh = new THREE.Mesh(geom, material);
    // 实际切片几何渲染在底板之上
    this.sliceMesh.renderOrder = 2;
    this.scene.add(this.sliceMesh);

    // 同步更新切片指示底板
    this.updateGuide(dataset, plane);

    return this.sliceMesh;
  }

  clear(): void {
    if (this.sliceMesh) {
      this.scene.remove(this.sliceMesh);
      this.sliceMesh.geometry.dispose();
      if (this.sliceMesh.material instanceof THREE.ShaderMaterial) {
        this.sliceMesh.material.dispose();
      }
      this.sliceMesh = undefined;
    }
    // 同步清掉指示底板：避免数据集卸载/网格超上限时底板仍残留
    this.clearGuide();
  }

  /** 仅清除切片指示底板（数据集卸载时使用） */
  clearGuide(): void {
    if (!this.guideMesh) return;
    this.scene.remove(this.guideMesh);
    this.guideMesh.geometry.dispose();
    (this.guideMesh.material as THREE.Material).dispose();
    this.guideMesh = undefined;
  }

  /**
   * 创建/更新切片指示底板：
   * - 边长 = 数据集 bbox 最大维度 × 1.05，保证完全覆盖被切区域
   * - 位置 = plane.origin
   * - 朝向 = 平面默认法线 +Z 旋转到 plane.normal
   * - 半透明蓝灰底色，不写深度，让数据切片清晰显示在上方
   */
  updateGuide(
    dataset: FlowDataset,
    plane: { origin: [number, number, number]; normal: [number, number, number] },
  ): void {
    const coords = dataset.nodes.coords;
    if (coords.length < 3) {
      this.clearGuide();
      return;
    }
    let xmn = Infinity, ymn = Infinity, zmn = Infinity;
    let xmx = -Infinity, ymx = -Infinity, zmx = -Infinity;
    for (let i = 0; i < coords.length; i += 3) {
      const x = coords[i], y = coords[i + 1], z = coords[i + 2];
      if (x < xmn) xmn = x; if (x > xmx) xmx = x;
      if (y < ymn) ymn = y; if (y > ymx) ymx = y;
      if (z < zmn) zmn = z; if (z > zmx) zmx = z;
    }
    const sx = xmx - xmn, sy = ymx - ymn, sz = zmx - zmn;
    const size = Math.max(sx, sy, sz, 1e-6) * 1.05;

    if (!this.guideMesh) {
      const geom = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        // 浅蓝灰色，与 Tecplot 默认 slice 指示色相近
        color: 0x6da3d6,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.guideMesh = new THREE.Mesh(geom, mat);
      this.guideMesh.renderOrder = 1;
      this.scene.add(this.guideMesh);
    }

    // 缩放（PlaneGeometry 单位边长，scale 即可控制实际尺寸）
    this.guideMesh.scale.set(size, size, 1);

    // 位置
    this.guideMesh.position.set(plane.origin[0], plane.origin[1], plane.origin[2]);

    // 朝向：把 PlaneGeometry 默认法线 +Z 对齐到 plane.normal
    const n = new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]);
    if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
    n.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.guideMesh.quaternion.copy(q);
  }

  /**
   * 实时更新切片着色的颜色映射区间（uDataMin/uDataMax）。
   * 与 FlowRenderer.setScalarRange 等价，用于响应阈值面板/色条的全局调整。
   */
  setScalarRange(minRaw: number, maxRaw: number): void {
    if (!this.sliceMesh) return;
    const mat = this.sliceMesh.material;
    if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uDataMin && mat.uniforms.uDataMax) {
      mat.uniforms.uDataMin.value = minRaw;
      mat.uniforms.uDataMax.value = maxRaw;
    }
  }
}

// -----------------------------
// 六面体-平面相交（原生实现）
// -----------------------------

/** 六面体 12 条边的顶点索引对（FEBRICK 顺序：0-3 底面，4-7 顶面） */
const HEX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0], // 底面
  [4, 5], [5, 6], [6, 7], [7, 4], // 顶面
  [0, 4], [1, 5], [2, 6], [3, 7], // 竖边
];

function hexPlaneSlice(
  dataset: FlowDataset,
  plane: { origin: [number, number, number]; normal: [number, number, number] },
  scalarName?: string,
): { geometry: THREE.BufferGeometry; scalars?: Float32Array } {
  const { nodes, elements, variables } = dataset;
  if (elements.elementType !== "FEBRICK") {
    throw new Error(`VtkSlicer: 暂仅支持 FEBRICK（实际 ${elements.elementType}）`);
  }

  const coords = nodes.coords;
  const conn = elements.connectivity;
  const cellCount = elements.elementCount;

  const ox = plane.origin[0];
  const oy = plane.origin[1];
  const oz = plane.origin[2];
  const nx = plane.normal[0];
  const ny = plane.normal[1];
  const nz = plane.normal[2];

  const scalarArr = scalarName ? variables[scalarName] : null;

  const positions: number[] = [];
  const scalars: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (let c = 0; c < cellCount; c++) {
    const base = c * 8;
    const verts: [number, number, number][] = [];
    const vertScalars: number[] = [];
    const dists: number[] = [];

    for (let k = 0; k < 8; k++) {
      const ni = conn[base + k];
      const i3 = ni * 3;
      const x = coords[i3];
      const y = coords[i3 + 1];
      const z = coords[i3 + 2];
      verts[k] = [x, y, z];
      dists[k] = (x - ox) * nx + (y - oy) * ny + (z - oz) * nz;
      if (scalarArr) vertScalars[k] = scalarArr[ni];
    }

    const pts: number[][] = [];
    const ptScalars: number[] = [];

    for (const [a, b] of HEX_EDGES) {
      const d0 = dists[a];
      const d1 = dists[b];
      if (!Number.isFinite(d0) || !Number.isFinite(d1)) continue;
      if (d0 * d1 > 0) continue; // 同侧，不交

      const denom = d1 - d0;
      if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) continue;
      const t = -d0 / denom;
      if (!Number.isFinite(t) || t < -1e-6 || t > 1 + 1e-6) continue;
      const tt = Math.max(0, Math.min(1, t));
      const v0 = verts[a];
      const v1 = verts[b];
      pts.push([
        v0[0] + tt * (v1[0] - v0[0]),
        v0[1] + tt * (v1[1] - v0[1]),
        v0[2] + tt * (v1[2] - v0[2]),
      ]);
      if (scalarArr) ptScalars.push(vertScalars[a] + tt * (vertScalars[b] - vertScalars[a]));
    }

    if (pts.length < 3 || !pts.every((p) => p.every(Number.isFinite))) continue;

    // 将交点按平面内顺序排列（绕平面法向）
    const sArr = scalarArr ? ptScalars : pts.map(() => 0);
    const { orderedPts, orderedScalars } = orderPolygonOnPlane(
      pts,
      sArr,
      [nx, ny, nz],
    );
    if (orderedPts.length < 3) continue;

    // 扇形三角化
    for (let k = 1; k < orderedPts.length - 1; k++) {
      indices.push(vertexOffset, vertexOffset + k, vertexOffset + k + 1);
    }
    for (let i = 0; i < orderedPts.length; i++) {
      positions.push(orderedPts[i][0], orderedPts[i][1], orderedPts[i][2]);
      if (scalarArr) scalars.push(orderedScalars[i]);
    }
    vertexOffset += orderedPts.length;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (indices.length > 0) {
    geom.setIndex(indices);
  }
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const outScalars = scalarArr && scalars.length > 0 ? new Float32Array(scalars) : undefined;
  return { geometry: geom, scalars: outScalars };
}

/**
 * 将平面上的点按绕法向的角序排列，形成凸多边形；同时重排对应的标量
 */
function orderPolygonOnPlane(
  pts: number[][],
  scalars: number[],
  normal: [number, number, number],
): { orderedPts: number[][]; orderedScalars: number[] } {
  const n = pts.length;
  if (n <= 3) return { orderedPts: pts, orderedScalars: scalars };

  const [nx, ny, nz] = normal;
  const center = [0, 0, 0];
  for (const p of pts) {
    center[0] += p[0];
    center[1] += p[1];
    center[2] += p[2];
  }
  center[0] /= n;
  center[1] /= n;
  center[2] /= n;

  let ux = 1;
  let uy = 0;
  let uz = 0;
  for (let i = 0; i < 3; i++) {
    const dot = ux * nx + uy * ny + uz * nz;
    if (Math.abs(dot) < 0.99) {
      ux -= dot * nx;
      uy -= dot * ny;
      uz -= dot * nz;
      const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (len > 1e-6) {
        ux /= len;
        uy /= len;
        uz /= len;
        break;
      }
    }
    [ux, uy, uz] = [0, 1, 0];
  }

  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  const withAngle = pts.map((p, i) => {
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const dz = p[2] - center[2];
    const pu = dx * ux + dy * uy + dz * uz;
    const pv = dx * vx + dy * vy + dz * vz;
    return { i, angle: Math.atan2(pv, pu) };
  });
  withAngle.sort((a, b) => a.angle - b.angle);
  return {
    orderedPts: withAngle.map((a) => pts[a.i]),
    orderedScalars: withAngle.map((a) => scalars[a.i]),
  };
}

// -----------------------------
// Shader
// -----------------------------

export const SLICE_SCALAR_VERTEX_GLSL = /* glsl */ `
  attribute float aScalar;
  varying float vScalar;
  void main() {
    vScalar = aScalar;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const SLICE_SCALAR_FRAGMENT_GLSL = /* glsl */ `
  precision highp float;
  uniform sampler2D uLUT;
  uniform float uOpacity;
  uniform float uDataMin;
  uniform float uDataMax;
  varying float vScalar;
  float saturate(float x) { return clamp(x, 0.0, 1.0); }
  void main() {
    float denom = max(uDataMax - uDataMin, 1e-12);
    float t = saturate((vScalar - uDataMin) / denom);
    vec3 rgb = texture2D(uLUT, vec2(t, 0.5)).rgb;
    gl_FragColor = vec4(rgb, uOpacity);
  }
`;
