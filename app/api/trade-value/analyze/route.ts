import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { withApiUsage } from '@/lib/telemetry/usage'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { runTradeConsoleAnalysis } from '@/lib/trade-value-console/runTradeConsoleAnalysis'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type { TradeConsoleAnalyzeInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'
import { httpStatusForLeagueToolCode } from '@/lib/ai-tools/league-tool-access-messages'
import {
  shouldRunSharedTradeShadowCompare,
  runSharedTradeValueShadowCompare,
} from '@/lib/decision-os/trade/sharedServiceTradeValueShadowCompare'
import type { TradeValueConsoleAssetInput } from '@/lib/shared-services/trade/TradeValueConsoleShadowService'

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

      const payload: TradeConsoleAnalyzeInput = {
        ...parsed.data,
        userId,
        sportFilter: parsed.data.sportFilter as TradeConsoleAnalyzeInput['sportFilter'],
      }
      const analysisStart = Date.now()
      const out = await runTradeConsoleAnalysis(payload)
      const authoritativeDurationMs = Date.now() - analysisStart

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

      // Phase 18 — Trade Value Console shadow-compare (lib/shared-services/trade).
      // Additive only, never alters the response above. Compares each real
      // player asset's identity (and, secondarily, market value) against the
      // canonical PlayerIdentityResolver — see
      // lib/shared-services/trade/TradeValueConsoleShadowService.ts for why
      // this is scoped to identity/value rather than a full fairness-score
      // comparison. Deliberately awaited, not fire-and-forget — same
      // serverless-safety reasoning as the Waiver seam (Phase 12).
      if (shouldRunSharedTradeShadowCompare(process.env, { leagueId: parsed.data.leagueId ?? null })) {
        try {
          const isRealPlayerLine = (line: TradeConsolePlayerLine) =>
            line.pricedSource === 'fantasycalc' || line.pricedSource === 'sports_db'
          const assets: TradeValueConsoleAssetInput[] = [...out.players.give, ...out.players.get]
            .filter(isRealPlayerLine)
            .map((line) => ({
              name: line.name,
              position: line.position || null,
              team: line.team || null,
              sport: line.sport || undefined,
              authoritativeMarketValue: line.marketValue,
            }))
          await runSharedTradeValueShadowCompare({
            leagueId: parsed.data.leagueId ?? null,
            assets,
            authoritativeDurationMs,
          })
        } catch {
          // Defense in depth only — runSharedTradeValueShadowCompare itself never throws.
        }
      }

      return NextResponse.json(out)
    } catch (e) {
      console.error('[trade-value/analyze]', e)
      return NextResponse.json({ error: 'Analysis failed.' }, { status: 500 })
    }
  },
)
