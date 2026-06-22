import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const appVersion = process.env.VITE_APP_VERSION || pkg.version
const buildStamp = process.env.VITE_BUILD_STAMP || new Date().toISOString()
const buildCommit = process.env.VITE_GIT_SHA || process.env.GIT_SHA || 'local'

function versionFilePlugin() {
  return {
    name: 'rally-version-file',
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? 'dist'
      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        path.join(outDir, 'version.json'),
        `${JSON.stringify({
          version: appVersion,
          buildStamp,
          buildCommit,
        }, null, 2)}\n`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_STAMP__: JSON.stringify(buildStamp),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [
    vue(),
    tailwindcss(),
    basicSsl(),
    versionFilePlugin(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.ico',
        'favicon.png',
        'apple-touch-icon.png',
        'pacer-logo.png',
        'icons/pacer-logo-192.png',
        'icons/pacer-logo-512.png',
        'icons/pacer-maskable-192.png',
        'icons/pacer-maskable-512.png',
      ],
      manifest: {
        name: 'Pacer',
        short_name: 'Pacer',
        description: 'Rally pacing, route notes, telemetry, ghosts, and drive-mode navigation for real roads.',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        theme_color: '#070b11',
        background_color: '#070b11',
        icons: [
          {
            src: '/icons/pacer-logo-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pacer-logo-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pacer-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/pacer-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Drive',
            short_name: 'Drive',
            description: 'Open the drive cockpit.',
            url: '/?shortcut=drive',
            icons: [
              {
                src: '/icons/pacer-logo-192.png',
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
          {
            name: 'Stage',
            short_name: 'Stage',
            description: 'Open the stage builder.',
            url: '/?shortcut=stage',
            icons: [
              {
                src: '/icons/pacer-logo-192.png',
                sizes: '192x192',
                type: 'image/png',
              },
            ],
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(?:tile\.openstreetmap\.org|[a-d]\.basemaps\.cartocdn\.com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxEntries: 600,
                maxAgeSeconds: 60 * 60 * 24 * 14,
              },
            },
          },
          {
            urlPattern: /^https:\/\/router\.project-osrm\.org\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'osrm-routes',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        timeout: 30_000,
        proxyTimeout: 30_000,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
