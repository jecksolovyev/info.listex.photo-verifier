---
status: accepted
---

# Batch CSV contract and round-trip semantics

A batch is one CSV with these columns: `GoodId` · `Good_Name` · `GTIN` · `PhotoURI` · `PhotoId` · `PhotoType` · `PhotoDate` · `Flagged` (YES/NO) · `UserId`. The same shape is both input and output — downloading a session re-emits the **entire CSV** with updated `Flagged` and `UserId`, so a result file can be fed straight back in to review, re-flag, or audit attribution. `PhotoId` is the photo's stable identity; `GoodId` is the product's (one good has many photos). **`Flagged` and `UserId` are the only mutable columns**; the other seven are immutable source data (`PhotoDate` is a `yyyy-mm-dd` date supplied in the CSV — the tool is agnostic to what it represents — used only for sorting and popup display).

## Image sizing

`PhotoURI` stores the full URI; the **first path segment is the size**. We never request the stored size directly — we rewrite that segment to `300x200` for grid thumbnails and `med` for the enlarged view. (`orig` exists upstream but is unused.) The rest of the URI, including the extension, is preserved byte-for-byte.

## Ordering

Photos are sorted **at import** into a canonical order that is stored with the session; pages-of-50 run over this order and the export emits it. The sort is, in priority:

1. **GTIN** — groups every photo of one product together.
2. **PhotoType**, by fixed rank: `default` (front face, always first) → `7` (left of front) → `19` (right of front) → `13` (back) → `text` → `marketing` → `ecommerce` → `show-box-front`. Any unrecognised or blank `PhotoType` sorts **last**.
3. **PhotoDate ascending** (oldest first) — tiebreak when a product has multiple photos of the same type; blank dates sort last within their type group.

## Import strategy

The largest legitimate batch is the **entire audit (~390K photos) as a single CSV** — the spec permits it and we cannot cap it — so import must not scale memory with batch size. We therefore reject reading all rows into a JS array to sort them ("Option A": a ~390K array peaks ~0.5 GB and would risk crashing the largest, most important import on weaker machines).

Instead, **IndexedDB performs the sort**:

- **Stream-parse** the CSV off the main thread, inserting rows **one at a time** (flat heap), precomputing each row's `photoTypeRank`.
- A **compound index `[GTIN, photoTypeRank, PhotoDate]`** sorts on IndexedDB's disk-backed B-tree; a **single cursor pass** stamps the sequential **`position`** (0…N-1).
- At runtime, pages are read by **`position` range** (O(50)), the resume cursor is one integer, and arbitrary page jumps stay cheap — the compound index is an **import-time tool only**.

This holds import memory roughly constant from 1K to 390K rows, trading a slightly longer (extra-pass) import — already a progress-bar "loading" step — for memory safety. Option A remains viable only if batches were guaranteed small, which they are not.

## Attribution invariant

`UserId` records **who reviewed a row**, written by three triggers:

1. **Page navigated away from** — when the reviewer moves to another page (Next/Prev, the keyboard page-jump, or go-to-page), every row on the page they are *leaving* whose `UserId` is **blank** is filled with the current reviewer (reviewing without flagging still counts as reviewed). **Merely displaying a page marks nothing** — the reviewer must actively move off it. The page skipped *over* by a go-to jump are never displayed and so are never stamped; only the page actually left is.
2. **Flag toggled** — the row's `UserId` is set to the current reviewer, **overwriting** any existing value.
3. **Session marked finished** — every still-blank `UserId` in the batch is filled with the current reviewer (finishing asserts the whole batch is reviewed).

So a page the reviewer is *still on* (e.g. when they return to the session list, or the last page they stop on) is **not** stamped unless they paged off it or finished the session. A **blank `UserId` = never reviewed by anyone**. The current reviewer (`UserId`) is entered once on the start screen, persisted per-browser, and is free-form text.

## Import / export format

- **Encoding:** read UTF-8; write UTF-8 **with a BOM** so Excel renders Cyrillic `Good_Name`s. Fields are **always quoted** (RFC 4180) on export.
- **Headers:** a header row is required; columns are matched **by name, case-insensitively**, so order is free and unknown columns are ignored.
- **Delimiter:** **auto-detected** (comma or semicolon) on import; comma on export.
- **Optional on import:** `Flagged` and `UserId` may be absent (⇒ `NO` / blank). Export always writes all 9 columns.
- **Validation is strict-refuse:** the seven immutable columns (`GoodId`, `Good_Name`, `GTIN`, `PhotoURI`, `PhotoId`, `PhotoType`, `PhotoDate`) are required; if any is missing as a column, or a row lacks `PhotoId`/`PhotoURI`, or a row's **`GTIN` contains a non-digit** (the barcode is kept as a string so leading zeros survive, but must be all digits), the **whole file is rejected** with a description of exactly what must be fixed — rather than silently loading partial data.
- **`PhotoId` uniqueness is per-session:** it keys a row's flag/`UserId` state within a batch; duplicates **within one batch** are warned and de-duped (keep first). The same `PhotoId` may legitimately recur **across different sessions**.

## Consequences

- The output distinguishes three states per photo: never reviewed (blank `UserId`), reviewed-not-flagged (`UserId` set, `Flagged=NO`), reviewed-and-flagged (`UserId` set, `Flagged=YES`).
- Re-uploading a round-tripped CSV preserves prior `Flagged`/`UserId`; a later reviewer only changes rows they view (blanks) or toggle.
