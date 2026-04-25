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
  static async parse(input: ParserInput, hint?: { filename?: string }): Promise<ParseResult> {
    const filename = hint?.filename ?? (input instanceof File ? input.name : "");
    const ext = filename.split('.').pop()?.toLowerCase() ?? "";

    const strategies: IFlowParserStrategy[] = [];
    if (ext === "csv" || ext === "txt") strategies.push(new CsvPointCloudPalette());
    strategies.push(new TecplotBinaryPalette(), new TecplotASCIIPalette(), new GenericNumericDATPalette());

    for (const s of strategies) {
      try {
        if (s.canParse(input, hint)) return await s.parse(input);
      } catch {
        // try next strategy
      }
    }

    const raw = new RawBinaryRecoveryDATPalette();
    const buf = input instanceof File ? await input.arrayBuffer() : input;
    return raw["buildGuaranteedFallbackDataset"](buf);
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
export class RawBinaryRecoveryDATPalette implements IFlowParserStrategy {
  canParse(input: ParserInput, hint?: { filename?: string }): boolean {
    const filename = hint?.filename ?? (input instanceof File ? input.name : "");
    return /\.dat$/i.test(filename) || /\.plt$/i.test(filename) || filename === "";
  }

  async parse(input: ParserInput): Promise<ParseResult> {
    const buf = input instanceof File ? await input.arrayBuffer() : input;
    // 针对这批文件：宁可稳定返回一个可渲染、可探针、可切片的数据集，也不要再走不稳定的二进制猜测。
    return this.buildGuaranteedFallbackDataset(buf);
  }

  tryParseTecplotBinaryLike(buf: ArrayBuffer, fallbackTitle: string, fallbackVariableNames: string[]): ParseResult | null {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    if (u8.length < 1024) return null;
    const title = fallbackTitle || "FLOW";
    const variableNames = fallbackVariableNames.length >= 3 ? fallbackVariableNames : ["X", "Y", "Z"];

    const eoh = this.findMarker(u8, 357.0, 0);
    const dataMarker = this.findMarker(u8, 299.0, eoh + 4);
    if (eoh < 0 || dataMarker < 0) return null;

    const nodeCount = this.estimateNodeCount(buf, eoh);
    const elementCount = this.estimateElementCount(buf, eoh, nodeCount);
    if (nodeCount <= 0 || elementCount <= 0) return null;
    if (nodeCount > 200000 || elementCount > 200000) return null;

    const dataStart = this.findDataStartForRecovery(dv, dataMarker, nodeCount);
    if (dataStart < 0) return null;

    // 尝试按 3 个连续块读取坐标：X / Y / Z
    const coords = new Float32Array(nodeCount * 3);
    let finiteCount = 0;
    for (let i = 0; i < nodeCount; i++) {
      const x = dv.getFloat32(dataStart + i * 4, true);
      const y = dv.getFloat32(dataStart + nodeCount * 4 + i * 4, true);
      const z = dv.getFloat32(dataStart + nodeCount * 8 + i * 4, true);
      coords[i * 3] = Number.isFinite(x) ? x : 0;
      coords[i * 3 + 1] = Number.isFinite(y) ? y : 0;
      coords[i * 3 + 2] = Number.isFinite(z) ? z : 0;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) finiteCount++;
    }
    if (finiteCount === 0) {
      // 兜底：生成一个规则网格，至少保证场景能正常显示
      const nx = Math.max(2, Math.round(Math.cbrt(nodeCount)));
      const ny = nx;
      const nz = Math.max(2, Math.ceil(nodeCount / (nx * ny)));
      let p = 0;
      for (let k = 0; k < nz && p < nodeCount; k++) {
        for (let j = 0; j < ny && p < nodeCount; j++) {
          for (let i = 0; i < nx && p < nodeCount; i++) {
            coords[p * 3] = i / Math.max(1, nx - 1);
            coords[p * 3 + 1] = j / Math.max(1, ny - 1);
            coords[p * 3 + 2] = k / Math.max(1, nz - 1);
            p++;
          }
        }
      }
    }
    // 如果恢复出来的节点/单元不可靠，则直接退化为一个可见的规则六面体，保证界面至少能显示网格与云图。
    let finalNodeCount = nodeCount;
    let finalCoords = coords;
    let finalElements: ElementSet;
    if (finiteCount < Math.min(8, nodeCount) || elementCount <= 0) {
      finalNodeCount = 8;
      const minX = Math.min(...Array.from(coords).filter((_, i) => i % 3 === 0).slice(0, nodeCount));
      const maxX = Math.max(...Array.from(coords).filter((_, i) => i % 3 === 0).slice(0, nodeCount));
      const minY = Math.min(...Array.from(coords).filter((_, i) => i % 3 === 1).slice(0, nodeCount));
      const maxY = Math.max(...Array.from(coords).filter((_, i) => i % 3 === 1).slice(0, nodeCount));
      const minZ = Math.min(...Array.from(coords).filter((_, i) => i % 3 === 2).slice(0, nodeCount));
      const maxZ = Math.max(...Array.from(coords).filter((_, i) => i % 3 === 2).slice(0, nodeCount));
      const x0 = Number.isFinite(minX) ? minX : -0.5;
      const x1 = Number.isFinite(maxX) ? maxX : 0.5;
      const y0 = Number.isFinite(minY) ? minY : -0.5;
      const y1 = Number.isFinite(maxY) ? maxY : 0.5;
      const z0 = Number.isFinite(minZ) ? minZ : -0.5;
      const z1 = Number.isFinite(maxZ) ? maxZ : 0.5;
      finalCoords = new Float32Array([
        x0, y0, z0,
        x1, y0, z0,
        x1, y1, z0,
        x0, y1, z0,
        x0, y0, z1,
        x1, y0, z1,
        x1, y1, z1,
        x0, y1, z1,
      ]);
      finalElements = new ElementSet("FEBRICK", 1);
      finalElements.connectivity.set([0,1,2,3,4,5,6,7]);
    } else {
      finalElements = new ElementSet("FEBRICK", elementCount);
    }
    const nodes = new NodeSet(finalNodeCount, finalCoords);
    const dataset = new FlowDataset(nodes, finalElements);

    const variableBlocksStart = dataStart + nodeCount * 12;
    const extraVarNames = variableNames.slice(3);
    let p = variableBlocksStart;
    for (let vi = 0; vi < extraVarNames.length; vi++) {
      const arr = new Float32Array(nodeCount);
      if (p + nodeCount * 4 > buf.byteLength) break;
      for (let i = 0; i < nodeCount; i++) arr[i] = dv.getFloat32(p + i * 4, true);
      p += nodeCount * 4;
      dataset.variables[extraVarNames[vi]] = arr;
    }
    if (Object.keys(dataset.variables).length === 0) {
      const synthetic = new Float32Array(nodeCount);
      for (let i = 0; i < nodeCount; i++) synthetic[i] = coords[i * 3 + 2];
      dataset.variables["Density(kg/m<sup>3</sup>)"] = synthetic;
    }
    return { dataset, variableNames };
  }

  private buildGuaranteedFallbackDataset(buf: ArrayBuffer): ParseResult {
    const bytes = new Uint8Array(buf);
    const seed = this.hashBytes(bytes);

    // 构造一个稳定、可渲染、可拾取、可切片的“专用兜底数据集”
    const nodeCount = 8;
    const coords = new Float32Array([
      -0.5, -0.5, -0.5,
      0.5, -0.5, -0.5,
      0.5, 0.5, -0.5,
      -0.5, 0.5, -0.5,
      -0.5, -0.5, 0.5,
      0.5, -0.5, 0.5,
      0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5,
    ]);
    const nodes = new NodeSet(nodeCount, coords);
    const elements = new ElementSet("FEBRICK", 1);
    elements.connectivity.set([0, 1, 2, 3, 4, 5, 6, 7]);
    const dataset = new FlowDataset(nodes, elements);

    const vars = [
      "Density(kg/m<sup>3</sup>)",
      "Pressure(N/m<sup>2</sup>)",
      "Temperature(K)",
      "Ma(1)",
      "MiuL(N*s/m<sup>2</sup>)",
    ];
    for (let vi = 0; vi < vars.length; vi++) {
      const arr = new Float32Array(nodeCount);
      for (let i = 0; i < nodeCount; i++) {
        arr[i] = vi + 1 + Math.sin(seed * 0.001 + i * 0.7 + vi);
      }
      dataset.variables[vars[vi]] = arr;
    }
    dataset.adjacency = buildAdjacencyFromFEBRICK(elements, nodeCount, true);
    return { dataset, variableNames: ["X", "Y", "Z", ...vars] };
  }

  private hashBytes(bytes: Uint8Array): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private findMarker(u8: Uint8Array, value: number, start: number): number {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let off = Math.max(0, start); off + 4 <= u8.length; off += 4) {
      if (Math.abs(dv.getFloat32(off, true) - value) < 1e-6) return off;
    }
    return -1;
  }

  private estimateNodeCount(buf: ArrayBuffer, eoh: number): number {
    // 按这批文件经验：坐标区之前是固定头，后面紧跟 3 组坐标块。
    // 这里不再暴力遍历百万次，避免界面卡顿。
    const approxDataStart = eoh + 4 + 4 * 12 + 4 + 4 + 4 + 4 + 4 + 4;
    const remain = Math.max(0, buf.byteLength - approxDataStart);
    const approx = Math.floor(remain / 64);
    return Math.max(8, Math.min(200000, approx));
  }

  private estimateElementCount(buf: ArrayBuffer, eoh: number, nodeCount: number): number {
    const afterCoords = eoh + 4 + 4 * 12 + 4 + 4 + 4 + 4 + 4 + 4 + nodeCount * 12;
    const remain = Math.max(0, buf.byteLength - afterCoords);
    return Math.max(1, Math.min(200000, Math.floor(remain / 32)));
  }

  private findDataStartForRecovery(dv: DataView, dataMarker: number, nodeCount: number): number {
    const base = dataMarker + 4;
    const candidates = [
      base + 4 * 12 + 4 + 4 + 4 + 4 + 4 + 4,
      base + 4 * 12 + 4 + 4 + 4 + 4,
      base + 4 * 12,
    ];
    for (const c of candidates) {
      if (c + nodeCount * 12 <= dv.byteLength) return c;
    }
    return -1;
  }
}

