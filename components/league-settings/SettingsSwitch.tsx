'use client'

/**
 * components/league-settings/SettingsSwitch.tsx
 *
 * Compact on/off switch for the league settings modal: a 44×24 track with the knob INSIDE it.
 *
 * ⚠ Why the inline sizes: `league-admin.css` gives every `.af-league-admin button` a 44px
 * `min-height` (and `button[aria-label]` a 44px `min-width`) for tap targets. A switch drawn as a
 * small button therefore grew into a tall cyan blob, and its absolutely-positioned knob translated
 * out past the track's right edge. The track here is a `span` inside a full-row-height button, and
 * its size is pinned inline so no stylesheet rule can stretch it; the 44px tap target is the button.
 */

import type { CSSProperties } from 'react'

type Props = {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** id of the element naming this switch (preferred). */
  labelledBy?: string
  /** Accessible name when there is no visible label to point at. */
  label?: string
  describedBy?: string
  id?: string
  className?: string
}

const TRACK: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
  width: 44,
  minWidth: 44,
  height: 24,
  minHeight: 24,
  borderRadius: 999,
  flexShrink: 0,
  transition: 'background-color 150ms ease',
  boxSizing: 'border-box',
}

const KNOB: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 20,
  height: 20,
  borderRadius: 999,
  background: '#ffffff',
  boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
  transition: 'transform 150ms ease',
}

export function SettingsSwitch({ checked, onChange, disabled, labelledBy, label, describedBy, id, className }: Props) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      {...(labelledBy ? {} : { 'aria-label': label })}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked) }}
      className={`inline-flex shrink-0 items-center justify-end bg-transparent p-0 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className ?? ''}`}
      style={{ minWidth: 44, minHeight: 44, border: 0 }}
      data-state={checked ? 'on' : 'off'}
    >
      <span
        aria-hidden
        style={{
          ...TRACK,
          background: checked ? 'var(--accent, #06b6d4)' : 'var(--line2, rgba(148,163,184,0.35))',
          border: checked ? '1px solid transparent' : '1px solid var(--line2, rgba(148,163,184,0.45))',
        }}
      >
        <span aria-hidden style={{ ...KNOB, top: 1, left: 1, transform: checked ? 'translateX(20px)' : 'translateX(0)' }} />
      </span>
    </button>
  )
}
