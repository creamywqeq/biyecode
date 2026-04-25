/**
 * External Surface Extraction for FEBRICK (hexahedral) meshes.
 *
 * Uses node-to-cell adjacency to detect boundary faces without large temporary arrays.
 * Memory: O(nodeCount + eCount*8) — same order as connectivity itself.
 *
 * Algorithm:
 * 1. Build node→cell adjacency (CSR format).
 * 2. For each cell face, check if another cell shares all 4 nodes.
 *    If not → boundary face.
 * 3. Triangulate boundary quads.
 */

import type { FlowDataset } from "../flow";

const HEX_FACE_LOCAL: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
];

export interface ExternalSurface {
  indices: Uint32Array;
  triToCell: Uint32Array;
  triangleCount: number;
}

// Cached results to avoid recomputation (keyed by dataset identity)
const surfaceCache = new WeakMap<object, ExternalSurface>();

interface NodeToCellCSR {
  offsets: Uint32Array;
  cells: Uint32Array;
}

function buildNodeToCellAdj(conn: Uint32Array, nodeCount: number, eCount: number): NodeToCellCSR {
  const degree = new Uint32Array(nodeCount);
  const totalPairs = eCount * 8;
  for (let i = 0; i < totalPairs; i++) degree[conn[i]]++;

  const offsets = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i] + degree[i];

  const cells = new Uint32Array(offsets[nodeCount]);
  const cursor = offsets.slice();
  for (let e = 0; e < eCount; e++) {
    const base = e * 8;
    for (let k = 0; k < 8; k++) {
      const node = conn[base + k];
      cells[cursor[node]++] = e;
    }
  }
  return { offsets, cells };
}

function collectBoundaryFaces(
  conn: Uint32Array, eCount: number, adj: NodeToCellCSR,
): { boundaryElems: Uint32Array; boundaryFaceIds: Uint8Array; count: number } {
  // Pre-allocate pessimistic (eCount * 6); will trim later
  const maxFaces = eCount * 6;
  // Use compact storage: Uint32Array for elem, Uint8Array for faceId
  let cap = Math.min(maxFaces, 1 << 20); // start small, grow
  let elems = new Uint32Array(cap);
  let faceIds = new Uint8Array(cap);
  let count = 0;

  const { offsets, cells } = adj;

  for (let e = 0; e < eCount; e++) {
    const base = e * 8;
    for (let f = 0; f < 6; f++) {
      const [aL, bL, cL, dL] = HEX_FACE_LOCAL[f];
      const n0 = conn[base + aL];
      const n1 = conn[base + bL];
      const n2 = conn[base + cL];
      const n3 = conn[base + dL];

      // Pick node with fewest adjacent cells
      let minNode = n0, minDeg = offsets[n0 + 1] - offsets[n0];
      for (const n of [n1, n2, n3]) {
        const d = offsets[n + 1] - offsets[n];
        if (d < minDeg) { minNode = n; minDeg = d; }
      }

      // Check if any other cell shares all 4 nodes
      let shared = false;
      const start = offsets[minNode], end = offsets[minNode + 1];
      for (let ci = start; ci < end; ci++) {
        const oc = cells[ci];
        if (oc === e) continue;
        const ob = oc * 8;
        let has0 = false, has1 = false, has2 = false, has3 = false;
        for (let k = 0; k < 8; k++) {
          const cn = conn[ob + k];
          if (cn === n0) has0 = true;
          else if (cn === n1) has1 = true;
          else if (cn === n2) has2 = true;
          else if (cn === n3) has3 = true;
        }
        if (has0 && has1 && has2 && has3) { shared = true; break; }
      }

      if (!shared) {
        if (count >= cap) {
          cap = cap * 2;
          const newElems = new Uint32Array(cap);
          newElems.set(elems);
          elems = newElems;
          const newFaces = new Uint8Array(cap);
          newFaces.set(faceIds);
          faceIds = newFaces;
        }
        elems[count] = e;
        faceIds[count] = f;
        count++;
      }
    }
  }

  return { boundaryElems: elems, boundaryFaceIds: faceIds, count };
}

export function extractExternalSurface(dataset: FlowDataset): ExternalSurface {
  const cached = surfaceCache.get(dataset);
  if (cached) return cached;

  const conn = dataset.elements.connectivity;
  const eCount = dataset.elements.elementCount;
  const nodeCount = dataset.nodes.nodeCount;

  const adj = buildNodeToCellAdj(conn, nodeCount, eCount);
  const { boundaryElems, boundaryFaceIds, count } = collectBoundaryFaces(conn, eCount, adj);

  const triCount = count * 2;
  const indices = new Uint32Array(triCount * 3);
  const triToCell = new Uint32Array(triCount);
  let ti = 0;
  for (let i = 0; i < count; i++) {
    const elem = boundaryElems[i];
    const face = boundaryFaceIds[i];
    const base = elem * 8;
    const [aL, bL, cL, dL] = HEX_FACE_LOCAL[face];
    const a = conn[base + aL], b = conn[base + bL], c = conn[base + cL], d = conn[base + dL];
    const idx = ti * 3;
    indices[idx] = a; indices[idx + 1] = b; indices[idx + 2] = c;
    triToCell[ti++] = elem;
    const idx2 = ti * 3;
    indices[idx2] = a; indices[idx2 + 1] = c; indices[idx2 + 2] = d;
    triToCell[ti++] = elem;
  }

  const result: ExternalSurface = { indices, triToCell, triangleCount: triCount };
  surfaceCache.set(dataset, result);
  return result;
}

export function extractExternalEdges(dataset: FlowDataset): Uint32Array {
  const surface = extractExternalSurface(dataset);
  const conn = dataset.elements.connectivity;

  // Boundary faces are few (O(n^{2/3})) — Set<string> is safe here
  const edgeSet = new Set<string>();
  const edgeList: number[] = [];
  const triCount = surface.triangleCount;
  // Each pair of consecutive triangles came from a quad: re-derive from triToCell
  for (let ti = 0; ti < triCount; ti += 2) {
    // Indices of the original quad: a,b,c,d from two triangles (a,b,c) and (a,c,d)
    const i0 = ti * 3;
    const a = surface.indices[i0], b = surface.indices[i0 + 1], c = surface.indices[i0 + 2];
    const d = surface.indices[i0 + 5]; // second tri: a,c,d → idx+3=a, idx+4=c, idx+5=d
    const quad = [a, b, c, d];
    for (let j = 0; j < 4; j++) {
      const ea = quad[j], eb = quad[(j + 1) % 4];
      const ek = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
      if (!edgeSet.has(ek)) {
        edgeSet.add(ek);
        edgeList.push(ea, eb);
      }
    }
  }
  return new Uint32Array(edgeList);
}
