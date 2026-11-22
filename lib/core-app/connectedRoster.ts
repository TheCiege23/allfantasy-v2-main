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
  /** Fantrax only: the slot the row occupies (e.g. 'QB', 'RWT', 'SFX') and its ACTIVE/RESERVE status. */
  rosterSlot?: string | null; rosterStatus?: string | null
  /** Fantrax college players: the CFBD athlete id their game stats are stored under, when known. */
  cfbdId?: string | null
  /** Fantrax college players: the Rolling Insights id their live box lines are matched through. */
  rollingInsightsId?: string | null
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
  const college = normalizedSport === 'NCAAF' || normalizedSport === 'NCAAB'
  /* The CFBD directory is football's; basketball schools reach their crest through the RI team below. */
  const directory = normalizedSport === 'NCAAF' ? await loadCollegeTeamIndex().catch(() => null) : null
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
  /* NFL identity rows are Sleeper-keyed: the face is on `SportsPlayer.sleeperId`, never `externalId`
     (the same portrait bridge `resolveProviderRosterPlayers` uses). */
  const sleeperIds = [...new Set([...identities.values()].map((p) => p.sleeperId).filter((id): id is string => !!id))]
  const images = providerIds.length || cfbdIds.length || sleeperIds.length ? await prisma.sportsPlayer.findMany({
    where: { sport: normalizedSport, OR: [
      { source: 'cfbd', externalId: { in: cfbdIds } },
      { source: 'rolling_insights', externalId: { in: providerIds } },
      ...(sleeperIds.length ? [{ sleeperId: { in: sleeperIds }, imageUrl: { not: null } }] : []),
    ] },
    select: { externalId: true, source: true, imageUrl: true, sleeperId: true, team: true },
    orderBy: { fetchedAt: 'desc' },
  }).catch(() => []) : []
  /*
   * College crests by ID, not by Fantrax's abbreviation. Fantrax writes schools as "HiPt", "GMas",
   * "Stetsn" — a vocabulary no directory holds. The player's Rolling Insights row names the school in
   * full ("High Point University"), and the RI team row of that exact name carries the crest. Measured
   * 2026-11-22: 364 of 371 RI basketball schools and 223 of 255 football schools resolve this way.
   * Basketball still falls back to the team registry, which is where its crests came from before.
   */
  const riTeamByPlayer = new Map<string, string>()
  for (const img of images) {
    if (img.source === 'rolling_insights' && img.externalId && img.team && !riTeamByPlayer.has(img.externalId)) {
      riTeamByPlayer.set(img.externalId, img.team)
    }
  }
  const riLogos = college && riTeamByPlayer.size ? new Map((await prisma.sportsTeam.findMany({
    where: { sport: normalizedSport, source: 'rolling_insights', name: { in: [...new Set(riTeamByPlayer.values())] }, logo: { not: null } },
    select: { name: true, logo: true },
  }).catch(() => [])).map((t) => [t.name, t.logo as string])) : new Map<string, string>()
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
        ?? asHeadshotUrl(images.find((img) => img.source === 'rolling_insights' && img.externalId === p?.rollingInsightsId)?.imageUrl)
        ?? (p?.sleeperId ? asHeadshotUrl(images.find((img) => img.sleeperId === p.sleeperId && img.imageUrl)?.imageUrl) : null),
      logoUrl: college
        ? school?.logo
          ?? (p?.rollingInsightsId ? riLogos.get(riTeamByPlayer.get(p.rollingInsightsId) ?? '') ?? null : null)
          ?? (normalizedSport === 'NCAAB' ? teamLogoUrl(normalizedSport, team) : null)
        : teamLogoUrl(normalizedSport, team),
      rosterSlot: rosterPosition, rosterStatus: field(r.status), cfbdId: p?.cfbdId ?? null, rollingInsightsId: p?.rollingInsightsId ?? null }
  })
}
