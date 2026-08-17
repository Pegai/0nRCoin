import { PublicKey, SystemProgram, TransactionInstruction, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { ConfidentialKeys, type AeKey, type ElGamalKeypair } from '@solana/zk-sdk/bundler'

// Token-2022'nin "Confidential Transfer" extension'ı (miktarı şifreler,
// gönderen/alıcı adresini DEĞİL). Bu dosyadaki instruction encoder'lar,
// resmi @solana/spl-token paketinde (0.4.15, en güncel sürüm) henüz
// bulunmadığı için spl-token-2022-interface crate'inin Rust kaynağından
// (extension/confidential_transfer/instruction.rs) elle port edildi.
// Kaynak: https://github.com/solana-program/token-2022 (spl-token-2022-interface v3.1.1)

export const ZK_ELGAMAL_PROOF_PROGRAM_ID = new PublicKey(
  'ZkE1Gama1Proof11111111111111111111111111111',
)

// TokenInstruction enum'unda ConfidentialTransferExtension'ın discriminant'ı (instruction.rs:1116)
const TOKEN_INSTRUCTION_CONFIDENTIAL_TRANSFER_EXTENSION = 27

// TokenInstruction enum'unda Reallocate'in discriminant'ı (instruction.rs:923)
const TOKEN_INSTRUCTION_REALLOCATE = 29

// ConfidentialTransferInstruction alt-discriminant'ları (instruction.rs, enum sırası)
const CT_IX = {
  InitializeMint: 0,
  ConfigureAccount: 2,
  Deposit: 5,
  ApplyPendingBalance: 8,
} as const

// ProofInstruction (zk_elgamal_proof programı) discriminant'ları
const PROOF_IX = {
  VerifyPubkeyValidity: 4,
} as const

const AE_CIPHERTEXT_LEN = 36 // solana-zk-sdk-pod encryption/mod.rs

function u64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  return buf
}

/**
 * `TokenInstruction::ConfidentialTransferExtension` sarmalayıcısı:
 * data = [27, altInstructionByte, ...alanlar] — bkz. instruction.rs `encode_instruction`.
 */
function buildInstruction(
  subInstruction: number,
  data: Buffer,
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys,
    data: Buffer.concat([
      Buffer.from([TOKEN_INSTRUCTION_CONFIDENTIAL_TRANSFER_EXTENSION, subInstruction]),
      data,
    ]),
  })
}

/**
 * Mint'i Confidential Transfer extension'ıyla başlatır. `createToken.ts`'te
 * `SystemProgram.createAccount`'tan HEMEN sonra, `createInitializeMintInstruction`'dan
 * ÖNCE eklenmesi gerekir (Token-2022 extension kuralı — TransferHook'ta olduğu gibi).
 *
 * `InitializeMintData` (instruction.rs:504): authority: MaybeNull<Address> (32B, hepsi
 * sıfırsa None), auto_approve_new_accounts: Bool (1B), auditor_elgamal_pubkey:
 * MaybeNull<PodElGamalPubkey> (32B, hepsi sıfırsa None). Toplam 65 byte.
 */
export function buildInitializeConfidentialTransferMintIx(
  mint: PublicKey,
  authority: PublicKey | null,
): TransactionInstruction {
  const data = Buffer.concat([
    authority ? authority.toBuffer() : Buffer.alloc(32), // authority (None = tüm sıfır)
    // auto_approve_new_accounts = true: kapalı olursa her yeni hesabın mint
    // yetkilisi tarafından ayrıca `ApproveAccount` ile onaylanması gerekir
    // (KYC/uyum senaryoları için) — bizim basit, herkese açık kullanım
    // senaryomuzda bu gereksiz bir engel, o yüzden herkesi otomatik onaylıyoruz.
    Buffer.from([1]),
    Buffer.alloc(32), // auditor_elgamal_pubkey = None (denetçi yok)
  ])
  return buildInstruction(CT_IX.InitializeMint, data, [{ pubkey: mint, isSigner: false, isWritable: true }])
}

