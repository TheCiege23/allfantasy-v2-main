import { deepseekQuantAnalysis } from '@/lib/deepseek-client'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { xaiChatJson, parseTextFromXaiChatCompletion } from '@/lib/xai-client'
import { compactPlayerSlotForAi } from '@/lib/ai-matchup-engine/context'
import type { MatchupPlayerSlot } from '@/lib/matchup-center/types'
import type { StartSitAiResult } from '@/lib/ai-matchup-engine/types'

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const o = JSON.parse(t)
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function runDeepseekStartSit(
  sport: string,
  playerA: Record<string, unknown>,
  playerB: Record<string, unknown>,
  leagueScoringHint: string | null,
): Promise<{ json: Record<string, unknown> | null; status: 'ok' | 'error' | 'skipped' }> {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) return { json: null, status: 'skipped' }

  const prompt = [
    `Sport: ${sport} (fantasy start/sit).`,
    'League scoring hint:',
    leagueScoringHint ?? 'not provided',
    '',
    'Compare playerA vs playerB using ONLY these objects:',
    JSON.stringify({ playerA, playerB }, null, 0),
    '',
    'Return ONLY JSON:',
    '- recommendation: "playerA" | "playerB" | "even"',
    '- confidencePct: 0-100',
    '- reasoning: { matchup, usage, injuries, weather } (each string; weather N/A for indoor if obvious)',
    '- volatilityA volatilityB: "low"|"medium"|"high"',
    '- trendA trendB: "hot"|"cold"|"neutral"',
    '- winProbabilityInfluence: short string (how pick affects win odds qualitatively)',
    '',
    'Do not invent injuries or weather; use null fields as unknown.',
  ].join('\n')

  try {
    const res = await deepseekQuantAnalysis(prompt)
    if (!res.json) return { json: null, status: 'error' }
    return { json: res.json, status: 'ok' }
  } catch {
    return { json: null, status: 'error' }
  }
}

async function runGrokStartSit(
  sport: string,
  playerA: Record<string, unknown>,
  playerB: Record<string, unknown>,
): Promise<{ json: Record<string, unknown> | null; status: 'ok' | 'error' | 'skipped' }> {
  const runtimeOk = Boolean(process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim())
  if (!runtimeOk) return { json: null, status: 'skipped' }

  const system = [
    'You help compare two fantasy players for the same position/week.',
    'Output one JSON object: { "angles": string[] } with max 3 short comparison angles.',
    'Use only the user payload. No invented injuries or scores.',
    `Sport: ${sport}`,
  ].join('\n')

  try {
    const res = await xaiChatJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ playerA, playerB }) },
      ],
      temperature: 0.3,
      maxTokens: 400,
      responseFormat: { type: 'json_object' },
      skipCache: true,
    })
    if (!res.ok) return { json: null, status: 'error' }
    const text = parseTextFromXaiChatCompletion(res.json)
    if (!text) return { json: null, status: 'error' }
    const parsed = safeJsonParse(text)
    return parsed ? { json: parsed, status: 'ok' } : { json: null, status: 'error' }
  } catch {
    return { json: null, status: 'error' }
  }
}

function coerceVol(v: unknown): 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'medium' || v === 'high' ? v : 'medium'
}

function coerceTrend(v: unknown): 'hot' | 'cold' | 'neutral' {
  return v === 'hot' || v === 'cold' || v === 'neutral' ? v : 'neutral'
}

