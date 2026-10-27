/**
 * Share cards for the season recap: the champion, and each award the recap computed. PURE.
 *
 * ⚠ EVERY LINE ON A CARD IS A LINE THE RECAP PAGE ALREADY SHOWS (components/league/SeasonRecapView.tsx),
 * built from the same stored recap and the same translation keys. Nothing is added for the image, and an
 * award the recap left out has no card (the route answers 404 rather than drawing a blank).
 */
import { translations } from '@/lib/i18n/translations'
import { interpolateTemplate } from '@/lib/i18n/interpolate'
import type { SeasonRecap, RecapGameAward } from './computeSeasonRecap'
import type { RecapLanguage } from './seasonRecapFacts'

export const RECAP_CARD_KINDS = [
  'champion',
  'runnerUp',
  'topSeed',
  'mostPointsFor',
  'highestWeek',
  'biggestBlowout',
  'closestGame',
  'bestTrade',
  'bestPickup',
  'mostImproved',
] as const
export type RecapCardKind = (typeof RECAP_CARD_KINDS)[number]

export function isRecapCardKind(v: unknown): v is RecapCardKind {
  return typeof v === 'string' && (RECAP_CARD_KINDS as readonly string[]).includes(v)
}

export type RecapCardView = {
  kind: RecapCardKind
  season: number
  /** "2026 season recap" */
  eyebrow: string
  /** "Champion" */
  label: string
  /** The team (or player) the card is about. */
  value: string
  detail: string | null
}

const pts = (n: number) => n.toFixed(1)

function translator(lang: RecapLanguage) {
  const dict = translations[lang] ?? translations.en
  return (key: string, vars: Record<string, string | number> = {}) =>
    interpolateTemplate(dict[key] ?? translations.en[key] ?? key, vars)
}

export function recapCardView(recap: SeasonRecap, kind: RecapCardKind, lang: RecapLanguage): RecapCardView | null {
  const t = translator(lang)
  const base = { kind, season: recap.season, eyebrow: t('seasonRecap.title', { season: recap.season }) }
  const game = (g: RecapGameAward) =>
    t('seasonRecap.gameLine', { winner: g.winner.name, loser: g.loser.name, ws: pts(g.winnerScore), ls: pts(g.loserScore), week: g.week })
  switch (kind) {
    case 'champion':
      return recap.champion ? { ...base, label: t('seasonRecap.champion'), value: recap.champion.name, detail: recap.runnerUp ? t('seasonRecap.cardBeat', { team: recap.runnerUp.name }) : null } : null
    case 'runnerUp':
      return recap.runnerUp ? { ...base, label: t('seasonRecap.runnerUp'), value: recap.runnerUp.name, detail: null } : null
    case 'topSeed': {
      const s = recap.topSeed
      return s ? { ...base, label: t('seasonRecap.topSeed'), value: s.name, detail: `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` } : null
    }
    case 'mostPointsFor':
      return recap.mostPointsFor ? { ...base, label: t('seasonRecap.mostPointsFor'), value: recap.mostPointsFor.name, detail: t('seasonRecap.points', { points: pts(recap.mostPointsFor.points) }) } : null
    case 'highestWeek': {
      const h = recap.highestWeek
      return h ? { ...base, label: t('seasonRecap.highestWeek'), value: h.name, detail: t('seasonRecap.weekPoints', { points: pts(h.points), week: h.week }) } : null
    }
    case 'biggestBlowout':
      return recap.biggestBlowout ? { ...base, label: t('seasonRecap.biggestBlowout'), value: t('seasonRecap.margin', { margin: pts(recap.biggestBlowout.margin) }), detail: game(recap.biggestBlowout) } : null
    case 'closestGame':
      return recap.closestGame ? { ...base, label: t('seasonRecap.closestGame'), value: t('seasonRecap.margin', { margin: pts(recap.closestGame.margin) }), detail: game(recap.closestGame) } : null
    case 'bestTrade': {
      const b = recap.bestTrade
      return b ? { ...base, label: t('seasonRecap.bestTrade'), value: b.name, detail: t('seasonRecap.tradeLine', { net: `+${Math.round(b.net)}`, partner: b.partner?.name ?? '—' }) } : null
    }
    case 'bestPickup': {
      const p = recap.bestPickup
      return p
        ? {
            ...base,
            label: t('seasonRecap.bestPickup'),
            value: `${p.playerName}${p.position ? ` (${p.position})` : ''}`,
            detail: t('seasonRecap.pickupLine', { team: p.name, points: pts(p.pointsAfter), week: p.pickupWeek }),
          }
        : null
    }
    case 'mostImproved': {
      const m = recap.mostImproved
      if (!m) return null
      const detail =
        m.basis === 'prior_season'
          ? t('seasonRecap.improvedPrior', { before: Math.round(m.before * 100), after: Math.round(m.after * 100) })
          : t('seasonRecap.improvedHalf', { before: pts(m.before), after: pts(m.after) })
      return { ...base, label: t('seasonRecap.mostImproved'), value: m.name, detail }
    }
  }
}

/** The cards this recap can draw, in page order. */
export function availableRecapCards(recap: SeasonRecap): RecapCardKind[] {
  return RECAP_CARD_KINDS.filter((k) => recapCardView(recap, k, 'en') !== null)
}

export function recapCardHref(leagueId: string, season: number, kind: RecapCardKind, lang: RecapLanguage): string {
  return `/api/share/season-recap-card?leagueId=${encodeURIComponent(leagueId)}&season=${season}&card=${kind}&lang=${lang}`
}
