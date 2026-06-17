import { switchTheme, THEMES } from "../themes/index.js";
import type { Visualization } from "../themes/types.js";

const COLLAPSED_KEY = "grove.legend.collapsed";

export function initLegend(active: Visualization): void {
  const legend = document.getElementById("legend") as HTMLDivElement;

  const header = document.createElement("button");
  header.id = "legend-toggle";
  header.type = "button";

  const body = document.createElement("div");

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
  select.addEventListener("change", () => switchTheme(select.value));
  picker.appendChild(select);

  const list = document.createElement("ul");
  for (const [swatchClass, label] of active.legend) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `sw ${swatchClass}`;
    item.append(swatch, label);
    list.appendChild(item);
  }
  body.append(picker, list);

  let collapsed = localStorage.getItem(COLLAPSED_KEY) === "1";
  const render = () => {
    body.hidden = collapsed;
    if (collapsed) {
      header.textContent = "ⓘ";
    } else {
      // title left, ✕ pushed to the right edge (the button is a flex row)
      const title = document.createElement("span");
      title.textContent = "chia grove";
      const close = document.createElement("span");
      close.textContent = "✕";
      header.replaceChildren(title, close);
    }
    legend.classList.toggle("collapsed", collapsed);
  };
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    render();
  });

  legend.append(header, body);
  render();
  legend.hidden = false;
}
