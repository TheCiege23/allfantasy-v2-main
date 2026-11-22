import { deepseekQuantAnalysis } from '@/lib/deepseek-client'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { xaiChatJson, parseTextFromXaiChatCompletion } from '@/lib/xai-client'
import { compactMatchupForAi } from '@/lib/ai-matchup-engine/context'
import type { LeagueMatchupAiResult } from '@/lib/ai-matchup-engine/types'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const o = JSON.parse(t)
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function runDeepseekMatchupLayer(
  compact: Record<string, unknown>,
  leagueScoringHint: string | null,
): Promise<{ json: Record<string, unknown> | null; status: 'ok' | 'error' | 'skipped' }> {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    return { json: null, status: 'skipped' }
  }
  const prompt = [
    'Fantasy head-to-head matchup analysis. Use ONLY the JSON context below.',
    'League scoring (if any):',
    leagueScoringHint ?? 'not provided',
    '',
    'Return ONLY valid JSON with keys:',
    '- edgeSide: "left" | "right" | "even" (viewer is left.teamName)',
    '- edgeConfidencePct: number 0-100',
    '- keyPlayers: array of { "name": string, "note": string } (max 5)',
    '- upsetProbability: number 0-1 (chance underdog by projection wins)',
    '- reasoning: { "matchup": string, "usage": string, "injuries": string, "weather": string }',
    '- xFactorBullets: string[] (max 5 short items)',
    '',
    'Do not invent injuries, weather, or scores not implied by the context.',
    '',
    JSON.stringify(compact, null, 0),
  ].join('\n')

  try {
    const res = await deepseekQuantAnalysis(prompt)
    if (!res.json) return { json: null, status: 'error' }
    return { json: res.json, status: 'ok' }
  } catch {
    return { json: null, status: 'error' }
  }
}

