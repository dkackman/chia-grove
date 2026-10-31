import * as THREE from "three";
import type { Visualization } from "../types.js";
import { startMine } from "./mine.js";
import { Island } from "./island.js";
import { CatBlocks } from "./cats.js";
import { Villagers, Paintings } from "./structures.js";
import { Vfx } from "./vfx.js";
import { SpecialSeats, SEAT_HEIGHT, torchRadius } from "./layout.js";

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
    const island = new Island(runtime.scene, runtime.water);
    const cats = new CatBlocks(runtime.scene);
    const villagers = new Villagers(runtime.scene);
    const paintings = new Paintings(runtime.scene);
    const vfx = new Vfx(runtime.scene, runtime.sky);
    // one seat allocator for every special kind, so cubes, villagers and
    // paintings stack by height instead of overlapping
    const seats = new SpecialSeats();
    const clock = { t: 0 };
    const currentChunkRef = { value: { x: 0, z: 0 } };
    // replayed (snapshot / catch-up) blocks skip per-block fanfare
    let liveBlock = true;
    let hovered: { object: THREE.Object3D; index: number | undefined } | null = null;

    runtime.setBlockHandler((chunk, index, live) => {
      currentChunkRef.value = chunk;
      liveBlock = live;
      island.startBlock(chunk, index);
      cats.startBlock(chunk);
      // the spiral lapped back onto this slot: take down the previous lap's
      // still-alive specials so the new block's seats don't z-fight with them
      const stale = seats.startChunk(index);
      if (stale.size > 0) {
        const wasHere = (m: { coinId: string }) => stale.has(m.coinId);
        cats.clearWhere(wasHere);
        villagers.clearWhere(wasHere);
        paintings.clearWhere(wasHere);
      }
      vfx.setCursor(chunk);
      vfx.setIslandRadius(torchRadius(runtime.filledBlocks()));
    });
    runtime.setSproutHandler((event, chunk, _height) => {
      if (event.kind === "xch") {
        island.placeGrass(event, clock.t);
        // lapped chunks are already paved — the cursor flash is the spend's visual
        if (liveBlock) vfx.pulse(clock.t);
        return;
      }
      if (event.mint && liveBlock) vfx.beacon(chunk, clock.t);
      // an NFT spent more than once inside the window (a mint is an eve + lineage
      // spend; transfers spend it again) arrives as repeat events — hang just one
      // painting per launcher id, the way the gallery dedupes its canvases
      if (event.kind === "nft" && event.launcherId && paintings.has(event.launcherId)) return;
      const height =
        event.kind === "nft" ? SEAT_HEIGHT.nft : event.kind === "did" ? SEAT_HEIGHT.did : 1;
      const seat = seats.next(height, event.coinId);
      if (!seat) return;
      island.ensureGround(event, { col: seat.col, row: seat.row }, clock.t);
      if (event.kind === "cat") cats.plant(event, seat, clock.t);
      else if (event.kind === "did") villagers.plant(event, chunk, seat, clock.t);
      else if (event.kind === "nft") paintings.plant(event, chunk, seat);
    });
    runtime.setReorgHandler((forkHeight, forkChunk) => {
      clearHover();
      island.clearAbove(forkHeight);
      cats.clearAbove(forkHeight);
      villagers.clearAbove(forkHeight);
      paintings.clearAbove(forkHeight);
      vfx.setIslandRadius(torchRadius(runtime.filledBlocks()));
      // detonate where the chain forked (the cursor rewound there), falling
      // back to the current chunk when the fork predates everything recorded
      vfx.creeper(forkChunk ?? currentChunkRef.value, clock.t);
    });
    runtime.setAmbientHandler((mempoolSize) => vfx.setMempool(mempoolSize));
    runtime.setContentFlagHandler((launcherId) => paintings.markSensitive(launcherId));

    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((dt, t) => {
      clock.t = t;
      island.update(t);
      cats.update(t);
      villagers.update(t, dt, runtime.camera, runtime.isReducedMotion());
      paintings.update(runtime.camera);
      vfx.update(dt, t);
      for (const fn of frameCallbacks) fn();
    });

    const highlight = (object: THREE.Object3D, index: number | undefined, on: boolean) =>
      (index !== undefined &&
        (island.setHighlight(object, index, on) || cats.setHighlight(object, index, on))) ||
      villagers.setHighlight(object, index, on) ||
      paintings.setHighlight(object, on);
    function clearHover(): void {
      if (hovered) highlight(hovered.object, hovered.index, false);
      hovered = null;
    }

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
        villagers.metaFor(object, instanceId) ??
        paintings.metaFor(object),
      setHovered: (object, instanceId) => {
        clearHover();
        if (object && highlight(object, instanceId, true)) {
          hovered = { object, index: instanceId };
        }
      },
    };
  },
};
