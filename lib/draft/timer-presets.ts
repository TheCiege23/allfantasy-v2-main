/**
 * Sleeper-style draft pick timer presets.
 * Used by:
 * - LeagueSettings.pickTimerPreset (string keys; 'custom' or 'off' supported)
 * - DraftRoom config timer_seconds (numeric seconds; 0/null treated as off)
 *
 * All preset keys map to a fixed seconds value. 'off' disables the clock.
 * 'custom' is paired with a separate amount + unit.
 */

export type TimerUnit = 'seconds' | 'minutes' | 'hours'

interface TimerPreset {
  value: string
  label: string
  seconds: number
}

export const TIMER_PRESETS: TimerPreset[] = [
  { value: '10s', label: '10 seconds', seconds: 10 },
  { value: '30s', label: '30 seconds', seconds: 30 },
  { value: '60s', label: '1 minute', seconds: 60 },
  { value: '90s', label: '90 seconds', seconds: 90 },
  { value: '120s', label: '2 minutes', seconds: 120 },
  { value: '300s', label: '5 minutes', seconds: 300 },
  { value: '600s', label: '10 minutes', seconds: 600 },
  { value: '1200s', label: '20 minutes', seconds: 1200 },
  { value: '1800s', label: '30 minutes', seconds: 1800 },
  { value: '3600s', label: '1 hour', seconds: 3600 },
  { value: '2h', label: '2 hours', seconds: 7200 },
  { value: '3h', label: '3 hours', seconds: 10800 },
  { value: '4h', label: '4 hours', seconds: 14400 },
  { value: '6h', label: '6 hours', seconds: 21600 },
  { value: '8h', label: '8 hours', seconds: 28800 },
  { value: '10h', label: '10 hours', seconds: 36000 },
  { value: '12h', label: '12 hours', seconds: 43200 },
  { value: '14h', label: '14 hours', seconds: 50400 },
  { value: '16h', label: '16 hours', seconds: 57600 },
  { value: '18h', label: '18 hours', seconds: 64800 },
  { value: '20h', label: '20 hours', seconds: 72000 },
  { value: '22h', label: '22 hours', seconds: 79200 },
  { value: '24h', label: '24 hours', seconds: 86400 },
]

const PRESET_BY_VALUE: Record<string, TimerPreset> = Object.fromEntries(
  TIMER_PRESETS.map((p) => [p.value, p]),
)

const PRESET_BY_SECONDS: Record<number, TimerPreset> = Object.fromEntries(
  TIMER_PRESETS.map((p) => [p.seconds, p]),
)

/** Custom amount validation bounds, by unit. Min 1 in any unit; cap maps to 24h total. */
export const CUSTOM_BOUNDS: Record<TimerUnit, { min: number; max: number }> = {
  seconds: { min: 1, max: 86400 },
  minutes: { min: 1, max: 1440 },
  hours: { min: 1, max: 24 },
}

export function unitToSeconds(amount: number, unit: TimerUnit): number {
  if (unit === 'seconds') return amount
  if (unit === 'minutes') return amount * 60
  return amount * 3600
}

export function validateCustom(amount: number, unit: TimerUnit): string | null {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) return 'Amount must be a whole number'
  const b = CUSTOM_BOUNDS[unit]
  if (amount < b.min || amount > b.max) return `Must be between ${b.min} and ${b.max} ${unit}`
  return null
}

export function presetSeconds(preset: string): number | null {
  if (preset === 'off') return 0
  return PRESET_BY_VALUE[preset]?.seconds ?? null
}

/** Resolve a (preset, customSeconds) pair to seconds, or null when 'off'. */
export function resolveTimerSeconds(
  preset: string,
  customSeconds: number | null | undefined,
): number | null {
  if (preset === 'off') return null
  if (preset === 'custom') {
    if (customSeconds == null || !Number.isFinite(customSeconds)) return null
    return Math.max(1, Math.min(86400, Math.floor(customSeconds)))
  }
  return PRESET_BY_VALUE[preset]?.seconds ?? null
}

/** Inverse: given seconds, find a matching preset or fall back to 'custom'. */
export function classifySeconds(seconds: number | null | undefined): {
  preset: string
  customSeconds: number | null
} {
  if (seconds == null || seconds === 0) return { preset: 'off', customSeconds: null }
  const match = PRESET_BY_SECONDS[seconds]
  if (match) return { preset: match.value, customSeconds: null }
  return { preset: 'custom', customSeconds: seconds }
}

/** Best-fit unit for displaying a custom seconds value. */
export function bestUnit(seconds: number): TimerUnit {
  if (seconds % 3600 === 0 && seconds >= 3600) return 'hours'
  if (seconds % 60 === 0 && seconds >= 60) return 'minutes'
  return 'seconds'
}

export function timerLabel(seconds: number | null | undefined): string {
  if (seconds == null || seconds === 0) return 'Off'
  const match = PRESET_BY_SECONDS[seconds]
  if (match) return match.label
  if (seconds < 60) return `Custom: ${seconds} seconds`
  if (seconds % 3600 === 0) return `Custom: ${seconds / 3600} hours`
  if (seconds % 60 === 0) return `Custom: ${seconds / 60} minutes`
  return `Custom: ${seconds} seconds`
}
