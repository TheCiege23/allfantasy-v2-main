'use client'

import { PlayerAvatar } from './PlayerAvatar'
import { teamLogoUrl as registryTeamLogoUrl } from '@/lib/core-app/teamLogo'

/**
 * A drafted / listed player's face for the draft room's text lists (my picks, recent wins, keepers,
 * the intel queue, the post-draft recap) — the same `PlayerAvatar` the pool, queue and board use.
 *
 * Those lists hold a pick or a listing rather than a pool row, so most have a photo URL at best and
 * never a crest. The crest therefore comes from the team registry for the draft's sport (a known club
 * only — `lib/core-app/teamLogo`, never a guess), and `PlayerAvatar` falls back to the abbreviation
 * chip when there is none or it fails to load, and to initials for a missing photo.
 */
export function DraftPlayerFace({
  name,
  headshotUrl,
  teamLogoUrl,
  team,
  position,
  sport,
  size = 28,
  testIdBase = 'draft-player-face',
}: {
  name: string
  headshotUrl?: string | null
  teamLogoUrl?: string | null
  team?: string | null
  position?: string | null
  sport?: string | null
  size?: number
  testIdBase?: string
}) {
  const club = team?.trim() || null
  const hasClub = Boolean(club && !/^(FA|F\/A|FREE AGENT|N\/A|-|—)$/i.test(club))
  const crest = teamLogoUrl?.trim() || (hasClub && sport ? registryTeamLogoUrl(sport, club) : null)
  return (
    <PlayerAvatar
      headshotUrl={headshotUrl ?? null}
      displayName={name}
      teamLogoUrl={crest}
      teamAbbr={hasClub ? club : null}
      position={position}
      size={size}
      testIdBase={testIdBase}
    />
  )
}
