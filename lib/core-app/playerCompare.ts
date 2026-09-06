import type { PlayerDetail } from './playerFinder'

/**
 * Two players side by side, composed from the two details the page already
 * loads. Pure and client-safe; nothing here invents a figure.
 *
 * Every start-sit and every trade is a comparison, and the finder answered
 * one name at a time. This puts the second name beside the first: the same
 * tiles, and one league table with a column per player, so a row reads as
 * "in Dragons: Kincaid on your bench at 15.4, Ferguson starting at 13.0".
 *
 * ⚠ A LEAGUE-SCORED NUMBER ONLY WHERE THE IMPACT ROW PRICED ONE. The gap and
 * the tally use `impact[].afPoints`, which is this league's own scoring; the
 * feed's standard number is shown separately and labelled. A league where
 * only one side is priced has no gap, not a gap of the priced side.
 *
 * ⚠ "NOT ON A ROSTER WE READ" IS NOT "FREE". A league whose rosters speak
 * another id vocabulary is in `rosterCoverage.unmatched`; that cell says
 * unchecked, and it never counts against either player.
 */

export type CompareCell = {
  /** STARTER / BENCH / IR SLOT / TAXI when yours, NOT YOURS when someone else's, null when on no roster we read. */
  slot: string | null
  isYours: boolean
  ownerName: string | null
  /** This league's own scoring, from the impact row; null when unpriced or not yours. */
  points: number | null
  /** The league's rosters could not be read for this player. */
  unchecked: boolean
}

export type CompareRow = {
  leagueId: string
  leagueName: string
  platform: string
  a: CompareCell
  b: CompareCell
  /** a.points − b.points when both are priced. */
  gap: number | null
  /** One sentence when the row asks for something: a lineup swap, or who holds the other one. */
  note: string | null
}

export type PlayerCompare = {
  rows: CompareRow[]
  headline: string
  standard: { a: number | null; b: number | null; week: number | null }
  /** Priced leagues won by each side. */
  tally: { a: number; b: number; priced: number }
}

function last(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name
}

function cellFor(d: PlayerDetail, leagueId: string): CompareCell {
  const slot = d.leagues.available ? d.leagues.data.find((l) => l.leagueId === leagueId) ?? null : null
  const impact = d.impact.available ? d.impact.data.find((i) => i.leagueId === leagueId) ?? null : null
  const unchecked = d.rosterCoverage.unmatched.some((u) => u.leagueId === leagueId)
  if (!slot) return { slot: null, isYours: false, ownerName: null, points: null, unchecked }
  return {
    slot: slot.isYours ? slot.slot : 'NOT YOURS',
    isYours: slot.isYours,
    ownerName: slot.owner?.ownerName ?? null,
    points: impact?.afPoints.available ? impact.afPoints.data.points : null,
    unchecked: false,
  }
}

function noteFor(row: Omit<CompareRow, 'note'>, aName: string, bName: string): string | null {
  const { a, b } = row
  // Both yours, one benched behind the other while out-projecting him: the lineup fix.
  if (a.isYours && b.isYours && a.points != null && b.points != null) {
    if (a.slot === 'BENCH' && b.slot === 'STARTER' && a.points > b.points) return `Start ${aName} over ${bName}`
    if (b.slot === 'BENCH' && a.slot === 'STARTER' && b.points > a.points) return `Start ${bName} over ${aName}`
  }
  if (!a.isYours && a.ownerName && b.isYours) return `${aName} is @${a.ownerName}’s here`
  if (!b.isYours && b.ownerName && a.isYours) return `${bName} is @${b.ownerName}’s here`
  return null
}

export function comparePlayers(a: PlayerDetail, b: PlayerDetail): PlayerCompare {
  const aName = last(a.player.name)
  const bName = last(b.player.name)

  // The union of both players' leagues, A's order first, then B's extras.
  const seen = new Set<string>()
  const leagues: Array<{ leagueId: string; leagueName: string; platform: string }> = []
  for (const d of [a, b]) {
    for (const l of d.leagues.available ? d.leagues.data : []) {
      if (seen.has(l.leagueId)) continue
      seen.add(l.leagueId)
      leagues.push({ leagueId: l.leagueId, leagueName: l.leagueName, platform: l.platform })
    }
  }

  const rows: CompareRow[] = leagues.map((l) => {
    const ca = cellFor(a, l.leagueId)
    const cb = cellFor(b, l.leagueId)
    const gap = ca.points != null && cb.points != null ? Math.round((ca.points - cb.points) * 10) / 10 : null
    const base = { ...l, a: ca, b: cb, gap }
    return { ...base, note: noteFor(base, aName, bName) }
  })

  const priced = rows.filter((r) => r.gap != null)
  const tally = {
    a: priced.filter((r) => (r.gap ?? 0) > 0).length,
    b: priced.filter((r) => (r.gap ?? 0) < 0).length,
    priced: priced.length,
  }

  const standard = {
    a: a.projection.available ? a.projection.data.points : null,
    b: b.projection.available ? b.projection.data.points : null,
    week: a.projection.available ? a.projection.data.week : b.projection.available ? b.projection.data.week : null,
  }

  let headline: string
  if (priced.length > 0) {
    const biggest = [...priced].sort((x, y) => Math.abs(y.gap ?? 0) - Math.abs(x.gap ?? 0))[0]
    const where = biggest && biggest.gap ? ` — biggest gap in ${biggest.leagueName} (${biggest.gap > 0 ? '+' : ''}${biggest.gap.toFixed(1)} for ${biggest.gap > 0 ? aName : bName})` : ''
    const n = priced.length
    const leaguesWord = n === 1 ? 'league' : 'leagues'
    if (tally.a === n) headline = `${aName} beats ${bName} in ${n === 1 ? 'the one' : `all ${n}`} priced ${leaguesWord}${where}.`
    else if (tally.b === n) headline = `${bName} beats ${aName} in ${n === 1 ? 'the one' : `all ${n}`} priced ${leaguesWord}${where}.`
    else if (tally.a > tally.b) headline = `${aName} beats ${bName} in ${tally.a} of ${n} priced ${leaguesWord}${where}.`
    else if (tally.b > tally.a) headline = `${bName} beats ${aName} in ${tally.b} of ${n} priced ${leaguesWord}${where}.`
    else headline = `${aName} and ${bName} split the ${n} priced ${leaguesWord} ${tally.a}–${tally.b}${where}.`
  } else if (standard.a != null && standard.b != null) {
    const lead = standard.a === standard.b ? `${aName} and ${bName} project the same` : `${standard.a > standard.b ? aName : bName} projects higher`
    headline = `${lead} this week — ${standard.a.toFixed(1)} to ${standard.b.toFixed(1)}, standard scoring. No league-scored number for either yet.`
  } else {
    headline = 'Nothing to price for these two yet.'
  }

  return { rows, headline, standard, tally }
}
