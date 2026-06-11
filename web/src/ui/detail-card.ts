import type { SproutEvent } from "@grove/shared";
import { mojosToXch, shortHex } from "./format.js";

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

export function showCard(event: SproutEvent): void {
  const card = document.getElementById("card") as HTMLDivElement;
  const title =
    event.kind === "nft" && event.mint ? "NFT mint" : KIND_LABELS[event.kind];

  card.replaceChildren();

  card.appendChild(el("h3", undefined, title));

  if (event.imageUrl) {
    const img = document.createElement("img");
    img.src = event.imageUrl;
    img.alt = "NFT";
    img.loading = "lazy";
    card.appendChild(img);
  }

  card.appendChild(
    el("div", undefined, `${mojosToXch(event.amount)} XCH · block ${event.height}`)
  );
  card.appendChild(el("div", "dim", `coin ${shortHex(event.coinId)}`));

  if (event.assetId) {
    card.appendChild(el("div", "dim", `asset ${shortHex(event.assetId)}`));
  }
  if (event.launcherId) {
    card.appendChild(el("div", "dim", `launcher ${shortHex(event.launcherId)}`));
  }

  const linkDiv = el("div");
  const a = document.createElement("a");
  a.href = `https://www.spacescan.io/coin/0x${event.coinId}`;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "view on spacescan ↗";
  linkDiv.appendChild(a);
  card.appendChild(linkDiv);

  card.hidden = false;
}

export function hideCard(): void {
  const card = document.getElementById("card") as HTMLDivElement;
  card.hidden = true;
}
