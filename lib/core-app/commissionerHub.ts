import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, type LeagueRole } from '@/lib/league/permissions'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { getCommissionerHubHealthForUser } from '@/lib/commissioner-hub/commissionerHubHealth'
import { readRequiredStarterCount } from '@/lib/commissioner-hub/requiredStarters'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { readViewerPoll } from '@/lib/chat-core/messagePolls'
import { getBoolean } from '@/lib/feature-toggle'
import { getBaseUrl } from '@/lib/get-base-url'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { getCommissionerWaiverOversight, type WaiverOversight } from './commissionerWaivers'
import type { CoreIssue } from './outstandingIssues'
import type { CoreDepthAccess } from './coreDepthAccess'
import { isScored } from './currentWeek'
import { platformLabel, verifiedHandoff } from './platformLinks'
import { leagueWeekFromSettings, playoffStartWeek, regularSeasonWeeks, tradeDeadlineWeek } from './seasonTimeline'
import {
  abandonedTeamsFlag,
  formatMoney,
  missingLineupsFlag,
  openPolls,
  rankFlags,
  readDuesTracker,
  unequalSchedulesFlag,
  unpaidDuesFlag,
  unresolvedVotesFlag,
  type HealthFlag,
  type LeaguePoll,
} from './commissioner/health'
import { buildIcs, buildLeagueCalendar, nextDeadline, type LeagueCalendar } from './commissioner/calendar'
import { buildTaskCards, type TaskCardsResult } from './commissioner/tasks'
import {
  buildCommunities,
  buildLeagueAreas,
  buildWorkflows,
  type CommunityChannel,
  type LeagueArea,
  type Workflow,
} from './commissioner/areas'
import { balanceChart, engagementChart, scoringChart, type HubChart } from './commissioner/charts'
import { RECIPES, RECIPES_SEND_TOGGLE, readRecipeSettings, type RecipeKey } from './commissioner/recipes'
import {
  memberActivityFromReads,
  quietManagerNames,
  staleActivityReason,
  unownedTeamNames,
  type LeagueMemberActivity,
} from './commissioner/activity'
import { readMemberActivityInputs } from './commissioner/memberActivityReads'
import { readReviewSignals } from './commissioner/signalReads'
import { NO_REVIEW_SIGNALS } from './commissioner/signals'
import { leagueHubArt, type HubArt } from './commissioner/leagueArt'
import { MANAGER_INACTIVE_AFTER_DAYS } from '@/lib/decision-os/behavioral/manager-intelligence'

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
  key: 'health' | 'needs-you' | 'deadline' | 'managers' | 'claimed' | 'sync'
  label: string
  state: SectionState<{ value: string; sub: string | null }>
  tone: 'good' | 'warn' | 'bad' | 'neutral'
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

/**
 * Proof that the commissioner gate passed for one league and one viewer.
 *
 * ⚠ ONLY `getCommissionerHub` CAN MAKE ONE. The hub streams its heavier reports
 * (charts, the audit timeline) in their own Suspense boundaries, and those
 * loaders take a grant rather than a bare league id — so a report cannot be
 * rendered for a league whose gate was never run, even by a caller that forgets
 * to check. The brand is a compile-time guarantee; there is no runtime token.
 */
declare const GRANT: unique symbol
export type CommissionerGrant = {
  readonly [GRANT]: true
  readonly leagueId: string
  readonly userId: string
  readonly platform: string
  readonly platformLeagueId: string | null
  readonly season: number | null
  readonly teams: ReadonlyArray<{ name: string; platformUserId: string | null }>
}

export type { MemberActivityRow } from './commissioner/activity'

