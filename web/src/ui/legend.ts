const COLLAPSED_KEY = "grove.legend.collapsed";

const ITEMS: Array<[swatchClass: string, label: string]> = [
  ["sw-grass", "grass — XCH spend (taller = larger)"],
  ["sw-cat", "mushroom — CAT transfer (color = asset)"],
  ["sw-nft", "bloom — NFT (bursts on mint)"],
  ["sw-did", "wisp — DID activity"],
  ["sw-firefly", "fireflies — mempool"],
  ["sw-moon", "moonlight — netspace"],
  ["sw-ripple", "ripple — new block"],
];

export function initLegend(): void {
  const legend = document.getElementById("legend") as HTMLDivElement;

  const header = document.createElement("button");
  header.id = "legend-toggle";
  header.type = "button";

  const body = document.createElement("ul");
  for (const [swatchClass, label] of ITEMS) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `sw ${swatchClass}`;
    item.append(swatch, label);
    body.appendChild(item);
  }

  let collapsed = localStorage.getItem(COLLAPSED_KEY) === "1";
  const render = () => {
    body.hidden = collapsed;
    header.textContent = collapsed ? "ⓘ" : "chia grove ✕";
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
