import { Suspense, lazy, useMemo, useState } from 'react'
import { WalletContextProvider } from './context/WalletContextProvider'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { TokenForm } from './components/TokenForm'
import { Footer } from './components/Footer'
import { NETWORKS, DEFAULT_NETWORK, type NetworkId } from './config'

// Raydium SDK oldukça büyük olduğu için bu sekmeyi yalnızca kullanıcı
// gerçekten ziyaret ettiğinde ayrı bir parça (chunk) olarak yüklüyoruz —
// Token Oluştur sayfasının ilk açılışını yavaşlatmasın diye.
const LiquidityPage = lazy(() =>
  import('./components/LiquidityPage').then((m) => ({ default: m.LiquidityPage })),
)

type Page = 'create' | 'liquidity'

function App() {
  const [network, setNetwork] = useState<NetworkId>(DEFAULT_NETWORK)
  const [page, setPage] = useState<Page>('create')
  const endpoint = useMemo(() => NETWORKS[network].endpoint, [network])

  return (
    <WalletContextProvider endpoint={endpoint}>
      <div className="app-shell">
        <Header network={network} onNetworkChange={setNetwork} />
        <nav className="page-tabs">
          <button
            type="button"
            className={`page-tab ${page === 'create' ? 'page-tab--active' : ''}`}
            onClick={() => setPage('create')}
          >
            Token Oluştur
          </button>
          <button
            type="button"
            className={`page-tab ${page === 'liquidity' ? 'page-tab--active' : ''}`}
            onClick={() => setPage('liquidity')}
          >
            Likidite Havuzu
          </button>
        </nav>
        <main>
          {page === 'create' ? (
            <>
              <Hero />
              <div className="form-section">
                <TokenForm network={network} />
              </div>
            </>
          ) : (
            <div className="form-section form-section--wide">
              <Suspense fallback={<div className="alert alert--info">Yükleniyor...</div>}>
                <LiquidityPage network={network} />
              </Suspense>
            </div>
          )}
        </main>
        <Footer />
      </div>
    </WalletContextProvider>
  )
}

export default App
