/**
 * Commissioner Hub — operational charts (brief item 5).
 *
 * Activity, competitive balance, waiver participation, trades, scoring and
 * manager engagement, each built from the table that actually holds it:
 *
 *   activity / trades / waivers   `decision_os_imported_activity`
 *   competitive balance           `LeagueTeam` wins + points for
 *   scoring                       `WeeklyMatchup` (provider league id space)
 *   engagement                    `getLeagueManagerHealth`
 *
 * ⚠ IMPORTED ACTIVITY IS DEDUPED HERE, AND IT HAS TO BE. The writer's key moved
 * from `League.id` to the provider league id (1a07ab229), so one event can be
 * stored under both, and the existing `readTransactionsByWeek` counts both. A
 * chart that doubles a quiet league's trades is worse than no chart.
 *
 * ⚠ WAIVER PARTICIPATION IS NOT READ FROM `WaiverClaim`. That table only holds
 * leagues created in AllFantasy — it is empty for every import — so it would
 * report a 0% participation rate for the leagues most commissioners here run.
 *
 * Client-safe: no Prisma.
 *
 * Every chart takes the reader's language (default English) and writes its title, subtitle,
 * takeaway and bar labels in it — see `pickLanguage`. Team and manager names are data and stay.
 */

import { pickLanguage } from './pickLanguage'

export type ChartBar = {
  label: string
  value: number
  display: string
  tone?: 'accent' | 'good' | 'warn' | 'bad' | 'muted'
}

export type HubChart = {
  key: 'activity' | 'trades' | 'balance' | 'waivers' | 'scoring' | 'engagement'
  title: string
  subtitle: string
  bars: ChartBar[]
  /** One line under the chart: the number the chart is there to explain. */
  takeaway: string | null
}

