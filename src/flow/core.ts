/**
 * Web端流场后处理系统 - Phase 1
 * 纯 TypeScript 数据模型 + Tecplot ASCII 解析（不含任何渲染/视图逻辑）
 *
 * 设计目标：
 * - 面向对象（OOP），高内聚低耦合
 * - 百万级节点可用：核心数据使用 TypedArray（Float32Array/Uint32Array）
 * - 支持 Tecplot ASCII .dat 的常见组合：
 *   - DATAPACKING=POINT（逐点写全变量）
 *   - DATAPACKING=BLOCK（按变量分块写）
 *   - ZONETYPE=FEBRICK（8节点六面体单元，后续可扩展）
 * - 将非结构化网格拓扑转换为图结构：邻接表（CSR：offsets + indices）
 */

/** 统一的变量存储类型：一个变量名对应一个长度为 nodeCount 的 Float32Array */
export type FlowVariables = Record<string, Float32Array>;

/** 节点集合：以 SoA 方式（xyz 交错存储）保存，提高缓存命中与传输效率 */
export class NodeSet {
  /** 交错坐标数组：coords = [x0,y0,z0, x1,y1,z1, ...] */
  public readonly coords: Float32Array;

  constructor(public readonly nodeCount: number, coords?: Float32Array) {
    if (coords) {
      if (coords.length !== nodeCount * 3) {
        throw new Error(
          `NodeSet: coords 长度应为 nodeCount*3（期望 ${nodeCount * 3}，实际 ${coords.length}）`,
        );
      }
      this.coords = coords;
    } else {
      this.coords = new Float32Array(nodeCount * 3);
    }
  }

  /** 获取第 i 个节点的坐标（返回临时对象；高频路径建议直接访问 coords） */
  getXYZ(i: number): { x: number; y: number; z: number } {
    const base = i * 3;
    return { x: this.coords[base], y: this.coords[base + 1], z: this.coords[base + 2] };
  }

  /** 设置第 i 个节点的坐标 */
  setXYZ(i: number, x: number, y: number, z: number): void {
    const base = i * 3;
    this.coords[base] = x;
    this.coords[base + 1] = y;
    this.coords[base + 2] = z;
  }
}

/** 单元类型：当前先实现 FEBRICK（8节点六面体） */
export type ElementType = "FEBRICK";

/** 单元集合：以固定节点数的连接数组存储拓扑（0-based node index） */
export class ElementSet {
  /** 每个单元节点数：FEBRICK=8 */
  public readonly nodesPerElement: number;
  /** 连接数组：connectivity = [n0..n7, n0..n7, ...]（长度=elementCount*nodesPerElement） */
  public readonly connectivity: Uint32Array;

  constructor(
    public readonly elementType: ElementType,
    public readonly elementCount: number,
    connectivity?: Uint32Array,
  ) {
    this.nodesPerElement = elementType === "FEBRICK" ? 8 : (() => {
      throw new Error(`ElementSet: 不支持的 elementType: ${elementType}`);
    })();

    const expected = elementCount * this.nodesPerElement;
    if (connectivity) {
      if (connectivity.length !== expected) {
        throw new Error(
          `ElementSet: connectivity 长度应为 elementCount*nodesPerElement（期望 ${expected}，实际 ${connectivity.length}）`,
        );
      }
      this.connectivity = connectivity;
    } else {
      this.connectivity = new Uint32Array(expected);
    }
  }

  /** 读取第 e 个单元的第 k 个顶点的节点编号（0-based） */
  nodeIndex(e: number, k: number): number {
    return this.connectivity[e * this.nodesPerElement + k];
  }
}

/**
 * CSR（Compressed Sparse Row）邻接表：
 * - offsets 长度 = nodeCount+1
 * - indices 长度 = offsets[nodeCount]（即总邻接边数）
 * - 第 i 个节点的邻接节点列表：indices[offsets[i] .. offsets[i+1])
 */
export class AdjacencyCSR {
  constructor(
    public readonly nodeCount: number,
    public readonly offsets: Uint32Array,
    public readonly indices: Uint32Array,
  ) {
    if (offsets.length !== nodeCount + 1) {
      throw new Error(
        `AdjacencyCSR: offsets 长度应为 nodeCount+1（期望 ${nodeCount + 1}，实际 ${offsets.length}）`,
      );
    }
    if (offsets[nodeCount] !== indices.length) {
      throw new Error(
        `AdjacencyCSR: offsets[nodeCount] 应等于 indices.length（期望 ${indices.length}，实际 ${offsets[nodeCount]}）`,
      );
    }
  }

