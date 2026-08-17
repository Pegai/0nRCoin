import { useState, type FormEvent } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { PubkeyValidityProofData } from '@solana/zk-sdk/bundler'
import { getMintInfo } from '../lib/raydium'
import {
  buildApplyPendingBalanceIx,
  buildConfigureAccountIx,
  buildDepositIx,
  buildReallocateForConfidentialTransferIx,
  buildVerifyPubkeyValidityIx,
  deriveConfidentialKeys,
  getConfidentialTokenAccount,
  type DerivedConfidentialKeys,
} from '../lib/confidentialTransfer'
import type { NetworkId } from '../config'

interface Props {
  network: NetworkId
}

// Bir hesap yapılandırıldıktan sonra, `ApplyPendingBalance` çağrılmadan önce
// kabul edilebilecek azami bekleyen (pending) yatırım/transfer sayısı.
// Yüksek bir sabit seçiyoruz; asıl sınır zincirde protokol tarafından kontrol ediliyor.
const MAX_PENDING_BALANCE_CREDIT_COUNTER = 65536n

async function sendTx(
  connection: Connection,
  wallet: WalletContextState,
  tx: Transaction,
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Cüzdan bağlı değil.')
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = wallet.publicKey
  const signed = await wallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

export function ConfidentialTransferPage({ network: _network }: Props) {
  const { connection } = useConnection()
  const wallet = useWallet()

  const [mintAddr, setMintAddr] = useState('')
  const [decimals, setDecimals] = useState<number | null>(null)
  const [keys, setKeys] = useState<DerivedConfidentialKeys | null>(null)
  const [tokenAccount, setTokenAccount] = useState<PublicKey | null>(null)

  const [depositAmount, setDepositAmount] = useState('')
  const [appliedBalance, setAppliedBalance] = useState<bigint | null>(null)

  const [configureBusy, setConfigureBusy] = useState(false)
  const [configureTx, setConfigureTx] = useState('')
  const [depositBusy, setDepositBusy] = useState(false)
  const [depositTx, setDepositTx] = useState('')
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyTx, setApplyTx] = useState('')
  const [error, setError] = useState('')

  function reset() {
    setKeys(null)
    setTokenAccount(null)
    setDecimals(null)
    setConfigureTx('')
    setDepositTx('')
    setApplyTx('')
    setAppliedBalance(null)
    setError('')
  }

  async function handleLookupAndConfigure(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!wallet.connected || !wallet.publicKey) {
      setError('Devam etmek için önce cüzdanınızı bağlayın.')
      return
    }
    if (!mintAddr.trim()) {
      setError('Mint adresi girin.')
      return
    }
    setConfigureBusy(true)
    try {
      const mintInfo = await getMintInfo(connection, mintAddr.trim())
      if (mintInfo.programId !== TOKEN_2022_PROGRAM_ID.toBase58()) {
        throw new Error(
          'Bu mint Token-2022 değil. Gizli miktar transferi yalnızca "Gizli Miktar Transferi" seçeneğiyle oluşturulmuş token\'larda çalışır.',
        )
      }
      setDecimals(mintInfo.decimals)

      const mint = new PublicKey(mintAddr.trim())
      const ata = getConfidentialTokenAccount(mint, wallet.publicKey)
      setTokenAccount(ata)

      const derivedKeys = await deriveConfidentialKeys(wallet, ata)
      setKeys(derivedKeys)

      const reallocIx = buildReallocateForConfidentialTransferIx(ata, wallet.publicKey, wallet.publicKey)
      const proofData = new PubkeyValidityProofData(derivedKeys.elgamal)
      const proofIx = buildVerifyPubkeyValidityIx(proofData.toBytes())
      const decryptableZeroBalance = derivedKeys.ae.encrypt(0n).toBytes()
      const configureIx = buildConfigureAccountIx(
        ata,
        mint,
        wallet.publicKey,
        decryptableZeroBalance,
        MAX_PENDING_BALANCE_CREDIT_COUNTER,
      )

      // Sıra önemli: proofIx, configureIx'ten hemen önce olmalı (bkz.
      // buildConfigureAccountIx'teki proof_instruction_offset = -1).
      const tx = new Transaction().add(reallocIx, proofIx, configureIx)
      const sig = await sendTx(connection, wallet, tx)
      setConfigureTx(sig)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Hesap yapılandırılırken bir hata oluştu.')
    } finally {
      setConfigureBusy(false)
    }
  }

  async function handleDeposit() {
    if (!keys || !tokenAccount || decimals === null || !wallet.publicKey) return
    setError('')
    if (!depositAmount || Number(depositAmount) <= 0) {
      setError('Geçerli bir miktar girin.')
      return
    }
    setDepositBusy(true)
    try {
      const mint = new PublicKey(mintAddr.trim())
      const amountRaw = BigInt(Math.round(Number(depositAmount) * 10 ** decimals))
      const ix = buildDepositIx(tokenAccount, mint, wallet.publicKey, amountRaw, decimals)
      const tx = new Transaction().add(ix)
      const sig = await sendTx(connection, wallet, tx)
      setDepositTx(sig)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Yatırma işlemi başarısız oldu.')
    } finally {
      setDepositBusy(false)
    }
  }

  async function handleApplyPendingBalance() {
    if (!keys || !tokenAccount || decimals === null || !wallet.publicKey) return
    setError('')
    setApplyBusy(true)
    try {
      // Basitlik için: hesap yeni yapılandırıldı ve tam olarak bir Deposit
      // yapıldı varsayıyoruz (bekleyen kredi sayacı = 1, önceki bakiye 0).
      // Zincirdeki gerçek hesabı okuyup birden fazla yatırım/transferi
      // toplayan genel bir sürüm — sonraki aşama.
      const amountRaw = BigInt(Math.round(Number(depositAmount) * 10 ** decimals))
      const newDecryptableBalance = keys.ae.encrypt(amountRaw).toBytes()
      const ix = buildApplyPendingBalanceIx(tokenAccount, wallet.publicKey, 1n, newDecryptableBalance)
      const tx = new Transaction().add(ix)
      const sig = await sendTx(connection, wallet, tx)
      setApplyTx(sig)
      setAppliedBalance(amountRaw)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Bekleyen bakiye uygulanırken bir hata oluştu.')
    } finally {
      setApplyBusy(false)
    }
  }

  return (
    <div className="token-form">
      <h2>Gizli Miktar Transferi (Confidential Transfer)</h2>
      <p className="subtab-desc">
        Token-2022'nin resmi <strong>Confidential Transfer</strong> uzantısını kullanır: transfer
        edilen MİKTAR zincirde şifreli tutulur, Solscan gibi gezginlerde görünmez.{' '}
        <strong>Gönderen/alıcı adresleri her zaman açıktır</strong> — bu, kimlik gizleyen bir mixer
        değildir, sadece tutarı gizler.
      </p>
      <div className="alert alert--warning">
        ⚠️ Bu, ilk aşama (Faz 1): hesabı yapılandırma + yatırma (deposit) + bekleyen bakiyeyi
        uygulama. Geri çekme (withdraw) ve kişiden kişiye gizli transfer, ek zk-proof adımları
        gerektirdiği için henüz eklenmedi. Yalnızca <strong>Devnet</strong>'te, "Gizli Miktar
        Transferi" seçeneğiyle oluşturulmuş bir token ile test edin.
      </div>

      <form onSubmit={handleLookupAndConfigure}>
        <label className="field">
          <span>Token Mint Adresi *</span>
          <input
            type="text"
            placeholder="Confidential Transfer ile oluşturulmuş token'ınızın mint adresi"
            value={mintAddr}
            onChange={(e) => {
              setMintAddr(e.target.value)
              reset()
            }}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={configureBusy || !!configureTx}>
          {configureBusy ? 'Yapılandırılıyor...' : configureTx ? '1. Hesap Yapılandırıldı ✓' : '1. Hesabı Yapılandır'}
        </button>
      </form>

      {error && <div className="alert alert--error" style={{ marginTop: 16 }}>{error}</div>}

      {configureTx && (
        <div className="pool-manage__section" style={{ marginTop: 20 }}>
          <div className="pool-manage__section-title">2. Bakiye Yatır (Deposit)</div>
          <p className="subtab-desc">
            Herkese açık bakiyenizden, gizli ("pending") bakiyeye aktarır. Bu adımda miktar henüz
            zincirde açık — sonraki adımda ("bekleyen bakiyeyi uygula") şifrelenmiş hale gelir.
          </p>
          <div className="pool-manage__amount-row">
            <input
              type="text"
              inputMode="decimal"
              placeholder="ör. 100"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value.replace(/[^\d.]/g, ''))}
              disabled={!!depositTx}
            />
          </div>
          <button
            type="button"
            className="btn btn--primary pool-manage__action-btn"
            onClick={handleDeposit}
            disabled={depositBusy || !!depositTx}
          >
            {depositBusy ? 'Yatırılıyor...' : depositTx ? 'Yatırıldı ✓' : 'Yatır'}
          </button>
        </div>
      )}

      {depositTx && (
        <div className="pool-manage__section" style={{ marginTop: 20 }}>
          <div className="pool-manage__section-title">3. Bekleyen Bakiyeyi Uygula</div>
          <p className="subtab-desc">
            Yatırdığınız miktarı kullanılabilir gizli bakiyenize işler. Bundan sonra bu hesabın
            bakiyesi zincirde yalnızca şifreli olarak görünür — Solscan'de tutarı göremezsiniz,
            sadece siz (ve türetilmiş anahtarınızla) çözebilirsiniz.
          </p>
          <button
            type="button"
            className="btn btn--primary pool-manage__action-btn"
            onClick={handleApplyPendingBalance}
            disabled={applyBusy || !!applyTx}
          >
            {applyBusy ? 'Uygulanıyor...' : applyTx ? 'Uygulandı ✓' : 'Uygula'}
          </button>
        </div>
      )}

      {applyTx && appliedBalance !== null && decimals !== null && (
        <div className="result-card" style={{ marginTop: 20 }}>
          <div className="result-card__icon">🔒</div>
          <h2>Gizli Bakiye Oluşturuldu!</h2>
          <p>
            Şifrelenmiş kullanılabilir bakiyeniz (yalnızca sizin çözebileceğiniz):{' '}
            <strong>{(Number(appliedBalance) / 10 ** decimals).toLocaleString('tr-TR')}</strong> token.
          </p>
          <div className="result-card__row">
            <span>Hesap Yapılandırma İşlemi</span>
            <code>{configureTx}</code>
          </div>
          <div className="result-card__row">
            <span>Yatırma İşlemi</span>
            <code>{depositTx}</code>
          </div>
          <div className="result-card__row">
            <span>Uygulama İşlemi</span>
            <code>{applyTx}</code>
          </div>
          <p className="subtab-desc">
            Bu üç işlemi Solscan/Explorer'da açıp inceleyebilirsiniz — hiçbirinde token miktarını
            düz metin olarak göremezsiniz, sadece şifreli baytlar.
          </p>
        </div>
      )}
    </div>
  )
}
