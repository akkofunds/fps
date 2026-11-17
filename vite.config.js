import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// content hash of public/models: appended to model URLs so a new model is never hidden behind a
// browser-cached old one (models are cached for a day)
const modelsHash = (() => {
  const h = createHash('sha1');
  try { for (const f of readdirSync('public/models').sort()) h.update(f).update(readFileSync('public/models/' + f)); } catch { /* ignore */ }
  return h.digest('hex').slice(0, 10);
})();
export default defineConfig({
  define: { __MODELS_VER__: JSON.stringify(modelsHash) },
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
