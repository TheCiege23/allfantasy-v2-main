import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueRole, type LeagueRole } from '@/lib/league/permissions'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import type { CoreIssue } from './outstandingIssues'

/**
 * Commissioner Hub — 38a screen 9.
 *
 * ⚠ THIS TAB RENDERED "this screen has not been built yet" IN PRODUCTION. The
 * nav key existed and the render branch did not, so it fell through to the
 * placeholder panel. This is the screen.
 *
 * ── Why not on the /commissioner-os tree ─────────────────────────────────
 *
 * `app/commissioner-os/layout.tsx` has no auth and no commissioner gate — all
 * thirteen pages under it are reachable by anyone — and every module resolves
 * through `resolveServerDataMode()` whose `DEFAULT_DATA_MODE` is `'demo'`, so it
 * renders curated fake data unless something explicitly asks for live. Building
 * a real commissioner surface on top of that would inherit both problems.
 *
 * ── Which commissioner predicate ─────────────────────────────────────────
 *
 * There are four in this repo and they disagree:
 *
 *   - `lib/commissioner/permissions.ts` `isCommissioner` checks `League.userId`
 *     ONLY, so it 403s a co-commissioner from ~40 `/api/commissioner/**` routes
 *     while the settings routes let the same person in.
 *   - `resolveActiveLeagueContext` is the most complete but collapses
 *     commissioner and co-commissioner into one boolean, and this screen has to
 *     tell them apart — the whole point of its access panel is the boundary
 *     between the two.
 *   - `ImportedLeagueCommitService` never sets `LeagueTeam.isCommissioner` at
 *     all, so any predicate reading only that flag misses every MFL/ESPN/Yahoo
 *     commissioner.
 *
 * This uses `getLeagueRole`, which distinguishes the roles AND checks
 * `League.userId` first — and `League.userId` is the importing user, so the
 * imported-league gap above is covered for the case that actually occurs.
 *
 * ⚠ IT DELIBERATELY DOES NOT ADD A FIFTH PREDICATE, AND DOES NOT WIDEN
 * `getLeagueRole`. Teaching that function to also trust the attestation audit
 * record would have granted settings-route write access to a new population,
 * because `requireCommissionerRole` is built on it. Read-only screen, existing
 * gate, no new surface area.
 */

export type CommissionerAccessDenied = {
  allowed: false
  /** What the person actually is here, so the blocked state can say so. */
  role: LeagueRole
  leagueName: string
  reason: string
}

export type CommissionerTile = {
  key: 'managers' | 'at-risk' | 'pending' | 'sync'
  label: string
  state: SectionState<{ value: string; sub: string | null }>
  tone: 'good' | 'warn' | 'bad' | 'neutral'
}

export type CommissionerQueueItem = {
  id: string
  severity: 'bad' | 'warn' | 'info'
  glyph: string
  title: string
  detail: string
  action: { label: string; href: string; external: boolean } | null
}

export type CommissionerSettingRow = {
  key: string
  state: SectionState<string>
}

export type CommissionerAccessRow = {
  handle: string
  initials: string
  role: 'commissioner' | 'co_commissioner'
  isYou: boolean
}

export type CommissionerHubData = {
  allowed: true
  league: { id: string; name: string; platform: string; season: number | null }
  /** The viewer's own role — drives the co-commissioner boundary note. */
  role: 'commissioner' | 'co_commissioner'
  tiles: CommissionerTile[]
  queue: CommissionerQueueItem[]
  /** Nothing needing attention is a real, good answer — not an empty list. */
  queueEmptyReason: string | null
  settings: CommissionerSettingRow[]
  access: CommissionerAccessRow[]
  /**
   * True when nobody has actually read this league yet, so every health number
   * on the screen is a shape rather than a measurement.
   *
   * ⚠ WITHOUT THIS THE TILES RENDER GREEN FOR A LEAGUE WE KNOW NOTHING ABOUT.
   * "0 inactive managers" and "we have never looked" produce identical tiles,
   * and the first one is a claim we cannot support.
   */
  unread: boolean
  /** Disputes, stated rather than silently absent. See DISPUTES_REASON. */
  disputes: UnavailableSection
}

