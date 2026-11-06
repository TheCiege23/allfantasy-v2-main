'use client'

import type { ReactNode } from 'react'

import './af-primitives.css'

export type FilterChipOption<T extends string> = {
  id: T
  label: ReactNode
  /** An optional count beside the label; 0 is shown, absent is not. */
  count?: number
  testId?: string
  /** `data-*` hooks a screen's stylesheet keys on (`{ pos: 'QB' }` → `data-pos="QB"`, the position colour). */
  data?: Record<string, string | undefined>
}

function dataAttrs(data: FilterChipOption<string>['data']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data ?? {})) if (v != null) out[`data-${k}`] = v
  return out
}

/**
 * A single-choice row of pill buttons. The pressed pill (`aria-pressed`) is the selection, so the
 * state is announced and styled from one attribute. `scrollOnPhone` keeps a long row on one line
 * that scrolls sideways at phone widths instead of wrapping into a tall block.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  scrollOnPhone = false,
  className,
}: {
  options: Array<FilterChipOption<T>>
  value: T
  onChange: (next: T) => void
  ariaLabel: string
  scrollOnPhone?: boolean
  className?: string
}) {
  return (
    <div
      className={['af-pg-chips', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={ariaLabel}
      data-scroll={scrollOnPhone ? 'phone' : undefined}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="af-pg-chip"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          data-testid={option.testId}
          {...dataAttrs(option.data)}
        >
          {option.label}
          {typeof option.count === 'number' ? <span className="af-pg-chip-n af-num">{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}
