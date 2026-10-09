/**
 * The injury fan-out: ONE message per injured player, naming every league where he starts, the
 * backup to bring in there, and where to fix it — instead of one alert per (player, league) with
 * only the most urgent sent.
 *
 * ⚠ WHY GROUP BY PLAYER. The sweep already dedupes per player + designation + day
 * (sweepAudience.injuredStarterDedupeKey), so a manager starting one ruled-out receiver in three
 * leagues heard about ONE league and never the other two — the key said "sent". The fan-out keeps
 * that key and makes the one message cover every league it stands for.
 *
 * Pure, client-safe. The per-league facts (backup, fix link) come from injuryFanOut.ts.
 */

export type FanOutAlert = {
  title: string
  message: string
  leagueId?: string | null
  urgencySignal: number
  metadata?: Record<string, unknown> | null
}

export type FanOutLeague = {
  leagueId: string
  leagueName: string
  /** The bench player to bring in here, scored under THIS league's rules; null when none can come in. */
  startName: string | null
  /** Where to make the change — a verified platform lineup screen, or the in-app team tab. */
  fixHref: string | null
  fixLabel: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** The player an alert is about: his Sleeper id when known, else his name — never the league. */
export function playerKeyOf(a: FanOutAlert): string {
  const id = str(a.metadata?.sleeperId)
  if (id) return `id:${id}`
  const name = str(a.metadata?.playerName) ?? a.title.split(' is ')[0] ?? a.title
  return `name:${name.toLowerCase()}`
}

/** Alerts grouped per player: groups ordered by their most urgent alert, alerts within by urgency. */
export function groupAlertsByPlayer<T extends FanOutAlert>(alerts: readonly T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const a of alerts) {
    const key = playerKeyOf(a)
    const list = groups.get(key) ?? []
    list.push(a)
    groups.set(key, list)
  }
  return [...groups.values()]
    .map((g) => [...g].sort((x, y) => y.urgencySignal - x.urgencySignal))
    .sort((x, y) => y[0]!.urgencySignal - x[0]!.urgencySignal)
}

/**
 * Title and body for one player's group. With one league the detector's own title stands; with
 * several it says how many, because "is Out and still starting" about one league reads as the
 * whole story. Each league gets one line: the backup to start there, or that none can come in.
 *
 * ⚠ THE DESIGNATION IS STATED, NEVER UPGRADED. A Doubtful player is "listed Doubtful" — the words
 * are the feed's, not "ruled out" — and the swap is phrased as the move to make, not as a fact.
 */
export function fanOutCopy(group: readonly FanOutAlert[], leagues: readonly FanOutLeague[]): { title: string; body: string } {
  const top = group[0]!
  const name = str(top.metadata?.playerName) ?? top.title.split(' is ')[0] ?? 'Your starter'
  const designation = str(top.metadata?.designation) ?? 'flagged'
  const inactive = top.metadata?.inactive === true
  const minsList = group.map((a) => a.metadata?.minutesToLock).filter((m): m is number => typeof m === 'number')
  const mins = minsList.length ? Math.min(...minsList) : null
  const stale = group.some((a) => a.metadata?.stale === true)
  const n = group.length

  const title =
    n === 1
      ? top.title
      : `${name} is ${inactive ? 'inactive' : designation} — still starting in ${n} of your leagues`

  // No per-league facts (the lookup failed or timed out): say what the detector said, no more.
  if (leagues.length === 0) {
    const more = n > 1 ? ` He also starts for you in ${n - 1} other league${n - 1 === 1 ? '' : 's'}.` : ''
    return { title, body: `${top.message}${more}` }
  }

  const lead =
    (inactive ? `${name} was declared inactive` : `${name} is listed ${designation}`) +
    (mins != null ? `, ${mins} minutes to lock.` : '.')
  const lines = leagues.map((l) =>
    l.startName ? `${l.leagueName}: start ${l.startName}.` : `${l.leagueName}: no bench player can come in for him.`,
  )
  const caveat = stale ? ' This designation has not updated recently — check before acting.' : ''
  return { title, body: `${lead} ${lines.join(' ')}${caveat}` }
}

/**
 * The game-day digest (2026-10-08): ONE phone notification for EVERY flagged starter not yet told
 * about today, naming the leagues to fix — "Josh Allen (inactive): KBFL, Maye 26. Travis Kelce
 * (Out): Dynasty." — instead of one player per sweep, which on a Sunday with three starters out
 * took three sweeps and three buzzes to say one thing.
 *
 * With one player it is that player's fan-out copy, unchanged. Each line names at most
 * MAX_LEAGUES_PER_LINE leagues and then "+N more"; the whole body stops at DIGEST_BODY_MAX so a
 * lock screen shows the first players whole rather than every player cut off.
 */
export const MAX_LEAGUES_PER_LINE = 3
export const DIGEST_BODY_MAX = 240

export function digestCopy(groups: ReadonlyArray<readonly FanOutAlert[]>): { title: string; body: string } {
  const lines = groups.map((g) => {
    const top = g[0]!
    const name = str(top.metadata?.playerName) ?? top.title.split(' is ')[0] ?? 'Your starter'
    const tag = top.metadata?.inactive === true ? 'inactive' : (str(top.metadata?.designation) ?? 'flagged')
    const leagues = [...new Set(g.map((a) => str(a.metadata?.leagueName) ?? a.leagueId ?? '').filter(Boolean))]
    const shown = leagues.slice(0, MAX_LEAGUES_PER_LINE).join(', ')
    const more = leagues.length > MAX_LEAGUES_PER_LINE ? ` +${leagues.length - MAX_LEAGUES_PER_LINE} more` : ''
    return `${name} (${tag}): ${shown}${more}.`
  })
  const leagueCount = new Set(groups.flatMap((g) => g.map((a) => a.leagueId ?? str(a.metadata?.leagueName) ?? ''))).size
  const allOut = groups.every((g) => g[0]!.metadata?.inactive === true || /^out$/i.test(str(g[0]!.metadata?.designation) ?? ''))
  const n = groups.length
  const title = `${n} of your starters ${allOut ? 'are out' : 'are flagged'} — fix ${leagueCount} lineup${leagueCount === 1 ? '' : 's'}`
  let body = ''
  for (const line of lines) {
    const next = body ? `${body} ${line}` : line
    if (next.length > DIGEST_BODY_MAX) {
      // A first line too long on its own is cut, never dropped — the body is never just "…".
      body = body ? `${body} …` : `${line.slice(0, DIGEST_BODY_MAX - 1)}…`
      break
    }
    body = next
  }
  return { title, body }
}
