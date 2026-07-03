import type { SproutEvent } from "@grove/shared";
import { mojosToXch, shortHex } from "../../ui/format.js";
import { resolveMedia, nftMediaEl, type MediaDisposition } from "../../ui/media.js";

export interface PlacardLink {
  label: string;
  href: string;
}

export interface Placard {
  title: string;
  meta: string;
  coin: string;
  launcher: string | null;
  activity: string | null;
  links: PlacardLink[];
  media: MediaDisposition;
}

/**
 * Pure placard content for a focused piece (DOM-free, unit-tested). `count` is
 * how many events that NFT has accumulated on the wall; the latest event's
 * details are shown, with a tally once it has been active more than once.
 */
export function placardModel(event: SproutEvent, count = 1): Placard {
  const links: PlacardLink[] = [
    { label: "view on spacescan ↗", href: `https://www.spacescan.io/coin/0x${event.coinId}` },
  ];
  if (event.nftId) {
    links.push({
      label: "view on mintgarden ↗",
      href: `https://mintgarden.io/nfts/${event.nftId}`,
    });
  }
  return {
    title: event.mint ? "NFT mint" : "NFT",
    meta: `${mojosToXch(event.amount)} XCH · block ${event.height}`,
    coin: `coin ${shortHex(event.coinId)}`,
    launcher: event.launcherId ? `launcher ${shortHex(event.launcherId)}` : null,
    activity: count > 1 ? `${count} events` : null,
    links,
    media: resolveMedia(event),
  };
}

const COLLAPSED_KEY = "grove.gallery.card.collapsed";

/**
 * A theme-owned DOM placard; created once, shown/hidden as pieces gain focus.
 * A ✕ collapses it to a small ⓘ pill (the art stays focused, just unobstructed);
 * the ⓘ restores the full card. The collapse choice persists across pieces and
 * sessions (parallel to the legend's collapse), so browsing stays clean once
 * dismissed. Focus changes keep the chosen state; only unfocus hides everything.
 */
export class Placard$ {
  private el: HTMLDivElement;
  private current: { event: SproutEvent; count: number } | null = null;
  private collapsed = localStorage.getItem(COLLAPSED_KEY) === "1";

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "gallery-label";
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  show(event: SproutEvent, count = 1): void {
    this.current = { event, count };
    this.render();
    this.el.hidden = false;
    this.el.classList.add("visible");
  }

  hide(): void {
    this.el.classList.remove("visible");
    this.el.hidden = true;
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    this.render();
  }

  private iconButton(glyph: string, label: string, collapse: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `label-btn ${collapse ? "label-close" : "label-info"}`;
    btn.textContent = glyph;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", () => this.setCollapsed(collapse));
    return btn;
  }

  private render(): void {
    if (!this.current) return;
    this.el.classList.toggle("collapsed", this.collapsed);
    this.el.replaceChildren();

    if (this.collapsed) {
      this.el.appendChild(this.iconButton("ⓘ", "show details", false));
      return;
    }

    const model = placardModel(this.current.event, this.current.count);
    const head = document.createElement("div");
    head.className = "label-head";
    const h = document.createElement("h3");
    h.textContent = model.title;
    head.append(h, this.iconButton("✕", "collapse details", true));
    this.el.appendChild(head);

    if (model.media.render === "blur") {
      const media = nftMediaEl(model.media.src, model.media.kind);
      media.classList.add("sensitive");
      this.el.appendChild(media);
      const note = document.createElement("div");
      note.className = "media-note";
      note.textContent = "sensitive content";
      this.el.appendChild(note);
    } else if (model.media.render === "placeholder") {
      const note = document.createElement("div");
      note.className = "media-note";
      note.textContent = "media unavailable";
      this.el.appendChild(note);
    }

    if (model.activity) {
      const a = document.createElement("div");
      a.className = "activity";
      a.textContent = model.activity;
      this.el.appendChild(a);
    }
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
  }

  dispose(): void {
    this.el.remove();
  }
}
