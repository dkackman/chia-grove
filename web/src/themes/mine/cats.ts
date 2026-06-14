import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { mulberry32 } from "../shared/util.js";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { resolveCatBlock, type CatFamily } from "./material.js";
import { seatCell, cellLocal, chunkElevation } from "./layout.js";
import { woolTexture, glassTexture, emissiveCellTexture } from "./textures.js";

const CAPS: Record<CatFamily, number> = { opaque: 400, transparent: 120, emissive: 80 };
const SPECIAL_BUDGET = 192; // cap cubes placed per block (airdrops stay bounded)

export function cubeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.92, 0.92, 0.92);
  g.translate(0, 0.46, 0);
  return g;
}

function opaqueMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    flatShading: true,
    map: woolTexture(),
  });
}
function transparentMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    flatShading: true,
    map: glassTexture(),
  });
}
function emissiveMaterial(): THREE.Material {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveIntensity: 1.5,
    emissiveMap: emissiveCellTexture(),
    roughness: 0.5,
  });
  // route per-instance color into the emissive term (same trick as grove mushrooms)
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;"
    );
  };
  return m;
}

export class CatBlocks {
  private readonly fam: Record<CatFamily, InstancedKind>;
  private readonly color = new THREE.Color();
  private chunk: XZ = { x: 0, z: 0 };
  private seatIndex = 0;

  constructor(scene: THREE.Scene) {
    this.fam = {
      opaque: new InstancedKind(scene, cubeGeometry(), opaqueMaterial(), CAPS.opaque, 0, 140, 1),
      transparent: new InstancedKind(
        scene,
        cubeGeometry(),
        transparentMaterial(),
        CAPS.transparent,
        0,
        140,
        1
      ),
      emissive: new InstancedKind(
        scene,
        cubeGeometry(),
        emissiveMaterial(),
        CAPS.emissive,
        0,
        140,
        1
      ),
    };
  }

  startBlock(chunk: XZ): void {
    this.chunk = chunk;
    this.seatIndex = 0;
  }

  /** Returns the seat cell so the caller can ground it; null if over budget. */
  nextSeat(): { col: number; row: number; layer: number } | null {
    if (this.seatIndex >= SPECIAL_BUDGET) return null;
    return seatCell(this.seatIndex++);
  }

  plant(event: SproutEvent, seat: { col: number; row: number; layer: number }, t: number): void {
    const block = resolveCatBlock(event.assetId ?? "0".repeat(64));
    const rand = mulberry32(parseInt(event.coinId.slice(8, 16) || "0", 16));
    this.color.setHSL(block.color.h, block.color.s, block.color.l);
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    const pose: Pose = {
      height: 1,
      rotY: 0,
      tiltX: 0,
      tiltZ: 0,
      swayPhase: 0,
      y: chunkElevation(this.chunk) + local.y,
      color: this.color,
    };
    const jx = (rand() - 0.5) * 0.06;
    const jz = (rand() - 0.5) * 0.06;
    this.fam[block.family].plant(
      event,
      this.chunk.x + local.x + jx,
      this.chunk.z + local.z + jz,
      t,
      pose
    );
  }

  update(t: number): void {
    for (const k of Object.values(this.fam)) k.update(t, 1);
  }
  clearAbove(forkHeight: number): void {
    for (const k of Object.values(this.fam)) k.clearWhere((m) => m.height >= forkHeight);
  }
  pickables(): THREE.Object3D[] {
    return Object.values(this.fam).map((k) => k.mesh);
  }
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    const k = Object.values(this.fam).find((f) => f.mesh === object);
    return k ? k.metaAt(instanceId ?? -1) : null;
  }
  setHighlight(object: THREE.Object3D, instanceId: number, on: boolean): boolean {
    const k = Object.values(this.fam).find((f) => f.mesh === object);
    if (!k) return false;
    k.setHighlight(instanceId, on);
    return true;
  }
}