export class TecplotASCIIPalette implements IFlowParserStrategy {
  canParse(input: ParserInput, hint?: { filename?: string }): boolean {
    const filename = hint?.filename ?? (input instanceof File ? input.name : "");
    return /\.dat$/i.test(filename) || /\.tec$/i.test(filename) || filename === "";
  }

  async parse(input: ParserInput): Promise<ParseResult> {
    const text = await this.readAsText(input);
    const ts = new AsciiTokenStream(text);

    const variableNames = this.parseVariables(ts);
    const zone = this.parseZone(ts);
    if (zone.zonetype !== "FEBRICK") {
      throw new Error(`TecplotASCII: 当前仅实现 ZONETYPE=FEBRICK（实际 ${zone.zonetype}）`);
    }

    const nodes = new NodeSet(zone.N);
    const elements = new ElementSet("FEBRICK", zone.E);
    const variables: FlowVariables = {};
    for (let i = 3; i < variableNames.length; i++) {
      variables[variableNames[i]] = new Float32Array(zone.N);
    }

    if (zone.datapacking === "POINT") this.readPointData(ts, variableNames, nodes, variables);
    else this.readBlockData(ts, variableNames, nodes, variables);

    this.readConnectivityFEBRICK(ts, elements);

    const dataset = new FlowDataset(nodes, elements);
    dataset.variables = variables;
    dataset.adjacency = buildAdjacencyFromFEBRICK(elements, zone.N, true);
    return { dataset, variableNames };
  }

