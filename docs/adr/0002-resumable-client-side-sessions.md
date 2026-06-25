---
status: accepted
---

# Resumable client-side sessions in IndexedDB

Loading a batch CSV creates a **Session** whose entire working set — all parsed rows, each photo's flag state, the current page-of-50 cursor, and the status (*in progress* / *finished*) — is persisted in IndexedDB. The start screen lists Sessions by **CSV filename + load timestamp + status**; clicking one resumes work at the saved page. The cursor is persisted at **page-of-50 granularity** (resume lands on the page, not the exact photo), and is rewritten every time the reviewer pages back/forth. The session CSV can be downloaded from within the session or from the start screen, and status can be flipped between *in progress* and *finished* at will.

## Considered Options

Persisting only flags keyed by `PhotoId` (requiring the reviewer to re-pick the CSV on every reopen) was rejected: it makes accidental closes costly and risks overlaying flags onto the wrong file. Persisting the whole working set makes reopen invisible.

## Consequences

- Sessions live in **one browser's IndexedDB**. Switching browser/machine or clearing storage loses them — the durable artifact is the **downloaded CSV**, so reviewers must download to preserve or hand off work.
- Session identity is just "a loaded CSV instance" (filename + timestamp). Loading the same CSV twice yields **two independent Sessions** with no merge/dedup.
- Resume is page-accurate, not photo-accurate.
