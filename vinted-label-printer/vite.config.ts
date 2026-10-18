import { defineConfig } from 'vite';

export default defineConfig({
  // Relative, so the build works from any path: a subfolder, a file share, a NAS.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    // pdf.js is most of the bundle and cannot be split smaller; it is loaded once.
    chunkSizeWarningLimit: 1000,
  },
});
