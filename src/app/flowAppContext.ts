import type { InjectionKey, Ref } from "vue";
import { shallowRef } from "vue";
import type { FlowDataset } from "../flow";
import type { FlowRenderer } from "../renderer/FlowRenderer";
import type { VtkSlicer } from "../algorithms/VtkSlicer";
import type { EventBus } from "../core/EventBus";
import type { ProbeEvents } from "../interaction/ProbeInteractor";

export type LayerId = "wireframe" | "scalar" | "slice" | "isosurface";

/** 探针点击查询记录（用于侧边栏表格） */
export type ProbeRecord = {
  id: number;
  x: number;
  y: number;
  z: number;
  variable: string;
  value: number;
  cellId: number;
};

export type FlowAppState = {
  /** 当前数据集 */
  dataset: Ref<FlowDataset | null>;
  /** 当前用于云图/探针的标量名 */
  activeScalar: Ref<string>;
  /** 图层显隐 */
  layerVisible: Ref<Record<LayerId, boolean>>;
  /** 探针点击查询记录列表（侧边栏表格数据） */
  probeRecords: Ref<ProbeRecord[]>;
  /** 云图阈值（0~1） */
  scalarThreshold01: Ref<[number, number]>;
  /** 切片平面参数（世界坐标） */
  slicePlane: Ref<{ origin: [number, number, number]; normal: [number, number, number] }>;
  /** 切片 Gizmo 模式：translate=平移 / rotate=旋转法线 */
  sliceGizmoMode: Ref<"translate" | "rotate">;
  /** 等值面阈值（用户输入） */
  isosurfaceValue: Ref<number>;
};

export type FlowAppServices = {
  renderer: FlowRenderer;
  slicer: VtkSlicer;
  bus: EventBus<ProbeEvents>;
  state: FlowAppState;
  /** 清空探针 3D 标签（与侧边栏清空联动） */
  clearProbeLabels: () => void;
};

export const FLOW_APP_KEY: InjectionKey<FlowAppServices> = Symbol("FLOW_APP");

/** 创建默认状态（由 Provider 调用） */
export function createDefaultFlowAppState(): FlowAppState {
  return {
    dataset: shallowRef(null),
    activeScalar: shallowRef(""),
    layerVisible: shallowRef({ wireframe: true, scalar: true, slice: true, isosurface: true }),
    probeRecords: shallowRef<ProbeRecord[]>([]),
    scalarThreshold01: shallowRef<[number, number]>([0, 1]),
    slicePlane: shallowRef({
      origin: [0, 0, 0],
      normal: [0, 0, 1],
    }),
    sliceGizmoMode: shallowRef<"translate" | "rotate">("translate"),
    isosurfaceValue: shallowRef(0.5),
  };
}

