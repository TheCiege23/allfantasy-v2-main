import 'server-only'

import type { UserLeague } from '@/app/dashboard/types'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'

/**
 * The "outstanding issues" feed behind the AF Core home screen.
 *
 * The handoff's screen shows ten issues — empty FLEX slots, a player stuck on IR,
 * a trade offer, unconfirmed waiver claims, a bye-week hole. Those come from
 * per-league roster and transaction state that this codebase does NOT yet compute
 * for imported leagues; there is no engine producing them today.
 *
 * So this derives only what is genuinely knowable right now, and returns an empty
 * list otherwise. A dashboard that invents "FLEX is empty" for a league we have
 * not read a lineup from would be worse than an honest empty state — it sends the
 * user to Sleeper to fix a problem that may not exist, and the one thing this
 * product sells is that its reads are trustworthy.
 *
 * `detectorsAvailable` reports which categories can currently fire, so the screen
 * can say what it is and is not watching rather than implying it watches
 * everything and found nothing.
 */

export type IssueSeverity = 'bad' | 'warn' | 'info'

export type CoreIssue = {
  id: string
  severity: IssueSeverity
  /** Short glyph shown in the severity chip. */
  glyph: string
  title: string
  /** "Sleeper › Lineup · locks in 1h 04m" — platform, area, then the specifics. */
  meta: string
  /*
   * Nullable because not every issue belongs to one league. The collapsed
   * stale-sync row stands for all of them at once, and pinning it to an
   * arbitrary member would make the row lie about what it describes.
   */
  leagueId: string | null
  leagueName: string | null
  platform: string | null
  /** Absolute deadline, when one is known. Drives sort and the urgent styling. */
  deadline: Date | null
  action: { label: string; href: string; external: boolean } | null
}

export type IssueDetector =
  | 'stale_sync'
  | 'disconnected_platform'
  | 'draft_upcoming'
  | 'empty_lineup_slot'
  | 'ir_blocked_player'
  | 'trade_offer'
  | 'waiver_claim'
  | 'bye_week_hole'
  | 'commissioner_vote'

export type OutstandingIssuesResult = {
  issues: CoreIssue[]
  /** Detectors that can actually fire today, and why the rest cannot. */
  detectorsAvailable: IssueDetector[]
  detectorsUnavailable: Array<{ detector: IssueDetector; reason: string }>
}

/** Platform deep links. Never a write action — always "open the platform". */
function platformHome(platform: string, league: UserLeague): { label: string; href: string } | null {
  const p = platform.toLowerCase()
  if (p === 'sleeper') {
    const id = league.sleeperLeagueId ?? league.id
    return { label: 'Open in Sleeper', href: `https://sleeper.com/leagues/${encodeURIComponent(id)}` }
  }
  if (p === 'espn') return { label: 'Open in ESPN', href: 'https://fantasy.espn.com/football/league' }
  if (p === 'yahoo') return { label: 'Open in Yahoo', href: 'https://football.fantasysports.yahoo.com/' }
  return null
}

