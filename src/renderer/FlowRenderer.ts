import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { FlowDataset } from "../flow";
import { extractIsosurface } from "../algorithms/IsosurfaceExtractor";

/**
 * 基于 Vue+Three.js 的 Web 端流场后处理系统 - 主渲染引擎
 *
 * 职责：Scene/Camera/WebGLRenderer/CSS2DRenderer/OrbitControls + 绘制对象管理
 */
export class FlowRenderer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly css2dRenderer: CSS2DRenderer;
  public readonly controls: OrbitControls;

  /** 根节点：便于整体 transform/clear */
  public readonly root = new THREE.Group();
  /** 网格线框层 */
  public readonly wireframeLayer = new THREE.Group();
  /** 云图层 */
  public readonly scalarLayer = new THREE.Group();
  /** VTK 切片层（统一由 Three.js 渲染） */
  public readonly sliceLayer = new THREE.Group();
  /** 等值面层 */
  public readonly isosurfaceLayer = new THREE.Group();

  private wireframe?: THREE.LineSegments;
  private scalarMesh?: THREE.Mesh;
  private lutTexture?: THREE.DataTexture;
  private scalarMaterial?: THREE.ShaderMaterial;
  private isosurfaceMesh?: THREE.Mesh;

  private animationHandle = 0;
  private disposed = false;

  // 用于实现“双击鼠标中键复位视图”
  private lastMiddleDownMs = 0;
  private readonly middleDoubleClickThresholdMs = 280;

  constructor(
    private readonly container: HTMLElement,
    options?: {
      /** 背景色（默认深色） */
      clearColor?: THREE.ColorRepresentation;
      /** 初始相机视场角（默认 45） */
      fov?: number;
      /** 是否开启抗锯齿（默认 true） */
      antialias?: boolean;
      /** devicePixelRatio 上限（默认 2，防止 4K 显示器过载） */
      dprMax?: number;
    },
  ) {
    const clearColor = options?.clearColor ?? 0x0b1020;
    const fov = options?.fov ?? 45;
    const antialias = options?.antialias ?? true;
    const dprMax = options?.dprMax ?? 2;

    // 1) Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(clearColor);
    this.scene.add(this.root);
    this.root.add(this.wireframeLayer, this.scalarLayer, this.sliceLayer, this.isosurfaceLayer);

    // 2) Camera
    const { clientWidth: w, clientHeight: h } = container;
    this.camera = new THREE.PerspectiveCamera(fov, Math.max(1, w) / Math.max(1, h), 0.01, 1e7);
    this.camera.position.set(2.5, 2.5, 2.5);

    // 3) Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprMax));
    this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    this.renderer.setClearColor(new THREE.Color(clearColor), 1);
    container.appendChild(this.renderer.domElement);

    // 3b) CSS2DRenderer（用于 Probe 点击标签等 2D 叠加）
    this.css2dRenderer = new CSS2DRenderer();
    this.css2dRenderer.setSize(Math.max(1, w), Math.max(1, h));
    this.css2dRenderer.domElement.style.position = "absolute";
    this.css2dRenderer.domElement.style.top = "0";
    this.css2dRenderer.domElement.style.left = "0";
    this.css2dRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.css2dRenderer.domElement);

    // 4) OrbitControls（键位定制：左旋转、右平移、滚轮缩放）
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY, // 滚轮缩放（按下滚轮拖拽同样会 dolly）
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    // 灯光（云图本质是自发光式着色，但给场景一个环境光，便于后续扩展材质）
    const hemi = new THREE.HemisphereLight(0xffffff, 0x223355, 0.8);
    this.scene.add(hemi);

    // 参考物（用于避免“空白页”误判）：
    // - 坐标轴：帮助确认相机/控件正常
    // - 地面网格：提供空间尺度感
    const axes = new THREE.AxesHelper(1.0);
    axes.name = "AxesHelper";
    this.scene.add(axes);
    const grid = new THREE.GridHelper(10, 10, 0x335577, 0x223344);
    grid.name = "GridHelper";
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.25;
    this.scene.add(grid);

    // 事件：resize + 中键双击复位
    this.onResize = this.onResize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    window.addEventListener("resize", this.onResize);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);

    // 初始 target
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** 启动渲染循环（由外部控制更灵活，这里提供默认实现） */
  start(): void {
    if (this.disposed) throw new Error("FlowRenderer: 实例已销毁");
    if (this.animationHandle) return;

    const tick = () => {
      if (this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.css2dRenderer.render(this.scene, this.camera);
      this.animationHandle = window.requestAnimationFrame(tick);
    };
    this.animationHandle = window.requestAnimationFrame(tick);
  }

  /** 停止渲染循环 */
  stop(): void {
    if (this.animationHandle) {
      window.cancelAnimationFrame(this.animationHandle);
      this.animationHandle = 0;
    }
  }

  /** 外部调用：当容器尺寸变化时同步更新相机与 renderer */
  resize(): void {
    this.onResize();
  }

  /** 清理 GPU 资源与事件 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stop();
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);

    this.clearWireframe();
    this.clearScalarMesh();
    this.clearIsosurface();

    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css2dRenderer.domElement.remove();
  }

  /** 获取当前云图 Mesh（供 ProbeInteractor 拾取） */
  getScalarMesh(): THREE.Mesh | undefined {
    return this.scalarMesh;
  }

  // -----------------------------
  // 对外 API：加载/显示数据集
  // -----------------------------

  /**
   * 绘制非结构化网格线框（LineSegments）
   * 说明：
   * - Tecplot FEBRICK：每单元 12 条边
   * - 这里不做“边去重”，会存在重叠边（可接受；后续可用哈希/排序去重优化）
   */
  setWireframe(dataset: FlowDataset, options?: { color?: THREE.ColorRepresentation; opacity?: number }): void {
    this.clearWireframe();

    const color = options?.color ?? 0x8aa1c2;
    const opacity = options?.opacity ?? 0.45;

    const geometry = buildFEBRICKWireframeGeometry(dataset);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: true,
      depthWrite: false,
    });
    this.wireframe = new THREE.LineSegments(geometry, material);
    this.wireframeLayer.add(this.wireframe);

    this.frameToDataset(dataset);
  }

  /**
   * 绘制标量场云图（Mesh + 自定义 Shader）
   *
   * 关键点：
   * - 标量数据以 `attribute float aScalar` 的形式传入 GPU（节点变量）
   * - 片元着色器中对 1D LUT 纹理采样：`texture2D(uLUT, vec2(t, 0.5))`
   * - 颜色计算在片元阶段完成：不是 CPU 上预先算 RGB，也不是仅用顶点颜色“硬插值”
   *
   * 注意：
   * - 这里示范性地将“所有六面体单元的 6 个面”都三角化并绘制，会包含内部面。
   *   生产级需要做外表面提取（面消隐/面哈希），我们可在后续 Phase 做。
   */
  setScalarField(
    dataset: FlowDataset,
    scalarName: string,
    options?: {
      /** LUT 分辨率（默认 256） */
      lutSize?: number;
      /** 不透明度（默认 1） */
      opacity?: number;
      /** 是否显示背面（默认 true，便于观察内部） */
      doubleSide?: boolean;
    },
  ): void {
    this.clearScalarMesh();

    const scalar = dataset.variables[scalarName];
    if (!scalar) {
      throw new Error(`FlowRenderer: dataset.variables 中不存在标量变量：${scalarName}`);
    }

    // 1) 创建/复用 LUT 纹理
    const lutSize = options?.lutSize ?? 256;
    this.lutTexture = createTurboLUTTexture(lutSize);

    // 2) 构建几何（位置 + index + 标量 attribute）
    const geometry = buildFEBRICKSurfaceTrianglesGeometry(dataset);
    geometry.setAttribute("aScalar", new THREE.BufferAttribute(scalar, 1));

    // 3) ShaderMaterial：片元阶段按 LUT 采样上色（平滑过渡）
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uLUT: { value: this.lutTexture },
        uOpacity: { value: options?.opacity ?? 1.0 },
        // 阈值过滤：在片元阶段按标量范围丢弃（默认不过滤）
        uMin: { value: 0.0 },
        uMax: { value: 1.0 },
      },
      vertexShader: FLOW_SCALAR_VERTEX_GLSL,
      fragmentShader: FLOW_SCALAR_FRAGMENT_GLSL,
      transparent: (options?.opacity ?? 1.0) < 1.0,
      depthTest: true,
      depthWrite: (options?.opacity ?? 1.0) >= 1.0,
      side: options?.doubleSide ?? true ? THREE.DoubleSide : THREE.FrontSide,
    });

    this.scalarMesh = new THREE.Mesh(geometry, material);
    this.scalarLayer.add(this.scalarMesh);
    this.scalarMaterial = material;

    this.frameToDataset(dataset);
  }

  /** 清空线框对象 */
  clearWireframe(): void {
    if (!this.wireframe) return;
    this.wireframeLayer.remove(this.wireframe);
    this.wireframe.geometry.dispose();
    (this.wireframe.material as THREE.Material).dispose();
    this.wireframe = undefined;
  }

  /** 清空云图对象 */
  clearScalarMesh(): void {
    if (!this.scalarMesh) return;
    this.scalarLayer.remove(this.scalarMesh);
    this.scalarMesh.geometry.dispose();
    (this.scalarMesh.material as THREE.Material).dispose();
    this.scalarMesh = undefined;
    this.scalarMaterial = undefined;
    if (this.lutTexture) {
      this.lutTexture.dispose();
      this.lutTexture = undefined;
    }
  }

  /**
   * 设置云图阈值过滤区间（LegendBar 双滑块）
   * 约定：aScalar 已归一化到 0~1（若不是，请先用 DataNormalizer 归一化再传入）
   */
  setScalarThreshold(min01: number, max01: number): void {
    if (!this.scalarMaterial) return;
    const minV = Math.min(min01, max01);
    const maxV = Math.max(min01, max01);
    this.scalarMaterial.uniforms.uMin.value = minV;
    this.scalarMaterial.uniforms.uMax.value = maxV;
  }

  /** 图层显隐：供 SceneTree 控制 */
  setLayerVisible(layer: "wireframe" | "scalar" | "slice" | "isosurface", visible: boolean): void {
    if (layer === "wireframe") this.wireframeLayer.visible = visible;
    else if (layer === "scalar") this.scalarLayer.visible = visible;
    else if (layer === "slice") this.sliceLayer.visible = visible;
    else this.isosurfaceLayer.visible = visible;
  }

  /** 设置等值面（Marching Cubes） */
  setIsosurface(dataset: FlowDataset, scalarName: string, isoValue: number): void {
    this.clearIsosurface();
    const geom = extractIsosurface(dataset, scalarName, isoValue);
    if (geom.getAttribute("position")!.count === 0) return;
    const mat = new THREE.MeshPhongMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.isosurfaceMesh = new THREE.Mesh(geom, mat);
    this.isosurfaceLayer.add(this.isosurfaceMesh);
  }

  /** 清空等值面 */
  clearIsosurface(): void {
    if (!this.isosurfaceMesh) return;
    this.isosurfaceLayer.remove(this.isosurfaceMesh);
    this.isosurfaceMesh.geometry.dispose();
    (this.isosurfaceMesh.material as THREE.Material).dispose();
    this.isosurfaceMesh = undefined;
  }

  // -----------------------------
  // 内部：事件与视图
  // -----------------------------

  private onResize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.css2dRenderer.setSize(w, h);
  }

  /**
   * 双击鼠标中键复位视图：
   * - 浏览器对“中键 dblclick”支持不一致，因此用 pointerdown 时间窗模拟双击。
   */
  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 1) return; // 1 = middle
    const now = performance.now();
    const dt = now - this.lastMiddleDownMs;
    this.lastMiddleDownMs = now;
    if (dt > 0 && dt <= this.middleDoubleClickThresholdMs) {
      this.resetView();
    }
  }

  /** 复位视图：回到默认相机位置与 target（更高级可保存/恢复“适配数据集”的视图） */
  resetView(): void {
    this.controls.reset();
    this.camera.position.set(2.5, 2.5, 2.5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** 将相机/controls 适配到数据集包围盒（快速获得“看到模型”的初始视图） */
  private frameToDataset(dataset: FlowDataset): void {
    const box = computeDatasetBoundingBox(dataset);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const radius = Math.max(1e-6, size.length() * 0.5);
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    const dir = new THREE.Vector3(1, 1, 1).normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist * 1.35);
    this.camera.near = Math.max(0.001, dist / 1000);
    this.camera.far = dist * 1000;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}

// -----------------------------
// Shader：标量云图（LUT 采样）
// -----------------------------

/**
 * 顶点着色器：
 * - 传递标量 attribute 到 varying（插值）
 * - 位置使用标准 MVP
 */
export const FLOW_SCALAR_VERTEX_GLSL = /* glsl */ `
  attribute float aScalar;
  varying float vScalar;

  void main() {
    vScalar = aScalar;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 片元着色器：
 * - 使用 1D LUT（2D 纹理，height=1）进行采样
 * - 颜色在片元阶段生成：每个像素通过 vScalar -> LUT 计算得到平滑云图
 *
 * “平滑且非简单顶点插值”的关键：
 * - 我们不把 RGB 当作顶点属性做插值，而是插值标量，在片元阶段查表得到颜色；
 *   这能保证色带分段/非线性区域在像素级正确表现（尤其是色带有尖锐变化时）。
 */
export const FLOW_SCALAR_FRAGMENT_GLSL = /* glsl */ `
  precision highp float;

  uniform sampler2D uLUT;
  uniform float uOpacity;
  uniform float uMin;
  uniform float uMax;
  varying float vScalar;

  // clamp 标量到 [0,1]，避免异常值导致采样越界
  float saturate(float x) { return clamp(x, 0.0, 1.0); }

  void main() {
    float t = saturate(vScalar);
    // 阈值过滤：不在 [uMin,uMax] 的片元直接丢弃
    if (t < uMin || t > uMax) discard;
    vec3 rgb = texture2D(uLUT, vec2(t, 0.5)).rgb;
    gl_FragColor = vec4(rgb, uOpacity);
  }
`;

// -----------------------------
// Geometry 构建：Wireframe / Surface Triangles
// -----------------------------

// FEBRICK 的 12 条边（局部顶点 0..7）
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

// 六面体 6 个面（四边形），用于三角化
const HEX_FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 3], // bottom
  [4, 5, 6, 7], // top
  [0, 1, 5, 4], // side
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
];

function buildFEBRICKWireframeGeometry(dataset: FlowDataset): THREE.BufferGeometry {
  const { nodes, elements } = dataset;
  const nodeCount = nodes.nodeCount;
  const eCount = elements.elementCount;

  // positions：直接复用 NodeSet 的 coords（零拷贝），Three.js 会引用该 TypedArray
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(nodes.coords, 3));

  // index：LineSegments 使用 index 表示一对一对的线段端点
  const linesPerElement = HEX_EDGES.length; // 12
  const index = new Uint32Array(eCount * linesPerElement * 2);

  const conn = elements.connectivity;
  let p = 0;
  for (let e = 0; e < eCount; e++) {
    const base = e * 8;
    for (let i = 0; i < HEX_EDGES.length; i++) {
      const [aLocal, bLocal] = HEX_EDGES[i];
      const a = conn[base + aLocal];
      const b = conn[base + bLocal];
      if (a >= nodeCount || b >= nodeCount) throw new Error("Wireframe: connectivity 越界");
      index[p++] = a;
      index[p++] = b;
    }
  }

  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildFEBRICKSurfaceTrianglesGeometry(dataset: FlowDataset): THREE.BufferGeometry {
  const { nodes, elements } = dataset;
  const nodeCount = nodes.nodeCount;
  const eCount = elements.elementCount;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(nodes.coords, 3));

  // 每单元：6 个四边形面 -> 12 个三角形 -> 36 个 index
  const trianglesPerElement = HEX_FACES.length * 2; // 12
  const index = new Uint32Array(eCount * trianglesPerElement * 3);

  const conn = elements.connectivity;
  let p = 0;
  for (let e = 0; e < eCount; e++) {
    const base = e * 8;
    for (let f = 0; f < HEX_FACES.length; f++) {
      const [aL, bL, cL, dL] = HEX_FACES[f];
      const a = conn[base + aL];
      const b = conn[base + bL];
      const c = conn[base + cL];
      const d = conn[base + dL];
      if (a >= nodeCount || b >= nodeCount || c >= nodeCount || d >= nodeCount) {
        throw new Error("ScalarMesh: connectivity 越界");
      }
      // quad -> tri1 (a,b,c), tri2 (a,c,d)
      index[p++] = a;
      index[p++] = b;
      index[p++] = c;
      index[p++] = a;
      index[p++] = c;
      index[p++] = d;
    }
  }

  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals(); // 方便未来加光照/轮廓等效果（当前 shader 不用法线也无妨）
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function computeDatasetBoundingBox(dataset: FlowDataset): THREE.Box3 {
  const coords = dataset.nodes.coords;
  if (coords.length < 3) return new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < coords.length; i += 3) {
    const x = coords[i];
    const y = coords[i + 1];
    const z = coords[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
}

// -----------------------------
// LUT：1D 颜色查找表（Turbo）
// -----------------------------

/**
 * 创建 1D LUT（width=lutSize, height=1）的 DataTexture。
 * 默认使用 Turbo colormap（连续、对比度高、工程可视化常用）。
 */
export function createTurboLUTTexture(lutSize: number): THREE.DataTexture {
  const w = Math.max(2, Math.floor(lutSize));
  const data = new Uint8Array(w * 4);
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1);
    const [r, g, b] = turboColor(t);
    const o = i * 4;
    data[o] = Math.round(r * 255);
    data[o + 1] = Math.round(g * 255);
    data[o + 2] = Math.round(b * 255);
    data[o + 3] = 255;
  }

  const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter; // 关键：线性过滤 -> LUT 采样平滑
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Turbo colormap 的近似多项式实现（常用于科学可视化）。
 * 输入 t∈[0,1]，输出 rgb∈[0,1]。
 *
 * 参考：Google/viscm 等公开实现（多项式系数近似）。
 */
function turboColor(t: number): [number, number, number] {
  const x = clamp01(t);

  // 多项式系数（经验值，足够用于工程可视化；后续可替换为你指定的 LUT）
  const r =
    0.13572138 +
    x * (4.6153926 + x * (-42.660322 + x * (132.13108 + x * (-152.94239 + x * 59.286379))));
  const g =
    0.09140261 +
    x * (2.1941884 + x * (4.8429666 + x * (-14.185033 + x * (4.2772986 + x * 2.829566))));
  const b =
    0.1066733 +
    x * (12.641946 + x * (-60.58205 + x * (110.36277 + x * (-89.90311 + x * 26.968893))));

  return [clamp01(r), clamp01(g), clamp01(b)];
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

