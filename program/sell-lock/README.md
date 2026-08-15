# sell-lock — Anti-Snipe Satış Kilidi (Token-2022 Transfer Hook)

Bu, ana `0nRCoin` web sitesinden **ayrı**, zincir üzerinde çalışan bir Solana
programıdır (akıllı kontrat). Amaç: bir token havuzu kurulduktan sonra
seçilen bir süre boyunca (15 dk / 1 saat / 5 saat / 24 saat) **hiç kimsenin**
(havuzu kuran dahil) o havuza **satış** yapamaması — alım her zaman serbest
kalır. Süre dolunca hiçbir işlem gerekmeden otomatik olarak herkes için
satış açılır.

## Bu neden ayrı bir klasörde / neden henüz siteye bağlı değil

Web sitesi tamamen istemci tarafında çalışan bir React/TypeScript uygulaması
ve Claude'un çalıştığı ortamda **Rust/Anchor/Solana CLI kurulu değil, ayrıca
Solana ağına da (Devnet/Mainnet RPC, crates.io) ağ erişimi kapalı**. Yani bu
kod burada **yazıldı ama hiç derlenmedi, test edilmedi, deploy edilmedi**.
Sizin bilgisayarınızda derleyip Devnet'e deploy etmeniz, sonra karşılaştığınız
hata mesajlarını (varsa) bana iletmeniz gerekiyor — birlikte düzeltip
Devnet'te gerçekten çalıştığını doğruladıktan sonra web sitesine entegre
edeceğiz.

## Gerekli araçlar

1. **Rust**: https://www.rust-lang.org/tools/install
2. **Solana CLI**: https://docs.solanalabs.com/cli/install
3. **Anchor CLI** (önerilen yöntem, sürüm yöneticisi ile):
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```
4. Devnet'te SOL'ü olan bir cüzdan (deploy maliyeti için):
   ```bash
   solana config set --url devnet
   solana-keygen new  # veya mevcut anahtarınızı kullanın
   solana airdrop 2
   ```

## Derleme ve deploy adımları

```bash
cd program/sell-lock
anchor build
```

İlk `anchor build` muhtemelen bağımlılık sürüm uyuşmazlığı gibi hatalar
verecek — `Cargo.toml` içindeki sürümleri (`anchor-lang`, `anchor-spl`,
`spl-transfer-hook-interface`, `spl-tlv-account-resolution`) benim burada
doğrulayamadığımı, sizin ortamınızda gerçek sürümlerle eşleşmesi
gerekebileceğini unutmayın. **Aldığınız tam hata mesajını bana yapıştırın,
düzeltip tekrar deneriz.**

Derleme başarılı olduktan sonra:

```bash
anchor keys sync   # gerçek program ID'sini Anchor.toml + lib.rs'e yazar
anchor build       # yeni ID ile tekrar derle
anchor deploy      # Devnet'e deploy eder (Anchor.toml'daki cluster = devnet)
```

## Şu ana kadar yazılan instruction'lar

- `initialize_extra_account_meta_list` — Token-2022 mint'i Transfer Hook
  uzantısıyla oluşturduktan hemen sonra bir kez çağrılır.
- `register_launch(duration_seconds)` — havuz kurulduktan hemen sonra bir kez
  çağrılır; havuzun kasa adreslerini ve kilit süresini zincire kalıcı olarak
  yazar (aynı mint için ikinci çağrı başarısız olur — süre değiştirilemez).
- `execute` — Token-2022'nin her transferde otomatik çağırdığı asıl kilit
  mantığı: hedef, kayıtlı havuz kasalarından biriyse ve süre dolmadıysa
  reddeder.

## Bilinen, henüz ele alınmamış konular (v1 sınırlamaları)

- `register_launch` şu an **imza sahibi kim olursa olsun** çağrılabilir
  (yalnızca süre + kasa adresi doğrulaması var). Teorik olarak biri, gerçek
  havuz kurulmadan hemen önce/sonra bu çağrıyı sizin yerinize (ör. daha kısa
  bir süreyle) yapmaya çalışabilir. İlk sürümü çalışır hale getirdikten
  sonra, mint oluşturulurken kaydedilen bir "creator" PDA'sına karşı imza
  kontrolü ekleyerek bunu kapatacağız.
- Web sitesiyle (token oluşturma + havuz oluşturma akışlarına
  `initialize_extra_account_meta_list` / `register_launch` çağrılarının
  eklenmesi) entegrasyon henüz yapılmadı — program Devnet'te çalıştığı
  doğrulanınca yapılacak.

## Sıradaki adım

1. Yukarıdaki kurulumu yapın.
2. `anchor build` çalıştırın.
3. Çıkan (varsa) hatayı olduğu gibi bana gönderin.
