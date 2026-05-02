import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

// Při každém buildu vytvoří unikátní cache name pro service worker.
// Formát: "<verze>-<timestamp>"  (např. "1.3.18-1714659012345")
const BUILD_ID = `${pkg.version}-${Date.now()}`

// Plugin: po skončení buildu nahradí __BUILD_ID__ ve výsledném dist/sw.js.
// Soubory z public/ Vite kopíruje mimo bundle, takže je třeba je přepsat na disku.
import { readFileSync as fsReadFile, writeFileSync as fsWriteFile, existsSync as fsExistsSync } from 'node:fs'
function replaceBuildId() {
  return {
    name: 'replace-build-id',
    apply: 'build',
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/sw.js')
      if (!fsExistsSync(swPath)) return
      const original = fsReadFile(swPath, 'utf8')
      const replaced = original.replace(/__BUILD_ID__/g, BUILD_ID)
      if (replaced !== original) {
        fsWriteFile(swPath, replaced, 'utf8')
        // eslint-disable-next-line no-console
        console.log(`[replace-build-id] dist/sw.js → BUILD_ID = ${BUILD_ID}`)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), replaceBuildId()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
