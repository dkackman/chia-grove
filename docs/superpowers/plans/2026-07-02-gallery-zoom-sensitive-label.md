# Gallery Zoom: Blur + Label Sensitive/Blocked NFTs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a viewer zooms into a sensitive or blocked NFT on the gallery wall, the `.gallery-label` info panel shows the same blur+label treatment the shared `#card` popup already gives those NFTs on the other four themes.

**Architecture:** Share the DOM media-element helper (`nftMediaEl`) that `#card` already uses by moving it into `web/src/ui/media.ts`; extend the gallery placard's pure model function (`placardModel`) with a `media` field computed from the existing `resolveMedia()` resolver; render that field in `Placard$.render()` with new gallery-palette CSS. The gallery wall's 3D texture is untouched — only the DOM info panel changes.

**Tech Stack:** TypeScript, Vite, Vitest, plain DOM (no framework) for the panel; Three.js for the (unchanged) wall.

## Global Constraints

- No behavior change to the gallery wall's 3D wall texture — sensitive/blocked pieces keep the neutral striped placeholder there, focused or not (real art bytes are never fetched for wall display).
- Media for the panel is fetched only when a piece is focused (zoomed), never ambiently.
- Blocked NFTs get a "media unavailable" note in the panel (no media element, no src); sensitive NFTs get a blurred media element + "sensitive content" note. This mirrors `#card`'s existing `render === "placeholder"` / `render === "blur"` branches in `web/src/ui/detail-card.ts`.
- Panel styling must use the gallery's existing warm palette (`#ffe9c2` accent), not `#card`'s green — copy `#card`'s CSS _structure_, not its colors.

---

### Task 1: Share `nftMediaEl` via `web/src/ui/media.ts`

**Files:**

- Modify: `web/src/ui/media.ts`
- Modify: `web/src/ui/detail-card.ts`

**Interfaces:**

- Produces: `nftMediaEl(src: string, kind: MediaKind): HTMLElement`, exported from `web/src/ui/media.ts`. Task 3 imports this.

