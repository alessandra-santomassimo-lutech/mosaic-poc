// A compact octree over tile-cell centres, used for frustum culling on the globe.
//
// Inserting 1,000,000 individual tiles would be wasteful, so tiles are grouped
// into CELL x CELL blocks (cells). The octree indexes the ~10k cell centres;
// querying with the camera frustum rejects whole subtrees hierarchically and
// returns the visible cells. Each visible cell expands to its tile ids for the
// instanced draw — classic chunk-level frustum culling.

import { Box3, type Frustum, Vector3 } from "three";

const CAPACITY = 16; // items per leaf before subdividing
const MAX_DEPTH = 8;

interface OctreeItem {
  pos: Vector3;
  payload: number; // cell id
}

class Node {
  box: Box3;
  items: OctreeItem[] = [];
  children: Node[] | null = null;
  constructor(box: Box3) {
    this.box = box;
  }
}

export class Octree {
  private root: Node;

  constructor(bounds: Box3, items: OctreeItem[]) {
    this.root = new Node(bounds.clone());
    for (const it of items) this.insert(this.root, it, 0);
  }

  private insert(node: Node, item: OctreeItem, depth: number): void {
    if (node.children) {
      this.insert(node.children[this.childIndex(node, item.pos)], item, depth + 1);
      return;
    }
    node.items.push(item);
    if (node.items.length > CAPACITY && depth < MAX_DEPTH) {
      this.subdivide(node, depth);
    }
  }

  private subdivide(node: Node, depth: number): void {
    const { min, max } = node.box;
    const c = new Vector3().addVectors(min, max).multiplyScalar(0.5);
    node.children = [];
    for (let i = 0; i < 8; i++) {
      const nx = i & 1 ? c.x : min.x;
      const px = i & 1 ? max.x : c.x;
      const ny = i & 2 ? c.y : min.y;
      const py = i & 2 ? max.y : c.y;
      const nz = i & 4 ? c.z : min.z;
      const pz = i & 4 ? max.z : c.z;
      node.children.push(new Node(new Box3(new Vector3(nx, ny, nz), new Vector3(px, py, pz))));
    }
    const items = node.items;
    node.items = [];
    for (const it of items) this.insert(node.children[this.childIndex(node, it.pos)], it, depth + 1);
  }

  private childIndex(node: Node, p: Vector3): number {
    const { min, max } = node.box;
    const cx = (min.x + max.x) * 0.5;
    const cy = (min.y + max.y) * 0.5;
    const cz = (min.z + max.z) * 0.5;
    return (p.x >= cx ? 1 : 0) | (p.y >= cy ? 2 : 0) | (p.z >= cz ? 4 : 0);
  }

  /** Collect payloads (cell ids) whose octree nodes intersect the frustum. */
  query(frustum: Frustum, out: number[]): void {
    out.length = 0;
    this.collect(this.root, frustum, out);
  }

  private collect(node: Node, frustum: Frustum, out: number[]): void {
    if (!frustum.intersectsBox(node.box)) return;
    if (node.children) {
      for (const child of node.children) this.collect(child, frustum, out);
    } else {
      for (const it of node.items) out.push(it.payload);
    }
  }
}
