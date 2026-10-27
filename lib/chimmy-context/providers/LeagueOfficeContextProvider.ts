/**
 * LeagueOfficeContextProvider — the commissioner tools, as Chimmy sees them.
 *
 * WHY THIS EXISTS. The weekly prizes, the trade review window, stat corrections, inactive manager
 * mode and the league log all shipped with no reader on the chat path, so "who won high score this
 * week?", "when does my trade go through?" and "did a stat correction change my result?" got
 * answers from nothing. This reads the same services the screens read and words them
 * (../leagueOfficeSummary.ts).
 *
 * WHO SEES WHAT — the same as the app, never more:
 *   weekly prizes        every member (lib/side-contests checks membership itself)
 *   payouts              every member sees the pot and place split; buy-ins collected are for
 *                        commissioners only (lib/payouts decides, as on the standings screen)
 *   league log           whatever readLeagueLog lets this viewer read; nothing when commish-only
 *   trades in review     a commissioner sees all of them; a member sees league-vote trades (they
 *                        vote on them) and trades their own team is in
 *   stat corrections     commissioners (the review is a commissioner screen)
 *   inactive managers    commissioners see which teams are managed or suggested; a member is told
 *                        only that their own lineup is being set
 *   eliminated lineups   every member: the league's lineup rule for teams out of the race
 *   IR auto-move         every member: whether activated IR players are moved to the bench
 *   dynasty offseason    every member: the rookie draft, taxi moves and next season's dues; the
 *                        commissioner is also told what is left in the rollover wizard
 *
 * Leagues AllFantasy runs only — the tools exist nowhere else. DB-first; never throws.
 */
import type { ChimmyContextProvider, ChimmyContextRequest, LeagueOfficeContextSlice, ProviderResult } from '@/lib/chimmy-context/types'
import { buildLeagueOfficeSummary, type LeagueOfficeInput } from '@/lib/chimmy-context/leagueOfficeSummary'

