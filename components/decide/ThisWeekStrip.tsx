'use client'

/**
 * "This week" — the top of the league page: the four clocks a fantasy week runs on, for THIS league.
 *
 *   Your matchup    who you play and how it looks (Matchup Center's own feed and model)
 *   Lineup lock     when your first starter kicks off, and what still needs a change
 *   Waivers run     the next run in YOUR time, and the best add the waiver panel found
 *   Trade deadline  the provider's date, or its week — never a week turned into a date
 *
 * Why a strip and not another panel: the rest of the Decide home answers "how is my league doing",
 * which changes slowly. These four change by the hour and each ends in a deadline, which is the
 * reason to come back on Wednesday and again on Sunday morning.
 *
 * ⚠ A TILE WITH NOTHING TRUE TO SAY IS NOT RENDERED. No dashes and no "not enough data": the
 * panels below already carry their own absent states, and a strip of four blanks at the top of the
 * page is the empty-product feeling this exists to remove. With no tile at all the strip is gone.
 *
 * Every number is somebody else's reading — /api/league/this-week (the My Team board's lock and
 * triage, the Waivers screen's schedule, the league calendar), the shared Matchup Center and waiver
 * intel requests — so this card can never disagree with the screen its tile links to.
 */

import { useEffect, useMemo, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { nextWaiverRunMs } from '@/lib/core-app/waiverRunClock'
import type { ThisWeekPayload } from '@/lib/core-app/leagueThisWeek'
import { useMatchupCenter } from './useMatchupCenter'
import { useWaiverIntel } from './useWaiverIntel'
import './broadcast-deck.css'

type Tone = 'warn' | 'ok' | 'info'
type Tile = { key: string; label: string; value: string; detail: string[]; tone?: Tone; tab: string }

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** "3d 2h", "14h 05m", "12m" — coarse on purpose; the exact time is the tile's value. */
export function countdown(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** An instant in the viewer's own zone: "Sun 1:00 PM", or with the date when it is a week or more out. */
export function when(ms: number, nowMs: number, language: string): string {
  const locale = language === 'es' ? 'es-US' : 'en-US'
  const far = ms - nowMs >= 6 * DAY
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    ...(far ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms))
}

export function ThisWeekStrip({
  leagueId,
  currentWeek = null,
  onOpenTab,
}: {
  leagueId: string
  currentWeek?: number | null
  onOpenTab: (tabId: string) => void
}) {
  const { t, language } = useOptionalLanguage()
  const [week, setWeek] = useState<ThisWeekPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState<number | null>(null)
  const { data: mc } = useMatchupCenter(leagueId)
  const { data: wi } = useWaiverIntel(leagueId)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/this-week?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<ThisWeekPayload>) : null))
      .then((data) => {
        if (!cancelled) setWeek(data)
      })
      .catch(() => {
        if (!cancelled) setWeek(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const center = mc && mc.supported ? mc.center : null
  const weekNo = center?.week ?? week?.lineup?.week ?? currentWeek ?? null
  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), t(key))

  const tiles: Tile[] = useMemo(() => {
    if (now == null) return []
    const out: Tile[] = []

    /* ── Your matchup ── */
    const viewer = mc && mc.supported ? mc.viewerSleeperUserId : null
    const row = viewer ? center?.matchups.find((m) => m.a.ownerId === viewer || m.b.ownerId === viewer) : undefined
    if (row && center) {
      const meIsA = row.a.ownerId === viewer
      const me = meIsA ? row.a : row.b
      const opp = meIsA ? row.b : row.a
      const detail: string[] = []
      if (center.anyPointsScored) {
        detail.push(fill('decide.week.live', { me: me.actualPoints.toFixed(1), opp: opp.actualPoints.toFixed(1) }))
      } else if (me.projectedPoints != null && opp.projectedPoints != null) {
        detail.push(fill('decide.week.projected', { me: me.projectedPoints.toFixed(1), opp: opp.projectedPoints.toFixed(1) }))
      }
      const pct = row.winProbA == null ? null : meIsA ? row.winProbA : 100 - row.winProbA
      if (pct != null) detail.push(fill('decide.week.winProb', { pct: pct.toFixed(0) }))
      if (detail.length === 0) detail.push(t('decide.week.noProjection'))
      out.push({
        key: 'matchup',
        label: t('decide.week.matchup'),
        value: fill('decide.week.vs', { name: opp.teamName || opp.name }),
        detail,
        tone: pct == null ? 'info' : pct >= 50 ? 'ok' : 'warn',
        tab: 'matchups',
      })
    }

    /* ── Lineup lock ── */
    const lu = week?.lineup
    if (lu) {
      const lockMs = lu.lockAt ? Date.parse(lu.lockAt) : NaN
      const status: string[] = []
      if (lu.toFix > 0) status.push(lu.toFix === 1 ? t('decide.week.toFixOne') : fill('decide.week.toFixMany', { n: lu.toFix }))
      if (lu.questionable > 0) status.push(lu.questionable === 1 ? t('decide.week.questionableOne') : fill('decide.week.questionableMany', { n: lu.questionable }))
      if (lu.unresolved > 0) status.push(fill('decide.week.unchecked', { n: lu.unresolved }))
      const tone: Tone = lu.toFix > 0 ? 'warn' : lu.questionable > 0 || lu.unresolved > 0 ? 'info' : 'ok'
      if (lu.automatic) {
        out.push({ key: 'lineup', label: t('decide.week.lineup'), value: t('decide.week.automatic'), detail: [t('decide.week.automaticDetail')], tone: 'info', tab: 'roster' })
      } else if (lu.locked) {
        out.push({ key: 'lineup', label: t('decide.week.lineup'), value: t('decide.week.locked'), detail: [t('decide.week.lockedDetail')], tone: 'info', tab: 'roster' })
      } else if (Number.isFinite(lockMs) && lockMs > now) {
        out.push({
          key: 'lineup',
          label: t('decide.week.lineup'),
          value: when(lockMs, now, language),
          detail: [fill('decide.week.in', { time: countdown(lockMs - now) }), ...(status.length ? status : [t('decide.week.lineupSet')])],
          tone,
          tab: 'roster',
        })
      }
    }

    /* ── Waivers run ── */
    const wv = week?.waivers
    const nextRun = wv ? nextWaiverRunMs(wv.schedule, now) : null
    if (nextRun != null) {
      const intel = wi && wi.supported ? wi.intel : null
      const top = intel?.targets.find((x) => !x.unavailable)
      const detail = [fill('decide.week.in', { time: countdown(nextRun - now) })]
      if (top) {
        detail.push(top.suggestedBid != null && intel?.budget != null
          ? fill('decide.week.topAddBid', { name: top.name, bid: top.suggestedBid })
          : fill('decide.week.topAdd', { name: top.name }))
      }
      out.push({ key: 'waivers', label: t('decide.week.waivers'), value: when(nextRun, now, language), detail, tone: 'info', tab: 'waivers' })
    }

    /* ── Trade deadline ── */
    const td = week?.tradeDeadline
    if (td?.at) {
      const ms = Date.parse(td.at)
      if (Number.isFinite(ms) && ms > now) {
        out.push({
          key: 'trade',
          label: t('decide.week.tradeDeadline'),
          value: when(ms, now, language),
          detail: [fill('decide.week.in', { time: countdown(ms - now) })],
          tone: ms - now < 7 * DAY ? 'warn' : 'info',
          tab: 'trades',
        })
      }
    } else if (td?.week != null && weekNo != null && td.week >= weekNo) {
      const left = td.week - weekNo
      out.push({
        key: 'trade',
        label: t('decide.week.tradeDeadline'),
        value: fill('decide.week.deadlineWeek', { week: td.week }),
        detail: [left === 0 ? t('decide.week.deadlineIsThisWeek') : left === 1 ? t('decide.week.weeksLeftOne') : fill('decide.week.weeksLeftMany', { n: left })],
        tone: left <= 1 ? 'warn' : 'info',
        tab: 'trades',
      })
    }

    return out
    // `fill` and `t` follow `language`, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, mc, center, week, wi, weekNo, language])

  if (!loading && tiles.length === 0) return null

  return (
    <section className="bdx-week" data-testid="this-week-strip" aria-label={t('decide.week.title')}>
      <div className="bdx-kick">
        <h2 className="bdx-disp">{t('decide.week.title')}</h2>
        <span className="bdx-sub">
          {weekNo != null ? fill('decide.week.sub', { week: weekNo }) : t('decide.week.subNoWeek')}
        </span>
      </div>
      {loading && tiles.length === 0 ? (
        <div className="bdx-skel" />
      ) : (
        <div className="bdx-week-grid">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className={`bdx-week-tile${tile.tone ? ` t-${tile.tone}` : ''}`}
              data-testid={`this-week-${tile.key}`}
              onClick={() => onOpenTab(tile.tab)}
            >
              <span className="l">{tile.label}</span>
              <span className="v">{tile.value}</span>
              {tile.detail.map((d) => (
                <span className="d" key={d}>{d}</span>
              ))}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export default ThisWeekStrip