function titleCasePlatform(platform: string): string {
  const p = platform.toLowerCase()
  if (p === 'espn') return 'ESPN'
  if (p === 'mfl') return 'MFL'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export function deriveOutstandingIssues(input: {
  leagues: UserLeague[]
  /** When each league last synced, keyed by league id. */
  lastSyncByLeague?: Record<string, Date | null>
  now?: Date
}): OutstandingIssuesResult {
  const now = input.now ?? new Date()
  const issues: CoreIssue[] = []
  /** Held back so they can be collapsed when there are too many to act on. */
  const staleIssues: CoreIssue[] = []

  for (const league of input.leagues) {
    const platform = String(league.platform ?? '').toLowerCase()
    const action = platformHome(platform, league)

    // ── Detector: a draft with a known date that has not happened yet ──
    if (league.draftDate) {
      const when = new Date(league.draftDate)
      if (!Number.isNaN(when.getTime()) && when > now) {
        const hoursOut = (when.getTime() - now.getTime()) / 3_600_000
        issues.push({
          id: `${league.id}:draft`,
          // A draft inside a day is the most time-critical thing on this screen.
          severity: hoursOut <= 24 ? 'bad' : 'info',
          glyph: '▤',
          title: `Draft ${hoursOut <= 24 ? 'today' : 'coming up'} — ${league.name}`,
          meta: `${titleCasePlatform(platform)} › Draft · ${when.toUTCString().slice(0, 22)}`,
          leagueId: league.id,
          leagueName: league.name,
          platform,
          deadline: when,
          action: action ? { ...action, external: true } : null,
        })
      }
    }

    // ── Detector: this league's data has gone stale ──
    const lastSync = input.lastSyncByLeague?.[league.id] ?? null
    const age = describeAge('roster', lastSync, now)
    if (age.stale) {
      staleIssues.push({
        id: `${league.id}:stale`,
        severity: 'warn',
        glyph: '◷',
        title: `League data is stale — ${league.name}`,
        // Naming the age is the point: "we last read this 3d ago" is actionable,
        // "something is wrong" is not. describeAge returns "never synced" for a
        // null timestamp, which reads wrong after "last read" — so phrase the
        // two cases separately rather than concatenating into "last read never
        // synced".
        meta: lastSync
          ? `${titleCasePlatform(platform)} › Sync · last read ${age.label}`
          : `${titleCasePlatform(platform)} › Sync · never read`,
        leagueId: league.id,
        leagueName: league.name,
        platform,
        deadline: null,
        action: action ? { ...action, external: true } : null,
      })
    }
  }

  /*
   * ⚠ COLLAPSE THE STALE-SYNC ROWS ABOVE A HANDFUL. Measured on production: one
   * account produced 604 of them, every row reading "League data is stale —
   * <name> · never read", and they buried the queue completely — the screen that
   * is supposed to answer "what needs me now" answered it 604 times with the
   * same sentence.
   *
   * The per-league rows are only useful while you can act on them one at a time.
   * Past that they are one fact about the account, not N facts about N leagues,
   * and the honest presentation is to say it once with the count. The individual
   * rows are not dropped silently — the aggregate states how many it stands for,
   * and it carries the same action as the rows it replaces.
   */
  const STALE_ROW_LIMIT = 3
  if (staleIssues.length > STALE_ROW_LIMIT) {
    const neverRead = staleIssues.filter((i) => i.meta?.includes('never read')).length
    // Every stale row is per-league so it always carries a platform; the filter
    // is for the type, which cannot know that.
    const platforms = [...new Set(staleIssues.map((i) => i.platform).filter((p): p is string => p != null))]
    issues.push({
      id: 'stale:aggregate',
      severity: 'warn',
      glyph: '◷',
      title:
        neverRead === staleIssues.length
          ? `${staleIssues.length} leagues have never been read`
          : `${staleIssues.length} leagues have stale data`,
      meta:
        platforms.length === 1
          ? `${titleCasePlatform(platforms[0])} › Sync · nothing has been read for these leagues yet`
          : `${platforms.length} platforms › Sync · nothing has been read for these leagues yet`,
      // Deliberately not scoped to one league — it is about all of them, and
      // pinning it to an arbitrary member would make the row lie about itself.
      leagueId: null,
      leagueName: null,
      platform: platforms.length === 1 ? platforms[0] : null,
      deadline: null,
      action: null,
    })
  } else {
    issues.push(...staleIssues)
  }

  // Soonest deadline first, exactly as the handoff sorts it. Issues without a
  // deadline sink below the timed ones rather than being dropped.
  issues.sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime()
    if (a.deadline) return -1
    if (b.deadline) return 1
    const rank = { bad: 0, warn: 1, info: 2 } as const
    return rank[a.severity] - rank[b.severity]
  })

  return {
    issues,
    detectorsAvailable: ['stale_sync', 'draft_upcoming'],
    detectorsUnavailable: [
      { detector: 'empty_lineup_slot', reason: 'no lineup reader for imported leagues yet' },
      { detector: 'ir_blocked_player', reason: 'roster slot state is not ingested' },
      { detector: 'trade_offer', reason: 'pending offers are not ingested' },
      { detector: 'waiver_claim', reason: 'claim state is not ingested' },
      { detector: 'bye_week_hole', reason: 'requires per-slot projections' },
      { detector: 'commissioner_vote', reason: 'votes are not ingested for imported leagues' },
      { detector: 'disconnected_platform', reason: 'token expiry is not surfaced per league' },
    ],
  }
}