  /** 遍历节点 i 的邻居（零拷贝视角：通过索引区间） */
  neighborRange(i: number): { start: number; end: number } {
    return { start: this.offsets[i], end: this.offsets[i + 1] };
  }
}

/** 核心数据集：包含几何（节点+单元）、物理量变量、以及可选的邻接图 */
export class FlowDataset {
  public variables: FlowVariables = {};
  public adjacency?: AdjacencyCSR;

  constructor(
    public readonly nodes: NodeSet,
    public readonly elements: ElementSet,
  ) {}

  /** 添加/替换一个节点变量（长度必须等于 nodeCount） */
  setVariable(name: string, values: Float32Array): void {
    if (values.length !== this.nodes.nodeCount) {
      throw new Error(
        `FlowDataset: 变量 ${name} 长度必须等于 nodeCount（期望 ${this.nodes.nodeCount}，实际 ${values.length}）`,
      );
    }
    this.variables[name] = values;
  }
}

/** 解析输入类型：浏览器的 File 或者已有的 ArrayBuffer */
export type ParserInput = File | ArrayBuffer;

/** 解析结果中需要的关键元数据 */
export interface ParseResult {
  dataset: FlowDataset;
  /** 变量名（来自 Tecplot Header 的 VARIABLES 列表） */
  variableNames: string[];
}

/** 解析策略接口：用于工厂模式下的不同格式解析实现 */
export interface IFlowParserStrategy {
  /** 是否能处理该输入（例如根据扩展名或 magic header） */
  canParse(input: ParserInput, hint?: { filename?: string }): boolean;
  /** 执行解析并返回数据集 */
  parse(input: ParserInput): Promise<ParseResult>;
}

/**
 * 解析器工厂：根据输入选择合适的策略
 * 当前仅内置 Tecplot ASCII（.dat/.plt 的 ASCII 变体常见命名为 .dat）
 */
export class DataParser {
  private static _strategies: IFlowParserStrategy[] | null = null;
  private static get strategies(): IFlowParserStrategy[] {
    if (!DataParser._strategies) {
      DataParser._strategies = [new TecplotASCIIPalette()];
    }
    return DataParser._strategies;
  }

  static async parse(input: ParserInput, hint?: { filename?: string }): Promise<ParseResult> {
    const strategy = DataParser.strategies.find((s) => s.canParse(input, hint));
    if (!strategy) {
      const name = hint?.filename ?? (input instanceof File ? input.name : "ArrayBuffer");
      throw new Error(`DataParser: 未找到可用解析策略：${name}`);
    }
    return strategy.parse(input);
  }
}

/**
 * Tecplot ASCII 解析实现（“Palette”表示一组规则/配方）
 *
 * 重点支持：
 * - VARIABLES = "X" "Y" "Z" "P" "U" "V" "W" ...
 * - ZONE N=... E=... DATAPACKING=POINT|BLOCK ZONETYPE=FEBRICK
 * - 数据区（POINT 或 BLOCK）
 * - 连接区（E 行，每行 8 个节点编号，Tecplot 通常为 1-based）
 */
export class TecplotASCIIPalette implements IFlowParserStrategy {
  canParse(input: ParserInput, hint?: { filename?: string }): boolean {
    const filename = hint?.filename ?? (input instanceof File ? input.name : "");
    // 经验规则：Tecplot ASCII 多为 .dat；这里不做强校验，避免误判导致无法解析
    return /\.dat$/i.test(filename) || /\.tec$/i.test(filename) || filename === "";
  }

