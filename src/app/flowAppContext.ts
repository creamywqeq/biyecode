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
  /** 当前主变量名 */
  variable: string;
  /** 当前主变量值 */
  value: number;
  /** 全部变量在该位置的插值结果 */
  values: Record<string, number>;
  cellId: number;
};

/** 变量原始数值的 min/max */
export type VariableStats = Record<string, { min: number; max: number }>;

export type FlowAppState = {
  /** 当前数据集 */
  dataset: Ref<FlowDataset | null>;
  /** 当前用于云图/探针的标量名 */
  activeScalar: Ref<string>;
  /** 各物理量原始 min/max */
  variableStats: Ref<VariableStats>;
  /** 等值面提取所用变量（默认 Temperature） */
  isoVariable: Ref<string>;
  /** 图层显隐 */
  layerVisible: Ref<Record<LayerId, boolean>>;
  /** 探针点击查询记录列表（侧边栏表格数据） */
  probeRecords: Ref<ProbeRecord[]>;
  /** 云图阈值（原始物理量数值范围） */
  scalarThreshold: Ref<[number, number]>;
  /** 切片平面参数（世界坐标） */
  slicePlane: Ref<{ origin: [number, number, number]; normal: [number, number, number] }>;
  /** 切片轴向（X/Y/Z），用于一键切到坐标轴方向 */
  sliceAxis: Ref<"X" | "Y" | "Z" | "custom">;
  /** 等值面阈值（原始物理量数值） */
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
    variableStats: shallowRef<VariableStats>({}),
    isoVariable: shallowRef(""),
    layerVisible: shallowRef({ wireframe: true, scalar: true, slice: true, isosurface: true }),
    probeRecords: shallowRef<ProbeRecord[]>([]),
    scalarThreshold: shallowRef<[number, number]>([0, 1]),
    slicePlane: shallowRef({
      origin: [0, 0, 0],
      normal: [0, 0, 1],
    }),
    sliceAxis: shallowRef<"X" | "Y" | "Z" | "custom">("Z"),
    isosurfaceValue: shallowRef(0)
  };
}