export async function runStartSitAiEngine(params: {
  sport: string
  playerA: MatchupPlayerSlot
  playerB: MatchupPlayerSlot
  leagueScoringHint: string | null
}): Promise<StartSitAiResult> {
  const a = compactPlayerSlotForAi(params.playerA)
  const b = compactPlayerSlotForAi(params.playerB)

  const [dsRes, grokRes] = await Promise.all([
    runDeepseekStartSit(params.sport, a, b, params.leagueScoringHint),
    runGrokStartSit(params.sport, a, b),
  ])

  const bundle = {
    sport: params.sport,
    playerA: a,
    playerB: b,
    leagueScoringHint: params.leagueScoringHint,
    deepseek: { status: dsRes.status, output: dsRes.json },
    grok: { status: grokRes.status, output: grokRes.json },
  }

  const oa = await openaiChatJson({
    messages: [
      {
        role: 'system',
        content: [
          'You are Chimmy. Merge start/sit signals into ONE JSON object.',
          'Keys:',
          '- recommendation: "playerA"|"playerB"|"even"',
          '- confidencePct: number',
          '- reasoning: { matchup, usage, injuries, weather }',
          '- playerOutlook: {',
          '    playerA: { restOfGame, volatility, trend },',
          '    playerB: { restOfGame, volatility, trend }',
          '  }',
          '- scenarios: { ifNeedFloor, ifNeedUpside } — scenario-based coaching lines',
          '- winProbabilityInfluence: string',
          '- dataNotes: string',
          '',
          'Never invent facts; cite uncertainty when data is missing.',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify(bundle, null, 2) },
    ],
    temperature: 0.3,
    maxTokens: 1100,
    skipCache: true,
  })

  if (oa.ok) {
    const parsed = parseJsonContentFromChatCompletion(oa.json)
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>
      const rec =
        p.recommendation === 'playerA' || p.recommendation === 'playerB' || p.recommendation === 'even'
          ? p.recommendation
          : 'even'
      const conf =
        typeof p.confidencePct === 'number' && Number.isFinite(p.confidencePct)
          ? Math.max(0, Math.min(100, Math.round(p.confidencePct)))
          : 50
      const reasoning = p.reasoning && typeof p.reasoning === 'object' ? (p.reasoning as Record<string, unknown>) : {}
      const outlook = p.playerOutlook && typeof p.playerOutlook === 'object' ? (p.playerOutlook as Record<string, unknown>) : {}
      const oaSlot = outlook.playerA && typeof outlook.playerA === 'object' ? (outlook.playerA as Record<string, unknown>) : {}
      const obSlot = outlook.playerB && typeof outlook.playerB === 'object' ? (outlook.playerB as Record<string, unknown>) : {}
      const scenarios = p.scenarios && typeof p.scenarios === 'object' ? (p.scenarios as Record<string, unknown>) : {}

      return {
        recommendation: rec,
        confidencePct: conf,
        reasoning: {
          matchup: typeof reasoning.matchup === 'string' ? reasoning.matchup : '',
          usage: typeof reasoning.usage === 'string' ? reasoning.usage : '',
          injuries: typeof reasoning.injuries === 'string' ? reasoning.injuries : '',
          weather: typeof reasoning.weather === 'string' ? reasoning.weather : '',
        },
        playerOutlook: {
          playerA: {
            restOfGame: typeof oaSlot.restOfGame === 'string' ? oaSlot.restOfGame : '',
            volatility: coerceVol(oaSlot.volatility),
            trend: coerceTrend(oaSlot.trend),
          },
          playerB: {
            restOfGame: typeof obSlot.restOfGame === 'string' ? obSlot.restOfGame : '',
            volatility: coerceVol(obSlot.volatility),
            trend: coerceTrend(obSlot.trend),
          },
        },
        scenarios: {
          ifNeedFloor: typeof scenarios.ifNeedFloor === 'string' ? scenarios.ifNeedFloor : '',
          ifNeedUpside: typeof scenarios.ifNeedUpside === 'string' ? scenarios.ifNeedUpside : '',
        },
        winProbabilityInfluence: typeof p.winProbabilityInfluence === 'string' ? p.winProbabilityInfluence : '',
        dataNotes: typeof p.dataNotes === 'string' ? p.dataNotes : '',
        providers: {
          openai: 'ok',
          deepseek: dsRes.status === 'ok' ? 'ok' : dsRes.status === 'skipped' ? 'skipped' : 'error',
          grok: grokRes.status === 'ok' ? 'ok' : grokRes.status === 'skipped' ? 'skipped' : 'error',
        },
      }
    }
  }

  const ds = dsRes.json
  if (ds) {
    const rec =
      ds.recommendation === 'playerA' || ds.recommendation === 'playerB' || ds.recommendation === 'even'
        ? ds.recommendation
        : 'even'
    const conf =
      typeof ds.confidencePct === 'number' && Number.isFinite(ds.confidencePct)
        ? Math.max(0, Math.min(100, Math.round(ds.confidencePct)))
        : 52
    const reasoning = ds.reasoning && typeof ds.reasoning === 'object' ? (ds.reasoning as Record<string, unknown>) : {}
    return {
      recommendation: rec,
      confidencePct: conf,
      reasoning: {
        matchup: typeof reasoning.matchup === 'string' ? reasoning.matchup : '',
        usage: typeof reasoning.usage === 'string' ? reasoning.usage : '',
        injuries: typeof reasoning.injuries === 'string' ? reasoning.injuries : '',
        weather: typeof reasoning.weather === 'string' ? reasoning.weather : '',
      },
      playerOutlook: {
        playerA: {
          restOfGame: 'See projection vs actual in snapshot.',
          volatility: coerceVol(ds.volatilityA),
          trend: coerceTrend(ds.trendA),
        },
        playerB: {
          restOfGame: 'See projection vs actual in snapshot.',
          volatility: coerceVol(ds.volatilityB),
          trend: coerceTrend(ds.trendB),
        },
      },
      scenarios: {
        ifNeedFloor: 'If you need floor, favor the steadier projection and role.',
        ifNeedUpside: 'If you need upside, favor the higher ceiling environment if health is clear.',
      },
      // No invented default: absent model output stays absent (empty renders nothing).
      winProbabilityInfluence:
        typeof ds.winProbabilityInfluence === 'string' ? ds.winProbabilityInfluence : '',
      dataNotes: 'OpenAI synthesis unavailable — showing structured DeepSeek output only.',
      providers: { openai: 'error', deepseek: 'ok', grok: grokRes.status === 'ok' ? 'ok' : grokRes.status === 'skipped' ? 'skipped' : 'error' },
    }
  }

  return {
    recommendation: 'even',
    confidencePct: 40,
    reasoning: { matchup: '', usage: '', injuries: '', weather: '' },
    playerOutlook: {
      playerA: { restOfGame: '', volatility: 'medium', trend: 'neutral' },
      playerB: { restOfGame: '', volatility: 'medium', trend: 'neutral' },
    },
    scenarios: {
      ifNeedFloor: 'Prefer safer roles when protecting a lead.',
      ifNeedUpside: 'Prefer ceiling when chasing points.',
    },
    winProbabilityInfluence: 'Configure AI keys for full analysis.',
    dataNotes: 'Providers unavailable.',
    providers: {
      openai: 'error',
      deepseek: dsRes.status,
      grok: grokRes.status,
    },
  }
}
