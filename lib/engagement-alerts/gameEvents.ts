import type { LiveScoreRow } from '@/lib/sports-live-scores-service'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

export type GameAlert = { key: string; type: string; title: string; body: string }
export type GameObservation = Pick<LiveScoreRow, 'gameId' | 'homeTeam' | 'awayTeam' | 'homeScore' | 'awayScore' | 'status' | 'statusDetail' | 'period' | 'clock' | 'completed'> & Partial<Pick<LiveScoreRow, 'homeLinescores' | 'awayLinescores' | 'eventName' | 'playoffSeries' | 'homeTeamId' | 'awayTeamId' | 'season' | 'startTime'>>

const final = (g: GameObservation) => g.completed || /final|full_time|completed/i.test(g.status)
const halftime = (g: GameObservation) => /halftime|half.time|^ht$/i.test(`${g.status} ${g.statusDetail}`.trim())

export function isCloseLateGame(sport: string, g: GameObservation): boolean {
  if (final(g) || g.homeScore == null || g.awayScore == null) return false
  const gap = Math.abs(g.homeScore - g.awayScore)
  const clock = /^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/.exec(g.clock ?? '')
  const seconds = clock ? Number(clock[1] ?? 0) * 60 + Number(clock[2]) : null
  switch (sport.toUpperCase()) {
    case 'NFL': case 'NCAAF': return gap <= 8 && g.period >= 4 && seconds != null && seconds <= 300
    case 'WNBA': return gap <= 5 && g.period >= 4 && seconds != null && seconds <= 300
    case 'NBA': return gap <= 5 && g.period >= 4 && seconds != null && seconds <= 120
    case 'NCAAB': return gap <= 5 && g.period >= 2 && seconds != null && seconds <= 120
    case 'NHL': return gap <= 1 && g.period >= 3 && seconds != null && seconds <= 120
    case 'MLB': case 'NCAABASE': return gap <= 1 && g.period >= 8
    case 'SOCCER': return gap <= 1 && g.period >= 2 && Number.parseInt(g.clock, 10) >= 80
    default: return false
  }
}

/** Bootstrap establishes a baseline; never announce an entire game's history on first poll. */
export function gameStateAlerts(sport: string, previous: GameObservation | null, next: GameObservation): GameAlert[] {
  if (!previous || next.homeScore == null || next.awayScore == null) return []
  sport = sport.toUpperCase()
  const score = `${next.awayTeam} ${next.awayScore} — ${next.homeTeam} ${next.homeScore}`
  const alerts: GameAlert[] = []
  const periodsPerHalf = ['NFL', 'NCAAF', 'NBA', 'WNBA'].includes(sport) ? 2 : ['NCAAB', 'SOCCER'].includes(sport) ? 1 : null
  const crossedHalf = periodsPerHalf != null && previous.period <= periodsPerHalf && next.period > periodsPerHalf
  const halfScore = crossedHalf && next.homeLinescores && next.awayLinescores &&
    next.homeLinescores.length >= periodsPerHalf! && next.awayLinescores.length >= periodsPerHalf!
    ? `${next.awayTeam} ${next.awayLinescores.slice(0, periodsPerHalf!).reduce((a, b) => a + b, 0)} — ${next.homeTeam} ${next.homeLinescores.slice(0, periodsPerHalf!).reduce((a, b) => a + b, 0)}` : null
  if (halftime(next) && !halftime(previous) || crossedHalf && halfScore) alerts.push({ key: 'halftime', type: 'game_halftime', title: `${sport} halftime`, body: halfScore ?? score })
  if (['NBA', 'NHL'].includes(sport) && !final(next)) {
    const ended = next.period > previous.period ? next.period - 1
      : /end.*(?:quarter|period)|(?:quarter|period).*end|intermission/i.test(next.statusDetail + ' ' + next.status)
        || /^(?:0:)?0+(?:\.0+)?$/.test(next.clock ?? '') ? next.period : 0
    // Reuse the halftime identity for Q2; never replay multiple missed intervals.
    if (ended > 0 && !(sport === 'NBA' && ended === 2 && alerts.some(a => a.key === 'halftime'))) {
      const linesAvailable = (next.homeLinescores?.length ?? 0) >= ended && (next.awayLinescores?.length ?? 0) >= ended
      const atBoundary = ended === next.period
      if (atBoundary || linesAvailable) {
        const intervalScore = linesAvailable
          ? `${next.awayTeam} ${next.awayLinescores!.slice(0, ended).reduce((a,b)=>a+b,0)} — ${next.homeTeam} ${next.homeLinescores!.slice(0, ended).reduce((a,b)=>a+b,0)}` : score
        const label = ended > (sport === 'NBA' ? 4 : 3) ? 'overtime' : sport === 'NBA' ? 'quarter' : 'period'
        const half = sport === 'NBA' && ended === 2
        alerts.push({ key: half ? 'halftime' : `interval:${ended}`, type: half ? 'game_halftime' : 'game_period_end', title: half ? 'NBA halftime' : `${sport}: end of ${label} ${ended}`, body: intervalScore })
      }
    }
  }
  if (final(next) && !final(previous)) alerts.push({ key: 'final', type: 'game_final', title: `${sport} final score`, body: score })
  if (isCloseLateGame(sport, next) && !isCloseLateGame(sport, previous)) alerts.push({ key: 'close', type: 'game_close', title: `${sport}: close game`, body: `${score}. ${next.statusDetail}` })
  return alerts
}

