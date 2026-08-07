import {
  Raydium,
  TxVersion,
  Percent,
  PoolFetchType,
  DEVNET_PROGRAM_ID,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  getCpmmPdaAmmConfigId,
  type ApiV3PoolInfoStandardItemCpmm,
  type CpmmKeys,
  type ApiV3Token,
} from '@raydium-io/raydium-sdk-v2'
import { Connection, PublicKey } from '@solana/web3.js'
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import type { NetworkId } from '../config'

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112'

export interface MintRef {
  address: string
  decimals: number
  programId: string
}

// Raydium'un kendi token listesi çoğunlukla Raydium'a kayıtlı (bilinen)
// mint'leri tanır; yeni oluşturulmuş bir token için bu genelde boş döner.
// Bu yüzden decimals/program bilgisini doğrudan zincirden okuyoruz — bu,
// bu siteyle az önce oluşturulmuş bir token için de sorunsuz çalışır.
export async function getMintInfo(connection: Connection, mintAddress: string): Promise<MintRef> {
  const mintPubkey = new PublicKey(mintAddress)
  const accountInfo = await connection.getAccountInfo(mintPubkey)
  if (!accountInfo) throw new Error('Mint adresi bulunamadı. Adresi kontrol edin.')

  const programId = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID

  const mint = await getMint(connection, mintPubkey, undefined, programId)
  return {
    address: mintAddress,
    decimals: mint.decimals,
    programId: programId.toBase58(),
  }
}

function toApiToken(mint: MintRef): Pick<ApiV3Token, 'address' | 'decimals' | 'programId'> {
  return { address: mint.address, decimals: mint.decimals, programId: mint.programId }
}

// Havuz arama/görüntüleme gibi salt okunur işlemler cüzdan gerektirmez;
// yalnızca işlem imzalayan fonksiyonlar (oluşturma, likidite ekleme/çekme)
// bağlı bir cüzdan ister.
export async function loadRaydium(
  connection: Connection,
  wallet: WalletContextState,
  network: NetworkId,
): Promise<Raydium> {
  return Raydium.load({
    connection,
    owner: wallet.publicKey ?? undefined,
    signAllTransactions: wallet.signAllTransactions,
    cluster: network === 'devnet' ? 'devnet' : 'mainnet',
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: 'confirmed',
  })
}

export interface PoolSummary {
  id: string
  type: string
  mintA: { address: string; symbol: string; decimals: number }
  mintB: { address: string; symbol: string; decimals: number }
  price: number
  tvl: number
  feeRatePct: number
  mintAmountA: number
  mintAmountB: number
}

function toSummary(pool: {
  id: string
  type: string
  mintA: ApiV3Token
  mintB: ApiV3Token
  price: number
  tvl: number
  feeRate: number
  mintAmountA: number
  mintAmountB: number
}): PoolSummary {
  return {
    id: pool.id,
    type: pool.type,
    mintA: { address: pool.mintA.address, symbol: pool.mintA.symbol || '?', decimals: pool.mintA.decimals },
    mintB: { address: pool.mintB.address, symbol: pool.mintB.symbol || '?', decimals: pool.mintB.decimals },
    price: pool.price,
    tvl: pool.tvl,
    feeRatePct: pool.feeRate * 100,
    mintAmountA: pool.mintAmountA,
    mintAmountB: pool.mintAmountB,
  }
}

// Raydium'un havuz arama/listeleme API'si yalnızca Mainnet verisini indeksler.
export async function searchPoolsByMint(
  raydium: Raydium,
  mint1: string,
  mint2?: string,
): Promise<PoolSummary[]> {
  const res = await raydium.api.fetchPoolByMints({
    mint1,
    mint2: mint2 || undefined,
    type: PoolFetchType.All,
  })
  return res.data.map(toSummary)
}

