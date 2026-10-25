import { createHash } from 'node:crypto'

/** Consent changes the authorization to spend, not the identity of the question. */
export async function fingerprintChimmyRequest(form: FormData): Promise<string> {
  const hash = createHash('sha256')
  const entries = [...form.entries()].filter(([key]) => !['requestId', 'confirmTokenSpend', 'tokenQuote', 'analysisUnlock'].includes(key))
  if (entries.length > 100) throw new Error('Too many request fields')
  entries.sort(([a], [b]) => a.localeCompare(b))
  let totalBytes = 0
  for (const [key, value] of entries) {
    totalBytes += typeof value === 'string' ? Buffer.byteLength(value) : value.size
    if (totalBytes > 6 * 1024 * 1024) throw new Error('Request too large')
    hash.update(JSON.stringify([key, typeof value === 'string' ? value : [value.name, value.type, value.size]]))
    if (typeof value !== 'string') {
      if (value.size > 5 * 1024 * 1024) throw new Error('Attachment too large')
      hash.update(new Uint8Array(await value.arrayBuffer()))
    }
  }
  return hash.digest('hex')
}