const isoMinute = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`

export class LeagueOfficeContextProvider implements ChimmyContextProvider<LeagueOfficeContextSlice> {
  readonly name = 'leagueOffice'
  /** Short: a trade can settle and a prize be decided within minutes of each other. */
  readonly defaultTtlMs = 2 * 60 * 1000

  async load(request: ChimmyContextRequest): Promise<ProviderResult<LeagueOfficeContextSlice>> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    const done = (data: LeagueOfficeContextSlice | null): ProviderResult<LeagueOfficeContextSlice> => ({ ok: true, data, fetchedAt, durationMs: Date.now() - startedAt })
    const leagueId = request.leagueId
    if (!leagueId) return done(null)

    try {
      const [{ prisma }, { resolveWriteAuthority }, { getLeagueRole }] = await Promise.all([
        import('@/lib/prisma'),
        import('@/lib/league/write-authority'),
        import('@/lib/league/permissions'),
      ])
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { platform: true, settings: true, leagueVariant: true, isDynasty: true },
      })
      if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') return done(null)
      const role = await getLeagueRole(leagueId, request.userId)
      const commissioner = role === 'commissioner' || role === 'co_commissioner'

      const [{ readSideContestsView }, { readLeagueLog }, { explainTradeReview }, { readManagedLineups }, { readPayoutsView }, { describeRule, readEliminatedLineupRule }, { describeRoundNotices, readLastRoundNotice, readRoundNoticeSettings, liveRookieOrderRaw }] = await Promise.all([
        import('@/lib/side-contests/sideContestsService'),
        import('@/lib/league-log/leagueLogService'),
        import('@/lib/redraft/tradeReviewWindow'),
        import('@/lib/inactive-manager/inactiveManagerMode'),
        import('@/lib/payouts/payoutService'),
        import('@/lib/eliminated-lineups/eliminatedLineups'),
        import('@/lib/rookie-order/roundNotices'),
      ])

      const [prizes, log, myRedraftTeam, myRoster, proposals, payoutView] = await Promise.all([
        readSideContestsView(leagueId, request.userId).catch(() => null),
        readLeagueLog(leagueId, request.userId, { limit: 8 }).catch(() => null),
        prisma.redraftRoster.findFirst({ where: { leagueId, ownerId: request.userId }, select: { id: true } }),
        prisma.roster.findFirst({ where: { leagueId, platformUserId: request.userId }, select: { id: true } }),
        prisma.redraftTradeProposal.findMany({
          where: { leagueId, status: 'pending', acceptedAt: { not: null }, vetoMode: { in: ['commissioner', 'league_vote'] } },
          select: {
            id: true, status: true, vetoMode: true, vetoThreshold: true, acceptedAt: true, expiresAt: true,
            proposerRosterId: true, receiverRosterId: true, votes: { select: { vote: true } },
          },
          orderBy: { expiresAt: 'asc' },
          take: 10,
        }),
        readPayoutsView(leagueId, request.userId).catch(() => null),
      ])
      const offseason = await this.dynastyOffseason(leagueId, request.userId, league, commissioner)
      const { readIrAutoMoveActive } = await import('@/lib/ir-activation/irAutoMoveService')
      const irAutoMove = await readIrAutoMoveActive(leagueId).catch(() => false)
      const pr = payoutView?.ok && payoutView.native ? payoutView.result : null
      const payouts: LeagueOfficeInput['payouts'] = pr && payoutView?.ok
        ? {
            final: pr.final,
            buyInCents: pr.buyInCents,
            teamCount: payoutView.teamCount,
            potCents: pr.potCents,
            weeklyReserveCents: pr.weeklyReserveCents,
            places: pr.places.map((p) => ({ place: p.place, percent: p.percent, cents: p.cents, team: p.rosterId ? pr.names[p.rosterId] ?? null : null })),
            collected: payoutView.collected,
          }
        : null

      const visible = proposals.filter(
        (p) => commissioner || p.vetoMode === 'league_vote' || (myRedraftTeam && [p.proposerRosterId, p.receiverRosterId].includes(myRedraftTeam.id)),
      )
      const ids = [...new Set(visible.flatMap((p) => [p.proposerRosterId, p.receiverRosterId]))]
      const names = ids.length
        ? new Map((await prisma.redraftRoster.findMany({ where: { id: { in: ids } }, select: { id: true, teamName: true, ownerName: true } })).map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'a team']))
        : new Map<string, string>()
      const now = Date.now()
      const trades = visible.map((p) => ({
        teams: `${names.get(p.proposerRosterId) ?? 'a team'} and ${names.get(p.receiverRosterId) ?? 'a team'}`,
        explainer: explainTradeReview(p, now, isoMinute).en,
      }))

      let correction: LeagueOfficeInput['correction'] = null
      let inactive: LeagueOfficeInput['inactive'] = null
      if (commissioner) {
        const [{ readStatCorrections }, { readInactiveManagerView }] = await Promise.all([
          import('@/lib/stat-corrections/statCorrectionService'),
          import('@/lib/inactive-manager/inactiveManagerService'),
        ])
        const [sc, view] = await Promise.all([readStatCorrections(leagueId).catch(() => null), readInactiveManagerView(leagueId).catch(() => null)])
        if (sc?.latest && sc.latest.changes.length > 0) {
          const unapplied = sc.latest.matchups.filter((m) => !m.fullyApplied)
          correction = {
            week: sc.latest.week,
            changed: sc.latest.matchups.length,
            unapplied: unapplied.length,
            flips: sc.latest.matchups.filter((m) => m.resultFlipped).length,
            automatic: Boolean(sc.extended?.enabled),
            refused: Boolean(sc.extended?.refusal),
          }
        }
        if (view?.native) {
          const label = (t: { teamName: string | null; managerName: string | null }) => t.teamName || t.managerName || 'a team'
          inactive = { managed: view.teams.filter((t) => t.managed).map(label), suggested: view.teams.filter((t) => t.suggested).map(label) }
        }
      }

      const summary = buildLeagueOfficeSummary({
        viewerRole: commissioner ? 'commissioner' : 'member',
        prizes: prizes?.ok && prizes.native ? prizes : null,
        trades,
        correction,
        inactive,
        viewerTeamManaged: Boolean(myRoster && readManagedLineups(league.settings)[myRoster.id]),
        eliminatedLineupRule: (() => {
          const rule = readEliminatedLineupRule(league.settings)
          return rule ? describeRule(rule, 'en') : null
        })(),
        rookieOrderRounds: describeRoundNotices({
          automation: liveRookieOrderRaw(league.settings).enabled === true,
          settings: readRoundNoticeSettings(league.settings),
          last: readLastRoundNotice(league.settings),
        }),
        log: log?.ok && !log.hidden ? log.entries.map((e) => ({ at: e.at, title: e.title, detail: e.detail })) : null,
        payouts,
        offseason,
        irAutoMove,
      })
      return done(summary ? { leagueId, viewerRole: commissioner ? 'commissioner' : 'member', summary } : null)
    } catch (err) {
      return { ok: false, data: null, error: err instanceof Error ? err.message.slice(0, 160) : 'league office read failed', fetchedAt, durationMs: Date.now() - startedAt }
    }
  }

  /** A dynasty league between seasons, in words; null for any other league or time of year. */
  private async dynastyOffseason(
    leagueId: string,
    userId: string,
    league: { settings: unknown; leagueVariant: string | null; isDynasty: boolean },
    commissioner: boolean,
  ): Promise<string[] | null> {
    const { renewalKindFromSelection, resolveLeagueVariantKey } = await import('@/lib/leagues/renewalPolicy')
    const settings = (league.settings as Record<string, unknown> | null) ?? {}
    const kind = renewalKindFromSelection({
      leagueVariant: league.leagueVariant,
      settings,
      selectedType: resolveLeagueVariantKey(league.leagueVariant, settings),
      isDynasty: league.isDynasty,
    })
    if (kind !== 'dynasty_family') return null
    const [{ readDynastyRolloverView }, { describeDynastyOffseason }] = await Promise.all([
      import('@/lib/season-rollover/dynastyRolloverService'),
      import('@/lib/season-rollover/dynastyRolloverWizard'),
    ])
    const view = await readDynastyRolloverView(leagueId, userId).catch(() => null)
    return view ? describeDynastyOffseason(view.input, commissioner ? 'commissioner' : 'member') : null
  }
}
