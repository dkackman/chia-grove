import { expect, test } from "vitest";
import { cabinetLayout } from "../src/themes/board/cabinet.js";

const input = {
  cols: 48,
  cell: 0.6,
  face: 0.92,
  headerOriginY: 7,
  headerRows: 3,
  ledgerOriginY: 4.72,
  ledgerRows: 20,
  pad: 0.2,
  bezel: 0.5,
};

test("window wraps both flap grids with the given padding", () => {
  const L = cabinetLayout(input);
  const halfFace = 0.276;
  expect(L.winHalfW).toBeCloseTo((47 * 0.6) / 2 + halfFace + 0.2, 6);
  const top = 7 + halfFace + 0.2;
  const bottom = 4.72 - 19 * 0.6 - halfFace - 0.2;
  expect(L.centerY + L.winHalfH).toBeCloseTo(top, 6);
  expect(L.centerY - L.winHalfH).toBeCloseTo(bottom, 6);
});

test("outer size adds the bezel on every side", () => {
  const L = cabinetLayout(input);
  expect(L.outerW).toBeCloseTo(2 * L.winHalfW + 1, 6);
  expect(L.outerH).toBeCloseTo(2 * L.winHalfH + 1, 6);
});

test("caption rail fills the gap between the header's last row and the ledger's first", () => {
  const L = cabinetLayout(input);
  const headerBottom = 7 - 2 * 0.6 - 0.276;
  const ledgerTop = 4.72 + 0.276;
  expect(L.railH).toBeCloseTo(headerBottom - ledgerTop, 6);
  expect(L.railY).toBeCloseTo((headerBottom + ledgerTop) / 2, 6);
});

test("no rail when the grids abut", () => {
  expect(cabinetLayout({ ...input, ledgerOriginY: 5.4 }).railH).toBe(0);
});
