import 'server-only'

/**
 * Fill a missing player photo from the stored `SportsPlayer` image, for every sport but the NFL.
 *
 * 🛑 A HOSTED NBA ROSTER SHOWED NO PLAYER PHOTOS ANYWHERE (owner report, 2026-11-24 — "the player images,
 * team logos, everything is missing… huge issue"). Measured on production: the Team screen's roster API
 * returned `headshotUrl: null` for 9 of 9 players on an NBA guilly roster, while the waiver pool — which
 * reads `SportsPlayer` — had a photo for 407 of 471. Outside the NFL a hosted league's player ids are
 * Rolling Insights ids, which collide with Sleeper ids (lib/player-media-urls.ts `buildHeadshotUrl` refuses
 * to build one for that reason), so the photo has to come from the stored row. The head-to-head Matchup
 * screen already did exactly that (`resolveStoredHeadshotsBatch`); the roster path never did.
 *
 * Same resolver, same rule: the RI row with the player's id and name, else a single unambiguous photo for
 * the name, else none — a missing face is a gap, a stranger's face is a false statement. Rows that already
 * carry a photo are left alone. NFL rows are returned untouched. Never throws.
 */
import { resolveStoredHeadshotsBatch } from '@/lib/draft-room/storedPickHeadshot'

type MediaRow = { id: string; name?: string | null; team?: string | null; headshotUrl?: string | null; imageUrl?: string | null }

export async function fillStoredHeadshots<T extends MediaRow>(sport: string | null | undefined, rows: readonly T[]): Promise<T[]> {
  const sp = String(sport ?? '').trim().toUpperCase()
  if (!sp || sp === 'NFL' || rows.length === 0) return [...rows]
  const missing = rows.filter((r) => !r.headshotUrl && !r.imageUrl && r.name?.trim())
  if (missing.length === 0) return [...rows]
  const photos = await resolveStoredHeadshotsBatch(
    sp,
    missing.map((r) => ({ playerId: String(r.id), playerName: String(r.name), team: r.team ?? null })),
  ).catch(() => new Map<string, string>())
  if (photos.size === 0) return [...rows]
  return rows.map((r) => {
    if (r.headshotUrl || r.imageUrl) return r
    const url = photos.get(String(r.id))
    return url ? { ...r, headshotUrl: url, imageUrl: url } : r
  })
}