/** Only provider-identified plays qualify; cumulative score changes cannot identify every play. */
export function gamePlayAlerts(detail: LiveGameDetail): GameAlert[] {
  const sport = detail.sport.toUpperCase()
  const restricted = ['NBA', 'NCAAB', 'NHL'].includes(sport)
  // Use each play's own clock and score, never the current game snapshot.
  const eligible = (p: { period?: number | null; clock?: string | null; homeScore?: number | null; awayScore?: number | null }) => {
    if (!restricted) return true
    const lastPeriod = sport === 'NHL' ? 3 : sport === 'NCAAB' && detail.basketball?.periods !== 'quarters' ? 2 : 4
    const clock = /^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/.exec(p.clock ?? '')
    if (!clock || p.period == null || p.period < lastPeriod || p.homeScore == null || p.awayScore == null) return false
    return Number(clock[1] ?? 0) * 60 + Number(clock[2]) <= 120 && Math.abs(p.homeScore - p.awayScore) <= (sport === 'NHL' ? 1 : 5)
  }
  const out = new Map<string, GameAlert>()
  const add = (p: { id: string; text: string }, scoring: boolean) => {
    if (!p.id || !p.text) return
    out.set(p.id, { key: `play:${p.id}`, type: scoring ? 'game_scoring_play' : 'game_big_play',
      title: `${detail.sport}: ${scoring ? 'scoring play' : 'big play'}`, body: p.text })
  }
  const hasFullPlayList = !!detail.basketball?.plays.length || !!detail.hockey?.plays.length || !!detail.baseball?.atBats.length || detail.drives.some(d => d.plays.length > 0)
  // A summary can list one score both in its sport play list and scoringPlays with different ids.
  // Prefer the full list so one observation does not become two notifications.
  if (!hasFullPlayList) for (const p of detail.scoringPlays) if (eligible(p)) add(p, true)
  for (const p of detail.basketball?.plays ?? []) {
    if (p.scoring && eligible(p)) add(p, true)
    else if (!restricted && /block|steal/i.test(p.type ?? '')) add(p, false)
  }
  for (const p of detail.hockey?.plays ?? []) if (p.scoring && eligible(p)) add(p, true)
  for (const ab of detail.baseball?.atBats ?? []) {
    if (ab.scoring || /home run|grand slam/i.test(ab.resultType ?? '')) add({ id: ab.id, text: ab.result ?? ab.events.join('. ') }, true)
  }
  for (const drive of detail.drives) for (const p of drive.plays) {
    if (p.scoring || (p.statYardage != null && p.statYardage >= 19)) add(p, p.scoring)
  }
  return [...out.values()]
}
