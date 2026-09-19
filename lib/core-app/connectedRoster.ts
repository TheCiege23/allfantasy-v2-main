import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveSleeperRosterPlayers } from '@/lib/player-identity/resolveSleeperRosterPlayers'
import { asHeadshotUrl } from './playerIdentityCompose'
import { teamLogoUrl } from './teamLogo'
import { loadCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIndexStore'
import { resolveFantraxCollegeTeam } from '@/lib/sport-teams/fantraxCollegeTeam'
import { crosswalkToSleeperIds } from './rosterIdCrosswalk'
import { lookupProviderIdentityNames } from './providerIdentityNames'

export type ConnectedRosterPlayer = {
  id: string; name: string; position: string | null; team: string | null
  imageUrl: string | null; logoUrl: string | null
}

/** Provider IDs stay in their own namespace. Never match a college player by name. */
export async function connectedRosterPlayers(platform: string, sport: string, raw: unknown[]): Promise<ConnectedRosterPlayer[]> {
  const records = raw.map((value) => typeof value === 'object' && value ? value as Record<string, unknown> : { id: String(value) })
  const ids = records.map((r) => String(r.fantraxId ?? r.id ?? ''))
  const field = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null
  const normalizedSport = ['cfb', 'ncaafb'].includes(sport.toLowerCase()) ? 'NCAAF' : sport.toUpperCase()
  const college = normalizedSport === 'NCAAF'
  const directory = college ? await loadCollegeTeamIndex().catch(() => null) : null
  if (platform !== 'fantrax') {
    const direct = ['sleeper', 'allfantasy'].includes(platform.toLowerCase())
    const crosswalk = direct ? new Map<string, string>() : await crosswalkToSleeperIds(platform, normalizedSport, ids)
    const players = await resolveSleeperRosterPlayers(direct ? ids : [...crosswalk.values()], normalizedSport)
    const names = direct ? new Map<string, { name: string }>() : await lookupProviderIdentityNames(platform, normalizedSport, ids)
    return ids.map((id) => {
      const p = players.get(direct ? id : crosswalk.get(id) ?? '')
      return { id, name: p?.name ?? names.get(id)?.name ?? `Player ${id}`, position: p?.position ?? null, team: p?.team ?? null,
        imageUrl: asHeadshotUrl(p?.imageUrl), logoUrl: teamLogoUrl(normalizedSport, p?.team) }
    })
  }
  const identities = platform === 'fantrax' && ids.length ? await prisma.playerIdentityMap.findMany({
    where: { sport: normalizedSport, fantraxId: { in: ids } },
    select: { fantraxId: true, canonicalName: true, position: true, currentTeam: true, rollingInsightsId: true, cfbdId: true },
  }).catch(() => []) : []
  const providerIds = identities.map((p) => p.rollingInsightsId).filter((id): id is string => !!id)
  const cfbdIds = identities.map((p) => p.cfbdId).filter((id): id is string => !!id)
  const images = providerIds.length || cfbdIds.length ? await prisma.sportsPlayer.findMany({
    where: { sport: normalizedSport, OR: [
      { source: 'cfbd', externalId: { in: cfbdIds } },
      { source: 'rolling_insights', externalId: { in: providerIds } },
    ] },
    select: { externalId: true, source: true, imageUrl: true },
  }).catch(() => []) : []
  return records.map((r, i) => {
    const matches = identities.filter((p) => p.fantraxId === ids[i])
    const p = matches.length === 1 ? matches[0] : null
    const team = field(r.school) ?? field(r.nflTeam) ?? field(r.team) ?? p?.currentTeam ?? null
    const school = college && directory ? resolveFantraxCollegeTeam(team ?? '', directory) : null
    const rosterPosition = field(r.position)
    const position = field(r.primaryPosition) ?? p?.position ?? (rosterPosition && !['RWT', 'SFX', 'FLEX', 'SUPER_FLEX', 'BN', 'IR'].includes(rosterPosition.toUpperCase()) ? rosterPosition : null)
    return { id: ids[i], name: field(r.name) ?? p?.canonicalName ?? `Player ${ids[i]}`,
      position, team: school?.school ?? team,
      imageUrl: asHeadshotUrl(field(r.imageUrl))
        ?? asHeadshotUrl(images.find((img) => img.source === 'cfbd' && img.externalId === p?.cfbdId)?.imageUrl)
        ?? asHeadshotUrl(images.find((img) => img.source === 'rolling_insights' && img.externalId === p?.rollingInsightsId)?.imageUrl),
      logoUrl: college ? school?.logo ?? null : teamLogoUrl(normalizedSport, team) }
  })
}
