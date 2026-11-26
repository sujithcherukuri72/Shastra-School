import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Read API_PORT from the repo-root .env so both apps agree on the port.
  const env = loadEnv(mode, '../..', '');
  const apiPort = env.API_PORT || '4100';
  return {
    plugins: [react(), tailwindcss()],
    // Pre-bundle every runtime library up front so the dev server never re-optimises mid-session
    // (which leaves an open tab blank with "504 Outdated Optimize Dep").
    optimizeDeps: {
      include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router', '@tanstack/react-query', 'recharts', 'lucide-react', 'clsx'],
    },
    server: {
      port: 5173,
      strictPort: true,
      host: 'localhost',
      // Same-origin in development too, so cookies and CSRF behave exactly as in production.
      // 127.0.0.1 (not "localhost") so we never hit another app listening on ::1.
      proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
    // assetsInlineLimit 0: never inline fonts/images as data: URLs, so the strict production CSP
    // (font-src 'self') applies cleanly.
    build: { outDir: 'dist', sourcemap: false, target: 'es2023', chunkSizeWarningLimit: 900, assetsInlineLimit: 0 },
  };
});
