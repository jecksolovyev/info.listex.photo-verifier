import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser-only static SPA (ADR-0001/0005): no backend; data layer is
// CSV import → IndexedDB, results export as CSV.
export default defineConfig({
  plugins: [react()],
})
