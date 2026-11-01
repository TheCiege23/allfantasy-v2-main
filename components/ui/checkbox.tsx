'use client'

import { Check } from 'lucide-react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * A checkbox that always shows whether it is ticked.
 *
 * 🛑 THE NATIVE BOX COULD NOT. `@tailwindcss/forms` draws checkboxes with `appearance: none`, a
 * `currentColor` fill and a WHITE tick. In dark mode the text colour is near-white, so a ticked
 * box was white-on-white: measured 2026-10-12 on the median-game box, fill rgba(255,255,255,.92)
 * with the white tick inside — managers could not tell their click had worked. The box here is
 * drawn from state (violet fill + white check when on), so it reads the same in both modes and
 * on every platform. The real input stays on top at full size and opacity 0, so tapping,
 * keyboard, screen readers and `locator('input').check()` all keep working.
 *
 * The root cause is also fixed app-wide in app/globals.css (checkboxes and radios no longer take
 * `color: inherit`, and default to this same violet), so a plain native box is safe too. Prefer
 * this primitive for new code anyway: its state is drawn by React, not by a stylesheet cascade.
 *
 * Moved here from components/create-league-v2/WizardControls.tsx, which re-exports it.
 */
export function CheckBox({
  checked,
  onChange,
  disabled = false,
  testId,
  className,
  ariaLabel,
  id,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  testId?: string
  className?: string
  /** Accessible name when the box has no wrapping <label>. */
  ariaLabel?: string
  id?: string
}) {
  return (
    <span className={cx('relative inline-grid h-5 w-5 shrink-0 place-items-center', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        data-testid={testId}
      />
      <span
        aria-hidden="true"
        data-checked={checked ? 'true' : 'false'}
        className={cx(
          'pointer-events-none grid h-5 w-5 place-items-center rounded-md border-2 transition-colors motion-reduce:transition-none',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-violet-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[color:var(--surface-app)]',
          checked ? 'border-violet-600 bg-violet-600 text-[#ffffff]' : 'border-[color:var(--text-tertiary)] bg-transparent',
          disabled && 'opacity-50',
        )}
      >
        {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} /> : null}
      </span>
    </span>
  )
}

export default CheckBox