export type CommissionerHubResult = CommissionerHubData | CommissionerAccessDenied

/**
 * ⚠ COLLUSION AND TANKING DO NOT RUN ON IMPORTED LEAGUES, SO THE DESIGN'S
 * "OPEN DISPUTES" TILE HAS NOTHING BEHIND IT. `CollusionDetectionEngine` reads
 * `RedraftLeagueTrade` and `TankingDetectionEngine` reads `RedraftMatchup` —
 * both AF-native-only tables — so an imported Sleeper league has zero rows and
 * the scan always finds nothing. Tanking has no enqueuer at all.
 *
 * A tile reading "0 open disputes" off a scan that structurally cannot find one
 * is the most confident wrong number this screen could show a commissioner, so
 * the tile states the gap instead. It is replaced by "waiting on you", which is
 * a real count of real pending items.
 */
const DISPUTES_REASON =
  'Dispute detection only runs on leagues created in AllFantasy — it has no data to read for an imported league, so "none found" would not mean anything here.'

const ROLE_LABEL: Record<'commissioner' | 'co_commissioner', string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Reads a league setting out of the ingested `settings` snapshot, falling back
 * to the column only when the column can be trusted.
 *
 * ⚠ THE COLUMNS CARRY SCHEMA DEFAULTS AND CANNOT BE DISTINGUISHED FROM REAL
 * VALUES. `playoffStartWeek` is `@default(14)` and `playoffTeams` is
 * `@default(4)`, so a league that was never configured reads exactly like one
 * configured to the same numbers. The importer also renames Sleeper's keys on
 * the way in — `playoff_week_start` becomes `playoff_start_week` and
 * `trade_deadline` becomes `trade_deadline_week` — so the JSON is both the more
 * trustworthy source and the one with the awkward names.
 */
function readSetting(settings: unknown, keys: string[]): number | null {
  if (!settings || typeof settings !== 'object') return null
  const bag = settings as Record<string, unknown>
  for (const key of keys) {
    const raw = bag[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
      return Number(raw)
    }
  }
  // Sleeper's own payload is often nested one level down under `settings`.
  const nested = bag.settings
  if (nested && typeof nested === 'object' && nested !== bag) return readSetting(nested, keys)
  return null
}

const WAIVER_TYPE_LABEL: Record<string, string> = {
  faab: 'FAAB blind bidding',
  rolling: 'Rolling waiver priority',
  fcfs: 'First come, first served',
  standard: 'Standard waiver priority',
  off: 'No waivers — free agents are instant',
}

