import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { outDir: 'out/backend', lib: { entry: resolve('src/backend/main.ts') } }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      externalizeDeps: false,
      lib: { entry: resolve('src/preload/index.ts'), formats: ['cjs'], fileName: () => 'index.cjs' }
    }
  },
  renderer: {
    root: 'src/frontend',
    plugins: [
      react(),
      {
        name: 'local-development-csp',
        apply: 'serve',
        transformIndexHtml(html) {
          return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
        }
      }
    ],
    build: {
      outDir: resolve('out/frontend'),
      rollupOptions: { input: resolve('src/frontend/index.html') }
    }
  }
})
