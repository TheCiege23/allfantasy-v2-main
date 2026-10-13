'use client'

import type { ReactNode } from 'react'

/**
 * The hub's field rows — card, toggle, pill choices, select. Labels arrive already translated; the
 * tabs own their dictionary keys so the hub i18n guard can read them out of the tab files.
 * Pill choices mirror the league settings screens commishes already know (team count, IR slots,
 * playoff start week): one tap per option, current value highlighted.
 */

export function HubCard({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section
      data-testid={testId}
      className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.06)]"
    >
      <h3 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-cyan-200/85">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

export function HubToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  testId?: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-white/85">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-relaxed text-white/45">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export type HubChoice<T extends string | number> = { value: T; label: string; hint?: string }

export function HubChoices<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
  testId,
}: {
  label: string
  value: T
  options: HubChoice<T>[]
  disabled?: boolean
  onChange: (next: T) => void
  testId?: string
}) {
  const hint = options.find((o) => o.value === value)?.hint
  return (
    <div data-testid={testId}>
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-white/40">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={`min-w-[44px] rounded-full border px-3 py-1.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100'
                  : 'border-white/[0.10] bg-black/20 text-white/60 hover:border-white/25 hover:text-white/85'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">{hint}</p> : null}
    </div>
  )
}

/** Inclusive integer range as pill choices. */
export function rangeChoices(from: number, to: number, label: (n: number) => string = String): HubChoice<number>[] {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: label(from + i) }))
}

export function HubSavingNote({ saving, text }: { saving: boolean; text: string }) {
  return saving ? <p className="text-[11px] font-semibold text-cyan-300/80">{text}</p> : null
}
