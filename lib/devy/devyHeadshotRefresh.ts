import { prisma } from '@/lib/prisma'
import type { RunBudget } from '@/lib/cron/runBudget'

/**
 * Headshots for devy players, derived from the id we already hold.
 *
 * WHY THIS IS POSSIBLE AT ALL. `DevyPlayer.cfbdId` is not a CFBD-private key —
 * CFBD sources its athlete ids from ESPN, so the value is an ESPN athlete id and
 * addresses ESPN's public headshot CDN directly. Measured 2026-08-28 against the
 * ten highest-projected prospects: 9 of 10 returned a real PNG (Jeremiah Smith
 * 271 KB, Arch Manning 220 KB); one 404'd. No new provider, no key, no quota.
 *
 * WHY IT WAS EMPTY. `DevyPlayer.headshotUrl` was 0 of 1,718, and
 * `SportsPlayer` NCAAF was 66 of 73,883 — 68,637 of those rows come from Rolling
 * Insights, which carries no images at all. The existing `sync-player-images`
 * cron does cover NCAAF, but it rotates one sport per day and caps at 500, so
 * college would take centuries to drain. Nothing was broken; nothing could ever
 * finish.
 *
 * 🛑 ONLY A VERIFIED URL IS EVER WRITTEN. A derived URL that 404s is worse than
 * no URL: it looks like data, passes every null check, and renders a broken
 * image. So each candidate is HEAD-checked and stored only on a 200 that is
 * actually an image with real bytes. A miss leaves NULL, which is the honest
 * value and is what the UI already knows how to handle.
 *
 * ⚠ MISSES ARE RE-CHECKED ON PURPOSE, and that is not waste. ESPN adds headshots
 * through the season — a true freshman with no photo in August often has one by
 * October. Because the drain selects on `headshotUrl IS NULL`, those ~10% come
 * back around naturally. Recording a permanent "no photo" sentinel would freeze
 * a temporary absence into a fact.
 */

/** ESPN's public college-football headshot CDN, keyed by athlete id. */
const ESPN_CFB_HEADSHOT = (athleteId: string) =>
  `https://a.espncdn.com/i/headshots/college-football/players/full/${athleteId}.png`

/**
 * A 404 from this CDN still returns a body — 1 byte of `text/html`. Requiring a
 * real image content-type AND a plausible size is what separates a photo from an
 * error page; status alone would be enough today and is one CDN change from not
 * being.
 */
const MIN_IMAGE_BYTES = 2_000

/** Concurrency. Enough to drain 1,718 inside a cron budget, gentle on a CDN. */
const CONCURRENCY = 8
const REQUEST_TIMEOUT_MS = 10_000

/** Leave room to finish the writes rather than being killed mid-batch. */
const MIN_RUNWAY_MS = 20_000

export interface DevyHeadshotRefreshResult {
  checked: number
  written: number
  missing: number
  errors: number
  deferred: boolean
  skipped?: string
}

async function resolveHeadshot(athleteId: string): Promise<string | null> {
  const url = ESPN_CFB_HEADSHOT(athleteId)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return null
    const length = Number(res.headers.get('content-length') ?? '0')
    if (!Number.isFinite(length) || length < MIN_IMAGE_BYTES) return null
    return url
  } catch {
    // Network failure is not evidence the player has no photo. Returning null
    // leaves the row NULL and the next run tries again, which is correct — the
    // alternative is recording a transient blip as a permanent absence.
    return null
  }
}

/**
 * Resolve headshots for players that do not have one yet.
 *
 * Drains oldest-first and resumes: each run takes the next slice, so the whole
 * pool fills over a few ticks without any run needing to hold all of it.
 */
export async function refreshDevyHeadshots(
  budget: RunBudget,
  limit = 400,
): Promise<DevyHeadshotRefreshResult> {
  const result: DevyHeadshotRefreshResult = {
    checked: 0,
    written: 0,
    missing: 0,
    errors: 0,
    deferred: false,
  }

  if (budget.exhausted() || budget.remainingMs() < MIN_RUNWAY_MS) {
    return { ...result, deferred: true, skipped: 'no runway' }
  }

  const candidates = await prisma.devyPlayer.findMany({
    where: { cfbdId: { not: null }, headshotUrl: null },
    select: { id: true, cfbdId: true },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })

  if (candidates.length === 0) return result

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= candidates.length) return
      if (budget.exhausted() || budget.remainingMs() < MIN_RUNWAY_MS) {
        result.deferred = true
        return
      }
      const player = candidates[index]
      const athleteId = player.cfbdId
      if (!athleteId) continue

      result.checked += 1
      const url = await resolveHeadshot(athleteId)
      if (!url) {
        result.missing += 1
        continue
      }
      try {
        await prisma.devyPlayer.update({
          where: { id: player.id },
          data: { headshotUrl: url },
        })
        result.written += 1
      } catch {
        result.errors += 1
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  return result
}

/**
 * The same derivation for `SportsPlayer`, which is the table the player cards
 * and search actually read — the devy pool is only 1,718 of 73,883 NCAAF rows.
 *
 * ⚠ CFBD-SOURCED ROWS ONLY, AND THAT LIMIT IS THE POINT. `SportsPlayer.externalId`
 * means different things per `source`: CFBD rows carry the ESPN athlete id
 * (7 digits, verified 12/12 against the CDN), while the 68,637 Rolling Insights
 * rows carry RI's own internal id (2-5 digits, e.g. `340`). Feeding an RI id to
 * this URL either 404s or — far worse — resolves to a DIFFERENT person who
 * happens to own that ESPN id.
 *
 * 🛑 DO NOT "FIX" THE RI ROWS BY MATCHING ON NAME. This repo already learned
 * that from the player dedupe: same name is not a safe key. The live example is
 * the card that prompted this work — `Josh Allen`, CB, Temple, an RI row. Name
 * matching would hand him Buffalo's quarterback's headshot with total
 * confidence. An empty card is honest; a confidently wrong face is not.
 */
export async function refreshCollegeSportsPlayerHeadshots(
  budget: RunBudget,
  limit = 400,
): Promise<DevyHeadshotRefreshResult> {
  const result: DevyHeadshotRefreshResult = {
    checked: 0,
    written: 0,
    missing: 0,
    errors: 0,
    deferred: false,
  }

  if (budget.exhausted() || budget.remainingMs() < MIN_RUNWAY_MS) {
    return { ...result, deferred: true, skipped: 'no runway' }
  }

  const candidates = await prisma.sportsPlayer.findMany({
    where: { sport: 'NCAAF', source: 'cfbd', imageUrl: null },
    select: { id: true, externalId: true },
    orderBy: { fetchedAt: 'asc' },
    take: limit,
  })

  if (candidates.length === 0) return result

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= candidates.length) return
      if (budget.exhausted() || budget.remainingMs() < MIN_RUNWAY_MS) {
        result.deferred = true
        return
      }
      const player = candidates[index]
      if (!player.externalId) continue

      result.checked += 1
      const url = await resolveHeadshot(player.externalId)
      if (!url) {
        result.missing += 1
        continue
      }
      try {
        await prisma.sportsPlayer.update({ where: { id: player.id }, data: { imageUrl: url } })
        result.written += 1
      } catch {
        result.errors += 1
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  return result
}
