import { prisma } from '@/lib/prisma'
import { getAiMemory, upsertAiMemory } from '@/lib/ai-memory/ai-memory-store'
import { resolveLeagueAccess } from '@/lib/league-access'

/**
 * WHAT CHIMMY REMEMBERS FROM CONVERSATION, AND THE USER'S CONTROL OVER IT.
 *
 * Chimmy brief item 6: "retain risk tolerance, rebuilding status, favored formats and explanation
 * depth — with user control". The retaining already happened. `rememberChimmyUserMessageMemory`
 * writes a `coaching_profile` (scope `user_preferences`) whenever a user DECLARES something —
 * "I'm rebuilding", "keep it short", "we play PPR" — per league, and the chat route reads it back
 * into the prompt. What was missing was the second half: nobody could see it, correct it, or make
 * Chimmy forget it. A preference a user cannot inspect is a preference they cannot trust.
 *
 * 🛑 A LEAGUE NAME IS ONLY SHOWN FOR A LEAGUE THE USER CAN ACCESS. These rows are keyed on whatever
 * league id a chat request carried, and before 2026-09-16 that was the CLIENT's field. Listing a
 * row by name without a membership check would turn "type any league id into chat, then open
 * settings" into a way to learn that league's name. `resolveLeagueAccess` — the canonical
 * predicate — decides, and an inaccessible row is omitted rather than shown nameless.
 */

export const COACHING_PROFILE_KEY = 'coaching_profile'

export type TeamDirection = 'contender' | 'rebuilder'

/** The flags `parsePreferenceFlags` writes, as the settings screen names them. */
export type LearnedFlags = {
  riskStyle?: string
  detailLevel?: string
  toneStyle?: string
  scoringPreference?: string
  favoriteLeagueType?: string
}

export type RememberedPreference = {
  /** null is "all leagues" — what the user said while no league was in scope. */
  leagueId: string | null
  leagueName: string | null
  teamDirection: TeamDirection | null
  learned: LearnedFlags
  updatedAt: string | null
}

export type PreferenceLeagueOption = { leagueId: string; name: string; season: number | null }

/** Enough for anyone's league list; bounds the one access check per row. */
const MAX_REMEMBERED_ROWS = 25
const MAX_LEAGUE_OPTIONS = 50

const LEARNED_KEYS: (keyof LearnedFlags)[] = [
  'riskStyle',
  'detailLevel',
  'toneStyle',
  'scoringPreference',
  'favoriteLeagueType',
]

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readDirection(value: unknown): TeamDirection | null {
  return value === 'contender' || value === 'rebuilder' ? value : null
}

function readLearned(obj: Record<string, unknown>): LearnedFlags {
  const out: LearnedFlags = {}
  for (const k of LEARNED_KEYS) {
    if (typeof obj[k] === 'string' && obj[k]) out[k] = obj[k] as string
  }
  return out
}

/**
 * The profile the chat route should read: what the user said everywhere, overlaid by what they
 * said in THIS league. Before, the route read only the league row, so "keep it short" said with no
 * league selected was invisible the moment a league was.
 */
export function mergeCoachingProfiles(globalProfile: unknown, leagueProfile: unknown): Record<string, unknown> | null {
  const g = asObject(globalProfile)
  const l = asObject(leagueProfile)
  if (Object.keys(g).length === 0 && Object.keys(l).length === 0) return null
  return { ...g, ...l }
}

