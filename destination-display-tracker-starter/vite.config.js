import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages deployment uses the repository name as BASE_PATH.
  // Set VITE_BASE_PATH=/your-repository-name/ in GitHub Actions.
  base: process.env.VITE_BASE_PATH || '/',
})
