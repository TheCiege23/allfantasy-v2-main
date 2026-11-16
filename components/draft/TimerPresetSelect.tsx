'use client'

/**
 * Sleeper-style draft pick timer select. Presets + Off + custom amount/unit.
 * Controlled via `seconds` (null = off). Calls `onChange` with a new seconds value
 * (or null) once the user has chosen a valid preset / custom amount.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { TIMER_PRESETS, bestUnit, classifySeconds, resolveTimerSeconds, unitToSeconds, validateCustom, type TimerUnit } from '@/lib/draft/timer-presets'

interface Props {
  seconds: number | null
  onChange: (seconds: number | null) => void
  disabled?: boolean
  testIdPrefix?: string
}

export function TimerPresetSelect({ seconds, onChange, disabled, testIdPrefix }: Props) {
  const initial = useMemo(() => classifySeconds(seconds), [seconds])
  const [preset, setPreset] = useState<string>(initial.preset)
  const initialCustomSeconds = initial.customSeconds ?? 60
  const initialUnit: TimerUnit = bestUnit(initialCustomSeconds)
  const initialAmount =
    initialUnit === 'hours' ? initialCustomSeconds / 3600
    : initialUnit === 'minutes' ? initialCustomSeconds / 60
    : initialCustomSeconds
  const [unit, setUnit] = useState<TimerUnit>(initialUnit)
  const [amount, setAmount] = useState<number | null>(initialAmount)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const c = classifySeconds(seconds)
    // Don't downgrade from 'custom' to a preset when the user has explicitly selected 'custom'.
    setPreset((prev) => (prev === 'custom' && seconds != null && seconds !== 0 ? 'custom' : c.preset))
    if (c.preset === 'custom' && c.customSeconds != null) {
      const u = bestUnit(c.customSeconds)
      setUnit(u)
      setAmount(u === 'hours' ? c.customSeconds / 3600 : u === 'minutes' ? c.customSeconds / 60 : c.customSeconds)
    }
  }, [seconds])

  const handlePresetChange = (value: string) => {
    setPreset(value)
    setError(null)
    if (value === 'custom') {
      // Show the custom inputs; don't emit until the user blurs an amount.
      // If there isn't already a custom seconds value carried in, start from a blank
      // seconds input so typing "15" reads as "15 seconds" without fighting a default.
      const existingCustom = classifySeconds(seconds)
      if (existingCustom.preset !== 'custom') {
        setUnit('seconds')
        setAmount(null)
      }
      return
    }
    if (value === 'off') {
      onChange(null)
      return
    }
    onChange(resolveTimerSeconds(value, null))
  }

  const commitCustom = (nextAmount: number | null, nextUnit: TimerUnit) => {
    if (nextAmount == null) {
      setError(null)
      return
    }
    const err = validateCustom(nextAmount, nextUnit)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    onChange(unitToSeconds(nextAmount, nextUnit))
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <select
          value={preset}
          disabled={disabled}
          onChange={(e) => handlePresetChange(e.target.value)}
          data-testid={testIdPrefix ? `${testIdPrefix}-preset` : undefined}
          className="w-full appearance-none rounded-lg border border-white/15 bg-[#0d1526] px-4 py-2.5 pr-10 text-sm font-medium text-white disabled:cursor-default disabled:opacity-50"
        >
          {TIMER_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          <option value="off">Off</option>
          <option value="custom">Set amount</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
      </div>

      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount == null ? '' : String(amount)}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                setAmount(null)
                setError(null)
                return
              }
              // Reject anything non-digit so backspacing past a leading 0 always lands on blank.
              if (!/^\d+$/.test(raw)) return
              const next = Number.parseInt(raw, 10)
              setAmount(Number.isFinite(next) ? next : null)
            }}
            onBlur={() => commitCustom(amount, unit)}
            aria-label="Custom timer amount"
            data-testid={testIdPrefix ? `${testIdPrefix}-custom-amount` : undefined}
            className="w-24 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white disabled:opacity-50"
          />
          <div className="relative">
            <select
              value={unit}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.value as TimerUnit
                setUnit(next)
                commitCustom(amount, next)
              }}
              data-testid={testIdPrefix ? `${testIdPrefix}-custom-unit` : undefined}
              className="appearance-none rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 pr-8 text-sm text-white disabled:opacity-50"
            >
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
          </div>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-rose-300" data-testid={testIdPrefix ? `${testIdPrefix}-error` : undefined}>
          {error}
        </p>
      )}
    </div>
  )
}
