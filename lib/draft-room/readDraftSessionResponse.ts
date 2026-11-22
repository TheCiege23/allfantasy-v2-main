export async function fetchDraftSessionResponse(leagueId: string) {
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/draft/session`
  const options: RequestInit = { cache: 'no-store' }
  const supportsCompression = typeof DecompressionStream !== 'undefined'
  const response = await fetch(supportsCompression ? url + '?picksFormat=gzip' : url, options)
  const data = await response.json().catch(() => ({}))
  if (typeof data.session?.picksGzip !== 'string') return { response, data }

  try {
    const { picksGzip, ...session } = data.session
    const bytes = Uint8Array.from(atob(picksGzip), character => character.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    const picks = await new Response(stream).json()
    if (!Array.isArray(picks)) throw new Error('Draft picks did not decode as a list')
    return { response, data: { ...data, session: { ...session, picks } } }
  } catch {
    const plainResponse = await fetch(url, options)
    return { response: plainResponse, data: await plainResponse.json().catch(() => ({})) }
  }
}
