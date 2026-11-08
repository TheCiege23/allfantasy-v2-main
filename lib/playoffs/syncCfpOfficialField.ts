import "server-only"
import { getCfbdApiKey } from "@/lib/cfbd-env"
import { prisma } from "@/lib/prisma"
import { cfpSeedsCacheKey, readCfpSeeds, validateCfpSeeds } from "./cfpSeeds"
import { applyPlayoffSeedsToChallenges } from "./playoffSeeding"
import { mapOfficialCfpGames } from "./cfpOfficialBracket"
import { readSingleGameSchedule, scheduleCacheKey, validateSingleGameSchedule } from "./singleGameSchedule"

/** CFBD publishes actual playoff seeds separately from its committee rankings. */
export function parseOfficialCfpField(payload: unknown, season: number): string[] | null {
  if (!payload || typeof payload !== "object") return null
  const data = payload as { season?: unknown; competition?: unknown; status?: unknown; teamCount?: unknown; participants?: unknown }
  if (data.season !== season || data.competition !== "cfp" || !["selected", "in_progress", "completed"].includes(String(data.status)) || data.teamCount !== 12 || !Array.isArray(data.participants) || data.participants.length !== 12) return null
  const seeds: string[] = Array(12).fill("")
  for (const item of data.participants) {
    const row = item as { seed?: unknown; team?: { school?: unknown } }
    if (!Number.isInteger(row?.seed) || Number(row.seed) < 1 || Number(row.seed) > 12 || typeof row.team?.school !== "string" || seeds[Number(row.seed) - 1]) return null
    seeds[Number(row.seed) - 1] = row.team.school
  }
  const checked = validateCfpSeeds(seeds)
  return checked.ok ? checked.seeds : null
}

export async function syncCfpOfficialField(input: { season: number; apply: boolean }) {
  const key = getCfbdApiKey()
  if (!key) return { status: "provider-not-configured" as const, ok: false }
  let response: Response
  try {
    response = await fetch(`https://api.collegefootballdata.com/playoffs/cfp?year=${input.season}`, {
      headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { status: "provider-unavailable" as const, ok: false }
  }
  if (response.status === 404) return { status: "not-selected" as const, ok: true }
  if (!response.ok) return { status: "provider-error" as const, ok: false }
  const payload = await response.json().catch(() => null) as { status?: unknown } | null
  if (payload?.status === "scheduled") return { status: "not-selected" as const, ok: true }
  const seeds = parseOfficialCfpField(payload, input.season)
  if (!seeds) return { status: "invalid-provider-field" as const, ok: false }
  // CFP can change its bracket paths. Never seed our fixed board unless the
  // provider's actual first-round, bye and feeder links match our topology.
  const games = mapOfficialCfpGames(payload)
  const checkedSchedule = validateSingleGameSchedule("ncaaf", games)
  if (!games || !checkedSchedule.ok) return { status: "unsupported-or-incomplete-bracket" as const, ok: false }
  const prior = await readCfpSeeds(input.season)
  if (prior && prior.seeds.some((name, index) => name !== seeds[index])) {
    // Existing fields may have picks and results. Corrections require an explicit admin decision.
    return { status: "field-conflict" as const, ok: false }
  }
  if (!input.apply) return { status: "verified-preview" as const, ok: true }
  const previousSchedule = await readSingleGameSchedule("ncaaf", input.season)
  if (previousSchedule && previousSchedule.games.some((row, i) => row.startsAt !== checkedSchedule.games[i]?.startsAt)) {
    return { status: "schedule-conflict" as const, ok: false }
  }
  const pools = await prisma.playoffBracketChallenge.findMany({ where: { sport: "ncaaf", seasonYear: input.season, isTestMode: false }, select: { id: true } })
  const poolIds = pools.map(pool => pool.id)
  const existing = poolIds.length ? await prisma.playoffBracketSeries.findMany({
    where: { challengeId: { in: poolIds } }, select: { seriesNumber: true, startsAt: true, status: true, homeTeamName: true, awayTeamName: true },
  }) : []
  const fixedSeeds: Record<number, [number, number | null]> = { 1: [8, 9], 2: [5, 12], 3: [7, 10], 4: [6, 11], 5: [1, null], 6: [4, null], 7: [2, null], 8: [3, null] }
  const matchesSeed = (value: string, seed: number) => [seeds[seed - 1], `CFP${seed}`].some(expected => expected.toLowerCase() === value.trim().toLowerCase())
  if (existing.some(row => {
    const game = checkedSchedule.games.find(item => item.seriesNumber === row.seriesNumber)
    const fixed = fixedSeeds[row.seriesNumber]
    if (fixed && (!matchesSeed(row.homeTeamName, fixed[0]) || (fixed[1] && !matchesSeed(row.awayTeamName, fixed[1])))) return true
    return !game || (row.startsAt && row.startsAt.toISOString() !== game.startsAt) ||
      (!previousSchedule && (row.status !== "scheduled" || (row.startsAt && row.startsAt.getTime() <= Date.now())))
  })) return { status: "schedule-conflict" as const, ok: false }
  if (!previousSchedule && checkedSchedule.games.some(game => Date.parse(game.startsAt) <= Date.now())) {
    return { status: "schedule-already-started" as const, ok: false }
  }
  await prisma.$transaction(async tx => {
    if (!previousSchedule) {
      const record = { sport: "ncaaf", season: input.season, games: checkedSchedule.games, enteredAt: new Date().toISOString(), enteredByUserId: null }
      // Create-only: never replace an admin's concurrently published schedule.
      await tx.sportsDataCache.create({ data: { cacheKey: scheduleCacheKey("ncaaf", input.season), data: record, expiresAt: new Date(Date.UTC(input.season + 3, 0, 1)) } })
    } else if (previousSchedule.enteredByUserId === null) {
      // Keep provider bowl and venue details current without replacing an admin's schedule.
      const merged = previousSchedule.games.map((old, i) => ({ ...old,
        label: checkedSchedule.games[i].label || old.label,
        venue: checkedSchedule.games[i].venue === "Venue TBA" ? old.venue : checkedSchedule.games[i].venue,
      }))
      if (JSON.stringify(merged) !== JSON.stringify(previousSchedule.games)) {
        const updated = await tx.sportsDataCache.updateMany({
          where: { cacheKey: scheduleCacheKey("ncaaf", input.season), data: { equals: previousSchedule as any } },
          data: { data: { ...previousSchedule, games: merged, enteredAt: new Date().toISOString() } as any },
        })
        if (updated.count !== 1) throw new Error("CFP schedule changed concurrently")
      }
    }
    if (!prior) {
      // Create-only: a concurrent manual field must never be overwritten by automation.
      const record = { season: input.season, seeds, enteredAt: new Date().toISOString(), enteredByUserId: null }
      await tx.sportsDataCache.create({ data: { cacheKey: cfpSeedsCacheKey(input.season), data: record, expiresAt: new Date(Date.UTC(input.season + 3, 0, 1)) } })
    }
    for (const game of checkedSchedule.games) {
      await tx.playoffBracketSeries.updateMany({ where: { challengeId: { in: poolIds }, seriesNumber: game.seriesNumber, startsAt: null, status: "scheduled" }, data: { startsAt: new Date(game.startsAt) } })
    }
  })
  // Retry any pools missed by a previous partial sweep; already seeded pools are idempotent.
  const sweep = await applyPlayoffSeedsToChallenges(poolIds)
  return sweep.errors.length ? { status: "publish-failed" as const, ok: false } : { status: prior ? "current" as const : "published" as const, ok: true }
}
