import type { RecapGameAward, SeasonRecap } from '@/lib/season-recap/computeSeasonRecap'

/**
 * What a season recap share card draws — the champion or one award, from the stored recap. PURE, so
 * every award's card is pinned by a test rather than by rendering PNGs. Drawn by
 * /api/share/rivalry-card `?kind=season_recap` (lib/season-recap is the data; nothing is recomputed).
 *
 * ⚠ AN AWARD THE RECAP DOES NOT HAVE HAS NO CARD (null → 404). The recap leaves out what the season's
 * data cannot support, and a card must not put a blank or a zero where the page shows nothing.
 *
 * ⚠ PLAIN TEXT ONLY: no font ships with these cards, so an emoji, an arrow or an ellipsis glyph can render
 * as a missing-glyph box.
 *
 * Every member of the league may make these — the cards show the league's own recap. Only the WRITTEN
 * recap (lib/season-recap/seasonRecapAiService.ts) is AF Commissioner.
 */

export const SEASON_RECAP_CARD_AWARDS = [
  'champion',
  'runnerUp',
  'topSeed',
  'mostPointsFor',
  'highestWeek',
  'biggestBlowout',
  'closestGame',
  'bestTrade',
  'worstTrade',
  'bestPickup',
  'mostImproved',
  'lowerBracket',
] as const

export type SeasonRecapCardAward = (typeof SEASON_RECAP_CARD_AWARDS)[number]

export function isSeasonRecapCardAward(v: unknown): v is SeasonRecapCardAward {
  return typeof v === 'string' && (SEASON_RECAP_CARD_AWARDS as readonly string[]).includes(v)
}

export type SeasonRecapCardView = {
  award: SeasonRecapCardAward
  /** The banner across the top, e.g. "2026 CHAMPION". */
  kicker: string
  /** The team (or player) the card is about. */
  title: string
  /** The big number or line, when the award has one. */
  value: string | null
  detail: string | null
  /** The bottom-left footnote: what the card is, in the season's words. */
  footnote: string
  champion: boolean
}

type Lang = 'en' | 'es'

const LABELS: Record<SeasonRecapCardAward, Record<Lang, string>> = {
  champion: { en: 'Champion', es: 'Campeón' },
  runnerUp: { en: 'Runner-up', es: 'Subcampeón' },
  topSeed: { en: 'Regular-season top seed', es: 'Primer cabeza de serie' },
  mostPointsFor: { en: 'Most points for', es: 'Más puntos a favor' },
  highestWeek: { en: 'Highest single week', es: 'Mayor puntuación en una semana' },
  biggestBlowout: { en: 'Biggest blowout', es: 'Mayor paliza' },
  closestGame: { en: 'Closest game', es: 'Partido más ajustado' },
  bestTrade: { en: 'Best trade by value', es: 'Mejor trade por valor' },
  worstTrade: { en: 'Worst trade by value', es: 'Peor trade por valor' },
  bestPickup: { en: 'Best pickup', es: 'Mejor alta por reclamo' },
  mostImproved: { en: 'Most improved', es: 'Mayor mejora' },
  lowerBracket: { en: 'Consolation winner', es: 'Ganador del cuadro de consolación' },
}

