'use client'

/**
 * Shared UI primitives for the Create League v2 flow — glass surfaces,
 * pill selectors, toggles, and the animated step progress bar.
 *
 * Everything is Tailwind-first and reacts to a supplied `AccentTone`
 * from `lib/create-league-v2/theme.ts` so the whole page retunes its
 * glow as the user picks a league type.
 */

import { useState, type ReactNode } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import { GLASS_INNER, GLASS_SURFACE } from '@/lib/create-league-v2/theme'
import type { V2PageId } from '@/lib/create-league-v2/state'
import { V2_PAGES, V2_PAGE_LABELS } from '@/lib/create-league-v2/state'

// ── Glass card shell ─────────────────────────────────────────────────

export function GlassCard({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}) {
  return <Tag className={`${GLASS_SURFACE} p-6 sm:p-8 ${className}`}>{children}</Tag>
}

export function InnerPanel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${GLASS_INNER} p-4 sm:p-5 ${className}`}>{children}</div>
}

// ── Section header ───────────────────────────────────────────────────

export function SectionHeader({
  title,
  hint,
  tooltip,
}: {
  title: string
  hint?: string
  tooltip?: string
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.18em] text-white/55">{title}</h3>
        {hint ? <p className="mt-1.5 text-xs leading-relaxed text-white/40">{hint}</p> : null}
      </div>
      {tooltip ? (
        <button
          type="button"
          title={tooltip}
          aria-label={tooltip}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.04] text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/70"
        >
          ?
        </button>
      ) : null}
    </div>
  )
}

// ── Selectable card (for league type + scoring source) ──────────────

function CardTopImageOrIcon({
  thumbnailSrc,
  icon,
  selected,
  accent,
  disabled,
}: {
  thumbnailSrc?: string | null
  icon?: ReactNode
  selected: boolean
  accent: AccentTone
  disabled: boolean
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const useImage = Boolean(thumbnailSrc?.trim()) && !imgFailed

  if (thumbnailSrc?.trim()) {
    return (
      <div
        className={`relative -mx-4 -mt-4 mb-2 w-[calc(100%+2rem)] overflow-hidden rounded-t-2xl border-b border-white/[0.06] ${
          disabled ? 'opacity-40' : ''
        }`}
      >
        {useImage ? (
          <img
            src={thumbnailSrc!}
            alt=""
            className="aspect-[16/10] w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex aspect-[16/10] w-full min-h-[4.5rem] items-center justify-center bg-gradient-to-br from-white/[0.10] to-white/[0.02]">
            {icon ? (
              <span
                className={`inline-flex h-12 w-12 items-center justify-center rounded-xl text-2xl ${
                  selected
                    ? `bg-white/[0.12] ${accent.text} shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`
                    : 'bg-white/[0.04] text-white/70'
                }`}
                aria-hidden
              >
                {icon}
              </span>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  if (!icon) return null
  return (
    <span
      className={`relative mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl text-lg transition-all duration-300 ${
        selected
          ? `bg-white/[0.12] ${accent.text} shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`
          : 'bg-white/[0.04] text-white/60 group-hover:bg-white/[0.08] group-hover:text-white/80'
      }`}
      aria-hidden
    >
      {icon}
    </span>
  )
}

export function SelectableCard({
  selected,
  onClick,
  accent,
  title,
  subtitle,
  icon,
  disabled = false,
  thumbnailSrc,
}: {
  selected: boolean
  onClick: () => void
  accent: AccentTone
  title: string
  subtitle?: string
  icon?: ReactNode
  disabled?: boolean
  /** Packaged concept/sport thumbnail — on missing/broken image, gradient + icon fallback */
  thumbnailSrc?: string | null
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex w-full flex-col items-start gap-1.5 overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 ease-out ${
        disabled
          ? 'cursor-not-allowed border-white/5 bg-white/[0.015] text-white/25'
          : selected
            ? `cursor-pointer border-transparent ring-2 ${accent.ring} bg-gradient-to-br from-white/[0.10] to-white/[0.04] ${accent.glow}`
            : 'cursor-pointer border-white/[0.08] bg-gradient-to-br from-white/[0.04] to-transparent hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06] hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)]'
      }`}
    >
      {/* Ambient glow on selected */}
      {selected && (
        <span
          className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 h-16 w-32 rounded-full opacity-40 blur-2xl"
          style={{ background: accent.hex }}
          aria-hidden
        />
      )}
      <CardTopImageOrIcon
        thumbnailSrc={thumbnailSrc}
        icon={icon}
        selected={selected}
        accent={accent}
        disabled={disabled}
      />
      <span className={`relative text-sm font-semibold transition-colors duration-200 ${selected ? 'text-white' : 'text-white/80 group-hover:text-white'}`}>{title}</span>
      {subtitle ? <span className="relative text-[11px] leading-snug text-white/45">{subtitle}</span> : null}
    </button>
  )
}

