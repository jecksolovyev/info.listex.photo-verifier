# Tasks — Visual Audit (Photo Verifier)

Roadmap from prototype → finished app. The app is built and working: the full
review flow (CSV import → IndexedDB → grid review → CSV export) is implemented and
covered by tests. Remaining work is deploy (GitHub + Render) plus a couple of
loose ends below.

No issue tracker is configured for this repo, so this file is the task list.
Status: `[ ]` todo · `[~]` in progress · `[x]` done.

## 1. Data layer (CSV import → IndexedDB)  ✅ done
Replaces `src/mockData.ts` with the real ADR-0003/0002 machinery.
Modules: `src/db/{schema,import,photos,sessions}.ts`, `src/csv/{contract,export}.ts`.

- [x] IndexedDB schema via `idb`: `sessions` + `photos` stores, `bySort`
      (`[sessionId, gtin, photoTypeRank, sortDate]`) and `byPosition`
      (`[sessionId, position]`) indexes.  `src/db/schema.ts`
- [x] CSV contract: header match by name (case-insensitive), delimiter
      auto-detect (`,`/`;`), UTF-8/BOM, strict-refuse validation of the 7
      immutable columns + per-row `PhotoId`/`PhotoURI`, `Flagged`/`UserId`
      optional on import.  `src/csv/contract.ts`
- [x] Streaming import (PapaParse chunk + pause/resume): insert rows unsorted
      (flat heap), precompute `photoTypeRank`; per-session `PhotoId` de-dupe
      (keep first) with a warning count.  `src/db/import.ts`
- [x] IndexedDB-performed sort: single cursor pass over `bySort` stamps the
      sequential `position` (0…N-1). Memory stays ~flat 1K→390K rows.
- [x] CSV export: round-trip to the 9-column input shape, all fields quoted,
      UTF-8 **with BOM**, comma delimiter; only `Flagged`/`UserId` changed.
      `src/csv/export.ts`
- [x] Tests (vitest + fake-indexeddb): sort correctness, validation refusal,
      de-dupe, round-trip export, attribution invariant.  `src/db/import.test.ts`
      (10 tests, `npm test`)
- [ ] Browser-only nicety: enable PapaParse `worker: true` for File imports
      (parse off the main thread) — wired at the call site in Step 3.

## 2. Real images + paged mounting  ✅ done
- [x] Rewrite `PhotoURI` first path segment → `300x200` (grid) / `med` (popup);
      preserve the rest byte-for-byte.  `src/urls.ts` (+ `src/urls.test.ts`)
- [x] Read only the current page's 50 from IndexedDB by `position` range;
      preload the next page's thumbnails. Runtime no longer holds the whole
      working set in memory.  `ReviewScreen`
- [x] Broken-image placeholder now points at live listex URLs.  `PhotoTile`/`PhotoPopup`

## 3. Wire React to the data layer  ✅ done
- [x] `App.tsx`: real File-picker import; session list/open/delete from
      IndexedDB; cumulative stat; working Download (round-trip CSV).
- [x] `ReviewScreen`: windowed page reads; flag toggle + page-view + finish
      attribution writes go through IndexedDB (attribution invariant).
- [x] Removed the DevBar + `src/mockData.ts`. Prototype `Photo`/`Session` types
      retired; UI consumes `PhotoRow`/`SessionRecord`.
- [x] Verified: `tsc` clean, `vite build` clean, 13 tests pass, app boots on
      IndexedDB (real empty state). `sample-batch.csv` added for manual testing.

## 4. Loose ends (CLAUDE.md "still open")
- [x] Responsive grid column count — `repeat(auto-fill, minmax(168px, 1fr))`
      in `src/styles.css`; exact breakpoints still open to tuning.
- [ ] Verify the go-to-page control at ~7,800 pages (`GoToPage` in `ReviewScreen`).

## 5. Tests + deploy
- [x] Tests for the attribution invariant (blank-fill on view, overwrite on
      flag, stamp-on-finish).  `src/db/import.test.ts` (attribution describe block)
- [~] Public GitHub repo + Render Static Site with `/* → /index.html` rewrite.
      Local scaffolding done: `git` repo initialized, `.gitignore`, `README.md`,
      and `render.yaml` (static site, `npm ci && npm run build` → `./dist`,
      `/* → /index.html` rewrite, Node 22). The `origin` remote is set to
      `git@github.com:jecksolovyev/info.listex.photo-verifier.git`. Remaining: make
      the first commit, push, and connect the repo on Render.
