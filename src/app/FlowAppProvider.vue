<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { FLOW_APP_KEY, createDefaultFlowAppState } from "./flowAppContext";
import { EventBus } from "../core/EventBus";
import { FlowRenderer, createTurboLUTTexture } from "../renderer/FlowRenderer";
import { VtkSlicer } from "../algorithms/VtkSlicer";
import { ProbeInteractor } from "../interaction/ProbeInteractor";
import type { ProbeEvents } from "../interaction/ProbeInteractor";
import { extractExternalSurface } from "../algorithms/SurfaceExtractor";

/** 切片跳过阈值：超过此单元数量不进行交互式切片，避免主线程長时间厄住 */
const LARGE_MESH_THRESHOLD = 1000;
/**
 * 切片硬上限（防御性）：仅对极端规模的网格直接放弃。
 * Tecplot 行为：无人为上限，几千万 cell 也会同步切（数秒级一次性计算）。
 * 这里给一个非常宽松的上限，仅防止在 OOM 前夜的纯失控情况。
 */
const SLICE_MAX_CELLS = 200_000_000;

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

  // 颜色映射区间（Tecplot "Contour values at endpoints" 语义）：
  // [min, max] 被线性映射到 LUT 的 [0, 1]，两端外部的数值夹到端点颜色（不丢弃）。
  // 同步到 FlowRenderer与 Slicer 的 uDataMin/uDataMax。
  watch(
    () => state.scalarThreshold.value,
    ([min, max]) => {
      renderer.setScalarRange(min, max);
      slicer.setScalarRange?.(min, max);
    },
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

  // 当切片平面变化时，触发 vtk cutter 重新计算（同步执行，与 Tecplot 一致）
  watch(
    () => [state.dataset.value, state.slicePlane.value, state.activeScalar.value] as const,
    ([ds, plane, scalarName]) => {
      if (!ds) return;
      if (ds.elements.elementCount > SLICE_MAX_CELLS) {
        console.warn(`[Slice] 单元数 ${ds.elements.elementCount} 超过硬上限 ${SLICE_MAX_CELLS}，已跳过`);
        slicer.clear();
        return;
      }
      if (!plane || !Number.isFinite(plane.origin[0]) || !Number.isFinite(plane.origin[1]) || !Number.isFinite(plane.origin[2])) return;
      const t0 = performance.now();
      try {
        if (scalarName) {
          const [crMin, crMax] = state.scalarThreshold.value;
          slicer.slice(ds, plane, {
            colorByScalar: scalarName,
            lutTexture: sharedLUT,
            opacity: 0.9,
            dataMin: crMin,
            dataMax: crMax,
          });
        } else {
          slicer.slice(ds, plane);
        }
        const ms = (performance.now() - t0).toFixed(0);
        console.log(`[Slice] cells=${ds.elements.elementCount} took ${ms} ms`);
      } catch (err) {
        console.error("[Slice] 失败：", err);
        slicer.clear();
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
        values: ev.values ?? { [ev.variable]: ev.value },
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

      // 云图 mesh 当前固定为外表面（FlowRenderer.setScalarField 总走 buildExternalSurfaceGeometry），
      // 因此 triToCell 也必须取自外表面提取结果，否则 raycast 命中的三角索引拿不到正确 cell。
      const surface = extractExternalSurface(ds);
      const triToCell: Uint32Array = surface.triToCell;

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

