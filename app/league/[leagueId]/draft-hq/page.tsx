import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeague } from '@/lib/draft/access'
import { getDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { previewLotteryOdds } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { computeNeeds } from '@/lib/draft-helper/RecommendationEngine'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
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

  /*
   * The 4-up pick inventory — which slots this manager actually holds, traded picks included.
   *
   * `resolvePickOwner` is the SAME resolver the live draft room uses to label the board, so a
   * pick that reads "from @dre" here reads the same way once the draft opens. Sourcing ownership
   * anywhere else would let the planning screen and the board disagree about who owns 2.01.
   *
   * ⚠ skipRepair: true. `buildSessionSnapshot` will otherwise repair the session as a side effect
   * of being READ, and a planning screen must not mutate draft state just because someone opened
   * it. The resolver itself is pure.
   */
  let pickInventory: DraftHQData['pickInventory'] = []
  if (viewerRoster) {
    const snapshot = await buildSessionSnapshot(leagueId, new Date(), userId, {
      skipRepair: true,
    }).catch(() => null)

    if (snapshot && snapshot.slotOrder.length > 0) {
      for (let round = 1; round <= snapshot.rounds; round += 1) {
        for (let slot = 1; slot <= snapshot.teamCount; slot += 1) {
          const owner = resolvePickOwner(round, slot, snapshot.slotOrder, snapshot.tradedPicks)
          if (!owner || owner.rosterId !== viewerRoster.id) continue
          const meta = owner.tradedPickMeta
          pickInventory.push({
            label: `${round}.${String(slot).padStart(2, '0')}`,
            round,
            // A pick is "acquired" only when it started life on someone else's slot.
            acquiredFrom:
              meta && meta.originalRosterId !== viewerRoster.id
                ? meta.previousOwnerName || null
                : null,
          })
        }
      }
      pickInventory = pickInventory.slice(0, 8)
    }
  }

  /*
   * Positional need, from the same engine the draft room and autopick use — no second opinion.
   *
   * ⚠ THE ENGINE'S SCALE IS INVERTED FROM THE ONE WE DISPLAY. `computeNeeds` returns HIGH = big
   * need (unfilled starter ~88, filled 10). The handoff's bars read the other way: low is a hole,
   * high is solved. Rendering the raw value under a low-is-bad ramp would paint a manager's
   * emptiest position green, so it is converted to `100 - need` here, once, at the boundary.
   *
   * ⚠ IT IS WITHHELD RATHER THAN GUESSED WHEN THE ROSTER CANNOT BE RESOLVED. `Roster.playerData`
   * stores player IDS; positions come from a join, and this repo has real id-space hazards. A
   * failed join looks exactly like an empty roster, which would score EVERY position as a hole and
   * tell a manager their strongest slot is bare. So the bars render only when the join actually
   * resolved players.
   */
  let positionalNeed: DraftHQData['positionalNeed'] = null
  if (viewerRoster) {
    const rosterRow = await prisma.roster
      .findUnique({ where: { id: viewerRoster.id }, select: { playerData: true } })
      .catch(() => null)
    const playerIds = rosterRow ? getRosterPlayerIds(rosterRow.playerData) : []

    if (playerIds.length > 0) {
      const [players, template] = await Promise.all([
        prisma.player
          .findMany({ where: { id: { in: playerIds } }, select: { position: true } })
          .catch(() => [] as { position: string }[]),
        getEffectiveLeagueRosterTemplate(leagueId).catch(() => null),
      ])

      // A join that resolved nothing is missing data, not an empty roster.
      if (players.length > 0) {
        const rosterSlots = (template?.template?.slots ?? []).flatMap(
          (slot: { slot?: string; starterCount?: number }) =>
            Array.from({ length: Number(slot.starterCount) || 0 }, () => String(slot.slot ?? '')),
        )
        const sport = String(league.sport ?? 'NFL')
        const needs = computeNeeds(players, rosterSlots, false, [], sport, false)
        const rows = Object.entries(needs)
          .map(([position, need]) => ({ position, solved: Math.round(100 - need) }))
          .sort((a, b) => a.solved - b.solved)
        positionalNeed = {
          rows,
          resolvedPlayers: players.length,
          rosterSize: playerIds.length,
        }
      }
    }
  }

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
    pickInventory,
    positionalNeed,
    viewerHasRoster: Boolean(viewerRoster),
  }

  return <DraftHQ data={data} />
}