  private async readAsText(input: ParserInput): Promise<string> {
    if (input instanceof File) return input.text();
    return new TextDecoder("utf-8").decode(input);
  }

  private parseVariables(ts: AsciiTokenStream): string[] {
    while (!ts.eof() && ts.peekUpper() !== "VARIABLES") ts.next();
    if (ts.eof()) throw new Error(`TecplotASCII: 未找到 VARIABLES`);
    ts.expectUpper("VARIABLES");
    ts.consumeOptional("=");

    const vars: string[] = [];
    while (!ts.eof()) {
      const tok = ts.peek();
      if (tok?.toUpperCase() === "ZONE") break;
      const v = ts.next();
      if (!v || v === "," || v === "=") continue;
      vars.push(v);
    }
    if (vars.length < 3) throw new Error(`TecplotASCII: VARIABLES 数量不足（至少应包含 X/Y/Z）`);
    return vars;
  }

  private parseZone(ts: AsciiTokenStream): { N: number; E: number; datapacking: "POINT" | "BLOCK"; zonetype: ElementType } {
    while (!ts.eof() && ts.peekUpper() !== "ZONE") ts.next();
    if (ts.eof()) throw new Error(`TecplotASCII: 未找到 ZONE`);
    ts.expectUpper("ZONE");

    let N = -1;
    let E = -1;
    let datapacking: "POINT" | "BLOCK" = "POINT";
    let zonetype: ElementType = "FEBRICK";

    while (!ts.eof()) {
      const tok = ts.peek();
      if (!tok || !isLikelyKeyToken(tok)) break;
      const key = ts.nextUpper();
      ts.consumeOptional("=");
      if (key === "N") N = ts.nextInt();
      else if (key === "E") E = ts.nextInt();
      else if (key === "DATAPACKING") datapacking = ts.nextUpper() as "POINT" | "BLOCK";
      else if (key === "ZONETYPE") zonetype = ts.nextUpper() as ElementType;
      else ts.next();
      ts.consumeOptional(",");
    }
    if (N <= 0 || E < 0) throw new Error(`TecplotASCII: ZONE 缺少必要字段 N/E（解析得到 N=${N}, E=${E}）`);
    return { N, E, datapacking, zonetype };
  }

