/**
 * College football "depth" from who actually plays. Pure and client-safe.
 *
 * ⚠ THIS IS NOT A PUBLISHED DEPTH CHART, AND THE WORDING MUST SAY SO. Neither provider has one: Rolling
 * Insights' `/depth-charts/NCAAFB` returns 404 (probed 2026-11-26 with the account that holds college
 * football; the same token and URL return all 30 NBA teams), and CFBD's API has no depth-chart endpoint.
 * What exists is every player's box score (`player_game_stats`, CFBD weekly rows), so a player's place is
 * his rank on his own school in the stat that fits his position, over the school's last few games:
 *
 *   QB → pass attempts · RB → carries · WR / TE → catches
 *
 * A game a player missed counts as zero for him, so an injured starter falls down the order the way his
 * snaps do. Shares are of the school's total in that stat over the same games.
 */

export const USAGE_DEPTH_GAMES = 4
export const USAGE_DEPTH_SOURCE = 'af_usage'

export type UsageStat = 'att' | 'car' | 'rec'
export const USAGE_STATS: readonly UsageStat[] = ['att', 'car', 'rec']

export type UsageGameRow = {
  school: string
  name: string
  gameDate: string
  att: number
  car: number
  rec: number
}

export type UsageRank = { name: string; nameKey: string; rank: number; total: number; share: number; perGame: number }
export type SchoolUsage = { games: number; byStat: Record<UsageStat, UsageRank[]> }

/** The name key both sides of a match use: case, punctuation and suffixes ignored. */
export function usageNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '')
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Ranks each school's players per stat over the school's last `games` game dates. */
export function rankSchoolUsage(rows: UsageGameRow[], games = USAGE_DEPTH_GAMES): Map<string, SchoolUsage> {
  const bySchool = new Map<string, UsageGameRow[]>()
  for (const r of rows) {
    if (!r.school?.trim() || !r.name?.trim() || !r.gameDate) continue
    const list = bySchool.get(r.school) ?? []
    list.push(r)
    bySchool.set(r.school, list)
  }
  const out = new Map<string, SchoolUsage>()
  for (const [school, list] of bySchool) {
    const dates = [...new Set(list.map((r) => r.gameDate))].sort().reverse().slice(0, games)
    const window = new Set(dates)
    const totals = new Map<string, { name: string; att: number; car: number; rec: number }>()
    for (const r of list) {
      if (!window.has(r.gameDate)) continue
      const key = usageNameKey(r.name)
      if (!key) continue
      const t = totals.get(key) ?? { name: r.name.trim(), att: 0, car: 0, rec: 0 }
      t.att += Math.max(0, Number(r.att) || 0)
      t.car += Math.max(0, Number(r.car) || 0)
      t.rec += Math.max(0, Number(r.rec) || 0)
      totals.set(key, t)
    }
    const byStat = {} as Record<UsageStat, UsageRank[]>
    for (const stat of USAGE_STATS) {
      const teamTotal = [...totals.values()].reduce((n, t) => n + t[stat], 0)
      byStat[stat] = [...totals.entries()]
        .filter(([, t]) => t[stat] > 0)
        .sort((a, b) => b[1][stat] - a[1][stat] || a[1].name.localeCompare(b[1].name))
        .map(([nameKey, t], i) => ({
          name: t.name,
          nameKey,
          rank: i + 1,
          total: t[stat],
          share: teamTotal > 0 ? t[stat] / teamTotal : 0,
          perGame: round1(t[stat] / dates.length),
        }))
    }
    out.set(school, { games: dates.length, byStat })
  }
  return out
}

export function usageStatForPosition(position: string | null | undefined): UsageStat | null {
  const p = String(position ?? '').trim().toUpperCase()
  if (p === 'QB') return 'att'
  if (p === 'RB' || p === 'FB') return 'car'
  if (p === 'WR' || p === 'TE') return 'rec'
  return null
}

const STAT_WORDS: Record<UsageStat, string> = { att: 'pass attempts', car: 'carries', rec: 'catches' }
const POS_LABEL: Record<UsageStat, string> = { att: 'QB', car: 'RB', rec: '' }

/**
 * One line for a card, or null when the player has no usage on record at his school.
 *   "QB1 at Ohio State: 1st in pass attempts, last 4 games (92%)"
 *   "2nd at Texas in catches, last 4 games (5.3 a game, 21%)"
 */
export function usageDepthNote(input: {
  position: string | null | undefined
  name: string
  schoolLabel: string
  usage: SchoolUsage | null | undefined
}): string | null {
  const stat = usageStatForPosition(input.position)
  if (!stat || !input.usage) return null
  const key = usageNameKey(input.name)
  const hit = input.usage.byStat[stat].find((r) => r.nameKey === key)
  if (!hit) return null
  const games = input.usage.games
  const window = `last ${games} ${games === 1 ? 'game' : 'games'}`
  const pct = `${Math.round(hit.share * 100)}%`
  const ord = ordinal(hit.rank)
  if (stat === 'rec') return `${ord} at ${input.schoolLabel} in catches, ${window} (${hit.perGame} a game, ${pct})`
  return `${POS_LABEL[stat]}${hit.rank} at ${input.schoolLabel}: ${ord} in ${STAT_WORDS[stat]}, ${window} (${hit.perGame} a game, ${pct})`
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}
