import { useState, type FormEvent } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import type { ApiV3PoolInfoStandardItemCpmm, CpmmKeys } from '@raydium-io/raydium-sdk-v2'
import {
  NATIVE_SOL_MINT,
  addCpmmLiquidity,
  createCpmmPool,
  getMintInfo,
  getPoolById,
  getWalletTokenBalance,
  loadRaydium,
  searchPoolsByMint,
  withdrawCpmmLiquidity,
  type MintRef,
  type PoolSummary,
} from '../lib/raydium'
import { NETWORKS, type NetworkId } from '../config'

interface Props {
  network: NetworkId
}

type SubTab = 'search' | 'create' | 'manage'

function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('tr-TR', { maximumFractionDigits: digits })
}

export function LiquidityPage({ network }: Props) {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [subTab, setSubTab] = useState<SubTab>('search')

  return (
    <div className="liquidity-page">
      <div className="subtabs">
        <button
          type="button"
          className={`subtab ${subTab === 'search' ? 'subtab--active' : ''}`}
          onClick={() => setSubTab('search')}
        >
          Havuz Ara
        </button>
        <button
          type="button"
          className={`subtab ${subTab === 'create' ? 'subtab--active' : ''}`}
          onClick={() => setSubTab('create')}
        >
          Havuz Oluştur
        </button>
        <button
          type="button"
          className={`subtab ${subTab === 'manage' ? 'subtab--active' : ''}`}
          onClick={() => setSubTab('manage')}
        >
          Likidite Ekle / Çıkar
        </button>
      </div>

      {subTab === 'search' && <PoolSearch network={network} />}
      {subTab === 'create' && <PoolCreate network={network} connection={connection} wallet={wallet} />}
      {subTab === 'manage' && <PoolManage network={network} connection={connection} wallet={wallet} />}
    </div>
  )
}