// ── Pill row (team count, draft type, tribes) ───────────────────────

export function PillRow<T extends string | number>({
  options,
  value,
  onChange,
  accent,
  ariaLabel,
  disabledValues,
}: {
  options: readonly T[]
  value: T
  onChange: (next: T) => void
  accent: AccentTone
  ariaLabel: string
  disabledValues?: readonly T[]
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = opt === value
        const disabled = disabledValues?.includes(opt) ?? false
        const stateClass = disabled
          ? 'cursor-not-allowed border-white/5 bg-white/[0.015] text-white/25'
          : selected
            ? `cursor-pointer border-transparent ring-2 ${accent.ring} bg-white/[0.10] ${accent.text} ${accent.glow}`
            : 'cursor-pointer border-white/[0.08] bg-white/[0.03] text-white/75 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] hover:text-white'
        return (
          <button
            key={String(opt)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => !disabled && onChange(opt)}
            className={`min-w-[3.25rem] rounded-full border px-4 py-2 text-xs font-semibold transition-all duration-150 ${stateClass}`}
          >
            {String(opt)}
          </button>
        )
      })}
    </div>
  )
}

// ── Toggle switch ────────────────────────────────────────────────────

export function Toggle({
  checked,
  onChange,
  label,
  description,
  accent,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  accent: AccentTone
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-gradient-to-r from-white/[0.04] to-transparent p-4 transition-all duration-200 hover:border-white/[0.12] hover:from-white/[0.05]">
      <span className="flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        {description ? <span className="mt-1 block text-xs text-white/45">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-all duration-300 ${
          checked ? `border-white/20 bg-white/[0.15] ${accent.glow}` : 'border-white/10 bg-white/[0.04]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full shadow-lg transition-all duration-300 ${
            checked ? `left-[calc(100%-1.375rem)] bg-white` : 'left-0.5 bg-white/60'
          }`}
        />
      </button>
    </label>
  )
}

// ── Text / textarea inputs ───────────────────────────────────────────

export function GlassInput({
  label,
  value,
  onChange,
  placeholder,
  accent,
  maxLength,
  hint,
  error,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  accent: AccentTone
  maxLength?: number
  hint?: string
  error?: string | null
  type?: 'text' | 'email'
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border px-4 py-3.5 text-sm text-white placeholder-white/25 outline-none transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${
          error
            ? 'border-rose-400/50 bg-rose-500/5 focus:border-rose-300'
            : `border-white/[0.08] bg-white/[0.03] focus:border-white/25 focus:bg-white/[0.05] focus:${accent.ring} focus:ring-2`
        }`}
      />
      {error ? (
        <span className="mt-1 block text-[11px] text-rose-300">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-white/40">{hint}</span>
      ) : null}
    </label>
  )
}