  async parse(input: ParserInput): Promise<ParseResult> {
    const text = await this.readAsText(input);
    const ts = new AsciiTokenStream(text);

    // 1) 解析 Header：VARIABLES
    const variableNames = this.parseVariables(ts);
    if (variableNames.length < 3) {
      throw new Error(`TecplotASCII: VARIABLES 数量不足（至少应包含 X/Y/Z）`);
    }

    // 2) 解析 ZONE 元信息（本阶段假设只有一个 zone）
    const zone = this.parseZone(ts);
    if (zone.zonetype !== "FEBRICK") {
      throw new Error(`TecplotASCII: 当前仅实现 ZONETYPE=FEBRICK（实际 ${zone.zonetype}）`);
    }
    const nodeCount = zone.N;
    const elementCount = zone.E;
    const varCount = variableNames.length;

    // 3) 准备 TypedArray 容器
    const nodes = new NodeSet(nodeCount);
    const elements = new ElementSet("FEBRICK", elementCount);

    // 变量数组：除去前三个坐标变量，其余都按节点存一份
    const variables: FlowVariables = {};
    for (let i = 3; i < varCount; i++) {
      variables[variableNames[i]] = new Float32Array(nodeCount);
    }

    // 4) 解析数据区（POINT 或 BLOCK）
    if (zone.datapacking === "POINT") {
      this.readPointData(ts, variableNames, nodes, variables);
    } else {
      this.readBlockData(ts, variableNames, nodes, variables);
    }

    // 5) 解析连接区（FEBRICK：每个单元 8 个节点编号）
    this.readConnectivityFEBRICK(ts, elements);

    // 6) 构建数据集
    const dataset = new FlowDataset(nodes, elements);
    dataset.variables = variables;

    // 7) 拓扑 -> 图（邻接表，CSR）
    dataset.adjacency = buildAdjacencyFromFEBRICK(elements, nodeCount, true);

    return { dataset, variableNames };
  }

  private async readAsText(input: ParserInput): Promise<string> {
    if (input instanceof File) {
      return input.text();
    }
    // ArrayBuffer：用 UTF-8 解码。实际工程中可根据 BOM/编码做更健壮处理。
    return new TextDecoder("utf-8").decode(input);
  }

  /**
   * 解析 VARIABLES 列表。Tecplot 常见格式：
   * VARIABLES = "X" "Y" "Z" "P" "U" "V" "W"
   *
   * 说明：
   * - 我们用 token 流读取：遇到 VARIABLES 后，读取 '='，然后连续读取若干字符串 token
   * - 当遇到 'ZONE' 或文件结束时停止
   */
  private parseVariables(ts: AsciiTokenStream): string[] {
    // 跳过 TITLE 等无关 token，直到找到 VARIABLES
    while (!ts.eof()) {
      const t = ts.peekUpper();
      if (t === "VARIABLES") break;
      ts.next();
    }
    if (ts.eof()) throw new Error(`TecplotASCII: 未找到 VARIABLES`);
    ts.expectUpper("VARIABLES");
    ts.consumeOptional("="); // VARIABLES = ...

    const vars: string[] = [];
    while (!ts.eof()) {
      const next = ts.peekUpper();
      if (next === "ZONE") break;
      // 允许逗号分隔：VARIABLES="X","Y","Z"
      const tok = ts.next();
      if (tok === "," || tok === "") continue;
      if (tok === "=") continue;
      // token 流已经去掉了引号，因此直接使用
      // 同时过滤掉可能出现的换行符（token 流不会返回）
      if (tok.length > 0) vars.push(tok);
    }
    return vars;
  }

  /**
   * 解析 ZONE 行关键字段：
   * ZONE N=..., E=..., DATAPACKING=POINT|BLOCK, ZONETYPE=FEBRICK
   */
  private parseZone(ts: AsciiTokenStream): {
    N: number;
    E: number;
    datapacking: "POINT" | "BLOCK";
    zonetype: ElementType;
  } {
    // 找到 ZONE
    while (!ts.eof()) {
      const t = ts.peekUpper();
      if (t === "ZONE") break;
      ts.next();
    }
    if (ts.eof()) throw new Error(`TecplotASCII: 未找到 ZONE`);
    ts.expectUpper("ZONE");

    let N = -1;
    let E = -1;
    let datapacking: "POINT" | "BLOCK" = "POINT";
    let zonetype: ElementType = "FEBRICK";

    // ZONE 后面是若干 key=value，直到开始读到数据区（通常是数字）
    // 我们采用：只要下一个 token 看起来像 key（字母/下划线开头），就继续解析；否则停止
    while (!ts.eof()) {
      const tok = ts.peek();
      if (!tok) break;
      if (!isLikelyKeyToken(tok)) break;

      const key = ts.nextUpper();
      ts.consumeOptional("="); // 允许 "N = 100" 或 "N=100"

      if (key === "N") {
        N = ts.nextInt();
      } else if (key === "E") {
        E = ts.nextInt();
      } else if (key === "DATAPACKING") {
        const v = ts.nextUpper();
        if (v !== "POINT" && v !== "BLOCK") {
          throw new Error(`TecplotASCII: 不支持 DATAPACKING=${v}`);
        }
        datapacking = v;
      } else if (key === "ZONETYPE") {
        const v = ts.nextUpper();
        if (v !== "FEBRICK") {
          throw new Error(`TecplotASCII: 不支持 ZONETYPE=${v}`);
        }
        zonetype = v;
      } else if (key === "F") {
        // 兼容老写法：F=FEPOINT/FEBrick... 这里仅取 FEBRICK
        const v = ts.nextUpper();
        if (v === "FEBRICK") zonetype = "FEBRICK";
        // 其他类型先忽略，交由后续 zonetype 校验报错
      } else {
        // 其他字段（T、VARLOCATION 等）暂不处理：读一个 token 作为值并丢弃
        // Tecplot 的 value 可能是字符串或数字或列表；这里采取保守策略：仅丢弃一个 token，
        // 避免把后面的数据区整体吞掉。真实工程可做更完整的 zone 语法支持。
        ts.next();
      }

      // 允许 key/value 后面跟逗号
      ts.consumeOptional(",");
    }

    if (N <= 0 || E < 0) {
      throw new Error(`TecplotASCII: ZONE 缺少必要字段 N/E（解析得到 N=${N}, E=${E}）`);
    }

    return { N, E, datapacking, zonetype };
  }

