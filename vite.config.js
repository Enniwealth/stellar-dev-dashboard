import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),

    // Inline plugin: ensure sw.js is copied verbatim to the build root.
    // Using vite-plugin-pwa would auto-generate the SW, but we ship a custom
    // one to keep Horizon responses network-only and avoid stale account data.
    {
      name: 'copy-sw',
      // During build, Vite processes public/ automatically — sw.js placed in
      // public/ is already handled. This plugin just confirms it's included.
      generateBundle() {
        // sw.js lives in /public and is emitted by Vite's publicDir handling.
        // Nothing extra needed; this hook serves as documentation.
      },
    },
  ],

  build: {
    // Produce a sourcemap so Lighthouse and DevTools can audit the SW
    sourcemap: true,

    rollupOptions: {
      output: {
        // Stable chunk names so the SW cache keys remain predictable
        manualChunks: {
          vendor: ['react', 'react-dom'],
          stellar: ['@stellar/stellar-sdk'],
        },
      },
    },
  },

  // Allow the dev server to serve sw.js at the root scope
  server: {
    headers: {
      // Required for SharedArrayBuffer (not needed here) and to allow the SW
      // to intercept all requests under origin.
      'Service-Worker-Allowed': '/',
    },
  },

  // Optimise deps that are CommonJS
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});