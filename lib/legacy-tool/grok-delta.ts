import { prisma } from '@/lib/prisma'

type GrokSignalSentiment = 'bullish' | 'bearish' | 'neutral' | 'injury_concern'

type GrokSignalInput = {
  playerName: string
  sentiment: GrokSignalSentiment | string
  news: string[]
  buzz: string
}

type GrokNormalizedDeltaEvent = {
  status: 'ok'
  event: {
    event_id: string
    entity_type: 'player' | 'team'
    entity_id: string
    event_type:
      | 'injury_update'
      | 'role_change'
      | 'depth_chart_change'
      | 'signing_update'
      | 'trade_update'
      | 'coach_signal'
      | 'sentiment_surge'
      | 'special_teams_role_change'
      | 'defensive_role_change'
    confidence: number
    state_deltas: {
      projection_delta_weekly?: number
      projection_delta_ros?: number
      market_value_delta?: number
      x_sentiment_score_delta?: number
      depth_chart_role?: string
    }
    applies_to: Array<'ranking-engine' | 'trade-engine' | 'waiver-engine' | 'lineup-engine' | 'draft-engine'>
    timestamp: string
    source: {
      provider: 'grok'
      headline: string
      details: string
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function inferEventType(signal: GrokSignalInput): GrokNormalizedDeltaEvent['event']['event_type'] {
  const text = `${signal.buzz} ${(signal.news || []).join(' ')}`.toLowerCase()
  if (/injur|out|ir\b|questionable|doubtful|surgery|concussion/.test(text)) return 'injury_update'
  if (/depth chart|promoted|demoted|wr1|rb1|starting/.test(text)) return 'depth_chart_change'
  if (/signed|signing|released|waived/.test(text)) return 'signing_update'
  if (/trade|traded|deal/.test(text)) return 'trade_update'
  if (/coach|coordinator|scheme/.test(text)) return 'coach_signal'
  return 'sentiment_surge'
}

function inferConfidence(signal: GrokSignalInput, eventType: GrokNormalizedDeltaEvent['event']['event_type']): number {
  let base = 0.66
  if (signal.sentiment === 'injury_concern') base = 0.84
  else if (signal.sentiment === 'bullish' || signal.sentiment === 'bearish') base = 0.74

  if (eventType === 'injury_update' || eventType === 'trade_update' || eventType === 'depth_chart_change') {
    base += 0.08
  }

  const evidenceBoost = clamp(((signal.news || []).length - 1) * 0.04, 0, 0.12)
  return clamp(base + evidenceBoost, 0.45, 0.96)
}

function inferDeltas(signal: GrokSignalInput): GrokNormalizedDeltaEvent['event']['state_deltas'] {
  const sentiment = signal.sentiment
  if (sentiment === 'injury_concern') {
    return {
      projection_delta_weekly: -2.5,
      projection_delta_ros: -10,
      market_value_delta: -5,
      x_sentiment_score_delta: -0.12,
    }
  }
  if (sentiment === 'bullish') {
    return {
      projection_delta_weekly: 1.2,
      projection_delta_ros: 6,
      market_value_delta: 3,
      x_sentiment_score_delta: 0.08,
    }
  }
  if (sentiment === 'bearish') {
    return {
      projection_delta_weekly: -1.1,
      projection_delta_ros: -5,
      market_value_delta: -2.5,
      x_sentiment_score_delta: -0.07,
    }
  }
  return {
    x_sentiment_score_delta: 0,
  }
}

export function normalizeGrokSignalsToDeltaEvents(signals: GrokSignalInput[]): GrokNormalizedDeltaEvent[] {
  const now = new Date().toISOString()
  return (signals || [])
    .filter((s) => s?.playerName)
    .slice(0, 40)
    .map((signal) => {
      const eventType = inferEventType(signal)
      const entityId = `nfl_${slugify(signal.playerName)}`
      const headline = signal.news?.[0] || `${signal.playerName} sentiment update`
      return {
        status: 'ok' as const,
        event: {
          event_id: `evt_${slugify(signal.playerName)}_${Date.now()}`,
          entity_type: 'player' as const,
          entity_id: entityId,
          event_type: eventType,
          confidence: inferConfidence(signal, eventType),
          state_deltas: inferDeltas(signal),
          applies_to: ['ranking-engine', 'trade-engine', 'waiver-engine', 'lineup-engine', 'draft-engine'],
          timestamp: now,
          source: {
            provider: 'grok' as const,
            headline,
            details: signal.buzz || headline,
          },
        },
      }
    })
}

export async function persistGrokDeltaEvents(events: GrokNormalizedDeltaEvent[]): Promise<number> {
  if (!events.length) return 0

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  let saved = 0

  for (const e of events) {
    const cacheKey = `legacy:grok_delta:${e.event.entity_type}:${e.event.entity_id}`
    try {
      await prisma.sportsDataCache.upsert({
        where: { cacheKey },
        update: {
          data: e as any,
          expiresAt,
        },
        create: {
          cacheKey,
          data: e as any,
          expiresAt,
        },
      })
      saved += 1
    } catch {
      // non-fatal cache write
    }
  }

  try {
    const recentKey = 'legacy:grok_delta:recent'
    const snapshot = events.map((e) => ({
      entity_id: e.event.entity_id,
      event_type: e.event.event_type,
      confidence: e.event.confidence,
      timestamp: e.event.timestamp,
      headline: e.event.source.headline,
    }))
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: recentKey },
      update: {
        data: snapshot as any,
        expiresAt,
      },
      create: {
        cacheKey: recentKey,
        data: snapshot as any,
        expiresAt,
      },
    })
  } catch {
    // non-fatal cache write
  }

  return saved
}