  /** POINT：每个节点一行/一组，包含所有变量：X Y Z P U V ... */
  private readPointData(
    ts: AsciiTokenStream,
    variableNames: string[],
    nodes: NodeSet,
    variables: FlowVariables,
  ): void {
    const n = nodes.nodeCount;
    const varCount = variableNames.length;
    for (let i = 0; i < n; i++) {
      // 坐标（默认前三个变量为 X/Y/Z）
      const x = ts.nextFloat();
      const y = ts.nextFloat();
      const z = ts.nextFloat();
      nodes.setXYZ(i, x, y, z);

      // 其余变量
      for (let v = 3; v < varCount; v++) {
        const name = variableNames[v];
        variables[name][i] = ts.nextFloat();
      }
    }
  }

  /**
   * BLOCK：按变量分块，每个变量连续写 N 个值。
   * 常见顺序与 VARIABLES 一致：先 X 的 N 个值，再 Y，再 Z，再 P...
   */
  private readBlockData(
    ts: AsciiTokenStream,
    variableNames: string[],
    nodes: NodeSet,
    variables: FlowVariables,
  ): void {
    const n = nodes.nodeCount;
    const varCount = variableNames.length;

    // 读取 X/Y/Z 三个块
    for (let i = 0; i < n; i++) nodes.coords[i * 3] = ts.nextFloat(); // X
    for (let i = 0; i < n; i++) nodes.coords[i * 3 + 1] = ts.nextFloat(); // Y
    for (let i = 0; i < n; i++) nodes.coords[i * 3 + 2] = ts.nextFloat(); // Z

    // 读取其余变量块
    for (let v = 3; v < varCount; v++) {
      const name = variableNames[v];
      const arr = variables[name];
      for (let i = 0; i < n; i++) arr[i] = ts.nextFloat();
    }
  }

  /** FEBRICK：每个单元 8 个节点编号，Tecplot 通常为 1-based，需要转为 0-based */
  private readConnectivityFEBRICK(ts: AsciiTokenStream, elements: ElementSet): void {
    const eCount = elements.elementCount;
    const per = elements.nodesPerElement; // 8
    const conn = elements.connectivity;
    for (let e = 0; e < eCount; e++) {
      const base = e * per;
      for (let k = 0; k < per; k++) {
        const idx1 = ts.nextInt();
        // Tecplot 连接通常从 1 开始
        conn[base + k] = (idx1 - 1) >>> 0;
      }
    }
  }
}

/**
 * 数据归一化：用于后续 colormap（0~1）映射
 * 注意：此处只负责数值层处理，不绑定任何渲染/色带实现。
 */
