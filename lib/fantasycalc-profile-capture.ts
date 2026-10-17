import type { FantasyCalcPlayer, FantasyCalcSettings } from '@/lib/fantasycalc'

/**
 * ONE LEAGUE PROFILE'S FANTASYCALC BOARD, AS IT STOOD ON ONE UTC DAY. PURE: the key and the payload
 * format, shared by the writer (`lib/fantasycalc-db.ts`, from `/api/cron/fantasycalc-warm`) and the
 * reader (`lib/decision-os/trade/datedMarket.ts`). Nothing here reads, writes or fetches.
 *
 * WHY (2026-10-04, owner's request): a completed trade graded more than a day after it happened is
 * priced on a dated capture. Until now the only one was `PlayerValueSnapshot`, FantasyCalc's generic
 * 12-team PPR-1 book — close to a league's own board, not identical: the first dry run flipped 13
 * same-day letters at the grade boundaries. This stores each profile the leagues actually use (the
 * `fantasycalc:values:` rows the warm cron keeps fresh) once a day, so later grading prices on the
 * league's OWN book.
 *
 * ── STORAGE ───────────────────────────────────────────────────────────────────────────────────
 *
 * One `SportsDataCache` row per profile per UTC day — no migration. `PlayerValueSnapshot` was the
 * other option and needs one: its unique key has no team count or PPR, and ~73 profiles × ~300 rows a
 * day is ~8M rows a year on a Postgres with an OOM history.
 *
 *   key  `fantasycalc:profile-capture:v1:<values cache key>:<YYYY-MM-DD>`
 *
 * 🛑 THE PREFIX IS DELIBERATELY NOT `fantasycalc:values:`. Every reader of that family
 * (`listCachedFantasyCalcProfiles` — the warm list — `readCachedFantasyCalcIdentities`, the cache
 * health route) matches it with `startsWith`, and a capture row under it would be warmed, counted
 * and identity-scanned as a live profile. And it is on NEITHER purge allow-list in
 * `lib/enrichment-cache.ts` (`purgeExpiredCache` touches only listed families); the purge test's
 * `KEEP_EXPIRED_FAMILIES` names it, so a later allow-list entry that would sweep it fails there.
 *
 * ── PAYLOAD ───────────────────────────────────────────────────────────────────────────────────
 *
 * Columnar, because a row repeated as an object per player is most of the bytes. Kept per player:
 * every field the trade pricer reads off a board row — `pricePlayer` (value, position, age,
 * redraftValue for impact and VORP, positionRank, the moving std-dev pair for volatility),
 * `findPlayerByName` (name, team), `computePlayerVorpEngine` (redraftValue across the board) — plus
 * rank, trend and trade frequency, which `PlayerValueSnapshot` also keeps. Dropped: the other
 * platforms' ids, birthday, height, weight, college, owner, tier, ADP and the derived differences,
 * none of which a grade reads. Pick rows are kept WHOLE, at their own index in the board — `livePickValue`
 * reads them by name, and the rebuilt board is in the order it was captured.
 */

export const PROFILE_CAPTURE_PREFIX = 'fantasycalc:profile-capture:v1:'

/** The values-cache key format. The ONE implementation — `lib/fantasycalc-db.ts` re-exports it. */
export function buildFantasyCalcCacheKey(settings: FantasyCalcSettings): string {
  return `fantasycalc:values:dynasty:${settings.isDynasty ? '1' : '0'}:qbs:${settings.numQbs}:teams:${settings.numTeams}:ppr:${settings.ppr}`
}

/**
 * The FantasyCalc profile a league's trade chart is requested with — dynasty, QBs, team count,
 * reception weight. ONE rule: `resolveLeagueTradeChart` fetches today's board with it, and the
 * completed-trade grade looks up that same profile's dated capture with it
 * (`createLeagueTradeGrader` → `profile`), so the capture a trade is priced on is the board this
 * league's chart would request today.
 */
