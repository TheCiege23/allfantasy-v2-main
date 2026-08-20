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

      return NextResponse.json(out)
    } catch (e) {
      console.error('[trade-value/analyze]', e)
      return NextResponse.json({ error: 'Analysis failed.' }, { status: 500 })
    }
  },
)
