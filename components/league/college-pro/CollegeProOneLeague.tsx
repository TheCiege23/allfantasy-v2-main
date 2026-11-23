'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import type { CollegeProRosterPayload, CollegeProSide } from '@/lib/league/collegePro/loadCollegeProRoster'
import type { CollegeProStandingsPayload } from '@/lib/league/collegePro/loadCollegeProStandings'
import type { CollegeMatchup } from '@/lib/league/collegePro/headToHead'
import type { CollegeProPairLink } from '@/lib/league/collegePro/pairLink'

/**
 * The one-league views for a paired college + pro league (C2C / Devy), so two leagues on two platforms
 * read as one: the week across both halves (Matchup), one franchise standings table (Standings), your
 * franchise on Home, the other league named in the header, and a pointer on Draft / Trades / Waivers to
 * where that half's moves are made. Each renders ABOVE the league's own screen (`children`), which
 * stays exactly as it was; for an unpaired league these render nothing but `children`.
 */

const pts = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2))
const sportLabel = (sport: string) => (sport.toUpperCase() === 'NCAAF' || sport.toUpperCase() === 'NCAAB' ? 'College' : sport.toUpperCase())

/*
 * One request per URL per page view: the header chip, the Home card and a tab note all ask about the
 * same pair, and each would otherwise fetch it again. Kept a minute, then read fresh.
 */
const shared = new Map<string, { at: number; promise: Promise<unknown> }>()
function load(url: string): Promise<unknown> {
  const hit = shared.get(url)
  if (hit && Date.now() - hit.at < 60_000) return hit.promise
  const promise = fetch(url, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  shared.set(url, { at: Date.now(), promise })
  return promise
}

function useJson<T>(url: string): T | null {
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    load(url).then((d) => live && setData((d as T) ?? null))
    return () => {
      live = false
    }
  }, [url])
  return data
}

const pairUrl = (leagueId: string) => `/api/league/college-pro-pair?leagueId=${encodeURIComponent(leagueId)}`
const standingsUrl = (leagueId: string) => `/api/league/college-pro-standings?leagueId=${encodeURIComponent(leagueId)}`
const leagueHref = (leagueId: string, tab?: string) => `/league/${encodeURIComponent(leagueId)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`

function GameRow(props: { label: string; week: number | null; me: { name: string; total: number | null }; opp: { name: string; total: number | null } | null; testId: string }) {
  const { me, opp } = props
  const winning = opp && me.total != null && opp.total != null ? me.total >= opp.total : null
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5" data-testid={props.testId}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {props.label}
        {props.week != null ? ` · Wk ${props.week}` : ''}
      </span>
      <span className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="truncate font-semibold text-primary">{me.name}</span>
        <span className={['tabular-nums font-bold', winning === true ? 'text-emerald-500' : winning === false ? 'text-rose-500' : 'text-primary'].join(' ')}>
          {pts(me.total)}
        </span>
        {opp ? (
          <>
            <span className="text-muted">vs</span>
            <span className="truncate text-secondary">{opp.name}</span>
            <span className="tabular-nums text-secondary">{pts(opp.total)}</span>
          </>
        ) : (
          <span className="text-muted">no game this week</span>
        )}
      </span>
    </li>
  )
}