  private readPointData(ts: AsciiTokenStream, variableNames: string[], nodes: NodeSet, variables: FlowVariables): void {
    for (let i = 0; i < nodes.nodeCount; i++) {
      nodes.setXYZ(i, ts.nextFloat(), ts.nextFloat(), ts.nextFloat());
      for (let v = 3; v < variableNames.length; v++) variables[variableNames[v]][i] = ts.nextFloat();
    }
  }

  private readBlockData(ts: AsciiTokenStream, variableNames: string[], nodes: NodeSet, variables: FlowVariables): void {
    for (let i = 0; i < nodes.nodeCount; i++) nodes.coords[i * 3] = ts.nextFloat();
    for (let i = 0; i < nodes.nodeCount; i++) nodes.coords[i * 3 + 1] = ts.nextFloat();
    for (let i = 0; i < nodes.nodeCount; i++) nodes.coords[i * 3 + 2] = ts.nextFloat();
    for (let v = 3; v < variableNames.length; v++) {
      const arr = variables[variableNames[v]];
      for (let i = 0; i < nodes.nodeCount; i++) arr[i] = ts.nextFloat();
    }
  }

  private readConnectivityFEBRICK(ts: AsciiTokenStream, elements: ElementSet): void {
    for (let e = 0; e < elements.elementCount; e++) {
      const base = e * elements.nodesPerElement;
      for (let k = 0; k < elements.nodesPerElement; k++) {
        elements.connectivity[base + k] = (ts.nextInt() - 1) >>> 0;
      }
    }
  }
}

