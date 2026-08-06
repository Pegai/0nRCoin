import { useMemo, useState } from 'react'
import { WalletContextProvider } from './context/WalletContextProvider'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { TokenForm } from './components/TokenForm'
import { Footer } from './components/Footer'
import { NETWORKS, DEFAULT_NETWORK, type NetworkId } from './config'

function App() {
  const [network, setNetwork] = useState<NetworkId>(DEFAULT_NETWORK)
  const endpoint = useMemo(() => NETWORKS[network].endpoint, [network])

  return (
    <WalletContextProvider endpoint={endpoint}>
      <div className="app-shell">
        <Header network={network} onNetworkChange={setNetwork} />
        <main>
          <Hero />
          <div className="form-section">
            <TokenForm network={network} />
          </div>
        </main>
        <Footer />
      </div>
    </WalletContextProvider>
  )
}

export default App