export async function getCommissionerHub(input: {
  leagueId: string
  userId: string
  /** Already derived for the shell; filtered to this league by the caller. */
  issues: CoreIssue[]
  now?: Date
}): Promise<CommissionerHubResult> {
  const { leagueId, userId, issues } = input
  const now = input.now ?? new Date()

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      platform: true,
      season: true,
      settings: true,
      lastSyncedAt: true,
      syncStatus: true,
      tradeDeadlineWeek: true,
      playoffStartWeek: true,
      playoffTeams: true,
    },
  })

  const leagueName = leagueDisplayName(league?.name)

  /*
   * ── The gate ──────────────────────────────────────────────────────────
   *
   * Resolved here, server-side, before a single figure is read. The nav item
   * calls the same function through `canSeeCommissionerTab` below, so the tab's
   * absence and this guard cannot disagree — which is the thing the design's
   * role switcher is a cosmetic demonstration OF, and which has to be real.
   */
  const role = league ? await getLeagueRole(leagueId, userId) : null

  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return {
      allowed: false,
      role,
      leagueName,
      reason:
        'Commissioners and co-commissioners only. This is the league’s admin surface — settings, disputes and the attention queue — so it is limited to the people who run it.',
    }
  }

  /*
   * ⚠ LOADED ONLY AFTER THE GATE PASSES. Reading health for a league the caller
   * cannot see would leak its shape through timing and through any error that
   * escaped, and it is work nobody is going to look at.
   */
  const [teams, waiverSettings, rosterCount] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          teamName: true,
          ownerName: true,
          claimedByUserId: true,
          isCommissioner: true,
          isCoCommissioner: true,
        },
      })
      .catch(() => []),
    prisma.leagueWaiverSettings
      .findUnique({
        where: { leagueId },
        select: { waiverType: true, faabBudget: true },
      })
      .catch(() => null),
    prisma.roster.count({ where: { leagueId } }).catch(() => 0),
  ])

  const teamCount = teams.length || rosterCount

  /*
   * "Nobody has read this league" and "this league is healthy" produce the same
   * tiles unless something says otherwise. `lastSyncedAt` is that something: a
   * league that has never synced has no basis for any of these numbers.
   */
  const unread = league?.lastSyncedAt == null

  const syncAgeMs = league?.lastSyncedAt ? now.getTime() - league.lastSyncedAt.getTime() : null
  const syncStale = syncAgeMs != null && syncAgeMs > 6 * 60 * 60 * 1000

  /*
   * Claimed teams are the only ones we can call active — an unclaimed team is a
   * team nobody has connected to an AllFantasy account, which says nothing
   * about whether its manager is engaged on the platform itself.
   */
  const claimed = teams.filter((t) => t.claimedByUserId).length

  const tiles: CommissionerTile[] = [
    {
      key: 'managers',
      label: 'Claimed teams',
      tone: claimed === teamCount && teamCount > 0 ? 'good' : 'neutral',
      state:
        teamCount > 0
          ? {
              available: true,
              data: {
                value: String(claimed),
                sub: `of ${teamCount} · connected to an AllFantasy account`,
              },
            }
          : {
              available: false,
              reason: 'no teams have been ingested for this league yet',
            },
    },
    {
      key: 'at-risk',
      label: 'Unclaimed',
      tone: teamCount > 0 && claimed < teamCount ? 'warn' : 'neutral',
      state:
        teamCount > 0
          ? {
              available: true,
              data: {
                value: String(Math.max(0, teamCount - claimed)),
                sub:
                  teamCount - claimed === 0
                    ? 'every team is connected'
                    : 'no AllFantasy account attached',
              },
            }
          : { available: false, reason: 'no teams have been ingested for this league yet' },
    },
    {
      key: 'pending',
      label: 'Waiting on you',
      tone: issues.some((i) => i.severity === 'bad')
        ? 'bad'
        : issues.length > 0
          ? 'warn'
          : 'good',
      state: {
        available: true,
        data: {
          value: String(issues.length),
          sub: issues.length === 0 ? 'nothing needs a ruling' : 'items in the queue below',
        },
      },
    },
    {
      key: 'sync',
      label: 'Sync',
      tone: unread ? 'warn' : syncStale ? 'warn' : 'good',
      state: unread
        ? {
            available: false,
            reason: 'this league has never synced, so nothing on this screen has been measured yet',
          }
        : {
            available: true,
            data: {
              value: syncStale ? 'Stale' : 'OK',
              sub: describeSyncAge(syncAgeMs),
            },
          },
    },
  ]

  /*
   * The queue is the league's own outstanding issues, already derived for the
   * shell and already sorted by severity then deadline. Re-deriving it here
   * would be a second, subtly different definition of "needs attention" on the
   * one screen whose job is to be the definitive list.
   */
  const queue: CommissionerQueueItem[] = issues.slice(0, 8).map((i) => ({
    id: i.id,
    severity: i.severity,
    glyph: i.glyph,
    title: i.title,
    detail: i.meta,
    action: i.action,
  }))

  const settings: CommissionerSettingRow[] = [
    {
      key: 'Trade deadline',
      state: describeTradeDeadline(league?.settings, league?.tradeDeadlineWeek ?? null),
    },
    {
      key: 'Playoffs',
      state: describePlayoffs(
        league?.settings,
        league?.playoffStartWeek ?? null,
        league?.playoffTeams ?? null,
      ),
    },
    {
      key: 'Waivers',
      state: waiverSettings?.waiverType
        ? {
            available: true,
            data: (() => {
              const kind = String(waiverSettings.waiverType).toLowerCase()
              const label = WAIVER_TYPE_LABEL[kind] ?? kind
              return waiverSettings.faabBudget != null
                ? `${label} · $${waiverSettings.faabBudget}`
                : label
            })(),
          }
        : {
            available: false,
            reason: 'no waiver settings were ingested for this league',
          },
    },
  ]

  const access: CommissionerAccessRow[] = teams
    .filter((t) => t.isCommissioner || t.isCoCommissioner)
    .map((t) => {
      const handle = t.ownerName?.trim() || t.teamName?.trim() || 'Unknown manager'
      return {
        handle,
        initials: initialsOf(handle),
        role: t.isCommissioner ? ('commissioner' as const) : ('co_commissioner' as const),
        isYou: t.claimedByUserId === userId,
      }
    })
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'commissioner' ? -1 : 1))

  return {
    allowed: true,
    league: {
      id: leagueId,
      name: leagueName,
      platform: String(league?.platform ?? 'manual').toLowerCase(),
      season: league?.season ?? null,
    },
    role,
    tiles,
    queue,
    queueEmptyReason:
      queue.length > 0
        ? null
        : unread
          ? 'This league has never synced, so nothing has been checked. An empty queue here is not the same as a quiet league.'
          : 'Nothing in this league needs a ruling right now.',
    settings,
    access,
    unread,
    disputes: { available: false, reason: DISPUTES_REASON },
  }
}

