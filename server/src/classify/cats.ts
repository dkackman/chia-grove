interface CatInfo {
  name: string;
  ticker: string;
  iconUrl: string;
}

interface DexieAsset {
  id: string;
  name: string | null;
  code: string | null;
}

const DEXIE_API = "https://api.dexie.space/v1";
const DEXIE_ICONS = "https://icons.dexie.space";
const REFRESH_MS = 60 * 60 * 1000;

export class CatRegistry {
  private map = new Map<string, CatInfo>();
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    await this.refresh().catch((e) => console.warn("cat registry initial load failed:", e));
    this.timer = setInterval(() => {
      this.refresh().catch((e) => console.warn("cat registry refresh failed:", e));
    }, REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  lookup(assetId: string): CatInfo | undefined {
    return this.map.get(assetId.toLowerCase());
  }

  private async refresh(): Promise<void> {
    const next = new Map<string, CatInfo>();
    let page = 1;

    while (true) {
      const res = await fetch(`${DEXIE_API}/assets?page_size=100&page=${page}&type=cat`);
      if (!res.ok) throw new Error(`Dexie API ${res.status}`);
      const data = (await res.json()) as { assets: DexieAsset[] };
      if (!Array.isArray(data.assets) || data.assets.length === 0) break;

      for (const asset of data.assets) {
        if (asset.name && asset.code) {
          next.set(asset.id.toLowerCase(), {
            name: asset.name,
            ticker: asset.code,
            iconUrl: `${DEXIE_ICONS}/${asset.id}.webp`,
          });
        }
      }
      page++;
    }

    this.map = next;
    console.log(`cat registry: ${next.size} CATs loaded`);
  }
}
