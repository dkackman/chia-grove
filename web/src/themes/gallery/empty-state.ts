import * as THREE from "three";
import { GALLERY } from "./palette.js";
import { WALL, hangSlot } from "./layout.js";
import { wallTextTexture } from "./wall-text.js";

const HOOKS = 9; // the first three columns' worth of empty picture hooks
const HOOK_RISE = 0.85; // hooks sit about where a frame's top edge would hang

/**
 * Before the first NFT hangs: a row of empty brass picture hooks where the
 * first pieces will go, and a wall placard explaining the bare wall. Hidden
 * the moment anything hangs; shown again if a reorg empties the wall.
 */
export class EmptyWall {
  private group = new THREE.Group();

  constructor(scene: THREE.Scene, placardX: number, placardY: number) {
    const brass = new THREE.MeshStandardMaterial({
      color: GALLERY.brass,
      metalness: 0.6,
      roughness: 0.35,
      emissive: GALLERY.brass,
      emissiveIntensity: 0.2,
    });
    const hookGeo = new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI);
    hookGeo.rotateZ(Math.PI); // an upturned "U" hook
    const pinGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.06, 6);
    pinGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < HOOKS; i++) {
      const slot = hangSlot(i);
      const hook = new THREE.Mesh(hookGeo, brass);
      hook.position.set(slot.x, slot.y + HOOK_RISE, WALL.z + 0.03);
      const pin = new THREE.Mesh(pinGeo, brass);
      pin.position.set(slot.x, slot.y + HOOK_RISE + 0.05, WALL.z + 0.03);
      this.group.add(hook, pin);
    }

    const map = wallTextTexture(["Installation in progress", "new works arrive with each block"], {
      width: 512,
      height: 192,
      background: "#e6dfcf",
      color: "#3a3226",
      border: "#b9ad93",
      font: "italic 30px Georgia, 'Times New Roman', serif",
    });
    const placard = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.82),
      new THREE.MeshStandardMaterial({
        color: map ? 0xffffff : GALLERY.matIvory,
        map,
        roughness: 1,
        emissive: GALLERY.matIvory,
        emissiveIntensity: 0.12,
      })
    );
    placard.position.set(placardX, placardY, WALL.z + 0.02);
    this.group.add(placard);
    scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  get visible(): boolean {
    return this.group.visible;
  }
}
