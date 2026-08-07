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
- **Likidite Havuzu sekmesi** (Raydium entegrasyonu):
  - **Havuz Ara**: Bir token'ın mevcut Raydium havuzlarını, fiyatını ve
    likiditesini görüntüleme (salt okunur, cüzdan gerekmez, yalnızca Mainnet).
  - **Havuz Oluştur**: İki token için Raydium CPMM (sabit-çarpım) havuzu
    oluşturma — Devnet ve Mainnet'te çalışır.
  - **Likidite Ekle/Çıkar**: Bilinen bir havuza likidite ekleme veya LP
    token'ı geri çekme.
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

## Logo yükleme hakkında

Formdaki "Logo" alanından bir görsel seçtiğinizde, token oluşturma
işlemiyle birlikte görsel ve metadata JSON'u **Irys** (Arweave üzerine
kalıcı yazan bir depolama ağı) üzerine yükleniyor — üçüncü taraf bir
siteye üye olmaya, API anahtarı almaya gerek yok. Yükleme, bağlı
Solana cüzdanınızdan ödenen küçük bir ücretle (genellikle bir SOL'un
binde birinden az) gerçekleşir ve cüzdanınızda normal bir işlem olarak
onaylamanız istenir. Görsel seçmezseniz token yine sorunsuz oluşturulur,
sadece zincir dışı logo/açıklama eklenmez.

## Önemli uyarılar

- Mainnet'te işlem yapmadan önce **Devnet üzerinde test edin**.
- Mint/freeze yetkisi kaldırma ve metadata'yı sabitleme işlemleri **geri
  alınamaz**.
- **Likidite havuzu oluşturma ve likidite ekleme/çıkarma işlemleri de geri
  alınamaz** ve gerçek token/SOL yatırmanızı gerektirir. Yanlış miktar
  girmek havuzun başlangıç fiyatını yanlış ayarlayabilir. Mutlaka önce
  Devnet'te deneyin.
- Kripto varlık oluşturmak ve dağıtmak, bulunduğunuz yargı bölgesine göre
  yasal sorumluluklar doğurabilir. Bu proje bir yatırım tavsiyesi değildir.

## Kullanılan teknolojiler

- [Vite](https://vite.dev/) + React + TypeScript
- [@solana/web3.js](https://github.com/solana-labs/solana-web3.js),
  [@solana/spl-token](https://github.com/solana-labs/solana-program-library)
- [@solana/wallet-adapter](https://github.com/anza-xyz/wallet-adapter)
- [@metaplex-foundation/mpl-token-metadata](https://github.com/metaplex-foundation/mpl-token-metadata)
- [Irys](https://irys.xyz/) (logo/metadata için kalıcı depolama)
- [@raydium-io/raydium-sdk-v2](https://github.com/raydium-io/raydium-sdk-V2) (likidite havuzu)
