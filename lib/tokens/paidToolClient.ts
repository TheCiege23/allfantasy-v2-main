/** Private per-tab retry identities. No question, lineup or report is written to browser storage. */
type Pending = { id: string; quote?: string; offered?: string; approved?: boolean; submitted?: boolean; updated: number; active?: number; uncertain?: boolean; completed?: boolean }
const entries = new Map<string, Pending>()
const STORAGE = 'af:paid-tools:pending:v1'
let restored = false
const OMIT = new Set(['confirmTokenSpend', 'confirmedTokenSpend', 'confirmed', 'tokenQuote', 'paidToolRequestId', 'paidToolVersion'])
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}
function restore() {
  if (restored) return; restored = true
  try {
    const rows = JSON.parse(sessionStorage.getItem(STORAGE) ?? '[]')
    for (const [key, value] of rows) if (typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) && value &&
      typeof value.id === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value.id) && typeof value.updated === 'number' && Date.now() - value.updated < 86400000) entries.set(key, value)
  } catch { /* Storage may be unavailable; in-memory retry protection remains. */ }
}
function persist() {
  try { sessionStorage.setItem(STORAGE, JSON.stringify([...entries].filter(([k]) => /^[a-f0-9]{64}$/.test(k)).map(([k, { active, completed, ...value }]) => [k, value]))) } catch { /* private mode */ }
}
async function fingerprint(url: string, body: Record<string, unknown>): Promise<string> {
  const content = JSON.stringify([url, canonical(Object.fromEntries(Object.entries(body).filter(([k]) => !OMIT.has(k))))])
  if (!globalThis.crypto?.subtle) return content // Memory only on old/non-secure runtimes.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('')
}
/** Call immediately after the person accepts THIS response's displayed price. Never auto-approve a replacement quote. */
export function approvePaidToolQuote(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const offer = body as { tokenQuote?: unknown; paidToolRequestId?: unknown; preview?: { tokenCost?: unknown } }
  if (typeof offer.tokenQuote !== 'string' || typeof offer.paidToolRequestId !== 'string' ||
      !Number.isSafeInteger(offer.preview?.tokenCost) || Number(offer.preview?.tokenCost) < 0) return false
  restore()
  for (const entry of entries.values()) if (entry.id === offer.paidToolRequestId && entry.offered === offer.tokenQuote) {
    entry.quote = offer.tokenQuote; entry.approved = true; entry.updated = Date.now(); persist(); return true
  }
  return false
}
/** JSON POST transport. Retries after ambiguous delivery reuse the approved request, even after reload. */
export async function paidToolFetch(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if ((init.method ?? 'GET').toUpperCase() !== 'POST' || typeof init.body !== 'string') return fetchImpl(url, init)
  let original: Record<string, unknown>
  try { original = JSON.parse(init.body); if (!original || typeof original !== 'object' || Array.isArray(original)) return fetchImpl(url, init) }
  catch { return fetchImpl(url, init) }
  restore()
  const key = await fingerprint(url, original)
  for (const [k, v] of entries) if (!v.active && Date.now() - v.updated > 86400000) entries.delete(k)
  let entry = entries.get(key)
  if (!entry) {
    if (entries.size >= 40) {
      const unused = [...entries].find(([, value]) => !value.active && !value.approved && !value.submitted)
      if (unused) entries.delete(unused[0])
    }
    if (entries.size >= 40) {
      // Do not evict an ambiguous paid attempt and silently replace its identity.
      return new Response(JSON.stringify({ error: 'Too many unfinished requests. Retry an existing request first.' }), { status: 429, headers: { 'Content-Type': 'application/json' } })
    }
    entry = { id: globalThis.crypto?.randomUUID?.() ?? `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`, updated: Date.now() }; entries.set(key, entry)
  }
  const current = entry
  const recovering = Boolean(current.uncertain) && !current.active
  current.active = (current.active ?? 0) + 1
  const run = async () => {
    const body = { ...original }
    const confirms = ['confirmTokenSpend', 'confirmedTokenSpend', 'confirmed'].filter(k => k in body)
    const requested = confirms.some(k => body[k] === true)
    if (current.approved && (requested || current.submitted)) {
      for (const field of confirms.length ? confirms : ['confirmTokenSpend']) body[field] = true
      current.submitted = true
    }
    const headers = new Headers(init.headers)
    headers.set('x-paid-tool-request-id', current.id)
    if (current.approved && current.quote) headers.set('x-paid-tool-quote', current.quote)
    current.updated = Date.now(); persist() // Write identity BEFORE sending a possibly paid request.
    try {
      let response: Response
      for (let attempt = 0; ; attempt++) {
        response = await fetchImpl(url, { ...init, headers, body: JSON.stringify(body) })
        if (response.status !== 202 || attempt >= 9) break
        const pending = await response.clone().json().catch(() => ({}))
        if (pending.code !== 'paid_tool_processing') break
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      const data = await response.clone().json().catch(() => ({}))
      if (response.status === 409 && data.code === 'token_confirmation_required') {
        current.approved = false; current.submitted = false; current.quote = undefined; current.uncertain = false; current.completed = false
        current.offered = typeof data.tokenQuote === 'string' ? data.tokenQuote : undefined
        if (typeof data.paidToolRequestId === 'string') current.id = data.paidToolRequestId
        persist()
      } else if (response.status === 202 || (response.headers.get('x-paid-tool-terminal') !== '1' && (response.status >= 500 || current.submitted))) {
        current.uncertain = true; persist()
        if (response.status === 202) return new Response(JSON.stringify({ code: 'paid_tool_processing', error: 'This request is still processing. Retry to check its result; you will not be charged again.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      } else { current.completed = true; if (recovering) current.uncertain = false }
      return response
    } catch (error) {
      current.uncertain = true; throw error
    } finally {
      current.active = Math.max(0, (current.active ?? 1) - 1)
      if (!current.active && current.completed && !current.uncertain && entries.get(key) === current) entries.delete(key)
      persist()
    }
  }
  return run()
}
/** For screens that previously posted confirmed=true directly, always ask using the action's own signed price. */
export async function paidToolFetchWithConfirm(url: string, init: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if ((init.method ?? 'GET').toUpperCase() !== 'POST' || typeof init.body !== 'string') return fetchImpl(url, init)
  const payload = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
  const fields = ['confirmTokenSpend', 'confirmedTokenSpend', 'confirmed'].filter(k => k in payload)
  for (const field of fields.length ? fields : ['confirmTokenSpend']) payload[field] = false
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await paidToolFetch(url, { ...init, body: JSON.stringify(payload) }, fetchImpl)
    const body = await response.clone().json().catch(() => ({}))
    if (response.status !== 409 || body.code !== 'token_confirmation_required') return response
    const cost = body.preview?.tokenCost
    if (!Number.isSafeInteger(cost) || cost < 0 || typeof window === 'undefined' ||
        !window.confirm(`Use ${cost} token${cost === 1 ? '' : 's'} for ${body.preview?.featureLabel ?? 'this request'}? Current balance: ${body.preview?.currentBalance ?? 'unknown'}.`)) return response
    if (!approvePaidToolQuote(body)) return response
    for (const field of fields.length ? fields : ['confirmTokenSpend']) payload[field] = true
  }
  return new Response(JSON.stringify({ error: 'The price changed. Review the price and try again.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
}
