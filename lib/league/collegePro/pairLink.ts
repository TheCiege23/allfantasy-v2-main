import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { readLeaguePair } from './pairRecord'
import { resolveCollegeProPair } from './leaguePair'

/**
 * Which league this one is paired with, for the surfaces that only need to NAME and LINK the other
 * half (the header chip, the "this happens in your other league" notes, the franchise Activity feed).
 *
 * The league-wide record on `settings.collegeProPair` answers it with one row read. A pair made before
 * pairs were league-wide still lives on its linker's `FranchiseLink`, so the fallback asks
 * `resolveCollegeProPair`, which also records it league-wide for next time when it may.
 */

export type CollegeProHalf = {
  leagueId: string
  name: string
  platform: string
  sport: string
  /** How the page names the half: the pro sport ("NFL", "NBA") or "College". */
  label: string
  /** The viewer can open it in AllFantasy — they have a team, or imported it. */
  canOpen: boolean
}

export type CollegeProPairLink =
  | { applies: false }
  | { applies: true; role: 'pro' | 'college'; self: CollegeProHalf; other: CollegeProHalf }

const COLLEGE = new Set(['NCAAF', 'NCAAB', 'CFB', 'CBB', 'NCAAFB', 'NCAABB'])
export const halfLabel = (sport: string | null | undefined) => {
  const s = String(sport ?? '').trim().toUpperCase()
  return COLLEGE.has(s) ? 'College' : s || 'Pro'
}

export async function pairedLeagueFor(leagueId: string, userId: string): Promise<{ role: 'pro' | 'college'; otherLeagueId: string } | null> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }).catch(() => null)
  const recorded = row ? readLeaguePair(row.settings) : null
  if (recorded) return { role: recorded.role, otherLeagueId: recorded.otherLeagueId }
  if (!row) return null
  const paired = await resolveCollegeProPair(leagueId, userId).catch(() => null)
  const other = paired?.sides.find((s) => s.leagueId && s.leagueId !== leagueId)
  const role = paired?.viewingRole
  if (!other?.leagueId || (role !== 'pro' && role !== 'college')) return null
  return { role, otherLeagueId: other.leagueId }
}

export async function loadCollegeProPairLink(leagueId: string, userId: string): Promise<CollegeProPairLink> {
  const pair = await pairedLeagueFor(leagueId, userId)
  if (!pair) return { applies: false }
  const rows = await prisma.league.findMany({
    where: { id: { in: [leagueId, pair.otherLeagueId] } },
    select: { id: true, name: true, platform: true, sport: true },
  })
  const self = rows.find((r) => r.id === leagueId)
  const other = rows.find((r) => r.id === pair.otherLeagueId)
  if (!self || !other) return { applies: false }
  const canOpenOther = (await resolveLeagueAccess(other.id, userId).catch(() => null)) != null
  const half = (r: typeof self, canOpen: boolean): CollegeProHalf => ({
    leagueId: r.id,
    name: (r.name ?? '').trim() || 'League',
    platform: String(r.platform ?? ''),
    sport: String(r.sport ?? ''),
    label: halfLabel(r.sport),
    canOpen,
  })
  return { applies: true, role: pair.role, self: half(self, true), other: half(other, canOpenOther) }
}
