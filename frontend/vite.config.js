import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
var here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
    plugins: [react()],
    resolve: {
        // Resolve @plynth/shared to its SOURCE so no prebuild step is required.
        alias: { '@plynth/shared': resolve(here, '../shared/src/index.ts') },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': { target: 'http://localhost:3000', changeOrigin: true },
        },
    },
});
