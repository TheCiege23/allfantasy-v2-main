/**
 * The league-wide college + pro pair as stored on `League.settings.collegeProPair` — the reader only,
 * with no server imports, so the league page can tell a paired league from its settings the same way
 * the server does. Writing and resolving a pair stay in `leaguePair.ts` (server-only).
 */

export const COLLEGE_PRO_PAIR_KEY = 'collegeProPair'

export type LeaguePairRecord = {
  role: 'pro' | 'college'
  otherLeagueId: string
  linkedByUserId: string
  linkedAt: string
}

export function readLeaguePair(settings: unknown): LeaguePairRecord | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[COLLEGE_PRO_PAIR_KEY] : null
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r) return null
  const role = r.role === 'pro' || r.role === 'college' ? r.role : null
  const otherLeagueId = typeof r.otherLeagueId === 'string' && r.otherLeagueId ? r.otherLeagueId : null
  const linkedByUserId = typeof r.linkedByUserId === 'string' && r.linkedByUserId ? r.linkedByUserId : null
  if (!role || !otherLeagueId || !linkedByUserId) return null
  return { role, otherLeagueId, linkedByUserId, linkedAt: typeof r.linkedAt === 'string' ? r.linkedAt : '' }
}