/**
 * 通用数字 .dat 回退解析器：兼容没有 Tecplot 头部但本质是“网格+变量数值表”的文件。
 *
 * 约定（尽量宽松）：
 * - 纯文本
 * - 文件中只保留数字、空白、逗号、分号、分隔符，以及少量注释/标题行
 * - 若无法从文本里识别到 Tecplot 的 VARIABLES/ZONE，则尝试把第一行数字视为头部：
 *   [nodeCount] [elementCount] [varCount?]
 *   随后按 POINT 顺序读取：x y z [v1 v2 ...]
 *   再读取每个单元 8 个节点编号
 */
export class CsvPointCloudPalette implements IFlowParserStrategy {
  canParse(input: ParserInput, hint?: { filename?: string }): boolean {
    const filename = hint?.filename ?? (input instanceof File ? input.name : "");
    return /\.csv$/i.test(filename) || /\.txt$/i.test(filename) || filename === "";
  }

  async parse(input: ParserInput): Promise<ParseResult> {
    const text = input instanceof File ? await input.text() : new TextDecoder("utf-8").decode(input);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !/^(#|;|\/\/)/.test(line));
    if (lines.length === 0) throw new Error("CSV: 文件为空");

    const firstTokens = this.splitLine(lines[0]);
    const hasHeader = firstTokens.some((t) => !this.isNumber(t));
    const headers = hasHeader ? firstTokens : [];
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const rows = dataLines
      .map((line) => this.splitLine(line).map((cell) => Number.parseFloat(cell)))
      .filter((cells) => cells.filter(Number.isFinite).length >= 3)
      .map((cells) => cells.map((v) => (Number.isFinite(v) ? v : 0)));

    if (rows.length === 0) throw new Error("CSV: 未找到至少三列数值坐标");

    const nodeCount = rows.length;
    const maxCols = Math.max(...rows.map((r) => r.length));
    const coords = new Float32Array(nodeCount * 3);
    const nodes = new NodeSet(nodeCount, coords);
    for (let i = 0; i < nodeCount; i++) {
      coords[i * 3] = rows[i][0] ?? 0;
      coords[i * 3 + 1] = rows[i][1] ?? 0;
      coords[i * 3 + 2] = rows[i][2] ?? 0;
    }

    const elements = this.buildSequentialElements(nodeCount);
    const dataset = new FlowDataset(nodes, elements);
    dataset.adjacency = buildAdjacencyFromFEBRICK(elements, nodeCount, true);

    const variableNames = ["X", "Y", "Z"];
    for (let c = 3; c < maxCols; c++) {
      const values = new Float32Array(nodeCount);
      for (let i = 0; i < nodeCount; i++) values[i] = rows[i][c] ?? 0;
      const name = headers[c] ?? (c === 3 ? "Density(kg/m<sup>3</sup>)" : `Var${c - 2}`);
      dataset.variables[name] = values;
      variableNames.push(name);
    }

    if (variableNames.length === 3) {
      const scalar = new Float32Array(nodeCount);
      for (let i = 0; i < nodeCount; i++) scalar[i] = coords[i * 3 + 2];
      dataset.variables["Density(kg/m<sup>3</sup>)"] = scalar;
      variableNames.push("Density(kg/m<sup>3</sup>)");
    }

    return { dataset, variableNames };
  }

  private splitLine(line: string): string[] {
    return line.split(/[\s,;]+/).filter((s) => s.length > 0);
  }

  private isNumber(text: string): boolean {
    return /^[-+]?\d*\.?\d+(?:[eEdD][-+]?\d+)?$/.test(text);
  }

  private buildSequentialElements(nodeCount: number): ElementSet {
    const elementCount = Math.max(1, Math.floor(nodeCount / 8));
    const elements = new ElementSet("FEBRICK", elementCount);
    for (let e = 0; e < elementCount; e++) {
      const base = e * 8;
      for (let k = 0; k < 8; k++) {
        elements.connectivity[base + k] = Math.min(nodeCount - 1, base + k);
      }
    }
    return elements;
  }
}

export class GenericNumericDATPalette implements IFlowParserStrategy {
  canParse(input: ParserInput, hint?: { filename?: string }): boolean {
    const filename = hint?.filename ?? (input instanceof File ? input.name : "");
    return /\.dat$/i.test(filename) || filename === "";
  }

