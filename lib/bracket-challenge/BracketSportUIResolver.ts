import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

type BracketSportUI = {
  sport: SupportedSport
  label: string
  shortLabel: string
  badge: string
}

const SPORT_UI: Record<SupportedSport, Omit<BracketSportUI, 'sport'>> = {
  NFL: { label: 'NFL', shortLabel: 'NFL', badge: 'FB' },
  NHL: { label: 'NHL', shortLabel: 'NHL', badge: 'HK' },
  NBA: { label: 'NBA', shortLabel: 'NBA', badge: 'BK' },
  MLB: { label: 'MLB', shortLabel: 'MLB', badge: 'BS' },
  NCAAF: { label: 'NCAA Football', shortLabel: 'NCAAF', badge: 'CF' },
  NCAAB: { label: 'NCAA Basketball', shortLabel: 'NCAAB', badge: 'CB' },
  SOCCER: { label: 'Soccer', shortLabel: 'SOC', badge: 'SC' },
}

export function resolveBracketSportUI(rawSport: string | null | undefined): BracketSportUI {
  const normalizedRaw = String(rawSport ?? '').trim().toLowerCase()
  const normalized =
    normalizedRaw === 'ncaam' ? 'NCAAB' : normalizeToSupportedSport(rawSport)
  const ui = SPORT_UI[normalized]
  return {
    sport: normalized,
    label: ui.label,
    shortLabel: ui.shortLabel,
    badge: ui.badge,
  }
}

export function resolveBracketChallengeLabel(params: {
  bracketType?: string | null
  challengeType?: string | null
  sport?: string | null
}): string {
  const mode = String(params.challengeType ?? params.bracketType ?? '').toLowerCase()
  const sportUi = resolveBracketSportUI(params.sport)
  if (mode === 'mens_ncaa') return 'Classic NCAA Bracket'
  return `${sportUi.label} Playoff Challenge`
}