export class DataNormalizer {
  /** 计算最小值/最大值（忽略 NaN/±Infinity） */
  static minMax(values: ArrayLike<number>): { min: number; max: number } {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`DataNormalizer: 输入数组不包含有效有限数值`);
    }
    return { min, max };
  }

  /**
   * 归一化到 0~1：
   * - 默认进行 clamp，防止少量异常值导致颜色溢出
   * - 当 max==min 时返回全 0（也可按需要改为全 0.5）
   */
  static normalizeTo01(
    values: Float32Array,
    min: number,
    max: number,
    out?: Float32Array,
    clamp = true,
  ): Float32Array {
    const n = values.length;
    const result = out ?? new Float32Array(n);
    const span = max - min;
    if (!Number.isFinite(span) || span === 0) {
      result.fill(0);
      return result;
    }
    for (let i = 0; i < n; i++) {
      const v = values[i];
      let t = (v - min) / span;
      if (clamp) {
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      result[i] = t;
    }
    return result;
  }
}

// -----------------------------
// 邻接表构建（FEBRICK -> CSR）
// -----------------------------

/**
 * FEBRICK 六面体的 12 条边（按局部顶点编号 0..7）
 * 参考常见 hexahedron 连接：
 * 0-1-2-3 为底面，4-5-6-7 为顶面，0-4,1-5,2-6,3-7 为竖边
 */
const FEBRICK_EDGES: ReadonlyArray<readonly [number, number]> = [
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

/**
 * 从 FEBRICK 单元拓扑构建无向邻接表（CSR）。
 *
 * 实现策略（兼顾性能与可控内存）：
 * - 对每个单元写入 12 条边（无向 -> 24 条有向边）
 * - 先统计每个节点的度数（degree）
 * - prefix-sum 得到 offsets
 * - 二次遍历将邻居写入 indices
 * - 可选：对每个节点的邻居列表排序并去重（避免同边被多个单元重复产生）
 */
export function buildAdjacencyFromFEBRICK(
  elements: ElementSet,
  nodeCount: number,
  deduplicatePerNode: boolean,
): AdjacencyCSR {
  const eCount = elements.elementCount;
  const per = elements.nodesPerElement; // 8
  if (per !== 8) throw new Error(`buildAdjacencyFromFEBRICK: 仅支持 8 节点单元`);

  // 1) 预估边数量：每个单元 12 条边，无向 -> 24 条有向边
  const directedEdgesPerElement = FEBRICK_EDGES.length * 2; // 24
  const directedEdgeTotal = eCount * directedEdgesPerElement;

  // from/to 使用 Uint32Array，避免 number[] 的额外装箱开销
  const from = new Uint32Array(directedEdgeTotal);
  const to = new Uint32Array(directedEdgeTotal);

  // 2) 写入边表
  const conn = elements.connectivity;
  let p = 0;
  for (let e = 0; e < eCount; e++) {
    const base = e * per;
    for (let i = 0; i < FEBRICK_EDGES.length; i++) {
      const [aLocal, bLocal] = FEBRICK_EDGES[i];
      const a = conn[base + aLocal];
      const b = conn[base + bLocal];
      // a->b
      from[p] = a;
      to[p] = b;
      p++;
      // b->a
      from[p] = b;
      to[p] = a;
      p++;
    }
  }

  // 3) degree 统计
  const degree = new Uint32Array(nodeCount);
  for (let i = 0; i < directedEdgeTotal; i++) {
    const u = from[i];
    // 防御：输入拓扑若越界，直接报错（避免内存越界写）
    if (u >= nodeCount) throw new Error(`Adjacency: 节点编号越界 u=${u} >= ${nodeCount}`);
    degree[u]++;
  }

  // 4) prefix sum -> offsets
  const offsets = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i] + degree[i];
  const total = offsets[nodeCount];
  const indices = new Uint32Array(total);

  // 5) scatter 写入 indices（用 cursor 记录每行已写入的位置）
  const cursor = offsets.slice(); // Uint32Array 拷贝：作为可变游标
  for (let i = 0; i < directedEdgeTotal; i++) {
    const u = from[i];
    const v = to[i];
    const pos = cursor[u]++;
    indices[pos] = v;
  }

  // 6) per-node 排序与去重（可选）
  if (deduplicatePerNode) {
    // 注意：对每个节点都 sort 可能较重，但这是构建一次、后续多次查询的典型 trade-off
    // 若数据极大且对去重要求不高，可关闭 deduplicatePerNode 以节省时间。
    let writeBase = 0;
    const newOffsets = new Uint32Array(nodeCount + 1);

    for (let u = 0; u < nodeCount; u++) {
      const start = offsets[u];
      const end = offsets[u + 1];
      const len = end - start;
      if (len === 0) {
        newOffsets[u + 1] = writeBase;
        continue;
      }

      // 将邻居拷贝到普通数组排序（TypedArray 的 subarray 不能直接用数值比较排序）
      const tmp = new Array<number>(len);
      for (let i = 0; i < len; i++) tmp[i] = indices[start + i];
      tmp.sort((a, b) => a - b);

      // unique 写回（避免自环：u->u）
      let last = -1;
      for (let i = 0; i < len; i++) {
        const v = tmp[i];
        if (v === u) continue;
        if (v === last) continue;
        indices[writeBase++] = v;
        last = v;
      }
      newOffsets[u + 1] = writeBase;
    }

    // 生成紧凑 indices（截断未使用尾部）
    const compact = indices.subarray(0, writeBase);
    return new AdjacencyCSR(nodeCount, newOffsets, new Uint32Array(compact));
  }

  return new AdjacencyCSR(nodeCount, offsets, indices);
}

