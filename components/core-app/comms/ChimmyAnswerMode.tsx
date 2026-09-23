'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Fast / Deep — how much answer you want (Chimmy brief item 5, user decision 2026-09-16).
 *
 * The route already had five assistant modes; the /core drawer sent none, so every answer arrived as
 * `fast_take` without the reader ever choosing it. Only the two that change what you READ are offered
 * here: `fast_take` trims to the short verdict, `deep_analysis` returns the full breakdown. The other
 * three (commissioner, dynasty, DFS) only nudge prompt wording or agent choice, and a toggle that
 * visibly does nothing is worse than no toggle.
 *
 * ⚠ SAME PRICE EITHER WAY. Both modes spend the one `ai_chimmy_chat_message` rule, so the copy never
 * implies Deep costs more.
 *
 * The choice is kept per user in sessionStorage — the same lifetime as the drawer's conversations,
 * and never shared across accounts on one browser.
 */

export const CORE_ANSWER_MODES = [
  { id: 'fast_take', label: 'Fast', hint: 'The short verdict.' },
  { id: 'deep_analysis', label: 'Deep', hint: 'The full breakdown, with the reasoning.' },
] as const

export type CoreAnswerMode = (typeof CORE_ANSWER_MODES)[number]['id']

/*
 * The FULL answer by default (user decision 2026-09-23, when Claude became Chimmy's main model).
 * Fast used to be the default and cut every reply to its first paragraph, at most 280 characters —
 * which threw away most of what the model wrote. Fast stays one tap away for anyone who wants it.
 */
export const DEFAULT_CORE_ANSWER_MODE: CoreAnswerMode = 'deep_analysis'

export function isCoreAnswerMode(value: unknown): value is CoreAnswerMode {
  return CORE_ANSWER_MODES.some((m) => m.id === value)
}

const storageKey = (userId: string | null | undefined) => `af:comms:chimmy-answer-mode:${userId || 'anon'}`

export function useChimmyAnswerMode(userId: string | null | undefined): [CoreAnswerMode, (next: CoreAnswerMode) => void] {
  const [mode, setMode] = useState<CoreAnswerMode>(DEFAULT_CORE_ANSWER_MODE)

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey(userId))
      setMode(isCoreAnswerMode(saved) ? saved : DEFAULT_CORE_ANSWER_MODE)
    } catch {
      setMode(DEFAULT_CORE_ANSWER_MODE)
    }
  }, [userId])

  const choose = useCallback(
    (next: CoreAnswerMode) => {
      setMode(next)
      try {
        sessionStorage.setItem(storageKey(userId), next)
      } catch {
        /* Private mode or storage quota: the choice still holds for this drawer. */
      }
    },
    [userId],
  )

  return [mode, choose]
}

export function ChimmyAnswerModeToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: CoreAnswerMode
  onChange: (next: CoreAnswerMode) => void
  disabled?: boolean
}) {
  const current = CORE_ANSWER_MODES.find((m) => m.id === value) ?? CORE_ANSWER_MODES[0]
  return (
    <div className="af-cm-answer-mode">
      <span className="af-cm-scope-label" id="af-cm-answer-mode-label">
        Answer
      </span>
      <div className="af-cm-scope-chips" role="group" aria-labelledby="af-cm-answer-mode-label">
        {CORE_ANSWER_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="af-cm-chip"
            data-on={m.id === value}
            aria-pressed={m.id === value}
            disabled={disabled}
            title={m.hint}
            onClick={() => onChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="af-cm-scope-note">{current.hint} Same price either way.</p>
    </div>
  )
}

/** The mode the server says shaped an answer, or null when it did not say. */
export function answeredMode(meta: { mode?: unknown } | undefined | null): CoreAnswerMode | null {
  const mode = meta?.mode
  return isCoreAnswerMode(mode) ? mode : null
}

export function answeredModeLabel(mode: CoreAnswerMode | null | undefined): string | null {
  if (!mode) return null
  return mode === 'deep_analysis' ? 'Deep answer' : 'Fast answer'
}
