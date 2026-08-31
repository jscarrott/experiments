import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build targets from one source tree:
//   `vite build`            -> a normal static site (dist/)
//   `vite build --mode artifact` -> one self-contained HTML with Three.js inlined.
//
// The single-file target exists because the Artifact viewer enforces a CSP that
// blocks nearly every external fetch. Inlining everything means the published page
// makes no network requests at all, so there is nothing for the CSP to block.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'artifact' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Inlining only works if everything lands in a single chunk.
    assetsInlineLimit: mode === 'artifact' ? 100_000_000 : 4096,
  },
}));