export type ActivityRow = {
  activityType: string
  occurredAt: Date
  /** `normalized.managerKeys`, e.g. `sleeper:123` — identity lives in the JSON. */
  managerKeys: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * One event, however many times it was stored. Type + moment + the managers in
 * it is unique in practice: two different trades between the same two people at
 * the same millisecond do not happen.
 */
export function dedupeActivity(rows: ActivityRow[]): ActivityRow[] {
  const seen = new Set<string>()
  const out: ActivityRow[] = []
  for (const r of rows) {
    const key = `${r.activityType}|${r.occurredAt.getTime()}|${[...r.managerKeys].sort().join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/**
 * Fantasy weeks turn over on Tuesday, after Monday night's game. Bucketing on
 * Tuesday keeps a Monday waiver run and the Sunday trades before it in the same
 * week, which is how a commissioner thinks about them.
 */
export function fantasyWeekStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const back = (d.getUTCDay() - 2 + 7) % 7
  return new Date(d.getTime() - back * DAY_MS)
}

function shortDate(d: Date, language = 'en'): string {
  return d.toLocaleDateString(language === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function weeklyBuckets(rows: ActivityRow[], now: Date, weeks: number): Array<{ start: Date; rows: ActivityRow[] }> {
  const newest = fantasyWeekStart(now)
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    start: new Date(newest.getTime() - (weeks - 1 - i) * 7 * DAY_MS),
    rows: [] as ActivityRow[],
  }))
  const first = buckets[0].start.getTime()
  for (const r of rows) {
    const s = fantasyWeekStart(r.occurredAt).getTime()
    if (s < first) continue
    const idx = Math.round((s - first) / (7 * DAY_MS))
    if (idx >= 0 && idx < buckets.length) buckets[idx].rows.push(r)
  }
  return buckets
}

const ACTIVITY_WEEKS = 8

export function activityChart(rows: ActivityRow[], now: Date, language = 'en'): HubChart {
  const L = pickLanguage(language)
  const buckets = weeklyBuckets(rows, now, ACTIVITY_WEEKS)
  const total = buckets.reduce((n, b) => n + b.rows.length, 0)
  const last = buckets[buckets.length - 1].rows.length
  const prior = buckets.slice(0, -1)
  const avg = prior.length ? prior.reduce((n, b) => n + b.rows.length, 0) / prior.length : 0
  return {
    key: 'activity',
    title: L('League activity', 'Actividad de la liga'),
    subtitle: L(
      `Trades, waiver claims and roster moves per week · last ${ACTIVITY_WEEKS} weeks`,
      `Intercambios, reclamos y cambios de plantilla por semana · últimas ${ACTIVITY_WEEKS} semanas`,
    ),
    bars: buckets.map((b, i) => ({
      label: shortDate(b.start, language),
      value: b.rows.length,
      display: String(b.rows.length),
      tone: i === buckets.length - 1 ? 'accent' : 'muted',
    })),
    takeaway:
      total === 0
        ? L('No moves imported in the last eight weeks.', 'No se importó ningún movimiento en las últimas ocho semanas.')
        : L(
            `${last} ${last === 1 ? 'move' : 'moves'} this week, against ${avg.toFixed(1)} a week before that.`,
            `${last} ${last === 1 ? 'movimiento' : 'movimientos'} esta semana, frente a ${avg.toFixed(1)} por semana antes.`,
          ),
  }
}

export function tradesChart(rows: ActivityRow[], now: Date, language = 'en'): HubChart {
  const L = pickLanguage(language)
  const trades = rows.filter((r) => r.activityType === 'trade')
  const buckets = weeklyBuckets(trades, now, ACTIVITY_WEEKS)
  const total = buckets.reduce((n, b) => n + b.rows.length, 0)
  return {
    key: 'trades',
    title: L('Trades', 'Intercambios'),
    subtitle: L(`Completed trades per week · last ${ACTIVITY_WEEKS} weeks`, `Intercambios cerrados por semana · últimas ${ACTIVITY_WEEKS} semanas`),
    bars: buckets.map((b) => ({
      label: shortDate(b.start, language),
      value: b.rows.length,
      display: String(b.rows.length),
      tone: b.rows.length > 0 ? 'good' : 'muted',
    })),
    takeaway:
      total === 0
        ? L('No trades in eight weeks.', 'Ningún intercambio en ocho semanas.')
        : L(`${total} ${total === 1 ? 'trade' : 'trades'} in eight weeks.`, `${total} ${total === 1 ? 'intercambio' : 'intercambios'} en ocho semanas.`),
  }
}

export type ManagerRef = { key: string; name: string }

/**
 * Waiver claims per manager this season, and how many managers made one.
 *
 * `managers` maps provider owner ids (the part after `sleeper:`) to team names.
 * A key with no mapping is still counted in the total but not named — a claim
 * by a manager who has since left is real activity, just not attributable.
 */
export function waiverParticipationChart(rows: ActivityRow[], managers: ManagerRef[], language = 'en'): HubChart {
  const L = pickLanguage(language)
  const byKey = new Map(managers.map((m) => [m.key, m.name]))
  const counts = new Map<string, number>()
  let claims = 0
  for (const r of rows) {
    if (r.activityType !== 'waiver') continue
    claims += 1
    for (const raw of r.managerKeys) {
      const key = raw.replace(/^[a-z]+:/, '')
      const name = byKey.get(key)
      if (!name) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  const bars: ChartBar[] = managers
    .map((m) => ({ label: m.name, value: counts.get(m.name) ?? 0 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .map((b) => ({ ...b, display: String(b.value), tone: b.value === 0 ? 'warn' : 'accent' }))
  const participating = bars.filter((b) => b.value > 0).length
  return {
    key: 'waivers',
    title: L('Waiver participation', 'Participación en agentes libres'),
    subtitle: L('Waiver claims by manager · this season', 'Reclamos por mánager · esta temporada'),
    bars,
    takeaway:
      managers.length === 0
        ? null
        : L(
            `${participating} of ${managers.length} managers have made a claim${claims > 0 ? ` · ${claims} claims in all` : ''}.`,
            `${participating} de ${managers.length} mánagers han hecho un reclamo${claims > 0 ? ` · ${claims} reclamos en total` : ''}.`,
          ),
  }
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length)
}

export type BalanceTeam = { name: string; wins: number; losses: number; ties: number; pointsFor: number }

/**
 * Competitive balance from the standings.
 *
 * The bars are points for, because wins alone in week 3 are mostly schedule
 * luck. The takeaway states the spread two ways a commissioner can reason about:
 * the gap between the best and worst scoring teams, and how spread out the win
 * totals are. There is deliberately no single "parity score" — nothing in this
 * repo defines one, and inventing a 0–100 number would be a claim with no
 * calibration behind it.
 */
export function balanceChart(teams: BalanceTeam[], language = 'en'): HubChart | null {
  const L = pickLanguage(language)
  const played = teams.filter((t) => t.wins + t.losses + t.ties > 0 || t.pointsFor > 0)
  if (played.length < 2) return null
  const sorted = [...played].sort((a, b) => b.pointsFor - a.pointsFor)
  const top = sorted[0].pointsFor
  const bottom = sorted[sorted.length - 1].pointsFor
  const winsSd = stdDev(played.map((t) => t.wins))
  const games = Math.max(...played.map((t) => t.wins + t.losses + t.ties))
  return {
    key: 'balance',
    title: L('Competitive balance', 'Equilibrio competitivo'),
    subtitle: L('Points for by team, with record', 'Puntos a favor por equipo, con su récord'),
    bars: sorted.map((t, i) => ({
      label: t.name,
      value: Math.round(t.pointsFor),
      display: `${Math.round(t.pointsFor).toLocaleString('en-US')} · ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
      tone: i === 0 ? 'good' : i === sorted.length - 1 ? 'warn' : 'accent',
    })),
    takeaway:
      games === 0
        ? null
        : L(
            `${Math.round(top - bottom).toLocaleString('en-US')} points separate the top and bottom scorers; win totals vary by ±${winsSd.toFixed(1)} over ${games} ${games === 1 ? 'game' : 'games'}.`,
            `${Math.round(top - bottom).toLocaleString('en-US')} puntos separan al que más anota del que menos; las victorias varían ±${winsSd.toFixed(1)} en ${games} ${games === 1 ? 'partido' : 'partidos'}.`,
          ),
  }
}