function PoolSearch({ network }: { network: NetworkId }) {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [mint1, setMint1] = useState('')
  const [mint2, setMint2] = useState('')
  const [pools, setPools] = useState<PoolSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    setError('')
    setPools(null)

    if (network === 'devnet') {
      setError(
        'Havuz arama, Raydium\'un herkese açık indeksleme servisi üzerinden çalışır ve yalnızca Mainnet verisini kapsar. Devnet\'te havuz aramak için lütfen ağ seçiciden Mainnet\'e geçin.',
      )
      return
    }
    if (!mint1.trim()) {
      setError('En az bir token mint adresi girin.')
      return
    }

    setLoading(true)
    try {
      const raydium = await loadRaydium(connection, wallet, network)
      const results = await searchPoolsByMint(raydium, mint1.trim(), mint2.trim() || undefined)
      setPools(results)
      if (results.length === 0) setError('Bu token(lar) için havuz bulunamadı.')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Havuzlar aranırken bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="token-form">
      <h2>Havuz Ara / Kontrol Et</h2>
      <p className="subtab-desc">
        Bir token'ın mevcut Raydium havuzlarını, fiyatını ve likiditesini görüntüleyin. Bu bölüm
        salt okunurdur — hiçbir işlem yapmaz, cüzdan bağlamanıza gerek yoktur.
      </p>

      <form onSubmit={handleSearch}>
        <div className="form-grid">
          <label className="field">
            <span>Token Mint Adresi *</span>
            <input
              type="text"
              placeholder="ör. token mint adresiniz"
              value={mint1}
              onChange={(e) => setMint1(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Eşleşecek 2. Token (opsiyonel)</span>
            <input
              type="text"
              placeholder="boş bırakılırsa tüm havuzlar"
              value={mint2}
              onChange={(e) => setMint2(e.target.value)}
            />
          </label>
        </div>
        <button type="button" className="btn btn--secondary" style={{ marginBottom: 16 }} onClick={() => setMint2(NATIVE_SOL_MINT)}>
          2. token olarak SOL kullan
        </button>
        {error && <div className="alert alert--error">{error}</div>}
        <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
          {loading ? 'Aranıyor...' : 'Ara'}
        </button>
      </form>

      {pools && pools.length > 0 && (
        <div className="pool-list">
          {pools.map((p) => (
            <div className="pool-card" key={p.id}>
              <div className="pool-card__header">
                <strong>
                  {p.mintA.symbol} / {p.mintB.symbol}
                </strong>
                <span className="pool-card__badge">{p.type === 'Concentrated' ? 'CLMM' : 'CPMM'}</span>
              </div>
              <div className="pool-card__row">
                <span>Fiyat</span>
                <span>
                  {fmtNum(p.price)} {p.mintB.symbol}
                </span>
              </div>
              <div className="pool-card__row">
                <span>Toplam Likidite (TVL)</span>
                <span>${fmtNum(p.tvl, 2)}</span>
              </div>
              <div className="pool-card__row">
                <span>Rezervler</span>
                <span>
                  {fmtNum(p.mintAmountA, 4)} {p.mintA.symbol} / {fmtNum(p.mintAmountB, 4)}{' '}
                  {p.mintB.symbol}
                </span>
              </div>
              <div className="pool-card__row">
                <span>İşlem Ücreti</span>
                <span>%{fmtNum(p.feeRatePct, 3)}</span>
              </div>
              <div className="pool-card__row">
                <span>Havuz ID</span>
                <code className="pool-card__id">{p.id}</code>
              </div>
              <a
                className="btn btn--secondary"
                href={`https://raydium.io/liquidity-pools/?token=${p.mintA.address}`}
                target="_blank"
                rel="noreferrer"
              >
                Raydium'da Görüntüle
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PoolCreate({
  network,
  connection,
  wallet,
}: {
  network: NetworkId
  connection: ReturnType<typeof useConnection>['connection']
  wallet: ReturnType<typeof useWallet>
}) {
  const [mintAAddr, setMintAAddr] = useState('')
  const [mintBAddr, setMintBAddr] = useState('')
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ txId: string; poolId: string } | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError('')
    setResult(null)

    if (!wallet.connected || !wallet.publicKey) {
      setError('Devam etmek için önce cüzdanınızı bağlayın.')
      return
    }
    if (!mintAAddr.trim() || !mintBAddr.trim()) {
      setError('İki token mint adresini de girin.')
      return
    }
    const amtA = Number(amountA)
    const amtB = Number(amountB)
    if (!amountA || !amountB || amtA <= 0 || amtB <= 0) {
      setError('Her iki token için de sıfırdan büyük bir başlangıç miktarı girin.')
      return
    }

    setLoading(true)
    try {
      setStatus('Token bilgileri zincirden okunuyor...')
      let mintA: MintRef
      let mintB: MintRef
      try {
        mintA = await getMintInfo(connection, mintAAddr.trim())
      } catch {
        throw new Error('A token mint adresi geçersiz ya da bulunamadı.')
      }
      try {
        mintB = await getMintInfo(connection, mintBAddr.trim())
      } catch {
        throw new Error('B token mint adresi geçersiz ya da bulunamadı.')
      }

      const raydium = await loadRaydium(connection, wallet, network)
      const res = await createCpmmPool(raydium, network, mintA, mintB, amountA, amountB, setStatus)
      setResult(res)
      setStatus('')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Havuz oluşturulurken bir hata oluştu.')
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    const cluster = NETWORKS[network].explorerCluster
    return (
      <div className="result-card">
        <div className="result-card__icon">✅</div>
        <h2>Havuz Oluşturuldu!</h2>
        <p>Likidite havuzunuz zincir üzerinde oluşturuldu ve belirttiğiniz miktarlar yatırıldı.</p>
        <div className="result-card__row">
          <span>Havuz ID</span>
          <code>{result.poolId}</code>
        </div>
        <div className="result-card__row">
          <span>İşlem İmzası</span>
          <code>{result.txId}</code>
        </div>
        <div className="result-card__links">
          <a
            className="btn btn--secondary"
            href={`https://explorer.solana.com/address/${result.poolId}${cluster}`}
            target="_blank"
            rel="noreferrer"
          >
            Explorer'da Görüntüle
          </a>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => {
            setResult(null)
            setMintAAddr('')
            setMintBAddr('')
            setAmountA('')
            setAmountB('')
          }}
        >
          Yeni Havuz Oluştur
        </button>
      </div>
    )
  }

  return (
    <form className="token-form" onSubmit={handleCreate}>
      <h2>Yeni Likidite Havuzu Oluştur</h2>
      <p className="subtab-desc">
        İki token için sabit-çarpım (CPMM) havuzu oluşturur. Girdiğiniz miktarlar havuzun
        başlangıç fiyatını belirler ve cüzdanınızdan bu havuza yatırılır.
      </p>

      <div className="alert alert--warning">
        ⚠️ Bu işlem geri alınamaz ve gerçek token/SOL yatırmanızı gerektirir. Önce{' '}
        <strong>Devnet</strong>'te (test ağı) deneyin. Yanlış miktar girmek, havuzun başlangıç
        fiyatını yanlış ayarlayabilir.
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Token A Mint Adresi *</span>
          <input
            type="text"
            placeholder="ör. kendi token'ınızın mint adresi"
            value={mintAAddr}
            onChange={(e) => setMintAAddr(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Token B Mint Adresi *</span>
          <input
            type="text"
            placeholder="ör. SOL mint adresi"
            value={mintBAddr}
            onChange={(e) => setMintBAddr(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn btn--secondary"
        style={{ marginBottom: 16 }}
        onClick={() => setMintBAddr(NATIVE_SOL_MINT)}
      >
        Token B olarak SOL kullan
      </button>

      <div className="form-grid">
        <label className="field">
          <span>Token A Başlangıç Miktarı *</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="ör. 1000000"
            value={amountA}
            onChange={(e) => setAmountA(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </label>
        <label className="field">
          <span>Token B Başlangıç Miktarı *</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="ör. 10"
            value={amountB}
            onChange={(e) => setAmountB(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </label>
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      {status && !error && <div className="alert alert--info">{status}</div>}

      <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
        {loading ? 'Oluşturuluyor...' : wallet.connected ? 'Havuz Oluştur' : 'Önce Cüzdan Bağlayın'}
      </button>
    </form>
  )
}

function PoolManage({
  network,
  connection,
  wallet,
}: {
  network: NetworkId
  connection: ReturnType<typeof useConnection>['connection']
  wallet: ReturnType<typeof useWallet>
}) {
  const [poolId, setPoolId] = useState('')
  const [poolInfo, setPoolInfo] = useState<ApiV3PoolInfoStandardItemCpmm | null>(null)
  const [poolKeys, setPoolKeys] = useState<CpmmKeys | undefined>(undefined)
  const [loadingPool, setLoadingPool] = useState(false)
  const [addAmount, setAddAmount] = useState('')
  const [withdrawPercent, setWithdrawPercent] = useState(0)
  const [lpBalance, setLpBalance] = useState(0)
  const [tokenABalance, setTokenABalance] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [txResult, setTxResult] = useState('')

  async function refreshBalances(pool: ApiV3PoolInfoStandardItemCpmm) {
    if (!wallet.publicKey) return
    const [lp, tokenA] = await Promise.all([
      getWalletTokenBalance(connection, wallet.publicKey, pool.lpMint.address, pool.lpMint.programId),
      getWalletTokenBalance(connection, wallet.publicKey, pool.mintA.address, pool.mintA.programId),
    ])
    setLpBalance(lp)
    setTokenABalance(tokenA)
  }

  async function handleLoadPool(e: FormEvent) {
    e.preventDefault()
    setError('')
    setTxResult('')
    setPoolInfo(null)
    setWithdrawPercent(0)
    if (!poolId.trim()) {
      setError('Havuz ID girin.')
      return
    }
    setLoadingPool(true)
    try {
      const raydium = await loadRaydium(connection, wallet, network)
      const { poolInfo, poolKeys } = await getPoolById(raydium, poolId.trim(), network)
      setPoolInfo(poolInfo)
      setPoolKeys(poolKeys)
      await refreshBalances(poolInfo)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Havuz bulunamadı.')
    } finally {
      setLoadingPool(false)
    }
  }

  async function handleAdd() {
    if (!poolInfo) return
    setError('')
    setTxResult('')
    if (!wallet.connected) {
      setError('Devam etmek için önce cüzdanınızı bağlayın.')
      return
    }
    if (!addAmount || Number(addAmount) <= 0) {
      setError('Geçerli bir miktar girin.')
      return
    }
    setBusy(true)
    try {
      const raydium = await loadRaydium(connection, wallet, network)
      const txId = await addCpmmLiquidity(raydium, poolInfo, poolKeys, addAmount, true, setStatus)
      setTxResult(txId)
      setStatus('')
      setAddAmount('')
      await refreshBalances(poolInfo)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Likidite eklenirken bir hata oluştu.')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const withdrawLpAmount = (lpBalance * withdrawPercent) / 100
  const withdrawEstimatedA = poolInfo?.lpAmount
    ? (withdrawLpAmount / poolInfo.lpAmount) * poolInfo.mintAmountA
    : 0
  const withdrawEstimatedB = poolInfo?.lpAmount
    ? (withdrawLpAmount / poolInfo.lpAmount) * poolInfo.mintAmountB
    : 0

  async function handleWithdraw() {
    if (!poolInfo) return
    setError('')
    setTxResult('')
    if (!wallet.connected) {
      setError('Devam etmek için önce cüzdanınızı bağlayın.')
      return
    }
    if (withdrawLpAmount <= 0) {
      setError('Çekmek için yüzde belirleyin (bakiyeniz 0 olabilir).')
      return
    }
    setBusy(true)
    try {
      const raydium = await loadRaydium(connection, wallet, network)
      const txId = await withdrawCpmmLiquidity(
        raydium,
        poolInfo,
        poolKeys,
        withdrawLpAmount.toString(),
        setStatus,
      )
      setTxResult(txId)
      setStatus('')
      setWithdrawPercent(0)
      await refreshBalances(poolInfo)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Likidite çekilirken bir hata oluştu.')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="token-form">
      <h2>Likidite Ekle / Çıkar</h2>
      <p className="subtab-desc">
        Bildiğiniz bir havuz ID'sine likidite ekleyin ya da LP token'ınızı geri çekin.
      </p>

      <form onSubmit={handleLoadPool}>
        <label className="field">
          <span>Havuz ID *</span>
          <input
            type="text"
            placeholder="ör. havuz oluşturunca aldığınız Pool ID"
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--secondary" disabled={loadingPool}>
          {loadingPool ? 'Getiriliyor...' : 'Havuzu Getir'}
        </button>
      </form>

      {error && <div className="alert alert--error" style={{ marginTop: 16 }}>{error}</div>}

      {poolInfo && (
        <div className="pool-card" style={{ marginTop: 20 }}>
          <div className="pool-card__header">
            <strong>
              {poolInfo.mintA.symbol || '?'} / {poolInfo.mintB.symbol || '?'}
            </strong>
          </div>
          <div className="pool-card__row">
            <span>Fiyat</span>
            <span>
              {fmtNum(poolInfo.price)} {poolInfo.mintB.symbol}
            </span>
          </div>
          <div className="pool-card__row">
            <span>Rezervler</span>
            <span>
              {fmtNum(poolInfo.mintAmountA, 4)} {poolInfo.mintA.symbol} /{' '}
              {fmtNum(poolInfo.mintAmountB, 4)} {poolInfo.mintB.symbol}
            </span>
          </div>

          <hr className="pool-manage__divider" />

          <div className="pool-manage__section">
            <div className="pool-manage__section-title">Likidite Ekle</div>
            <label className="field">
              <span>
                Eklenecek {poolInfo.mintA.symbol} Miktarı
                <small className="pool-manage__balance-hint">
                  {' '}
                  (bakiyeniz: {fmtNum(tokenABalance, 6)} {poolInfo.mintA.symbol})
                </small>
              </span>
              <div className="pool-manage__amount-row">
                <input
                  type="text"
                  inputMode="decimal"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value.replace(/[^\d.]/g, ''))}
                />
                <button
                  type="button"
                  className="btn btn--secondary pool-manage__max-btn"
                  onClick={() => setAddAmount(String(tokenABalance))}
                  disabled={tokenABalance <= 0}
                >
                  MAX
                </button>
              </div>
            </label>
            {addAmount && Number(addAmount) > 0 && (
              <small className="pool-manage__preview">
                ≈ {fmtNum(Number(addAmount) * poolInfo.price)} {poolInfo.mintB.symbol} eşleşecek
                (kesin miktar işlem sırasında hesaplanır)
              </small>
            )}
            <button
              type="button"
              className="btn btn--primary pool-manage__action-btn"
              onClick={handleAdd}
              disabled={busy}
            >
              {busy ? 'İşleniyor...' : 'Likidite Ekle'}
            </button>
          </div>

          <hr className="pool-manage__divider" />

          <div className="pool-manage__section">
            <div className="pool-manage__section-title">
              Likidite Çek
              <small className="pool-manage__balance-hint">
                {' '}
                (LP bakiyeniz: {fmtNum(lpBalance, 6)})
              </small>
            </div>

            <div className="pool-manage__percent-display">%{withdrawPercent}</div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={withdrawPercent}
              onChange={(e) => setWithdrawPercent(Number(e.target.value))}
              className="pool-manage__slider"
              disabled={lpBalance <= 0}
            />
            <div className="pool-manage__percent-buttons">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className="btn btn--secondary pool-manage__percent-btn"
                  onClick={() => setWithdrawPercent(pct)}
                  disabled={lpBalance <= 0}
                >
                  %{pct}
                </button>
              ))}
            </div>

            {withdrawPercent > 0 && (
              <small className="pool-manage__preview">
                Çekilecek: {fmtNum(withdrawLpAmount, 6)} LP ≈ {fmtNum(withdrawEstimatedA, 4)}{' '}
                {poolInfo.mintA.symbol} + {fmtNum(withdrawEstimatedB, 4)} {poolInfo.mintB.symbol}
              </small>
            )}

            <button
              type="button"
              className="btn btn--secondary pool-manage__action-btn"
              onClick={handleWithdraw}
              disabled={busy || lpBalance <= 0}
            >
              {busy ? 'İşleniyor...' : 'Likidite Çek'}
            </button>
          </div>

          {status && <div className="alert alert--info">{status}</div>}
          {txResult && (
            <div className="alert alert--info">
              İşlem başarılı: <code>{txResult}</code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
