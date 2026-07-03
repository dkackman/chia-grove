import { test, expect, type Page } from "@playwright/test";

// The board's ledger is one InstancedMesh with 48 cells per row, so a single
// logical row spans ~40 pickable instances. Before the `hoverKey` fix, the
// shared picker keyed hover state on the raw instanceId, so moving the pointer
// across one row rebuilt the detail card — restarting its (often multi-second)
// thumbnail load — on every cell boundary. This drives that motion and asserts
// the card is not rebuilt while the pointer stays on one row.
//
// Demo mode (?demo=1) needs no ingest server or network (NFT art is an inline
// data: URI), so this exercises the card-rebuild churn, not the real /img
// latency (which is server-side and unit-tested separately). The whole
// interaction is kept inside the demo's first ~8s — after the initial backlog
// settles but before the first live block arrives — so no row shifts underfoot.

const LABEL_X = 320; // the XCH/CAT/NFT/DID kind-label column — present on every row
const rebuilds = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __cardRebuilds: number }).__cardRebuilds);
const cardVisible = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.getElementById("card")?.classList.contains("visible") ?? false);

test("dragging across a board row does not rebuild the detail card", async ({ page }) => {
  await page.goto("/?theme=board&demo=1");
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1200); // backlog settles; first live block is still ~7s out

  // count every showCard() rebuild (each call replaceChildren()s the card)
  await page.evaluate(() => {
    const card = document.getElementById("card")!;
    (window as unknown as { __cardRebuilds: number }).__cardRebuilds = 0;
    new MutationObserver((records) => {
      (window as unknown as { __cardRebuilds: number }).__cardRebuilds += records.length;
    }).observe(card, { childList: true });
  });

  // Rows are ~92% of a cell tall with a thin gap between them, so the top edge of
  // a row straddles its neighbour. Micro-scan a small band in the middle of the
  // ledger and center on the first contiguous "card visible" run.
  let bandStart: number | null = null;
  let rowY: number | null = null;
  for (let y = 350; y <= 414; y += 4) {
    await page.mouse.move(LABEL_X, y);
    await page.waitForTimeout(180); // > the picker's 160ms show delay
    const visible = await cardVisible(page);
    if (visible && bandStart === null) bandStart = y;
    else if (!visible && bandStart !== null) {
      rowY = Math.round((bandStart + (y - 4)) / 2);
      break;
    }
  }
  if (rowY === null && bandStart !== null) rowY = bandStart + 8; // band ran to the edge
  expect(rowY, "expected to hover a spend row and see the detail card").not.toBeNull();

  // Drag slowly across ~8 cells of the SAME row, dwelling >160ms on each so the
  // picker's show-debounce would fire once per cell if the hover identity
  // changed. With the fix it doesn't (one identity per row), so the card is
  // never rebuilt; without it this is ~one rebuild per cell (measured at 40).
  //
  // Demo mode is live, so a block can occasionally tick mid-drag and legitimately
  // rebuild the card once. Run the drag a few times and take the minimum — at
  // least one pass lands in a clean inter-block window — and assert well under
  // the broken count so the block-tick noise can never be mistaken for the bug.
  const measureDrag = async (): Promise<number> => {
    await page.mouse.move(LABEL_X, rowY!);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      (window as unknown as { __cardRebuilds: number }).__cardRebuilds = 0;
    });
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(300 + i * 22, rowY!);
      await page.waitForTimeout(200);
    }
    return rebuilds(page);
  };

  const counts = [await measureDrag(), await measureDrag(), await measureDrag()];
  expect(
    Math.min(...counts),
    `card must not be rebuilt while dragging within one row (saw ${counts.join(", ")})`
  ).toBeLessThanOrEqual(2);
});
