import { prisma } from '@/lib/prisma'
import { CURRENT_TEAMS } from '@/lib/leagues/leagueTeamLifecycle'

/**
 * The career ledger — one row per manager per league-season, from every source
 * that records a season result.
 *
 * ⚠ ONE LOADER FOR TWO CONSUMERS, ON PURPOSE. `calculateAndSaveRank` scores XP
 * from these rows and `/core/rankings` ranks managers from them. They used to
 * read different things: the writer merged three sources into rows, and the
 * screen read the two counters the writer left behind on `user_profiles`. When
 * `0e8b9de5b` (2026-08-24) corrected which of those counters holds distinct
 * years and which holds league-seasons, the screen — written the day before —
 * kept the old orientation. Measured on production 2026-09-16: all seven ranked
 * profiles store `career_seasons_played` = distinct years, and the screen read
 * that as league-seasons, so it flagged two sound careers as contradictory and
 * printed "296 seasons × 10" in an XP breakdown. Reading the rows themselves
 * removes the question of what a denormalised column means.
 *
 * FOUR SOURCES, merged first-wins on `platform:platformLeagueId:season` per user:
 *   1. `import`  — `League.import_*` on leagues the user OWNS (a frozen import-time snapshot)
 *   2. `legacy`  — Sleeper history tables (`legacyLeague` / owner `legacyRoster`)
 *   3. `team`    — a `LeagueTeam` the user has CLAIMED, on any non-native league
 *   4. `native`  — finalized AllFantasy `franchise_seasons`
 * One exception to first-wins: when an `import` or `legacy` row and a `team` row share a key and
 * the team has played MORE games, the team's W/L/T/PF replace the frozen snapshot
 * (see `refreshImportFromTeams`).
 *
 * ⚠ WHY THE `team` SOURCE EXISTS. The first three only ever saw leagues a user owns a
 * `League` row for, and populated `import_*` columns. A member who joins a league
 * someone else imported (`claimExistingLeagueForMember`) owns no `League` row at all —
 * only `LeagueTeam.claimedByUserId` — and Sleeper unified-commit, MFL and Fleaflicker
 * imports never write `import_*` (225 of 225 Sleeper imports on the test DB). Both got
 * zero ledger rows and were never ranked. The claimed team is the one record every
 * import path writes, and the sync crons keep its W/L/PF current.
 *
 * ⚠ ONLY THE OWNER'S OWN ROSTER IS STORED PER LEGACY LEAGUE. Measured
 * 2026-09-16: 1,139 of 1,165 legacy leagues carry exactly one roster, the
 * importing manager's, and none carries the full league. So nothing here can
 * rank a manager against their opponents' points or judge opponent quality —
 * the rankings engine normalises with what one roster can honestly say.
 */

export type LedgerSource = 'import' | 'legacy' | 'team' | 'native'
export type LedgerLeagueType = 'redraft' | 'keeper' | 'dynasty' | 'unknown'
export type LedgerSpecialty = 'standard' | 'bestball' | 'guillotine' | 'draft_only' | 'other'
export type LedgerScoring = 'ppr' | 'half' | 'standard' | 'other' | 'unknown'

export type CareerLedgerRow = {
  userId: string
  /** `platform:platformLeagueId:season` — the dedup key `calculateAndSaveRank` has always used. */
  key: string
  source: LedgerSource
  /** Lower-case provider: sleeper, espn, yahoo, fantrax, allfantasy… */
  platform: string
  /** Upper-case sport code: NFL, NCAAF, NBA… */
  sport: string
  season: number
  leagueName: string | null
  /** `League.id` for imported, team and native rows; `LegacyLeague.id` for legacy rows. */
  refId: string
  /** Falls back to 12 when unknown — the fallback the XP formula has always used. */
  leagueSize: number
  leagueSizeKnown: boolean
  playoffTeams: number | null
  leagueType: LedgerLeagueType
  specialty: LedgerSpecialty
  scoring: LedgerScoring
  superflex: boolean | null
  tePremium: boolean | null
  wins: number
  losses: number
  ties: number
  /** Null when the source did not record points (a stored 0 on an unplayed season is not a score). */
  pointsFor: number | null
  gamesPlayed: number
  /** Gated on games played — see `berthCredited`. */
  madePlayoffs: boolean
  wonChampionship: boolean
  /**
   * The season is decided: a champion is recorded or the provider marks it complete.
   * ⚠ NOT "a final standing is present" — imported in-season ESPN rows carry
   * `import_final_standing` values of 0, 5 and 10 in week 2.
   */
  completed: boolean
  /** When this row's source last changed. ISO. */
  updatedAt: string | null
}

