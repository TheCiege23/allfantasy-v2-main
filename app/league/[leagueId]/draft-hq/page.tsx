import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeague } from '@/lib/draft/access'
import { getDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { previewLotteryOdds } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import DraftHQ, { type DraftHQData } from '@/components/draft-hq/DraftHQ'

/**
 * 8a — Draft HQ. The PRE-draft planning surface: lottery odds, your prepared queue, the draft
 * settings this league actually runs, and where the last mock left off.
 *
 * ⚠ THIS IS A NEW ROUTE, AND DELIBERATELY NOT `/league/[leagueId]/draft`.
 * That path is not a screen — it is a resolver. It creates or updates the DraftSession,
 * materializes slots for drafts we run (and pointedly does NOT for Sleeper-mirrored ones),
 * prewarms the player pool, resolves the Sleeper draft id, and then redirects to
 * `/drafts/{sessionId}`, the live room. Rendering a planning screen there would delete the only
 * path into the draft room from league nav. 8a's own nav lists "Draft HQ" and "War Room" as two
 * separate items, so the resolver is War Room's entry and this sits beside it.
 *
 * ⚠ IT IS ALSO NOT `/draft-helper`. That route is a public SEO landing page registered in
 * AI_TOOL_PAGES, and replacing it would remove an indexable marketing surface.
 */

export const dynamic = 'force-dynamic'

export default async function DraftHQPage({
  params,
}: {
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params
  if (!leagueId) redirect('/dashboard')

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/draft-hq`)}`)
  }

  if (!(await canAccessLeague(leagueId, userId))) redirect('/dashboard')

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, leagueSize: true, leagueType: true, platform: true },
  })
  if (!league) redirect('/dashboard')

  /*
   * The viewer's own roster. Keyed on `Roster.platformUserId`, the column
   * `resolveLeagueMembership` treats as canonical — `Roster` has no `userId`, and
   * `LeagueTeam.platformUserId` is the nullable lookalike that must never prove identity.
   */
  const viewerRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })

  /*
   * Lottery odds come from previewLotteryOdds — the engine's READ-ONLY path. It computes weights
   * and odds without drawing, so opening this screen can never alter a draft order. Running the
   * lottery stays a commissioner action, seeded and auditable, and is not offered here.
   */
  const { draftOrderMode, lotteryConfig, lotteryLastRunAt } =
    await getDraftOrderModeAndLotteryConfig(leagueId)

  let lottery: DraftHQData['lottery'] = null
  if (draftOrderMode === 'weighted_lottery') {
    const preview = await previewLotteryOdds(leagueId, lotteryConfig).catch(() => null)
    if (preview) {
      lottery = {
        pickCount: lotteryConfig.lotteryPickCount,
        playoffTeamCount: preview.playoffTeamCount,
        alreadyRunAt: lotteryLastRunAt,
        message: preview.message ?? null,
        teams: preview.eligible.map((t) => ({
          rosterId: t.rosterId,
          name: t.displayName,
          record: t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`,
          weight: t.weight,
          oddsPercent: t.oddsPercent,
          isViewer: viewerRoster ? t.rosterId === viewerRoster.id : false,
        })),
      }
    }
  }

  /*
   * The prepared queue is the manager's OWN saved shortlist for this league's draft, not a
   * universal big board. Only the unconsumed entries matter before the draft; a consumed row is a
   * player already off the board.
   */
  const redraftDraft = await prisma.redraftDraft
    .findFirst({ where: { leagueId }, select: { id: true } })
    .catch(() => null)

  const queue =
    redraftDraft && viewerRoster
      ? await prisma.redraftDraftQueue.findMany({
          where: { draftId: redraftDraft.id, rosterId: viewerRoster.id, isConsumed: false },
          orderBy: { rank: 'asc' },
          take: 10,
          select: { id: true, rank: true, playerName: true, position: true, team: true },
        })
      : []

  /* Where the last mock left off. Null when the manager has never run one — never a fake date. */
  const lastMock = await prisma.mockDraft
    .findFirst({
      where: { leagueId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, rounds: true, status: true },
    })
    .catch(() => null)

  const data: DraftHQData = {
    leagueId,
    leagueName: league.name ?? 'Your league',
    platform: league.platform,
    settings: {
      leagueType: league.leagueType,
      teamCount: league.leagueSize,
      orderMode: draftOrderMode,
      lotteryPickCount:
        draftOrderMode === 'weighted_lottery' ? lotteryConfig.lotteryPickCount : null,
    },
    lottery,
    queue: queue.map((q) => ({
      id: q.id,
      rank: q.rank,
      playerName: q.playerName ?? 'Unnamed player',
      position: q.position,
      team: q.team,
    })),
    lastMock: lastMock
      ? { id: lastMock.id, createdAt: lastMock.createdAt.toISOString(), rounds: lastMock.rounds }
      : null,
    viewerHasRoster: Boolean(viewerRoster),
  }

  /*
   * The handoff's 4-up pick inventory ("1.04 · your first pick", "2.01 from @dre") is NOT built:
   * it needs per-pick OWNERSHIP including traded picks, and nothing in this league's data models
   * that today. Inventing slot numbers on the one screen whose promise is "every number here is
   * this league's" would be the worst possible place to guess.
   */
  return <DraftHQ data={data} />
}
