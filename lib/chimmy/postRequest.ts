/** Reuse the same form identity on transport retries and token confirmation. */
export async function postChimmyRequest(form: FormData, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!form.get('requestId')) form.set('requestId', crypto.randomUUID())
  let response: Response
  try {
    response = await fetcher('/api/chat/chimmy', { method: 'POST', body: form })
  } catch {
    // The first response may have been lost after billing. Never generate another identity.
    response = await fetcher('/api/chat/chimmy', { method: 'POST', body: form })
  }
  const started = Date.now()
  while (response.status === 202 && Date.now() - started < 5 * 60_000) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    response = await fetcher(`/api/chat/chimmy?requestId=${encodeURIComponent(String(form.get('requestId')))}`, { cache: 'no-store' })
  }
  if (response.status === 202) throw new Error('Your answer is still processing. Check your Chimmy history before asking again.')
  return response
}