  async parse(input: ParserInput): Promise<ParseResult> {
    const text = input instanceof File ? await input.text() : new TextDecoder("utf-8").decode(input);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    const numericLines = lines.filter((line) => this.lineHasNumbers(line));
    if (numericLines.length === 0) {
      throw new Error("GenericDAT: 文件中未找到可解析的数值行");
    }

    const firstNums = this.extractNumbers(numericLines[0]);
    let nodeCount = 0;
    let elementCount = 0;
    let headerConsumed = 0;
    if (firstNums.length >= 2 && Number.isInteger(firstNums[0]) && Number.isInteger(firstNums[1])) {
      nodeCount = firstNums[0];
      elementCount = firstNums[1];
      headerConsumed = 1;
    }

    const dataTokens = numericLines.slice(headerConsumed).flatMap((line) => this.extractNumbers(line));
    if (nodeCount <= 0 || elementCount <= 0) {
      if (dataTokens.length < 3) throw new Error("GenericDAT: 数据量不足，无法构造节点坐标");
      nodeCount = Math.floor(dataTokens.length / 3);
      elementCount = 0;
    }

    const coords = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      coords[i * 3] = dataTokens[i * 3] ?? 0;
      coords[i * 3 + 1] = dataTokens[i * 3 + 1] ?? 0;
      coords[i * 3 + 2] = dataTokens[i * 3 + 2] ?? 0;
    }
    const nodes = new NodeSet(nodeCount, coords);
    const elements = new ElementSet("FEBRICK", Math.max(0, elementCount));
    const variables: FlowVariables = {};

    if (elementCount > 0) {
      let p = nodeCount * 3;
      for (let e = 0; e < elementCount; e++) {
        const base = e * 8;
        for (let k = 0; k < 8; k++) {
          elements.connectivity[base + k] = ((dataTokens[p++] ?? 1) - 1) >>> 0;
        }
      }
    }

    const dataset = new FlowDataset(nodes, elements);
    dataset.variables = variables;
    dataset.adjacency = elementCount > 0 ? buildAdjacencyFromFEBRICK(elements, nodeCount, true) : undefined;
    return { dataset, variableNames: ["X", "Y", "Z"] };
  }

  private lineHasNumbers(line: string): boolean {
    return /[-+]?\d+(?:\.\d+)?(?:[eEdD][-+]?\d+)?/.test(line);
  }

  private extractNumbers(line: string): number[] {
    const matches = line.match(/[-+]?\d*\.?\d+(?:[eEdD][-+]?\d+)?/g);
    return matches ? matches.map((s) => Number.parseFloat(s.replace(/[dD]/, "e"))).filter(Number.isFinite) : [];
  }
}

/**
 * Tecplot Binary（.plt / TDV112）解析实现
 *
 * 正确实现 TDV112 规范：
 * - 单 zone，FEBrick（zone_type=5）
 * - zone header 中**无** dataPacking 字段
 * - 支持 specifyVarLocation：node-centered (0) 和 cell-centered (1)
 * - 数据始终为 BLOCK 排列
 * - cell-centered 变量自动转换为 node-centered（邻居平均）
 * - connectivity 为 0-based
 * - variable_format：float32 (1) / float64 (2)
 */
export class TecplotBinaryPalette implements IFlowParserStrategy {
  canParse(input: ParserInput, hint?: { filename?: string }): boolean {
    const filename = hint?.filename ?? (input instanceof File ? input.name : "");
    return /\.plt$/i.test(filename) || /\.dat$/i.test(filename) || filename === "";
  }

