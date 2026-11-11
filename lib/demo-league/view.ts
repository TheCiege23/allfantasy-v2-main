/**
 * Real source snapshot → anonymized DemoLeagueView.
 *
 * ALLOWLIST, NOT DENYLIST. Every output field is constructed here by name. Nothing is
 * spread from a source object, so a new column on LeagueTeam, a new key in
 * `Roster.playerData`, or a new field on RecentTrade cannot reach the browser by
 * accident — it has to be written into this file.
 *
 * Pure: no DB, no I/O. The alias indices come in from `ensureTeamAliases`.
 */
import { monitorLeagueHealth } from '@/lib/league-health/league-health-engine'
import { DEMO_LEAGUE_DISPLAY_NAME, fakeAvatarColor, fakeInitials, fakeManagerName, fakeTeamName } from './fakeNames'
import type { SourceSnapshot, SourceTeam, SourcePlayer } from './source'
import type { SensitiveTerm } from './redactor'
import type {
  DemoAlert, DemoLeagueView, DemoMatchup, DemoPlayer, DemoRoster, DemoStandingRow, DemoTeam, DemoTrade, DemoTradeAsset,
} from './types'
import { rosterIdsMatch } from '@/lib/core-app/rosterIdMatch'

export function aliasTeam(index: number): DemoTeam {
  const teamName = fakeTeamName(index)
  return {
    slot: index + 1,
    teamName,
    managerName: fakeManagerName(index),
    initials: fakeInitials(teamName),
    color: fakeAvatarColor(index),
  }
}

function round1(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 10) / 10
}

function demoPlayer(p: SourcePlayer): DemoPlayer {
  return { name: p.name, position: p.position, team: p.team, headshotUrl: safeHeadshot(p.headshotUrl) }
}

/**
 * Player headshots are public CDN images of athletes. Anything else (a user upload, a
 * provider avatar keyed by a user id) is dropped. https only, and never a Sleeper
 * AVATAR path, which is keyed by a manager's avatar id.
 */
function safeHeadshot(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    if (/\/avatars?\//i.test(u.pathname)) return null
    return u.toString()
  } catch {
    return null
  }
}

function rosterPositions(starters: unknown): string[] {
  if (!Array.isArray(starters)) return []
  return starters.filter((s): s is string => typeof s === 'string' && /^[A-Z_/0-9]{1,12}$/.test(s)).slice(0, 30)
}

function scoringLabel(scoring: string | null): string | null {
  if (!scoring) return null
  const s = scoring.toLowerCase()
  if (s.includes('half')) return 'Half PPR'
  if (s.includes('ppr')) return 'PPR'
  if (s.includes('std') || s.includes('standard')) return 'Standard'
  if (s.includes('cat')) return 'Categories'
  if (s.includes('point')) return 'Points'
  return null
}

export type BuildResult = { view: DemoLeagueView; sensitive: SensitiveTerm[]; protectedStrings: string[] }

