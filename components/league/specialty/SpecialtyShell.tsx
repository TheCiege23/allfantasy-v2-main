'use client'

/**
 * Shared specialty-league shell (handoff: design-refs/native-league-handoff/specialty-leagues/).
 *
 * The pattern every format follows:
 *   <SpecialtyShell format="guillotine">
 *     <SpecialtyHero … clock={<SpecialtyCountdown … />} />
 *     <SpecialtyGrid main={<core mechanic panel/>} rail={<SpecialtyCard>…</SpecialtyCard>} />
 *   </SpecialtyShell>
 *
 * API, kept deliberately small:
 *   SpecialtyShell     root; sets --acc/--acc2/--accInk/--disp from SPECIALTY_THEMES[format]
 *   SpecialtyHero      banner + emblem + chips + title + headline + blurb + actions + clock slot
 *   SpecialtyCountdown live "1d 06:40" clock (ticks; shows a fallback when target is null/past)
 *   SpecialtyGrid      main column + right rail (rail drops below on narrow containers)
 *   SpecialtyCard      panel; optional label/icon header and `tone` border
 *   SpecialtyRules     numbered rule list
 *   SpecialtyFeed      icon + title + sub event list
 *   SpecialtyTag       uppercase status pill with a tone (text always present — never colour-only)
 *   SpecialtyReplayButton  the QA "Replay" button for signature moments
 *   spStyles           the CSS-module class map, for format-specific rows (spStyles.row, .bar, .av …)
 *
 * All classes are scoped (CSS module) — nothing leaks into the surrounding league shell. Use child
 * selectors in any format CSS layered on top (`.x>span`), per the handoff README gotcha.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import styles from './specialty.module.css'
import { SPECIALTY_THEMES, formatSpecialtyCountdown, type SpecialtyFormat } from './theme'

export const spStyles = styles
export { SPECIALTY_THEMES, specialtyAsset, formatSpecialtyCountdown } from './theme'
export type { SpecialtyFormat, SpecialtyTheme } from './theme'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function SpecialtyShell({
  format,
  children,
  className,
  testId,
}: {
  format: SpecialtyFormat
  children: ReactNode
  className?: string
  testId?: string
}) {
  const t = SPECIALTY_THEMES[format]
  const vars = {
    '--acc': t.acc,
    '--acc2': t.acc2,
    '--accInk': t.accInk,
    '--disp': `'${t.disp}'`,
  } as CSSProperties
  return (
    <div className={cx(styles.sp, className)} style={vars} data-specialty={format} data-testid={testId}>
      <div className={styles.page}>{children}</div>
    </div>
  )
}

export type SpecialtyAction = {
  label: string
  /** Link target; omit and pass onClick for an in-page action. */
  href?: string
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
  testId?: string
}

export function SpecialtyActionButton({ action, className }: { action: SpecialtyAction; className?: string }) {
  const cls = cx(styles.btn, action.primary && styles.btnP, className)
  if (action.href && !action.disabled) {
    return (
      <Link href={action.href} className={cls} data-testid={action.testId}>
        {action.label}
      </Link>
    )
  }
  return (
    <button type="button" className={cls} onClick={action.onClick} disabled={action.disabled || !action.onClick} data-testid={action.testId}>
      {action.label}
    </button>
  )
}

