export type ChimmyAutoTradeEvalEvent = {
  eventId: string
  transactionId: string
  message: string
}

type TradeCheckRow = {
  id?: string
  transactionId?: string
  leagueId?: string
  leagueName?: string
  tradeDirection?: 'incoming' | 'outgoing' | null
  tradeStatus?: 'pending' | 'complete' | string
  aiGrade?: string | null
  aiVerdict?: string | null
  /** The one engine's analysis (`lib/decision-os/trade/legacyTradeNotificationGrade.ts`); null before the cutover. */
  aiAnalysis?: {
    grade?: string | null
    partnerGrade?: string | null
    gradeWithheld?: string | null
    expertAnalysis?: string | null
  } | null
  isNew?: boolean
}

const PROCESSED_LIMIT = 500

/**
 * The viewer's letter, from the one trade engine. The stored `aiGrade` is the SENDER's (the first roster
 * in the trade); on an incoming offer the viewer is the receiver, whose letter is the exact mirror the
 * engine stored as `partnerGrade`. Before 2026-09-27 this showed the sender's letter to the receiver.
 *
 * ⚠ NO NUMERIC SCORE. This used to turn the letter into "Trade score: 75/100" through a lookup table —
 * a second scale nobody computed. A letter is shown as a letter, and a missing one says why (an
 * ungraded trade used to default to 50/"C", indistinguishable from a real C).
 */
function viewerLetter(row: TradeCheckRow): string | null {
  const letter = row.tradeDirection === 'incoming' ? row.aiAnalysis?.partnerGrade : row.aiGrade
  const normalized = String(letter ?? '').trim().toUpperCase()
  return /^[ABCDF]$/.test(normalized) ? normalized : null
}

function tradeAnalyzerHref(leagueId?: string): string {
  if (!leagueId) return '/trade-evaluator?source=chimmy_auto_trade_eval'
  const p = new URLSearchParams({
    leagueId,
    source: 'chimmy_auto_trade_eval',
  })
  return `/trade-evaluator?${p.toString()}`
}

function parseMaybeArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  } catch {
    return []
  }
}

function readProcessedKey(sleeperUsername: string): string {
  return `af_chimmy_trade_eval_processed:${sleeperUsername.toLowerCase()}`
}

function readProcessedSet(sleeperUsername: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    return new Set(parseMaybeArray(window.localStorage.getItem(readProcessedKey(sleeperUsername))))
  } catch {
    return new Set()
  }
}

function writeProcessedSet(sleeperUsername: string, values: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    const compact = Array.from(values).slice(-PROCESSED_LIMIT)
    window.localStorage.setItem(readProcessedKey(sleeperUsername), JSON.stringify(compact))
  } catch {
    /* ignore */
  }
}

export function readAutoTradeEvalEnabled(identityKey: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    const value = window.localStorage.getItem(`af_chimmy_auto_trade_eval_enabled:${identityKey}`)
    if (value == null) return true
    return value !== '0'
  } catch {
    return true
  }
}

export function writeAutoTradeEvalEnabled(identityKey: string, enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`af_chimmy_auto_trade_eval_enabled:${identityKey}`, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export async function resolveTradeEvalIdentity(): Promise<{ sleeperUsername: string | null; identityKey: string | null }> {
  try {
    const res = await fetch('/api/user/profile', {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) return { sleeperUsername: null, identityKey: null }
    const profile = (await res.json()) as Record<string, unknown>
    const sleeperUsername =
      typeof profile.sleeperUsername === 'string' && profile.sleeperUsername.trim().length > 0
        ? profile.sleeperUsername.trim()
        : null
    if (!sleeperUsername) return { sleeperUsername: null, identityKey: null }
    return { sleeperUsername, identityKey: sleeperUsername.toLowerCase() }
  } catch {
    return { sleeperUsername: null, identityKey: null }
  }
}

function buildAutoEvalMessage(row: TradeCheckRow): string {
  const letter = viewerLetter(row)
  const leagueName = row.leagueName?.trim() || 'your league'
  const verdict = row.aiVerdict ? `Verdict: ${row.aiVerdict}.` : ''
  const withheld = row.aiAnalysis?.gradeWithheld?.trim()
  const href = tradeAnalyzerHref(row.leagueId)

  return [
    `Incoming trade/counter offer in ${leagueName}`,
    letter
      ? `Your grade: ${letter}`
      : withheld
        ? `Not graded: ${withheld}`
        : `This trade hasn't been graded yet — not enough data to grade it honestly.`,
    letter ? row.aiAnalysis?.expertAnalysis?.trim() ?? '' : '',
    verdict,
    `[Open AI Trade Analyzer for a deeper response](${href})`,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function pollIncomingTradeEvalEvents(sleeperUsername: string): Promise<ChimmyAutoTradeEvalEvent[]> {
  try {
    const res = await fetch('/api/legacy/trades/check', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sleeper_username: sleeperUsername, mark_seen: true }),
    })
    if (!res.ok) return []

    const payload = (await res.json()) as { trades?: unknown[] }
    const trades = Array.isArray(payload.trades) ? (payload.trades as TradeCheckRow[]) : []
    const processed = readProcessedSet(sleeperUsername)
    const out: ChimmyAutoTradeEvalEvent[] = []

    for (const row of trades) {
      const direction = row.tradeDirection
      const isNew = row.isNew === true
      const transactionId = row.transactionId || row.id
      if (!transactionId) continue
      if (!isNew) continue
      if (direction !== 'incoming') continue
      if (processed.has(transactionId)) continue

      const eventId = `trade-auto-${transactionId}`
      out.push({
        eventId,
        transactionId,
        message: buildAutoEvalMessage(row),
      })
      processed.add(transactionId)
    }

    writeProcessedSet(sleeperUsername, processed)
    return out
  } catch {
    return []
  }
}