export function buildDemoLeagueView(src: SourceSnapshot, aliasIndex: Map<string, number>, now = new Date()): BuildResult {
  const aliasFor = new Map<string, DemoTeam>()
  for (const t of src.teams) {
    const idx = aliasIndex.get(t.key)
    if (idx !== undefined) aliasFor.set(t.key, aliasTeam(idx))
  }
  const teams = [...aliasFor.values()].sort((a, b) => a.slot - b.slot)

  const teamByRosterId = (rosterId: string): SourceTeam | undefined =>
    src.teams.find((t) => rosterIdsMatch(t.externalId, rosterId))
  const teamByAnyId = (id: string): SourceTeam | undefined =>
    teamByRosterId(id) ?? src.teams.find((t) => t.platformUserId === id || t.claimedByUserId === id)
  const slotOf = (t: SourceTeam | undefined): number | null => (t ? aliasFor.get(t.key)?.slot ?? null : null)

  // ── Standings ──────────────────────────────────────────────────────────────
  const scored = src.weekRows.filter((r) => r.pointsFor > 0 || r.pointsAgainst > 0)
  let standings: DemoStandingRow[]
  if (scored.length > 0) {
    const agg = new Map<number, Omit<DemoStandingRow, 'rank'>>()
    for (const r of scored) {
      const slot = slotOf(teamByRosterId(r.rosterId))
      if (slot == null) continue
      const a = agg.get(slot) ?? { slot, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
      if (r.pointsFor > r.pointsAgainst) a.wins += 1
      else if (r.pointsFor < r.pointsAgainst) a.losses += 1
      else a.ties += 1
      a.pointsFor += r.pointsFor
      a.pointsAgainst += r.pointsAgainst
      agg.set(slot, a)
    }
    standings = [...agg.values()]
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor)
      .map((a, i) => ({ ...a, rank: i + 1, pointsFor: round1(a.pointsFor), pointsAgainst: round1(a.pointsAgainst) }))
  } else {
    standings = src.teams
      .map((t) => ({ t, slot: slotOf(t) }))
      .filter((x): x is { t: SourceTeam; slot: number } => x.slot != null)
      .sort((a, b) => b.t.wins - a.t.wins || a.t.losses - b.t.losses || b.t.pointsFor - a.t.pointsFor)
      .map(({ t, slot }, i) => ({
        slot, rank: i + 1, wins: t.wins, losses: t.losses, ties: t.ties,
        pointsFor: round1(t.pointsFor), pointsAgainst: round1(t.pointsAgainst),
      }))
  }

  // ── Current week + matchups ────────────────────────────────────────────────
  const weeks = [...new Set(src.weekRows.map((r) => r.week))].sort((a, b) => a - b)
  const weekIsComplete = (w: number) => src.weekRows.filter((r) => r.week === w).every((r) => r.pointsFor > 0 || r.pointsAgainst > 0)
  const currentWeek = weeks.find((w) => !weekIsComplete(w)) ?? weeks[weeks.length - 1] ?? null

  const matchups: DemoMatchup[] = []
  if (currentWeek != null) {
    const rows = src.weekRows.filter((r) => r.week === currentWeek)
    const weekFinal = weekIsComplete(currentWeek)
    const byMatchup = new Map<string, typeof rows>()
    for (const r of rows) {
      const k = r.matchupId == null ? `solo:${r.rosterId}` : `m:${r.matchupId}`
      byMatchup.set(k, [...(byMatchup.get(k) ?? []), r])
    }
    for (const pair of byMatchup.values()) {
      const [a, b] = pair
      const aSlot = a ? slotOf(teamByRosterId(a.rosterId)) : null
      if (aSlot == null) continue
      const bSlot = b ? slotOf(teamByRosterId(b.rosterId)) : null
      // Per game, not per week: in a live week a game that has not kicked off is "upcoming", not "live 0–0".
      const started = (a!.pointsFor > 0 || a!.pointsAgainst > 0) || Boolean(b && (b.pointsFor > 0 || b.pointsAgainst > 0))
      const status: DemoMatchup['status'] = weekFinal ? 'final' : started ? 'live' : 'upcoming'
      matchups.push({
        home: { slot: aSlot, points: round1(a!.pointsFor) },
        away: b && bSlot != null ? { slot: bSlot, points: round1(b.pointsFor) } : null,
        status,
      })
    }
    matchups.sort((x, y) => x.home.slot - y.home.slot)
  }

  // ── Rosters ────────────────────────────────────────────────────────────────
  const rosters: DemoRoster[] = src.rosters
    .map((r) => {
      const slot = aliasFor.get(r.teamKey)?.slot
      return slot == null ? null : { slot, starters: r.starters.map(demoPlayer), bench: r.bench.map(demoPlayer) }
    })
    .filter((r): r is DemoRoster => r != null)
    .sort((a, b) => a.slot - b.slot)

  // ── Trades: who got which players, with fake team names. No notes, no messages. ──
  const trades: DemoTrade[] = src.trades
    .map((t, i) => {
      const sides = t.sides
        .map((s) => {
          const slot = slotOf(teamByAnyId(String(s.rosterId)))
          if (slot == null) return null
          const received: DemoTradeAsset[] = s.received
            .filter((a) => a.kind === 'player' || a.kind === 'pick')
            .map((a) => ({ kind: a.kind as 'player' | 'pick', name: a.name, position: a.position, team: a.team }))
          return { slot, received }
        })
        .filter((s): s is { slot: number; received: DemoTradeAsset[] } => s != null)
      return sides.length === 0 ? null : { key: `trade-${i + 1}`, date: t.acceptedAt.slice(0, 10), sides }
    })
    .filter((t): t is DemoTrade => t != null)
    .slice(0, 25)

  // ── League Health (pure engine, numeric inputs only) ──────────────────────
  const teamCount = src.teams.length
  const abandoned = src.teams.filter((t) => t.isOrphan).length
  const health = teamCount > 0
    ? (() => {
        const h = monitorLeagueHealth({
          sport: src.league.sport,
          leagueType: src.league.leagueType ?? (src.league.isDynasty ? 'dynasty' : 'redraft'),
          leagueId: 'demo',
          numTeams: teamCount,
          currentWeek: currentWeek ?? 1,
          totalWeeks: Math.max(weeks.length, 1),
          activeManagers: teamCount - abandoned,
          inactiveManagers: 0,
          abandonedTeams: abandoned,
          lineupSubmissionRate: src.rosters.length
            ? src.rosters.filter((r) => r.emptyStarterSlots === 0).length / src.rosters.length
            : 1,
          totalTradesThisSeason: src.tradeCountThisSeason,
          totalWaiverClaims: 0,
          avgFaabSpentPct: 0,
          chatMessageCount: 0,
          voteCount: 0,
          disputeCount: 0,
          commissionerActionsThisSeason: 0,
          unresolvedDisputes: 0,
          playoffTeams: src.league.playoffTeams ?? 6,
          waiverType: src.league.waiverType ?? 'FAAB',
          tradeReviewProcess: 'commissioner',
        })
        /*
         * ⚠ The demo never reads chat, and this view has no waiver, vote or dispute counts, so
         * those inputs are passed as 0. A note derived from them ("very low chat activity") would
         * be a false claim about the league, so it is dropped rather than shown.
         */
        const measured = (t: string) => !/chat|waiver|faab|vote|dispute|community/i.test(t)
        return {
          score: Math.round(h.leagueHealthScore),
          status: h.overallStatus,
          summary: `Scored on standings, schedule, roster activity and trades. ${h.overallStatus === 'excellent' || h.overallStatus === 'healthy' ? 'No urgent problems.' : 'Worth a closer look.'}`,
          strengths: h.biggestStrengths.filter(measured).slice(0, 4),
          problems: h.biggestProblems.filter(measured).slice(0, 4),
          _alerts: [...h.urgentAlerts, ...h.earlyWarningSignals].filter(measured).slice(0, 4),
        }
      })()
    : null

  // ── Alerts ────────────────────────────────────────────────────────────────
  const alerts: DemoAlert[] = []
  for (const text of health?._alerts ?? []) alerts.push({ kind: 'health', text })
  for (const r of src.rosters) {
    if (r.emptyStarterSlots > 0) {
      const t = aliasFor.get(r.teamKey)
      if (t) alerts.push({ kind: 'roster', text: `${t.teamName} has ${r.emptyStarterSlots} empty starting slot${r.emptyStarterSlots === 1 ? '' : 's'}.` })
    }
  }
  // Commissioner alert headlines are free text written about real managers; they are only
  // ever shown after the redactor has replaced every real name in them (see service.ts).
  for (const headline of src.openAlertHeadlines.slice(0, 3)) alerts.push({ kind: 'commissioner', text: headline })

  const view: DemoLeagueView = {
    demo: true,
    label: 'Demo league — live sample data',
    leagueName: DEMO_LEAGUE_DISPLAY_NAME,
    settings: {
      sport: src.league.sport,
      season: src.league.season,
      scoringLabel: scoringLabel(src.league.scoring),
      leagueType: src.league.leagueType,
      isDynasty: src.league.isDynasty,
      teamCount,
      rosterPositions: rosterPositions(src.league.starters),
      playoffTeams: src.league.playoffTeams,
      playoffStartWeek: src.league.playoffStartWeek,
      tradeDeadlineWeek: src.league.tradeDeadlineWeek,
      waiverType: src.league.waiverType,
    },
    currentWeek,
    lastSyncedAt: src.league.lastSyncedAt ? src.league.lastSyncedAt.toISOString() : null,
    teams,
    standings,
    matchups,
    rosters,
    trades,
    health: health ? { score: health.score, status: health.status, summary: health.summary, strengths: health.strengths, problems: health.problems } : null,
    alerts: alerts.slice(0, 12),
  }

  return { view, sensitive: sensitiveTerms(src, aliasIndex), protectedStrings: protectedStrings(src) }
}

