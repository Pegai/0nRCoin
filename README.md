# 0nRCoin — Solana Token Creator

Kod yazmadan, cüzdanınızı bağlayarak **Solana ağında gerçek bir SPL token**
oluşturmanızı sağlayan, tamamen istemci tarafında (client-side) çalışan bir
web arayüzü. Backend/sunucu gerektirmez; GitHub Pages gibi statik bir
hosting üzerinde çalışacak şekilde tasarlanmıştır.

[tools.smithii.io/token-creator](https://tools.smithii.io/token-creator) gibi
araçlardaki temel özellikleri hedefler: token adı/sembol/arz/decimals,
açıklama ve sosyal medya linkleri, opsiyonel metadata URI, mint/freeze
yetkisi kaldırma ve metadata'yı sabitleme (immutable) seçenekleri.

## Özellikler

- **Cüzdan bağlantısı**: Phantom ve Solflare (Solana Wallet Adapter).
- **Ağ seçimi**: Devnet (test) ve Mainnet (gerçek ağ) arasında geçiş.
- **Token oluşturma**: SPL Mint hesabı, ilişkili token hesabı (ATA) ve
  belirlenen arzın cüzdana basılması.
- **On-chain metadata**: Metaplex Token Metadata programı ile isim/sembol
  (ve varsa metadata URI) zincire yazılır.
- **Gelişmiş yetkiler**: Mint yetkisini kaldırma (arzı sabitleme), freeze
  yetkisini kaldırma, metadata'yı immutable yapma.
- **Güvenlik**: Özel anahtarlar hiçbir zaman siteden çıkmaz; her işlem
  kullanıcının kendi cüzdanında imzalanır.

## Yerel geliştirme

```bash
npm install
npm run dev
```

Üretim build'i almak için:

```bash
npm run build
npm run preview
```

## GitHub Pages'e yayınlama

Bu repoda `.github/workflows/deploy.yml` adında hazır bir GitHub Actions
workflow'u bulunur. Kurulum adımları:

1. GitHub'da repo **Settings → Pages** sayfasına gidin.
2. **Source** olarak **GitHub Actions**'ı seçin.
3. Bu dalı (branch) `main`'e merge edin (workflow `main`'e push'ta tetiklenir;
   dilerseniz Actions sekmesinden **Run workflow** ile elle de tetikleyebilirsiniz).
4. Birkaç dakika içinde siteniz `https://<kullanıcı-adınız>.github.io/0nRCoin/`
   adresinde yayında olur.

> Repo adını değiştirirseniz `vite.config.ts` içindeki `base: '/0nRCoin/'`
> değerini de yeni repo adıyla güncellemeniz gerekir.

## Yapılandırma

`src/config.ts` dosyasından değiştirebileceğiniz ayarlar:

- `DEFAULT_NETWORK`: Varsayılan ağ (`devnet` veya `mainnet-beta`).
- `FEE_WALLET` / `FEE_AMOUNT_SOL`: Bu siteyi kendi ürününüz olarak
  yayınlarsanız, token oluşturma işleminden opsiyonel bir hizmet ücreti
  almak için kendi cüzdan adresinizi girebilirsiniz. Boş bırakılırsa ücret
  alınmaz. Ücret alınsa dahi kullanıcı, cüzdanında işlemi onaylamadan önce
  alıcı adresini ve tutarı görür — hiçbir gizli/otomatik çekim yapılmaz.
- RPC uç noktaları: Yoğun kullanımda public RPC'ler hız sınırına takılabilir;
  kendi Helius/QuickNode/Alchemy gibi bir RPC sağlayıcınızın URL'sini
  `NETWORKS` içine eklemeniz önerilir.

## Metadata (logo/açıklama) hakkında

Token'ınızın logosunun ve açıklamasının cüzdanlarda/gezginlerde
görünebilmesi için isim/sembol/görsel içeren bir JSON dosyasının IPFS veya
Arweave gibi bir servise yüklenip linkinin "Metadata URI" alanına
girilmesi gerekir (bu proje bir pinning servisi entegre etmez, dilerseniz
kendi Pinata/NFT.Storage hesabınızla bu adımı ekleyebilirsiniz). Alan boş
bırakılırsa token yine sorunsuz oluşturulur, sadece zincir dışı görsel/açıklama
eklenmez.

## Önemli uyarılar

- Mainnet'te işlem yapmadan önce **Devnet üzerinde test edin**.
- Mint/freeze yetkisi kaldırma ve metadata'yı sabitleme işlemleri **geri
  alınamaz**.
- Kripto varlık oluşturmak ve dağıtmak, bulunduğunuz yargı bölgesine göre
  yasal sorumluluklar doğurabilir. Bu proje bir yatırım tavsiyesi değildir.

## Kullanılan teknolojiler

- [Vite](https://vite.dev/) + React + TypeScript
- [@solana/web3.js](https://github.com/solana-labs/solana-web3.js),
  [@solana/spl-token](https://github.com/solana-labs/solana-program-library)
- [@solana/wallet-adapter](https://github.com/anza-xyz/wallet-adapter)
- [@metaplex-foundation/mpl-token-metadata](https://github.com/metaplex-foundation/mpl-token-metadata)