/**
 * Token hesabının veri alanını, `ConfidentialTransferAccount` extension'ının
 * verisini sığdıracak şekilde büyütür. `ConfigureAccount`'tan ÖNCE, ayrı bir
 * instruction olarak gönderilmesi ZORUNLU — aksi halde `ConfigureAccount`
 * "InvalidAccountData" hatasıyla başarısız olur (hesap, yeni extension için
 * yer ayrılmadan yazılmaya çalışılıyor). Bkz. `TokenInstruction::Reallocate`
 * (instruction.rs:618) — data: [29, ...her extension için 2 byte LE u16].
 */
export function buildReallocateForConfidentialTransferIx(
  tokenAccount: PublicKey,
  payer: PublicKey,
  owner: PublicKey,
): TransactionInstruction {
  const extensionTypeLE = Buffer.alloc(2)
  extensionTypeLE.writeUInt16LE(ExtensionType.ConfidentialTransferAccount)
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([TOKEN_INSTRUCTION_REALLOCATE]), extensionTypeLE]),
  })
}

/**
 * Hesabı confidential transfer için yapılandırır. ÖNCESİNDE aynı
 * transaction'da sırasıyla `buildReallocateForConfidentialTransferIx` ve bir
 * `VerifyPubkeyValidity` proof instruction'ı olmalı (bkz.
 * `buildVerifyPubkeyValidityIx`) — `proofInstructionOffset` bu instruction'a
 * göre o proof'un göreli konumu (biz her zaman bir önceki instruction'a
 * koyduğumuz için sabit `-1`).
 *
 * `ConfigureAccountInstructionData` (instruction.rs:534): decryptable_zero_balance
 * (AeCiphertext, 36B), maximum_pending_balance_credit_counter (u64, 8B),
 * proof_instruction_offset (i8, 1B). Toplam 45 byte.
 */
export function buildConfigureAccountIx(
  tokenAccount: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  decryptableZeroBalance: Uint8Array,
  maximumPendingBalanceCreditCounter: bigint,
): TransactionInstruction {
  if (decryptableZeroBalance.length !== AE_CIPHERTEXT_LEN) {
    throw new Error(`decryptableZeroBalance ${AE_CIPHERTEXT_LEN} byte olmalı`)
  }
  const offsetByte = Buffer.alloc(1)
  offsetByte.writeInt8(-1) // proof_instruction_offset = -1 (proof bu instruction'dan hemen önce)
  const data = Buffer.concat([
    Buffer.from(decryptableZeroBalance),
    u64LE(maximumPendingBalanceCreditCounter),
    offsetByte,
  ])
  return buildInstruction(CT_IX.ConfigureAccount, data, [
    { pubkey: tokenAccount, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: owner, isSigner: true, isWritable: false },
  ])
}

/**
 * Herkese açık bakiyeden gizli ("pending") bakiyeye aktarır — proof
 * GEREKMEZ, çünkü yatırılan miktar zaten zincirde açık (yalnızca hedef
 * bakiye şifreli tutulur).
 *
 * `DepositInstructionData` (instruction.rs:565): amount (u64, 8B), decimals (u8, 1B). Toplam 9 byte.
 */
export function buildDepositIx(
  tokenAccount: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
): TransactionInstruction {
  const data = Buffer.concat([u64LE(amount), Buffer.from([decimals])])
  return buildInstruction(CT_IX.Deposit, data, [
    { pubkey: tokenAccount, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: owner, isSigner: true, isWritable: false },
  ])
}

/**
 * Bekleyen (pending) bakiyeyi kullanılabilir (available) bakiyeye işler —
 * proof gerekmez, salt yerel AES-şifreli önbelleği günceller.
 *
 * `ApplyPendingBalanceData` (instruction.rs:632): expected_pending_balance_credit_counter
 * (u64, 8B), new_decryptable_available_balance (AeCiphertext, 36B). Toplam 44 byte.
 */
