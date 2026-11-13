/** Stored at `LegacyTournament.hubSettings.aiAutomationV1` — commissioner AI toggles. */

const AI_AUTOMATION_KEYS = [
  'balance',
  'standings',
  'transitions',
  'fairness',
  'collusion',
  'tank',
] as const

type AiAutomationKey = (typeof AI_AUTOMATION_KEYS)[number]

export type AiAutomationV1State = Record<AiAutomationKey, boolean>

export function defaultAiAutomationV1(): AiAutomationV1State {
  return {
    balance: false,
    standings: false,
    transitions: false,
    fairness: false,
    collusion: false,
    tank: false,
  }
}

export function parseAiAutomationV1(raw: unknown): AiAutomationV1State {
  const base = defaultAiAutomationV1()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const o = raw as Record<string, unknown>
  const next = { ...base }
  for (const k of AI_AUTOMATION_KEYS) {
    if (typeof o[k] === 'boolean') next[k] = o[k]
  }
  return next
}
