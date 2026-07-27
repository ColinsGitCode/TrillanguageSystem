import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const variant = process.env.POC_VARIANT || 'baseline';
export default defineConfig({
  plugins: [react()],
  define: { __VARIANT__: JSON.stringify(variant) },
  build: { rollupOptions: { input: `src/main-${variant}.jsx` }, minify: 'esbuild', reportCompressedSize: true },
});