/**
 * Every real identifier the source holds, each paired with what to show instead.
 *
 * ⚠ REPLACEMENTS ARE RECOMPUTED FROM THE STORED ALIAS INDEX, never read off the view's
 * team objects. The safety net exists for the case where the view builder is wrong; if it
 * took its replacement text from the builder's own output, a builder that put a real name
 * into an alias would hand the redactor that real name as the "fake" one. (Found by a
 * mutation test: exactly that happened.)
 */
export function sensitiveTerms(src: SourceSnapshot, aliasIndex: Map<string, number>): SensitiveTerm[] {
  const aliasFor = new Map<string, DemoTeam>()
  for (const t of src.teams) {
    const idx = aliasIndex.get(t.key)
    if (idx !== undefined) aliasFor.set(t.key, aliasTeam(idx))
  }
  const out: SensitiveTerm[] = []
  const add = (value: string | null | undefined, replacement: string) => {
    const v = (value ?? '').trim()
    if (v) out.push({ value: v, replacement })
  }
  for (const t of src.teams) {
    const a = aliasFor.get(t.key)
    add(t.teamName, a?.teamName ?? 'a demo team')
    add(t.ownerName, a?.managerName ?? 'a demo manager')
    add(t.platformUserId, '[hidden]')
    add(t.claimedByUserId, '[hidden]')
    add(t.externalId.length >= 6 ? t.externalId : null, '[hidden]')
    add(t.avatarUrl, '')
    add(t.key, '[hidden]')
  }
  const aliasForUser = new Map<string, DemoTeam>()
  for (const t of src.teams) if (t.claimedByUserId && aliasFor.get(t.key)) aliasForUser.set(t.claimedByUserId, aliasFor.get(t.key)!)
  for (const u of src.users) {
    const a = aliasForUser.get(u.id)
    add(u.email, '[hidden]')
    add(u.username, a?.managerName ?? 'a demo manager')
    add(u.displayName, a?.managerName ?? 'a demo manager')
    add(u.id, '[hidden]')
    // The local part of an email is often the person's handle.
    if (u.email && u.email.includes('@')) add(u.email.split('@')[0]!.length >= 5 ? u.email.split('@')[0] : null, a?.managerName ?? 'a demo manager')
  }
  add(src.league.name, DEMO_LEAGUE_DISPLAY_NAME)
  add(src.league.id, '[hidden]')
  add(src.league.platformLeagueId, '[hidden]')
  add(src.league.avatarUrl, '')
  add(src.league.logoUrl, '')
  return out
}

/** Real strings that must survive scrubbing intact even if they contain a manager's first name. */
function protectedStrings(src: SourceSnapshot): string[] {
  const names = new Set<string>()
  for (const r of src.rosters) for (const p of [...r.starters, ...r.bench]) names.add(p.name)
  for (const t of src.trades) for (const s of t.sides) for (const a of s.received) names.add(a.name)
  return [...names]
}
