---
status: accepted
---

# Browser-only static app, no backend

The tool reviews a fixed, pre-distributed set of photos and emits a list of rejected IDs plus a per-reviewer count — none of which requires server-side logic. We will build it as a **static single-page app with no backend**: photos load directly from their `listex.info` URLs, each reviewer is handed their work as a **CSV batch** (loaded via an in-browser file-picker, never uploaded), marks are autosaved to **IndexedDB** for crash/close recovery, and results are exported as CSV files at stop or completion.

## Considered Options

A backend was rejected because the only thing that would force one — real-time coordination of a shared photo pool across concurrent reviewers — is explicitly out of scope: batches are distributed manually by the audit owner as non-overlapping CSVs.

A local `file://` HTML file was rejected because `file://` is an opaque origin where IndexedDB and local `fetch` are unreliable/blocked, which would undermine the "stop any time without losing marks" requirement.

## Consequences

- Must be served from a **stable https origin** (planned: a Render **Static Site**) so IndexedDB persists across visits; the app should call `navigator.storage.persist()` and warn against private/incognito windows.
- The photo set and results cross the boundary as **CSV files**, not API calls.
- Cross-reviewer coordination (splitting the ~385K photos into non-overlapping batches) is a **manual, out-of-band** responsibility of the audit owner.
- A single batch may be the **full audit (~390K photos, ~7,800 pages of 50)** — it is uncappable. Feasibility holds because only the **current page's 50 images are mounted** (with the next page preloaded; the browser's HTTP cache covers back-paging), and the rows live in **IndexedDB**, not in live DOM. Import streams into IndexedDB at constant memory and lets the DB sort (see [ADR-0003](./0003-batch-csv-contract.md)); per-session progress is tracked by a counter rather than re-scanning all rows.
