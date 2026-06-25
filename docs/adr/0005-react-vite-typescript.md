---
status: accepted
---

# React + Vite + TypeScript for the static SPA

The app is built with **React + Vite + TypeScript**, plus **`idb`** (a thin IndexedDB wrapper) and **PapaParse** (Web Worker streaming) for CSV. With only two screens (start ↔ review) and a handful of components (session list, grid, photo tile, popup), React's runtime/virtual-DOM memory is negligible relative to the data — which is already bounded by streaming import ([ADR-0003](./0003-batch-csv-contract.md)) and current-page image windowing ([ADR-0001](./0001-browser-only-static-app.md)) — and its component model and ecosystem speed building the UI. TypeScript pins the 9-column CSV contract; Vite emits the static bundle for Render.

## Considered Options

**Svelte** (compiles away, no runtime in memory) and **vanilla TS** (leanest) were weighed for low-end-laptop memory. Rejected: at two screens / few components the framework footprint is immaterial — the memory risks were architectural (the import array, on-screen images), already mitigated — so React's familiarity and ergonomics win.

## Consequences

- Screen switching (start ↔ review) is driven by **app state**, not a router library — one fewer dependency, and deep-linking isn't needed for an internal tool.
- Keep the component tree shallow; heavy work (parse, sort, IndexedDB) lives outside React in the worker and `idb` layer.
