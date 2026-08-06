import { clusterApiUrl } from '@solana/web3.js'

export type NetworkId = 'devnet' | 'mainnet-beta'

export interface NetworkOption {
  id: NetworkId
  label: string
  endpoint: string
  explorerCluster: string
}

// Kendi RPC sağlayıcınız varsa (Helius, QuickNode, Alchemy vb.) buradaki
// public endpoint'leri kendi URL'lerinizle değiştirmeniz önerilir; public
// RPC'ler hız sınırlıdır.
export const NETWORKS: Record<NetworkId, NetworkOption> = {
  devnet: {
    id: 'devnet',
    label: 'Devnet (Test Ağı)',
    endpoint: clusterApiUrl('devnet'),
    explorerCluster: '?cluster=devnet',
  },
  'mainnet-beta': {
    id: 'mainnet-beta',
    label: 'Mainnet (Gerçek Ağ)',
    endpoint: clusterApiUrl('mainnet-beta'),
    explorerCluster: '',
  },
}

// ---------------------------------------------------------------------------
// Hizmet ücreti (opsiyonel)
// ---------------------------------------------------------------------------
// Bu siteyi kendi ürününüz olarak yayınlarsanız, token oluşturma işleminden
// küçük bir ücret almak isteyebilirsiniz (smithii.io gibi araçların iş modeli
// budur). Ücret, kullanıcı cüzdanından SİZİN belirlediğiniz cüzdana, aynı
// işlem (transaction) içinde şeffaf biçimde gönderilir; kullanıcı cüzdanında
// alıcı adresini ve tutarı imzalamadan önce görür.
//
// Ücret almak istemiyorsanız FEE_WALLET değerini boş bırakın, otomatik
// olarak devre dışı kalır.
export const FEE_WALLET = '' // ör: 'YourSolanaWalletAddressHere...'
export const FEE_AMOUNT_SOL = 0.1

export const DEFAULT_DECIMALS = 9
export const DEFAULT_NETWORK: NetworkId = 'devnet'
