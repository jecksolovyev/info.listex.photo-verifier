---
status: accepted
---

# Keyboard-first navigation; Spacebar toggles in place

Navigation has two tiers over a per-photo **cursor** (the blue outline) within page-of-50 paging:

- **Step:** `←`/`→` or `A`/`D` move the cursor photo-to-photo and **roll over page edges** — stepping past the last photo loads the next page at its first photo; stepping back past the first loads the previous page at its last.
- **Page jump:** `Cmd`/`Ctrl` + (`←`/`→` or `A`/`D`), and the on-screen **Next/Prev Page** buttons, flip a whole page at once and land the cursor on the **first photo of the destination page** (both directions). These buttons replace the spec's "Skip to Next" — nothing is skipped, it is plain pagination.

**Spacebar** toggles the focused photo's flag and **leaves the cursor in place**, so a second press re-toggles the same photo.

## Deviation from spec

The original spec had Spacebar **auto-advance** the cursor after flagging. We deliberately do not: keeping the cursor put makes a flag instantly reversible with a repeat press and gives the reviewer explicit control of movement. Recorded so it is not "corrected" back to auto-advance.

## Consequences

- Resume lands at the **top of the saved page** (page-accurate, per [ADR-0002](./0002-resumable-client-side-sessions.md)).
- Any page becoming visible (via step roll-over, page jump, or resume) fills its blank `UserId`s, per [ADR-0003](./0003-batch-csv-contract.md).