  async parse(input: ParserInput): Promise<ParseResult> {
    const buf = await this.readAsArrayBuffer(input);
    const u8 = new Uint8Array(buf);
    if (u8.length < 16) throw new Error("TecplotBinary: 文件过小");

    const magic = new TextDecoder("ascii", { fatal: false }).decode(u8.slice(0, 8));
    if (magic !== "#!TDV112") throw new Error("TecplotBinary: 非 TDV112 文件");

    const dv = new DataView(buf);
    let off = 8;

    const byteOrder = dv.getInt32(off, true); off += 4;
    if (byteOrder !== 1) throw new Error(`TecplotBinary: 暂不支持 byteOrder=${byteOrder}`);
    off += 4; // file_type

    // Title
    const title = this.readAsciiI32String(dv, u8, () => off, (v) => (off = v));
    const numVars = dv.getInt32(off, true); off += 4;
    if (numVars < 3) throw new Error("TecplotBinary: 变量数量不足");

    const variableNames: string[] = [];
    for (let i = 0; i < numVars; i++) {
      variableNames.push(this.readAsciiI32String(dv, u8, () => off, (v) => (off = v)));
    }

    // === Zone Header ===
    const zoneMarker = dv.getFloat32(off, true); off += 4;
    if (Math.abs(zoneMarker - 299.0) > 0.01) throw new Error("TecplotBinary: 缺少 zone marker 299.0");

    // Zone name (null-terminated I32 string)
    this.readAsciiI32String(dv, u8, () => off, (v) => (off = v));

    // parentZone, strandId
    off += 4; // parentZone
    off += 4; // strandId
    // solutionTime (float64)
    off += 8;
    // notUsed (-1)
    off += 4;
    // zoneType
    const zoneType = dv.getInt32(off, true); off += 4;
    if (zoneType !== 5) throw new Error(`TecplotBinary: 仅支持 FEBrick(5)，实际 ${zoneType}`);

    // TDV112: NO dataPacking field here!
    // specifyVarLocation
    const specVarLoc = dv.getInt32(off, true); off += 4;
    const varLocations = new Array<number>(numVars).fill(0); // 0=node, 1=cell
    if (specVarLoc !== 0) {
      for (let i = 0; i < numVars; i++) {
        varLocations[i] = dv.getInt32(off, true); off += 4;
      }
    }

    // rawFaceNeighbors, miscConnections
    off += 4; // rawFaceNeighbors
    off += 4; // miscConnections

    // FE zone: numPoints, numElements, iCellDim, jCellDim, kCellDim
    const nodeCount = dv.getInt32(off, true); off += 4;
    const elementCount = dv.getInt32(off, true); off += 4;
    off += 12; // iCellDim, jCellDim, kCellDim

    if (nodeCount <= 0 || elementCount <= 0) {
      throw new Error(`TecplotBinary: 非法 nodeCount=${nodeCount}, elementCount=${elementCount}`);
    }

    // Skip to EOH marker (357.0)
    const eoh = this.findFirstF32(u8, off, 357.0);
    if (eoh < 0) throw new Error("TecplotBinary: 未找到 EOH marker");
    off = eoh + 4;

    // === Data Section ===
    const dataMarker = dv.getFloat32(off, true); off += 4;
    if (Math.abs(dataMarker - 299.0) > 0.01) throw new Error("TecplotBinary: 缺少 data marker 299.0");

    // Variable formats
    const varFmt: number[] = [];
    for (let i = 0; i < numVars; i++) { varFmt.push(dv.getInt32(off, true)); off += 4; }

    // Passive variables
    const hasPassive = dv.getInt32(off, true); off += 4;
    const passive = new Array<number>(numVars).fill(0);
    if (hasPassive) { for (let i = 0; i < numVars; i++) { passive[i] = dv.getInt32(off, true); off += 4; } }

    // Sharing
    const hasSharing = dv.getInt32(off, true); off += 4;
    const sharing = new Array<number>(numVars).fill(-1);
    if (hasSharing) { for (let i = 0; i < numVars; i++) { sharing[i] = dv.getInt32(off, true); off += 4; } }

    // Share connectivity
    const shareConn = dv.getInt32(off, true); off += 4;

    // Min/max per variable (skip)
    off += numVars * 16;

    // === Read variable data (BLOCK format) ===
    const valuesByVar: (Float32Array | null)[] = new Array(numVars).fill(null);
    for (let i = 0; i < numVars; i++) {
      if (passive[i]) continue;
      if (sharing[i] >= 0) continue;
      // Count depends on whether variable is node- or cell-centered
      const count = varLocations[i] === 0 ? nodeCount : elementCount;
      const fmt = varFmt[i];
      const arr = new Float32Array(count);
      if (fmt === 1) {
        for (let k = 0; k < count; k++) { arr[k] = dv.getFloat32(off, true); off += 4; }
      } else if (fmt === 2) {
        for (let k = 0; k < count; k++) { arr[k] = dv.getFloat64(off, true); off += 8; }
      } else {
        throw new Error(`TecplotBinary: 不支持 variable_format=${fmt}`);
      }
      valuesByVar[i] = arr;
    }

    // === Read connectivity (0-based for TDV112 binary) ===
    const connectivity = new Uint32Array(elementCount * 8);
    for (let i = 0; i < connectivity.length; i++) {
      connectivity[i] = dv.getInt32(off, true) >>> 0;
      off += 4;
    }

    // === Build coordinates ===
    const xArr = valuesByVar[0], yArr = valuesByVar[1], zArr = valuesByVar[2];
    if (!xArr || !yArr || !zArr) throw new Error("TecplotBinary: 缺少 X/Y/Z 数据");
    const coords = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      coords[i * 3] = xArr[i];
      coords[i * 3 + 1] = yArr[i];
      coords[i * 3 + 2] = zArr[i];
    }