export function SpecialtyHero({
  format,
  bannerSrc,
  emblemSrc,
  emblemAlt,
  chips,
  title,
  headline,
  blurb,
  actions = [],
  clock,
}: {
  format: SpecialtyFormat
  bannerSrc: string
  emblemSrc: string
  emblemAlt: string
  chips: string[]
  title: string
  headline?: ReactNode
  blurb?: ReactNode
  actions?: SpecialtyAction[]
  clock?: ReactNode
}) {
  const displayTitle = SPECIALTY_THEMES[format].displayTitle
  return (
    <section className={styles.hero} data-testid="specialty-hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.bg} src={bannerSrc} alt="" aria-hidden />
      <div className={styles.veil} />
      <div className={styles.heroIn}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.emblem} src={emblemSrc} alt={emblemAlt} />
        <div className={styles.heroText}>
          {chips.length > 0 ? (
            <div className={styles.chips}>
              {chips.map((c) => (
                <span key={c} className={styles.chip}>
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          <h1 className={cx(styles.title, displayTitle && styles.titleDisp)}>{title}</h1>
          {headline ? <p className={styles.headline} data-testid="specialty-headline">{headline}</p> : null}
          {blurb ? <p className={styles.blurb}>{blurb}</p> : null}
          {actions.length > 0 ? (
            <div className={styles.actions}>
              {actions.map((a) => (
                <SpecialtyActionButton key={a.label} action={a} />
              ))}
            </div>
          ) : null}
        </div>
        {clock}
      </div>
    </section>
  )
}

/** Live countdown. `target` null/past shows `fallback` (default "—"), never a negative clock. */
export function SpecialtyCountdown({
  label,
  target,
  caption,
  fallback = '—',
}: {
  label: string
  target: string | Date | null | undefined
  caption?: ReactNode
  fallback?: string
}) {
  const targetMs = target ? new Date(target).getTime() : NaN
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  // Render nothing time-dependent until mounted, so server and client markup agree.
  const text = now == null || !Number.isFinite(targetMs) ? fallback : formatSpecialtyCountdown(targetMs - now) ?? fallback
  return (
    <div className={styles.clock} role="timer" aria-label={`${label}: ${text}`} data-testid="specialty-countdown">
      <span className={styles.lbl}>{label}</span>
      <span className={styles.clockValue}>{text}</span>
      {caption ? <span className={styles.clockCaption}>{caption}</span> : null}
    </div>
  )
}

export function SpecialtyGrid({ main, rail }: { main: ReactNode; rail?: ReactNode }) {
  return (
    <div className={styles.grid}>
      <div className={styles.main}>{main}</div>
      {rail ? <aside className={styles.rail}>{rail}</aside> : null}
    </div>
  )
}

export function SpecialtyCard({
  label,
  icon,
  aside,
  children,
  variant = 1,
  borderColor,
  className,
  testId,
  id,
}: {
  label?: ReactNode
  /** Icon image src shown before the label (64px art rendered at 30px). */
  icon?: string
  /** Right side of the header row (toggle, "Replay", note…). */
  aside?: ReactNode
  children: ReactNode
  variant?: 1 | 2
  borderColor?: string
  className?: string
  testId?: string
  id?: string
}) {
  return (
    <section
      id={id}
      className={cx(variant === 2 ? styles.card2 : styles.card, styles.pad, className)}
      style={borderColor ? { borderColor } : undefined}
      data-testid={testId}
    >
      {label || aside ? (
        <div className={styles.momentHead}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {icon ? <img src={icon} alt="" aria-hidden style={{ width: 30, height: 30 }} /> : null}
            {label ? <h2 className={styles.lbl} style={{ margin: 0 }}>{label}</h2> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function SpecialtyRules({ rules }: { rules: ReactNode[] }) {
  return (
    <ol className={styles.rules}>
      {rules.map((r, i) => (
        <li key={i} className={styles.rule}>
          <b>{i + 1}</b>
          <span>{r}</span>
        </li>
      ))}
    </ol>
  )
}

export type SpecialtyFeedItem = { id: string; icon?: string; title: ReactNode; sub?: ReactNode }

export function SpecialtyFeed({ items, empty = 'Nothing has happened yet.' }: { items: SpecialtyFeedItem[]; empty?: string }) {
  if (items.length === 0) return <p className={styles.empty}>{empty}</p>
  return (
    <ul className={styles.feed}>
      {items.map((it) => (
        <li key={it.id} className={styles.feedItem}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {it.icon ? <img src={it.icon} alt="" aria-hidden /> : null}
          <div className={styles.feedText}>
            <strong>{it.title}</strong>
            {it.sub ? <span>{it.sub}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

export type SpecialtyTone = 'safe' | 'danger' | 'zone' | 'acc' | 'gold' | 'pink' | 'muted'
const TONE_CLASS: Record<SpecialtyTone, string> = {
  safe: styles.toneSafe,
  danger: styles.toneDanger,
  zone: styles.toneZone,
  acc: styles.toneAcc,
  gold: styles.toneGold,
  pink: styles.tonePink,
  muted: styles.toneMuted,
}

export function SpecialtyTag({ tone, children, style }: { tone: SpecialtyTone; children: ReactNode; style?: CSSProperties }) {
  return (
    <span className={cx(styles.tag, TONE_CLASS[tone])} style={style}>
      {children}
    </span>
  )
}

export function SpecialtyReplayButton({ onReplay, label = 'Replay' }: { onReplay: () => void; label?: string }) {
  return (
    <button type="button" className={styles.btn} onClick={onReplay} data-testid="specialty-replay">
      {label}
    </button>
  )
}

/** True when the viewer asked for reduced motion (false during SSR). Re-reads on change. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

/** Two-letter avatar initials for a team/manager name ("Open Team 12" → "O12", "TheCiege26" → "TC"). */
export function specialtyInitials(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (!n) return '?'
  const words = n.split(/\s+/)
  const lastNum = words[words.length - 1]?.match(/^\d+$/)?.[0]
  if (lastNum && words.length > 1) return `${words[0][0]}${lastNum}`.toUpperCase()
  const caps = n.match(/[A-Z]/g)
  if (words.length === 1 && caps && caps.length >= 2) return `${caps[0]}${caps[1]}`
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

const AV_COLORS = ['#1f3b2e', '#3b1f2a', '#1f2a4a', '#2a2a4a', '#3b3418', '#183b2a', '#3b1f3b', '#2a3b18', '#3b2a18']
/** Stable avatar background from an id. */
export function specialtyAvatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AV_COLORS[h % AV_COLORS.length]
}
