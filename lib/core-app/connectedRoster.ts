import 'server-only'
import { prisma } from '@/lib/prisma'
import { asHeadshotUrl } from './playerIdentityCompose'
import { teamLogoUrl } from './teamLogo'
import { loadCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIndexStore'
import { resolveFantraxCollegeTeam } from '@/lib/sport-teams/fantraxCollegeTeam'
import {
  normalizeIdentitySport,
  resolveRosterPlayerIdentities,
} from '@/lib/player-identity/resolveRosterPlayerIdentities'

export type ConnectedRosterPlayer = {
  id: string; name: string; position: string | null; team: string | null
  imageUrl: string | null; logoUrl: string | null
}

/**
 * Provider IDs stay in their own namespace. Never match a college player by name.
 *
 * ⚠ THE PLATFORM → ID-SPACE RULE NO LONGER LIVES HERE. It moved to
 * `lib/player-identity/resolveRosterPlayerIdentities.ts`, because Chimmy's grounding needed the
 * same answer and had been getting a Sleeper-only one — the Fantrax roster this screen renders with
 * names read to the assistant as 39 anonymous ids. Two readers of one roster must not disagree
 * about who is on it.
 *
 * What stays here is what is genuinely this caller's: A LIST HAS TO RENDER SOMETHING, so an
 * unresolved id becomes `Player 06k5m`. The resolver returns `null` instead, because its other
 * caller must be able to SEE the gap rather than trust a label.
 */
export async function connectedRosterPlayers(platform: string, sport: string, raw: unknown[]): Promise<ConnectedRosterPlayer[]> {
  const records = raw.map((value) => typeof value === 'object' && value ? value as Record<string, unknown> : { id: String(value) })
  const ids = records.map((r) => String(r.fantraxId ?? r.id ?? ''))
  const field = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null
  const normalizedSport = normalizeIdentitySport(sport)
  const college = normalizedSport === 'NCAAF'
  const directory = college ? await loadCollegeTeamIndex().catch(() => null) : null
  const identities = await resolveRosterPlayerIdentities(platform, normalizedSport, ids)

  if (platform !== 'fantrax') {
    return ids.map((id) => {
      const p = identities.get(id)
      return { id, name: p?.name ?? `Player ${id}`, position: p?.position ?? null, team: p?.team ?? null,
        imageUrl: asHeadshotUrl(p?.imageUrl), logoUrl: teamLogoUrl(normalizedSport, p?.team) }
    })
  }

  /*
   * The headshot lives under a DIFFERENT provider's id than the roster holds, so it needs the
   * crosswalk ids the resolver carried through rather than a second read of the same table.
   */
  const providerIds = [...identities.values()].map((p) => p.rollingInsightsId).filter((id): id is string => !!id)
  const cfbdIds = [...identities.values()].map((p) => p.cfbdId).filter((id): id is string => !!id)
  const images = providerIds.length || cfbdIds.length ? await prisma.sportsPlayer.findMany({
    where: { sport: normalizedSport, OR: [
      { source: 'cfbd', externalId: { in: cfbdIds } },
      { source: 'rolling_insights', externalId: { in: providerIds } },
    ] },
    select: { externalId: true, source: true, imageUrl: true },
  }).catch(() => []) : []
  return records.map((r, i) => {
    const p = identities.get(ids[i]) ?? null
    const team = field(r.school) ?? field(r.nflTeam) ?? field(r.team) ?? p?.team ?? null
    const school = college && directory ? resolveFantraxCollegeTeam(team ?? '', directory) : null
    const rosterPosition = field(r.position)
    const position = field(r.primaryPosition) ?? p?.position ?? (rosterPosition && !['RWT', 'SFX', 'FLEX', 'SUPER_FLEX', 'BN', 'IR'].includes(rosterPosition.toUpperCase()) ? rosterPosition : null)
    return { id: ids[i], name: field(r.name) ?? p?.name ?? `Player ${ids[i]}`,
      position, team: school?.school ?? team,
      imageUrl: asHeadshotUrl(field(r.imageUrl))
        ?? asHeadshotUrl(images.find((img) => img.source === 'cfbd' && img.externalId === p?.cfbdId)?.imageUrl)
        ?? asHeadshotUrl(images.find((img) => img.source === 'rolling_insights' && img.externalId === p?.rollingInsightsId)?.imageUrl),
      logoUrl: college ? school?.logo ?? null : teamLogoUrl(normalizedSport, team) }
  })
}