function describeSyncAge(ms: number | null): string {
  if (ms == null) return 'never synced'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'synced just now'
  if (minutes < 60) return `synced ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `synced ${hours}h ago`
  return `synced ${Math.floor(hours / 24)}d ago`
}

/**
 * ⚠ `99` MEANS "NO TRADE DEADLINE", NOT WEEK 99. Four production leagues carry
 * it, and so does any week past the regular season's length. Printing "Week 99"
 * would be the literal value and the wrong fact.
 */
function describeTradeDeadline(settings: unknown, column: number | null): SectionState<string> {
  const fromJson = readSetting(settings, ['trade_deadline_week', 'trade_deadline'])
  const week = fromJson ?? column
  if (week == null) {
    return { available: false, reason: 'not published in this league’s platform settings' }
  }
  if (week >= 99) return { available: true, data: 'No deadline — trades stay open all season' }
  return { available: true, data: `Week ${week}` }
}

function describePlayoffs(
  settings: unknown,
  startColumn: number | null,
  teamsColumn: number | null,
): SectionState<string> {
  const start = readSetting(settings, ['playoff_start_week', 'playoff_week_start'])
  const teams = readSetting(settings, ['playoff_teams', 'playoffTeams'])

  /*
   * Only the JSON is trusted for these two. `playoffStartWeek` is
   * `@default(14)` and `playoffTeams` is `@default(4)`, so the columns cannot
   * distinguish a league configured that way from one never configured at all —
   * and this screen is read by the person who would have to act on it being
   * wrong.
   */
  if (start == null && teams == null) {
    const columnsAreDefaults = startColumn === 14 && teamsColumn === 4
    return {
      available: false,
      reason: columnsAreDefaults
        ? 'this league’s playoff format was never ingested — the stored values are schema defaults, not its real settings'
        : 'not published in this league’s platform settings',
    }
  }

  const parts: string[] = []
  if (teams != null) parts.push(`Top ${teams}`)
  if (start != null) parts.push(`from Week ${start}`)
  return { available: true, data: parts.join(' · ') }
}

/**
 * Whether to render the Commissioner nav item at all.
 *
 * ⚠ ABSENCE, NOT A DISABLED STATE. The handoff is explicit that role-gated UI is
 * omitted for people without access rather than shown greyed out, because a
 * disabled control still tells you the feature exists and that you are not
 * allowed to use it. Nothing is leaked by a tab that was never drawn.
 *
 * This is a cheap check by design — it answers "do you run ANY league", which
 * is what a global nav item can honestly reflect. Whether you run THIS league
 * is decided by `getCommissionerHub` above, server-side, on every render.
 */
export function canSeeCommissionerTab(commissionerLeagueCount: number): boolean {
  return commissionerLeagueCount > 0
}