export async function listRememberedPreferences(userId: string): Promise<RememberedPreference[]> {
  const rows = await prisma.aiMemory.findMany({
    where: { userId, scope: 'user_preferences', key: COACHING_PROFILE_KEY },
    select: { leagueId: true, value: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: MAX_REMEMBERED_ROWS,
  })

  const leagueIds = [...new Set(rows.map((r) => r.leagueId).filter((id): id is string => Boolean(id)))]
  const accessible = new Set<string>()
  await Promise.all(
    leagueIds.map(async (id) => {
      const access = await resolveLeagueAccess(id, userId).catch(() => null)
      if (access) accessible.add(id)
    }),
  )
  const names = new Map<string, string>()
  if (accessible.size > 0) {
    const leagues = await prisma.league.findMany({
      where: { id: { in: [...accessible] } },
      select: { id: true, name: true },
    })
    for (const l of leagues) names.set(l.id, l.name ?? 'Unnamed league')
  }

  const out: RememberedPreference[] = []
  for (const row of rows) {
    if (row.leagueId && !accessible.has(row.leagueId)) continue
    const obj = asObject(row.value)
    const entry: RememberedPreference = {
      leagueId: row.leagueId,
      leagueName: row.leagueId ? names.get(row.leagueId) ?? 'Unnamed league' : null,
      teamDirection: readDirection(obj.teamArchetype),
      learned: readLearned(obj),
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    }
    // A row that holds nothing the screen can show is not "a memory"; it is clutter.
    if (entry.teamDirection || Object.keys(entry.learned).length > 0) out.push(entry)
  }
  // "All leagues" first, then leagues by name.
  return out.sort((a, b) =>
    a.leagueId === null ? -1 : b.leagueId === null ? 1 : (a.leagueName ?? '').localeCompare(b.leagueName ?? ''),
  )
}

/** Leagues a direction can be set for: owned, or a claimed team in them. */
export async function listPreferenceLeagueOptions(userId: string): Promise<PreferenceLeagueOption[]> {
  const leagues = await prisma.league.findMany({
    where: { OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
    select: { id: true, name: true, season: true },
    orderBy: [{ updatedAt: 'desc' }],
    take: MAX_LEAGUE_OPTIONS,
  })
  return leagues.map((l) => ({ leagueId: l.id, name: l.name ?? 'Unnamed league', season: l.season ?? null }))
}

export type RememberedWriteResult = 'ok' | 'forbidden'

/**
 * Set or clear the team direction Chimmy uses for a league (or for all leagues, `leagueId: null`).
 * Every other remembered flag in that profile is kept.
 */
export async function setRememberedTeamDirection(
  userId: string,
  leagueId: string | null,
  direction: TeamDirection | null,
): Promise<RememberedWriteResult> {
  if (leagueId) {
    const access = await resolveLeagueAccess(leagueId, userId).catch(() => null)
    if (!access) return 'forbidden'
  }
  const current = asObject(await getAiMemory(userId, 'user_preferences', { leagueId, key: COACHING_PROFILE_KEY }))
  const next: Record<string, unknown> = { ...current, updatedAt: new Date().toISOString() }
  if (direction) next.teamArchetype = direction
  else delete next.teamArchetype
  /*
   * ⚠ WRITTEN WHERE CHIMMY READS, and the strategy snapshot is left alone. The chat route reads
   * `user_preferences/coaching_profile`; `chimmy_strategy_profile/snapshot` is a mirror written in
   * the same breath by the conversational path and read by nothing that decides an answer.
   */
  await upsertAiMemory({ userId, leagueId, scope: 'user_preferences', key: COACHING_PROFILE_KEY, value: next })
  return 'ok'
}

/**
 * Forget everything Chimmy learned from conversation for a league (or for all leagues).
 *
 * Deliberately NOT access-checked: these rows are the user's own, scoped by `userId` in the delete
 * itself, and a user who has left a league must still be able to clear what was remembered there.
 */
export async function forgetRememberedPreferences(userId: string, leagueId: string | null): Promise<RememberedWriteResult> {
  await prisma.aiMemory.deleteMany({
    where: {
      userId,
      leagueId,
      OR: [
        { scope: 'user_preferences', key: COACHING_PROFILE_KEY },
        { scope: 'chimmy_strategy_profile', key: 'snapshot' },
      ],
    },
  })
  return 'ok'
}
