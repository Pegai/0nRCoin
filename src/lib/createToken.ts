import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  ExtensionType,
  getMintLen,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from '@solana/spl-token'
import {
  PROGRAM_ID as METADATA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
  createCreateInstruction,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata'
import { FEE_WALLET, FEE_AMOUNT_SOL } from '../config'
import { SELL_LOCK_PROGRAM_ID, buildInitializeExtraAccountMetaListIx } from './sellLock'

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
  // > 0 ise mint, Token-2022 + Transfer Hook uzantısıyla (satış kilidi
  // programımıza bağlı olarak) oluşturulur. 0 = normal SPL Token.
  sellLockDurationSeconds: number
}

export interface CreateTokenResult {
  mint: string
  signature: string
  tokenAccount: string
  sellLockEnabled: boolean
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

  // Satış kilidi süresi seçilmişse mint, Token-2022 + Transfer Hook
  // uzantısıyla oluşturulur (bkz. src/lib/sellLock.ts); aksi halde normal
  // (legacy) SPL Token programı kullanılır. İki durumda da geri kalan tüm
  // akış (ATA, metadata, yetkiler) aynı şekilde çalışır — sadece hangi
  // token programına ait olduğu değişir.
  const sellLockEnabled = data.sellLockDurationSeconds > 0
  const tokenProgramId = sellLockEnabled ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID

  onStatus?.('Kira (rent) hesaplanıyor...')
  let mintSpace: number
  let rentLamports: number
  if (sellLockEnabled) {
    mintSpace = getMintLen([ExtensionType.TransferHook])
    rentLamports = await connection.getMinimumBalanceForRentExemption(mintSpace)
  } else {
    mintSpace = MINT_SIZE
    rentLamports = await getMinimumBalanceForRentExemptMint(connection)
  }

  const associatedTokenAccount = getAssociatedTokenAddressSync(
    mint,
    payer,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  const metadataPda = findMetadataPda(mint)

  const tx = new Transaction()

  // 1) Mint hesabını oluştur
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mint,
      space: mintSpace,
      lamports: rentLamports,
      programId: tokenProgramId,
    }),
  )

  // Transfer Hook uzantısı, mint'in kendisi initialize edilmeden ÖNCE
  // ayarlanmalıdır (Token-2022 uzantı kuralı).
  if (sellLockEnabled) {
    tx.add(createInitializeTransferHookInstruction(mint, payer, SELL_LOCK_PROGRAM_ID, tokenProgramId))
  }

  tx.add(createInitializeMintInstruction(mint, decimals, payer, payer, tokenProgramId))

  // 2) Cüzdan için ilişkili token hesabı (ATA) oluştur
  tx.add(
    createAssociatedTokenAccountInstruction(
      payer,
      associatedTokenAccount,
      payer,
      mint,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  )

  // 3) Toplam arzı bastır (mint) ve cüzdana gönder
  tx.add(createMintToInstruction(mint, associatedTokenAccount, payer, supplyRaw, [], tokenProgramId))

  // 4) Metaplex Token Metadata hesabı (isim/sembol/logo/açıklama on-chain referansı)
  //
  // Token-2022 mint'ler (özellikle Transfer Hook gibi "kısıtlayıcı"
  // uzantıları olanlar) için eski CreateMetadataAccountV3 talimatı,
  // mint'i otomatik olarak "Programmable NFT" sanıp reddediyor (0x99
  // hatası). Bunun yerine, token programını açıkça belirtebildiğimiz ve
  // token standardını "Fungible" olarak işaretleyebildiğimiz daha yeni,
  // birleşik "Create" talimatını kullanıyoruz — bu, hem legacy SPL Token
  // hem Token-2022 mint'lerle doğru çalışıyor.
  if (sellLockEnabled) {
    tx.add(
      createCreateInstruction(
        {
          metadata: metadataPda,
          mint,
          authority: payer,
          payer,
          updateAuthority: payer,
          systemProgram: SystemProgram.programId,
          sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          splTokenProgram: tokenProgramId,
        },
        {
          createArgs: {
            __kind: 'V1',
            assetData: {
              name: data.name,
              symbol: data.symbol,
              uri: data.imageUri || '',
              sellerFeeBasisPoints: 0,
              creators: null,
              primarySaleHappened: false,
              isMutable: !data.immutable,
              tokenStandard: TokenStandard.Fungible,
              collection: null,
              uses: null,
              collectionDetails: null,
              ruleSet: null,
            },
            decimals,
            printSupply: null,
          },
        },
      ),
    )
  } else {
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
  }

  // 5) Opsiyonel: mint yetkisini kaldır (arz sabitlenir, artık yeni token basılamaz)
  if (data.revokeMint) {
    tx.add(createSetAuthorityInstruction(mint, payer, AuthorityType.MintTokens, null, [], tokenProgramId))
  }

  // 6) Opsiyonel: freeze yetkisini kaldır
  if (data.revokeFreeze) {
    tx.add(
      createSetAuthorityInstruction(mint, payer, AuthorityType.FreezeAccount, null, [], tokenProgramId),
    )
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

  // Satış kilidi etkinse, Token-2022'nin her transferde bizim programımızı
  // çağırabilmesi için zorunlu olan "extra account meta list" hesabını
  // ayrı bir işlemde oluşturuyoruz (bkz. program/sell-lock).
  if (sellLockEnabled) {
    onStatus?.('Satış kilidi kaydediliyor...')
    const metaListTx = new Transaction().add(buildInitializeExtraAccountMetaListIx(payer, mint))
    const metaListBlockhash = await connection.getLatestBlockhash()
    metaListTx.recentBlockhash = metaListBlockhash.blockhash
    metaListTx.feePayer = payer

    onStatus?.('Cüzdanınızda onay bekleniyor (satış kilidi)...')
    const signedMetaListTx = await wallet.signTransaction(metaListTx)

    onStatus?.('Satış kilidi işlemi gönderiliyor...')
    const metaListSignature = await connection.sendRawTransaction(signedMetaListTx.serialize())

    onStatus?.('Satış kilidi onaylanıyor...')
    await connection.confirmTransaction(
      { signature: metaListSignature, ...metaListBlockhash },
      'confirmed',
    )
  }

  return {
    mint: mint.toBase58(),
    signature,
    tokenAccount: associatedTokenAccount.toBase58(),
    sellLockEnabled,
  }
}
