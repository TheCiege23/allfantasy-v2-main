import type { LeagueSport } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/**
 * Follow a Sleeper league into its next season — an INGESTION job (it calls Sleeper), run from
 * `/api/cron/sleeper-historical-refresh`.
 *
 * Guap, 2026-10-12 ("go ahead with league renewal", choosing "import it automatically"). Sleeper mints a
 * NEW league id every season, with `previous_league_id` pointing at the old one. Nothing here ever looked
 * forward: every scheduled job re-reads the id it already holds and every chain walk goes backward, so a
 * renewed league reached AllFantasy only when someone re-imported it by hand — and until then its trades
 * were never graded, its draft never mirrored, and the old row sat at `complete`.
 *
 * ── HOW ──────────────────────────────────────────────────────────────────────────────────────────────
 *   1. Candidates: fully imported Sleeper rows whose season is `complete`, from last season onward. A
 *      `legacy_summary` row is a history-only import the user never asked to follow, and stays one.
 *   2. Sleeper has no "next league" link. So the league's people are asked instead: the importer's linked
 *      Sleeper account (`user_profiles.sleeperUserId`), else the league's own members
 *      (`LeagueTeam.platformUserId`, public ids) — `GET /user/{id}/leagues/{sport}/{season + 1}`, ONE call
 *      per account, answering for every candidate that account is in. A league there whose
 *      `previous_league_id` is ours is its renewal.
 *   3. The renewal is imported for the SAME user exactly as a manual re-import does — `processLeague`
 *      (a new row: imported leagues are one row per season, and the dashboard shows a league's seasons as
 *      one league via `LeagueSeason`) — then its season chain (`syncLeagueHistory`) and history backfill
 *      (`league_dynasty_seasons`, `season_results`: what offseason pick pricing reads, #2278).
 *   4. A renewal the user already holds is left alone: a re-import by hand, or an earlier fire.
 *
 * ⚠ IN SEASON THIS COSTS NOTHING: no row is `complete`, so there are no candidates and no calls.
 * ⚠ AllFantasy-only state (league chat, AF settings) starts fresh on the new row, as with a manual
 *   re-import. That was the choice; rolling the row forward in place was the alternative not taken.
 */

/** True for a platform whose renewed season this job finds on its own — today, Sleeper only. */
export function followsRenewalAutomatically(platform: string | null | undefined): boolean {
  return String(platform ?? '').trim().toLowerCase() === 'sleeper'
}

/** League.sport → Sleeper's sport path segment (the reverse of import-sleeper's `sportMap`). */
const SLEEPER_SPORT: Partial<Record<LeagueSport, string>> = { NFL: 'nfl', NBA: 'nba', MLB: 'mlb', NHL: 'nhl', SOCCER: 'mls' }

export type SleeperLeagueLike = { league_id?: string | number | null; previous_league_id?: string | number | null; [key: string]: unknown }

export type RenewalDeps = {
  listUserLeagues(sleeperUserId: string, sport: string, season: number): Promise<SleeperLeagueLike[]>
  importLeague(league: SleeperLeagueLike, userId: string, season: number, sport: LeagueSport): Promise<{ leagueId: string } | null>
  /** Season chain + history backfill for the new row. A failure here does not undo the import. */
  afterImport(args: { leagueId: string; platformLeagueId: string; userId: string; isDynasty: boolean }): Promise<void>
}

export type RenewalSummary = {
  candidates: number
  sleeperCalls: number
  renewalsFound: number
  imported: number
  alreadyFollowed: number
  /** Asked, and Sleeper has no next-season league pointing back yet — the commissioner has not renewed. */
  notRenewedYet: number
  /** No linked Sleeper account and no member id to ask. */
  noIdentity: number
  /** Left for the next fire: the call or import cap, or the time budget. */
  deferred: number
  failed: number
  errors: string[]
}