/** Matchup tab: your pro game and your college game this week, as one card. */
export function CollegeProWeek({ leagueId, children }: { leagueId: string; children: ReactNode }) {
  const data = useJson<CollegeProRosterPayload>(`/api/league/college-pro-roster?leagueId=${encodeURIComponent(leagueId)}`)
  if (!data || !data.applies) return <>{children}</>
  const pro = data.sides.find((s): s is CollegeProSide => s.role === 'pro')
  const college: CollegeMatchup | null = data.collegeMatchup
  const proGame = pro?.score
    ? { me: { name: pro.teamLabel ?? 'Your team', total: pro.score.total }, opp: pro.score.opponent ? { name: pro.score.opponent.name ?? 'Opponent', total: pro.score.opponent.total } : null }
    : null
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-subtle bg-surface-muted/40 p-3 sm:p-4" data-testid="college-pro-week">
        <h2 className="mb-1 text-sm font-bold text-primary">This week, both leagues</h2>
        <ul className="space-y-1">
          {proGame && pro ? (
            <GameRow label={sportLabel(pro.sport)} week={pro.score.week} me={proGame.me} opp={proGame.opp} testId="college-pro-week-pro" />
          ) : null}
          {college ? <GameRow label="College" week={college.period} me={college.me} opp={college.opponent} testId="college-pro-week-college" /> : null}
        </ul>
        {data.scoring === 'combined' && data.headToHead ? (
          <p className="mt-2 px-2 text-xs text-secondary" data-testid="college-pro-week-combined">
            <span className="font-semibold text-primary">Combined:</span> {pts(data.headToHead.me)}
            {data.headToHead.opponent ? ` vs ${data.headToHead.opponent.name ?? 'your opponent'} ${pts(data.headToHead.opponent.total)}` : ''}
            {data.headToHead.missing ? <span className="ml-1 text-muted">{data.headToHead.missing}</span> : null}
          </p>
        ) : null}
      </section>
      {children}
    </div>
  )
}

