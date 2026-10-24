import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  // Set BASE_PATH=/crtvd/ when deploying under a path, e.g. GitHub Pages.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  worker: { format: 'es' },
});
