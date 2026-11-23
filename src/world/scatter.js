// ScatterLayer: instanced rendering split into spatial cells so that
//  - each cell has a tight bounding sphere -> real frustum culling,
//  - each cell picks a geometry LOD (or hides) from its distance to the camera,
//  - empty cells cost nothing.
// Instances are added once at generation; per-frame work is one distance test per cell.
import * as THREE from 'three';

const _box = new THREE.Box3();

export class ScatterLayer {
  /**
   * @param {object} o
   * @param {{geometry:THREE.BufferGeometry, maxDist:number}[]} o.lods  ordered near -> far
   * @param {THREE.Material} o.material
   * @param {number} o.cellSize
   */
  constructor(o) {
    this.name = o.name;
    this.lods = o.lods;
    this.material = o.material;
    this.cellSize = o.cellSize || 64;
    this.castShadow = !!o.castShadow;
    this.receiveShadow = o.receiveShadow !== false;
    this.cells = new Map();
    this.group = new THREE.Group();
    this.group.name = 'scatter:' + o.name;
    this.count = 0;
    this.maxDist = this.lods[this.lods.length - 1].maxDist;
  }

  add(matrix) {
    const x = matrix.elements[12], z = matrix.elements[14];
    const key = Math.floor(x / this.cellSize) + ',' + Math.floor(z / this.cellSize);
    let c = this.cells.get(key);
    if (!c) { c = { matrices: [], cx: (Math.floor(x / this.cellSize) + 0.5) * this.cellSize, cz: (Math.floor(z / this.cellSize) + 0.5) * this.cellSize, meshes: [] }; this.cells.set(key, c); }
    c.matrices.push(matrix.clone());
    this.count++;
  }

  build() {
    for (const c of this.cells.values()) {
      for (let L = 0; L < this.lods.length; L++) {
        const m = new THREE.InstancedMesh(this.lods[L].geometry, this.material, c.matrices.length);
        for (let i = 0; i < c.matrices.length; i++) m.setMatrixAt(i, c.matrices[i]);
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
        m.castShadow = this.castShadow && L === 0;
        m.receiveShadow = this.receiveShadow;
        m.visible = false;
        m.matrixAutoUpdate = false;
        m.name = this.name + ':L' + L;
        this.group.add(m);
        c.meshes.push(m);
      }
      // cell bounds for distance tests
      _box.makeEmpty();
      for (const mt of c.matrices) _box.expandByPoint(new THREE.Vector3(mt.elements[12], mt.elements[13], mt.elements[14]));
      c.minX = _box.min.x; c.maxX = _box.max.x; c.minZ = _box.min.z; c.maxZ = _box.max.z;
      c.matrices = null; // release CPU copies
    }
    return this.group;
  }

  update(cam) {
    for (const c of this.cells.values()) {
      const dx = Math.max(c.minX - cam.x, 0, cam.x - c.maxX);
      const dz = Math.max(c.minZ - cam.z, 0, cam.z - c.maxZ);
      const d = Math.sqrt(dx * dx + dz * dz);
      let lod = -1;
      for (let L = 0; L < this.lods.length; L++) if (d < this.lods[L].maxDist) { lod = L; break; }
      for (let L = 0; L < c.meshes.length; L++) c.meshes[L].visible = L === lod;
    }
  }

  dispose() {
    for (const c of this.cells.values()) for (const m of c.meshes) m.dispose();
    for (const l of this.lods) l.geometry.dispose();
  }
}