export function fantasyCalcSettingsForChart(chart: {
  chartIsDynasty: boolean
  isSuperFlex: boolean
  leagueSize: number
  pprNfl: 0 | 0.5 | 1
}): FantasyCalcSettings {
  return { isDynasty: chart.chartIsDynasty, numQbs: chart.isSuperFlex ? 2 : 1, numTeams: chart.leagueSize, ppr: chart.pprNfl }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The UTC day (YYYY-MM-DD) a capture taken at `at` belongs to. */
export function profileCaptureDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/** Every capture of one profile starts with this; append the day for one capture. */
export function profileCaptureKeyPrefix(settings: FantasyCalcSettings): string {
  return `${PROFILE_CAPTURE_PREFIX}${buildFantasyCalcCacheKey(settings)}:`
}

export function profileCaptureKey(settings: FantasyCalcSettings, day: string): string {
  return `${profileCaptureKeyPrefix(settings)}${day}`
}

/** The day a capture key belongs to, or null when the key is not a capture of this profile. */
export function profileCaptureDayOfKey(settings: FantasyCalcSettings, key: string): string | null {
  const prefix = profileCaptureKeyPrefix(settings)
  if (!key.startsWith(prefix)) return null
  const day = key.slice(prefix.length)
  return DAY_RE.test(day) ? day : null
}

/**
 * A capture never expires, and nothing reads it as a cache: the row's `expiresAt` is a far-future
 * sentinel so a reader that does filter on it (`expiresAt > now`) still sees the row.
 */
export const PROFILE_CAPTURE_EXPIRES_AT = new Date('9999-12-31T00:00:00.000Z')

/** The per-player columns, in stored order. Changing them is a new version (`v`), never an edit. */
export const PROFILE_CAPTURE_FIELDS = [
  'sleeperId',
  'name',
  'position',
  'team',
  'age',
  'value',
  'overallRank',
  'positionRank',
  'redraftValue',
  'trend30Day',
  'stdDev',
  'stdDevPerc',
  'tradeFrequency',
] as const

type Cell = string | number | null

export type FantasyCalcProfileCaptureV1 = {
  v: 1
  /** The `fantasycalc:values:` key this board was read from. */
  profileKey: string
  profile: FantasyCalcSettings
  /** When the board was read from FantasyCalc (ISO) — the capture's real time, not its day stamp. */
  capturedAt: string
  fields: readonly string[]
  rows: Cell[][]
  /** Pick rows, whole, with their index in the original board. */
  picks: Array<{ at: number; row: FantasyCalcPlayer }>
}

const isPick = (p: FantasyCalcPlayer) => String(p?.player?.position ?? '').toUpperCase() === 'PICK'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Pack a live board for storage. */
export function packProfileCapture(
  settings: FantasyCalcSettings,
  players: ReadonlyArray<FantasyCalcPlayer>,
  capturedAt: Date,
): FantasyCalcProfileCaptureV1 {
  const rows: Cell[][] = []
  const picks: Array<{ at: number; row: FantasyCalcPlayer }> = []
  players.forEach((p, at) => {
    if (isPick(p)) {
      picks.push({ at, row: p })
      return
    }
    rows.push([
      str(p.player?.sleeperId),
      str(p.player?.name),
      str(p.player?.position),
      str(p.player?.maybeTeam),
      num(p.player?.maybeAge),
      num(p.value),
      num(p.overallRank),
      num(p.positionRank),
      num(p.redraftValue),
      num(p.trend30Day),
      num(p.maybeMovingStandardDeviation),
      num(p.maybeMovingStandardDeviationPerc),
      num(p.maybeTradeFrequency),
    ])
  })
  return {
    v: 1,
    profileKey: buildFantasyCalcCacheKey(settings),
    profile: { isDynasty: settings.isDynasty, numQbs: settings.numQbs, numTeams: settings.numTeams, ppr: settings.ppr },
    capturedAt: capturedAt.toISOString(),
    fields: PROFILE_CAPTURE_FIELDS,
    rows,
    picks,
  }
}

/** A stored capture, validated; null for anything else (a different version, a damaged row). */
export function parseProfileCapture(data: unknown): FantasyCalcProfileCaptureV1 | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const c = data as Partial<FantasyCalcProfileCaptureV1>
  if (c.v !== 1 || typeof c.profileKey !== 'string' || typeof c.capturedAt !== 'string') return null
  if (!Number.isFinite(Date.parse(c.capturedAt))) return null
  if (!c.profile || typeof c.profile !== 'object') return null
  if (!Array.isArray(c.rows) || !Array.isArray(c.picks) || !Array.isArray(c.fields)) return null
  if (c.fields.length !== PROFILE_CAPTURE_FIELDS.length || c.fields.some((f, i) => f !== PROFILE_CAPTURE_FIELDS[i])) return null
  return c as FantasyCalcProfileCaptureV1
}

/** Rebuild the board in the chart's shape. Fields never stored are null/0/'' (as `fantasyCalcPlayerFromSnapshot`). */
export function unpackProfileCapture(c: FantasyCalcProfileCaptureV1): FantasyCalcPlayer[] {
  const players: FantasyCalcPlayer[] = c.rows.map((r) => ({
    player: {
      id: 0,
      name: String(r[1] ?? ''),
      mflId: '',
      sleeperId: String(r[0] ?? ''),
      position: String(r[2] ?? ''),
      maybeBirthday: null,
      maybeHeight: null,
      maybeWeight: null,
      maybeCollege: null,
      maybeTeam: r[3] == null ? null : String(r[3]),
      maybeAge: num(r[4]),
      maybeYoe: null,
      espnId: null,
      fleaflickerId: null,
    },
    value: num(r[5]) ?? 0,
    overallRank: num(r[6]) ?? 0,
    positionRank: num(r[7]) ?? 0,
    trend30Day: num(r[9]) ?? 0,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: num(r[8]) ?? 0,
    combinedValue: 0,
    maybeMovingStandardDeviation: num(r[10]),
    maybeMovingStandardDeviationPerc: num(r[11]),
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: false,
    maybeOwner: null,
    starter: false,
    maybeTier: null,
    maybeAdp: null,
    maybeTradeFrequency: num(r[12]),
  }))
  // Back into their places, in board order, so the rebuilt board reads in the order it was captured.
  for (const { at, row } of [...c.picks].sort((a, b) => a.at - b.at)) players.splice(Math.min(at, players.length), 0, row)
  return players
}
