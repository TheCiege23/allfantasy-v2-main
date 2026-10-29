'use client'

import type { ReactNode } from 'react'
import { positionTone, slotPillLabel } from '@/lib/league/native/nativeScreenModels'
import './native-screens.css'

export function ScreenHead({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="nls-head">
      <div className="nls-head-text">
        <p className="nls-eyebrow">{eyebrow}</p>
        <h2 className="nls-title">{title}</h2>
        {sub ? <p className="nls-sub">{sub}</p> : null}
      </div>
      {children ? <div className="nls-head-actions">{children}</div> : null}
    </header>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (id: T) => void }) {
  return (
    <div className="nls-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Position pill. `tone` defaults to the position of `label`, so a FLEX slot can still be coloured by its player. */
export function PosPill({ label, tone }: { label: string | null | undefined; tone?: string | null }) {
  return (
    <span className="nls-pos" data-tone={positionTone(tone ?? label)}>
      {slotPillLabel(label)}
    </span>
  )
}

export function InjuryFlag({ status }: { status: string | null | undefined }) {
  const s = String(status ?? '').trim()
  if (!s || /^(healthy|active|none)$/i.test(s)) return null
  const short = /^questionable$/i.test(s) ? 'Q' : /^doubtful$/i.test(s) ? 'D' : /^out$/i.test(s) ? 'O' : /^(ir|injured reserve)$/i.test(s) ? 'IR' : s.slice(0, 3).toUpperCase()
  const bad = short === 'O' || short === 'IR' || short === 'D'
  return (
    <span className="nls-flag" data-tone={bad ? 'bad' : 'warn'} title={s}>
      {short}
    </span>
  )
}

export function Card({ label, tone, flush, children, right, className }: { label?: ReactNode; tone?: 'accent' | 'warn'; flush?: boolean; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`nls-card ${flush ? 'nls-card-flush' : ''} ${className ?? ''}`} data-tone={tone}>
      {label ? (
        <h3 className={`nls-label ${flush ? 'nls-card-head' : ''}`}>
          <span>{label}</span>
          {right ? <span>{right}</span> : null}
        </h3>
      ) : null}
      {children}
    </section>
  )
}
