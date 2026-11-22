import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { getPrimaryLogoUrlForTeam } from '@/lib/sport-teams/SportTeamMetadataRegistry'

/**
 * Headshot + team logo for a mock-draft pool row.
 *
 * `/api/mock-draft/adp` has always returned `headshotUrl` and `teamLogoUrl`; the mock room's mapper
 * dropped them, which is why it showed text where the live room shows faces.
 *
 * - Headshot: `getPlayerImage` keeps a real stored headshot (rejecting data URIs and logo URLs) and
 *   otherwise derives the Sleeper CDN one for NFL ids only — NBA/NHL/MLB pools carry Rolling
 *   Insights ids, which are numeric too, and a Sleeper URL built from one shows a different person.
 * - Logo: the API's, else the team registry by abbreviation. Free agents get none.
 */
export function mockPlayerAssetUrls(input: {
  id: string
  name: string
  team: string
  sport: string
  headshotUrl?: string | null
  teamLogoUrl?: string | null
}): { headshotUrl: string | null; teamLogoUrl: string | null } {
  const headshotUrl = getPlayerImage({ imageUrl: input.headshotUrl ?? null, id: input.id, name: input.name }, input.sport)
  const logo = input.teamLogoUrl?.trim()
  const teamLogoUrl = logo ? logo : input.team ? getPrimaryLogoUrlForTeam(input.sport, input.team) : null
  return { headshotUrl, teamLogoUrl }
}