async function runGrokMatchupLayer(
  compact: Record<string, unknown>,
): Promise<{ json: Record<string, unknown> | null; status: 'ok' | 'error' | 'skipped' }> {
  const runtimeOk = Boolean(process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim())
  if (!runtimeOk) return { json: null, status: 'skipped' }

  const system = [
    'You are Grok framing a fantasy matchup for AllFantasy.',
    'Use ONLY the JSON user payload. Output a single JSON object with keys:',
    '- narrativeAngles: string[] (max 4, spicy but family-safe, no invented stats)',
    '- trashTalkSeed: string (one short line, optional, no slurs)',
    '',
    'Do not claim real-time news you do not have.',
  ].join('\n')

  try {
    const res = await xaiChatJson({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(compact) },
      ],
      temperature: 0.35,
      maxTokens: 500,
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

function fallbackFromDeepseek(ds: Record<string, unknown> | null): LeagueMatchupAiResult | null {
  if (!ds) return null
  const edgeSide = ds.edgeSide === 'left' || ds.edgeSide === 'right' || ds.edgeSide === 'even' ? ds.edgeSide : 'even'
  const conf =
    typeof ds.edgeConfidencePct === 'number' && Number.isFinite(ds.edgeConfidencePct)
      ? Math.max(0, Math.min(100, Math.round(ds.edgeConfidencePct)))
      : 50
  const keyPlayers: Array<{ name: string; note: string }> = []
  if (Array.isArray(ds.keyPlayers)) {
    for (const p of ds.keyPlayers.slice(0, 5)) {
      if (p && typeof p === 'object' && typeof (p as { name?: string }).name === 'string') {
        keyPlayers.push({
          name: (p as { name: string }).name,
          note: typeof (p as { note?: string }).note === 'string' ? (p as { note: string }).note : '',
        })
      }
    }
  }
  const upset =
    typeof ds.upsetProbability === 'number' && Number.isFinite(ds.upsetProbability)
      ? Math.max(0, Math.min(1, ds.upsetProbability))
      : 0.25
  const xf = Array.isArray(ds.xFactorBullets) ? ds.xFactorBullets.filter((x) => typeof x === 'string').slice(0, 5) : []
  const reasoning = ds.reasoning && typeof ds.reasoning === 'object' ? (ds.reasoning as Record<string, unknown>) : {}
  const summary = [
    typeof reasoning.matchup === 'string' ? reasoning.matchup : '',
    typeof reasoning.usage === 'string' ? reasoning.usage : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    summary: summary || 'Edge is tight based on projections and current scoring in the provided snapshot.',
    edge: {
      side: edgeSide,
      confidencePct: conf,
      headline:
        edgeSide === 'even'
          ? 'Either side can take it — projections are close.'
          : edgeSide === 'left'
            ? 'Your side shows a slight structural edge in the snapshot.'
            : 'Opponent shows a slight structural edge in the snapshot.',
    },
    keyPlayers,
    upsetProbability: upset,
    xFactors: xf,
    scenarios: {
      ifNeedFloor: 'If you need a safe floor, prioritize steady volume roles over volatile deep shots.',
      ifNeedUpside: 'If you need upside, lean into game environments and projected ceilings in the snapshot.',
    },
    winProbabilityNotes:
      'Win probability moves with remaining starters and scoring format — treat live totals as partial until the week finalizes.',
    dataNotes: 'Deterministic-first analysis. Confirm injuries and inactives with official league sources.',
    providers: { openai: 'skipped', deepseek: 'ok', grok: 'skipped' },
  }
}

/**
 * Multi-provider matchup synthesis: DeepSeek (structure) + Grok (angles) + OpenAI (final JSON).
 */
export async function runLeagueMatchupAiEngine(params: {
  payload: MatchupCenterPayload
  leagueScoringHint: string | null
}): Promise<LeagueMatchupAiResult> {
  const compact = compactMatchupForAi(params.payload)

  const [dsRes, grokRes] = await Promise.all([runDeepseekMatchupLayer(compact, params.leagueScoringHint), runGrokMatchupLayer(compact)])

  const orchestrationPayload = {
    sport: params.payload.sport,
    leagueScoringHint: params.leagueScoringHint,
    matchup: compact,
    deepseek: { status: dsRes.status, output: dsRes.json },
    grok: { status: grokRes.status, output: grokRes.json },
  }

  const oa = await openaiChatJson({
    messages: [
      {
        role: 'system',
        content: [
          'You are Chimmy, AllFantasy’s calm fantasy strategist.',
          'You receive structured provider outputs and a deterministic matchup snapshot.',
          'Rules:',
          '- Never invent injuries, weather, betting lines, or scores.',
          '- Be concise and actionable; include scenario lines for floor vs upside.',
          '- Output ONLY one JSON object with keys:',
          '  "summary" (string, 2-4 sentences)',
          '  "edge": { "side": "left"|"right"|"even", "confidencePct": number, "headline": string }',
          '  "keyPlayers": [ { "name": string, "note": string } ] (max 5)',
          '  "upsetProbability": number 0-1',
          '  "xFactors": string[] (max 5)',
          '  "scenarios": { "ifNeedFloor": string, "ifNeedUpside": string }',
          '  "winProbabilityNotes": string',
          '  "dataNotes": string (caveats)',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify(orchestrationPayload, null, 2) },
    ],
    temperature: 0.35,
    maxTokens: 1200,
    skipCache: true,
  })

  if (oa.ok) {
    const parsed = parseJsonContentFromChatCompletion(oa.json)
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>
      const edge = p.edge && typeof p.edge === 'object' ? (p.edge as Record<string, unknown>) : {}
      const side = edge.side === 'left' || edge.side === 'right' || edge.side === 'even' ? edge.side : 'even'
      const conf =
        typeof edge.confidencePct === 'number' && Number.isFinite(edge.confidencePct)
          ? Math.max(0, Math.min(100, Math.round(edge.confidencePct)))
          : 55
      const scenarios = p.scenarios && typeof p.scenarios === 'object' ? (p.scenarios as Record<string, unknown>) : {}
      const keyPlayers: Array<{ name: string; note: string }> = []
      if (Array.isArray(p.keyPlayers)) {
        for (const k of p.keyPlayers.slice(0, 5)) {
          if (k && typeof k === 'object') {
            const o = k as Record<string, unknown>
            if (typeof o.name === 'string') {
              keyPlayers.push({ name: o.name, note: typeof o.note === 'string' ? o.note : '' })
            }
          }
        }
      }
      const upset =
        typeof p.upsetProbability === 'number' && Number.isFinite(p.upsetProbability)
          ? Math.max(0, Math.min(1, p.upsetProbability))
          : 0.3
      const xFactors = Array.isArray(p.xFactors) ? p.xFactors.filter((x) => typeof x === 'string').slice(0, 5) : []

      return {
        summary: typeof p.summary === 'string' ? p.summary : '',
        edge: {
          side,
          confidencePct: conf,
          headline: typeof edge.headline === 'string' ? edge.headline : 'Matchup outlook',
        },
        keyPlayers,
        upsetProbability: upset,
        xFactors,
        scenarios: {
          ifNeedFloor: typeof scenarios.ifNeedFloor === 'string' ? scenarios.ifNeedFloor : '',
          ifNeedUpside: typeof scenarios.ifNeedUpside === 'string' ? scenarios.ifNeedUpside : '',
        },
        winProbabilityNotes: typeof p.winProbabilityNotes === 'string' ? p.winProbabilityNotes : '',
        dataNotes: typeof p.dataNotes === 'string' ? p.dataNotes : '',
        providers: {
          openai: 'ok',
          deepseek: dsRes.status === 'ok' ? 'ok' : dsRes.status === 'skipped' ? 'skipped' : 'error',
          grok: grokRes.status === 'ok' ? 'ok' : grokRes.status === 'skipped' ? 'skipped' : 'error',
        },
      }
    }
  }

  const fb = fallbackFromDeepseek(dsRes.json)
  if (fb) {
    return {
      ...fb,
      providers: {
        ...fb.providers,
        deepseek: dsRes.status === 'ok' ? 'ok' : dsRes.status === 'skipped' ? 'skipped' : 'error',
        grok: grokRes.status === 'ok' ? 'ok' : grokRes.status === 'skipped' ? 'skipped' : 'error',
      },
    }
  }

  return {
    summary:
      'AI providers are not fully available. Use projections and live scoring in the matchup card as your primary guide.',
    edge: { side: 'even', confidencePct: 40, headline: 'Insufficient Chimmy signal — lean on your board and league settings.' },
    keyPlayers: [],
    upsetProbability: 0.35,
    xFactors: [],
    scenarios: {
      ifNeedFloor: 'If you need floor, favor high-floor roles with stable snap/minutes.',
      ifNeedUpside: 'If you need upside, favor volatile ceilings when chasing a deficit.',
    },
    winProbabilityNotes: 'Reconnect when Chimmy providers are configured (OpenAI / DeepSeek / xAI).',
    dataNotes: 'No deterministic Chimmy bundle produced.',
    providers: {
      openai: oa.ok ? 'error' : 'skipped',
      deepseek: dsRes.status,
      grok: grokRes.status,
    },
  }
}
