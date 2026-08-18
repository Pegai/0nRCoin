import { useEffect, useState, type FormEvent } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token'
import { PubkeyValidityProofData } from '@solana/zk-sdk/bundler'
import { getMintInfo } from '../lib/raydium'
import { getTokenMetadata, type TokenMeta } from '../lib/tokenMetadata'
import { CoinPicker } from './CoinPicker'
import { TokenIcon } from './TokenIcon'
import {
  buildApplyPendingBalanceIx,
  buildConfigureAccountIx,
  buildDepositIx,
  buildReallocateForConfidentialTransferIx,
  buildVerifyPubkeyValidityIx,
  decryptAeBalance,
  deriveConfidentialKeys,
  getConfidentialAccountState,
  getConfidentialTokenAccount,
  planConfidentialTransfer,
  type DerivedConfidentialKeys,
} from '../lib/confidentialTransfer'
import { NETWORKS, type NetworkId } from '../config'

interface Props {
  network: NetworkId
}

// Bir hesap yapılandırıldıktan sonra, `ApplyPendingBalance` çağrılmadan önce
// kabul edilebilecek azami bekleyen (pending) yatırım/transfer sayısı.
// Yüksek bir sabit seçiyoruz; asıl sınır zincirde protokol tarafından kontrol ediliyor.
const MAX_PENDING_BALANCE_CREDIT_COUNTER = 65536n

function fmtAmount(raw: bigint, decimals: number): string {
  return (Number(raw) / 10 ** decimals).toLocaleString('tr-TR')
}

async function sendTx(connection: Connection, wallet: WalletContextState, tx: Transaction): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Cüzdan bağlı değil.')
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = wallet.publicKey
  const signed = await wallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