export type CommissionerHubData = {
  allowed: true
  grant: CommissionerGrant
  league: { id: string; name: string; platform: string; season: number | null; native: boolean }
  /** The viewer's own role — drives the co-commissioner boundary note. */
  role: 'commissioner' | 'co_commissioner'
  /** `League.userId`. The Discord bridge routes accept only this person. */
  viewerIsOwner: boolean
  /**
   * May send an @everyone announcement from this screen: any viewer who passed this screen's gate
   * (head commissioner or co-commissioner — `canBroadcast`), in a league AllFantasy runs. The 10b
   * composer lists imported leagues read-only, so the button is not offered on them.
   */
  viewerCanBroadcast: boolean
  tiles: CommissionerTile[]
  /** Urgent work, first on every width. Replaces the old single attention list. */
  tasks: TaskCardsResult
  /** Stated when there are no cards, because an empty list is not a quiet league. */
  tasksEmptyReason: string | null
  health: {
    /** The canonical engine score (`getCommissionerHubHealthForUser`). */
    score: SectionState<{ score: number; status: string; summary: string; confidencePct: number }>
    flags: HealthFlag[]
  }
  /** Who is playing — see ./commissioner/activity.ts for why imported leagues are judged by moves. */
  members: LeagueMemberActivity
  calendar: LeagueCalendar & { ics: string | null }
  areas: LeagueArea[]
  workflows: Workflow[]
  communities: CommunityChannel[]
  recipes: {
    values: Record<RecipeKey, boolean>
    saved: boolean
    updatedAt: string | null
    /** False until the platform toggle is set — saved switches do not send yet. */
    sendEnabled: boolean
    catalog: Array<{ key: RecipeKey; label: string; description: string; cadence: string; unavailable: string | null }>
  }
  /** The charts whose rows this loader already holds; the rest stream in. */
  charts: { scoring: HubChart | null; balance: HubChart | null; engagement: HubChart | null }
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
  /**
   * Whether this league's standings are published at `/standings/{id}`.
   *
   * ⚠ SHOWN ONLY TO PEOPLE WHO CAN CHANGE IT. It sits on this screen and
   * nowhere else because publishing a league's names to the open web is a
   * commissioner decision, and the person who made it is the person who should
   * be reminded it is still on.
   */
  publicStandings: { enabled: boolean; url: string }
  /** FAAB left per manager and what the last waiver run did — see commissionerWaivers.ts. */
  waivers: WaiverOversight
  /** The hero band's key art: this league's own format loop, or the robot king. */
  art: HubArt
  /** This league's chat, for the footer. */
  chatHref: string
  /** Teams nobody has connected to an AllFantasy account — the band's invite prompt. */
  unclaimedTeams: number
  /** Managers with no move in the window, by name — people, never empty seats. */
  quietManagers: string[]
  /**
   * Commissioner depth (AF Commissioner, ./coreDepthAccess.ts). Locked, the waiver oversight read
   * and the calendar export were skipped here and the screen draws locks over member activity,
   * the charts, automations, waivers and the audit log. Absent renders everything, as before.
   */
  depth?: CoreDepthAccess | null
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
 * the tile states the gap instead. The "Resolve a dispute" guide is the
 * replacement: it works the same way whether or not a scan exists.
 */
const DISPUTES_REASON =
  'Dispute detection only runs on leagues created in AllFantasy — it has no data to read for an imported league, so "none found" would not mean anything here. The “Resolve a dispute” guide on this page works for every league.'

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

const UNRESOLVED_TASK = new Set(['open', 'in_progress', 'waiting_on_manager', 'waiting_on_league_vote'])

/**
 * A roster's starting slots as the platform stored them.
 *
 * Sleeper keeps a flat `starters` array; leagues created here keep
 * `lineup_sections.starters` rows. Sleeper's `"0"` empty-slot marker is dropped at
 * import, so an empty slot is a SHORTER list — `emptyStarterSlots` counts it against
 * the league's rules. Null means the shape could not be read — never "no starters".
 */
function starterSlots(playerData: unknown): unknown[] | null {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return null
  const data = playerData as Record<string, unknown>
  if (Array.isArray(data.starters)) return data.starters
  const sections = getNormalizedLineupSections(playerData).starters
  if (sections.length > 0) return sections.map((row) => (row as Record<string, unknown>)?.id ?? null)
  return null
}

function teamLabel(t: { teamName?: string | null; ownerName?: string | null }): string {
  return t.teamName?.trim() || t.ownerName?.trim() || 'Unnamed team'
}

/** First regular-season NFL kickoff per week. SportsGame holds up to 4 rows a fixture; min() is safe. */
async function readWeekStarts(season: number | null, sport: string): Promise<Map<number, Date>> {
  const out = new Map<number, Date>()
  if (season == null || sport.toUpperCase() !== 'NFL') return out
  const rows = await prisma.sportsGame
    .groupBy({
      by: ['week'],
      where: { sport: 'NFL', season, seasonType: 'regular', week: { not: null }, startTime: { not: null } },
      _min: { startTime: true },
    })
    .catch(() => [])
  for (const r of rows) {
    if (r.week != null && r._min.startTime) out.set(r.week, r._min.startTime)
  }
  return out
}

/** League-chat polls from the last 60 days. Anything unreadable is skipped, not fatal. */
async function readRecentPolls(leagueId: string, now: Date): Promise<LeaguePoll[] | null> {
  try {
    const rows = await prisma.leagueChatMessage.findMany({
      where: {
        leagueId,
        createdAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
        NOT: { metadata: { path: ['poll'], equals: Prisma.AnyNull } },
      },
      select: { id: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return rows.flatMap((r) => {
      // No viewer: only counts and deadlines are needed, never who voted.
      const poll = readViewerPoll(r.metadata, null)
      return poll ? [{ ...poll, id: r.id, postedAt: r.createdAt.toISOString() }] : []
    })
  } catch {
    return null
  }
}

export async function getCommissionerHub(input: {
  leagueId: string
  userId: string
  /** Already derived for the shell; filtered to this league by the caller. */
  issues: CoreIssue[]
  now?: Date
  /** The viewer's commissioner depth; null or absent loads everything. */
  depth?: CoreDepthAccess | null
}): Promise<CommissionerHubResult> {
  const { leagueId, userId, issues } = input
  const now = input.now ?? new Date()
  const depthOpen = input.depth?.unlocked !== false

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      userId: true,
      platform: true,
      platformLeagueId: true,
      sport: true,
      season: true,
      status: true,
      settings: true,
      starters: true,
      lastSyncedAt: true,
      syncStatus: true,
      tradeDeadlineWeek: true,
      playoffStartWeek: true,
      playoffTeams: true,
      leagueType: true,
      leagueVariant: true,
      guillotineMode: true,
      bestBallMode: true,
      isDynasty: true,
      lifecycleState: true,
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

  if (!league || (role !== 'commissioner' && role !== 'co_commissioner')) {
    return {
      allowed: false,
      role,
      leagueName,
      reason:
        'Commissioners and co-commissioners only. This is the league’s admin surface — settings, disputes and the attention queue — so it is limited to the people who run it.',
    }
  }

  const platform = String(league.platform ?? 'manual').toLowerCase()
  const sport = String(league.sport ?? 'NFL')
  const native = resolveWriteAuthority(platform) === 'NATIVE'
  const platformName = platformLabel(platform)
  const seasonStatus = (league.status ?? '').toLowerCase()

  /*
   * ⚠ LOADED ONLY AFTER THE GATE PASSES. Reading health for a league the caller
   * cannot see would leak its shape through timing and through any error that
   * escaped, and it is work nobody is going to look at.
   *
   * Every read settles on its own. One failing table costs its own section,
   * which then says so — never the whole screen.
   */
  const [
    teams,
    waiverSettings,
    rosters,
    waivers,
    healthSnapshots,
    draftSettings,
    matchups,
    polls,
    workspaceTasks,
    discordLink,
    weekStarts,
    sendEnabled,
    activityReads,
    reviewSignals,
  ] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          id: true,
          externalId: true,
          teamName: true,
          ownerName: true,
          platformUserId: true,
          claimedByUserId: true,
          isCommissioner: true,
          isCoCommissioner: true,
          isOrphan: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
        },
      })
      .catch(() => []),
    prisma.leagueWaiverSettings
      .findUnique({
        where: { leagueId },
        select: { waiverType: true, faabBudget: true, processingDayOfWeek: true, processingTimeUtc: true },
      })
      .catch(() => null),
    prisma.roster
      .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
      .catch(() => []),
    // Seven queries (commissionerWaivers.ts), for a panel a locked viewer is not shown.
    depthOpen
      ? getCommissionerWaiverOversight({ leagueId, platform, role, now }).catch(
          (): WaiverOversight => ({
            available: false,
            reason: 'Waiver data couldn’t be read just now. This is a read failure on our side, not a league with no waivers.',
          }),
        )
      : Promise.resolve<WaiverOversight>({ available: false, reason: 'Waiver oversight is part of AF Commissioner.' }),
    getCommissionerHubHealthForUser(userId, [
      {
        id: leagueId,
        name: leagueName,
        isCommissioner: true,
        platform,
        sport,
        season: league.season,
        status: league.status,
        lastSyncedAt: league.lastSyncedAt,
      } as unknown as Parameters<typeof getCommissionerHubHealthForUser>[1][number],
    ]).catch(() => []),
    native
      ? prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftDateUtc: true } }).catch(() => null)
      : Promise.resolve(null),
    league.platformLeagueId && league.season != null
      ? prisma.weeklyMatchup
          .findMany({
            where: { leagueId: league.platformLeagueId, seasonYear: league.season },
            select: { rosterId: true, week: true, matchupId: true, pointsFor: true, pointsAgainst: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    readRecentPolls(leagueId, now),
    prisma.commissionerWorkspaceTask
      .findMany({
        where: { leagueId, status: { in: [...UNRESOLVED_TASK] } },
        select: { id: true, sourceKey: true, title: true, description: true, priority: true, dueAt: true, relatedLinks: true },
        take: 20,
      })
      .catch(() => []),
    prisma.discordLeagueChannel
      .findFirst({
        where: { leagueId },
        select: { channelName: true, guild: { select: { guildName: true } } },
      })
      .catch(() => null),
    readWeekStarts(league.season, sport),
    getBoolean(RECIPES_SEND_TOGGLE).catch(() => false),
    // Roster timestamps describe managers only where AllFantasy runs the league — see activity.ts.
    readMemberActivityInputs(leagueId, native),
    // The old all-leagues hub's review work, so this league reads the same in both views.
    readReviewSignals([{ id: leagueId, native, status: league.status, lifecycleState: league.lifecycleState }], now)
      .then((r) => r.byLeague.get(leagueId) ?? NO_REVIEW_SIGNALS)
      .catch(() => NO_REVIEW_SIGNALS),
  ])

  const teamCount = teams.length || rosters.length
  const settingsJson = league.settings

  /*
   * "Nobody has read this league" and "this league is healthy" produce the same
   * tiles unless something says otherwise. `lastSyncedAt` is that something: a
   * league that has never synced has no basis for any of these numbers.
   */
  const unread = league.lastSyncedAt == null && !native

  const syncAgeMs = league.lastSyncedAt ? now.getTime() - league.lastSyncedAt.getTime() : null
  const syncStale = syncAgeMs != null && syncAgeMs > 6 * 60 * 60 * 1000

  /*
   * Claimed teams are the only ones we can call active — an unclaimed team is a
   * team nobody has connected to an AllFantasy account, which says nothing
   * about whether its manager is engaged on the platform itself.
   */
  const claimed = teams.filter((t) => t.claimedByUserId).length

  const teamByPlatformUser = new Map(
    teams.filter((t) => t.platformUserId).map((t) => [t.platformUserId as string, t]),
  )
  const teamByExternal = new Map(teams.map((t) => [t.externalId, t]))

  const hubLeague = {
    id: leagueId,
    name: leagueName,
    platform,
    platformLeagueId: league.platformLeagueId,
    season: league.season,
    native,
  }

  // ── Season position ─────────────────────────────────────────────────────
  const scoredWeeks = (matchups ?? []).filter((m) => isScored(m)).map((m) => m.week)
  const lastPlayedWeek = scoredWeeks.length > 0 ? Math.max(...scoredWeeks) : null
  const currentWeek = leagueWeekFromSettings(settingsJson) ?? (lastPlayedWeek != null ? lastPlayedWeek + 1 : null)
  const inSeason = seasonStatus === 'in_season' || (native && lastPlayedWeek != null && seasonStatus !== 'complete')

  /*
   * The platform's JSON first. The columns are trusted only for a native league,
   * where AllFantasy wrote them itself — on an import `playoffStartWeek` is the
   * schema default (14) whenever the platform did not say.
   */
  const rawDeadline =
    readSetting(settingsJson, ['trade_deadline_week', 'trade_deadline']) ??
    (native ? (league.tradeDeadlineWeek ?? null) : null)
  const regularWeeks = regularSeasonWeeks(settingsJson)
  const noTradeDeadline =
    rawDeadline != null && (rawDeadline >= 99 || (regularWeeks != null && rawDeadline > regularWeeks))
  const tradeDeadline =
    tradeDeadlineWeek(settingsJson) ?? (noTradeDeadline || rawDeadline == null || rawDeadline <= 0 ? null : rawDeadline)
  const playoffStart =
    playoffStartWeek(settingsJson) ?? (native && league.playoffStartWeek ? league.playoffStartWeek : null)
  const eliminationFormat =
    league.guillotineMode === true ||
    /guillotine|survivor|zombie/i.test(`${league.leagueType ?? ''} ${league.leagueVariant ?? ''}`)

  // ── Health flags ────────────────────────────────────────────────────────
  const inAppLink = (label: string, href: string) => ({ label, href, external: false })
  /*
   * ⚠ ACTIVITY IS NOT JUDGED ON DATA THAT HAS STOPPED ARRIVING. Manager idle time
   * is `Roster.updatedAt`, which the sync touches; two days without a sync and
   * the idle clock is measuring the sync, not the managers. Past that, the
   * abandoned-team and lineup checks and the active-manager count say so and
   * point at the re-sync — the stale-sync task card is then the real work.
   */
  const staleReason = staleActivityReason({ native, lastSyncedAt: league.lastSyncedAt, now })
  const activityStale = staleReason != null
  const staleDays = syncAgeMs != null ? Math.floor(syncAgeMs / (24 * 60 * 60 * 1000)) : 0
  const stale = staleReason
    ? {
        reason: staleReason,
        action: inAppLink('Re-sync this league', `/core/sync?league=${encodeURIComponent(leagueId)}`),
      }
    : null
  const replaceGuide = inAppLink('Replace a manager', '#workflow-replace-manager')
  const duesTracker = readDuesTracker(settingsJson)

  // The same judgement the league Overview's commissioner card shows.
  const memberActivity: LeagueMemberActivity = memberActivityFromReads(
    activityReads,
    teams,
    now,
    MANAGER_INACTIVE_AFTER_DAYS,
  )
  const memberRows = memberActivity.available ? memberActivity.data.rows : null

  const quietManagers = memberRows && !activityStale ? quietManagerNames(memberRows, teams, native, userId) : []

  const flags = rankFlags([
    abandonedTeamsFlag({
      managers: memberRows,
      activityReason: memberActivity.available ? null : memberActivity.reason,
      orphanTeams: unownedTeamNames(teams),
      totalTeams: teamCount,
      action: native
        ? inAppLink('Open orphan teams', `/league/${encodeURIComponent(leagueId)}/orphan-teams`)
        : replaceGuide,
      stale,
    }),
    missingLineupsFlag({
      platform,
      inSeason,
      stale,
      /*
       * A roster row with no team behind it is a leftover (a previous owner's row the
       * sync no longer touches) — not a lineup anyone can set. Skipped, not named.
       */
      rosters: rosters.flatMap((r) => {
        const team = teamByPlatformUser.get(r.platformUserId)
        return team ? [{ name: teamLabel(team), starters: starterSlots(r.playerData) }] : []
      }),
      // A stored lineup has no empty-slot marker, so holes are counted against the rules.
      requiredStarters: readRequiredStarterCount(league),
      action: native
        ? inAppLink('Open league', `/league/${encodeURIComponent(leagueId)}`)
        : (() => {
            const link = verifiedHandoff(hubLeague, 'league')
            return link ? { label: link.label, href: link.href, external: true } : null
          })(),
    }),
    unequalSchedulesFlag({
      games: matchups ?? [],
      rosterIds: teams.map((t) => t.externalId),
      teamName: (id) => {
        const t = teamByExternal.get(id)
        return t ? teamLabel(t) : `Team ${id}`
      },
      throughWeek: lastPlayedWeek,
      eliminationFormat,
      action: inAppLink('Open schedule', `/league/${encodeURIComponent(leagueId)}?view=schedule`),
    }),
    unpaidDuesFlag({
      tracker: duesTracker,
      teams: teams.map((t) => ({ id: t.id, name: teamLabel(t) })),
      action: inAppLink('Open dues tracker', `/league/${encodeURIComponent(leagueId)}?view=settings`),
    }),
    unresolvedVotesFlag({
      polls,
      now,
      action: inAppLink('Open league chat', `/league/${encodeURIComponent(leagueId)}?view=league_chat`),
    }),
  ])

  // ── Calendar ────────────────────────────────────────────────────────────
  const unpaidFlag = flags.find((f) => f.key === 'dues')
  const open = polls ? openPolls(polls, now) : []
  const calendar = buildLeagueCalendar({
    now,
    leagueId,
    platformLabel: platformName,
    native,
    status: league.status,
    season: league.season,
    draftAt: draftSettings?.draftDateUtc ?? null,
    waivers: waiverSettings
      ? {
          type: waiverSettings.waiverType ?? null,
          dayOfWeek: waiverSettings.processingDayOfWeek ?? null,
          timeUtc: waiverSettings.processingTimeUtc ?? null,
        }
      : null,
    tradeDeadlineWeek: noTradeDeadline ? null : tradeDeadline,
    noTradeDeadline,
    playoffStartWeek: playoffStart,
    currentWeek,
    weekStarts,
    dues: duesTracker
      ? {
          enabled: duesTracker.enabled,
          amountLabel: duesTracker.amount != null ? formatMoney(duesTracker.amount, duesTracker.currency) : null,
          unpaid: unpaidFlag && unpaidFlag.measured ? unpaidFlag.count : 0,
        }
      : null,
    polls: open.map((p) => ({ id: p.id, question: p.question, closesAt: p.closesAt })),
  })
  // The calendar is free to read; exporting it to a calendar app is AF Commissioner. Null hides both export buttons.
  const ics = depthOpen
    ? buildIcs({
        leagueId,
        leagueName,
        events: calendar.events,
        now,
        appUrl: `${getBaseUrl()}/core/commissioner?league=${encodeURIComponent(leagueId)}`,
      })
    : null
  const upcoming = nextDeadline(calendar)

  // ── Canonical health score ─────────────────────────────────────────────
  const snapshot = healthSnapshots.find((s) => s.leagueId === leagueId) ?? null
  const healthScore: CommissionerHubData['health']['score'] =
    snapshot && snapshot.source === 'database' && snapshot.dataConfidence !== 'low'
      ? {
          available: true,
          data: {
            score: snapshot.healthScore,
            status: snapshot.overallStatus,
            summary: snapshot.summary,
            confidencePct: snapshot.confidencePct,
          },
        }
      : {
          available: false,
          reason: unread
            ? 'This league has never synced, so there is nothing to score yet.'
            : 'There isn’t enough roster and activity data to score this league yet.',
        }

  // ── Tasks ───────────────────────────────────────────────────────────────
  const tasks = buildTaskCards({
    issues,
    flags,
    staleSync: activityStale
      ? { days: staleDays, href: `/core/sync?league=${encodeURIComponent(leagueId)}`, platformLabel: platformName }
      : null,
    calendar: calendar.events,
    signals: { leagueId, values: reviewSignals },
    workspace: workspaceTasks.map((w) => {
      const links = Array.isArray(w.relatedLinks) ? (w.relatedLinks as Array<Record<string, unknown>>) : []
      const href = links.map((l) => (typeof l?.href === 'string' ? l.href : null)).find((h) => h && h.startsWith('/')) ?? null
      return {
        id: w.id,
        sourceKey: w.sourceKey,
        title: w.title,
        description: w.description,
        priority: w.priority,
        dueAt: w.dueAt,
        href,
      }
    }),
  })

  // ── Tiles ───────────────────────────────────────────────────────────────
  const taskCount = tasks.cards.length + tasks.overflow.length
  const worstTask = tasks.cards[0]?.severity ?? null
  const tiles: CommissionerTile[] = [
    {
      key: 'health',
      label: 'League health',
      tone: !healthScore.available
        ? 'neutral'
        : healthScore.data.score >= 70
          ? 'good'
          : healthScore.data.score >= 45
            ? 'warn'
            : 'bad',
      state: healthScore.available
        ? {
            available: true,
            data: {
              value: String(Math.round(healthScore.data.score)),
              sub: activityStale
                ? `${humanStatus(healthScore.data.status)} · from data ${staleDays} days old`
                : `${humanStatus(healthScore.data.status)} · ${Math.round(healthScore.data.confidencePct)}% confidence`,
            },
          }
        : { available: false, reason: healthScore.reason },
    },
    {
      key: 'needs-you',
      label: 'Needs you',
      tone: worstTask === 'bad' ? 'bad' : worstTask === 'warn' ? 'warn' : taskCount > 0 ? 'neutral' : 'good',
      state: {
        available: true,
        data: {
          value: String(taskCount),
          sub: taskCount === 0 ? 'nothing needs a ruling' : 'task cards above',
        },
      },
    },
    {
      key: 'deadline',
      label: 'Next deadline',
      tone: upcoming?.status === 'soon' ? 'warn' : 'neutral',
      state: upcoming
        ? { available: true, data: { value: upcoming.title, sub: upcoming.whenLabel } }
        : { available: false, reason: 'nothing dated is coming up — see the calendar for what is on file' },
    },
    {
      key: 'managers',
      label: 'Active managers',
      tone:
        !activityStale && memberActivity.available
          ? memberActivity.data.inactive > 0
            ? 'warn'
            : 'good'
          : 'neutral',
      state: activityStale
        ? { available: false, reason: `last sync was ${staleDays} days ago — activity isn’t judged on data that old` }
        : memberActivity.available
          ? {
              available: true,
              data: {
                value: String(memberActivity.data.active),
                sub: `of ${memberActivity.data.total} · ${memberActivity.data.inactive} with no move in ${MANAGER_INACTIVE_AFTER_DAYS} days`,
              },
            }
          : { available: false, reason: memberActivity.reason },
    },
    {
      key: 'claimed',
      label: 'Claimed teams',
      tone: claimed === teamCount && teamCount > 0 ? 'good' : 'neutral',
      state:
        teamCount > 0
          ? {
              available: true,
              data: {
                value: String(claimed),
                sub:
                  claimed === teamCount
                    ? `of ${teamCount} · every team is connected`
                    : `of ${teamCount} · ${teamCount - claimed} with no AllFantasy account`,
              },
            }
          : { available: false, reason: 'no teams have been ingested for this league yet' },
    },
    {
      key: 'sync',
      label: 'Sync',
      tone: unread ? 'warn' : syncStale ? 'warn' : 'good',
      state: native
        ? { available: true, data: { value: 'Live', sub: 'runs on AllFantasy' } }
        : unread
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

  const settings: CommissionerSettingRow[] = [
    {
      key: 'Trade deadline',
      state: describeTradeDeadline(settingsJson, league.tradeDeadlineWeek ?? null),
    },
    {
      key: 'Playoffs',
      state: describePlayoffs(settingsJson, league.playoffStartWeek ?? null, league.playoffTeams ?? null),
    },
    {
      key: 'Waivers',
      state: waiverSettings?.waiverType
        ? {
            available: true,
            data: (() => {
              const kind = String(waiverSettings.waiverType).toLowerCase()
              const label = WAIVER_TYPE_LABEL[kind] ?? kind
              return waiverSettings.faabBudget != null ? `${label} · $${waiverSettings.faabBudget}` : label
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

  const recipeSettings = readRecipeSettings(settingsJson, platform)
  const viewerIsOwner = league.userId === userId
  // The gate above admitted only commissioner and co-commissioner, which is exactly `canBroadcast`.
  const viewerCanBroadcast = native

  const grant = {
    leagueId,
    userId,
    platform,
    platformLeagueId: league.platformLeagueId ?? null,
    season: league.season ?? null,
    teams: teams.map((t) => ({ name: teamLabel(t), platformUserId: t.platformUserId ?? null })),
  } as unknown as CommissionerGrant

  return {
    allowed: true,
    grant,
    league: { id: leagueId, name: leagueName, platform, season: league.season ?? null, native },
    role,
    viewerIsOwner,
    viewerCanBroadcast,
    tiles,
    tasks,
    tasksEmptyReason:
      taskCount > 0
        ? null
        : unread
          ? 'This league has never synced, so nothing has been checked. An empty list here is not the same as a quiet league.'
          : 'Nothing in this league needs you right now.',
    health: { score: healthScore, flags },
    members: activityStale ? { available: false, reason: stale?.reason ?? '' } : memberActivity,
    calendar: { ...calendar, ics },
    areas: buildLeagueAreas(hubLeague),
    workflows: buildWorkflows(hubLeague),
    communities: buildCommunities({
      league: hubLeague,
      viewerIsOwner,
      viewerCanBroadcast,
      discord: discordLink
        ? { guildName: discordLink.guild?.guildName ?? null, channelName: discordLink.channelName ?? null }
        : null,
      datedEventCount: calendar.events.filter((e) => e.at && e.status !== 'past').length,
      payment: {
        link: duesTracker?.paymentLink ?? null,
        provider: duesTracker?.paymentProvider ?? null,
        tracked: Boolean(duesTracker?.enabled),
      },
      claimedTeams: claimed,
      totalTeams: teamCount,
    }),
    recipes: {
      ...recipeSettings,
      sendEnabled,
      catalog: RECIPES.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        cadence: r.cadence,
        unavailable: r.unavailableReason({ platform, sport }),
      })),
    },
    charts: {
      scoring: matchups ? scoringChart(matchups) : null,
      balance: balanceChart(
        teams.map((t) => ({ name: teamLabel(t), wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor })),
      ),
      engagement: memberRows && !activityStale ? engagementChart(memberRows) : null,
    },
    settings,
    access,
    unread,
    disputes: { available: false, reason: DISPUTES_REASON },
    publicStandings: {
      /*
       * Read from the same `League.settings` key the public page checks, so the
       * two can never disagree about whether a league is published.
       */
      enabled:
        Boolean(settingsJson) &&
        typeof settingsJson === 'object' &&
        (settingsJson as Record<string, unknown>).publicStandings === true,
      url: `/standings/${leagueId}`,
    },
    waivers,
    art: leagueHubArt({ ...league, settings: settingsJson }),
    chatHref: `/league/${encodeURIComponent(leagueId)}?view=league_chat`,
    // Ingested teams only: a league with no team rows has nothing to invite anyone to yet.
    unclaimedTeams: teams.length > 0 ? teams.length - claimed : 0,
    quietManagers,
    depth: input.depth ?? null,
  }
}

function humanStatus(status: string): string {
  const s = status.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
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
