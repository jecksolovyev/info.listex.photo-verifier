# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Visual Audit (Photo Verifier)

**Status: built and working, not yet deployed.** The full review flow (CSV import → IndexedDB → grid review → CSV export) is implemented and covered by tests; deploy is still deferred (see below). The design was settled in a grilling session; the authoritative records are **`CONTEXT.md`** (glossary) and **`docs/adr/`** (decisions). This section is the big-picture orientation — when it disagrees with an ADR, the ADR wins.

Source spec: Google Doc "Визуальный аудит 2025-2026" (Visual Audit), in Russian; UI must be **in English**.

### Commands

- `npm run dev` — Vite dev server (local development).
- `npm run build` — `tsc` typecheck then `vite build` (output to `dist/`).
- `npm run preview` — serve the production build locally.
- `npm test` — run the Vitest suite once. `npm run test:watch` for watch mode.
- Run a single test file: `npx vitest run src/db/import.test.ts`. Filter by name: `npx vitest run -t "resume"`.
- Typecheck without building: `npx tsc --noEmit`.
- No linter/formatter is configured.

### Code layout (`src/`)

- `App.tsx` — top-level state machine: two screens (`start` / `review`) switched by app state, **no router** (ADR-0005). Persists `userId` and the currently-open session id to `localStorage` so a browser refresh resumes the review screen.
- `main.tsx` / `styles.css` — React entry point and global styles.
- `components/` — `StartScreen`, `ReviewScreen`, `PhotoTile`, `PhotoPopup` (+ `.test.tsx`).
- `db/` — the IndexedDB data layer (heavy work, outside React): `schema.ts` (stores, indexes, sort keys), `import.ts` (streaming CSV → staged rows → sort pass that stamps sequential `position`), `photos.ts` (page reads, flag/review stamping), `sessions.ts` (session records + running counters), `resume.test.ts`.
- `csv/` — `contract.ts` (column contract + strict-refuse validation), `import-edge-cases.test.ts`, `export.ts` (round-trip CSV out).
- `stats.ts` — the 3-number stat (`flagged · reviewed · loaded`) shown per-session and cumulatively.
- `urls.ts` — derive thumbnail/`med` image URLs and the goods-editor / Google-search links from a row.
- `types.ts` — shared CSV-contract constants (`PHOTO_TYPE_ORDER`, `PAGE_SIZE`, `SessionStatus`). Row/session record shapes live in `db/schema.ts`.
- `test/` — Vitest helpers (`db.ts` reset, `setup.ts`). Config in `vitest.config.ts` uses `fake-indexeddb/auto` for the data-layer tests.

### Purpose

A tool for **mass visual QA of FMCG product photos**. A reviewer rapidly flips through grids of product images and **flags** the bad ones so they can be sent for correction. The audit covers ~**385,216 photos**, split into per-reviewer batches loaded from listex-exported CSVs.

### Architecture (see ADRs)

- **[ADR-0001] Browser-only static app, no backend.** Photos load directly from their `listex.info` URLs; each reviewer gets a **CSV batch** (loaded via file-picker, never uploaded); state autosaves to **IndexedDB**; results export as CSV. Hosted as a **Render Static Site** (stable https origin). A single batch may be the **full audit (~390K photos)**; only the current page's 50 images are mounted, next page preloaded.
- **[ADR-0002] Resumable client-side sessions.** Loading a CSV creates a **Session** (whole working set + page cursor + status in IndexedDB), listed on the start screen by filename + load time. Resumable across browser closes; page-accurate resume.
- **[ADR-0003] Batch CSV contract.** 9 columns: `GoodId · Good_Name · GTIN · PhotoURI · PhotoId · PhotoType · PhotoDate · Flagged · UserId`. Round-trips (output = input shape). `Flagged`/`UserId` are the only mutable columns; `UserId` = who reviewed a row (filled on page view for blanks, overwritten on flag toggle; blank = never reviewed). Sort: **GTIN → PhotoType rank → PhotoDate asc**, performed **by IndexedDB at import** (streaming insert + compound index → sequential `position` key) to keep import memory flat at any batch size. Strict-refuse validation; UTF-8/BOM, quoted, delimiter auto-detect.
- **[ADR-0004] Keyboard-first navigation.** `←/→` or `A/D` step the cursor (rolling over page edges); `Cmd/Ctrl +` those keys (and Next/Prev buttons) jump a page; **Spacebar toggles the flag in place** — no auto-advance (deliberate deviation from spec). Blue border = focus, red = flagged.
- **[ADR-0005] React + Vite + TypeScript** static SPA, with `idb` (IndexedDB) and PapaParse (worker streaming). Two screens switched by app state — no router. Heavy work (parse/sort/IndexedDB) lives outside React.

### Screens

- **Start screen** — a `UserId` field (entered once, persisted); **Load batch CSV**; a **session list** (filename + load time + status + 3-number stat, with Open / Download / Delete — delete requires typing the filename); a **cumulative** stat across all sessions: `N flagged · N reviewed out of N loaded`.
- **Review screen** — grid of **50 thumbnails/page**, session progress + the per-session 3-number stat, blue-framed focus cursor. **Enter or double-click** opens a single-photo **popup**: `med` image, copyable **GTIN**, `Good_Name`, `PhotoDate`, **Open in goods editor** (`a.listex.info/goods/edit?GoodId=…`, new tab) and **Search with Google** (new tab, `Good_Name`+GTIN query); Spacebar flags inside it; red/blue border reflects flag state. **Broken image URLs** become flaggable placeholders, never blocking. Stopping mid-session behaves identically to reaching the end of the batch (state is already persisted).

### Still open

- Responsive grid column count is implemented; the exact breakpoints are still open to tuning. The go-to-page control for large (~7,800-page) batches is built (`GoToPage` in `ReviewScreen.tsx`).
- **Deploy still deferred:** `render.yaml` is present, but the Render Static Site (with `/* → /index.html` rewrite) is set up *after* the build is fully tested. Develop and run locally until then. **Note: this repo is now a git repository; the `origin` remote points at `git@github.com:jecksolovyev/info.listex.photo-verifier.git` (nothing pushed yet).**

## Notes for future work

Keep this section current as the app evolves — especially the Commands and Code layout sections above when files move or scripts change.

## Agent skills

Engineering skills (from `mattpocock/skills`) are installed under `.agents/skills/<name>/`, each with a `SKILL.md`. They are **not** registered in Claude Code's native skill paths (`.claude/skills/`, `~/.claude/skills/`), so they don't surface as `/`-invokable commands. To use one, read `.agents/skills/<name>/SKILL.md` and follow its process (other tools like Cursor/Gemini read the same files directly). `skills-lock.json` records their source and versions. The per-repo config below is what those skills consult at run time.

### Issue tracker

No issue tracker is configured for this repo. Skills that read or write issues (`to-issues`, `triage`, `to-prd`, `qa`) should ask the user how to proceed rather than assuming `gh`/`glab`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) — recorded but inert, since no issue tracker is configured. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by the skills when needed). See `docs/agents/domain.md`.
