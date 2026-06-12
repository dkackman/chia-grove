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

const VIDEO_EXT = new Set([".mp4", ".webm", ".ogv", ".mov"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".oga", ".flac", ".aac"]);

function nftMediaEl(url: string): HTMLElement {
  const ext = url.match(/\.[a-z0-9]+(?=[?#]|$)/i)?.[0]?.toLowerCase() ?? "";
  if (VIDEO_EXT.has(ext)) {
    const v = document.createElement("video");
    v.src = url;
    v.controls = true;
    v.muted = true;
    v.loop = true;
    return v;
  }
  if (AUDIO_EXT.has(ext)) {
    const a = document.createElement("audio");
    a.src = url;
    a.controls = true;
    return a;
  }
  const img = document.createElement("img");
  img.src = url;
  img.alt = "NFT";
  img.loading = "lazy";
  return img;
}

export function showCard(event: SproutEvent): void {
  const card = document.getElementById("card") as HTMLDivElement;
  card.replaceChildren();

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
  } else if (event.imageUrl) {
    card.appendChild(nftMediaEl(event.imageUrl));
  }

  card.appendChild(el("div", undefined, `${mojosToXch(event.amount)} XCH · block ${event.height}`));
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
