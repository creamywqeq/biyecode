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
      material = new THREE.ShaderMaterial({
        uniforms: {
          uLUT: { value: options.lutTexture },
          uOpacity: { value: opacity },
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
    this.scene.add(this.sliceMesh);
    return this.sliceMesh;
  }

  clear(): void {
    if (!this.sliceMesh) return;
    this.scene.remove(this.sliceMesh);
    this.sliceMesh.geometry.dispose();
    if (this.sliceMesh.material instanceof THREE.ShaderMaterial) {
      this.sliceMesh.material.dispose();
    }
    this.sliceMesh = undefined;
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
  varying float vScalar;
  float saturate(float x) { return clamp(x, 0.0, 1.0); }
  void main() {
    float t = saturate(vScalar);
    vec3 rgb = texture2D(uLUT, vec2(t, 0.5)).rgb;
    gl_FragColor = vec4(rgb, uOpacity);
  }
`;
