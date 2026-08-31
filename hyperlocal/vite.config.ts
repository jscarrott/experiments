import { defineConfig } from 'vite';

// The dev server binds 127.0.0.1 rather than localhost deliberately: atproto's
// browser OAuth client accepts only http://127.0.0.1 and http://[::1] as loopback
// origins. Served from "localhost" the client redirects to the IP anyway, which
// loses any session already in storage, so bind the address it wants up front.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
