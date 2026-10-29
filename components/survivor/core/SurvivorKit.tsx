'use client'

import type { CSSProperties, ReactNode } from 'react'
import '../survivor-core.css'

/**
 * The survivor-core handoff kit (kit.css) as React parts: toggle, stepper, segmented choice,
 * field row, empty state and skeleton. Styles live in survivor-core.css under `.svk-*`.
 */

export function SvkToggle({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="svk-tg" disabled={disabled} onClick={() => onChange(!checked)} data-testid={testId} />
}

export function SvkStepper({ value, min, max, onChange, label, format, disabled, testId }: { value: number; min: number; max: number; onChange: (next: number) => void; label: string; format?: (n: number) => string; disabled?: boolean; testId?: string }) {
  return <div className="svk-step" role="group" aria-label={label} data-testid={testId}>
    <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>–</button>
    <output aria-live="polite">{format ? format(value) : value}</output>
    <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
  </div>
}

export function SvkSegmented<T extends string | number>({ value, options, onChange, label, disabled, testId }: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (next: T) => void; label: string; disabled?: boolean; testId?: string }) {
  return <div className="svk-seg" role="group" aria-label={label} data-testid={testId}>
    {options.map(option => <button key={String(option.value)} type="button" aria-pressed={option.value === value} disabled={disabled || option.disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>
}

export function SvkField({ title, hint, children, testId }: { title: string; hint?: ReactNode; children: ReactNode; testId?: string }) {
  return <div className="svk-field" data-testid={testId}>
    <div className="svk-field-l"><b>{title}</b>{hint ? <span>{hint}</span> : null}</div>
    <div className="svk-field-c">{children}</div>
  </div>
}

export function SvkEmpty({ icon, title, body, children, iconStyle }: { icon: string; title: string; body: string; children?: ReactNode; iconStyle?: CSSProperties }) {
  return <div className="svk-empty">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={icon} alt="" style={iconStyle} />
    <b>{title}</b>
    <span>{body}</span>
    {children}
  </div>
}

export function SvkSkeleton({ height, width = '100%', radius }: { height: number; width?: number | string; radius?: number }) {
  return <div className="svk-skel" aria-hidden style={{ height, width, borderRadius: radius }} />
}
