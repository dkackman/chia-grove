import * as THREE from "three";
import type { Visualization } from "../types.js";
import { startMine } from "./mine.js";
import { Island } from "./island.js";
import { CatBlocks } from "./cats.js";
import { Villagers } from "./structures.js";

export const mine: Visualization = {
  id: "mine",
  label: "mineworld",
  legend: [
    ["sw-land", "land — XCH spend (the island)"],
    ["sw-block", "block — CAT (material + color = asset)"],
    ["sw-painting", "painting — NFT (clickable)"],
    ["sw-villager", "villager — DID"],
    ["sw-beacon", "beacon — mint"],
    ["sw-torch", "torches — mempool"],
    ["sw-suncycle", "sun / moon — netspace + time"],
    ["sw-creeper", "creeper — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startMine(canvas, feed);
    const island = new Island(runtime.scene);
    const cats = new CatBlocks(runtime.scene);
    const villagers = new Villagers(runtime.scene);
    const clock = { t: 0 };
    let hovered: { object: THREE.Object3D; index: number } | null = null;

    runtime.setBlockHandler((chunk) => {
      island.startBlock(chunk);
      cats.startBlock(chunk);
    });
    runtime.setSproutHandler((event, chunk, _height) => {
      if (event.kind === "xch") {
        island.placeGrass(event, clock.t);
        return;
      }
      if (event.kind === "cat") {
        const seat = cats.nextSeat();
        if (!seat) return;
        island.ensureGround(event, { col: seat.col, row: seat.row }, clock.t);
        cats.plant(event, seat, clock.t);
        return;
      }
      if (event.kind === "did") {
        const seat = cats.nextSeat();
        if (!seat) return;
        island.ensureGround(event, { col: seat.col, row: seat.row }, clock.t);
        villagers.plant(event, chunk, seat, clock.t);
      }
      // NFT added in the next task
    });
    runtime.setReorgHandler((forkHeight) => {
      island.clearAbove(forkHeight);
      cats.clearAbove(forkHeight);
      villagers.clearAbove(forkHeight);
    });

    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((_dt, t) => {
      clock.t = t;
      island.update(t);
      cats.update(t);
      villagers.update(t);
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => [...island.pickables(), ...cats.pickables(), ...villagers.pickables()],
      metaFor: (object, instanceId) =>
        island.metaFor(object, instanceId) ??
        cats.metaFor(object, instanceId) ??
        villagers.metaFor(object),
      setHovered: (object, instanceId) => {
        if (hovered) {
          cats.setHighlight(hovered.object, hovered.index, false);
          hovered = null;
        }
        if (object && instanceId !== undefined && cats.setHighlight(object, instanceId, true)) {
          hovered = { object, index: instanceId };
        }
      },
    };
  },
};
