import type { PlayoffChallengeView, PlayoffSeriesView } from "./types"
import { eligibleCoachPick, gameHasLocked } from "./bracketCoach"
import { pointsForSeries } from "./playoffScoring"
import { championshipTotal, rankBrackets } from "./playoffCompetition"
import { nbaCupLockedReason } from "./nbaCupTournament"

export type LedgerReason = "correct" | "wrong" | "pending" | "no_pick" | "draft" | "late" | "invalid_pick"
export type LedgerRow = { id: string; round: string; home: string; away: string; pick: string | null; winner: string | null; points: number; available: number; reason: LedgerReason; homeScore: number | null; awayScore: number | null; sourceAt: string | null }
export type ScoreChange = { id: string; seriesId: string; observedAt: string; kind: "settled" | "corrected" | "eligibility"; before: LedgerRow | null; after: LedgerRow; delta: number }
export type ScoreSnapshot = { version: 1; since: string; observedAt: string; rows: LedgerRow[]; rank: number | null; events: ScoreChange[]; trimmed: number; alertKeys: string[] }
export type BracketAlertPreferences = { enabled: boolean; missingPicks: boolean; locks: boolean; results: boolean; rankChanges: boolean; spoilerSafe: boolean; leadMinutes: number; locale: "en" | "es" }
export const defaultBracketAlerts: BracketAlertPreferences = { enabled: false, missingPicks: true, locks: true, results: true, rankChanges: true, spoilerSafe: true, leadMinutes: 30, locale: "en" }
export function readBracketAlerts(raw: unknown, challengeId: string): BracketAlertPreferences {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, any>).bracketCoach?.[challengeId] : null
  if (!stored || typeof stored !== "object") return { ...defaultBracketAlerts }
  return { enabled: stored.enabled === true, missingPicks: stored.missingPicks !== false, locks: stored.locks !== false,
    results: stored.results !== false, rankChanges: stored.rankChanges !== false, spoilerSafe: stored.spoilerSafe !== false,
    leadMinutes: [15, 30, 60].includes(stored.leadMinutes) ? stored.leadMinutes : 30, locale: stored.locale === "es" ? "es" : "en" }
}
export function scoreLedger(view: PlayoffChallengeView): LedgerRow[] {
  const picks = new Map(view.picks.map(p => [p.seriesId, p.pickTeamName]))
  return view.series.map(game => {
    const pick = picks.get(game.id) ?? null
    const eligible = Boolean(view.activeEntry?.finalizedAt) && eligibleCoachPick(view, game, view.activeEntry?.finalizedAt)
    const knownTeam = pick && (game.bestOf !== 1 || [game.homeTeamName, game.awayTeamName].includes(pick))
    const winner = game.status === "final" ? game.winnerTeamName : null
    const reason: LedgerReason = !pick ? "no_pick" : !knownTeam ? "invalid_pick" : !view.activeEntry?.finalizedAt ? "draft"
      : !eligible ? "late" : !winner ? "pending" : winner === pick ? "correct" : "wrong"
    return { id: game.id, round: game.round, home: game.homeTeamName, away: game.awayTeamName, pick, winner,
      points: reason === "correct" ? pointsForSeries(game, view.challenge.sport) : 0, available: pointsForSeries(game, view.challenge.sport), reason,
      homeScore: game.liveHomeScore ?? null, awayScore: game.liveAwayScore ?? null, sourceAt: game.lastSyncedAt ?? null }
  })
}
/** Checklist uses server completion, not a count of filled placeholders. It never submits picks. */
export function entryChecklist(view: PlayoffChallengeView, now = Date.now()) {
  const picks = new Map(view.picks.map(p => [p.seriesId, p.pickTeamName]))
  const available = view.series.filter(g => view.challenge.sport === "nba_cup" ? !nbaCupLockedReason(g, now) : !gameHasLocked(g, now) && Boolean(g.startsAt))
  const missing = available.filter(g => !picks.has(g.id) || (g.bestOf === 1 && ![g.homeTeamName, g.awayTeamName].includes(picks.get(g.id)!)))
  const next = [...available].sort((a,b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0]
  const owned = Boolean(view.activeEntry && view.activeEntry.userId === view.viewerUserId)
  return { hasEntry: owned, finalizedAt: owned ? view.activeEntry!.finalizedAt ?? null : null,
    available: available.length, saved: available.length - missing.length, missing: missing.length,
    firstMissingId: missing[0]?.id ?? null, nextDeadline: next?.startsAt ?? null,
    readyToFinalize: owned && Boolean(view.completion?.isSubmittable) && !view.activeEntry!.finalizedAt,
    pendingMatchups: view.series.filter(g => !g.startsAt || /^(Winner|TBD|East Champion|West Champion)/i.test(g.homeTeamName + " " + g.awayTeamName)).length }
}
export type ProjectionEntry = { id: string; name: string; totalScore: number; correctPicks: number; finalizedAt: string | null; rank: number | null; tiebreakerTotalScore: number | null }
export type ProjectionPick = { entryId: string; seriesId: string; pickTeamName: string }
/** Hypothetical only: currently leading, fresh, single-game matchups. No final-score writes. */
export function provisionalStandings(view: PlayoffChallengeView, entries: ProjectionEntry[], picks: ProjectionPick[], now = Date.now()) {
  const live = view.series.filter(g => g.bestOf === 1 && g.status === "in_progress" && !g.winnerTeamName)
  const fresh = (g: PlayoffSeriesView) => Boolean(g.lastSyncedAt && Date.parse(g.lastSyncedAt) <= now + 30_000 && now - Date.parse(g.lastSyncedAt) <= 120_000)
  const ranked = entries.filter(e => e.finalizedAt).map(entry => {
    const mine = new Map(picks.filter(p => p.entryId === entry.id).map(p => [p.seriesId, p.pickTeamName]))
    const projected = live.filter(g => fresh(g) && Number.isFinite(g.liveHomeScore) && Number.isFinite(g.liveAwayScore) && g.liveHomeScore !== g.liveAwayScore && gameHasLocked(g, now) && eligibleCoachPick(view, g, entry.finalizedAt))
      .filter(g => mine.get(g.id) === (g.liveHomeScore! > g.liveAwayScore! ? g.homeTeamName : g.awayTeamName))
    const livePoints = projected.reduce((sum,g) => sum + pointsForSeries(g, view.challenge.sport), 0)
    return { ...entry, officialScore: entry.totalScore, officialRank: entry.rank, livePoints, totalScore: entry.totalScore + livePoints, potentialTotal: 0, correctPicks: entry.correctPicks + projected.length }
  })
  return { asOf: new Date(now).toISOString(), liveGames: live.length, staleGames: live.filter(g => !fresh(g)).length,
    rows: rankBrackets(ranked, championshipTotal(view.series)).map(e => ({ id: e.id, name: e.name, officialScore: e.officialScore, officialRank: e.officialRank,
      provisionalScore: e.totalScore, provisionalRank: e.rank, livePoints: e.livePoints, movement: e.officialRank == null ? null : e.officialRank - e.rank })) }
}
const resultFingerprint = (row: LedgerRow) => JSON.stringify([row.winner, row.points, row.reason, row.winner ? row.homeScore : null, row.winner ? row.awayScore : null])
/** First observation establishes a baseline. Timestamps are observations, never invented game-end times. */
export function advanceScoreSnapshot(prior: ScoreSnapshot | null, rows: LedgerRow[], rank: number | null, observedAt: string): ScoreSnapshot {
  const previous = new Map(prior?.rows.map(row => [row.id, row]) ?? [])
  const changes: ScoreChange[] = prior ? rows.flatMap(after => {
    const before = previous.get(after.id) ?? null
    if (!before || resultFingerprint(before) === resultFingerprint(after) || (!before.winner && !after.winner)) return []
    return [{ id: `${after.id}:${observedAt}`, seriesId: after.id, observedAt, before, after, delta: after.points - before.points,
      kind: !before.winner && after.winner ? "settled" as const : before.winner !== after.winner || before.homeScore !== after.homeScore || before.awayScore !== after.awayScore ? "corrected" as const : "eligibility" as const }]
  }) : []
  const events = [...changes, ...(prior?.events ?? [])]
  return { version: 1, since: prior?.since ?? observedAt, observedAt, rows, rank, events: events.slice(0, 200), trimmed: (prior?.trimmed ?? 0) + Math.max(0, events.length - 200), alertKeys: prior?.alertKeys.slice(-200) ?? [] }
}
export type BracketAlert = { key: string; kind: "missing" | "lock" | "result" | "rank"; seriesId?: string; deadline: string; count: number; delta?: number; rank?: number }
export function pendingBracketAlerts(view: PlayoffChallengeView, prefs: BracketAlertPreferences, prior: ScoreSnapshot | null, next: ScoreSnapshot, now = Date.now()): BracketAlert[] {
  if (!prefs.enabled || !view.activeEntry) return []
  const picks = new Map(view.picks.map(p => [p.seriesId,p.pickTeamName]))
  const alerts: BracketAlert[] = []
  for (const g of view.series) {
    const time = Date.parse(g.startsAt ?? "")
    if (!Number.isFinite(time) || time <= now || time - now > prefs.leadMinutes * 60_000 || gameHasLocked(g, now) || (view.challenge.sport === "nba_cup" && nbaCupLockedReason(g, now))) continue
    const selected = picks.get(g.id)
    const missing = !selected || (g.bestOf === 1 && ![g.homeTeamName,g.awayTeamName].includes(selected)) || !view.activeEntry.finalizedAt
    if ((missing && prefs.missingPicks) || (!missing && prefs.locks)) alerts.push({ key: `${g.id}:${g.startsAt}:lock`, kind: missing ? "missing" : "lock", seriesId: g.id, deadline: g.startsAt!, count: 1 })
  }
  const changes = next.events.filter(e => e.observedAt === next.observedAt)
  if (prior && prefs.results && changes.length) alerts.push({ key: `results:${next.observedAt}`, kind: "result", count: changes.length, delta: changes.reduce((sum,e) => sum + e.delta,0), deadline: new Date(now + 6 * 3600_000).toISOString() })
  if (prior?.rank != null && next.rank != null && prior.rank !== next.rank && prefs.rankChanges) alerts.push({ key: `rank:${next.observedAt}`, kind: "rank", rank: next.rank, count: 1, deadline: new Date(now + 6 * 3600_000).toISOString() })
  return alerts.filter(a => !next.alertKeys.includes(a.key))
}
export type BracketExperience = { checklist: ReturnType<typeof entryChecklist>; ledger: LedgerRow[]; officialTotal: number; explainedTotal: number;
  history: { available: boolean; since: string | null; events: ScoreChange[]; trimmed: number }; alerts: BracketAlertPreferences;
  scheduledTracking?: boolean; standings: ReturnType<typeof provisionalStandings> | null }
