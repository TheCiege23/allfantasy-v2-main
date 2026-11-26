'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, BellRing, Moon } from 'lucide-react'
import { useMessages } from '@/components/i18n/useMessages'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { pickClockPlannerMessages } from '@/lib/core-app/messages/pickClockPlanner'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationChannelPrefs, NotificationPreferences } from '@/lib/notification-settings/types'
import {
  clockTimePlaceholder,
  crossesQuietWindow,
  describeEta,
  effectiveDueAt,
  estimateNextPickAt,
  estimatePickPaceSeconds,
  formatClockTime,
  formatWallMinutes,
  isInQuietWindow,
  isLongPickClock,
  parseClockMinutes,
  shortZoneName,
  type QuietWindow,
} from '@/lib/draft-room/pickClockPlanning'

const SETTINGS_HREF = '/settings?tab=notifications'

type AlertsState =
  | { status: 'loading' }
  | { status: 'unknown' }
  | { status: 'all-off' }
  | { status: 'off'; current: NotificationChannelPrefs; error?: boolean }
  | { status: 'saving'; current: NotificationChannelPrefs }
  | { status: 'on'; current: NotificationChannelPrefs }

/**
 * The viewer's real `draft_alerts` notification setting — one switch with push / email / text
 * channels. It covers 3/2/1 picks away, on the clock and the low-time warning
 * (lib/draft-notifications/DraftNotificationService.ts), so the card describes exactly that.
 *
 * Turning it on PATCHes the whole `draft_alerts` entry: the profile merge is one level deep, so a
 * partial entry would drop the channels already saved.
 */
export function useDraftAlertsPreference(enabled: boolean): { state: AlertsState; turnOn: () => Promise<void> } {
  const [state, setState] = useState<AlertsState>({ status: 'loading' })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/user/profile', { cache: 'no-store' }).catch(() => null)
      const data: unknown = res?.ok ? await res.json().catch(() => null) : null
      if (cancelled) return
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        setState({ status: 'unknown' })
        return
      }
      const raw = (data as Record<string, unknown>).notificationPreferences
      const prefs = resolveNotificationPreferences(
        raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as NotificationPreferences) : null,
      )
      if (prefs.globalEnabled === false) {
        setState({ status: 'all-off' })
        return
      }
      const current = prefs.categories?.draft_alerts
      if (!current) setState({ status: 'unknown' })
      else setState(current.enabled ? { status: 'on', current } : { status: 'off', current })
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  const turnOn = useCallback(async () => {
    if (state.status !== 'off') return
    const next: NotificationChannelPrefs = { ...state.current, enabled: true, inApp: true, push: state.current.push ?? true }
    setState({ status: 'saving', current: state.current })
    const res = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationPreferences: { categories: { draft_alerts: next } } }),
    }).catch(() => null)
    setState(res?.ok ? { status: 'on', current: next } : { status: 'off', current: state.current, error: true })
  }, [state])

  return { state, turnOn }
}

export type PickClockPlannerProps = {
  timerSeconds: number | null | undefined
  timerEndAtIso: string | null | undefined
  /** Viewer is on the clock now. */
  isOnClock: boolean
  /** Picks before the viewer's next one; null when unknown (spectator, draft not running). */
  picksAway: number | null
  /** Board label of the viewer's next pick, e.g. "2.9". */
  nextLabel: string | null
  /** When recent picks were made, for pace. */
  pickTimesMs: number[]
  quietWindow: QuietWindow | null
  /** League lets picks happen while the clock is frozen for quiet hours. */
  allowPicksDuringPause: boolean
  /** The clock is frozen for quiet hours right now (server says so). */
  pausedForQuietHours: boolean
  queueTop: { name: string; position: string | null } | null
}

/**
 * Planning cards above the board for a LONG pick clock (10+ minutes) and/or commissioner quiet
 * hours: when you're likely up, when the clock stops, and whether you'll be told.
 *
 * ⚠ NOT A "SLOW DRAFT" MODE. Snake, linear and auction rooms all get this; the only inputs are the
 * clock the commissioner set and the quiet window. Under 10 minutes with no quiet hours it renders
 * nothing, so a fast draft looks exactly as before.
 */
