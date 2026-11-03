import type { RuleSnapshot } from '@/lib/league-rules-explainer/types'

export type EditableFeederLeagueSettings = {
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
