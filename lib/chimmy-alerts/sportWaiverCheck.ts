import type { WaiverPlayer, WaiverSportSection } from '@/lib/core-app/waiversBoard'
import { renderDigestEmail } from '@/lib/notifications/designedEmail'
import { knownDailySportSeasons, resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'
import { isPerGameBasis, waiverSportLabel, waiverSportPlan, type WaiverValueBasis } from '@/lib/waivers/waiverSportBasis'
import { chimmyChatHref, pushSetupEmailLine, type ProactiveFrom } from './proactiveLinks'
import { waiverBoardHref, waiverCheckPrompt } from './waiverCheck'
import {
  SPORT_WAIVER_ALERT_MAX_PICKS,
  SPORT_WAIVER_ALERT_REPEAT_QUIET_DAYS,
  type SportWaiverAlertRule,
} from './waiverAlertRules'

/**
 * CHIMMY'S WAIVER CHECK FOR EVERY SPORT BUT THE NFL — the pure half (the runner is
 * `runSportWaiverCheck.ts`, the rules are `waiverAlertRules.ts`).
 *
 * Same idea as the NFL's Tuesday message (`waiverCheck.ts`): the best player nobody in the league
 * rosters, against the weakest bench player we can price, only when the swap is worth a claim —
 * from the /core Waivers board's own sport sections, so every figure is one that screen shows.
 *
 * ── 🛑 PER GAME, NEVER "THIS WEEK" ─────────────────────────────────────────────────────────────
 * A section's figures are season per-game rates (see `waiverSportBasis.ts`). An NBA team can play
 * two games in a week or four; the rate knows nothing about it. So every number this module
 * prints is "pts per game" / "pts/game", and nothing here names a week.
 *
 * ── 🛑 ONLY AN `ok` SECTION WITH A PRODUCER ────────────────────────────────────────────────────
 * `no_producer` (soccer) and `no_projections` sections have no rows worth a message, and a sport
 * whose plan is not `per_game` never alerts even if a section somehow carried rows.
 */

/* ── US Eastern clock ─────────────────────────────────────────────────────────────────────────── */

const EASTERN = 'America/New_York'
const DAY_MS = 86_400_000

const easternFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type EasternClock = {
  /** `YYYY-MM-DD`, the Eastern calendar day. */
  day: string
  year: number
  /** 0–23. */
  hour: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
}

/** The US Eastern day, hour and weekday of an instant — DST-correct via the tz database. */
export function easternClock(at: Date): EasternClock {
  const p = Object.fromEntries(easternFmt.formatToParts(at).map((x) => [x.type, x.value]))
  const hour = Number(p.hour) % 24
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    year: Number(p.year),
    hour,
    weekday: WEEKDAYS.indexOf(String(p.weekday)),
  }
}

/** `YYYY-MM-DD` minus `n` calendar days. */
export function dayBefore(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - n * DAY_MS).toISOString().slice(0, 10)
}

/* ── Is the sport in season, and which League.season is it ────────────────────────────────────── */

/**
 * The `League.season` whose leagues this sport's alert may talk about today, or null when the sport
 * is out of season. `regular_season_games` sports are finally decided by the schedule read (a
 * regular-season game in the lookahead) — see `sportWaiverWindow`.
 */
export function sportAlertSeason(rule: SportWaiverAlertRule, now: Date): number | null {
  if (rule.season.kind === 'regular_season_games') return easternClock(now).year
  const t = now.getTime()
  let best: number | null = null
  for (const year of knownDailySportSeasons(rule.sport)) {
    const opener = resolveDailySportSeasonStart(rule.sport, year)
    const start = opener ? Date.parse(opener) : NaN
    if (!Number.isFinite(start)) continue
    if (t >= start && t < start + rule.season.regularSeasonDays * DAY_MS && (best == null || year > best)) best = year
  }
  return best
}

/* ── When ─────────────────────────────────────────────────────────────────────────────────────── */

export type SportWaiverWindow = 'open' | 'not_today' | 'no_games' | 'early' | 'closed'

/**
 * Whether this sport's window is open now, given the sport's games from the schedule read.
 *
 * Daily: the Eastern day must hold a game. Weekly: it must be the rule's weekday, with a game in
 * the next `lookaheadDays` days (the loader reads regular-season games only for that kind). Then the
 * Eastern hour must sit inside [opensAtHourEt, closesAtHourEt), and now must be at least
 * `closesBeforeFirstGameMs` before the first of those games.
 */
