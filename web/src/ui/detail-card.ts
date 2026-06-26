import type { SproutEvent } from "@grove/shared";
import type { CardMeta } from "../themes/types.js";
import { mojosToXch, mojosToCAT, shortHex } from "./format.js";
import { escalateMediaKind, mediaSrc, type MediaKind } from "./media.js";

const KIND_LABELS: Record<SproutEvent["kind"], string> = {
  xch: "XCH spend",
  cat: "CAT transfer",
  nft: "NFT",
  did: "DID",
};

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function createMediaEl(src: string, kind: MediaKind): HTMLElement {
  if (kind === "video") {
    const v = document.createElement("video");
    v.src = src;
    v.controls = true;
    v.muted = true;
    v.loop = true;
    return v;
  }
  if (kind === "audio") {
    const a = document.createElement("audio");
    a.src = src;
    a.controls = true;
    return a;
  }
  const img = document.createElement("img");
  img.src = src;
  img.alt = "NFT";
  img.loading = "lazy";
  return img;
}

// `mediaKind` is only a hint (guessed from the URL extension), so when an
// element can't play its source retry the next element type (image → video →
// audio) against the same cached /img URL. Fixes extensionless videos rendering
// as a black <img>; once the chain is exhausted the broken element is removed
// rather than shown.
function nftMediaEl(src: string, kind: MediaKind): HTMLElement {
  const node = createMediaEl(src, kind);
  node.addEventListener("error", () => {
    // A media element reports why it failed: a transient network/abort error
    // doesn't mean the element type is wrong, so don't downgrade the kind (a
    // hiccuping <video> would otherwise be permanently replaced by an <audio>).
    // Only a decode / unsupported-source error means the hint was wrong. An
    // <img> exposes no such reason, so any error escalates — its kind is only a
    // guess to begin with.
    if (node instanceof HTMLMediaElement) {
      const code = node.error?.code;
      if (
        code === MediaError.MEDIA_ERR_NETWORK ||
        code === MediaError.MEDIA_ERR_ABORTED
      ) {
        return;
      }
    }
    const next = escalateMediaKind(kind);
    if (next) node.replaceWith(nftMediaEl(src, next));
    else node.remove();
  });
  return node;
}

export function showCard(event: CardMeta): void {
  const card = document.getElementById("card") as HTMLDivElement;
  card.replaceChildren();

  // When the row folds several spends into one (board XCH/CAT aggregates), the
  // amount above is a block-wide total — so the card must not pin it to a single
  // coin's id or a per-coin explorer link, which would describe a different
  // value. A count of 1 is effectively a single spend; show it normally.
  const agg = event.aggregate && event.aggregate.count > 1 ? event.aggregate : null;

  const h3 = document.createElement("h3");
  if (event.kind === "nft" && event.mint) {
    h3.textContent = "NFT mint";
  } else if (event.catName) {
    h3.appendChild(document.createTextNode(event.catName));
    if (event.catTicker) {
      h3.appendChild(el("span", "ticker", event.catTicker));
    }
  } else {
    h3.textContent = KIND_LABELS[event.kind];
  }
  card.appendChild(h3);

  if (event.catIconUrl) {
    const img = document.createElement("img");
    img.src = event.catIconUrl;
    img.alt = event.catName ?? "CAT";
    img.loading = "lazy";
    img.className = "cat-icon";
    card.appendChild(img);
  } else {
    const src = mediaSrc(event);
    if (src) card.appendChild(nftMediaEl(src, event.mediaKind ?? "image"));
  }

  const amountLabel =
    event.kind === "cat"
      ? `${mojosToCAT(event.amount)} ${event.catTicker ?? "CAT"}`
      : `${mojosToXch(event.amount)} XCH`;
  card.appendChild(el("div", undefined, `${amountLabel} · block ${event.height}`));
  if (agg) {
    card.appendChild(el("div", "dim", `${agg.count} spends this block`));
  } else {
    card.appendChild(el("div", "dim", `coin ${shortHex(event.coinId)}`));
  }

  if (event.assetId) {
    card.appendChild(el("div", "dim", `asset ${shortHex(event.assetId)}`));
  }
  if (event.launcherId) {
    card.appendChild(el("div", "dim", `launcher ${shortHex(event.launcherId)}`));
  }

  const linkDiv = el("div");
  const a = document.createElement("a");
  // an aggregate points at the block (the total's scope); a single spend at the coin
  a.href = agg
    ? `https://www.spacescan.io/block/${event.height}`
    : `https://www.spacescan.io/coin/0x${event.coinId}`;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = agg ? "view block on spacescan ↗" : "view on spacescan ↗";
  linkDiv.appendChild(a);
  card.appendChild(linkDiv);

  if (event.nftId) {
    const mgDiv = el("div");
    const mg = document.createElement("a");
    mg.href = `https://mintgarden.io/nfts/${event.nftId}`;
    mg.target = "_blank";
    mg.rel = "noopener";
    mg.textContent = "view on mintgarden ↗";
    mgDiv.appendChild(mg);
    card.appendChild(mgDiv);
  }

  card.classList.add("visible");
}

export function hideCard(): void {
  const card = document.getElementById("card") as HTMLDivElement;
  card.classList.remove("visible");
}
