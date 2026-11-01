import type { LiveScoreRow } from '@/lib/sports-live-scores-service'
import type { LiveGameDetail, GameDetailPlay, GameDetailPlayerLine } from '@/lib/live/espnGameSummary'
import { athletesInPlayText } from '@/lib/live/espnGameSummary'

/**
 * Live game alert POLICY — what one game may notify about, per sport. Pure, no I/O.
 *
 * Owner's rules (2026-10-22), written after users complained about too many pushes and emails:
 *
 *   NFL / NCAAF   Scoring plays and plays of 19+ yards, naming the QB and the ball carrier/receiver
 *                 with a headshot. Big defensive plays: sacks, interception and fumble return TDs.
 *                 Special teams: punt and kickoff return TDs. Late game (last 2:00 of the 4th, or
 *                 OT) in a one-possession game: field goals made, missed or blocked by a team down
 *                 0-3, touchdowns by a team down 0-8, and extra points / two-point tries in a game
 *                 within 7. Extra points and 2-pt tries are NEVER sent outside that window.
 *                 Checkpoints: NFL halftime + final; NCAAF end of Q1, halftime, end of Q3, final.
 *                 NCAAF only for Top 25 teams (the caller applies that gate — see topRankedGame).
 *   NBA / WNBA / NCAAB  Period checkpoints, one close alert in the final period at a gap of 7
 *                 points or less, and the final. No basket or starter milestone alerts.
 *   NHL           Every goal, period checkpoints, one close alert in the third/OT at a gap of
 *                 2 goals or less, and the final. No save alerts.
 *   MLB           End of each completed inning, one close alert in the ninth or extras at a gap
 *                 of 2 runs or less, and the final. No at-bat or starter alerts.
 *   SOCCER        Every goal and the final. No halftime or close-game alert.
 *
 * WHO HEARS WHAT. Every alert names an `audience`:
 *   'game'  — people with a stake in THIS game: followers of either team, and managers starting a
 *             player in it. Plays, checkpoints and finals.
 *   'broad' — everyone who follows the sport. Only close-game / overtime alerts and postseason
 *             checkpoints. This is the line that keeps a 14-game NFL Sunday from being 300 pushes.
 */

export type AlertAudience = 'game' | 'broad'

export type GameAlert = {
  key: string
  type: string
  title: string
  body: string
  audience?: AlertAudience
  severity?: 'medium' | 'high'
  /** A headshot for the push, when the play names a player we can find in the box score. */
  imageUrl?: string | null
  /** Box-score athlete ids named in the play — the caller uses them to avoid double-alerting starters. */
  athleteIds?: string[]
  /** A personal "your starter" alert: goes ONLY to managers starting this athlete. */
  starterAthleteId?: string
  /** Recorded as seen but never sent — a lower milestone passed in the same poll as a higher one. */
  silent?: boolean
}

export type GameObservation = Pick<LiveScoreRow, 'gameId' | 'homeTeam' | 'awayTeam' | 'homeScore' | 'awayScore' | 'status' | 'statusDetail' | 'period' | 'clock' | 'completed'> &
  Partial<Pick<LiveScoreRow, 'homeLinescores' | 'awayLinescores' | 'eventName' | 'playoffSeries' | 'homeTeamId' | 'awayTeamId' | 'season' | 'startTime' | 'homeTeamFull' | 'awayTeamFull' | 'homeLogo' | 'awayLogo' | 'broadcast' | 'homeRank' | 'awayRank'>>

const FOOTBALL = new Set(['NFL', 'NCAAF'])
const TOP25 = new Set(['NCAAF', 'NCAAB'])

const final = (g: GameObservation) => g.completed || /final|full_time|completed/i.test(g.status)
const halftime = (g: GameObservation) => /halftime|half.time|^ht$/i.test(`${g.status} ${g.statusDetail}`.trim())
const breakStatus = (g: GameObservation) => /end.*(?:quarter|period|of \d)|(?:quarter|period).*end|intermission|STATUS_END_PERIOD/i.test(`${g.status} ${g.statusDetail}`)

