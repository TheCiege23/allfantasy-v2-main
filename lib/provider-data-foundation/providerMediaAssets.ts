import { prisma } from '@/lib/prisma'
import { isValidHeadshotUrl, type HeadshotProvider } from '@/lib/player-assets/resolvePlayerHeadshot'

type DbClient = typeof prisma

export type MediaKind = 'team_logo' | 'player_headshot'

export type ProviderImageCandidate = {
  kind: MediaKind
  url: string | null | undefined
  source: string | null | undefined
  variant?: 'transparent' | 'badge' | 'logo' | 'headshot' | 'thumb' | 'unknown'
  fetchedAt?: Date | null
}

export type ProviderImageDecision = {
  shouldWrite: boolean
  reason: 'candidate_invalid' | 'missing_existing' | 'candidate_better' | 'existing_better_or_equal'
  existingScore: number
  candidateScore: number
}

export type NormalizedTeamAssetInput = {
  sport: string
  teamCode: string | null
  teamName: string
  logoUrl: string | null
  logoUrlSm?: string | null
  logoUrlLg?: string | null
  logoSource: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
}

export type NormalizedPlayerHeadshotInput = {
  sport: string
  playerId: string
  playerName: string
  team?: string | null
  position?: string | null
  imageUrl: string | null
  source: HeadshotProvider | string
}

export type MediaCoverageReport = {
  sport: string
  teamLogos: number
  playerHeadshots: number
  missingTeamLogos: number
  missingPlayerHeadshots: number
  staleImages: number
  providerSourceDistribution: Record<string, number>
}

const TEAM_LOGO_SOURCE_SCORE: Record<string, number> = {
  thesportsdb: 90,
  cfbd: 84,
  api_sports: 80,
  rolling_insights: 70,
  sports_team: 55,
  unknown: 10,
}

const HEADSHOT_SOURCE_SCORE: Record<string, number> = {
  sportsdb: 95,
  thesportsdb: 95,
  apisports: 86,
  api_sports: 86,
  clearsports: 82,
  sleeper: 74,
  sportsplayer: 55,
  backfill: 50,
  unknown: 10,
}

function sourceKey(source: string | null | undefined): string {
  return String(source ?? 'unknown').trim().toLowerCase() || 'unknown'
}

export function isUsableProviderImageUrl(kind: MediaKind, url: string | null | undefined): boolean {
  if (!url) return false
  const trimmed = String(url).trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  } catch {
    return false
  }
  if (kind === 'player_headshot') return isValidHeadshotUrl(trimmed)
  if (/placeholder|blank|missing|default-avatar/i.test(trimmed)) return false
  return true
}

export function providerImageQualityScore(candidate: ProviderImageCandidate): number {
  if (!isUsableProviderImageUrl(candidate.kind, candidate.url)) return 0
  const source = sourceKey(candidate.source)
  const base =
    candidate.kind === 'team_logo'
      ? TEAM_LOGO_SOURCE_SCORE[source] ?? TEAM_LOGO_SOURCE_SCORE.unknown
      : HEADSHOT_SOURCE_SCORE[source] ?? HEADSHOT_SOURCE_SCORE.unknown
  const url = String(candidate.url ?? '').toLowerCase()
  const variantBonus =
    candidate.variant === 'transparent' || url.includes('cutout') || url.endsWith('.png')
      ? 8
      : candidate.variant === 'badge'
        ? 6
        : candidate.variant === 'headshot'
          ? 5
          : candidate.variant === 'thumb'
            ? 1
            : 0
  return base + variantBonus
}

export function decideProviderImageWrite(args: {
  kind: MediaKind
  existingUrl?: string | null
  existingSource?: string | null
  candidate: ProviderImageCandidate
  force?: boolean
}): ProviderImageDecision {
  const candidateScore = providerImageQualityScore(args.candidate)
  const existingScore = providerImageQualityScore({
    kind: args.kind,
    url: args.existingUrl,
    source: args.existingSource,
    variant: 'unknown',
  })
  if (candidateScore <= 0) {
    return { shouldWrite: false, reason: 'candidate_invalid', existingScore, candidateScore }
  }
  if (args.force) {
    return { shouldWrite: true, reason: existingScore > 0 ? 'candidate_better' : 'missing_existing', existingScore, candidateScore }
  }
  if (existingScore <= 0) {
    return { shouldWrite: true, reason: 'missing_existing', existingScore, candidateScore }
  }
  if (candidateScore > existingScore) {
    return { shouldWrite: true, reason: 'candidate_better', existingScore, candidateScore }
  }
  return { shouldWrite: false, reason: 'existing_better_or_equal', existingScore, candidateScore }
}

function normalizeSport(sport: string): string {
  return String(sport || 'NFL').trim().toUpperCase()
}

function normalizeTeamCode(code: string | null | undefined, name: string): string {
  const direct = String(code ?? '').trim().toUpperCase()
  if (direct) return direct.slice(0, 32)
  return name
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 32)
}

export function normalizeTeamAssetInput(input: NormalizedTeamAssetInput): NormalizedTeamAssetInput {
  return {
    ...input,
    sport: normalizeSport(input.sport),
    teamCode: normalizeTeamCode(input.teamCode, input.teamName),
    teamName: input.teamName.trim(),
    logoUrl: isUsableProviderImageUrl('team_logo', input.logoUrl) ? input.logoUrl!.trim() : null,
    logoUrlSm: isUsableProviderImageUrl('team_logo', input.logoUrlSm) ? input.logoUrlSm!.trim() : null,
    logoUrlLg: isUsableProviderImageUrl('team_logo', input.logoUrlLg) ? input.logoUrlLg!.trim() : null,
    logoSource: sourceKey(input.logoSource),
  }
}

