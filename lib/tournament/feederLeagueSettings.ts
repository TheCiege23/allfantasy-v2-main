import type { RuleSnapshot } from '@/lib/league-rules-explainer/types'

type EditableFeederLeagueSettings = {
  scoring: string
  rosterSize: number
  benchSize: number
  waiverType: string
  faabBudget: number
  faabResetByRound: boolean
  tradeDeadlineWeek: number
  tradeLockHours: number
}

/** The defaults and normalization used by the tournament's feeder settings editor. */
export function normalizeEditableLeagueSettings(raw: unknown): EditableFeederLeagueSettings {
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const asNumber = (value: unknown, fallback: number) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? Math.floor(n) : fallback
  }
  return {
    scoring: typeof settings.scoring === 'string' ? settings.scoring : 'PPR',
    rosterSize: asNumber(settings.rosterSize, 15),
    benchSize: asNumber(settings.benchSize, 7),
    waiverType: typeof settings.waiverType === 'string' ? settings.waiverType : 'FAAB',
    faabBudget: asNumber(settings.faabBudget, 100),
    faabResetByRound: settings.faabResetByRound !== false,
    tradeDeadlineWeek: asNumber(settings.tradeDeadlineWeek, 12),
    tradeLockHours: asNumber(settings.tradeLockHours, 0),
  }
}

/**
 * The keys the feeder editor may write into `League.settings` (2026-11-15): its own form fields, plus the league
 * chat link (checked separately by leagueChatThreadLinkRefusalInPatch).
 *
 * 🛑 THE ROUTE MERGED WHATEVER IT WAS SENT. `changes` went into `League.settings` key by key, so a crafted request
 * could overwrite anything there — the season's settings lock, the scoring panel stores, the league log
 * visibility. Anything outside this list is refused.
 */
export const FEEDER_EDITABLE_KEYS: readonly string[] = [
  'scoring', 'rosterSize', 'benchSize', 'waiverType', 'faabBudget', 'faabResetByRound', 'tradeDeadlineWeek', 'tradeLockHours',
  'leagueChatThreadId',
]

export function unknownFeederSettingsKeys(changes: Record<string, unknown>): string[] {
  return Object.keys(changes).filter((k) => !FEEDER_EDITABLE_KEYS.includes(k))
}

/** Kept separate from effective league rules because the feeder editor writes its own JSON. */
export function feederSettingsSnapshot(raw: unknown): Partial<RuleSnapshot> {
  const s = normalizeEditableLeagueSettings(raw)
  return {
    feederScoring: s.scoring.trim().toLowerCase(), feederRosterSize: s.rosterSize,
    feederBenchSize: s.benchSize, feederWaiverType: s.waiverType.trim().toLowerCase(),
    feederFaabBudget: s.faabBudget, feederFaabReset: s.faabResetByRound,
    feederTradeDeadline: s.tradeDeadlineWeek, feederTradeLockHours: s.tradeLockHours,
  }
}
