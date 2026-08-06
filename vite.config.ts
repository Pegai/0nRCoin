import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages proje sitesi https://<kullanici>.github.io/0nRCoin/ altında
// yayınlanacağı için base path repo adıyla eşleşmeli.
export default defineConfig({
  base: '/0nRCoin/',
  plugins: [react()],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Solana wallet-adapter / web3.js paketleri tarayıcıda Buffer bekliyor.
      buffer: 'buffer',
    },
  },
})