export async function upsertTeamAssetIfBetter(args: {
  db?: DbClient
  input: NormalizedTeamAssetInput
  force?: boolean
}): Promise<{ written: boolean; decision: ProviderImageDecision }> {
  const db = args.db ?? prisma
  const input = normalizeTeamAssetInput(args.input)
  const existing = await (db as any).teamAsset
    .findUnique({
      where: { uniq_team_assets_sport_team_code: { sport: input.sport, teamCode: input.teamCode } },
      select: { logoUrl: true, logoSource: true },
    })
    .catch(() => null)
  const decision = decideProviderImageWrite({
    kind: 'team_logo',
    existingUrl: existing?.logoUrl ?? null,
    existingSource: existing?.logoSource ?? null,
    candidate: { kind: 'team_logo', url: input.logoUrl, source: input.logoSource, variant: 'badge' },
    force: args.force,
  })
  if (!decision.shouldWrite) return { written: false, decision }
  await (db as any).teamAsset.upsert({
    where: { uniq_team_assets_sport_team_code: { sport: input.sport, teamCode: input.teamCode } },
    update: {
      teamName: input.teamName,
      logoUrl: input.logoUrl,
      logoUrlSm: input.logoUrlSm ?? input.logoUrl,
      logoUrlLg: input.logoUrlLg ?? input.logoUrl,
      logoSource: input.logoSource,
      primaryColor: input.primaryColor ?? null,
      secondaryColor: input.secondaryColor ?? null,
    },
    create: {
      sport: input.sport,
      teamCode: input.teamCode,
      teamName: input.teamName,
      logoUrl: input.logoUrl,
      logoUrlSm: input.logoUrlSm ?? input.logoUrl,
      logoUrlLg: input.logoUrlLg ?? input.logoUrl,
      logoSource: input.logoSource,
      primaryColor: input.primaryColor ?? null,
      secondaryColor: input.secondaryColor ?? null,
    },
  })
  return { written: true, decision }
}

export async function updateSportsPlayerHeadshotIfBetter(args: {
  db?: DbClient
  input: NormalizedPlayerHeadshotInput
  force?: boolean
}): Promise<{ written: boolean; decision: ProviderImageDecision }> {
  const db = args.db ?? prisma
  const sport = normalizeSport(args.input.sport)
  const existing = await (db as any).sportsPlayer
    .findUnique({ where: { id: args.input.playerId }, select: { imageUrl: true, source: true } })
    .catch(() => null)
  const decision = decideProviderImageWrite({
    kind: 'player_headshot',
    existingUrl: existing?.imageUrl ?? null,
    existingSource: existing?.source ?? null,
    candidate: { kind: 'player_headshot', url: args.input.imageUrl, source: args.input.source, variant: 'headshot' },
    force: args.force,
  })
  if (!decision.shouldWrite) return { written: false, decision }
  await (db as any).sportsPlayer.update({
    where: { id: args.input.playerId },
    data: {
      sport,
      imageUrl: args.input.imageUrl,
      fetchedAt: new Date(),
    },
  })
  return { written: true, decision }
}

async function sourceDistribution(db: DbClient, sport: string): Promise<Record<string, number>> {
  const distribution: Record<string, number> = {}
  const [teams, players] = await Promise.all([
    (db as any).teamAsset?.groupBy?.({
      by: ['logoSource'],
      where: { sport },
      _count: { _all: true },
    }).catch(() => []) ?? [],
    (db as any).sportsPlayer?.groupBy?.({
      by: ['source'],
      where: { sport, imageUrl: { not: null } },
      _count: { _all: true },
    }).catch(() => []) ?? [],
  ])
  for (const row of teams) distribution[`team:${sourceKey(row.logoSource)}`] = Number(row._count?._all ?? 0)
  for (const row of players) distribution[`player:${sourceKey(row.source)}`] = Number(row._count?._all ?? 0)
  return distribution
}

async function count(model: unknown, args: Record<string, unknown>): Promise<number> {
  const fn = (model as { count?: Function } | null)?.count
  if (!fn) return 0
  return Number((await fn(args).catch(() => 0)) ?? 0)
}

export async function getProviderMediaCoverage(options: {
  sport: string
  db?: DbClient
  staleAfterDays?: number
  now?: Date
}): Promise<MediaCoverageReport> {
  const db = options.db ?? prisma
  const sport = normalizeSport(options.sport)
  const staleCutoff = new Date((options.now ?? new Date()).getTime() - (options.staleAfterDays ?? 30) * 24 * 60 * 60 * 1000)
  const [teamTotal, teamLogos, playerTotal, playerHeadshots, staleTeamImages, stalePlayerImages, providerSourceDistribution] =
    await Promise.all([
      count((db as any).sportsTeam, { where: { sport } }),
      count((db as any).teamAsset, { where: { sport, logoUrl: { not: null } } }),
      count((db as any).sportsPlayer, { where: { sport } }),
      count((db as any).sportsPlayer, { where: { sport, imageUrl: { not: null } } }),
      count((db as any).teamAsset, { where: { sport, logoUrl: { not: null }, lastUpdated: { lt: staleCutoff } } }),
      count((db as any).sportsPlayer, { where: { sport, imageUrl: { not: null }, fetchedAt: { lt: staleCutoff } } }),
      sourceDistribution(db, sport),
    ])
  return {
    sport,
    teamLogos,
    playerHeadshots,
    missingTeamLogos: Math.max(0, teamTotal - teamLogos),
    missingPlayerHeadshots: Math.max(0, playerTotal - playerHeadshots),
    staleImages: staleTeamImages + stalePlayerImages,
    providerSourceDistribution,
  }
}
