import { defineConfig } from 'vite';

export default defineConfig({
  // absolute base so /admin (served by the same client) resolves assets; VITE_BASE=./ for sub-path hosts
  base: process.env.VITE_BASE || '/',
  build: {
    target: 'es2019',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], peerjs: ['peerjs'] },
      },
    },
  },
  server: { host: true },
});
