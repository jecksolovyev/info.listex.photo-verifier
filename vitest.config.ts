import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // fake-indexeddb installs indexedDB + IDBKeyRange as globals
    setupFiles: ['fake-indexeddb/auto'],
  },
})
