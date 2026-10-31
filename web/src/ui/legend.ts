import { switchTheme, THEMES } from "../themes/index.js";
import type { Visualization } from "../themes/types.js";

const COLLAPSED_KEY = "grove.legend.collapsed";

export interface LegendHandle {
  /** Collapse or expand the legend (same as clicking its toggle). */
  toggle(): void;
}

export function initLegend(active: Visualization): LegendHandle {
  const legend = document.getElementById("legend") as HTMLDivElement;

  const header = document.createElement("button");
  header.id = "legend-toggle";
  header.type = "button";
  header.setAttribute("aria-controls", "legend-body");

  const body = document.createElement("div");
  body.id = "legend-body";

  const picker = document.createElement("label");
  picker.id = "legend-scene";
  picker.append("scene");
  const select = document.createElement("select");
  select.id = "scene-selector";
  for (const theme of THEMES) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    option.selected = theme.id === active.id;
    select.appendChild(option);
  }
  wireThemeSelect(select, active.id);
  picker.appendChild(select);

  const list = document.createElement("ul");
  for (const [swatchClass, label] of active.legend) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `sw ${swatchClass}`;
    item.append(swatch, label);
    list.appendChild(item);
  }
  body.append(picker, list, buildTipJar());

  let collapsed = localStorage.getItem(COLLAPSED_KEY) === "1";
  const render = () => {
    body.hidden = collapsed;
    header.setAttribute("aria-expanded", String(!collapsed));
    header.setAttribute("aria-label", collapsed ? "Show legend" : "Hide legend");
    if (collapsed) {
      header.textContent = "ⓘ";
    } else {
      // title left, ✕ pushed to the right edge (the button is a flex row)
      const title = document.createElement("span");
      title.textContent = "chia grove";
      const close = document.createElement("span");
      close.textContent = "✕";
      close.setAttribute("aria-hidden", "true");
      header.replaceChildren(title, close);
    }
    legend.classList.toggle("collapsed", collapsed);
  };
  const toggle = () => {
    collapsed = !collapsed;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    render();
  };
  header.addEventListener("click", toggle);

  legend.append(header, body);
  render();
  legend.hidden = false;
  return { toggle };
}

/**
 * Switching scenes reloads the page, so only switch on an explicit commit. On
 * Windows/Linux, arrow keys on a *closed* <select> change its value and fire
 * `change` on every press — that must not reload. Such a change is dispatched
 * in the same task as its keydown, so a flag cleared by a 0 ms timeout tells it
 * apart from a pick made in an opened list (mouse, touch, or Enter in macOS's
 * popup), which commits immediately. A keyboard-browsed value commits on Enter
 * or when focus leaves the select.
 */
function wireThemeSelect(select: HTMLSelectElement, activeId: string): void {
  let fromKey = false;
  let committed = false;
  const commit = () => {
    if (committed || select.value === activeId) return;
    committed = true;
    switchTheme(select.value);
  };
  select.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Escape") {
      select.value = activeId; // abandon a keyboard-browsed choice
      return;
    }
    fromKey = true;
    setTimeout(() => (fromKey = false), 0);
  });
  select.addEventListener("change", () => {
    if (!fromKey) commit();
  });
  select.addEventListener("blur", commit);
}

// xchtip.app embeddable tip widget. The script boots on load, finds its own
// <script> tag, and mounts the button inline right after it — so injecting it
// into our own container lands the button here in the legend, on every scene.
function buildTipJar(): HTMLDivElement {
  const tip = document.createElement("div");
  tip.id = "legend-tip";

  const script = document.createElement("script");
  script.src = "https://xchtip.app/embed/xch-tip.js";
  script.async = true;
  script.dataset.recipient = "xch1tjmpazqs9vnylc40ygw4xtq6e760nha3l8cw8kp3jx5rrq79krxqs5pg0g";
  script.dataset.asset = "xch";
  script.dataset.scheme = "green";
  script.dataset.variant = "inline";
  tip.appendChild(script);

  return tip;
}
