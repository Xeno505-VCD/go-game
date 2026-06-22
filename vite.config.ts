import { defineConfig } from 'vite';

export default defineConfig({
  base: '/go-game/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
