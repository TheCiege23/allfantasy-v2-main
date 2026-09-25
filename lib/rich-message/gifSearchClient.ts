import { gifProviderForUrl, type GifSearchResult } from './GIFIntegrationResolver'

/**
 * GIF search from the BROWSER, through our own server route (`/api/chat/gifs`).
 *
 * Owner's call 2026-09-25 ("fix the bracket pool chat GIFs"). Three chat screens searched GIFs from
 * the browser with whatever keys were inlined into the client bundle: the bracket pool chat called
 * Tenor directly with NEXT_PUBLIC_TENOR_API_KEY, and the league chat panel and Messages ran the shared
 * `searchGifs` client-side — which, with only public keys in reach, tried Tenor first (up to 4s),
 * then GIPHY on a public beta key. Google shut the Tenor API down on 2026-06-30, so the pool chat
 * showed nothing at all and the other two waited on a dead service before every result.
 *
 * The server route holds the real key (Klipy first), never exposes it, and says which service
 * answered — so each picker can show the search box and credit that service's terms ask for.
 */

export type GifProvider = 'klipy' | 'giphy' | 'tenor'

export type GifSearchResponse = {
  gifs: GifSearchResult[]
  /** The service the GIFs on screen came from — whose credit they carry. */
  provider: GifProvider | null
  /** The service a search asks. Null when no GIF search is configured on the server. */
  searchProvider: GifProvider | null
}

function readProvider(value: unknown): GifProvider | null {
  return value === 'klipy' || value === 'giphy' || value === 'tenor' ? value : null
}

type RouteGif = { id?: unknown; url?: unknown; previewUrl?: unknown; title?: unknown }

/** An empty query is the preloaded grid; anything else is a live search. Never throws. */
export async function fetchGifs(query: string, limit = 24): Promise<GifSearchResponse> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (query.trim()) q.set('q', query.trim())
  try {
    const res = await fetch(`/api/chat/gifs?${q.toString()}`, { cache: 'no-store' })
    const data = (await res.json()) as { gifs?: RouteGif[]; provider?: unknown; searchProvider?: unknown }
    const provider = readProvider(data.provider)
    const gifs: GifSearchResult[] = (Array.isArray(data.gifs) ? data.gifs : []).flatMap((g) => {
      const url = typeof g.url === 'string' ? g.url : ''
      const id = typeof g.id === 'string' || typeof g.id === 'number' ? String(g.id) : ''
      if (!url || !id) return []
      const itsProvider = gifProviderForUrl(url) ?? provider
      if (!itsProvider) return []
      return [
        {
          id,
          url,
          previewUrl: typeof g.previewUrl === 'string' && g.previewUrl ? g.previewUrl : url,
          title: typeof g.title === 'string' ? g.title : '',
          provider: itsProvider,
        },
      ]
    })
    return { gifs, provider, searchProvider: readProvider(data.searchProvider) }
  } catch {
    return { gifs: [], provider: null, searchProvider: null }
  }
}

/*
 * Which service search asks, fetched once per page — the placeholder is shown before anyone
 * searches, and Klipy's terms want it to say "Search KLIPY" from the start. A failed read is not
 * cached, so opening the picker again retries.
 */
let searchProviderRequest: Promise<GifProvider | null> | null = null

export function loadGifSearchProvider(): Promise<GifProvider | null> {
  if (!searchProviderRequest) {
    searchProviderRequest = fetchGifs('', 1).then((r) => {
      if (!r.searchProvider && r.gifs.length === 0) searchProviderRequest = null
      return r.searchProvider
    })
  }
  return searchProviderRequest
}

/** Tests only. */
export function resetGifSearchProviderCacheForTests(): void {
  searchProviderRequest = null
}

/** Klipy's terms want exactly "Search KLIPY" in the box. */
export function gifSearchPlaceholder(provider: GifProvider | null): string {
  if (provider === 'klipy') return 'Search KLIPY'
  if (provider === 'giphy') return 'Search GIPHY'
  return 'Search GIFs...'
}