const rec = (r: { wins: number; losses: number; ties: number } | null) => (r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}` : '—')

/** Standings tab: one row per franchise — the pro team and the college team it is matched to. */
export function CollegeProStandings({ leagueId, children }: { leagueId: string; children: ReactNode }) {
  const data = useJson<CollegeProStandingsPayload>(standingsUrl(leagueId))
  // With no franchise paired yet, the table would only repeat the pro standings below it.
  if (!data || !data.applies || !data.rows.some((r) => r.collegeKey)) return <>{children}</>
  const proLabel = sportLabel(data.pro.sport)
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-subtle bg-surface-muted/40 p-3 sm:p-4" data-testid="college-pro-standings">
        <h2 className="text-sm font-bold text-primary">Franchise standings</h2>
        <p className="mb-2 text-[11px] text-muted">
          Each manager&apos;s {data.pro.name} and {data.college.name} records together.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1 pr-2 font-semibold">#</th>
                <th className="py-1 pr-2 font-semibold">Team</th>
                <th className="py-1 pr-2 text-right font-semibold">{proLabel}</th>
                <th className="py-1 pr-2 text-right font-semibold">College</th>
                <th className="py-1 pr-2 text-right font-semibold">Total</th>
                <th className="py-1 text-right font-semibold">Points</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={r.proKey}
                  className={['border-t border-subtle', r.isMine ? 'bg-cyan-400/10' : ''].join(' ')}
                  data-testid="college-pro-standings-row"
                  data-mine={r.isMine ? 'true' : undefined}
                >
                  <td className="py-1.5 pr-2 tabular-nums text-muted">{r.rank}</td>
                  <td className="py-1.5 pr-2">
                    <span className="font-semibold text-primary">{r.proName}</span>
                    {r.collegeName ? <span className="block text-[11px] text-muted">{r.collegeName}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-secondary">{rec(r.proRecord)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-secondary">{rec(r.collegeRecord)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-bold text-primary">{rec(r.total)}</td>
                  <td className="py-1.5 text-right tabular-nums text-secondary">{pts(r.total.pointsFor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.unmatchedCollege > 0 ? (
          <p className="mt-2 text-[11px] text-muted" data-testid="college-pro-standings-unmatched">
            {data.unmatchedCollege} college {data.unmatchedCollege === 1 ? 'team isn’t' : 'teams aren’t'} matched to a pro team yet, so{' '}
            {data.unmatchedCollege === 1 ? 'it isn’t' : 'they aren’t'} in this table.
          </p>
        ) : null}
      </section>
      {children}
    </div>
  )
}

/** Header: the league this one is half of a franchise with, one tap away. */
export function CollegeProPairChip({ leagueId }: { leagueId: string }) {
  const data = useJson<CollegeProPairLink>(pairUrl(leagueId))
  if (!data || !data.applies) return null
  const body = (
    <>
      <span className="text-white/60">With</span>
      <span className="max-w-[12rem] truncate">{data.other.name}</span>
      <span className="text-white/60">· {data.other.label}</span>
    </>
  )
  const cls = 'inline-flex min-h-6 items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-400/[0.08] px-2 text-[11px] font-bold text-[var(--badge-text-cyan)]'
  return data.other.canOpen ? (
    <Link href={leagueHref(data.other.leagueId)} className={`${cls} hover:brightness-110`} data-testid="college-pro-pair-chip" title={`Open ${data.other.name}`}>
      {body}
      <span aria-hidden>›</span>
    </Link>
  ) : (
    <span className={cls} data-testid="college-pro-pair-chip">{body}</span>
  )
}

/** Home: your franchise across both halves — where it ranks, and each half's record. */
export function CollegeProFranchiseCard({ leagueId, children }: { leagueId: string; children: ReactNode }) {
  const data = useJson<CollegeProStandingsPayload>(standingsUrl(leagueId))
  const link = useJson<CollegeProPairLink>(pairUrl(leagueId))
  const mine = data && data.applies ? data.rows.find((r) => r.isMine) : null
  if (!data || !data.applies || !mine || !mine.collegeKey) return <>{children}</>
  const proLabel = sportLabel(data.pro.sport)
  const other = link && link.applies ? link.other : null
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-subtle bg-surface-muted/40 p-3 sm:p-4" data-testid="college-pro-franchise-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-primary">Your franchise</h2>
          <span className="text-xs text-secondary">
            <span className="font-bold text-primary">#{mine.rank}</span> of {data.rows.length} · {rec(mine.total)}
          </span>
        </div>
        <ul className="mt-2 space-y-1 text-xs">
          <li className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{proLabel}</span>{' '}
              <span className="font-semibold text-primary">{mine.proName}</span>
            </span>
            <span className="tabular-nums text-secondary">{rec(mine.proRecord)}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">College</span>{' '}
              <span className="font-semibold text-primary">{mine.collegeName}</span>
            </span>
            <span className="tabular-nums text-secondary">{rec(mine.collegeRecord)}</span>
          </li>
        </ul>
        {other?.canOpen ? (
          <Link href={leagueHref(other.leagueId)} className="mt-2 inline-block text-xs font-semibold text-[var(--badge-text-cyan)] hover:underline">
            Open {other.name} ›
          </Link>
        ) : null}
      </section>
      {children}
    </div>
  )
}

type OtherHalfTab = 'draft' | 'trades' | 'waivers'
const OTHER_HALF_COPY: Record<OtherHalfTab, (half: string, name: string) => string> = {
  draft: (half, name) => `Your ${half} draft happens in ${name}.`,
  trades: (half, name) => `Trades for your ${half} players are made in ${name}.`,
  waivers: (half, name) => `Pick up ${half} players in ${name}.`,
}

/** Draft / Trades / Waivers: this tab covers this half only, so say where the other half's moves are made. */
export function CollegeProOtherHalf({ leagueId, tab, children }: { leagueId: string; tab: OtherHalfTab; children: ReactNode }) {
  const data = useJson<CollegeProPairLink>(pairUrl(leagueId))
  if (!data || !data.applies) return <>{children}</>
  const half = data.other.label === 'College' ? 'college' : data.other.label
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p
        className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-subtle bg-surface-muted/40 px-3 py-2 text-xs text-secondary sm:mx-5"
        data-testid="college-pro-other-half"
      >
        <span>{OTHER_HALF_COPY[tab](half, data.other.name)}</span>
        {data.other.canOpen ? (
          <Link href={leagueHref(data.other.leagueId, tab)} className="font-semibold text-[var(--badge-text-cyan)] hover:underline">
            Open {data.other.name} ›
          </Link>
        ) : null}
      </p>
      {children}
    </div>
  )
}
