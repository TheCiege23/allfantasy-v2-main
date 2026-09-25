import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@': resolve(__dirname, '../..') } },
  esbuild: { jsx: 'automatic' },
  define: { 'process.env': {} },
  server: { host: '127.0.0.1', port: 5190, strictPort: true, fs: { allow: [resolve(__dirname, '../..')] } },
})