const pts = (n: number) => n.toFixed(1)
const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`

function gameLine(g: RecapGameAward, lang: Lang): string {
  return lang === 'es'
    ? `${g.winner.name} ${pts(g.winnerScore)} - ${g.loser.name} ${pts(g.loserScore)}, semana ${g.week}`
    : `${g.winner.name} ${pts(g.winnerScore)} - ${g.loser.name} ${pts(g.loserScore)}, week ${g.week}`
}

export function seasonRecapCardView(recap: SeasonRecap, award: SeasonRecapCardAward, language?: string | null): SeasonRecapCardView | null {
  const lang: Lang = language === 'es' ? 'es' : 'en'
  const es = lang === 'es'
  const label = (a: SeasonRecapCardAward) => LABELS[a][lang]
  const footnote = es ? `Resumen de la temporada ${recap.season}` : `${recap.season} season recap`
  const view = (title: string, value: string | null, detail: string | null, kicker = label(award)): SeasonRecapCardView => ({
    award,
    kicker: `${recap.season} ${kicker}`.toUpperCase(),
    title,
    value,
    detail,
    footnote,
    champion: award === 'champion',
  })

  switch (award) {
    case 'champion': {
      if (!recap.champion) return null
      const line = recap.teamLines.find((l) => l.team.rosterId === recap.champion!.rosterId)
      const detail = recap.runnerUp ? (es ? `Venció a ${recap.runnerUp.name} en la final` : `Beat ${recap.runnerUp.name} in the final`) : null
      return view(recap.champion.name, line ? record(line.wins, line.losses, line.ties) : null, detail)
    }
    case 'runnerUp':
      return recap.runnerUp ? view(recap.runnerUp.name, null, recap.champion ? (es ? `Perdió la final contra ${recap.champion.name}` : `Lost the final to ${recap.champion.name}`) : null) : null
    case 'topSeed': {
      const t = recap.topSeed
      return t ? view(t.name, record(t.wins, t.losses, t.ties), es ? 'Mejor récord de la temporada regular' : 'Best regular-season record') : null
    }
    case 'mostPointsFor': {
      const t = recap.mostPointsFor
      return t ? view(t.name, `${pts(t.points)} pts`, es ? 'En toda la temporada' : 'Across the season') : null
    }
    case 'highestWeek': {
      const t = recap.highestWeek
      return t ? view(t.name, `${pts(t.points)} pts`, es ? `Semana ${t.week}` : `Week ${t.week}`) : null
    }
    case 'biggestBlowout':
    case 'closestGame': {
      const g = award === 'biggestBlowout' ? recap.biggestBlowout : recap.closestGame
      return g ? view(g.winner.name, es ? `por ${pts(g.margin)} pts` : `by ${pts(g.margin)} pts`, gameLine(g, lang)) : null
    }
    case 'bestTrade':
    case 'worstTrade': {
      const t = award === 'bestTrade' ? recap.bestTrade : recap.worstTrade
      if (!t) return null
      const net = Math.round(t.net)
      const partner = t.partner?.name
      return view(
        t.name,
        `${net > 0 ? '+' : ''}${net} ${es ? 'de valor' : 'value'}`,
        partner ? (es ? `Trade con ${partner}` : `Trade with ${partner}`) : null,
      )
    }
    case 'bestPickup': {
      const p = recap.bestPickup
      if (!p) return null
      return view(
        `${p.playerName}${p.position ? ` (${p.position})` : ''}`,
        `${pts(p.pointsAfter)} pts`,
        es ? `${p.name} · tras el reclamo de la semana ${p.pickupWeek}` : `${p.name} · after the week ${p.pickupWeek} pickup`,
      )
    }
    case 'mostImproved': {
      const m = recap.mostImproved
      if (!m) return null
      return m.basis === 'prior_season'
        ? view(m.name, `${Math.round(m.before * 100)}% ${es ? 'a' : 'to'} ${Math.round(m.after * 100)}%`, es ? 'Porcentaje de victorias, de la temporada pasada a esta' : 'Win rate, last season to this season')
        : view(m.name, `${pts(m.before)} ${es ? 'a' : 'to'} ${pts(m.after)}`, es ? 'Puntos por semana, de la primera mitad a la segunda' : 'Points per week, first half to second half')
    }
    case 'lowerBracket': {
      const b = recap.lowerBracket
      if (!b) return null
      if (b.mode === 'toilet_bowl') {
        return view(b.loser.name, null, es ? `Perdió la final contra ${b.winner.name}` : `Lost the final to ${b.winner.name}`, es ? 'Toilet bowl (último lugar)' : 'Toilet bowl (last place)')
      }
      return view(b.winner.name, null, es ? `Venció a ${b.loser.name} en la final` : `Beat ${b.loser.name} in the final`)
    }
  }
}

/** The awards this recap has a card for, in page order. */
export function seasonRecapCardAwards(recap: SeasonRecap): SeasonRecapCardAward[] {
  return SEASON_RECAP_CARD_AWARDS.filter((a) => seasonRecapCardView(recap, a) !== null)
}

/** Where the card's PNG is served. */
export function seasonRecapCardHref(leagueId: string, season: number, award: SeasonRecapCardAward, language?: string | null): string {
  const q = new URLSearchParams({ kind: 'season_recap', leagueId, season: String(season), award })
  if (language === 'es') q.set('lang', 'es')
  return `/api/share/rivalry-card?${q.toString()}`
}
