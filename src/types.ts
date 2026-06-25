// Shared domain constants for the CSV contract (ADR-0003).
// The row/session record shapes live with the persistence layer in
// `db/schema.ts` (PhotoRow / SessionRecord); the UI consumes those directly.

export const PHOTO_TYPE_ORDER = [
  'default', // front face
  '7', // left of front
  '19', // right of front
  '13', // back
  'text',
  'marketing',
  'ecommerce',
  'show-box-front',
] as const

export type SessionStatus = 'in progress' | 'finished'

export const PAGE_SIZE = 50
