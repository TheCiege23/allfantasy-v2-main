import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { asHeadshotUrl } from './playerIdentityCompose'
import { playerRef } from './playerRef'

/**
 * NFL players by Sleeper id → what a finder row needs: name, position, club, headshot, and a finder
 * ref that opens THIS player's card — or no ref at all.
 *
 * ⚠ A LINK ONLY WHEN THE REF ROUND-TRIPS. The finder resolves `NFL:<externalId>` to the row with the
 * highest sleeperId under that externalId, and bare NFL externalIds have collided across providers
 * before (#1511). So a ref is issued only when EVERY NFL row under the chosen externalId that carries a
 * sleeperId carries this one — otherwise the link could open another player's card. Lifted out of
 * depthChartBackups.ts so the depth chart and the trending list share the one rule.
 */

export type SleeperPlayer = {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /** A finder ref that resolves back to this player, or null (then the row is not a link). */
  ref: string | null
}

type Row = { externalId: string; sleeperId: string | null; source: string; fetchedAt: Date; name?: string; position?: string | null; team?: string | null; imageUrl?: string | null }

export async function resolveSleeperPlayers(sleeperIds: readonly string[]): Promise<Map<string, SleeperPlayer>> {
  const out = new Map<string, SleeperPlayer>()
  const ids = [...new Set(sleeperIds.filter(Boolean))]
  if (ids.length === 0) return out
  const own = (await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', sleeperId: { in: ids } },
    select: { externalId: true, sleeperId: true, source: true, fetchedAt: true, name: true, position: true, team: true, imageUrl: true },
  })) as Row[]
  // Prefer the vendor's own row (the one search results link to), then the newest.
  own.sort((a, b) => Number(b.source === 'rolling_insights') - Number(a.source === 'rolling_insights') || +new Date(b.fetchedAt) - +new Date(a.fetchedAt))
  const chosen = new Map<string, Row>()
  for (const r of own) if (r.sleeperId && !chosen.has(r.sleeperId)) chosen.set(r.sleeperId, r)
  if (chosen.size === 0) return out

  const sharing = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', externalId: { in: [...new Set([...chosen.values()].map((r) => r.externalId))] }, sleeperId: { not: null } },
    select: { externalId: true, sleeperId: true },
  })
  const claimants = new Map<string, Set<string>>()
  for (const r of sharing) {
    const set = claimants.get(r.externalId) ?? new Set<string>()
    if (r.sleeperId) set.add(r.sleeperId)
    claimants.set(r.externalId, set)
  }
  for (const [sid, r] of chosen) {
    const who = claimants.get(r.externalId)
    // A headshot from any of his rows; the chosen row can be the one without it.
    const image = own.find((o) => o.sleeperId === sid && o.imageUrl)?.imageUrl ?? null
    out.set(sid, {
      sleeperId: sid,
      name: r.name ?? sid,
      position: r.position ?? null,
      // Some catalog rows carry the full club name ("Philadelphia Eagles"); rows show the code.
      team: r.team ? (normalizeTeamAbbrev(r.team) ?? r.team) : null,
      imageUrl: asHeadshotUrl(image),
      ref: who && who.size === 1 && who.has(sid) ? playerRef('NFL', r.externalId) : null,
    })
  }
  return out
}

/** sleeperId → round-trip-safe finder ref (resolveSleeperPlayers, refs only). */
export async function roundTripRefs(sleeperIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const [sid, p] of await resolveSleeperPlayers(sleeperIds)) if (p.ref) out.set(sid, p.ref)
  return out
}