export function GlassTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  accent,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  accent: AccentTone
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{label}</span>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition-all duration-150 focus:border-white/30 focus:${accent.ring} focus:ring-2`}
      />
      {hint ? <span className="mt-1 block text-[11px] text-white/40">{hint}</span> : null}
    </label>
  )
}

export function GlassSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  accent,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
  accent: AccentTone
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={`w-full appearance-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 pr-10 text-sm text-white outline-none transition-all duration-150 focus:border-white/30 focus:${accent.ring} focus:ring-2`}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#0B0F1A] text-white">
              {opt.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-white/50">
          ▾
        </span>
      </div>
    </label>
  )
}

// ── Segmented control ────────────────────────────────────────────────

function SegmentedMediaStrip({ src }: { src: string | null | undefined }) {
  const [bad, setBad] = useState(!src?.trim())
  if (!src?.trim() || bad) {
    return (
      <span
        className="inline-flex h-9 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-white/[0.09] to-white/[0.02] text-[11px] text-white/45"
        aria-hidden
      >
        ◇
      </span>
    )
  }
  return (
    <span className="inline-flex h-9 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10">
      <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBad(true)} />
    </span>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accent,
  ariaLabel,
}: {
  options: readonly { value: T; label: string; hint?: string; thumbnailSrc?: string | null }[]
  value: T
  onChange: (v: T) => void
  accent: AccentTone
  ariaLabel: string
}) {
  const useThumbnails = options.some((o) => Object.prototype.hasOwnProperty.call(o, 'thumbnailSrc'))

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-col gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5 sm:flex-row"
    >
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`relative flex-1 overflow-hidden rounded-xl px-4 py-3 text-xs font-semibold transition-all duration-300 ${
              selected
                ? `bg-white/[0.10] text-white ring-1 ${accent.ring} shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]`
                : 'text-white/60 hover:bg-white/[0.05] hover:text-white/85'
            }`}
            style={selected ? { boxShadow: `0 0 20px -6px ${accent.hex}` } : undefined}
          >
            <div className={`relative flex items-start gap-2.5 ${useThumbnails ? '' : ''}`}>
              {useThumbnails ? <SegmentedMediaStrip src={'thumbnailSrc' in opt ? opt.thumbnailSrc : undefined} /> : null}
              <div className="min-w-0 flex-1">
                <span className="relative block">{opt.label}</span>
                {opt.hint ? (
                  <span className="relative mt-0.5 block text-[11px] font-normal text-white/40">{opt.hint}</span>
                ) : null}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Step progress ────────────────────────────────────────────────────

export function StepProgress({
  current,
  accent,
  onJump,
}: {
  current: V2PageId
  accent: AccentTone
  onJump?: (page: V2PageId) => void
}) {
  const currentIndex = V2_PAGES.indexOf(current)
  return (
    <div className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#060a18]/85 px-4 py-3.5 backdrop-blur-2xl">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex items-center justify-between">
          {V2_PAGES.map((page, i) => {
            const reached = i <= currentIndex
            const isCurrent = page === current
            return (
              <button
                key={page}
                type="button"
                disabled={!onJump || i > currentIndex}
                onClick={() => onJump?.(page)}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-all duration-300 ${
                    isCurrent
                      ? `border-transparent bg-white text-[#060a18] ring-2 ${accent.ring} ${accent.glow}`
                      : reached
                        ? `border-white/20 bg-white/10 ${accent.text}`
                        : 'border-white/[0.08] bg-white/[0.02] text-white/35'
                  }`}
                  style={isCurrent ? { boxShadow: `0 0 16px -2px ${accent.hex}` } : undefined}
                >
                  {reached && !isCurrent ? '✓' : i + 1}
                </span>
                <span
                  className={`hidden text-[11px] font-semibold uppercase tracking-wider sm:inline transition-colors duration-200 ${
                    isCurrent ? 'text-white' : reached ? 'text-white/65' : 'text-white/30'
                  }`}
                >
                  {V2_PAGE_LABELS[page]}
                </span>
                {i < V2_PAGES.length - 1 ? (
                  <span
                    className={`mx-1 hidden h-px flex-1 transition-colors duration-300 sm:block ${
                      reached ? 'bg-white/15' : 'bg-white/[0.06]'
                    }`}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
        {/* Animated glowing progress bar */}
        <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${((currentIndex + 1) / V2_PAGES.length) * 100}%`,
              background: `linear-gradient(90deg, ${accent.hexSoft}, ${accent.hex}, ${accent.hexSoft})`,
              backgroundSize: '200% 100%',
              animation: 'shimmer 3s ease-in-out infinite',
              boxShadow: `0 0 24px -2px ${accent.hex}, 0 0 8px -1px ${accent.hex}`,
            }}
          />
        </div>
        <style>{`@keyframes shimmer { 0%,100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }`}</style>
      </div>
    </div>
  )
}

// ── Primary CTA ──────────────────────────────────────────────────────

export function PrimaryCTA({
  children,
  onClick,
  disabled = false,
  loading = false,
  accent,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  accent: AccentTone
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`group relative inline-flex h-13 w-full items-center justify-center overflow-hidden rounded-2xl px-8 text-sm font-bold uppercase tracking-wider text-white transition-all duration-300 sm:w-auto sm:min-w-[18rem] ${
        disabled || loading
          ? 'cursor-not-allowed bg-white/[0.04] text-white/35'
          : `cursor-pointer hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]`
      }`}
      style={
        disabled || loading
          ? undefined
          : {
              background: `linear-gradient(135deg, ${accent.hex}, ${accent.hexSoft})`,
              boxShadow: `0 0 40px -8px ${accent.hex}, 0 4px 20px -4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)`,
            }
      }
    >
      <span className="relative z-10 flex items-center gap-2">
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : null}
        {children}
      </span>
    </button>
  )
}

export function SecondaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-13 items-center justify-center rounded-2xl border border-white/[0.10] bg-gradient-to-b from-white/[0.06] to-white/[0.02] px-6 text-sm font-semibold text-white/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)] transition-all duration-200 hover:border-white/20 hover:from-white/[0.10] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  )
}