This is a pure relocation of existing, already-working code — no behavior changes, so no new test is added (this mirrors how `detail-card.ts`'s DOM building is untested today; correctness is verified by the full suite still passing and by the manual browser check in Task 4).

- [ ] **Step 1: Add `nftMediaEl` (and its private `createMediaEl` helper) to `web/src/ui/media.ts`**

Open `web/src/ui/media.ts`. Insert the following directly after the existing `escalateMediaKind` function (i.e., right before the `mediaSrc` function's doc comment):

```ts
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
export function nftMediaEl(src: string, kind: MediaKind): HTMLElement {
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
      if (code === MediaError.MEDIA_ERR_NETWORK || code === MediaError.MEDIA_ERR_ABORTED) {
        return;
      }
    }
    const next = escalateMediaKind(kind);
    if (next) node.replaceWith(nftMediaEl(src, next));
    else node.remove();
  });
  return node;
}
```

- [ ] **Step 2: Remove the duplicated functions from `web/src/ui/detail-card.ts` and import the shared one**

Replace the import line:

```ts
import { escalateMediaKind, resolveMedia, type MediaKind } from "./media.js";
```

with:

```ts
import { resolveMedia, nftMediaEl } from "./media.js";
```

Then delete these two function definitions entirely from `detail-card.ts` (they now live in `media.ts`):

```ts
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
      if (code === MediaError.MEDIA_ERR_NETWORK || code === MediaError.MEDIA_ERR_ABORTED) {
        return;
      }
    }
    const next = escalateMediaKind(kind);
    if (next) node.replaceWith(nftMediaEl(src, next));
    else node.remove();
  });
  return node;
}
```

`detail-card.ts`'s existing calls to `nftMediaEl(media.src, media.kind)` (in `showCard`) are unchanged — they now resolve to the imported function.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms no leftover references to the removed local functions or the now-unused `MediaKind`/`escalateMediaKind` imports in `detail-card.ts`).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: same pass count as before this change (no test references these functions directly, so none should newly fail or newly pass).

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/media.ts web/src/ui/detail-card.ts
git commit -m "$(cat <<'EOF'
Share nftMediaEl via ui/media.ts so gallery can reuse it

Relocates the blur-capable media-element helper (with its image → video
→ audio error-escalation retry) out of detail-card.ts so the gallery
placard can render the same blurred sensitive-content treatment.
EOF
)"
```

---

### Task 2: Add a `media` field to `placardModel`

**Files:**

- Modify: `web/src/themes/gallery/label.ts`
- Test: `web/test/gallery-label.test.ts`

**Interfaces:**

- Consumes: `resolveMedia(event: SproutEvent): MediaDisposition` and `type MediaDisposition` from `web/src/ui/media.js` (already exists; see `web/src/ui/media.ts`).
- Produces: `Placard.media: MediaDisposition`, populated by `placardModel()`. Task 3 consumes `model.media` in `Placard$.render()`.

- [ ] **Step 1: Write the failing tests**

Add to `web/test/gallery-label.test.ts` (after the existing tests, using the existing `base` fixture already defined at the top of the file):

```ts
test("media reflects the resolver: blur for sensitive, placeholder for blocked, art otherwise", () => {
  expect(placardModel({ ...base, mediaKind: "image", mediaFilter: "sensitive" }).media).toEqual({
    render: "blur",
    src: `/img?nft=${base.launcherId}`,
    kind: "image",
  });
  expect(placardModel({ ...base, mediaKind: "image", mediaFilter: "blocked" }).media).toEqual({
    render: "placeholder",
  });
  expect(placardModel({ ...base, mediaKind: "image" }).media).toEqual({
    render: "art",
    src: `/img?nft=${base.launcherId}`,
    kind: "image",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/gallery-label.test.ts`
Expected: FAIL — `model.media` is `undefined` (the `Placard` interface/`placardModel` don't produce it yet).

- [ ] **Step 3: Implement**

In `web/src/themes/gallery/label.ts`, add the import (alongside the existing `format.js` import):

```ts
import { resolveMedia, type MediaDisposition } from "../../ui/media.js";
```

Add `media` to the `Placard` interface:

```ts
export interface Placard {
  title: string;
  meta: string;
  coin: string;
  launcher: string | null;
  activity: string | null;
  links: PlacardLink[];
  media: MediaDisposition;
}
```

In `placardModel()`, add `media: resolveMedia(event)` to the returned object (alongside the existing `title`, `meta`, etc. fields):

```ts
return {
  title: event.mint ? "NFT mint" : "NFT",
  meta: `${mojosToXch(event.amount)} XCH · block ${event.height}`,
  coin: `coin ${shortHex(event.coinId)}`,
  launcher: event.launcherId ? `launcher ${shortHex(event.launcherId)}` : null,
  activity: count > 1 ? `${count} events` : null,
  links,
  media: resolveMedia(event),
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/gallery-label.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/label.ts web/test/gallery-label.test.ts
git commit -m "$(cat <<'EOF'
Add media disposition to gallery placardModel

Threads resolveMedia() through the pure placard model so the panel can
know whether a focused piece's art should render, blur, or show a
media-unavailable note — mirroring #card's existing resolver usage.
EOF
)"
```

---

### Task 3: Render the media block in `Placard$` + gallery-palette CSS

**Files:**

- Modify: `web/src/themes/gallery/label.ts`
- Modify: `web/src/style.css`

**Interfaces:**

- Consumes: `nftMediaEl(src, kind)` from `web/src/ui/media.js` (Task 1); `model.media: MediaDisposition` from `placardModel()` (Task 2).

- [ ] **Step 1: Import `nftMediaEl` in `label.ts`**

Update the import added in Task 2 to also pull in `nftMediaEl`:

```ts
import { resolveMedia, nftMediaEl, type MediaDisposition } from "../../ui/media.js";
```

- [ ] **Step 2: Insert the media block in `Placard$.render()`**

In `web/src/themes/gallery/label.ts`, find this block inside `private render()`:

```ts
    const model = placardModel(this.current.event, this.current.count);
    const head = document.createElement("div");
    head.className = "label-head";
    const h = document.createElement("h3");
    h.textContent = model.title;
    head.append(h, this.iconButton("✕", "collapse details", true));
    this.el.appendChild(head);

    if (model.activity) {
```

Replace it with (inserting the media block between the head and the activity pill, matching `#card`'s title → media → rest ordering):

```ts
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
```

- [ ] **Step 3: Add gallery-palette CSS**

In `web/src/style.css`, find this block:

```css
.gallery-label .activity {
  display: inline-block;
  margin-bottom: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #1a140a;
  background: #ffe9c2;
}
```

Insert immediately after its closing `}` (before the `/* play/pause button... */` comment that follows):

```css
.gallery-label img,
.gallery-label video {
  width: 100%;
  border-radius: 6px;
  margin: 8px 0;
  display: block;
}
.gallery-label img.sensitive,
.gallery-label video.sensitive {
  filter: blur(24px);
  pointer-events: none;
}
.gallery-label .media-note {
  margin: 8px 0;
  padding: 10px;
  border-radius: 6px;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(255, 233, 194, 0.7);
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed rgba(255, 233, 194, 0.3);
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: same pass count as Task 1's baseline plus the one new test from Task 2 (no regressions).

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/gallery/label.ts web/src/style.css
git commit -m "$(cat <<'EOF'
Blur + label sensitive/blocked NFTs in the gallery zoom panel

Focusing a sensitive NFT now shows a blurred rendition of the real art
plus a "sensitive content" note in the info panel, and a blocked NFT
shows "media unavailable" — matching the #card popup's treatment on
the other themes. The wall's 3D placeholder texture is unchanged.
EOF
)"
```

---

### Task 4: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev:web` (this alone is enough — demo mode doesn't need the WebSocket server on :8080)

- [ ] **Step 2: Open the gallery theme in demo mode**

Open `http://localhost:5173/?demo=1&theme=gallery` in a browser. `web/src/net/demo.ts` seeds roughly 6% of synthetic NFT events as `mediaFilter: "blocked"` and another ~12% as `"sensitive"` (see `filterRoll` checks around line 74), so within the first couple dozen mints both cases should appear.

- [ ] **Step 3: Zoom into a sensitive piece and confirm the panel**

Click a framed piece on the wall to focus it. If its panel shows a plain title/meta/links with no media block, click "collapse details" (✕) then the ⓘ pill to re-expand, or click a different piece, until one flagged sensitive is focused. Confirm:

- The wall's framed piece itself still shows the neutral striped placeholder (unchanged).
- The side panel shows a blurred image (or video) directly under the title.
- A dashed-border "sensitive content" note appears under the blurred media.

- [ ] **Step 4: Zoom into a blocked piece and confirm the panel**

Repeat for a piece whose panel should show blocked behavior. Confirm the panel shows a "media unavailable" note under the title, with no media element (since blocked NFTs never yield a src).

- [ ] **Step 5: Confirm unfiltered pieces are unchanged**

Focus a normal (unflagged) piece and confirm the panel looks exactly as it did before this change — no media block, no note, just title/meta/coin/launcher/links.

- [ ] **Step 6: Stop the dev server**

Report the outcome (pass/fail per sub-step above) before considering the feature complete, per this project's requirement to verify UI changes in a real browser rather than relying on typecheck/tests alone.
