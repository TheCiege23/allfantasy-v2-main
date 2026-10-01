/**
 * The GIF on a Fun-mode answer (`meta.gif`, lib/chimmy/chimmyGif.ts). The server picks it from our own
 * catalog; this re-checks the shape and the host anyway, because a turn restored from sessionStorage
 * is not re-validated on the way in, and an <img> pointed anywhere is a request to anywhere.
 */

export type ChimmyGifView = { url: string; title: string; width: number; height: number; provider: 'klipy' | 'giphy' | 'tenor' }

function providerOf(url: string): ChimmyGifView['provider'] | null {
  let host = ''
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    host = u.hostname.toLowerCase()
  } catch {
    return null
  }
  const on = (d: string) => host === d || host.endsWith(`.${d}`)
  if (on('klipy.com') || on('klipy.ai')) return 'klipy'
  if (on('giphy.com')) return 'giphy'
  if (on('tenor.com') || host === 'tenor.googleapis.com') return 'tenor'
  return null
}

export function readChimmyGif(raw: unknown): ChimmyGifView | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  const url = typeof g.previewUrl === 'string' && providerOf(g.previewUrl) ? g.previewUrl : g.url
  if (typeof url !== 'string') return null
  const provider = providerOf(url)
  if (!provider) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  return { url, title: typeof g.title === 'string' ? g.title.slice(0, 120) : 'GIF', width: num(g.width), height: num(g.height), provider }
}

const CREDIT: Record<ChimmyGifView['provider'], string> = { klipy: 'Powered by KLIPY', giphy: 'Powered by GIPHY', tenor: 'Via Tenor' }

export function ChimmyGif({ gif }: { gif: ChimmyGifView }) {
  return (
    <figure className="af-cm-gif">
      {/* eslint-disable-next-line @next/next/no-img-element -- a remote animated GIF; next/image would freeze or re-encode it */}
      <img
        src={gif.url}
        alt={gif.title}
        loading="lazy"
        referrerPolicy="no-referrer"
        width={gif.width || undefined}
        height={gif.height || undefined}
      />
      <figcaption>{CREDIT[gif.provider]}</figcaption>
    </figure>
  )
}
