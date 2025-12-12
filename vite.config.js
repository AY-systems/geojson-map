import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  // GitHub Pagesの場合、リポジトリ名を設定（例: '/geojson-map/'）
  // ユーザーサイト（username.github.io）の場合は '/' のまま
  base: '/geojson-map/',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist'
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'japan_municipalities.pmtiles', dest: '' },
        { src: 'public/search-data.json', dest: '' },
      ]
    })
  ]
})
