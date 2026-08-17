import { useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { listAllWalletTokens, listWalletToken2022Accounts, type WalletTokenBalance } from '../lib/walletTokens'
import { getTokenMetadata } from '../lib/tokenMetadata'
import { NATIVE_SOL_MINT } from '../lib/raydium'

interface Props {
  /** true ise yalnızca Token-2022 hesapları listelenir (ör. gizli transfer). */
  token2022Only?: boolean
  /** true ise listenin başında hızlı "SOL" seçeneği gösterilir. */
  allowSol?: boolean
  onSelect: (mintAddress: string) => void
}

interface DisplayToken extends WalletTokenBalance {
  name?: string
  symbol?: string
}

const SOL_ENTRY: DisplayToken = {
  mint: NATIVE_SOL_MINT,
  tokenAccount: '',
  programId: '',
  uiAmount: '',
  decimals: 9,
  name: 'Solana',
  symbol: 'SOL',
}

/**
 * Cüzdandaki coin'leri isimleriyle listeleyip seçtiren, sayfalar arası
 * paylaşılan bir seçici. Seçim yapıldığında sadece mint adresini bildirir —
 * seçildikten sonra ne yapılacağına (havuz oluşturma, gizli transfer vb.)
 * çağıran sayfa karar verir.
 */
export function CoinPicker({ token2022Only = false, allowSol = false, onSelect }: Props) {
  const { connection } = useConnection()
  const wallet = useWallet()

  const [tokens, setTokens] = useState<DisplayToken[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [manualMint, setManualMint] = useState('')

  useEffect(() => {
    if (!wallet.publicKey) {
      setTokens(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    const list = token2022Only
      ? listWalletToken2022Accounts(connection, wallet.publicKey)
      : listAllWalletTokens(connection, wallet.publicKey)

    list
      .then(async (result) => {
        if (cancelled) return
        setTokens(result)
        // İsim/sembolleri arka planda tek tek doldur — liste hemen görünsün,
        // metadata geldikçe güncellensin.
        result.forEach((t, i) => {
          getTokenMetadata(connection, new PublicKey(t.mint)).then((meta) => {
            if (cancelled || !meta) return
            setTokens((prev) => {
              if (!prev) return prev
              const next = [...prev]
              next[i] = { ...next[i], name: meta.name, symbol: meta.symbol }
              return next
            })
          })
        })
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Token listesi alınamadı.'))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [connection, wallet.publicKey, token2022Only])

  const displayList = allowSol ? [SOL_ENTRY, ...(tokens ?? [])] : tokens

  return (
    <div className="pool-manage__section" style={{ marginBottom: 12 }}>
      {loading && <p className="subtab-desc">Cüzdanınızdaki token'lar yükleniyor...</p>}
      {error && <div className="alert alert--error">{error}</div>}
      {!wallet.connected && <p className="subtab-desc">Devam etmek için önce cüzdanınızı bağlayın.</p>}
      {displayList && displayList.length === 0 && (
        <p className="subtab-desc">Cüzdanınızda coin bulunamadı.</p>
      )}
      {displayList && displayList.length > 0 && (
        <div className="pool-list">
          {displayList.map((t) => (
            <button
              type="button"
              key={t.mint + t.tokenAccount}
              className="pool-card"
              style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
              onClick={() => onSelect(t.mint)}
            >
              <div className="pool-card__row">
                <span>{t.name ? `${t.name}${t.symbol ? ` (${t.symbol})` : ''}` : 'İsimsiz Token'}</span>
                {t.uiAmount && <span>{t.uiAmount}</span>}
              </div>
              <code className="pool-card__id">{t.mint}</code>
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (manualMint.trim()) onSelect(manualMint.trim())
        }}
        style={{ marginTop: 12 }}
      >
        <label className="field">
          <span>Ya da mint adresini yapıştırın</span>
          <input
            type="text"
            placeholder="Token mint adresi"
            value={manualMint}
            onChange={(e) => setManualMint(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--secondary">
          Bu Mint'i Kullan
        </button>
      </form>
    </div>
  )
}
