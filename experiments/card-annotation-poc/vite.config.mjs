import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'bundle-entry.mjs',
      formats: ['es'],
      fileName: () => 'recogito.js',
    },
    minify: 'esbuild',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
