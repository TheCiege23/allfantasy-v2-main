import { prisma } from '@/lib/prisma'
import { espnSiteApiUrl } from '@/lib/providers/espnUrls'
import { ESPN_SPORT_SITE_PATH, resolveGameState } from '@/lib/sports-live-scores-service'

const SPORTS = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER'] as const
const DAY_MS = 86_400_000
const LIMIT = 1_000
type Sport = typeof SPORTS[number]

type Competitor = { homeAway?: string; score?: string; team?: { id?: string; displayName?: string } }
type Event = {
  id?: string
  date?: string
  season?: { year?: number; type?: number }
  week?: { number?: number }
  competitions?: Array<{
    startDate?: string
    status?: { type?: { name?: string } }
    competitors?: Competitor[]
  }>
}

function parseDate(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use YYYY-MM-DD for both UTC dates')
  const date = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid date')
  return date.getTime()
}

function parseScore(value: string | undefined): number | null {
  return typeof value === 'string' && /^\d+$/.test(value) && Number(value) <= 999 ? Number(value) : null
}

async function readWindow(sport: Sport, from: number): Promise<Event[]> {
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '')
  const url = new URL(espnSiteApiUrl(ESPN_SPORT_SITE_PATH[sport] + '/scoreboard'))
  url.searchParams.set('dates', date(from))
  url.searchParams.set('limit', String(LIMIT))
  if (sport === 'NCAAF') url.searchParams.set('groups', '80')
  if (sport === 'NCAAB') url.searchParams.set('groups', '50')
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error('ESPN HTTP ' + response.status)
      const payload = await response.json()
      if (!Array.isArray(payload.events)) throw new Error('Missing ESPN events array')
      if (payload.events.length >= LIMIT) throw new Error('Provider result limit reached')
      return payload.events
    } catch (error) {
      if (attempt >= 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }
}

function finishedGame(sport: Sport, event: Event, observedAt: Date) {
  const game = event.competitions?.[0]
  const home = game?.competitors?.find((side) => side.homeAway === 'home')
  const away = game?.competitors?.find((side) => side.homeAway === 'away')
  const homeScore = parseScore(home?.score)
  const awayScore = parseScore(away?.score)
  const startTime = new Date(game?.startDate ?? event.date ?? '')
  if (resolveGameState(game?.status?.type?.name) !== 'final' ||
      !event.id || !home?.team?.displayName || !away?.team?.displayName ||
      homeScore === null || awayScore === null || !Number.isFinite(startTime.getTime()) ||
      !event.season?.year || !Number.isInteger(event.season.year)) return null
  return {
    sport, externalId: event.id, source: 'espn', status: 'final', startTime,
    homeTeam: home.team.displayName, awayTeam: away.team.displayName,
    homeScore, awayScore, season: event.season.year, week: event.week?.number,
    seasonType: ({ 1: 'pre', 2: 'regular', 3: 'post' } as Record<number, string>)[event.season.type ?? 0],
    fetchedAt: observedAt, expiresAt: new Date(observedAt.getTime() + 365 * DAY_MS),
  }
}

async function main() {
  const [mode, first, last] = process.argv.slice(2)
  if (mode !== 'verify' && mode !== 'backfill-staging') throw new Error('Use verify or backfill-staging, followed by two UTC dates')
  const writes = mode === 'backfill-staging'
  if (writes && process.env.CHIMMY_STAGING_PROJECT_ID !== 'b3cd0239-9cb1-4c22-9d76-533d91d26f36') {
    throw new Error('The backfill must run through the isolated bracket staging runner')
  }
  const from = parseDate(first)
  const to = parseDate(last)
  if (to < from || to - from > 366 * DAY_MS || (writes && to >= Date.now() - DAY_MS)) {
    throw new Error('Use an ordered range of at most 367 UTC days. Backfill only past dates.')
  }

  const results = await Promise.all(SPORTS.map(async (sport) => {
    let observed = 0
    let live = 0
    let scheduled = 0
    let invalidFinals = 0
    let inserted = 0
    const finals = new Map<string, NonNullable<ReturnType<typeof finishedGame>>>()
    const failures: string[] = []
    for (let start = from; start <= to; start += DAY_MS) {
      if (start > from) await new Promise((resolve) => setTimeout(resolve, 150))
      try {
        const events = await readWindow(sport, start)
        const observedAt = new Date()
        observed += events.length
        const rows = []
        for (const event of events) {
          const state = resolveGameState(event.competitions?.[0]?.status?.type?.name)
          if (state === 'in_progress') live++
          if (state === 'scheduled') scheduled++
          if (state !== 'final') continue
          const game = finishedGame(sport, event, observedAt)
          if (!game) { invalidFinals++; continue }
          if (game.startTime.getTime() < from || game.startTime.getTime() >= to + DAY_MS || finals.has(game.externalId)) continue
          finals.set(game.externalId, game)
          rows.push(game)
        }
        if (writes && rows.length) {
          const result = await prisma.sportsGame.createMany({ data: rows, skipDuplicates: true })
          inserted += result.count
        }
      } catch (error) {
        const detail = error instanceof Error && /^ESPN HTTP \d+$/.test(error.message) ? error.message : 'request, payload or write failed'
        failures.push(new Date(start).toISOString().slice(0, 10) + ' ' + detail)
      }
    }
    const result = { sport, observed, live, scheduled, verifiedFinals: finals.size, invalidFinals, inserted, failures }
    console.log(JSON.stringify(result))
    return result
  }))
  if (results.some((result) => result.failures.length || result.invalidFinals || !result.observed)) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Backfill failed')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
