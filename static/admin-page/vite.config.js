import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// E2E_MOCK_BRIDGE=1 swaps @forge/bridge for an in-memory mock so the UI can
// run outside the Atlassian iframe (used by the Playwright suite).
const useMockBridge = process.env.E2E_MOCK_BRIDGE === '1';

export default defineConfig({
  plugins: [react()],
  base: './', // Crucial for Forge Custom UI relative assets loading
  resolve: {
    alias: useMockBridge
      ? { '@forge/bridge': fileURLToPath(new URL('./src/e2e-mocks/forge-bridge.js', import.meta.url)) }
      : {},
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  }
});