type Candidate = {
  id: string
  userId: string
  platformLeagueId: string
  season: number
  sport: LeagueSport
  isDynasty: boolean
}

const isSleeperUserId = (v: string | null | undefined): v is string => Boolean(v && /^\d{6,}$/.test(v))

export async function followRenewedSleeperLeagues(opts: {
  deps?: RenewalDeps
  now?: Date
  /** Sleeper list calls per fire. */
  maxCalls?: number
  /** Renewals imported per fire; each runs a history backfill, which is the expensive part. */
  maxImports?: number
  budget?: { exhausted(): boolean }
} = {}): Promise<RenewalSummary> {
  const deps = opts.deps ?? (await defaultDeps())
  const maxCalls = opts.maxCalls ?? 40
  const maxImports = opts.maxImports ?? 5
  const fromSeason = (opts.now ?? new Date()).getUTCFullYear() - 1
  const out: RenewalSummary = {
    candidates: 0, sleeperCalls: 0, renewalsFound: 0, imported: 0, alreadyFollowed: 0,
    notRenewedYet: 0, noIdentity: 0, deferred: 0, failed: 0, errors: [],
  }
  const note = (msg: string) => { if (out.errors.length < 8) out.errors.push(msg) }

  const rows = await prisma.league.findMany({
    where: {
      platform: 'sleeper',
      status: 'complete',
      platformLeagueId: { not: '' },
      season: { gte: fromSeason },
      // `NOT { leagueVariant: 'legacy_summary' }` would also drop NULL — the ordinary full import.
      OR: [{ leagueVariant: null }, { leagueVariant: { not: 'legacy_summary' } }],
    },
    select: { id: true, userId: true, platformLeagueId: true, season: true, sport: true, isDynasty: true },
  })
  const candidates: Candidate[] = rows
    .filter((r) => r.season != null && SLEEPER_SPORT[r.sport] && r.userId)
    .map((r) => ({ id: r.id, userId: r.userId, platformLeagueId: r.platformLeagueId, season: r.season!, sport: r.sport, isDynasty: Boolean(r.isDynasty) }))
  out.candidates = candidates.length
  if (candidates.length === 0) return out

  // Who can be asked about each league: the importer first, then up to two of its members.
  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: [...new Set(candidates.map((c) => c.userId))] } },
    select: { userId: true, sleeperUserId: true },
  })
  const importerId = new Map(profiles.filter((p) => isSleeperUserId(p.sleeperUserId)).map((p) => [p.userId, p.sleeperUserId!]))
  const members = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: candidates.map((c) => c.id) } },
    select: { leagueId: true, platformUserId: true },
  })
  const membersOf = new Map<string, string[]>()
  for (const m of members) {
    if (!isSleeperUserId(m.platformUserId)) continue
    const list = membersOf.get(m.leagueId) ?? []
    if (list.length < 2 && !list.includes(m.platformUserId)) list.push(m.platformUserId)
    membersOf.set(m.leagueId, list)
  }

  const askers = (c: Candidate) => [...new Set([importerId.get(c.userId), ...(membersOf.get(c.id) ?? [])].filter(isSleeperUserId))]
  const renewalOf = new Map<string, SleeperLeagueLike>()
  const asked = new Map<string, Map<string, SleeperLeagueLike> | null>()
  const pending = new Set(candidates.map((c) => c.id))
  const askable = candidates.filter((c) => askers(c).length > 0)
  out.noIdentity = candidates.length - askable.length
  for (const c of candidates) if (askers(c).length === 0) pending.delete(c.id)

  // Ask accounts in rounds: every candidate's first asker, then its second, … — one call per account.
  for (let round = 0; round < 3 && pending.size > 0; round++) {
    for (const c of askable) {
      if (!pending.has(c.id)) continue
      const who = askers(c)[round]
      if (!who) continue
      const next = c.season + 1
      const key = `${who}|${SLEEPER_SPORT[c.sport]}|${next}`
      if (!asked.has(key)) {
        if (out.sleeperCalls >= maxCalls || opts.budget?.exhausted()) break
        out.sleeperCalls += 1
        try {
          const leagues = await deps.listUserLeagues(who, SLEEPER_SPORT[c.sport]!, next)
          const byPrevious = new Map<string, SleeperLeagueLike>()
          for (const l of leagues ?? []) {
            const prev = l?.previous_league_id == null ? '' : String(l.previous_league_id)
            if (prev && prev !== '0' && l.league_id != null) byPrevious.set(prev, l)
          }
          asked.set(key, byPrevious)
        } catch (e) {
          asked.set(key, null)
          note(`list ${SLEEPER_SPORT[c.sport]} ${next}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      const hit = asked.get(key)?.get(c.platformLeagueId)
      if (hit) {
        renewalOf.set(c.id, hit)
        pending.delete(c.id)
      }
    }
  }
  // Still pending: asked by every account we hold and not renewed, or not reached this fire.
  for (const c of askable) {
    if (!pending.has(c.id)) continue
    const all = askers(c).map((who) => asked.get(`${who}|${SLEEPER_SPORT[c.sport]}|${c.season + 1}`))
    if (all.every((m) => m !== undefined) && all.some((m) => m != null)) out.notRenewedYet += 1
    else out.deferred += 1
  }
  out.renewalsFound = renewalOf.size
  if (renewalOf.size === 0) return out

  const renewedIds = [...renewalOf.values()].map((l) => String(l.league_id))
  const held = await prisma.league.findMany({
    where: { platform: 'sleeper', platformLeagueId: { in: renewedIds } },
    select: { userId: true, platformLeagueId: true },
  })
  const heldKey = new Set(held.map((h) => `${h.userId}|${h.platformLeagueId}`))

  for (const c of candidates) {
    const renewal = renewalOf.get(c.id)
    if (!renewal) continue
    const newId = String(renewal.league_id)
    if (heldKey.has(`${c.userId}|${newId}`)) {
      out.alreadyFollowed += 1
      continue
    }
    if (out.imported + out.failed >= maxImports || opts.budget?.exhausted()) {
      out.deferred += 1
      continue
    }
    try {
      const row = await deps.importLeague(renewal, c.userId, c.season + 1, c.sport)
      if (!row) {
        out.failed += 1
        note(`${c.id} -> ${newId}: import returned nothing`)
        continue
      }
      heldKey.add(`${c.userId}|${newId}`)
      out.imported += 1
      await deps.afterImport({ leagueId: row.leagueId, platformLeagueId: newId, userId: c.userId, isDynasty: c.isDynasty }).catch((e) =>
        note(`${row.leagueId}: history after import: ${e instanceof Error ? e.message : String(e)}`),
      )
    } catch (e) {
      out.failed += 1
      note(`${c.id} -> ${newId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

async function defaultDeps(): Promise<RenewalDeps> {
  const [{ getUserLeagues }, { processLeague }, { syncLeagueHistory }, { syncSleeperHistoricalBackfillAfterImport }] = await Promise.all([
    import('@/lib/sleeper-client'),
    import('@/lib/league/sleeper-import-process'),
    import('@/lib/league/syncLeagueHistory'),
    import('./SleeperHistoricalBackfillService'),
  ])
  return {
    listUserLeagues: async (id, sport, season) => (await getUserLeagues(id, sport, String(season))) as unknown as SleeperLeagueLike[],
    importLeague: async (league, userId, season, sport) => {
      const row = await processLeague(league as Parameters<typeof processLeague>[0], userId, season, sport)
      return row ? { leagueId: row.leagueId } : null
    },
    afterImport: async ({ leagueId, platformLeagueId, userId, isDynasty }) => {
      await syncLeagueHistory(leagueId, platformLeagueId, userId)
      await syncSleeperHistoricalBackfillAfterImport({ leagueId, isDynasty })
    },
  }
}