export function sportWaiverWindow(
  rule: SportWaiverAlertRule,
  args: { now: Date; games: ReadonlyArray<{ startTime: Date | null }> },
): SportWaiverWindow {
  const clock = easternClock(args.now)
  const nowMs = args.now.getTime()
  if (rule.cadence.kind === 'weekly' && clock.weekday !== rule.cadence.weekdayEt) return 'not_today'

  const lookaheadMs = (rule.season.kind === 'regular_season_games' ? rule.season.lookaheadDays : 7) * DAY_MS
  let first: number | null = null
  for (const g of args.games) {
    const t = g.startTime?.getTime()
    if (t == null || !Number.isFinite(t)) continue
    const counts =
      rule.cadence.kind === 'daily'
        ? easternClock(g.startTime!).day === clock.day
        : t >= nowMs && t < nowMs + lookaheadMs
    if (!counts) continue
    if (first == null || t < first) first = t
  }
  if (first == null) return 'no_games'
  if (clock.hour < rule.opensAtHourEt) return 'early'
  if (clock.hour >= rule.closesAtHourEt) return 'closed'
  if (nowMs > first - rule.closesBeforeFirstGameMs) return 'closed'
  return 'open'
}

/* ── What ─────────────────────────────────────────────────────────────────────────────────────── */

export type SportWaiverPick = {
  sport: string
  basis: WaiverValueBasis
  leagueId: string
  leagueName: string
  add: WaiverPlayer
  drop: WaiverPlayer
  /** Points PER GAME, in the section's units. */
  netGain: number
  faabRemaining: number | null
}

/** One section's rows worth a message: `ok`, per game, a priced drop, at or over the rule's bar. */
export function selectSportWaiverPicks(
  section: WaiverSportSection,
  rule: SportWaiverAlertRule,
  allowedLeagueIds: ReadonlySet<string>,
): SportWaiverPick[] {
  if (section.sport !== rule.sport) return []
  if (section.state !== 'ok') return []
  if (waiverSportPlan(section.sport).kind !== 'per_game') return []
  const basis = section.basis
  if (!basis || !isPerGameBasis(basis)) return []
  return section.rows
    .filter(
      (r) =>
        allowedLeagueIds.has(r.leagueId) &&
        r.drop != null &&
        Number.isFinite(r.netGain) &&
        r.netGain >= rule.minGainPerGame,
    )
    .sort((a, b) => b.netGain - a.netGain || (a.leagueId < b.leagueId ? -1 : 1))
    .map((r) => ({
      sport: section.sport,
      basis,
      leagueId: r.leagueId,
      leagueName: r.leagueName,
      add: r.add,
      drop: r.drop!,
      netGain: r.netGain,
      faabRemaining: r.faabRemaining,
    }))
}

/** What "the same pick" means for the repeat rule: same sport, league, add and drop. */
export function sportPickSignature(p: Pick<SportWaiverPick, 'sport' | 'leagueId' | 'add' | 'drop'>): string {
  return `${p.sport}:${p.leagueId}:${p.add.playerId}:${p.drop.playerId}`
}

/**
 * The picks for one message: repeats dropped, then taken round-robin across sports — best of each
 * sport, then the second best of each — so one busy sport cannot crowd another out of the message.
 * Per-game gains in different sports are never compared with each other.
 */
export function combineSportPicks(
  bySport: ReadonlyArray<SportWaiverPick[]>,
  recentlyNamed: ReadonlySet<string> = new Set(),
  max: number = SPORT_WAIVER_ALERT_MAX_PICKS,
): SportWaiverPick[] {
  const lists = bySport.map((l) => l.filter((p) => !recentlyNamed.has(sportPickSignature(p))))
  const out: SportWaiverPick[] = []
  for (let i = 0; out.length < max; i++) {
    let any = false
    for (const l of lists) {
      if (i < l.length) {
        any = true
        if (out.length < max) out.push(l[i]!)
      }
    }
    if (!any) break
  }
  return out
}

/* ── Where it lands ───────────────────────────────────────────────────────────────────────────── */

/**
 * `chimmy-waiver-check:sports:<YYYY-MM-DD>` — one per user per Eastern day across every sport here;
 * the dispatcher appends `:<userId>`. Never collides with the NFL's `…:<season>-w<week>`.
 */
export function sportWaiverCheckDedupeKey(easternDay: string): string {
  return `chimmy-waiver-check:sports:${easternDay}`
}

/** The claim keys of the previous `days` Eastern days, for the repeat rule. */
export function recentSportWaiverClaimKeys(
  easternDay: string,
  userId: string,
  days: number = SPORT_WAIVER_ALERT_REPEAT_QUIET_DAYS,
): string[] {
  const out: string[] = []
  for (let n = 1; n <= days; n++) out.push(`${sportWaiverCheckDedupeKey(dayBefore(easternDay, n))}:${userId}`)
  return out
}

export function sportWaiverCheckHref(p: SportWaiverPick, from: ProactiveFrom = 'waiver_check'): string {
  return chimmyChatHref({ prompt: waiverCheckPrompt(p), leagueId: p.leagueId, from, sport: p.sport })
}

