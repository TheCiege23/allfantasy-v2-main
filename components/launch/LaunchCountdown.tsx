'use client'

import '@/components/launch/af-launch.css'

import { freeUntilLabel, remainingSuffix } from '@/components/launch/launchCopy'
import { describeRemaining, pad2, UNIT_LABELS, type LaunchLang } from '@/components/launch/launchTime'
import { useLaunchClock, type LaunchClock } from '@/components/launch/useLaunchClock'

/*
 * THE launch countdown — one component, reused on every surface that shows one (landing banner,
 * /signup, /pricing, /upgrade, the /core home for viewers without a plan).
 *
 *   <LaunchCountdown startsAt={getPaywallStartsAt().toISOString()} />
 *
 * The server passes the ISO instant; the browser ticks. Before mount it prints static text
 * ("Free until Oct 15", or `staticText`), so the server HTML is meaningful on its own and hydration
 * never races the clock. After launch it renders NOTHING — no "0d 00h", no "launched!" leftovers.
 *
 * ⚠ ACCESSIBILITY: the digits are `aria-hidden`; the element is a `role="timer"` with
 * `aria-live="off"` and a minute-granular `aria-label` ("Free until Oct 15 — 19 days, 4 hours and
 * 12 minutes left"). A screen reader reads it when the user reaches it and is never interrupted
 * once a second.
 */

export type LaunchCountdownSize = 'lg' | 'md' | 'sm'

export function LaunchCountdownView({
  clock,
  startsAt,
  lang = 'en',
  size = 'md',
  staticText,
  className,
}: {
  clock: LaunchClock
  startsAt: string
  lang?: LaunchLang
  size?: LaunchCountdownSize
  /** What the server (and the first browser render) prints before the clock starts. */
  staticText?: string
  className?: string
}) {
  if (clock.phase === 'ended') return null
  const lead = freeUntilLabel(startsAt, lang)
  const cls = ['af-lc', className].filter(Boolean).join(' ')

  if (clock.phase === 'static') {
    return (
      <span className={cls} data-size={size} data-state="static" data-testid="launch-countdown">
        <span className="af-lc-static">{staticText ?? lead}</span>
      </span>
    )
  }

  const { parts } = clock
  const units = UNIT_LABELS[lang]
  const segments: Array<[string, number, string]> = [
    ['d', parts.days, units.days],
    ['h', parts.hours, units.hours],
    ['m', parts.minutes, units.minutes],
    ['s', parts.seconds, units.seconds],
  ]
  return (
    <span
      className={cls}
      data-size={size}
      data-state="live"
      data-testid="launch-countdown"
      role="timer"
      aria-live="off"
      aria-label={`${lead} — ${describeRemaining(parts, lang)} ${remainingSuffix(lang)}`}
    >
      <span className="af-lc-segs" aria-hidden="true">
        {segments.map(([key, value, unit]) => (
          <span key={key} className="af-lc-seg" data-unit={key}>
            <span className="af-lc-num">{pad2(value)}</span>
            <span className="af-lc-unit">{size === 'sm' ? key : unit}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

export function LaunchCountdown({
  startsAt,
  lang = 'en',
  size = 'md',
  staticText,
  className,
}: {
  /** ISO instant the paywall starts — from `getPaywallStartsAt()` on the server. */
  startsAt: string
  lang?: LaunchLang
  size?: LaunchCountdownSize
  staticText?: string
  className?: string
}) {
  const clock = useLaunchClock(startsAt)
  return (
    <LaunchCountdownView
      clock={clock}
      startsAt={startsAt}
      lang={lang}
      size={size}
      staticText={staticText}
      className={className}
    />
  )
}

export default LaunchCountdown