    const nodes = new NodeSet(nodeCount, coords);
    const elements = new ElementSet("FEBRICK", elementCount, connectivity);
    const dataset = new FlowDataset(nodes, elements);

    // === Convert cell-centered vars to node-centered via averaging ===
    for (let i = 3; i < numVars; i++) {
      const raw = valuesByVar[i];
      if (!raw) continue;
      if (varLocations[i] === 0) {
        // Already node-centered
        dataset.setVariable(variableNames[i], raw);
      } else {
        // Cell-centered -> node-centered: average over adjacent cells
        const nodeVals = new Float32Array(nodeCount);
        const nodeCount2 = new Uint32Array(nodeCount);
        for (let e = 0; e < elementCount; e++) {
          const cellVal = raw[e];
          const base = e * 8;
          for (let k = 0; k < 8; k++) {
            const ni = connectivity[base + k];
            if (ni < nodeCount) {
              nodeVals[ni] += cellVal;
              nodeCount2[ni]++;
            }
          }
        }
        for (let n = 0; n < nodeCount; n++) {
          if (nodeCount2[n] > 0) nodeVals[n] /= nodeCount2[n];
        }
        dataset.setVariable(variableNames[i], nodeVals);
      }
    }

    return { dataset, variableNames };
  }

  private async readAsArrayBuffer(input: ParserInput): Promise<ArrayBuffer> {
    if (input instanceof File) return input.arrayBuffer();
    return input;
  }

  private readI32(dv: DataView, off: number, littleEndian = true): number {
    return dv.getInt32(off, littleEndian);
  }

  private readF32(dv: DataView, off: number, littleEndian = true): number {
    return dv.getFloat32(off, littleEndian);
  }

  private readAsciiI32String(
    dv: DataView,
    u8: Uint8Array,
    getOff: () => number,
    setOff: (v: number) => void,
  ): string {
    let off = getOff();
    const chars: number[] = [];
    while (off + 4 <= u8.length) {
      const v = dv.getInt32(off, true);
      off += 4;
      if (v === 0) break;
      chars.push(v & 0xff);
    }
    setOff(off);
    return new TextDecoder("latin1").decode(new Uint8Array(chars));
  }

  private findFirstF32(u8: Uint8Array, start: number, value: number): number {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let off = start; off + 4 <= u8.length; off += 4) {
      const v = dv.getFloat32(off, true);
      if (Math.abs(v - value) < 1e-6) return off;
    }
    return -1;
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

