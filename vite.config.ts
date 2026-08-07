import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// GitHub Pages proje sitesi https://<kullanici>.github.io/0nRCoin/ altında
// yayınlanacağı için base path repo adıyla eşleşmeli.
export default defineConfig({
  base: '/0nRCoin/',
  plugins: [
    react(),
    // Irys/Solana kütüphaneleri tarayıcıda Node'un crypto/stream/buffer gibi
    // yerleşik modüllerini bekliyor; bunlar olmadan görsel yükleme (Irys)
    // sırasında runtime hatası oluşur.
    nodePolyfills({
      include: ['crypto', 'stream', 'buffer', 'util', 'process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
})
