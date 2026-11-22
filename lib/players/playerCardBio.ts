/**
 * The player card's bio and news (2026-11-21), read from Postgres only.
 *
 * The draft room's player card showed "—" for age, height, weight, experience and college for every
 * player, and "No recent news." for every player. Nothing ever asked for them: the card only showed
 * what its caller passed, and the board passed none of it; its news came from an analytics payload
 * that has no news field.
 *
 * The data was there the whole time:
 *   - `SportsPlayer` carries one row per player per source. The Sleeper row has all five bio fields
 *     (height in inches, weight in pounds, years of experience — the only source with it); Rolling
 *     Insights and TheSportsDB rows fill gaps in other formats ("6'2\"", "6 ft 3 in", "211 lbs").
 *     Each field is taken from the most trusted source that has it.
 *   - `SportsNews` carries the stories, matched by the same rule the legacy profile uses
 *     (`newsRowMatchesPlayer`: same name, and same team whenever the story names one).
 *
 * Identity: by the id the card has (a Sleeper id for NFL, the provider id elsewhere), else by name and
 * position. A name that matches two different players (two Sleeper ids) gives no bio rather than the
 * wrong man's. No provider is called.
 */
import { newsRowMatchesPlayer } from '@/lib/legacy/playerNewsMatch'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

export type CardBioRow = {
  source: string
  sleeperId?: string | null
  name: string
  position?: string | null
  team?: string | null
  age?: number | null
  yearsExp?: number | null
  height?: string | null
  weight?: string | null
  college?: string | null
}

export type PlayerCardBio = {
  age: number | null
  heightIn: number | null
  weightLbs: number | null
  /** 0 is a rookie; null is unknown. */
  yearsExp: number | null
  college: string | null
}

export type PlayerCardNews = { title: string; body: string | null; source: string | null; publishedAt: string | null; url: string | null }

/** Most trusted first: Sleeper has every field in plain numbers. */
const SOURCE_RANK = ['sleeper', 'rolling_insights', 'thesportsdb']
const rank = (source: string) => {
  const i = SOURCE_RANK.indexOf(source)
  return i === -1 ? SOURCE_RANK.length : i
}

/** Pure: inches from "75", "6'2\"", "6' 2\"", "6 ft 3 in" or "6-2"; null when unreadable. */
export function heightInches(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^\d{2,3}$/.test(s)) {
    const n = Number(s)
    return n >= 48 && n <= 96 ? n : null
  }
  const m = s.match(/^(\d)\s*(?:'|ft|feet|-)\s*(\d{1,2})?/i)
  if (!m) return null
  const inches = Number(m[1]) * 12 + Number(m[2] ?? 0)
  return inches >= 48 && inches <= 96 ? inches : null
}

/** Pure: pounds from "252", "211 lbs" or "247 lb"; null when unreadable. */
export function weightPounds(raw: string | null | undefined): number | null {
  const m = String(raw ?? '').match(/(\d{2,3})/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 100 && n <= 450 ? n : null
}

/**
 * Pure: the rows that are this player. With rows found by id, all of them. With rows found by name,
 * only the ones at this position, and none when they belong to two different Sleeper players.
 */
export function rowsForPlayer(rows: readonly CardBioRow[], wanted: { name?: string | null; position?: string | null }, byId: boolean): CardBioRow[] {
  if (byId) return [...rows]
  const key = normalizeMatchName(String(wanted.name ?? ''))
  const position = String(wanted.position ?? '').trim().toUpperCase()
  const same = rows.filter((r) => normalizeMatchName(r.name) === key && (!position || String(r.position ?? '').trim().toUpperCase() === position))
  const sleeperIds = new Set(same.map((r) => String(r.sleeperId ?? '').trim()).filter(Boolean))
  return sleeperIds.size > 1 ? [] : same
}

/** Pure: each field from the most trusted source that has it. */
export function mergeCardBio(rows: readonly CardBioRow[]): PlayerCardBio {
  const ordered = [...rows].sort((a, b) => rank(a.source) - rank(b.source))
  const first = <T>(read: (r: CardBioRow) => T | null | undefined): T | null => {
    for (const r of ordered) {
      const v = read(r)
      if (v !== null && v !== undefined) return v
    }
    return null
  }
  return {
    age: first((r) => (typeof r.age === 'number' && r.age > 0 ? r.age : null)),
    heightIn: first((r) => heightInches(r.height)),
    weightLbs: first((r) => weightPounds(r.weight)),
    yearsExp: first((r) => (typeof r.yearsExp === 'number' && r.yearsExp >= 0 ? r.yearsExp : null)),
    college: first((r) => {
      const c = String(r.college ?? '').trim()
      return c ? c : null
    }),
  }
}

const NEWS_LIMIT = 6
/** Candidate stories read before the per-story player check; the check decides. */
const NEWS_CANDIDATES = 40

/** Server: the card's bio and news. Empty fields rather than an error when nothing is stored. */
export async function loadPlayerCard(input: {
  sport: string
  playerId?: string | null
  name?: string | null
  position?: string | null
  team?: string | null
}): Promise<{ bio: PlayerCardBio; news: PlayerCardNews[] }> {
  const { prisma } = await import('@/lib/prisma')
  const sport = String(input.sport ?? '').trim().toUpperCase()
  const id = String(input.playerId ?? '').trim()
  const select = { source: true, sleeperId: true, name: true, position: true, team: true, age: true, yearsExp: true, height: true, weight: true, college: true } as const

  let rows: CardBioRow[] = []
  let byId = false
  if (id) {
    rows = await prisma.sportsPlayer.findMany({ where: { sport, OR: [{ sleeperId: id }, { externalId: id }, { id }] }, select })
    byId = rows.length > 0
  }
  if (!byId && input.name) {
    const found = await prisma.sportsPlayer.findMany({ where: { sport, name: { equals: input.name, mode: 'insensitive' } }, select, take: 50 })
    rows = rowsForPlayer(found, input, false)
  }
  const bio = mergeCardBio(rows)

  const name = String(input.name ?? rows[0]?.name ?? '').trim()
  let news: PlayerCardNews[] = []
  if (name) {
    const candidates = await prisma.sportsNews.findMany({
      where: { sport, OR: [{ playerName: { equals: name, mode: 'insensitive' } }, { playerNames: { has: name } }] },
      orderBy: { publishedAt: 'desc' },
      take: NEWS_CANDIDATES,
      select: { title: true, content: true, source: true, publishedAt: true, sourceUrl: true, playerName: true, playerNames: true, team: true, teams: true },
    })
    news = candidates
      .filter((n) => newsRowMatchesPlayer(n, { name, team: input.team ?? null }))
      .slice(0, NEWS_LIMIT)
      .map((n) => ({
        title: n.title,
        body: n.content ?? null,
        source: n.source ?? null,
        publishedAt: n.publishedAt ? new Date(n.publishedAt).toISOString() : null,
        url: n.sourceUrl ?? null,
      }))
  }
  return { bio, news }
}