/* ────────────────────────────── pure mapping ────────────────────────────── */

export function normalizeSport(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().toUpperCase()
  return s || 'NFL'
}

export function normalizeScoring(raw: string | null | undefined): LedgerScoring {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  if (!s) return 'unknown'
  if (s.includes('half') || s === '0.5 ppr' || s === 'hppr') return 'half'
  if (s === 'standard' || s === 'std' || s === 'non ppr' || s === 'no ppr') return 'standard'
  if (s.includes('ppr')) return 'ppr'
  return 'other'
}

export function normalizeSpecialty(raw: string | null | undefined): LedgerSpecialty {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!s || s === 'standard' || s === 'none') return 'standard'
  if (s === 'bestball' || s === 'best_ball') return 'bestball'
  if (s === 'guillotine') return 'guillotine'
  if (s === 'draft_only') return 'draft_only'
  return 'other'
}

/**
 * League type from whichever signals a source has.
 *
 * ⚠ `isDynasty` WINS OVER `League.leagueType`, because that column DEFAULTS to
 * "redraft" and so says nothing on its own about an imported league. Keeper is
 * never inferred from `keeperCount` — that column defaults to 3 and once
 * classified redraft leagues as keeper.
 */
export function normalizeLeagueType(raw: string | null | undefined, isDynasty?: boolean | null): LedgerLeagueType {
  if (isDynasty === true) return 'dynasty'
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'unknown'
  if (s.includes('keeper')) return 'keeper'
  if (s.includes('dynasty') || s.includes('devy') || s === 'c2c') return 'dynasty'
  if (s.includes('redraft') || s === 'standard' || s.includes('guillotine') || s.includes('best')) return 'redraft'
  return 'unknown'
}

/** Specialty signalled by `League.leagueType` / `leagueVariant` on imported and native rows. */
function specialtyFromLeague(leagueType: string | null, variant: string | null): LedgerSpecialty {
  const joined = `${leagueType ?? ''} ${variant ?? ''}`.toLowerCase()
  if (joined.includes('guillotine')) return 'guillotine'
  if (joined.includes('best')) return 'bestball'
  return 'standard'
}

/**
 * A playoff berth only counts when the season has been played.
 *
 * ⚠ THE LEGACY PATH HAS HAD THIS GATE SINCE 0e8b9de5b, AND THE IMPORT PATH NEVER
 * DID. Measured on production 2026-09-16: every `League.import_*` row is a 2026
 * in-season league at 0-0-0, and four of the seven carry
 * `import_made_playoffs = true` — each one worth playoff XP to a manager who has
 * not played a snap. Seeding is not a result, whichever source reports it.
 */
export function berthCredited(madePlayoffs: boolean, wonChampionship: boolean, gamesPlayed: number): boolean {
  return gamesPlayed > 0 && (madePlayoffs || wonChampionship)
}

/**
 * The legacy (Sleeper history) berth rule, verbatim from `calculateAndSaveRank`:
 * champion, else seed inside the cut, else final standing inside the cut — and
 * only once the season has been played.
 */
