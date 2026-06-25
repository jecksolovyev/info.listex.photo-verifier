# Visual Audit (Photo Verifier)

A browser-only tool for **mass visual QA of FMCG product photos**. A reviewer flips
through grids of product images and **flags** the bad ones so they can be sent for
correction. The audit covers ~385,216 photos, split into per-reviewer CSV batches
exported from listex.

There is **no backend**. Photos load directly from their `listex.info` URLs, each
reviewer loads a **CSV batch** via a file-picker (never uploaded), working state
autosaves to **IndexedDB**, and results export as CSV. See `docs/adr/` and
`CONTEXT.md` for the locked design.

## Stack

React 18 + Vite 5 + TypeScript SPA. `idb` for IndexedDB, PapaParse for CSV
streaming. Two screens switched by app state — no router (ADR-0005).

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # tsc + vite build → dist/
npm run preview  # serve the built dist/ locally
```

### Tests

```sh
npm test            # vitest run (data layer: import/sort/export/attribution)
npm run test:watch  # watch mode
```

Tests use `fake-indexeddb`, so they run in plain Node with no browser.

### Try it

`npm run dev`, enter a Reviewer ID, and load `sample-batch.csv`. (That sample uses
one real image plus fabricated UUIDs — the fabricated ones 404 and render the
broken-image placeholder, so you can see both states.)

### Generate a real test batch

`gen-test-batch.sh` builds a larger batch CSV from the live Listex catalog API
(`api.listex.info`). It picks N random FMCG products that have photos and emits
every photo as a row in the 9-column batch contract (ADR-0003), so you get real
images, real GTINs, and a realistic sort/grid to exercise. Needs `node` and `curl`.

```sh
LISTEX_API_KEY=xxxx ./gen-test-batch.sh            # 60 products → test-batch.csv
./gen-test-batch.sh 100 big.csv                    # 100 products → big.csv
```

The API key is read from `LISTEX_API_KEY`, falling back to the `listex-catalog`
entry in `.mcp.json`. Output is UTF-8 with a BOM (so Excel reads the Cyrillic);
the importer strips the BOM, so it still round-trips.

## Deploy

Hosted as a **Render Static Site** for a stable https origin. The blueprint lives in
`render.yaml` (build `npm ci && npm run build`, publish `./dist`, with a
`/* → /index.html` rewrite so the SPA serves on any path).
