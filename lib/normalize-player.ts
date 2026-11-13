import { sleeperHeadshotUrl, getTeamLogoUrl, normalizeTeamAbbr, type SportKey } from './player-media-urls'

type AnyPlayerLike = Record<string, unknown>

interface NormalizedPlayer {
  id: string
  name: string
  position?: string
  teamAbbr?: string | null
  sport?: SportKey
  media: {
    headshotUrl: string | null
    teamLogoUrl: string | null
  }
}

function fallbackStableId(p: AnyPlayerLike): string {
  const name = String(p?.name || p?.full_name || '').trim()
  const pos = String(p?.position || p?.pos || '').trim()
  const team = String(p?.team || p?.teamAbbr || '').trim()
  return `fallback:${name}:${pos}:${team}`.toLowerCase()
}

export function normalizePlayer(p: AnyPlayerLike, sport: SportKey = 'nfl'): NormalizedPlayer {
  const rawId =
    String(p?.id || '').trim() ||
    String(p?.playerId || '').trim() ||
    String(p?.player_id || '').trim() ||
    String(p?.sleeper_player_id || '').trim()

  const id = rawId || fallbackStableId(p)

  const name = String(p?.name || p?.full_name || '').trim()
  const position = String(p?.position || p?.pos || '').trim() || undefined

  const teamAbbr = normalizeTeamAbbr(
    (p?.teamAbbr as string) || (p?.team as string) || (p?.pro_team as string) || null
  )

  const existingMedia = p?.media as { headshotUrl?: string; teamLogoUrl?: string } | undefined

  const headshotUrl =
    existingMedia?.headshotUrl ||
    (p?.headshotUrl as string) ||
    sleeperHeadshotUrl(id, sport)

  const teamLogoUrl =
    existingMedia?.teamLogoUrl ||
    (p?.teamLogoUrl as string) ||
    (teamAbbr ? getTeamLogoUrl(teamAbbr, sport) : null)

  return {
    id,
    name,
    position,
    teamAbbr,
    sport,
    media: {
      headshotUrl: headshotUrl ?? null,
      teamLogoUrl: teamLogoUrl ?? null,
    },
  }
}

