// Solana'nın Token Metadata programı on-chain "uri" alanını ~200 karakterle
// sınırlar, bu yüzden logo görselini doğrudan base64 olarak zincire yazmak
// mümkün değil. Bunun yerine görseli + metadata JSON'unu Pinata üzerinden
// IPFS'e yükleyip kısa bir gateway linkini on-chain uri olarak kullanıyoruz.
// Pinata'nın ücretsiz planı bu iş için yeterlidir: https://app.pinata.cloud

export interface OnChainMetadataInput {
  name: string
  symbol: string
  description: string
  website: string
  twitter: string
  telegram: string
}

async function pinataRequest(path: string, jwt: string, init: RequestInit) {
  const res = await fetch(`https://api.pinata.cloud${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${jwt}`,
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Pinata isteği başarısız oldu (${res.status}). Anahtarınızı kontrol edin.${body ? ` Detay: ${body.slice(0, 200)}` : ''}`,
    )
  }

  return res.json()
}

export async function uploadImageToPinata(file: File, jwt: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const data = await pinataRequest('/pinning/pinFileToIPFS', jwt, {
    method: 'POST',
    body: formData,
  })

  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`
}

export async function uploadMetadataToPinata(
  input: OnChainMetadataInput,
  imageUrl: string,
  jwt: string,
): Promise<string> {
  const json = {
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    image: imageUrl,
    external_url: input.website || undefined,
    extensions: {
      website: input.website || undefined,
      twitter: input.twitter || undefined,
      telegram: input.telegram || undefined,
    },
    properties: {
      files: [{ uri: imageUrl, type: 'image/png' }],
      category: 'image',
    },
  }

  const data = await pinataRequest('/pinning/pinJSONToIPFS', jwt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  })

  return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`
}
