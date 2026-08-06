export function Footer() {
  return (
    <footer className="site-footer">
      <p>
        Bu araç, Solana ağı üzerinde SPL Token oluşturmak için tamamen istemci tarafında (client-side)
        çalışır. Özel anahtarlarınız hiçbir zaman bu siteye veya bir sunucuya gönderilmez; tüm
        işlemler cüzdanınızda imzalanır.
      </p>
      <p className="site-footer__disclaimer">
        ⚠️ Kripto varlık oluşturmak ve dağıtmak yasal sorumluluklar doğurabilir. Mainnet'te işlem
        yapmadan önce Devnet üzerinde test edin. Bu bir yatırım tavsiyesi değildir.
      </p>
    </footer>
  )
}
