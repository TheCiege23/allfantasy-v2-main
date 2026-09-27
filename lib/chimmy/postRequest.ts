type PendingStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>
function browserStorage(): PendingStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage } catch { return undefined }
}
async function pendingKey(form: FormData): Promise<string> {
  const identity: unknown[] = []
  // History and home signals may refresh while recovering the same question.
  for (const [key,value] of [...form.entries()].filter(([key]) => !['requestId','confirmTokenSpend','conversation','homeSignals'].includes(key)).sort(([a],[b]) => a.localeCompare(b))) {
    if (typeof value === 'string') identity.push([key,value])
    else {
      const digest = await crypto.subtle.digest('SHA-256',await value.arrayBuffer())
      identity.push([key,value.name,value.type,Array.from(new Uint8Array(digest))])
    }
  }
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)))
  return `chimmy-pending:${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}`
}

/** Preserve pending identity across transport failure, manual retry and page reload. Storage contains only hashes and IDs. */
export async function postChimmyRequest(form: FormData, fetcher: typeof fetch = fetch,
  storage: PendingStorage | undefined = browserStorage()): Promise<Response> {
  if (!form.get('requestId')) form.set('requestId', crypto.randomUUID())
  let key: string | undefined
  let pending: string | null = null
  try {
    if (storage) { key = await pendingKey(form); pending = storage.getItem(key) }
  } catch { storage = undefined }
  if (pending) form.set('requestId',pending)
  try { if (storage && key) storage.setItem(key,String(form.get('requestId'))) } catch { storage = undefined }
  let response: Response
  const post = async () => {
    const init = { method:'POST',body:form,headers:{'x-chimmy-request-id':String(form.get('requestId'))} }
    try { return await fetcher('/api/chat/chimmy',init) }
    catch { return fetcher('/api/chat/chimmy',init) }
  }
  if (pending) {
    response = await fetcher(`/api/chat/chimmy?requestId=${encodeURIComponent(pending)}`,{cache:'no-store'})
    const confirmation = response.status === 409 && (await response.clone().json().catch(()=>({}))).code === 'token_confirmation_required'
    if (response.status === 404 || (confirmation && form.get('confirmTokenSpend') === 'true')) response = await post()
  } else response = await post()
  const started = Date.now()
  while (response.status === 202 && Date.now() - started < 5 * 60_000) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    response = await fetcher(`/api/chat/chimmy?requestId=${encodeURIComponent(String(form.get('requestId')))}`, { cache: 'no-store' })
  }
  if (response.status === 202) throw new Error('Your answer is still processing. Check your Chimmy history before asking again.')
  const code = (await response.clone().json().catch(()=>({}))).code
  const resumable = code === 'token_confirmation_required' || code === 'chimmy_request_recovery_pending'
  if (!resumable && (response.status < 500 || ['chimmy_request_failed','chimmy_request_expired'].includes(code))) {
    try { if (storage && key) storage.removeItem(key) } catch { /* storage is optional */ }
  }
  return response
}