export function ConfidentialTransferPage({ network }: Props) {
  const { connection } = useConnection()
  const wallet = useWallet()

  const [mintAddr, setMintAddr] = useState('')
  const [selectedMeta, setSelectedMeta] = useState<TokenMeta | null>(null)

  // Seçilen coin için hesap durumu
  const [decimals, setDecimals] = useState<number | null>(null)
  const [tokenAccount, setTokenAccount] = useState<PublicKey | null>(null)
  const [keys, setKeys] = useState<DerivedConfidentialKeys | null>(null)
  const [accountConfigured, setAccountConfigured] = useState<boolean | null>(null)
  const [currentBalance, setCurrentBalance] = useState<bigint | null>(null)
  const [checkingAccount, setCheckingAccount] = useState(false)

  const [configureBusy, setConfigureBusy] = useState(false)
  const [configureTx, setConfigureTx] = useState('')

  const [depositAmount, setDepositAmount] = useState('')
  const [depositBusy, setDepositBusy] = useState(false)
  const [depositTx, setDepositTx] = useState('')
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyTx, setApplyTx] = useState('')

  const [sendAmount, setSendAmount] = useState('')
  const [recipientAddr, setRecipientAddr] = useState('')
  const [sendBusy, setSendBusy] = useState(false)
  const [sendTxSig, setSendTxSig] = useState('')

  const [error, setError] = useState('')

  useEffect(() => {
    if (!mintAddr) {
      setSelectedMeta(null)
      return
    }
    let cancelled = false
    try {
      getTokenMetadata(connection, new PublicKey(mintAddr)).then((meta) => {
        if (!cancelled) setSelectedMeta(meta)
      })
    } catch {
      setSelectedMeta(null)
    }
    return () => {
      cancelled = true
    }
  }, [connection, mintAddr])

  function resetMintState() {
    setDecimals(null)
    setTokenAccount(null)
    setKeys(null)
    setAccountConfigured(null)
    setCurrentBalance(null)
    setConfigureTx('')
    setDepositAmount('')
    setDepositTx('')
    setApplyTx('')
    setSendAmount('')
    setRecipientAddr('')
    setSendTxSig('')
    setError('')
  }

  function selectMint(addr: string) {
    resetMintState()
    setMintAddr(addr)
  }

  async function refreshBalance(ata: PublicKey, derivedKeys: DerivedConfidentialKeys) {
    try {
      const state = await getConfidentialAccountState(connection, ata)
      setAccountConfigured(state.approved)
      if (state.approved) {
        setCurrentBalance(decryptAeBalance(derivedKeys.ae, state.decryptableAvailableBalance))
      }
    } catch {
      setAccountConfigured(false)
      setCurrentBalance(null)
    }
  }

  async function handleCheckAccount(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!wallet.connected || !wallet.publicKey) {
      setError('Devam etmek için önce cüzdanınızı bağlayın.')
      return
    }
    const addr = mintAddr.trim()
    if (!addr) {
      setError('Bir coin seçin ya da mint adresi girin.')
      return
    }
    setCheckingAccount(true)
    try {
      const mintInfo = await getMintInfo(connection, addr)
      if (mintInfo.programId !== TOKEN_2022_PROGRAM_ID.toBase58()) {
        throw new Error(
          'Bu mint Token-2022 değil. Gizli miktar transferi yalnızca "Gizli Miktar Transferi" seçeneğiyle oluşturulmuş token\'larda çalışır.',
        )
      }
      setDecimals(mintInfo.decimals)

      const mint = new PublicKey(addr)
      const ata = getConfidentialTokenAccount(mint, wallet.publicKey)
      setTokenAccount(ata)

      const derivedKeys = await deriveConfidentialKeys(wallet, ata)
      setKeys(derivedKeys)

      await refreshBalance(ata, derivedKeys)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Hesap kontrol edilirken bir hata oluştu.')
    } finally {
      setCheckingAccount(false)
    }
  }

  async function handleConfigure() {
    if (!keys || !tokenAccount || !wallet.publicKey) return
    setError('')
    setConfigureBusy(true)
    try {
      const mint = new PublicKey(mintAddr.trim())
      // "idempotent" versiyon: hesap zaten varsa hiçbir şey yapmaz, hata
      // vermez — bu token'dan daha önce hiç sahip olmamış biri (ör. sadece
      // gizlice almaya hazırlanan bir alıcı) için de hesabı burada oluşturur.
      const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        tokenAccount,
        wallet.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
      const reallocIx = buildReallocateForConfidentialTransferIx(tokenAccount, wallet.publicKey, wallet.publicKey)
      const proofData = new PubkeyValidityProofData(keys.elgamal)
      const proofIx = buildVerifyPubkeyValidityIx(proofData.toBytes())
      const decryptableZeroBalance = keys.ae.encrypt(0n).toBytes()
      const configureIx = buildConfigureAccountIx(
        tokenAccount,
        mint,
        wallet.publicKey,
        decryptableZeroBalance,
        MAX_PENDING_BALANCE_CREDIT_COUNTER,
      )
      // Sıra önemli: proofIx, configureIx'ten hemen önce olmalı.
      const tx = new Transaction().add(createAtaIx, reallocIx, proofIx, configureIx)
      const sig = await sendTx(connection, wallet, tx)
      setConfigureTx(sig)
      setAccountConfigured(true)
      setCurrentBalance(0n)
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
    if (!keys || !tokenAccount || !wallet.publicKey) return
    setError('')
    setApplyBusy(true)
    try {
      const state = await getConfidentialAccountState(connection, tokenAccount)
      const currentDecrypted = decryptAeBalance(keys.ae, state.decryptableAvailableBalance)
      const depositedRaw =
        decimals !== null && depositAmount ? BigInt(Math.round(Number(depositAmount) * 10 ** decimals)) : 0n
      const newBalance = currentDecrypted + depositedRaw
      const newDecryptableBalance = keys.ae.encrypt(newBalance).toBytes()
      const ix = buildApplyPendingBalanceIx(
        tokenAccount,
        wallet.publicKey,
        state.pendingBalanceCreditCounter,
        newDecryptableBalance,
      )
      const tx = new Transaction().add(ix)
      const sig = await sendTx(connection, wallet, tx)
      setApplyTx(sig)
      setCurrentBalance(newBalance)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Bekleyen bakiye uygulanırken bir hata oluştu.')
    } finally {
      setApplyBusy(false)
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!keys || !tokenAccount || decimals === null || !wallet.publicKey) return
    setError('')
    if (!sendAmount || Number(sendAmount) <= 0) {
      setError('Geçerli bir miktar girin.')
      return
    }
    let recipientPubkey: PublicKey
    try {
      recipientPubkey = new PublicKey(recipientAddr.trim())
    } catch {
      setError('Geçersiz alıcı cüzdan adresi.')
      return
    }
    setSendBusy(true)
    try {
      const mint = new PublicKey(mintAddr.trim())
      const recipientAta = getConfidentialTokenAccount(mint, recipientPubkey)

      let recipientState
      try {
        recipientState = await getConfidentialAccountState(connection, recipientAta)
      } catch {
        throw new Error(
          'Alıcının bu token için hesabı yok ya da gizli transfere yapılandırılmamış. Alıcının önce kendi cüzdanıyla bu mint adresi için "Coin\'i Kullan" + "Hesabı Yapılandır" adımlarını çalıştırması gerekiyor.',
        )
      }
      if (!recipientState.approved) {
        throw new Error('Alıcının hesabı henüz onaylanmamış.')
      }

      const sourceState = await getConfidentialAccountState(connection, tokenAccount)
      const amountRaw = BigInt(Math.round(Number(sendAmount) * 10 ** decimals))

      const plan = planConfidentialTransfer(
        tokenAccount,
        mint,
        recipientAta,
        wallet.publicKey,
        keys,
        sourceState.availableBalance,
        sourceState.decryptableAvailableBalance,
        recipientState.elgamalPubkey,
        amountRaw,
      )

      const tx = new Transaction().add(...plan.instructions)
      const sig = await sendTx(connection, wallet, tx)
      setSendTxSig(sig)
      setCurrentBalance(plan.newDecryptedBalance)
      setSendAmount('')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Gizli transfer başarısız oldu.')
    } finally {
      setSendBusy(false)
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
        ⚠️ Yalnızca <strong>Devnet</strong>'te, "Gizli Miktar Transferi" seçeneğiyle oluşturulmuş bir
        token ile test edin. Gizli göndermek istediğiniz alıcının da, aynı token için önceden bu
        sayfadan kendi hesabını yapılandırmış olması gerekir.
      </div>

      {!mintAddr && (
        <div className="pool-manage__section" style={{ marginTop: 20 }}>
          <div className="pool-manage__section-title">Coin Seç</div>
          <p className="subtab-desc">
            Bu token'dan hiç sahip değilseniz ve sadece gizlice birinden almaya hazırlanıyorsanız
            (alıcı tarafı), mint adresini aşağıya yapıştırıp sonraki adımda "Hesabı Yapılandır"ı
            çalıştırmanız yeterli — miktar belirtmenize gerek yok.
          </p>
          <CoinPicker
            token2022Only
            explorerCluster={NETWORKS[network].explorerCluster}
            onSelect={selectMint}
          />
        </div>
      )}

      {mintAddr && (
        <div className="pool-manage__section" style={{ marginTop: 20 }}>
          <div className="selected-coin">
            <TokenIcon image={selectedMeta?.image} symbol={selectedMeta?.symbol} size={28} />
            <div className="selected-coin__info">
              <span className="selected-coin__symbol">
                {selectedMeta ? `${selectedMeta.name} (${selectedMeta.symbol})` : 'Seçili Coin'}
              </span>
              <code className="selected-coin__addr">{mintAddr}</code>
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                resetMintState()
                setMintAddr('')
              }}
            >
              Değiştir
            </button>
          </div>

          {!keys && (
            <form onSubmit={handleCheckAccount} style={{ marginTop: 12 }}>
              <button type="submit" className="btn btn--primary" disabled={checkingAccount}>
                {checkingAccount ? 'Kontrol Ediliyor...' : "Coin'i Kullan"}
              </button>
            </form>
          )}
        </div>
      )}

      {error && (
        <div className="alert alert--error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {keys && tokenAccount && accountConfigured === false && (
        <div className="pool-manage__section" style={{ marginTop: 20 }}>
          <div className="pool-manage__section-title">Hesabı Yapılandır</div>
          <p className="subtab-desc">
            Bu token hesabınız henüz gizli transfer için yapılandırılmamış. Devam etmeden önce bir
            kerelik yapılandırma gerekiyor.
          </p>
          <button type="button" className="btn btn--primary" onClick={handleConfigure} disabled={configureBusy}>
            {configureBusy ? 'Yapılandırılıyor...' : 'Hesabı Yapılandır'}
          </button>
          {configureTx && <div className="alert alert--info">Yapılandırıldı ✓ İşlem: {configureTx}</div>}
        </div>
      )}

      {keys && tokenAccount && accountConfigured && (
        <>
          <div className="pool-manage__section" style={{ marginTop: 20 }}>
            <div className="pool-manage__section-title">
              Gizli Bakiyeniz
              <small className="pool-manage__balance-hint">
                {' '}
                {currentBalance !== null && decimals !== null ? fmtAmount(currentBalance, decimals) : '...'} token
              </small>
            </div>
          </div>

          <form onSubmit={handleSend} className="pool-manage__section" style={{ marginTop: 20 }}>
            <div className="pool-manage__section-title">Gizlice Gönder</div>
            <p className="subtab-desc">
              Alıcının, bu token için hesabını daha önce bu sayfadan yapılandırmış olması gerekir.
            </p>
            <label className="field">
              <span>Alıcı Cüzdan Adresi</span>
              <input
                type="text"
                placeholder="Alıcının Solana cüzdan adresi"
                value={recipientAddr}
                onChange={(e) => setRecipientAddr(e.target.value)}
              />
            </label>
            <div className="pool-manage__amount-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder="Gönderilecek miktar"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
            <button type="submit" className="btn btn--primary pool-manage__action-btn" disabled={sendBusy}>
              {sendBusy ? 'Gönderiliyor...' : 'Gizlice Gönder'}
            </button>
            {sendTxSig && (
              <div className="alert alert--info" style={{ marginTop: 12 }}>
                🔒 Gönderildi. İşlem: <code>{sendTxSig}</code>
              </div>
            )}
          </form>

          <div className="pool-manage__section" style={{ marginTop: 20 }}>
            <div className="pool-manage__section-title">Herkese Açık Bakiyeden Yatır</div>
            <p className="subtab-desc">
              Normal (herkese açık) bakiyenizden gizli bakiyeye ek yatırım yapmak isterseniz.
            </p>
            <div className="pool-manage__amount-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder="ör. 100"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
            <button
              type="button"
              className="btn btn--secondary pool-manage__action-btn"
              onClick={handleDeposit}
              disabled={depositBusy || !!depositTx}
            >
              {depositBusy ? 'Yatırılıyor...' : depositTx ? 'Yatırıldı ✓' : 'Yatır'}
            </button>
            {depositTx && (
              <button
                type="button"
                className="btn btn--primary pool-manage__action-btn"
                onClick={handleApplyPendingBalance}
                disabled={applyBusy || !!applyTx}
                style={{ marginTop: 8 }}
              >
                {applyBusy ? 'Uygulanıyor...' : applyTx ? 'Bekleyen Bakiye Uygulandı ✓' : 'Bekleyen Bakiyeyi Uygula'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
