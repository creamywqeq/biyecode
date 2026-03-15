<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { FLOW_APP_KEY, createDefaultFlowAppState } from "./flowAppContext";
import { EventBus } from "../core/EventBus";
import { FlowRenderer, createTurboLUTTexture } from "../renderer/FlowRenderer";
import { VtkSlicer } from "../algorithms/VtkSlicer";
import { ProbeInteractor, buildHexTriToCell } from "../interaction/ProbeInteractor";
import type { ProbeEvents } from "../interaction/ProbeInteractor";

/**
 * FlowAppProvider：把 3D 引擎与算法服务注入到 Vue 组件树
 *
 * 使用方式（示意）：
 * <FlowAppProvider>
 *   <YourLayout />
 * </FlowAppProvider>
 *
 * 说明：
 * - 本组件只负责“系统集成骨架”：创建 renderer/slicer/bus/state 并 provide
 * - 具体加载数据集（DataParser）由外部业务组件完成后写入 state.dataset
 */

const containerRef = ref<HTMLElement | null>(null);

const state = createDefaultFlowAppState();
const bus = new EventBus<ProbeEvents>();

const rendererRef = shallowRef<FlowRenderer | null>(null);
const slicerRef = shallowRef<VtkSlicer | null>(null);
const probeRef = shallowRef<ProbeInteractor | null>(null);
let probeRecordId = 0;
let offClick: (() => void) | null = null;

onMounted(() => {
  if (!containerRef.value) return;

  const renderer = new FlowRenderer(containerRef.value);
  renderer.start();

  // VtkSlicer 统一把切片 Mesh 加到 renderer.sliceLayer
  const slicer = new VtkSlicer(renderer.sliceLayer);

  rendererRef.value = renderer;
  slicerRef.value = slicer;

  // UI 状态 -> 3D 引擎同步
  watch(
    () => state.layerVisible.value,
    (v) => {
      renderer.setLayerVisible("wireframe", v.wireframe);
      renderer.setLayerVisible("scalar", v.scalar);
      renderer.setLayerVisible("slice", v.slice);
      renderer.setLayerVisible("isosurface", v.isosurface ?? true);
    },
    { deep: true, immediate: true },
  );

  watch(
    () => state.scalarThreshold01.value,
    ([min, max]) => renderer.setScalarThreshold(min, max),
    { immediate: true },
  );

  // 共享 LUT，供切片着色使用
  const sharedLUT = createTurboLUTTexture(256);

  // 等值面：数据集卸载时清空
  watch(
    () => state.dataset.value,
    (ds) => {
      if (!ds) renderer.clearIsosurface();
    },
  );

  // 当切片平面变化时，触发 vtk cutter 重新计算
  watch(
    () => [state.dataset.value, state.slicePlane.value, state.activeScalar.value] as const,
    ([ds, plane, scalarName]) => {
      if (!ds) return;
      if (scalarName) {
        slicer.slice(ds, plane, {
          colorByScalar: scalarName,
          lutTexture: sharedLUT,
          opacity: 0.9,
        });
      } else {
        slicer.slice(ds, plane);
      }
    },
    { deep: true },
  );

  offClick = bus.on("click", (ev) => {
    state.probeRecords.value = [
      ...state.probeRecords.value,
      {
        id: ++probeRecordId,
        x: ev.world.x,
        y: ev.world.y,
        z: ev.world.z,
        variable: ev.variable,
        value: ev.value,
        cellId: ev.cellId,
      },
    ];
  });

  // 探针：当有数据集且云图已绘制时，创建 ProbeInteractor
  watch(
    () => [state.dataset.value, state.activeScalar.value] as const,
    ([ds, scalarName]) => {
      probeRef.value?.dispose();
      probeRef.value = null;
      if (!ds || !scalarName) return;
      const mesh = renderer.getScalarMesh();
      if (!mesh) return;
      const triToCell = buildHexTriToCell(ds.elements.elementCount);
      const probe = new ProbeInteractor(
        renderer.renderer.domElement,
        renderer.camera,
        renderer.scene,
        ds,
        scalarName,
        bus,
      );
      probe.setPickMesh(mesh, triToCell);
      probeRef.value = probe;
    },
    { flush: "post" },
  );
});

onBeforeUnmount(() => {
  offClick?.();
  probeRef.value?.dispose();
  probeRef.value = null;
  slicerRef.value?.clear();
  rendererRef.value?.dispose();
  rendererRef.value = null;
  slicerRef.value = null;
});

// provide：要求 renderer/slicer 在 mounted 后才存在，因此这里提供“延迟初始化”代理对象
provide(FLOW_APP_KEY, {
  get renderer() {
    if (!rendererRef.value) throw new Error("FlowAppProvider: renderer 尚未初始化");
    return rendererRef.value;
  },
  get slicer() {
    if (!slicerRef.value) throw new Error("FlowAppProvider: slicer 尚未初始化");
    return slicerRef.value;
  },
  bus,
  state,
  clearProbeLabels: () => probeRef.value?.clearLabels(),
});
</script>

<template>
  <div class="flow-app-root">
    <div ref="containerRef" class="viewport"></div>
    <div class="ui-overlay">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.flow-app-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.viewport {
  position: absolute;
  inset: 0;
}

/* UI 叠加层：pointer-events: none 让中心区域事件穿透到 canvas，仅面板区域可交互 */
.ui-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 顶部栏、左侧、底部、切片模式可点击，中心 3D 区域事件穿透 */
.ui-overlay :deep(.header),
.ui-overlay :deep(.left),
.ui-overlay :deep(.bottom),
.ui-overlay :deep(.slice-mode),
.ui-overlay :deep(.panel),
.ui-overlay :deep(.legend) {
  pointer-events: auto;
}
</style>

