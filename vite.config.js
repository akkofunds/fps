import { defineConfig } from 'vite';
import { devMiddleware } from './server/adminCore.js';

// /api/admin during `vite` / `vite preview` (in-memory admin list; Vercel runs api/admin.js)
const adminApi = () => {
  const mw = devMiddleware();
  const mount = (server) => { server.middlewares.use('/api/admin', (req, res, next) => (req.method === 'POST' ? mw(req, res) : next())); };
  return { name: 'magebreak-admin-api', configureServer: mount, configurePreviewServer: mount };
};

export default defineConfig({
  plugins: [adminApi()],
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
