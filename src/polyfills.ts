import { Buffer } from 'buffer'

// Solana web3.js / wallet-adapter tarayıcıda Node'un global Buffer'ını bekliyor.
// Bu dosya, uygulamanın geri kalanı yüklenmeden ÖNCE çalışmalı, bu yüzden
// main.tsx'teki ilk import olarak eklenmiştir.
window.Buffer = window.Buffer || Buffer
