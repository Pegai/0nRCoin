import { useState, type FormEvent } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { createToken, type TokenFormData, type CreateTokenResult } from '../lib/createToken'
import { DEFAULT_DECIMALS, FEE_WALLET, FEE_AMOUNT_SOL, type NetworkId } from '../config'
import { ResultCard } from './ResultCard'

const initialState: TokenFormData = {
  name: '',
  symbol: '',
  decimals: DEFAULT_DECIMALS,
  supply: '1000000000',
  description: '',
  imageUri: '',
  website: '',
  twitter: '',
  telegram: '',
  revokeMint: false,
  revokeFreeze: false,
  immutable: false,
}

interface Props {
  network: NetworkId
}

export function TokenForm({ network }: Props) {
  const { connection } = useConnection()
  const wallet = useWallet()

  const [form, setForm] = useState<TokenFormData>(initialState)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CreateTokenResult | null>(null)

  function update<K extends keyof TokenFormData>(key: K, value: TokenFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Token adı zorunludur.'
    if (form.name.length > 32) return 'Token adı 32 karakterden uzun olamaz.'
    if (!form.symbol.trim()) return 'Sembol (ticker) zorunludur.'
    if (form.symbol.length > 10) return 'Sembol 10 karakterden uzun olamaz.'
    if (form.decimals < 0 || form.decimals > 9) return 'Ondalık basamak 0-9 arasında olmalıdır.'
    if (!/^\d+$/.test(form.supply) || BigInt(form.supply) <= 0n) return 'Geçerli bir arz miktarı girin.'
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setResult(null)

    if (!wallet.connected || !wallet.publicKey) {
      setError('Devam etmek için önce cüzdanınızı bağlayın.')
      return
    }

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      const res = await createToken(connection, wallet, form, setStatus)
      setResult(res)
      setStatus('')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Token oluşturulurken bir hata oluştu.')
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <ResultCard
        result={result}
        network={network}
        onReset={() => {
          setResult(null)
          setForm(initialState)
        }}
      />
    )
  }

  return (
    <form className="token-form" onSubmit={handleSubmit}>
      <h2>Token Bilgileri</h2>

      <div className="form-grid">
        <label className="field">
          <span>Token Adı *</span>
          <input
            type="text"
            placeholder="ör. 0nRCoin"
            value={form.name}
            maxLength={32}
            onChange={(e) => update('name', e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Sembol *</span>
          <input
            type="text"
            placeholder="ör. 0NRC"
            value={form.symbol}
            maxLength={10}
            onChange={(e) => update('symbol', e.target.value.toUpperCase())}
            required
          />
        </label>

        <label className="field">
          <span>Ondalık Basamak (Decimals)</span>
          <input
            type="number"
            min={0}
            max={9}
            value={form.decimals}
            onChange={(e) => update('decimals', Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Toplam Arz (Supply) *</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="ör. 1000000000"
            value={form.supply}
            onChange={(e) => update('supply', e.target.value.replace(/[^\d]/g, ''))}
            required
          />
        </label>
      </div>

      <label className="field">
        <span>Açıklama</span>
        <textarea
          placeholder="Token'ınız hakkında kısa bir açıklama"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          rows={3}
        />
      </label>

      <label className="field">
        <span>Metadata / Logo URI (opsiyonel)</span>
        <input
          type="text"
          placeholder="https://... (IPFS/Arweave üzerinde barındırılan metadata.json linki)"
          value={form.imageUri}
          onChange={(e) => update('imageUri', e.target.value)}
        />
        <small>
          Logo ve açıklamanın cüzdanlarda görünmesi için isim/sembol/görsel içeren bir JSON dosyasını
          IPFS veya Arweave gibi bir servise yükleyip linkini buraya yapıştırabilirsiniz. Boş
          bırakırsanız token yine oluşturulur, yalnızca zincir dışı metadata eklenmez.
        </small>
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Website</span>
          <input
            type="text"
            placeholder="https://..."
            value={form.website}
            onChange={(e) => update('website', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Twitter / X</span>
          <input
            type="text"
            placeholder="https://x.com/..."
            value={form.twitter}
            onChange={(e) => update('twitter', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Telegram</span>
          <input
            type="text"
            placeholder="https://t.me/..."
            value={form.telegram}
            onChange={(e) => update('telegram', e.target.value)}
          />
        </label>
      </div>

      <fieldset className="authorities">
        <legend>Gelişmiş Yetkiler</legend>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.revokeMint}
            onChange={(e) => update('revokeMint', e.target.checked)}
          />
          <div>
            <strong>Mint Yetkisini Kaldır</strong>
            <small>Oluşturduktan sonra kimse (siz dahil) yeni token basamaz — arz sabitlenir.</small>
          </div>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.revokeFreeze}
            onChange={(e) => update('revokeFreeze', e.target.checked)}
          />
          <div>
            <strong>Freeze Yetkisini Kaldır</strong>
            <small>Token hesapları artık dondurulamaz.</small>
          </div>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.immutable}
            onChange={(e) => update('immutable', e.target.checked)}
          />
          <div>
            <strong>Metadata'yı Sabitle (Immutable)</strong>
            <small>İsim, sembol ve metadata bir daha güncellenemez.</small>
          </div>
        </label>
      </fieldset>

      {FEE_WALLET && (
        <div className="fee-note">
          Hizmet ücreti: <strong>{FEE_AMOUNT_SOL} SOL</strong> + ağ işlem ücreti. Ücret, cüzdanınızda
          onayladığınız işlemin bir parçası olarak gösterilir.
        </div>
      )}

      {error && <div className="alert alert--error">{error}</div>}
      {status && !error && <div className="alert alert--info">{status}</div>}

      <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
        {loading ? 'Oluşturuluyor...' : wallet.connected ? 'Token Oluştur' : 'Önce Cüzdan Bağlayın'}
      </button>
    </form>
  )
}
