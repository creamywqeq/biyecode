<script setup lang="ts">
import * as THREE from "three";
import { inject, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { FLOW_APP_KEY } from "../app/flowAppContext";

import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

/**
 * SliceGizmo：三维切片操作手柄（TransformControls）
 *
 * 实现思路：
 * - 在 Three 场景里创建一个“切片平面代理对象”（planeHelperMesh）
 * - TransformControls 绑定到该对象：
 *   - translate：改变 origin（平移）
 *   - rotate：改变 normal（旋转）
 * - 每次对象变换后，写回 state.slicePlane（触发 Provider watch -> vtk cutter 重新切片）
 */

const app = inject(FLOW_APP_KEY);
if (!app) throw new Error("SliceGizmo: 缺少 FlowAppProvider");

const controlsRef = shallowRef<TransformControls | null>(null);
const planeMeshRef = shallowRef<THREE.Mesh | null>(null);
let rendererRef: typeof app.renderer | null = null;

onMounted(() => {
  const renderer = app.renderer;
  rendererRef = renderer;

  // 1) 创建可见的平面代理（尺寸足够大以便拖拽，典型流场 0~3 范围）
  const planeSize = 4;
  const geom = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x007aff,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const planeMesh = new THREE.Mesh(geom, mat);
  planeMesh.name = "SlicePlaneProxy";
  app.renderer.sliceLayer.add(planeMesh);
  planeMeshRef.value = planeMesh;

  // 2) TransformControls（放大手柄便于点击）
  const tc = new TransformControls(renderer.camera, renderer.renderer.domElement);
  tc.setMode(app.state.sliceGizmoMode.value);
  tc.setSpace("world");
  tc.setSize(1.2);
  tc.attach(planeMesh);

  // TransformControls 会与 OrbitControls 冲突：拖拽时禁用 orbit
  tc.addEventListener("dragging-changed", (e: any) => {
    renderer.controls.enabled = !e.value;
  });

  // 3) 变换回调：写回 slicePlane（origin + normal）
  const updatePlaneState = () => {
    const m = planeMeshRef.value;
    if (!m) return;
    // origin：取 mesh 世界坐标位置
    const origin = m.getWorldPosition(new THREE.Vector3());
    // normal：平面局部法线为 +Z，经世界矩阵旋转得到世界法线
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion())).normalize();

    app.state.slicePlane.value = {
      origin: [origin.x, origin.y, origin.z],
      normal: [normal.x, normal.y, normal.z],
    };
  };

  tc.addEventListener("objectChange", updatePlaneState);
  controlsRef.value = tc;
  // r169+：TransformControls 不再继承 Object3D，需添加 getHelper() 返回的 root
  app.renderer.scene.add(tc.getHelper());

  // 4) 初始化：从 state.slicePlane 反推 planeMesh 的位置/朝向
  syncMeshFromState();
});

function syncMeshFromState() {
  const m = planeMeshRef.value;
  if (!m) return;
  const { origin, normal } = app.state.slicePlane.value;

  m.position.set(origin[0], origin[1], origin[2]);

  // 把 +Z 旋转到 normal 的四元数
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  m.quaternion.copy(q);
}

watch(
  () => app.state.slicePlane.value,
  () => syncMeshFromState(),
  { deep: true },
);

watch(
  () => app.state.sliceGizmoMode.value,
  (mode) => {
    const tc = controlsRef.value;
    if (tc) tc.setMode(mode);
  },
);

onBeforeUnmount(() => {
  const tc = controlsRef.value;
  if (tc) {
    const helper = tc.getHelper();
    if (helper.parent) helper.parent.remove(helper);
    tc.dispose();
  }
  controlsRef.value = null;

  const m = planeMeshRef.value;
  const renderer = rendererRef;
  if (m && renderer) {
    renderer.sliceLayer.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  planeMeshRef.value = null;
  rendererRef = null;
});
</script>

<template>
  <!-- 这是一个“无 DOM UI”的组件：只负责在 Three 场景里挂 TransformControls -->
  <div style="display: none" />
</template>