export async function getPoolById(
  raydium: Raydium,
  poolId: string,
  network: NetworkId,
): Promise<{ poolInfo: ApiV3PoolInfoStandardItemCpmm; poolKeys?: CpmmKeys }> {
  if (network === 'mainnet-beta') {
    const data = await raydium.api.fetchPoolById({ ids: poolId })
    const poolInfo = data[0] as ApiV3PoolInfoStandardItemCpmm
    if (!poolInfo) throw new Error('Havuz bulunamadı.')
    return { poolInfo }
  }
  const data = await raydium.cpmm.getPoolInfoFromRpc(poolId)
  return { poolInfo: data.poolInfo, poolKeys: data.poolKeys }
}

async function getCpmmFeeConfig(raydium: Raydium, network: NetworkId) {
  const feeConfigs = await raydium.api.getCpmmConfigs()
  if (network === 'devnet') {
    feeConfigs.forEach((config) => {
      config.id = getCpmmPdaAmmConfigId(
        DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
        config.index,
      ).publicKey.toBase58()
    })
  }
  return feeConfigs[0]
}

export interface CreatePoolResult {
  txId: string
  poolId: string
}

export async function createCpmmPool(
  raydium: Raydium,
  network: NetworkId,
  mintA: MintRef,
  mintB: MintRef,
  uiAmountA: string,
  uiAmountB: string,
  onStatus?: (status: string) => void,
): Promise<CreatePoolResult> {
  onStatus?.('Ücret ayarları alınıyor...')
  const feeConfig = await getCpmmFeeConfig(raydium, network)

  const programId =
    network === 'devnet' ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM : CREATE_CPMM_POOL_PROGRAM
  const poolFeeAccount =
    network === 'devnet' ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC : CREATE_CPMM_POOL_FEE_ACC

  const mintAAmount = new BN(new Decimal(uiAmountA).mul(10 ** mintA.decimals).toFixed(0))
  const mintBAmount = new BN(new Decimal(uiAmountB).mul(10 ** mintB.decimals).toFixed(0))

  onStatus?.('Havuz işlemi hazırlanıyor...')
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId,
    poolFeeAccount,
    mintA: toApiToken(mintA),
    mintB: toApiToken(mintB),
    mintAAmount,
    mintBAmount,
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    addSupportMintExt: true,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
  })

  onStatus?.('Cüzdanınızda onay bekleniyor...')
  const { txId } = await execute({ sendAndConfirm: true })

  return { txId, poolId: extInfo.address.poolId.toBase58() }
}

export async function addCpmmLiquidity(
  raydium: Raydium,
  poolInfo: ApiV3PoolInfoStandardItemCpmm,
  poolKeys: CpmmKeys | undefined,
  uiAmount: string,
  baseIn: boolean,
  onStatus?: (status: string) => void,
): Promise<string> {
  const decimals = baseIn ? poolInfo.mintA.decimals : poolInfo.mintB.decimals
  const inputAmount = new BN(new Decimal(uiAmount).mul(10 ** decimals).toFixed(0))

  onStatus?.('Likidite ekleme işlemi hazırlanıyor...')
  const { execute } = await raydium.cpmm.addLiquidity({
    poolInfo,
    poolKeys,
    inputAmount,
    baseIn,
    slippage: new Percent(1, 100),
    txVersion: TxVersion.V0,
  })

  onStatus?.('Cüzdanınızda onay bekleniyor...')
  const { txId } = await execute({ sendAndConfirm: true })
  return txId
}

export async function withdrawCpmmLiquidity(
  raydium: Raydium,
  poolInfo: ApiV3PoolInfoStandardItemCpmm,
  poolKeys: CpmmKeys | undefined,
  lpUiAmount: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  const lpAmount = new BN(new Decimal(lpUiAmount).mul(10 ** poolInfo.lpMint.decimals).toFixed(0))

  onStatus?.('Likidite çekme işlemi hazırlanıyor...')
  const { execute } = await raydium.cpmm.withdrawLiquidity({
    poolInfo,
    poolKeys,
    lpAmount,
    slippage: new Percent(1, 100),
    txVersion: TxVersion.V0,
  })

  onStatus?.('Cüzdanınızda onay bekleniyor...')
  const { txId } = await execute({ sendAndConfirm: true })
  return txId
}