export type ScoringRow = { week: number; pointsFor: number; pointsAgainst: number; matchupId: number | null }

/** A 0–0 row is a scheduled week nobody has played — never a real score. */
export function isPlayed(r: { pointsFor: number; pointsAgainst: number }): boolean {
  return r.pointsFor > 0 || r.pointsAgainst > 0
}

export function scoringChart(
  rows: ScoringRow[],
  progress?: { currentWeek: number | null; complete: boolean },
  language = 'en',
): HubChart | null {
  const L = pickLanguage(language)
  const certified = progress?.complete === true || progress?.currentWeek != null
  const byWeek = new Map<number, number[]>()
  for (const r of rows) {
    if (progress?.currentWeek != null && !progress.complete && r.week >= progress.currentWeek) continue
    if (!certified && !isPlayed(r)) continue
    const list = byWeek.get(r.week) ?? []
    list.push(r.pointsFor)
    byWeek.set(r.week, list)
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b).slice(-10)
  if (weeks.length === 0) return null
  const bars: ChartBar[] = weeks.map((w) => {
    const pts = byWeek.get(w) as number[]
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length
    return {
      label: L(`Wk ${w}`, `Sem ${w}`),
      value: Math.round(avg * 10) / 10,
      display: L(`${avg.toFixed(1)} avg · ${Math.max(...pts).toFixed(1)} high`, `${avg.toFixed(1)} media · ${Math.max(...pts).toFixed(1)} máx.`),
      tone: 'accent',
    }
  })
  const latest = byWeek.get(weeks[weeks.length - 1]) as number[]
  return {
    key: 'scoring',
    title: L('Scoring', 'Puntuación'),
    subtitle: certified ? L('Average team score per completed week', 'Puntuación media por equipo en cada semana completada') : L('Recorded weekly scores · may include a week in progress', 'Puntuaciones semanales registradas · puede incluir una semana en curso'),
    bars,
    takeaway: L(
      `Week ${weeks[weeks.length - 1]}: high ${Math.max(...latest).toFixed(1)}, low ${Math.min(...latest).toFixed(1)}.`,
      `Semana ${weeks[weeks.length - 1]}: máximo ${Math.max(...latest).toFixed(1)}, mínimo ${Math.min(...latest).toFixed(1)}.`,
    ),
  }
}

export function engagementChart(
  managers: Array<{ status: 'active' | 'at_risk' | 'inactive' | 'unknown' }>,
  language = 'en',
): HubChart | null {
  const L = pickLanguage(language)
  if (managers.length === 0) return null
  const count = (s: string) => managers.filter((m) => m.status === s).length
  const active = count('active')
  const atRisk = count('at_risk')
  const inactive = count('inactive')
  const unknown = count('unknown')
  const bars: ChartBar[] = [
    { label: L('Active', 'Activos'), value: active, display: String(active), tone: 'good' },
    { label: L('Slowing down', 'Bajando el ritmo'), value: atRisk, display: String(atRisk), tone: 'warn' },
    { label: L('Inactive', 'Inactivos'), value: inactive, display: String(inactive), tone: 'bad' },
  ]
  if (unknown > 0) bars.push({ label: L('Can’t tell', 'No se sabe'), value: unknown, display: String(unknown), tone: 'muted' })
  return {
    key: 'engagement',
    title: L('Manager engagement', 'Participación de los mánagers'),
    subtitle: L('Active vs. inactive managers · 14-day window', 'Mánagers activos e inactivos · últimos 14 días'),
    bars,
    takeaway: L(`${active} of ${managers.length} managers are active.`, `${active} de ${managers.length} mánagers están activos.`),
  }
}
