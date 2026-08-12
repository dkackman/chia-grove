import type { SproutEvent } from "@grove/shared";
import type { CardMeta } from "../themes/types.js";
import { mojosToXch, mojosToCAT, shortHex } from "./format.js";
import { resolveMedia, nftMediaEl, sensitiveMediaEl } from "./media.js";
import { spacescanLink, mintgardenLink } from "./links.js";

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
    const media = resolveMedia(event);
    if (media.render === "art") {
      card.appendChild(nftMediaEl(media.src, media.kind));
    } else if (media.render === "blur") {
      const node = sensitiveMediaEl(event, media);
      node.classList.add("sensitive");
      card.appendChild(node);
      card.appendChild(el("div", "media-note", "sensitive content"));
    } else if (media.render === "placeholder") {
      card.appendChild(el("div", "media-note", "media unavailable"));
    }
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
  const spacescan = spacescanLink(event, agg?.count);
  a.href = spacescan.href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = spacescan.label;
  linkDiv.appendChild(a);
  card.appendChild(linkDiv);

  const mintgarden = mintgardenLink(event.nftId);
  if (mintgarden) {
    const mgDiv = el("div");
    const mg = document.createElement("a");
    mg.href = mintgarden.href;
    mg.target = "_blank";
    mg.rel = "noopener";
    mg.textContent = mintgarden.label;
    mgDiv.appendChild(mg);
    card.appendChild(mgDiv);
  }

  card.classList.add("visible");
}

export function hideCard(): void {
  const card = document.getElementById("card") as HTMLDivElement;
  card.classList.remove("visible");
}
