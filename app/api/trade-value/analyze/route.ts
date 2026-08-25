import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { withApiUsage } from '@/lib/telemetry/usage'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { runTradeConsoleAnalysis } from '@/lib/trade-value-console/runTradeConsoleAnalysis'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type { TradeConsoleAnalyzeInput } from '@/lib/trade-value-console/types'
import { httpStatusForLeagueToolCode } from '@/lib/ai-tools/league-tool-access-messages'
import { recordTradeSurfaceShadow } from '@/lib/decision-os/trade/surfaceShadow'
import { buildTradeContextNotes } from '@/lib/trade-intel/tradeContextNotes'

/** Every note list empty — used on both the no-league and the failure path. */
const EMPTY_CONTEXT = {
  byeNotes: [] as string[],
  needNotes: [] as string[],
  leverageNotes: [] as string[],
  postureNotes: [] as string[],
  pickNotes: [] as string[],
  scaleNotes: [] as string[],
  formatNotes: [] as string[],
}
import {
  compareConsoleVerdictWithCanonicalGrade,
  type ConsoleComparableAsset,
} from '@/lib/decision-os/trade/consoleShadowCompare'

const assetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('player'),
    playerId: z.string().optional(),
    name: z.string().optional(),
    sportHint: z.string().optional(),
  }),
  z.object({
    kind: z.literal('pick'),
    year: z.number(),
    round: z.number(),
    tier: z.enum(['early', 'mid', 'late']).optional(),
    label: z.string().optional(),
  }),
  z.object({ kind: z.literal('faab'), amount: z.number() }),
])

const SPORT_FILTER = ['ALL', ...SUPPORTED_SPORTS] as const satisfies readonly string[]

const bodySchema = z.object({
  sportFilter: z.enum(SPORT_FILTER as unknown as [string, ...string[]]),
  leagueId: z.string().nullable().optional(),
  leagueSize: z.number().min(4).max(32).optional(),
  tePremium: z.boolean().optional(),
  isSuperFlex: z.boolean().optional(),
  waiverBudget: z.number().min(0).max(10000).optional(),
  strategy: z.enum(['contender', 'rebuilder', 'win_now', 'long_term', 'neutral']),
  teamContext: z.enum(['my_team', 'team_a', 'team_b', 'neutral']),
  analysisTab: z.string().max(64).optional().default('raw'),
  sideGive: z.array(assetSchema).max(24),
  sideGet: z.array(assetSchema).max(24),
  skipAi: z.boolean().optional(),
  allowMultisportFairness: z.boolean().optional(),
  opponentTeamExternalId: z.string().min(1).max(128).nullable().optional(),
})

