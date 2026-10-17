import 'server-only'
import { prisma } from '@/lib/prisma'
import { gifProviderForUrl } from '@/lib/rich-message/GIFIntegrationResolver'
import { CHIMMY_GIF_MOODS, type ChimmyGifMood } from './chimmyGifMoods'

export { extractChimmyGifMood, type ChimmyGifMood } from './chimmyGifMoods'

/**
 * One GIF on a Fun-mode answer (user decision 2026-10-01).
 *
 * 🛑 CHIMMY NAMES A MOOD, NEVER A URL. A model asked for a GIF link invents one that does not exist,
 * and a URL from model text is untrusted anyway. The model may end its reply with one line
 * `[gif: <mood>]` from the fixed list below; the server strips that line from the text in every mode
 * and, only in Fun mode, looks the mood up in our own `chat_gifs` catalog — the table the league-chat
 * picker browses, filled by the catalog sync. No provider call per answer, no quota spent, and a mood
 * that matches nothing simply means no GIF.
 */

export type ChimmyGif = {
  url: string
  previewUrl: string
  title: string
  width: number
  height: number
  provider: 'klipy' | 'tenor' | 'giphy' | null
}

type GifRow = { url: string; previewUrl: string; title: string; width: number; height: number }

/** A catalog GIF for the mood, or null. `pick` chooses among matches; deterministic in tests. */
export async function resolveChimmyGif(
  mood: ChimmyGifMood,
  deps: { findMany?: (terms: readonly string[]) => Promise<GifRow[]>; pick?: (n: number) => number } = {},
): Promise<ChimmyGif | null> {
  const terms = CHIMMY_GIF_MOODS[mood]
  const findMany =
    deps.findMany ??
    ((t: readonly string[]) =>
      prisma.chatGif.findMany({
        where: {
          OR: t.flatMap((term) => [
            { category: { contains: term, mode: 'insensitive' as const } },
            { title: { contains: term, mode: 'insensitive' as const } },
            { tags: { has: term } },
          ]),
        },
        select: { url: true, previewUrl: true, title: true, width: true, height: true },
        take: 12,
      }))
  const rows = (await findMany(terms).catch(() => [])).filter((r) => /^https:\/\//.test(r.url))
  if (rows.length === 0) return null
  const pick = deps.pick ?? ((n: number) => Math.floor(Math.random() * n))
  const row = rows[Math.min(rows.length - 1, Math.max(0, pick(rows.length)))]!
  return {
    url: row.url,
    previewUrl: /^https:\/\//.test(row.previewUrl) ? row.previewUrl : row.url,
    title: row.title,
    width: row.width,
    height: row.height,
    provider: gifProviderForUrl(row.url),
  }
}
