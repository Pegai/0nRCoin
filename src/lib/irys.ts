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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Devnet'te, Irys'in bundler node'u gönderdiğiniz SOL'u zincirde bazen
// birkaç saniye geç görebiliyor ve ilk denemede "confirmed tx not found"
// hatası verebiliyor — SOL genelde gönderilmiş oluyor, sadece onay
// gecikiyor. Bu yüzden bakiyeyi tekrar kontrol ederek birkaç kez deniyoruz.
async function ensureFunded(
  irys: Awaited<ReturnType<typeof getIrysUploader>>,
  bytes: number,
  onStatus?: (status: string) => void,
) {
  const price = await irys.getPrice(bytes)
  let balance = await irys.getLoadedBalance()
  if (!price.isGreaterThan(balance)) return

  onStatus?.('Depolama ücreti için cüzdanınızda onay bekleniyor...')
  const topUp = price.minus(balance).multipliedBy(1.15).integerValue()

  const maxAttempts = 4
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await irys.fund(topUp)
      return
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) {
        onStatus?.(`Ağ yanıt vermedi, tekrar deneniyor (${attempt}/${maxAttempts})...`)
        await sleep(5000 * attempt)
        balance = await irys.getLoadedBalance()
        if (!price.isGreaterThan(balance)) return
      }
    }
  }
  throw new Error(
    lastError instanceof Error
      ? `depolama ücreti gönderilemedi (ağ zaman aşımı) — ${lastError.message}`
      : 'depolama ücreti gönderilemedi (ağ zaman aşımı)',
  )
}

export async function uploadLogoAndMetadata(
  file: File,
  input: OnChainMetadataInput,
  wallet: WalletContextState,
  network: NetworkId,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.('Ağa bağlanılıyor...')
  let irys: Awaited<ReturnType<typeof getIrysUploader>>
  try {
    irys = await getIrysUploader(wallet, network)
  } catch (err) {
    throw stageError('Ağa bağlanılamadı', err)
  }

  onStatus?.('Logo için bakiye kontrol ediliyor...')
  try {
    await ensureFunded(irys, file.size, onStatus)
  } catch (err) {
    throw stageError('Logo ücreti gönderilemedi', err)
  }

  onStatus?.('Logo kalıcı olarak ağa yükleniyor...')
  let imageReceipt: Awaited<ReturnType<typeof irys.uploadFile>>
  try {
    imageReceipt = await irys.uploadFile(file)
  } catch (err) {
    throw stageError('Logo yüklenemedi', err)
  }
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
  try {
    await ensureFunded(irys, metadataBytes.byteLength, onStatus)
  } catch (err) {
    throw stageError('Metadata ücreti gönderilemedi', err)
  }

  onStatus?.('Metadata kalıcı olarak ağa yükleniyor...')
  try {
    const metadataReceipt = await irys.uploadFile(metadataFile)
    return `https://gateway.irys.xyz/${metadataReceipt.id}`
  } catch (err) {
    throw stageError('Metadata yüklenemedi', err)
  }
}

function stageError(prefix: string, err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err)
  return new Error(`${prefix}: ${detail}`)
}
