import { WebUploader } from '@irys/web-upload'
import { WebSolana } from '@irys/web-upload-solana'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { NETWORKS, type NetworkId } from '../config'

// Logoyu ve metadata JSON'unu üçüncü taraf bir hesap/servise ihtiyaç
// duymadan, doğrudan kullanıcının bağlı Solana cüzdanıyla ödeyerek Irys/
// Arweave ağına kalıcı olarak yazıyoruz. Kayıt, API anahtarı ya da başka
// bir siteye gitmeye gerek yok — küçük bir görsel için ücret genellikle
// bir SOL'un binde birinden azdır ve cüzdanda normal bir işlem olarak
// onaylanır.

export interface OnChainMetadataInput {
  name: string
  symbol: string
  description: string
  website: string
  twitter: string
  telegram: string
}

async function getIrysUploader(wallet: WalletContextState, network: NetworkId) {
  const builder = WebUploader(WebSolana)
    .withProvider(wallet)
    .withRpc(NETWORKS[network].endpoint)

  if (network === 'devnet') {
    builder.devnet()
  }

  return builder
}

async function ensureFunded(
  irys: Awaited<ReturnType<typeof getIrysUploader>>,
  bytes: number,
  onStatus?: (status: string) => void,
) {
  const price = await irys.getPrice(bytes)
  const balance = await irys.getLoadedBalance()

  if (price.isGreaterThan(balance)) {
    onStatus?.('Depolama ücreti için cüzdanınızda onay bekleniyor...')
    const topUp = price.minus(balance).multipliedBy(1.15).integerValue()
    await irys.fund(topUp)
  }
}

export async function uploadLogoAndMetadata(
  file: File,
  input: OnChainMetadataInput,
  wallet: WalletContextState,
  network: NetworkId,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.('Ağa bağlanılıyor...')
  const irys = await getIrysUploader(wallet, network)

  onStatus?.('Logo için bakiye kontrol ediliyor...')
  await ensureFunded(irys, file.size, onStatus)

  onStatus?.('Logo kalıcı olarak ağa yükleniyor...')
  const imageReceipt = await irys.uploadFile(file)
  const imageUrl = `https://gateway.irys.xyz/${imageReceipt.id}`

  const metadataJson = {
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    image: imageUrl,
    external_url: input.website || undefined,
    extensions: {
      website: input.website || undefined,
      twitter: input.twitter || undefined,
      telegram: input.telegram || undefined,
    },
    properties: {
      files: [{ uri: imageUrl, type: file.type || 'image/png' }],
      category: 'image',
    },
  }
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadataJson))
  const metadataFile = new File([metadataBytes], 'metadata.json', {
    type: 'application/json',
  })

  onStatus?.('Metadata için bakiye kontrol ediliyor...')
  await ensureFunded(irys, metadataBytes.byteLength, onStatus)

  onStatus?.('Metadata kalıcı olarak ağa yükleniyor...')
  const metadataReceipt = await irys.uploadFile(metadataFile)

  return `https://gateway.irys.xyz/${metadataReceipt.id}`
}
