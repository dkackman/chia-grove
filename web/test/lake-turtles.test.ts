import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Turtles } from "../src/themes/lake/turtles.js";

const did = (coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "did",
  height,
  coinId,
  amount: "1",
});

test("turtles are pickable once planted and cull on reorg", () => {
  const turtles = new Turtles(new THREE.Scene());
  expect(turtles.pickables()).toHaveLength(0);
  turtles.plant(did("aa".repeat(32), 10), 0);
  turtles.plant(did("bb".repeat(32), 20), 0);
  expect(turtles.pickables()).toHaveLength(2);
  turtles.clearAbove(20);
  expect(turtles.pickables()).toHaveLength(1);
  expect(turtles.metaFor(turtles.pickables()[0])?.height).toBe(10);
});

test("turtles sink with age", () => {
  const turtles = new Turtles(new THREE.Scene());
  turtles.plant(did("aa".repeat(32)), 0);
  const shell = turtles.pickables()[0];
  turtles.update(0, 0);
  const fresh = (shell.parent as THREE.Object3D).position.y;
  turtles.update(0, 10);
  expect((shell.parent as THREE.Object3D).position.y).toBeLessThan(fresh);
});