export function buildApplyPendingBalanceIx(
  tokenAccount: PublicKey,
  owner: PublicKey,
  expectedPendingBalanceCreditCounter: bigint,
  newDecryptableAvailableBalance: Uint8Array,
): TransactionInstruction {
  if (newDecryptableAvailableBalance.length !== AE_CIPHERTEXT_LEN) {
    throw new Error(`newDecryptableAvailableBalance ${AE_CIPHERTEXT_LEN} byte olmalı`)
  }
  const data = Buffer.concat([
    u64LE(expectedPendingBalanceCreditCounter),
    Buffer.from(newDecryptableAvailableBalance),
  ])
  return buildInstruction(CT_IX.ApplyPendingBalance, data, [
    { pubkey: tokenAccount, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
  ])
}

/**
 * `zk_elgamal_proof` programına, proof'u DOĞRUDAN instruction data içinde
 * (context state hesabı açmadan) gönderen doğrulama instruction'ı.
 * `ConfigureAccount`'tan hemen ÖNCE eklenmeli (bkz. `proofInstructionOffset = -1`).
 *
 * Format (instruction.rs `encode_verify_proof`, context_state_info=None):
 * data = [4, ...proofBytes], hiç hesap gerekmiyor.
 */
export function buildVerifyPubkeyValidityIx(proofBytes: Uint8Array): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
    keys: [],
    data: Buffer.concat([Buffer.from([PROOF_IX.VerifyPubkeyValidity]), Buffer.from(proofBytes)]),
  })
}

/** Confidential transfer için kullanılan Token-2022 ATA adresi. */
export function getConfidentialTokenAccount(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
}

export interface DerivedConfidentialKeys {
  elgamal: ElGamalKeypair
  ae: AeKey
}

/**
 * ElGamal + AES anahtarlarını, cüzdanın bir mesajı imzalamasından
 * DETERMİNİSTİK olarak türetir (`@solana/zk-sdk`'nin HKDF zinciri) — ayrı
 * bir private key saklamaya/yedeklemeye gerek yok, aynı cüzdanla her zaman
 * aynı anahtarlar üretilir.
 *
 * zk-sdk'nin kendi `ConfidentialKeys.signerMessage()` çıktısı ham (okunamaz)
 * baytlardan oluşuyor — Phantom gibi cüzdanlar, kullanıcıya gösteremediği
 * bu tür baytları "gizlenmiş bir işlem olabilir" diye `signMessage`'da
 * REDDEDİYOR ("You cannot sign solana transactions using sign message").
 * `ConfidentialKeys.fromSignature()` yalnızca imzanın kendisini (64 byte)
 * HKDF girdisi olarak kullanıyor, hangi mesajın imzalandığını doğrulamıyor
 * — bu yüzden zk-sdk'nin ham-bayt mesajı yerine, her hesap için benzersiz,
 * tamamen okunabilir (UTF-8) bir metin imzalatıyoruz. Tek şart: aynı
 * (cüzdan, token hesabı) çifti için her zaman aynı metnin üretilmesi.
 */
export async function deriveConfidentialKeys(
  wallet: WalletContextState,
  tokenAccount: PublicKey,
): Promise<DerivedConfidentialKeys> {
  if (!wallet.signMessage) {
    throw new Error(
      'Bağlı cüzdan mesaj imzalamayı (signMessage) desteklemiyor — gizli transfer anahtarlarını türetmek için bu gerekli.',
    )
  }
  const message = new TextEncoder().encode(
    `0nRCoin Confidential Transfer key derivation\nToken account: ${tokenAccount.toBase58()}`,
  )
  const signature = await wallet.signMessage(message)
  const keys = ConfidentialKeys.fromSignature(signature)
  return { elgamal: keys.elgamal(), ae: keys.ae() }
}