export function legacyMadePlayoffs(
  roster: {
    wins?: number | null
    losses?: number | null
    ties?: number | null
    isChampion?: boolean | null
    playoffSeed?: number | null
    finalStanding?: number | null
  },
  playoffTeams: number | null,
): boolean {
  const games = (roster.wins ?? 0) + (roster.losses ?? 0) + (roster.ties ?? 0)
  const byStanding =
    roster.isChampion === true ||
    (playoffTeams != null && roster.playoffSeed != null
      ? roster.playoffSeed <= playoffTeams
      : playoffTeams != null && roster.finalStanding != null
        ? roster.finalStanding <= playoffTeams
        : false)
  return berthCredited(byStanding, roster.isChampion === true, games)
}

/**
 * Merge per-source rows, first source wins on a shared key.
 *
 * Callers pass sources in precedence order — imported, legacy, team, native.
 * Keys are compared per user, so two managers in the same Sleeper league keep one
 * row each.
 */
export function mergeLedgerSources(...sources: CareerLedgerRow[][]): CareerLedgerRow[] {
  const seen = new Set<string>()
  const out: CareerLedgerRow[] = []
  for (const rows of sources) {
    for (const row of rows) {
      const k = `${row.userId}|${row.key}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(row)
    }
  }
  return out
}

/**
 * The one exception to first-wins: an `import` or `legacy` row takes a claimed team's record
 * when that team has played MORE games under the same key.
 *
 * ⚠ `League.import_*` IS WRITTEN ONCE, AT IMPORT, AND NEVER AGAIN, while the sync
 * crons keep `LeagueTeam` W/L/PF current. Legacy history imports can also retain
 * an earlier current-season snapshot. Letting either snapshot win outright would
 * freeze an owner's season at whatever week they imported in. More games is the
 * test because a record only ever grows within a season — fewer games means the
 * team row is the stale one (or unsynced), and then the snapshot keeps its place.
 * Only the record moves; a berth or title either source recorded is kept.
 */
export function refreshImportFromTeams(imported: CareerLedgerRow[], team: CareerLedgerRow[]): CareerLedgerRow[] {
  if (team.length === 0) return imported
  const byKey = new Map<string, CareerLedgerRow>()
  for (const t of team) {
    const k = `${t.userId}|${t.key}`
    if (!byKey.has(k)) byKey.set(k, t)
  }
  return imported.map((row) => {
    const t = byKey.get(`${row.userId}|${row.key}`)
    if (!t || t.gamesPlayed <= row.gamesPlayed) return row
    const updated = [row.updatedAt, t.updatedAt].filter(Boolean).sort().pop() ?? null
    return {
      ...row,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      gamesPlayed: t.gamesPlayed,
      madePlayoffs: row.madePlayoffs || t.madePlayoffs,
      wonChampionship: row.wonChampionship || t.wonChampionship,
      completed: row.completed || t.completed,
      updatedAt: updated,
    }
  })
}

function iso(d: Date | null | undefined): string | null {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null
}

function newer(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null
  if (!b) return a
  return a > b ? a : b
}

/** Platform tags used for native AllFantasy leagues (see computeUserRole in get-dashboard-league-list). */
export const NATIVE_PLATFORMS = ['allfantasy', 'af', 'manual', 'native']

/**
 * League-seasons from teams the managers have CLAIMED (`LeagueTeam.claimedByUserId`).
 *
 * ⚠ NATIVE LEAGUES ARE EXCLUDED: a native season counts only once finalised into
 * `franchise_seasons`, and a live native team would otherwise score a season that
 * has not been decided. ⚠ ARCHIVED TEAMS ARE EXCLUDED through `CURRENT_TEAMS`
 * (`lifecycleState`, never `archivedAt` — see that module for why).
 *
 * Degrades like the native read: any failure logs and returns [] — including a
 * failed champion lookup, because rows without their titles would look whole.
 */
async function loadClaimedTeamRows(ids: string[]): Promise<CareerLedgerRow[]> {
  try {
    const teams = await prisma.leagueTeam.findMany({
      where: {
        claimedByUserId: { in: ids },
        ...CURRENT_TEAMS,
        league: { platform: { notIn: NATIVE_PLATFORMS } },
      },
      select: {
        id: true,
        claimedByUserId: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        currentRank: true,
        lastUpdatedAt: true,
        league: {
          select: {
            id: true,
            name: true,
            platform: true,
            platformLeagueId: true,
            sport: true,
            season: true,
            leagueSize: true,
            playoffTeams: true,
            isDynasty: true,
            leagueType: true,
            leagueVariant: true,
            scoring: true,
            status: true,
            updatedAt: true,
            lastSyncedAt: true,
          },
        },
      },
    })
    // The where clause is case-sensitive; a mixed-case native tag must not slip through.
    const live = teams.filter(
      (t) => t.claimedByUserId && t.league && !NATIVE_PLATFORMS.includes(String(t.league.platform ?? '').toLowerCase()),
    )
    if (live.length === 0) return []

    const leagueIds = [...new Set(live.map((t) => t.league.id))]
    const seasons = await prisma.leagueSeason.findMany({
      where: { leagueId: { in: leagueIds }, championTeamId: { not: null } },
      select: { leagueId: true, season: true, championTeamId: true },
    })
    const championOf = new Map<string, string>()
    for (const s of seasons) if (s.championTeamId) championOf.set(`${s.leagueId}:${s.season}`, s.championTeamId)

    return live.map((t) => {
      const l = t.league
      const wins = t.wins ?? 0
      const losses = t.losses ?? 0
      const ties = t.ties ?? 0
      const games = wins + losses + ties
      const champion = championOf.get(`${l.id}:${l.season}`)
      const won = champion === t.id
      const completed = champion != null || String(l.status ?? '').toLowerCase() === 'complete'
      /*
       * ⚠ `currentRank` IS A LIVE STANDING, NOT A RESULT. Mid-season it is the seed
       * the team holds this week, so it only counts as a berth once the season is
       * decided — the same "seeding is not a result" rule `berthCredited` records.
       */
      const inCut =
        completed && t.currentRank != null && l.playoffTeams != null && t.currentRank <= l.playoffTeams
      return {
        userId: t.claimedByUserId as string,
        key: `${l.platform ?? 'unknown'}:${l.platformLeagueId ?? ''}:${l.season}`,
        source: 'team' as const,
        platform: String(l.platform ?? 'unknown').toLowerCase(),
        sport: normalizeSport(l.sport),
        season: l.season,
        leagueName: l.name ?? null,
        refId: l.id,
        leagueSize: l.leagueSize ?? 12,
        leagueSizeKnown: l.leagueSize != null,
        playoffTeams: l.playoffTeams ?? null,
        leagueType: normalizeLeagueType(l.leagueType, l.isDynasty),
        specialty: specialtyFromLeague(l.leagueType, l.leagueVariant),
        scoring: normalizeScoring(l.scoring),
        superflex: null,
        tePremium: null,
        wins,
        losses,
        ties,
        pointsFor: games > 0 && (t.pointsFor ?? 0) > 0 ? (t.pointsFor as number) : null,
        gamesPlayed: games,
        madePlayoffs: berthCredited(inCut, won, games),
        wonChampionship: won,
        completed,
        updatedAt: iso(newer(t.lastUpdatedAt, newer(l.updatedAt, l.lastSyncedAt))),
      }
    })
  } catch (err: unknown) {
    console.error('[loadCareerLedger] claimed-team read failed', err)
    return []
  }
}

/* ─────────────────────────────── the loader ─────────────────────────────── */

/**
 * Every recorded league-season for the given managers.
 *
 * Failure semantics mirror `calculateAndSaveRank`: the imported and legacy
 * queries throw, the account link, the claimed-team read and the native read
 * degrade to "nothing from this source" — so a rank is never written from a
 * half-read ledger that looks whole, and a missing native table does not take the
 * rest down with it. (A degraded team read can still under-count a joiner; it
 * cannot invent seasons.)
 */
export async function loadCareerLedger(userIds: string[]): Promise<CareerLedgerRow[]> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return []

  const leagues = await prisma.league.findMany({
    where: { userId: { in: ids }, importWins: { not: null } },
    select: {
      id: true,
      userId: true,
      name: true,
      platform: true,
      platformLeagueId: true,
      sport: true,
      season: true,
      leagueSize: true,
      playoffTeams: true,
      isDynasty: true,
      leagueType: true,
      leagueVariant: true,
      scoring: true,
      status: true,
      importWins: true,
      importLosses: true,
      importTies: true,
      importMadePlayoffs: true,
      importWonChampionship: true,
      importPointsFor: true,
      updatedAt: true,
      lastSyncedAt: true,
    },
  })

  const imported: CareerLedgerRow[] = leagues.map((l) => {
    const wins = l.importWins ?? 0
    const losses = l.importLosses ?? 0
    const ties = l.importTies ?? 0
    const games = wins + losses + ties
    const won = l.importWonChampionship === true
    return {
      userId: l.userId,
      key: `${l.platform ?? 'unknown'}:${l.platformLeagueId ?? ''}:${l.season}`,
      source: 'import',
      platform: String(l.platform ?? 'unknown').toLowerCase(),
      sport: normalizeSport(l.sport),
      season: l.season,
      leagueName: l.name ?? null,
      refId: l.id,
      leagueSize: l.leagueSize ?? 12,
      leagueSizeKnown: l.leagueSize != null,
      playoffTeams: l.playoffTeams ?? null,
      leagueType: normalizeLeagueType(l.leagueType, l.isDynasty),
      specialty: specialtyFromLeague(l.leagueType, l.leagueVariant),
      scoring: normalizeScoring(l.scoring),
      superflex: null,
      tePremium: null,
      wins,
      losses,
      ties,
      pointsFor: games > 0 && (l.importPointsFor ?? 0) > 0 ? (l.importPointsFor as number) : null,
      gamesPlayed: games,
      madePlayoffs: berthCredited(l.importMadePlayoffs === true, won, games),
      wonChampionship: won,
      completed: won || String(l.status ?? '').toLowerCase() === 'complete',
      updatedAt: iso(newer(l.updatedAt, l.lastSyncedAt)),
    }
  })

  const links = await prisma.appUser
    .findMany({ where: { id: { in: ids } }, select: { id: true, legacyUserId: true } })
    .catch(() => [] as Array<{ id: string; legacyUserId: string | null }>)
  const afByLegacy = new Map<string, string>()
  for (const link of links) if (link.legacyUserId) afByLegacy.set(link.legacyUserId, link.id)

  const legacy: CareerLedgerRow[] = []
  if (afByLegacy.size > 0) {
    const legacyLeagues = await prisma.legacyLeague.findMany({
      where: { userId: { in: [...afByLegacy.keys()] } },
      select: {
        id: true,
        userId: true,
        name: true,
        sleeperLeagueId: true,
        season: true,
        sport: true,
        leagueType: true,
        scoringType: true,
        specialtyFormat: true,
        isSF: true,
        isTEP: true,
        teamCount: true,
        playoffTeams: true,
        status: true,
        winnerRosterId: true,
        updatedAt: true,
        rosters: {
          where: { isOwner: true },
          take: 1,
          select: {
            wins: true,
            losses: true,
            ties: true,
            pointsFor: true,
            isChampion: true,
            finalStanding: true,
            playoffSeed: true,
            updatedAt: true,
          },
        },
      },
    })

    for (const ll of legacyLeagues) {
      const roster = ll.rosters[0]
      const userId = afByLegacy.get(ll.userId)
      if (!roster || !userId) continue

      const wins = roster.wins ?? 0
      const losses = roster.losses ?? 0
      const ties = roster.ties ?? 0
      const games = wins + losses + ties
      const cutoff = ll.playoffTeams ?? null

      legacy.push({
        userId,
        key: `sleeper:${ll.sleeperLeagueId}:${ll.season}`,
        source: 'legacy',
        platform: 'sleeper',
        sport: normalizeSport(ll.sport),
        season: ll.season,
        leagueName: ll.name ?? null,
        refId: ll.id,
        leagueSize: ll.teamCount ?? 12,
        leagueSizeKnown: ll.teamCount != null,
        playoffTeams: cutoff,
        leagueType: normalizeLeagueType(ll.leagueType),
        specialty: normalizeSpecialty(ll.specialtyFormat),
        scoring: normalizeScoring(ll.scoringType),
        superflex: ll.isSF,
        tePremium: ll.isTEP,
        wins,
        losses,
        ties,
        pointsFor: games > 0 && (roster.pointsFor ?? 0) > 0 ? roster.pointsFor : null,
        gamesPlayed: games,
        madePlayoffs: legacyMadePlayoffs(roster, cutoff),
        wonChampionship: roster.isChampion === true,
        completed:
          roster.isChampion === true ||
          ll.winnerRosterId != null ||
          String(ll.status ?? '').toLowerCase() === 'complete',
        updatedAt: iso(newer(ll.updatedAt, roster.updatedAt)),
      })
    }
  }

  const nativeSeasons = await prisma.franchiseSeason
    .findMany({
      where: { userId: { in: ids }, league: { platform: { in: NATIVE_PLATFORMS } } },
      select: {
        userId: true,
        season: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        madePlayoffs: true,
        wonChampionship: true,
        updatedAt: true,
        league: {
          select: {
            id: true,
            name: true,
            platform: true,
            platformLeagueId: true,
            sport: true,
            leagueSize: true,
            playoffTeams: true,
            isDynasty: true,
            leagueType: true,
            leagueVariant: true,
            scoring: true,
          },
        },
      },
    })
    .catch((err: unknown) => {
      console.error('[loadCareerLedger] native franchise_seasons read failed', err)
      return []
    })

  const native: CareerLedgerRow[] = nativeSeasons.flatMap((s) => {
    if (!s.userId) return []
    const league = s.league
    const platform = league?.platform ?? 'allfantasy'
    // Native leagues have no external platformLeagueId — key on the AF league id.
    const leagueRef = league?.platformLeagueId ?? league?.id ?? 'unknown'
    const games = (s.wins ?? 0) + (s.losses ?? 0) + (s.ties ?? 0)
    const won = s.wonChampionship === true
    return [
      {
        userId: s.userId,
        key: `${platform}:${leagueRef}:${s.season}`,
        source: 'native' as const,
        platform: String(platform).toLowerCase(),
        sport: normalizeSport(league?.sport),
        season: s.season,
        leagueName: league?.name ?? null,
        refId: league?.id ?? leagueRef,
        leagueSize: league?.leagueSize ?? 12,
        leagueSizeKnown: league?.leagueSize != null,
        playoffTeams: league?.playoffTeams ?? null,
        leagueType: normalizeLeagueType(league?.leagueType ?? null, league?.isDynasty ?? null),
        specialty: specialtyFromLeague(league?.leagueType ?? null, league?.leagueVariant ?? null),
        scoring: normalizeScoring(league?.scoring ?? null),
        superflex: null,
        tePremium: null,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        ties: s.ties ?? 0,
        pointsFor: games > 0 && (s.pointsFor ?? 0) > 0 ? (s.pointsFor as number) : null,
        gamesPlayed: games,
        madePlayoffs: berthCredited(s.madePlayoffs === true, won, games),
        wonChampionship: won,
        // `franchise_seasons` is written at season finalisation, so a row is a decided season.
        completed: true,
        updatedAt: iso(s.updatedAt),
      },
    ]
  })

  const team = await loadClaimedTeamRows(ids)

  return mergeLedgerSources(refreshImportFromTeams(imported, team), refreshImportFromTeams(legacy, team), team, native)
}
