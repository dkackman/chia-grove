import type { SproutEvent } from "@grove/shared";
import { mojosToXch, shortHex } from "../../ui/format.js";

export interface PlacardLink {
  label: string;
  href: string;
}

export interface Placard {
  title: string;
  meta: string;
  coin: string;
  launcher: string | null;
  links: PlacardLink[];
}

/** Pure placard content for a focused piece (DOM-free, unit-tested). */
export function placardModel(event: SproutEvent): Placard {
  const links: PlacardLink[] = [
    { label: "view on spacescan ↗", href: `https://www.spacescan.io/coin/0x${event.coinId}` },
  ];
  if (event.nftId) {
    links.push({ label: "view on mintgarden ↗", href: `https://mintgarden.io/nfts/${event.nftId}` });
  }
  return {
    title: "NFT mint",
    meta: `${mojosToXch(event.amount)} XCH · block ${event.height}`,
    coin: `coin ${shortHex(event.coinId)}`,
    launcher: event.launcherId ? `launcher ${shortHex(event.launcherId)}` : null,
    links,
  };
}

/** A theme-owned DOM placard; created once, shown/hidden as pieces gain focus. */
export class Placard$ {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "gallery-label";
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  show(event: SproutEvent): void {
    const model = placardModel(event);
    this.el.replaceChildren();
    const h = document.createElement("h3");
    h.textContent = model.title;
    this.el.appendChild(h);
    for (const line of [model.meta, model.coin, model.launcher]) {
      if (!line) continue;
      const d = document.createElement("div");
      d.className = line === model.meta ? "" : "dim";
      d.textContent = line;
      this.el.appendChild(d);
    }
    for (const link of model.links) {
      const wrap = document.createElement("div");
      const a = document.createElement("a");
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = link.label;
      wrap.appendChild(a);
      this.el.appendChild(wrap);
    }
    this.el.hidden = false;
    this.el.classList.add("visible");
  }

  hide(): void {
    this.el.classList.remove("visible");
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
