/**
 * GET: Tournament context for a league (when league is part of a tournament).
 * Returns tournamentId, tournamentName, conferenceName, roundIndex, phase for hub banner.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTournamentConfigForLeague } from '@/lib/tournament-mode/TournamentConfigService'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { shellTournamentHeroContext } from '@/lib/tournament/shellHeroContext'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = await getTournamentConfigForLeague(leagueId)
  if (!config) {
    // A league in the newer tournament shell system (lib/tournament/shellHeroContext.ts).
    const shellLeague = await prisma.tournamentLeague.findUnique({
      where: { leagueId },
      select: {
        tournament: { select: { id: true, name: true } },
        conference: { select: { name: true, theme: true, bannerUrl: true, colorHex: true } },
        round: { select: { roundNumber: true, roundLabel: true, roundType: true } },
      },
    }).catch(() => null)
    return NextResponse.json({ tournament: shellTournamentHeroContext(shellLeague) })
  }

  const settings = config.settings as Record<string, unknown>
  const hubSettings = config.hubSettings as Record<string, unknown> | undefined
  const phase = String(config.phase ?? 'qualification').toLowerCase()
  const isElimination = phase === 'elimination'
  const benchSpots = isElimination
    ? (Number(settings.benchSpotsElimination) || 2)
    : (Number(settings.benchSpotsQualification) || 7)
  const faabReset = Boolean(settings.faabResetByRound ?? true)
  const faabBudget = Number(settings.faabBudgetDefault) || 100

  const theme = hubSettings
    ? {
        bannerUrl: (hubSettings.bannerUrl as string) ?? null,
        themePack: (hubSettings.themePack as string) ?? 'default',
        accentColor: (hubSettings.accentColor as string) ?? null,
        glowAccent: (hubSettings.glowAccent as string) ?? null,
        badgeStyle: (hubSettings.badgeStyle as string) ?? null,
      }
    : null

  return NextResponse.json({
    tournament: {
      tournamentId: config.tournamentId,
      tournamentName: config.tournamentName,
      conferenceName: config.conferenceName,
      conferenceTheme: config.conferenceTheme,
      roundIndex: config.roundIndex,
      phase: config.phase,
      roundRules: {
        benchSpots,
        faabReset,
        faabBudget,
      },
      theme,
    },
  })
}