/** Seconds on a countdown clock ("4:32" → 272, "38.5" → 38.5); null when unreadable. */
export function clockSeconds(clock: string | null | undefined): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/.exec(String(clock ?? '').trim())
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null
}

/** Regulation periods; college men's basketball plays halves. */
function regulation(sport: string, detail?: LiveGameDetail | null): number {
  if (sport === 'NCAAB') return detail?.basketball?.periods === 'quarters' ? 4 : 2
  return ({ NBA: 4, WNBA: 4, NFL: 4, NCAAF: 4, NHL: 3, MLB: 9, SOCCER: 2 } as Record<string, number>)[sport] ?? 4
}

/** Is either side ranked in the Top 25? Non-college sports always pass. Unknown ranks fail closed. */
export function topRankedGame(sport: string, g: Pick<GameObservation, 'homeRank' | 'awayRank'>): boolean {
  if (!TOP25.has(sport.toUpperCase())) return true
  return [g.homeRank, g.awayRank].some(r => typeof r === 'number' && r >= 1 && r <= 25)
}

const teamLabel = (g: GameObservation, side: 'home' | 'away') => {
  const rank = side === 'home' ? g.homeRank : g.awayRank
  const name = side === 'home' ? g.homeTeam : g.awayTeam
  return typeof rank === 'number' && rank <= 25 ? `#${rank} ${name}` : name
}
const scoreLine = (g: GameObservation) => `${teamLabel(g, 'away')} ${g.awayScore} — ${teamLabel(g, 'home')} ${g.homeScore}`
const watch = (g: GameObservation) => g.broadcast ? ` Watch on ${g.broadcast}.` : ''
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][n % 100] ?? 'th'}`

function sumThrough(lines: number[] | undefined, n: number): number | null {
  return lines && lines.length >= n ? lines.slice(0, n).reduce((a, b) => a + b, 0) : null
}

/** Score as of the end of period `n`, from line scores when the poll landed after the break. */
function scoreThrough(g: GameObservation, n: number): string {
  const a = sumThrough(g.awayLinescores, n), h = sumThrough(g.homeLinescores, n)
  return a != null && h != null && g.period > n ? `${teamLabel(g, 'away')} ${a} — ${teamLabel(g, 'home')} ${h}` : scoreLine(g)
}

/** Which periods earn an end-of-period score update. The final period is announced by the final. */
function checkpointPeriods(sport: string, reg: number): number[] {
  switch (sport) {
    case 'NFL': return [2]
    case 'NCAAF': return [1, 2, 3]
    case 'NBA': case 'WNBA': return [1, 2, 3]
    case 'NCAAB': return reg === 2 ? [1] : [1, 2, 3]
    // The 3rd period's end is the final, or the overtime alert when tied.
    case 'NHL': return [1, 2]
    case 'SOCCER': return []
    default: return []
  }
}

/** Close-game rules for the one broad "tune in" alert per game. */
export function isCloseLateGame(sport: string, g: GameObservation): boolean {
  if (final(g) || g.homeScore == null || g.awayScore == null) return false
  sport = sport.toUpperCase()
  const gap = Math.abs(g.homeScore - g.awayScore)
  const secs = clockSeconds(g.clock)
  const reg = sport === 'NCAAB' ? 2 : regulation(sport)
  const lastMinutes = (limit: number) => g.period > reg || (g.period === reg && secs != null && secs <= limit)
  switch (sport) {
    case 'NFL': case 'NCAAF': return gap <= 8 && lastMinutes(120)
    case 'NBA': case 'WNBA': case 'NCAAB': return gap <= 7 && g.period >= reg
    case 'NHL': return gap <= 2 && g.period >= 3
    case 'MLB': case 'NCAABASE': return gap <= 2 && g.period >= 9
    default: return false
  }
}

/** MLB inning state from ESPN's status line: "Top 7th", "Mid 7th", "Bot 7th", "End 7th". */
function inningHalf(g: GameObservation): 'top' | 'mid' | 'bottom' | 'end' | null {
  const d = g.statusDetail ?? ''
  if (/^mid(dle)?\b/i.test(d)) return 'mid'
  if (/^end\b/i.test(d)) return 'end'
  if (/^top\b/i.test(d)) return 'top'
  if (/^bot(tom)?\b/i.test(d)) return 'bottom'
  return null
}

/** Pure: the checkpoint, close-game and final alerts a change between two observations shows. */
export function gameStateAlerts(sport: string, previous: GameObservation | null, next: GameObservation, detail?: LiveGameDetail | null): GameAlert[] {
  if (!previous || next.homeScore == null || next.awayScore == null) return []
  sport = sport.toUpperCase()
  const reg = regulation(sport, detail)
  const postseason = isPostseasonGame(next)
  // A postseason game's checkpoints reach everyone in the sport; a regular-season game's only its own audience.
  const checkpointAudience: AlertAudience = postseason ? 'broad' : 'game'
  const alerts: GameAlert[] = []

  if (sport === 'MLB' || sport === 'NCAABASE') {
    const endedInning = inningHalf(next) === 'end' ? next.period : next.period > previous.period ? previous.period : 0
    if (endedInning >= 1 && !final(next) && (next.period === endedInning || (sumThrough(next.awayLinescores, endedInning) != null && sumThrough(next.homeLinescores, endedInning) != null))) {
      alerts.push({ key: `inning:${endedInning}:end`, type: 'game_inning', audience: checkpointAudience, title: `⚾ End of the ${ordinal(endedInning)}: ${scoreThrough(next, endedInning)}`, body: next.period > endedInning ? `Heading to the ${ordinal(endedInning + 1)}.` : `${next.statusDetail}.` })
    }
  } else {
    // End-of-period checkpoints. Reached either at the break itself or on the first poll of the next period.
    const atBreak = halftime(next) || breakStatus(next) || clockSeconds(next.clock) === 0
    const ended = next.period > previous.period ? next.period - 1 : atBreak && next.period >= 1 ? next.period : 0
    if (ended > 0 && !final(next) && checkpointPeriods(sport, reg).includes(ended)) {
      const isHalf = (reg === 4 && ended === 2) || (reg === 2 && ended === 1)
      const label = isHalf ? 'Halftime' : sport === 'NHL' ? `End of the ${ordinal(ended)} period` : `End of the ${ordinal(ended)} quarter`
      // A poll may miss the break. Use line scores, or the last score from the prior period;
      // never label the later live score as the checkpoint score.
      const score = next.period > ended && (sumThrough(next.awayLinescores, ended) == null || sumThrough(next.homeLinescores, ended) == null)
        ? scoreLine(previous) : scoreThrough(next, ended)
      alerts.push({ key: isHalf ? 'halftime' : `interval:${ended}`, type: isHalf ? 'game_halftime' : 'game_period_end', audience: checkpointAudience,
        title: `${label}: ${score}`, body: `${next.statusDetail || label}.${watch(next)}` })
    }
    // Overtime is the closest game there is: everyone in the sport hears about it, once.
    const inOt = (g: GameObservation) => !final(g) && (g.period > reg || /overtime|STATUS_OVERTIME|STATUS_SHOOTOUT/i.test(`${g.status} ${g.statusDetail}`))
    if (inOt(next) && !inOt(previous) && FOOTBALL.has(sport)) {
      alerts.push({ key: 'overtime', type: 'game_close', audience: 'broad', severity: 'high', title: `⏱️ Overtime: ${scoreLine(next)}`, body: `Headed to overtime.${watch(next)}` })
    }
  }

  if (final(next) && !final(previous)) {
    alerts.push({ key: 'final', type: 'game_final', audience: checkpointAudience, title: `Final: ${scoreLine(next)}`, body: finalBody(next) })
  }

  // One broad "this one's close, here's where to watch" per game.
  if (isCloseLateGame(sport, next) && !isCloseLateGame(sport, previous) && !alerts.some(a => a.key === 'overtime')) {
    alerts.push({ key: 'close', type: 'game_close', audience: 'broad', severity: 'high', title: `🔥 Close game: ${scoreLine(next)}`, body: `${next.statusDetail}.${watch(next) || ' Tune in.'}` })
  }

  return alerts
}

function finalBody(g: GameObservation): string {
  const a = g.awayScore ?? 0, h = g.homeScore ?? 0
  if (a === h) return `${g.awayTeamFull || g.awayTeam} and ${g.homeTeamFull || g.homeTeam} finish level, ${a}–${h}.`
  const winner = a > h ? (g.awayTeamFull || g.awayTeam) : (g.homeTeamFull || g.homeTeam)
  return `${winner} win ${Math.max(a, h)}–${Math.min(a, h)}.${g.eventName && isPostseasonGame(g) ? ` ${g.eventName}.` : ''}`
}

const POSTSEASON = /\b(playoffs?|play-in|wild card|division series|championship series|ALDS|NLDS|ALCS|NLCS|world series|stanley cup|finals?|conference (semi)?finals?|super bowl|divisional|bowl|CFP|semifinal|quarterfinal|elite eight|final four|sweet 16|game \d)\b/i
export function isPostseasonGame(g: Pick<GameObservation, 'eventName'>): boolean {
  return !!g.eventName && POSTSEASON.test(g.eventName)
}

/* ── players and headshots ─────────────────────────────────────────────────── */

type Named = { id: string; name: string; headshot: string | null; group: string }

function athlete(detail: LiveGameDetail, id: string | null | undefined): Named | null {
  if (!id) return null
  const lines: GameDetailPlayerLine[] | undefined = detail.players?.[id]
  const line = lines?.[0]
  return line ? { id, name: line.name, headshot: line.headshot, group: lines.map(l => l.group).join(',') } : null
}

/** "QB Patrick Mahomes → Travis Kelce" for a football play; the skill player's headshot leads. */
function footballPlayers(detail: LiveGameDetail, text: string): { line: string; imageUrl: string | null; ids: string[] } {
  const named = athletesInPlayText(text, detail.players ?? {}, 3).map(id => athlete(detail, id)).filter((a): a is Named => !!a)
  if (!named.length) return { line: '', imageUrl: null, ids: [] }
  const qb = named.find(a => /passing/.test(a.group))
  const others = named.filter(a => a !== qb)
  const role = (a: Named) => /interceptions|defensive/.test(a.group) ? 'DEF ' : /kicking/.test(a.group) ? 'K ' : /(kick|punt)Returns/.test(a.group) ? 'RET ' : ''
  const line = qb && others.length ? `QB ${qb.name} → ${others.map(a => `${role(a)}${a.name}`).join(', ')}`
    : named.map(a => `${qb === a ? 'QB ' : role(a)}${a.name}`).join(', ')
  const lead = others[0] ?? qb ?? named[0]!
  return { line, imageUrl: lead.headshot ?? qb?.headshot ?? null, ids: named.map(a => a.id) }
}

/* ── per-play alerts ───────────────────────────────────────────────────────── */

type FootballKind = { kind: string; emoji: string; label: string }

/** What kind of football play this is, read from ESPN's type label and its play text. */
export function footballPlayKind(p: Pick<GameDetailPlay, 'type' | 'text' | 'scoring'>): FootballKind | null {
  const s = `${p.type ?? ''} ${p.text}`
  // Wiped out by a penalty ("field goal is GOOD, NULLIFIED by Penalty … - No Play"): the play never counted.
  if (/\bNULLIFIED\b|\bNo Play\b/i.test(p.text)) return null
  if (/extra point|\bPAT\b|two.?point|2.?pt|conversion/i.test(p.type ?? '')) return { kind: 'try', emoji: '🏈', label: /two.?point|2.?pt|conversion/i.test(s) ? 'Two-point try' : 'Extra point' }
  if (/field goal/i.test(s) && !/touchdown/i.test(s)) {
    if (/blocked/i.test(s)) return { kind: 'fg_blocked', emoji: '🚫', label: 'Field goal BLOCKED' }
    if (/no good|missed|is wide|failed/i.test(s) || !p.scoring && !/\bgood\b/i.test(s)) return { kind: 'fg_missed', emoji: '❌', label: 'Field goal no good' }
    return { kind: 'fg_good', emoji: '🎯', label: 'Field goal' }
  }
  if (p.scoring && /safety/i.test(s)) return { kind: 'safety', emoji: '🛡️', label: 'Safety' }
  if (p.scoring && /interception|intercepted/i.test(s)) return { kind: 'pick_six', emoji: '🛡️', label: 'Pick-six' }
  if (p.scoring && /fumble/i.test(s) && /return|recover/i.test(s)) return { kind: 'fumble_td', emoji: '🛡️', label: 'Fumble return TD' }
  if (p.scoring && /punt/i.test(s)) return { kind: 'punt_return_td', emoji: '⚡', label: 'Punt return TD' }
  if (p.scoring && /kickoff|kick return/i.test(s)) return { kind: 'kick_return_td', emoji: '⚡', label: 'Kickoff return TD' }
  if (p.scoring && /blocked/i.test(s)) return { kind: 'block_td', emoji: '⚡', label: 'Blocked kick TD' }
  if (p.scoring) return { kind: 'td', emoji: '🏈', label: 'Touchdown' }
  if (/\bsack/i.test(s)) return { kind: 'sack', emoji: '💥', label: 'Sack' }
  return null
}

/** The try result written inside a touchdown's own text: "(J.Tucker Kick)", "(... PAT failed)", "TWO-POINT ... ATTEMPT SUCCEEDS". */
function tryOutcome(text: string): { label: string; good: boolean } | null {
  const two = /two.?point|2.?pt conversion/i.test(text)
  if (two) return { label: 'Two-point try', good: /succeeds|is good|successful|\bgood\b/i.test(text) && !/fails|failed|no good/i.test(text) }
  const pat = /\(([^)]*(kick|extra point|PAT)[^)]*)\)/i.exec(text)
  if (pat) return { label: 'Extra point', good: !/no good|failed|blocked|missed/i.test(pat[1]!) }
  return null
}

const periodClock = (sport: string, period: number | null | undefined, clock: string | null | undefined) =>
  period ? `${period > (sport === 'NHL' ? 3 : 4) ? 'OT' : sport === 'NHL' ? `P${period}` : `Q${period}`}${clock ? ` ${clock}` : ''}` : ''

/** Pure: the per-play alerts this game's play feed shows, by the rules at the top of this file. */
export function gamePlayAlerts(detail: LiveGameDetail): GameAlert[] {
  const sport = detail.sport.toUpperCase()
  const out = new Map<string, GameAlert>()
  const add = (a: GameAlert) => { if (!out.has(a.key)) out.set(a.key, { audience: 'game', ...a }) }
  const abbr = { home: detail.home?.abbrev ?? 'HOME', away: detail.away?.abbrev ?? 'AWAY' }
  const score = (a: number | null | undefined, h: number | null | undefined) => a != null && h != null ? ` · ${abbr.away} ${a}, ${abbr.home} ${h}` : ''

  if (FOOTBALL.has(sport)) {
    let prev = { home: 0, away: 0 }
    for (const drive of detail.drives) for (const p of drive.plays) {
      if (!p.id || !p.text) continue
      const before = prev
      if (p.homeScore != null && p.awayScore != null) prev = { home: p.homeScore, away: p.awayScore }
      const kind = footballPlayKind(p)
      const yards = p.statYardage ?? 0
      const secs = clockSeconds(p.clock)
      const late = p.period != null && (p.period > 4 || p.period === 4 && secs != null && secs <= 120)
      // Who had the ball / who scored, and the margin from THEIR side before the snap.
      const homeScored = (p.homeScore ?? before.home) > before.home, awayScored = (p.awayScore ?? before.away) > before.away
      const offenseHome = drive.teamId != null && detail.home?.id != null ? drive.teamId === detail.home.id : null
      const side = homeScored ? 'home' : awayScored ? 'away' : offenseHome == null ? null : offenseHome ? 'home' : 'away'
      const marginBefore = side == null ? null : side === 'home' ? before.home - before.away : before.away - before.home
      const downBy = (n: number) => marginBefore != null && marginBefore <= 0 && marginBefore >= -n
      const players = footballPlayers(detail, p.text)
      const when = periodClock(sport, p.period, p.clock)
      const build = (k: FootballKind, clutch: boolean, extra = ''): GameAlert => ({
        key: `play:${p.id}`, type: k.kind === 'sack' || k.kind === 'big_play' ? 'game_big_play' : 'game_scoring_play',
        severity: clutch ? 'high' : 'medium',
        title: `${clutch ? '🚨 Clutch — ' : ''}${k.emoji} ${k.label}${score(p.awayScore, p.homeScore)}`,
        body: `${players.line ? `${players.line}\n` : ''}${p.text}${extra}${when ? ` (${when})` : ''}`,
        imageUrl: players.imageUrl, athleteIds: players.ids,
      })
      if (kind?.kind === 'try') {
        // A standalone PAT / 2-pt play: only in a late one-possession game.
        if (late && marginBefore != null && Math.abs(marginBefore) <= 7) add({ ...build(kind, true), title: `🚨 Clutch — ${kind.label} ${/no good|fail|missed|blocked/i.test(p.text) ? 'NO GOOD' : 'GOOD'}${score(p.awayScore, p.homeScore)}` })
        continue
      }
      if (kind && (kind.kind === 'fg_missed' || kind.kind === 'fg_blocked')) {
        if (late && downBy(3)) add(build(kind, true))
        continue
      }
      if (kind?.kind === 'fg_good') { add(build(kind, late && downBy(3))); continue }
      if (kind?.kind === 'sack') { add(build(kind, false, yards < 0 ? ` (${yards} yds)` : '')); continue }
      if (kind) {
        // Touchdowns and defensive / special-teams scores. Late in a one-possession game, say how the try went.
        const delta = side === 'home' ? (p.homeScore ?? 0) - before.home : side === 'away' ? (p.awayScore ?? 0) - before.away : 6
        const clutch = late && downBy(8)
        const attempt = tryOutcome(p.text)
        const tryNote = late && marginBefore != null && Math.abs(marginBefore + 6) <= 7 && attempt ? ` — ${attempt.label} ${attempt.good ? 'GOOD' : 'NO GOOD'}` : ''
        add(build(kind, clutch, delta >= 6 ? tryNote : ''))
        continue
      }
      // A punt, kickoff or penalty carries a yardage too; only a real run or catch is a "big play".
      const notAPlay = /punt|kickoff|kick ?off|penalty|timeout|end of/i.test(`${p.type ?? ''}`) || /\bpunts?\b|kicks? off|kickoff|PENALTY/i.test(p.text)
      if (yards >= 19 && !notAPlay) add(build({ kind: 'big_play', emoji: '💨', label: `${yards}-yard play` }, false))
    }
  }

  if (sport === 'NHL') {
    const plays = detail.hockey?.plays ?? []
    const goalieIds = new Set([...(detail.hockey?.box.home?.goalies ?? []), ...(detail.hockey?.box.away?.goalies ?? [])].map(g => g.athleteId))
    for (const p of plays) {
      if (!p.scoring || !p.id || !p.text) continue
      const when = periodClock(sport, p.period, p.clock)
      const scorer = athlete(detail, p.athleteIds.find(id => !goalieIds.has(id)))
      add({ key: `play:${p.id}`, type: 'game_scoring_play', severity: 'high',
        title: `🏒 ${p.period && p.period > 3 ? 'OT goal' : 'Goal'}${score(p.awayScore, p.homeScore)}`,
        body: `${scorer ? `${scorer.name} scores. ` : ''}${p.text}${when ? ` (${when})` : ''}`, imageUrl: scorer?.headshot ?? null, athleteIds: scorer ? [scorer.id] : [] })
    }
  }

  if (sport === 'SOCCER') {
    for (const p of detail.scoringPlays) if (p.id && p.text) add({ key: `play:${p.id}`, type: 'game_scoring_play', title: `⚽ Goal${score(p.awayScore, p.homeScore)}`, body: p.text })
  }
  // Baseball and basketball notify at checkpoints, close-game entry and final only.
  return [...out.values()]
}

/* ── post-game recap ───────────────────────────────────────────────────────── */

/** Box-score columns worth a line in a recap, most telling first. */
const RECAP_STATS = ['C/ATT', 'YDS', 'TD', 'INT', 'REC', 'CAR', 'SACKS', 'TOT', 'FG', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'G', 'A', 'SOG', 'SV', 'GA', 'H-AB', 'AB', 'H', 'HR', 'RBI', 'R', 'IP', 'K', 'ER']

/** "Patrick Mahomes: 22/32 C/ATT, 280 YDS, 3 TD" — one starter's day, from the box score. */
export function recapLine(detail: LiveGameDetail, athleteId: string, max = 4): string | null {
  const lines = detail.players?.[athleteId]
  if (!lines?.length) return null
  const picked: string[] = []
  for (const label of RECAP_STATS) {
    for (const line of lines) {
      const i = line.labels.indexOf(label)
      const value = i >= 0 ? line.stats[i] : undefined
      if (value == null || value === '' || value === '0' || value === '0/0' || value === '--') continue
      if (picked.some(p => p.endsWith(` ${label}`))) continue
      picked.push(`${value} ${label}`)
      break
    }
    if (picked.length >= max) break
  }
  return `${lines[0]!.name}: ${picked.length ? picked.join(', ') : 'did not record a stat'}`
}

/** One recap per person per finished game: the final, then each of their starters' lines. */
export function gameRecap(sport: string, g: GameObservation, detail: LiveGameDetail, athleteIds: string[]): GameAlert | null {
  const lines = [...new Set(athleteIds)].map(id => recapLine(detail, id)).filter((l): l is string => !!l)
  if (!lines.length) return null
  const emoji = ({ NFL: '🏈', NCAAF: '🏈', NBA: '🏀', WNBA: '🏀', NCAAB: '🏀', NHL: '🏒', MLB: '⚾', SOCCER: '⚽' } as Record<string, string>)[sport.toUpperCase()] ?? '🏁'
  return { key: 'recap', type: 'postgame_recap', audience: 'game', severity: 'medium',
    title: `${emoji} Recap — Final: ${scoreLine(g)}`,
    body: `${finalBody(g)}\nYour starters:\n${lines.map(l => `• ${l}`).join('\n')}` }
}

/* ── personal hockey scoring alerts ───────────────────────────────────────── */

/**
 * A goal or assist by a started hockey player is personalized. Baseball and basketball
 * use only the game checkpoints, close-game alert and final.
 * Each alert names `starterAthleteId`; the caller sends it only to managers starting that athlete.
 */
export function starterAlerts(detail: LiveGameDetail): GameAlert[] {
  const sport = detail.sport.toUpperCase()
  const out: GameAlert[] = []
  const abbr = { home: detail.home?.abbrev ?? 'HOME', away: detail.away?.abbrev ?? 'AWAY' }
  const score = (a: number | null | undefined, h: number | null | undefined) => a != null && h != null ? ` · ${abbr.away} ${a}, ${abbr.home} ${h}` : ''
  const mk = (id: string, key: string, title: string, body: string, extra: Partial<GameAlert> = {}): void => {
    const who = athlete(detail, id)
    if (!who) return
    out.push({ key: `starter:${key}:${id}`, type: 'game_starter_play', audience: 'game', severity: 'high', starterAthleteId: id,
      title: `⭐ Your starter ${who.name}: ${title}`, body, imageUrl: who.headshot, athleteIds: [id], ...extra })
  }
  if (sport === 'NHL') {
    const goalies = new Set([...(detail.hockey?.box.home?.goalies ?? []), ...(detail.hockey?.box.away?.goalies ?? [])].map(g => g.athleteId))
    for (const p of detail.hockey?.plays ?? []) {
      if (!p.scoring || !p.id) continue
      const skaters = p.athleteIds.filter(id => !goalies.has(id))
      const when = periodClock(sport, p.period, p.clock)
      skaters.forEach((id, i) => mk(id, p.id, i === 0 ? 'GOAL' : 'assist', `${p.text}${score(p.awayScore, p.homeScore)}${when ? ` (${when})` : ''}`))
    }
  }
  return out
}
