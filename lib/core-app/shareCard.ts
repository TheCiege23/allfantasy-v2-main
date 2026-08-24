import 'server-only'

import { getCareerData, type CareerData, type CareerTitle } from '@/lib/core-app/career'

/**
 * Career share card — handoff 13b's payload.
 *
 * ⚠ DERIVED FROM `getCareerData`, THE SAME READ 13a RENDERS. Build rule 2: every
 * number on the card must trace back to a value shown elsewhere in the product.
 * That rules out `lib/dashboard-intel/careerCardService`, which the existing
 * 1200×630 OG card uses — it is Sleeper-only and scores trades and drafts that
 * 13a never shows, so a card built on it could disagree with the career page it
 * claims to summarise.
 *
 * ⚠ THE CARD IS A VERDICT, NOT A DISCLOSURE SURFACE. Build rule 3: no
 * sub-dimension breakdown. GM prestige and legacy score appear as bare numbers;
 * the weights behind them live on 13a and 14b. That is a deliberate split, not
 * an omission.
 */

export type ShareRing = {
  leagueName: string
  season: number
}

export type ShareCardData = {
  /** "ALLFANTASY CAREER · 2017—2026", or just the era when one season exists. */
  era: string
  handle: string
  /** "LVL 14 ALL-PRO · 61 LIVE LEAGUES · 3 SPORTS" */
  subtitle: string
  tierGroup: number
  prestige: number | null
  legacy: number | null
  titles: number
  record: string | null
  /** Already formatted to one decimal, or null when nothing was played. */
  winRate: string | null
  xp: number | null
  rings: ShareRing[]
  /** More championships than the three the card lists. */
  ringsOverflow: number
  /**
   * The single standout fact, or null when nothing verifiable stands out.
   * Never a compliment — see `buildCallout`.
   */
  callout: string | null
}

/**
 * The Chimmy callout.
 *
 * ⚠ EVERY CANDIDATE IS A QUERY RESULT, AND THE DESIGN'S OWN EXAMPLE IS NOT.
 * 13b's mock reads "Back-to-back in two different sports. Nobody else in these
 * leagues has done it." The first sentence is computable from the title list.
 * The second is not: it asserts something about every other manager in those
 * leagues, and nothing in an imported career carries other managers' results.
 * Build rule 4 asks for a factual computed claim, so the claim is kept and the
 * unverifiable half is dropped rather than printed because it sounds better.
 *
 * ⚠ RETURNS NULL RATHER THAN REACHING. If none of these hold, the card renders
 * without a callout. The anti-flattery rule means there is no fallback sentence
 * to fall back to — "great season!" is not a fact, and a card that always finds
 * something remarkable is a card whose remarks mean nothing.
 */
export function buildCallout(data: CareerData): string | null {
  const titles = [...data.titles].sort((a, b) => b.season - a.season)
  if (titles.length === 0) return null

  const sports = new Set(titles.map((t) => t.sport).filter((s): s is string => !!s))

  // Consecutive title seasons — checked on the set of years, so two titles won
  // in the same year across different leagues do not read as back-to-back.
  const years = [...new Set(titles.map((t) => t.season))].sort((a, b) => a - b)
  let bestRun = 1
  let run = 1
  let runEnd = years[0]
  for (let i = 1; i < years.length; i++) {
    run = years[i] === years[i - 1] + 1 ? run + 1 : 1
    if (run > bestRun) {
      bestRun = run
      runEnd = years[i]
    }
  }

  if (bestRun >= 2 && sports.size >= 2) {
    return `${runLabel(bestRun)} through ${runEnd}, and titles in ${sports.size} different sports.`
  }
  if (bestRun >= 2) {
    return `${runLabel(bestRun)} through ${runEnd}.`
  }
  if (sports.size >= 2) {
    return `Championships in ${sports.size} different sports — ${[...sports].join(' and ')}.`
  }

  // Repeat winner in one league.
  const byLeague = new Map<string, CareerTitle[]>()
  for (const t of titles) {
    const list = byLeague.get(t.leagueName) ?? []
    list.push(t)
    byLeague.set(t.leagueName, list)
  }
  const repeat = [...byLeague.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (repeat && repeat[1].length >= 2) {
    const seasons = repeat[1].map((t) => t.season).sort((a, b) => a - b)
    return `${repeat[1].length} titles in ${repeat[0]} — ${seasons.join(', ')}.`
  }

  // A title in the first season on record.
  if (data.firstSeason != null && titles.some((t) => t.season === data.firstSeason)) {
    return `Won a championship in ${data.firstSeason}, the first season on record.`
  }

  // Falls back to the plainest true statement there is: the count and its
  // denominator. Still a fact, still carries its own evidence.
  if (data.leaguesPlayed > 0) {
    return `${titles.length} ${titles.length === 1 ? 'championship' : 'championships'} across ${data.leaguesPlayed.toLocaleString()} completed league-seasons.`
  }
  return null
}

function runLabel(n: number): string {
  if (n === 2) return 'Back-to-back champion'
  if (n === 3) return 'Three-peat champion'
  return `${n} straight championship seasons`
}

export function toShareCard(data: CareerData): ShareCardData | null {
  if (data.isEmpty) return null

  const rings = [...data.titles]
    .sort((a, b) => b.season - a.season)
    .slice(0, 3)
    .map((t) => ({ leagueName: t.leagueName, season: t.season }))

  const era =
    data.firstSeason && data.lastSeason
      ? data.firstSeason === data.lastSeason
        ? `ALLFANTASY CAREER · ${data.firstSeason}`
        : `ALLFANTASY CAREER · ${data.firstSeason}—${data.lastSeason}`
      : 'ALLFANTASY CAREER'

  const bits: string[] = []
  if (data.level != null) {
    bits.push(`LVL ${data.level}${data.levelName ? ` ${data.levelName.toUpperCase()}` : ''}`)
  }
  if (data.leagueCounts.active > 0) {
    bits.push(`${data.leagueCounts.active} LIVE ${data.leagueCounts.active === 1 ? 'LEAGUE' : 'LEAGUES'}`)
  }
  if (data.sports.length > 0) {
    bits.push(`${data.sports.length} ${data.sports.length === 1 ? 'SPORT' : 'SPORTS'}`)
  }

  return {
    era,
    handle: data.handle ? `@${data.handle}` : 'Your career',
    subtitle: bits.join(' · '),
    // The crest glyph is keyed on tier group, same as 14a's ladder.
    tierGroup: tierGroupForLevel(data.level),
    prestige: data.prestige?.total ?? null,
    legacy: data.legacy?.total ?? null,
    titles: data.championships,
    record: data.games > 0 ? `${data.wins.toLocaleString()}–${data.losses.toLocaleString()}` : null,
    winRate: data.winRate != null ? (Math.round(data.winRate * 1000) / 10).toFixed(1) : null,
    xp: data.xp?.total ?? null,
    rings,
    ringsOverflow: Math.max(0, data.championships - rings.length),
    callout: buildCallout(data),
  }
}

/** Tier group 1–7 from a 25-level rank, matching `RANK_LEVELS`' own banding. */
function tierGroupForLevel(level: number | null): number {
  if (level == null) return 1
  if (level >= 25) return 7
  if (level >= 22) return 6
  if (level >= 18) return 5
  if (level >= 13) return 4
  if (level >= 9) return 3
  if (level >= 5) return 2
  return 1
}

export async function getShareCardData(userId: string | null): Promise<ShareCardData | null> {
  if (!userId) return null
  const data = await getCareerData(userId, null)
  return toShareCard(data)
}
