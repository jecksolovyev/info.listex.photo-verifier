# Visual Audit (Photo Verifier)

The domain language for a browser-based tool that lets a reviewer rapidly flip through batches of FMCG product photos and flag the defective ones for correction.

## Language

**Reviewer**:
The person running a review session and flagging photos. Audit output is attributed to their ID.
_Avoid_: Moderator, operator, user.

**Flag**:
To mark a photo as defective and needing correction (verb). A photo so marked is **Flagged**, recorded as `Flagged=YES` in the CSV. Toggleable on and off.
_Avoid_: Reject, Брак, defect, bad photo, error.

**Batch**:
A fixed set of photos assigned to one reviewer, distributed as a CSV file. The input artifact a reviewer is handed.
_Avoid_: Job, assignment, task.

**Session**:
A Batch loaded into the tool, with its working state persisted (flags, page cursor, and status). Resumable across sittings and survives closing the browser. Listed on the start screen by CSV filename + load timestamp. Has a **Status** of *in progress* or *finished*, which the reviewer can toggle freely.
_Avoid_: Run, sitting, job.

**UserId**:
The current Reviewer's identifier, entered once on the start screen and persisted for this browser. Recorded as the `UserId` column, it marks who reviewed a photo: a row's `UserId` is set to the current reviewer when the reviewer **navigates off** its Page (Next/Prev/go-to — filling blanks only; merely displaying a page marks nothing), when its flag is toggled (overwriting), or when the Session is marked **finished** (filling every remaining blank). A **blank** `UserId` means the photo has never been reviewed by anyone. Round-trips through the CSV.
_Avoid_: Author, editor, owner.

**Page**:
A fixed group of 50 consecutive photos within a Session — the unit of navigation, of the saved cursor, and of marking rows as reviewed.
_Avoid_: Screen, batch, set.

**GTIN**:
The product's barcode number, shown in the enlarged photo view for cross-checking the product online.
_Avoid_: Barcode (when the numeric value is meant), SKU, UPC.

**PhotoType**:
The role of a photo within a product's image set, used to order photos. Canonical order: `default` (front face) → `7` (left of front) → `19` (right of front) → `13` (back) → `text` → `marketing` → `ecommerce` → `show-box-front`; unknown/blank sorts last.
_Avoid_: Angle, view, category.

**PhotoDate**:
A `yyyy-mm-dd` date supplied in the CSV; the tool is agnostic to what it represents. Immutable; used as the oldest-first tiebreaker when ordering same-type photos, and shown in the popup.
_Avoid_: Created, timestamp, publication date.
