// Shared test setup for jsdom (UI) test files.
//
// - jest-dom matchers (toBeInTheDocument, toHaveClass, …)
// - automatic React Testing Library cleanup after each test
// - fake-indexeddb globals (the DB-backed screens read/write IndexedDB)
//
// Node-environment data-layer tests pull fake-indexeddb in via the global
// `setupFiles` in vitest.config.ts; UI files opt into jsdom with a
// `// @vitest-environment jsdom` directive and import this file explicitly.

import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom implements neither of these; ReviewScreen keeps the focused tile in
// view, and PapaParse/preload touch Image — stub the missing bits.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
}

afterEach(() => {
  cleanup()
})