// -----------------------------
// ASCII TokenStream：用于高效读取 Tecplot ASCII
// -----------------------------

/**
 * 一个非常轻量的 ASCII token 流：
 * - 支持引号字符串："Pressure"
 * - 支持跳过注释：以 # 开头直到行尾（常见于一些导出工具）
 * - 兼容 key=value、逗号分隔、换行/空白分隔
 *
 * 说明：这不是完整 Tecplot 语法解析器，但覆盖工程中最常见的数据文件形态。
 */
class AsciiTokenStream {
  private i = 0;
  private cached: string | null = null;

  constructor(private readonly text: string) {}

  eof(): boolean {
    this.skipWsAndComments();
    return this.i >= this.text.length;
  }

  peek(): string {
    if (this.cached !== null) return this.cached;
    this.cached = this.readToken();
    return this.cached;
  }

  peekUpper(): string {
    return this.peek().toUpperCase();
  }

  next(): string {
    const t = this.peek();
    this.cached = null;
    return t;
  }

  nextUpper(): string {
    return this.next().toUpperCase();
  }

  expectUpper(expected: string): void {
    const v = this.nextUpper();
    if (v !== expected) throw new Error(`TecplotASCII: 期望 ${expected}，实际 ${v}`);
  }

  consumeOptional(token: string): boolean {
    if (this.peek() === token) {
      this.next();
      return true;
    }
    return false;
  }

  nextInt(): number {
    const t = this.next();
    const v = Number.parseInt(t, 10);
    if (!Number.isFinite(v)) throw new Error(`TecplotASCII: 无法解析整数：${t}`);
    return v;
  }

  nextFloat(): number {
    const t = this.next();
    // Tecplot ASCII 常出现科学计数法 1.23E-4
    const v = Number.parseFloat(t);
    if (!Number.isFinite(v)) throw new Error(`TecplotASCII: 无法解析浮点数：${t}`);
    return v;
  }

  private skipWsAndComments(): void {
    const s = this.text;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      // 空白：space/tab/newline
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        this.i++;
        continue;
      }
      // 注释：# ... \n
      if (s[this.i] === "#") {
        this.i++;
        while (this.i < s.length && s.charCodeAt(this.i) !== 10) this.i++;
        continue;
      }
      break;
    }
  }

  private readToken(): string {
    this.skipWsAndComments();
    const s = this.text;
    if (this.i >= s.length) return "";

    const ch = s[this.i];
    // 单字符分隔符单独作为 token 返回，便于解析 key=value / 逗号
    if (ch === "=" || ch === "," || ch === "(" || ch === ")") {
      this.i++;
      return ch;
    }

    // 引号字符串
    if (ch === "\"") {
      this.i++;
      const start = this.i;
      while (this.i < s.length && s[this.i] !== "\"") this.i++;
      const str = s.slice(start, this.i);
      if (this.i < s.length && s[this.i] === "\"") this.i++;
      return str;
    }

    // 普通 token：直到空白或分隔符
    const start = this.i;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") break;
      if (c === "=" || c === "," || c === "(" || c === ")") break;
      if (c === "#") break; // 行内注释前截断
      this.i++;
    }
    return s.slice(start, this.i);
  }
}

function isLikelyKeyToken(tok: string): boolean {
  if (!tok) return false;
  const c = tok.charCodeAt(0);
  const isAZ = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  return isAZ || tok[0] === "_";
}

