import { prisma } from '@/lib/prisma'
import { buildDeterministicPostDraftRecap } from '@/lib/post-draft/PostDraftRecapService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

const prismaAny = prisma as any

async function upsertStoryline(input: {
  leagueId: string
  season?: number | null
  week?: number | null
  storyType: string
  title: string
  summary: string
  body?: string | null
  metadata?: Record<string, unknown>
}) {
  const existing = await prismaAny.leagueStoryline.findFirst({
    where: {
      leagueId: input.leagueId,
      season: input.season ?? null,
      week: input.week ?? null,
      storyType: input.storyType,
    },
    select: { id: true },
  })

  if (existing) {
    return prismaAny.leagueStoryline.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        summary: input.summary,
        body: input.body ?? null,
        metadata: input.metadata,
      },
    })
  }

  return prismaAny.leagueStoryline.create({
    data: {
      leagueId: input.leagueId,
      season: input.season ?? null,
      week: input.week ?? null,
      storyType: input.storyType,
      title: input.title,
      summary: input.summary,
      body: input.body ?? null,
      metadata: input.metadata,
    },
  })
}

export async function generateWeeklyLeagueArtifacts(input: {
  leagueId: string
  season: number
  week: number
}) {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    include: {
      teams: {
        orderBy: [{ currentRank: 'asc' }, { pointsFor: 'desc' }],
        take: 5,
      },
    },
  })

  if (!league) return null

  const leader = league.teams[0]
  const challenger = league.teams[1]
  const topScore = await prisma.teamPerformance.findFirst({
    where: {
      teamId: { in: league.teams.map((team) => team.id) },
      season: input.season,
      week: input.week,
    },
    orderBy: { points: 'desc' },
    include: { team: true },
  })

  await upsertStoryline({
    leagueId: league.id,
    season: input.season,
    week: input.week,
    storyType: 'weekly_storyline',
    title: `Week ${input.week} storyline`,
    summary: leader
      ? `${leader.teamName} holds the top spot in ${league.name ?? 'the league'} heading into the next cycle.`
      : `${league.name ?? 'This league'} is building its first weekly storyline.`,
    body: topScore
      ? `${topScore.team.teamName} posted the top score of the week at ${topScore.points.toFixed(1)}.`
      : 'Weekly scoring artifacts are still filling in.',
    metadata: {
      leaderTeamId: leader?.id ?? null,
      topScoreTeamId: topScore?.teamId ?? null,
    },
  })

  if (leader && challenger) {
    const existing = await prismaAny.leagueMatchupPreview.findFirst({
      where: {
        leagueId: league.id,
        season: input.season,
        week: input.week,
      },
      select: { id: true },
    })

    const previewData = {
      leagueId: league.id,
      season: input.season,
      week: input.week,
      rosterAId: leader.externalId,
      rosterBId: challenger.externalId,
      headline: `Week ${input.week}: ${leader.teamName} vs ${challenger.teamName}`,
      summary: `Top-ranked ${leader.teamName} is the headline act, while ${challenger.teamName} is the closest challenger by points for.`,
      confidenceScore: 0.62,
      metadata: {
        source: 'deterministic',
      },
    }

    if (existing) {
      await prismaAny.leagueMatchupPreview.update({
        where: { id: existing.id },
        data: previewData,
      })
    } else {
      await prismaAny.leagueMatchupPreview.create({
        data: previewData,
      })
    }
  }

  await upsertStoryline({
    leagueId: league.id,
    season: input.season,
    week: input.week,
    storyType: 'power_rankings',
    title: `Power rankings through week ${input.week}`,
    summary: league.teams
      .slice(0, 3)
      .map((team, index) => `#${index + 1} ${team.teamName}`)
      .join(' • '),
    body: leader ? `${leader.teamName} leads the league with ${leader.pointsFor.toFixed(1)} total points.` : null,
  })

  return { leagueId: league.id }
}

export async function generateDraftRecapArtifact(leagueId: string) {
  const recap = await buildDeterministicPostDraftRecap(leagueId)
  if (!recap) return null

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true },
  })

  const existing = await prismaAny.draftRecap.findFirst({
    where: {
      leagueId,
      draftSessionId: session?.id ?? null,
    },
    select: { id: true },
  })

  const payload = {
    leagueId,
    draftSessionId: session?.id ?? null,
    title: `${recap.leagueName ?? 'League'} draft recap`,
    summary: recap.sections.leagueNarrativeRecap,
    sections: recap.sections,
    metadata: {
      sport: recap.sport,
    },
    generatedBy: 'deterministic',
  }

  if (existing) {
    return prismaAny.draftRecap.update({
      where: { id: existing.id },
      data: payload,
    })
  }

  return prismaAny.draftRecap.create({
    data: payload,
  })
}

export async function generateLeagueConstitutionArtifact(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      sport: true,
      leagueVariant: true,
      settings: true,
    },
  })

  if (!league) return null

  const settings =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  const constitutionRequest =
    settings.constitution_request && typeof settings.constitution_request === 'object'
      ? (settings.constitution_request as Record<string, unknown>)
      : {}

  return upsertStoryline({
    leagueId,
    storyType: 'constitution',
    title: `${league.name ?? 'League'} constitution draft`,
    summary: `${league.sport} ${String(settings.league_type ?? league.leagueVariant ?? 'redraft')} league rules and onboarding summary.`,
    body: [
      `Trade review: ${String(settings.trade_review_mode ?? 'commissioner')}.`,
      `Playoff teams: ${String(settings.playoff_team_count ?? 'TBD')}.`,
      typeof constitutionRequest.notes === 'string' && constitutionRequest.notes.trim()
        ? `Commissioner notes: ${constitutionRequest.notes.trim()}`
        : null,
    ]
      .filter(Boolean)
      .join(' '),
    metadata: {
      source: 'deterministic',
    },
  })
}
