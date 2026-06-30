import * as THREE from "three";
import type { Visualization } from "../types.js";
import { startMine } from "./mine.js";
import { Island } from "./island.js";
import { CatBlocks } from "./cats.js";
import { Villagers, Paintings } from "./structures.js";
import { Vfx } from "./vfx.js";

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
    const paintings = new Paintings(runtime.scene);
    const vfx = new Vfx(runtime.scene, runtime.sky);
    const clock = { t: 0 };
    const currentChunkRef = { value: { x: 0, z: 0 } };
    let hovered: { object: THREE.Object3D; index: number } | null = null;

    runtime.setBlockHandler((chunk, index) => {
      currentChunkRef.value = chunk;
      island.startBlock(chunk, index);
      cats.startBlock(chunk);
    });
    runtime.setSproutHandler((event, chunk, _height) => {
      if (event.kind === "xch") {
        island.placeGrass(event, clock.t);
        return;
      }
      if (event.mint) vfx.beacon(chunk, clock.t);
      // an NFT spent more than once inside the window (a mint is an eve + lineage
      // spend; transfers spend it again) arrives as repeat events — hang just one
      // painting per launcher id, the way the gallery dedupes its canvases
      if (event.kind === "nft" && event.launcherId && paintings.has(event.launcherId)) return;
      const seat = cats.nextSeat();
      if (!seat) return;
      island.ensureGround(event, { col: seat.col, row: seat.row }, clock.t);
      if (event.kind === "cat") cats.plant(event, seat, clock.t);
      else if (event.kind === "did") villagers.plant(event, chunk, seat, clock.t);
      else if (event.kind === "nft") paintings.plant(event, chunk, seat);
    });
    runtime.setReorgHandler((forkHeight) => {
      island.clearAbove(forkHeight);
      cats.clearAbove(forkHeight);
      villagers.clearAbove(forkHeight);
      paintings.clearAbove(forkHeight);
      vfx.creeper(currentChunkRef.value, clock.t);
    });
    runtime.setAmbientHandler((mempoolSize) => vfx.setMempool(mempoolSize));
    runtime.setContentFlagHandler((launcherId) => paintings.markSensitive(launcherId));

    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((dt, t) => {
      clock.t = t;
      island.update(t);
      cats.update(t);
      villagers.update(t);
      paintings.update(runtime.camera);
      vfx.update(dt, t);
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => [
        ...island.pickables(),
        ...cats.pickables(),
        ...villagers.pickables(),
        ...paintings.pickables(),
      ],
      metaFor: (object, instanceId) =>
        island.metaFor(object, instanceId) ??
        cats.metaFor(object, instanceId) ??
        villagers.metaFor(object) ??
        paintings.metaFor(object),
      setHovered: (object, instanceId) => {
        if (hovered) {
          if (!island.setHighlight(hovered.object, hovered.index, false))
            cats.setHighlight(hovered.object, hovered.index, false);
          hovered = null;
        }
        if (object && instanceId !== undefined) {
          if (
            island.setHighlight(object, instanceId, true) ||
            cats.setHighlight(object, instanceId, true)
          ) {
            hovered = { object, index: instanceId };
          }
        }
      },
    };
  },
};
