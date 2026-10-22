import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('./bms', import.meta.url));

export default defineConfig({
  root: appRoot,
  build: {
    rollupOptions: {
      input: {
        main: resolve(appRoot, 'index.html'),
        calculator: resolve(appRoot, 'calculator.html'),
        guide: resolve(appRoot, 'guide.html'),
      },
    },
  },
});