/* ── What it says ─────────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toFixed(1)

function who(p: WaiverPlayer): string {
  const bits = [p.position, p.team].filter(Boolean).join(', ')
  return bits ? `${p.name} (${bits})` : p.name
}

function shortName(name: string): string {
  const t = name.trim() || 'your league'
  return t.length > 32 ? `${t.slice(0, 31)}…` : t
}

/** "NBA", but "college basketball" mid-sentence. */
function sportInSentence(sport: string): string {
  const label = waiverSportLabel(sport)
  return label === label.toUpperCase() ? label : label.toLowerCase()
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** What the per-game figure was priced on, briefly. */
export function sportBasisPhrase(p: Pick<SportWaiverPick, 'sport' | 'basis'>): string {
  return p.basis === 'season_per_game_league'
    ? "under this league's scoring"
    : `on AllFantasy's default ${sportInSentence(p.sport)} scoring`
}

/** "add X (C, BOS), drop Y — +4.3 pts per game · $57 FAAB left." */
export function describeSportPick(p: SportWaiverPick): string {
  const faab = p.faabRemaining != null ? ` · $${p.faabRemaining} FAAB left` : ''
  return `add ${who(p.add)}, drop ${p.drop.name} — +${fmt(p.netGain)} pts per game${faab}.`
}

export type SportWaiverCheckMessage = {
  title: string
  body: string
  actionHref: string
  email: { subject: string; html: string }
}

const BODY_MAX = 300

export function renderSportWaiverCheck(
  picks: readonly SportWaiverPick[],
  opts: { baseUrl?: string | null } = {},
): SportWaiverCheckMessage | null {
  if (picks.length === 0) return null
  const top = picks[0]!
  const sports = [...new Set(picks.map((p) => p.sport))]

  const title =
    picks.length === 1
      ? `Chimmy's ${waiverSportLabel(top.sport)} waiver pick for ${shortName(top.leagueName)}: ${top.add.name} (+${fmt(top.netGain)} pts/game)`
      : `Chimmy's waiver picks: ${picks.length} upgrades across your ${joinAnd(sports.map(sportInSentence))} leagues`

  let body = picks
    .map((p) => `${shortName(p.leagueName)} (${waiverSportLabel(p.sport)}): ${describeSportPick(p)}`)
    .join('\n')
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1).trimEnd()}…`

  const base = opts.baseUrl ?? ''
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(`${base}${href}`)}" style="color:#ffffff;font-weight:700;text-decoration:underline">${escapeHtml(label)}</a>`

  const blocks = picks
    .map((p) => {
      const faab = p.faabRemaining != null ? ` · $${p.faabRemaining} FAAB left` : ''
      return `<div style="margin:0 0 16px 0">
  <div style="font-size:15px;font-weight:800;color:#ffffff;margin:0 0 6px 0">${escapeHtml(p.leagueName.trim() || 'Your league')} · ${escapeHtml(waiverSportLabel(p.sport))}</div>
  <div style="margin:0 0 4px 0;color:#d4d4d8">Add <strong style="color:#ffffff">${escapeHtml(who(p.add))}</strong> — ${fmt(p.add.projected)} pts/game</div>
  <div style="margin:0 0 4px 0;color:#d4d4d8">Drop ${escapeHtml(who(p.drop))} — ${fmt(p.drop.projected)} pts/game</div>
  <div style="margin:0 0 6px 0;color:#a1a1aa">+${fmt(p.netGain)} pts per game ${escapeHtml(sportBasisPhrase(p))}${escapeHtml(faab)}</div>
  <div>${link(sportWaiverCheckHref(p, 'waiver_check_email'), 'Ask Chimmy about this move →')} &nbsp; ${link(waiverBoardHref(p.leagueId), 'See the whole wire')}</div>
</div>`
    })
    .join('')

  const html = renderDigestEmail({
    eyebrow: `Chimmy · ${joinAnd(sports.map(waiverSportLabel))} waiver check`,
    title: picks.length === 1 ? 'One pickup worth a claim' : `${picks.length} pickups worth a claim`,
    sub:
      "The best player nobody rosters in each league, against your weakest bench player we can price. Every figure is points per game from AllFantasy's season projection — a season rate, which doesn't know how many games each team has coming up. Rosters as of the last sync, and unrostered isn't always claimable: if he's gone, ask me for the next one.",
    bodyHtml: blocks + pushSetupEmailLine(escapeHtml(base)),
    cta: { href: `${base}${sportWaiverCheckHref(top, 'waiver_check_email')}`, label: 'Ask Chimmy' },
    baseUrl: opts.baseUrl ?? null,
  })

  return { title, body, actionHref: sportWaiverCheckHref(top), email: { subject: title, html } }
}
