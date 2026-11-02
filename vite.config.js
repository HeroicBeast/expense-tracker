import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base: './'` keeps every asset URL relative so the static export works when
// served from a sub-path such as https://user.github.io/expense-tracker/.
// The app uses HashRouter, so deep links / refreshes never hit a GitHub Pages 404.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // The Arena preview proxies the app under a per-session host name; allow it
  // (and any other host) so dev/preview servers are reachable there.
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