export function PickClockPlanner(props: PickClockPlannerProps) {
  const m = useMessages(pickClockPlannerMessages)
  const { language } = useOptionalLanguage()
  const locale = language === 'es' ? 'es-US' : 'en-US'
  const long = isLongPickClock(props.timerSeconds)
  const quiet = props.quietWindow
  const { state: alerts, turnOn } = useDraftAlertsPreference(long)
  // ⚠ HYDRATION: null until mount. The server and the browser's first render run seconds apart and
  // in different time zones, so every time on these cards would differ between them and React would
  // discard the tree. Before mount the cards render from props alone, with an invisible placeholder
  // holding each time's place; the mount effect sets the real now, then refreshes it every minute.
  const [nowMs, setNowMs] = useState<number | null>(null)

  useEffect(() => {
    if (!long && !quiet) return
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [long, quiet])

  if (!long && !quiet) return null
  const now = nowMs == null ? null : new Date(nowMs)
  const timePlaceholder = clockTimePlaceholder(locale)

  // ── Next pick ────────────────────────────────────────────────────────────
  // `mobileBody` drops the pick count: the phone clock bar already says "~N picks until your turn".
  // `pending`: the headline is a placeholder (before mount) and is rendered invisibly.
  let next: { eyebrow: string; headline: string; pending: boolean; body: string; mobileBody: string } | null = null
  if (long && props.picksAway != null) {
    const eyebrow = props.nextLabel ? m.nextPickEyebrow(props.nextLabel) : m.nextPickEyebrowNoLabel
    const queueLine = props.queueTop ? m.queueTop(props.queueTop.name, props.queueTop.position ?? '') : ''
    if (props.isOnClock || props.picksAway <= 0) {
      const endMs = props.timerEndAtIso ? Date.parse(props.timerEndAtIso) : NaN
      if (!Number.isFinite(endMs)) {
        next = { eyebrow, headline: m.nextPickEyebrowNoLabel, pending: false, body: queueLine, mobileBody: queueLine }
      } else if (nowMs == null) {
        next = { eyebrow, headline: m.onClockHeadline(timePlaceholder), pending: true, body: queueLine, mobileBody: queueLine }
      } else {
        const due = formatClockTime(effectiveDueAt(nowMs, endMs, quiet), locale)
        next = { eyebrow, headline: m.onClockHeadline(due), pending: false, body: queueLine, mobileBody: queueLine }
      }
    } else if (nowMs == null || now == null) {
      // Before mount: the count and the queue are props; the time and "the clock stops overnight"
      // depend on now, so they wait for the mounted render.
      next = {
        eyebrow,
        headline: m.etaToday(timePlaceholder),
        pending: true,
        body: `${m.picksToGo(props.picksAway)}.${queueLine ? ` ${queueLine}` : ''}`,
        mobileBody: queueLine,
      }
    } else {
      const pace = estimatePickPaceSeconds(props.pickTimesMs, props.timerSeconds as number)
      const eta = estimateNextPickAt({ nowMs, picksAway: props.picksAway, paceSeconds: pace, quietWindow: quiet })
      const when = describeEta(eta, now, locale)
      const headline = when.day === 'today' ? m.etaToday(when.time) : when.day === 'tomorrow' ? m.etaTomorrow(when.time) : m.etaLater(when.weekday, when.time)
      const crosses = Boolean(quiet && crossesQuietWindow(nowMs, eta.getTime(), quiet))
      next = {
        eyebrow,
        headline,
        pending: false,
        body: `${m.picksToGo(props.picksAway)}${crosses ? m.overnightSuffix : ''}.${queueLine ? ` ${queueLine}` : ''}`,
        mobileBody: [crosses ? m.clockStopsOvernight : '', queueLine].filter(Boolean).join(' '),
      }
    }
  }

  // ── Quiet hours ──────────────────────────────────────────────────────────
  let quietCard: { chip: string; range: string; headline: string; body: string } | null = null
  if (quiet) {
    const startMin = parseClockMinutes(quiet.start) as number
    const endMin = parseClockMinutes(quiet.end) as number
    // Before mount, a fixed instant names the zone (the league's zone is explicit, so this is the
    // same on server and browser) and only the server's own "paused for quiet hours" flag counts.
    const zone = shortZoneName(quiet.timezone, now ?? new Date(0), locale)
    const startLabel = formatWallMinutes(startMin, locale)
    const endLabel = formatWallMinutes(endMin, locale)
    const inWindow = props.pausedForQuietHours || (now != null && isInQuietWindow(now, quiet))
    quietCard = {
      chip: m.quietChip(startLabel, endLabel, zone),
      range: `${startLabel}–${endLabel} ${zone}`,
      headline: inWindow ? m.quietPausedUntil(endLabel, zone) : m.quietPausesAt(startLabel, zone),
      body: props.allowPicksDuringPause ? m.quietBodyPicksAllowed(endLabel, zone) : m.quietBodyNoPicks(endLabel, zone),
    }
  }

  // ── Alerts ───────────────────────────────────────────────────────────────
  const channelNames = (c: NotificationChannelPrefs) =>
    [c.push ? m.channelPush : null, c.email ? m.channelEmail : null, c.sms ? m.channelSms : null].filter(Boolean).join(', ')
  const alertsHeadline =
    alerts.status === 'on'
      ? channelNames(alerts.current) ? m.alertsOn(channelNames(alerts.current)) : m.alertsOnInAppOnly
      : alerts.status === 'off' || alerts.status === 'saving'
        ? m.alertsOff
        : alerts.status === 'all-off'
          ? m.alertsAllOff
          : m.alertsUnknown
  const alertsBody = alerts.status === 'on' ? m.alertsOnBody : m.alertsOffBody

  const turnOnButton =
    alerts.status === 'off' || alerts.status === 'saving' ? (
      <button
        type="button"
        onClick={() => void turnOn()}
        disabled={alerts.status === 'saving'}
        data-testid="pick-clock-alerts-turn-on"
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-bold text-[#04121a] hover:bg-cyan-400 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden />
        {alerts.status === 'saving' ? m.alertsSaving : m.alertsTurnOn}
      </button>
    ) : null
  const manageLink = (
    <Link
      href={SETTINGS_HREF}
      className="inline-flex min-h-[44px] items-center text-xs font-semibold text-cyan-300 underline-offset-2 hover:underline"
      data-testid="pick-clock-alerts-manage"
    >
      {m.alertsManage}
    </Link>
  )

  const cardCount = (next ? 1 : 0) + (quietCard ? 1 : 0) + (long ? 1 : 0)
  if (cardCount === 0) return null

  return (
    <section aria-label={m.plannerAria} data-testid="pick-clock-planner">
      {/* Desktop: one card per question. */}
      <div
        className={`hidden gap-2.5 md:grid ${cardCount === 3 ? 'md:grid-cols-3' : cardCount === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}
      >
        {next ? (
          <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-white/10 bg-[#0b1426] px-4 py-3" data-testid="pick-clock-next">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-cyan-300">{next.eyebrow}</span>
            <span
              className={`text-base font-extrabold text-white${next.pending ? ' invisible' : ''}`}
              aria-hidden={next.pending || undefined}
              data-pending={next.pending ? 'true' : undefined}
              data-testid="pick-clock-next-headline"
            >
              {next.headline}
            </span>
            {next.body ? <span className="text-[13px] leading-snug text-white/70">{next.body}</span> : null}
          </div>
        ) : null}
        {quietCard ? (
          <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-white/10 bg-[#0b1426] px-4 py-3" data-testid="pick-clock-quiet">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-violet-300">{m.quietEyebrow} · {quietCard.range}</span>
            <span className="text-base font-extrabold text-white" data-testid="pick-clock-quiet-headline">{quietCard.headline}</span>
            <span className="text-[13px] leading-snug text-white/70">{quietCard.body}</span>
          </div>
        ) : null}
        {long ? (
          <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-white/10 bg-[#0b1426] px-4 py-3" data-testid="pick-clock-alerts">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-amber-300">{m.alertsEyebrow}</span>
            <span className="text-base font-extrabold text-white" data-testid="pick-clock-alerts-headline">
              {alerts.status === 'loading' ? '…' : alertsHeadline}
            </span>
            {alerts.status !== 'loading' && alerts.status !== 'unknown' && alerts.status !== 'all-off' ? (
              <span className="text-[13px] leading-snug text-white/70">{alertsBody}</span>
            ) : null}
            {alerts.status === 'off' && alerts.error ? <span className="text-xs text-red-300" role="alert">{m.alertsFailed}</span> : null}
            <div className="-my-1 flex items-center gap-3">
              {turnOnButton}
              {manageLink}
            </div>
          </div>
        ) : null}
      </div>

      {/* Phone: one card — the next pick, with quiet hours and alerts as a row underneath. */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-[#0b1426] px-3 py-2.5 md:hidden" data-testid="pick-clock-planner-mobile">
        {next ? (
          <>
            <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-cyan-300">{next.eyebrow}</span>
            <span className={`text-[15px] font-extrabold text-white${next.pending ? ' invisible' : ''}`} aria-hidden={next.pending || undefined}>
              {next.headline}
            </span>
            {next.mobileBody ? <span className="text-xs leading-snug text-white/70">{next.mobileBody}</span> : null}
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {quietCard ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/45 bg-violet-400/15 px-2.5 py-1 text-xs font-semibold text-violet-100"
              title={quietCard.headline}
            >
              <Moon className="h-3 w-3" aria-hidden />
              {quietCard.chip}
            </span>
          ) : null}
          {long ? (
            alerts.status === 'off' || alerts.status === 'saving' ? (
              <span className="ml-auto">{turnOnButton}</span>
            ) : (
              <Link
                href={SETTINGS_HREF}
                className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/85"
                data-testid="pick-clock-alerts-mobile"
              >
                {alerts.status === 'on' ? <BellRing className="h-3.5 w-3.5 text-amber-300" aria-hidden /> : <Bell className="h-3.5 w-3.5" aria-hidden />}
                {alerts.status === 'on' ? m.alertsButtonOn : m.alertsButtonOff}
              </Link>
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}
