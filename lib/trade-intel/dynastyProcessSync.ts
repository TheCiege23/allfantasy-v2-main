import 'server-only'

import { prisma } from '@/lib/prisma'
import { parseCsv } from '@/lib/trade-intel/csv'

/**
 * dynastyProcessSync — live DynastyProcess values, keyed by Sleeper id.
 *
 * DynastyProcess publishes free daily value files derived from FantasyPros
 * expert consensus. That derivation is independent of FantasyCalc (which is
 * built from real user-submitted trades), which is precisely what makes the two
 * worth blending — see afValue.ts.
 *
 * The repo already parsed this exact schema in lib/player-values-csv.ts, but
 * from data/player-values.csv: a committed snapshot frozen at 2026-01-30 while
 * the upstream file updates daily. This reads the live file instead.
 *
 * The join is the fiddly part. DynastyProcess keys players by FantasyPros id;
 * everything else here keys by Sleeper id. Rather than match on names — which
 * breaks on suffixes, initials and punctuation exactly where it matters most —
 * we use the crosswalk DynastyProcess publishes alongside the values.
 *
 * Only the joined result is cached. The crosswalk is ~2.6MB and there is no
 * reason to keep it once the ids are resolved.
 */

const VALUES_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv'
const IDS_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
const CACHE_PREFIX = 'dynastyprocess:values:v1:'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

export type DynastyProcessValues = {
  version: 1
  fetchedAt: string
  /** Upstream scrape date — the age of the opinion, not of our fetch. */
  scrapeDate: string | null
  numQbs: 1 | 2
  /** Player value keyed by Sleeper id, in DynastyProcess units. */
  bySleeperId: Record<string, number>
  /**
   * Round-average pick value keyed `${season}:${round}`, in DynastyProcess units.
   *
   * NOT yet blended into AF Value — picks are priced from FantasyCalc alone.
   * Blending them needs a separate scale fit, because picks are not part of the
   * player rank ordering the blend uses, and guessing that fit would be exactly
   * the kind of invented number this module avoids. Collected now so the
   * follow-up has the data without another integration.
   */
  pickByRound: Record<string, number>
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** "2026 Pick 1.01" / "2026 Pick 2.05" -> { season, round }. */
function parsePickRound(name: string): { season: string; round: number } | null {
  const m = name.match(/^(\d{4})\s+Pick\s+(\d+)\.(\d+)$/i)
  if (m) return { season: m[1]!, round: Number(m[2]) }
  const r = name.match(/^(\d{4})\s+(?:Round\s+(\d+)|(\d)(?:st|nd|rd|th))$/i)
  if (r) {
    const round = Number(r[2] ?? r[3])
    return Number.isFinite(round) ? { season: r[1]!, round } : null
  }
  return null
}

async function build(numQbs: 1 | 2): Promise<DynastyProcessValues | null> {
  const [valuesText, idsText] = await Promise.all([fetchText(VALUES_URL), fetchText(IDS_URL)])
  if (!valuesText || !idsText) return null

  const valueColumn = numQbs === 2 ? 'value_2qb' : 'value_1qb'

  // fantasypros_id -> sleeper_id. "NA" is DynastyProcess's null.
  const sleeperByFpId = new Map<string, string>()
  for (const row of parseCsv(idsText)) {
    const fp = row.fantasypros_id
    const sleeper = row.sleeper_id
    if (!fp || !sleeper || fp === 'NA' || sleeper === 'NA') continue
    sleeperByFpId.set(fp, sleeper)
  }
  if (sleeperByFpId.size === 0) return null

  const bySleeperId: Record<string, number> = {}
  const pickAcc = new Map<string, number[]>()
  let scrapeDate: string | null = null

  for (const row of parseCsv(valuesText)) {
    const value = Number(row[valueColumn])
    if (!Number.isFinite(value) || value <= 0) continue
    scrapeDate ??= row.scrape_date || null

    if ((row.pos ?? '').toUpperCase() === 'PICK') {
      const parsed = parsePickRound(row.player ?? '')
      if (!parsed) continue
      const key = `${parsed.season}:${parsed.round}`
      const list = pickAcc.get(key) ?? []
      list.push(value)
      pickAcc.set(key, list)
      continue
    }

    const sleeperId = row.fp_id ? sleeperByFpId.get(row.fp_id) : undefined
    // A player we cannot resolve to a Sleeper id is dropped rather than
    // name-matched: a wrong join would silently attach one player's value to
    // another, which is worse than having no second opinion for him.
    if (!sleeperId) continue
    bySleeperId[sleeperId] = value
  }

  if (Object.keys(bySleeperId).length === 0) return null

  const pickByRound: Record<string, number> = {}
  for (const [key, list] of pickAcc) {
    pickByRound[key] = Math.round(list.reduce((a, b) => a + b, 0) / list.length)
  }

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    scrapeDate,
    numQbs,
    bySleeperId,
    pickByRound,
  }
}

/**
 * Cached DynastyProcess values. Returns a stale cached payload rather than null
 * when a refresh fails — an opinion from yesterday beats no second opinion.
 */
export async function getDynastyProcessValues(numQbs: 1 | 2): Promise<DynastyProcessValues | null> {
  const cacheKey = `${CACHE_PREFIX}${numQbs}qb`
  const now = new Date()

  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const payload =
    cached?.data && typeof cached.data === 'object'
      ? (cached.data as unknown as DynastyProcessValues)
      : null
  if (payload?.version === 1 && cached && cached.expiresAt > now) return payload

  const fresh = await build(numQbs)
  if (!fresh) return payload?.version === 1 ? payload : null

  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: fresh as unknown as object, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
      create: {
        cacheKey,
        data: fresh as unknown as object,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      },
    })
    .catch(() => null)

  return fresh
}