export const POST = withApiUsage({ endpoint: '/api/trade-value/analyze', tool: 'TradeValueConsole' })(
  async (req: Request) => {
    try {
      const ip = getClientIp(req as any) || 'unknown'
      const rl = rateLimit(`trade-value-analyze:${ip}`, 20, 60_000)
      if (!rl.success) {
        return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 })
      }

      const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
      const userId = session?.user?.id ?? null

      const json = await req.json().catch(() => null)
      const parsed = bodySchema.safeParse(json)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
      }

      // AF_TRADE_UNIFICATION_BRIEF Phase 2 (console): league-scoped analysis
      // requires an authenticated session. Anonymous use remains allowed for
      // league-less (global) analysis only.
      if (parsed.data.leagueId && !userId) {
        return NextResponse.json(
          { error: 'Sign in to analyze trades in a league context.' },
          { status: 401 },
        )
      }

      const payload: TradeConsoleAnalyzeInput = {
        ...parsed.data,
        userId,
        sportFilter: parsed.data.sportFilter as TradeConsoleAnalyzeInput['sportFilter'],
      }
      const out = await runTradeConsoleAnalysis(payload)

      // Phase 2→3 shadow instrumentation (flag-gated, never affects the
      // response). Slice 10: successful analyses now run a REAL cross-engine
      // comparison — the console's own enriched assets are re-graded by the
      // canonical value engine and the verdicts compared.
      let comparison = null
      if (out.ok) {
        try {
          const toComparable = (
            lines: typeof out.players.give,
            inputAssets: typeof parsed.data.sideGive,
          ): ConsoleComparableAsset[] => [
            ...lines.map((line) => ({
              kind: 'player' as const,
              name: line.name,
              position: line.position,
              team: line.team,
              projection: line.effectiveProjection ?? null,
              marketValue: line.marketValue,
              pricedSource: line.pricedSource,
            })),
            ...inputAssets
              .filter((a) => a.kind !== 'player')
              .map((a) =>
                a.kind === 'pick'
                  ? { kind: 'pick' as const, year: a.year, round: a.round }
                  : { kind: 'faab' as const, amount: a.amount },
              ),
          ]
          comparison = compareConsoleVerdictWithCanonicalGrade({
            give: toComparable(out.players.give, parsed.data.sideGive),
            get: toComparable(out.players.get, parsed.data.sideGet),
            consoleAdvantage: out.labels.sideAdvantage,
            context: { sport: out.effectiveSport, leagueType: out.analysisMode, scoring: null },
          })
        } catch {
          comparison = null
        }
      }
      recordTradeSurfaceShadow({
        surface: 'console',
        userId,
        leagueId: parsed.data.leagueId ?? null,
        assetsGive: parsed.data.sideGive.length,
        assetsGet: parsed.data.sideGet.length,
        surfaceVerdict: out.ok ? out.labels.sideAdvantage : `error:${out.code ?? 'unknown'}`,
        surfaceConfidence: out.ok ? out.confidenceScore : null,
        surfaceValueDeltaPct: out.ok ? out.percentDiff : null,
        surfaceAnalysisMode: out.ok ? out.analysisMode : null,
        comparison,
      })

      if (!out.ok) {
        const status =
          out.code === 'CROSS_SPORT'
            ? 422
            : out.code === 'PLAYER_NOT_FOUND'
              ? 422
              : out.code && out.code !== 'EMPTY' && out.code !== 'VALIDATION'
                ? httpStatusForLeagueToolCode(out.code)
                : 400
        return NextResponse.json(out, { status })
      }

      /*
       * The bye-week advisory. ADDITIVE AND NEVER PART OF THE VERDICT — the
       * console's own value maths decides whether a trade is fair; this says
       * what the maths cannot see, which is that the quarterback coming back is
       * off the same week as the one already on the roster.
       *
       * Best-effort by design. If anything it needs is missing the notes are
       * simply absent, because a trade screen that guesses at bye collisions
       * trains managers to ignore the warning.
       */
      /*
       * Which side receives the most valuable PLAYER, by the console's own
       * market prices. Null when neither side has a priced player or the two
       * are level — a tie is not a star arriving anywhere.
       */
      const topOf = (lines: typeof out.players.give) =>
        lines.reduce<number | null>(
          (best, l) =>
            typeof l.marketValue === 'number' && (best == null || l.marketValue > best)
              ? l.marketValue
              : best,
          null,
        )
      const topGive = topOf(out.players.give)
      const topGet = topOf(out.players.get)
      const bestPlayerSide: 'me' | 'them' | null =
        topGive == null && topGet == null
          ? null
          : (topGive ?? -1) > (topGet ?? -1)
            ? 'them'
            : (topGet ?? -1) > (topGive ?? -1)
              ? 'me'
              : null

      const context =
        parsed.data.leagueId && userId
          ? await buildTradeContextNotes({
              leagueId: parsed.data.leagueId,
              userId,
              give: out.players.give.map((l) => ({
                name: l.name,
                position: l.position,
                team: l.team,
              })),
              get: out.players.get.map((l) => ({
                name: l.name,
                position: l.position,
                team: l.team,
              })),
              opponentTeamExternalId: parsed.data.opponentTeamExternalId ?? null,
              /*
               * Picks, so each can be priced against the record of the team it
               * comes FROM. A first from the side acquiring the best player in
               * the deal is a late first, and pricing it off a round average
               * hands that side a discount on every pick they send out.
               */
              picksToMe: parsed.data.sideGet
                .filter((a) => a.kind === 'pick')
                .map((a) => ({ season: a.year, round: a.round })),
              picksToThem: parsed.data.sideGive
                .filter((a) => a.kind === 'pick')
                .map((a) => ({ season: a.year, round: a.round })),
              bestPlayerGoesTo: bestPlayerSide,
              /* The console's own prices, so unpriced exposure is measured
                 against what it actually managed to value rather than a guess
                 about which positions the feed covers. */
              pricedGive: out.players.give.map((l) => ({
                name: l.name,
                marketValue: l.marketValue,
              })),
              pricedGet: out.players.get.map((l) => ({
                name: l.name,
                marketValue: l.marketValue,
              })),
              /* Only used for the Zombie veto warning: a lopsided deal there
                 goes to an 8-hour poll and two thirds can reverse it. */
              percentDiff: out.percentDiff ?? null,
            }).catch(() => EMPTY_CONTEXT)
          : EMPTY_CONTEXT

      const hasContext =
        context.byeNotes.length > 0 ||
        context.needNotes.length > 0 ||
        context.leverageNotes.length > 0 ||
        context.postureNotes.length > 0 ||
        context.pickNotes.length > 0 ||
        context.scaleNotes.length > 0 ||
        context.formatNotes.length > 0

      return NextResponse.json(hasContext ? { ...out, ...context } : out)
    } catch (e) {
      console.error('[trade-value/analyze]', e)
      return NextResponse.json({ error: 'Analysis failed.' }, { status: 500 })
    }
  },
)
