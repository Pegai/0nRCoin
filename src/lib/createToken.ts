import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from '@solana/spl-token'
import {
  PROGRAM_ID as METADATA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
} from '@metaplex-foundation/mpl-token-metadata'
import { FEE_WALLET, FEE_AMOUNT_SOL } from '../config'

export interface TokenFormData {
  name: string
  symbol: string
  decimals: number
  supply: string
  description: string
  imageUri: string
  website: string
  twitter: string
  telegram: string
  revokeMint: boolean
  revokeFreeze: boolean
  immutable: boolean
}

export interface CreateTokenResult {
  mint: string
  signature: string
  tokenAccount: string
}

function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )
  return pda
}

/**
 * Metadata JSON URI kullanıcı tarafından sağlanmazsa, on-chain metadata'yı
 * yine de name/symbol ile oluşturuyoruz (uri boş string olabilir); cüzdanlar
 * ve explorer'lar name/symbol'ü göstermeye devam eder.
 */
export async function createToken(
  connection: Connection,
  wallet: WalletContextState,
  data: TokenFormData,
  onStatus?: (status: string) => void,
): Promise<CreateTokenResult> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Cüzdan bağlı değil.')
  }

  const payer = wallet.publicKey
  const mintKeypair = Keypair.generate()
  const mint = mintKeypair.publicKey

  const decimals = data.decimals
  const supplyRaw = BigInt(data.supply) * BigInt(10) ** BigInt(decimals)

  onStatus?.('Kira (rent) hesaplanıyor...')
  const rentLamports = await getMinimumBalanceForRentExemptMint(connection)

  const associatedTokenAccount = getAssociatedTokenAddressSync(mint, payer)
  const metadataPda = findMetadataPda(mint)

  const tx = new Transaction()

  // 1) Mint hesabını oluştur
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports: rentLamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint, decimals, payer, payer, TOKEN_PROGRAM_ID),
  )

  // 2) Cüzdan için ilişkili token hesabı (ATA) oluştur
  tx.add(createAssociatedTokenAccountInstruction(payer, associatedTokenAccount, payer, mint))

  // 3) Toplam arzı bastır (mint) ve cüzdana gönder
  tx.add(createMintToInstruction(mint, associatedTokenAccount, payer, supplyRaw))

  // 4) Metaplex Token Metadata hesabı (isim/sembol/logo/açıklama on-chain referansı)
  tx.add(
    createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPda,
        mint,
        mintAuthority: payer,
        payer,
        updateAuthority: payer,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name: data.name,
            symbol: data.symbol,
            uri: data.imageUri || '',
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          isMutable: !data.immutable,
          collectionDetails: null,
        },
      },
    ),
  )

  // 5) Opsiyonel: mint yetkisini kaldır (arz sabitlenir, artık yeni token basılamaz)
  if (data.revokeMint) {
    tx.add(createSetAuthorityInstruction(mint, payer, AuthorityType.MintTokens, null))
  }

  // 6) Opsiyonel: freeze yetkisini kaldır
  if (data.revokeFreeze) {
    tx.add(createSetAuthorityInstruction(mint, payer, AuthorityType.FreezeAccount, null))
  }

  // 7) Opsiyonel hizmet ücreti (yalnızca site sahibi FEE_WALLET tanımladıysa eklenir)
  if (FEE_WALLET && FEE_AMOUNT_SOL > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: new PublicKey(FEE_WALLET),
        lamports: Math.round(FEE_AMOUNT_SOL * LAMPORTS_PER_SOL),
      }),
    )
  }

  onStatus?.('İşlem hazırlanıyor...')
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = payer

  // Mint hesabı yeni oluşturulduğu için mint keypair de imzalamalı
  tx.partialSign(mintKeypair)

  onStatus?.('Cüzdanınızda onay bekleniyor...')
  const signedTx = await wallet.signTransaction(tx)

  onStatus?.('İşlem ağa gönderiliyor...')
  const signature = await connection.sendRawTransaction(signedTx.serialize())

  onStatus?.('Onay bekleniyor...')
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

  return {
    mint: mint.toBase58(),
    signature,
    tokenAccount: associatedTokenAccount.toBase58(),
  }
}
