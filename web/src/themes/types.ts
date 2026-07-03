import type * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../net/feed.js";

/**
 * The detail-card payload for a picked object. Usually a single spend; the board
 * also surfaces aggregated XCH/CAT rows, where `amount` is the block-wide total
 * and `aggregate.count` is how many spends it folds in. The card uses the count
 * to avoid presenting an aggregate as if it were one coin.
 */
export type CardMeta = SproutEvent & { aggregate?: { count: number } };

/** What the shared UI (picker, detail card) needs from a running scene. */
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  /** When true, main.ts skips the shared canvas picker; the theme wires its own input. */
  selfManagedInput?: boolean;
  isDragging?(): boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): CardMeta | null;
  /** A hit that means "jump to this block's detail view" rather than a spend card. */
  pickHeight?(object: THREE.Object3D, instanceId: number | undefined): number | null;
  /** Invoked by the picker on a `pickHeight` click; the theme owns what "selecting" a height means. */
  selectHeight?(height: number): void;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
  /**
   * A stable identity for the thing under the pointer, used by the picker to
   * decide when the hover (and its detail card) actually changed. Defaults to
   * `object + instanceId`. A theme overrides it when one logical target spans
   * many instances — the board packs ~40 grid cells into a single ledger row, so
   * without this, sweeping across a row would rebuild the card (reloading its
   * thumbnail) on every cell boundary.
   */
  hoverKey?(object: THREE.Object3D, instanceId: number | undefined): string;
}

export interface Visualization {
  id: string;
  label: string;
  legend: ReadonlyArray<readonly [swatchClass: string, label: string]>;
  start(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle;
}
