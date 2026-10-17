'use client'

import { useState, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import type { ZombieBoardEntry, ZombieSummary } from './types'
import { ZombieSceneBackground } from './ZombieSceneBackground'
import { ZombieStatusChip, zombieChipStatus, type ZombieChipStatus } from './ZombieStatusChip'
import { ZombieBashingCard, type ZombieBashingRules } from './ZombieBashingCard'
import { ZombieTurnOverlay } from './ZombieTurnOverlay'
import { ZombieWhispererLair } from './ZombieWhispererLair'

/*
 * The Zombie league's home (the Zombie tab on /league/[id]). Layout from the design handoff's
 * ZombieHome screen; every number on it comes from the summary route, which reads the engine's own rules
 * (`getZombieRulesForSport`) — never the handoff's sample values. Deliberately absent in v1: a countdown
 * (infections run once the week's matchups are final, not at a fixed time), a win-probability bar, and
 * any "Use" button for items whose effects the engine does not apply yet.
 */

export interface ZombieHomeProps {
  leagueId: string
}

const CELL_TONE: Record<ZombieChipStatus, string> = {
  survivor: 'border-sky-400/30 bg-sky-500/15 text-sky-50',
  revived: 'border-amber-400/35 bg-amber-500/15 text-amber-50',
  zombie: 'border-lime-400/40 bg-lime-500/20 text-lime-50',
  whisperer: 'border-violet-400/40 bg-violet-500/20 text-violet-50',
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })
const pct = (share: number) => `${Math.round(share * 100)}%`

function statusLine(summary: ZombieSummary, chip: ZombieChipStatus | null, turned: number, total: number): string {
  const lg = summary.league
  const tally = `${turned} of ${total} ${turned === 1 ? 'has' : 'have'} turned.`
  if (lg && lg.currentWeek === 0) return 'The draft comes first. Everyone starts as a Survivor — except one.'
  const prefix = `Week ${summary.week} · `
  switch (chip) {
    case 'survivor':
      return `${prefix}You're still a Survivor. ${tally}`
    case 'revived':
      return `${prefix}You're back from the dead — a Survivor again. ${tally}`
    case 'zombie':
      return `${prefix}You've turned. Beat a Survivor and they turn too. ${tally}`
    case 'whisperer':
      return `${prefix}You're the Whisperer. Every Survivor you beat turns. ${tally}`
    default:
      return `${prefix}${tally}`
  }
}

function matchupStakes(me: ZombieChipStatus, them: ZombieChipStatus, lossToZombieInfects: boolean, theirName: string): string {
  const meHuman = me === 'survivor' || me === 'revived'
  const themHuman = them === 'survivor' || them === 'revived'
  if (meHuman && (them === 'whisperer' || (them === 'zombie' && lossToZombieInfects))) {
    return `${theirName} is infected. Lose and you become a Zombie.`
  }
  if (!meHuman && themHuman && (me === 'whisperer' || lossToZombieInfects)) {
    return `Beat ${theirName} and they turn.`
  }
  return 'No infection on the line — a big enough win still takes a share of their Outbreak Points.'
}

export function ZombieHome({ leagueId }: ZombieHomeProps) {
  const [summary, setSummary] = useState<ZombieSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Null until the first load: the server picks the league's current week. */
  const [week, setWeek] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = week != null ? `?week=${week}` : ''
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/zombie/summary${qs}`, { cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? `Error ${res.status}`)
        setSummary(null)
        return
      }
      const data = (await res.json()) as ZombieSummary
      setSummary(data)
    } catch {
      setError('Failed to load Zombie summary')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId, week])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !summary) {
    return (
      <div className="zombie-glass flex min-h-[200px] items-center justify-center rounded-2xl border border-white/[0.09] p-8">
        <p className="text-sm text-white/65">Loading outbreak data…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="rounded-2xl border border-red-500/35 bg-red-950/25 p-4">
        <p className="text-sm text-red-100">{error}</p>
        <button type="button" onClick={() => load()} className="mt-2 text-xs font-medium text-cyan-300 hover:underline">
          Retry
        </button>
      </div>
    )
  }
  if (!summary) return null

  const names = summary.rosterDisplayNames ?? {}
  const nameOf = (rosterId: string | null | undefined) => (rosterId ? names[rosterId] ?? 'A team' : 'A team')
  const revived = new Set(summary.revivedRosterIds ?? [])
  const chipFor = (rosterId: string, status: string) => zombieChipStatus(status, revived.has(rosterId))
  const lg = summary.league
  const totalWeeks = Math.max(1, lg?.totalWeeks ?? summary.week)
  const turned = summary.statuses.filter((s) => chipFor(s.rosterId, s.status) === 'zombie').length
  const total = summary.statuses.length
  const myChip = summary.myRosterId && summary.myStatus ? chipFor(summary.myRosterId, summary.myStatus) : null
  const lossToZombieInfects = summary.config.infectionLossToZombie !== false
  const rules = summary.rules
  const reviveSerums = rules?.reviveSerums ?? 3
  const hub = `/zombie/${encodeURIComponent(leagueId)}`

  /* Grid order: you first, then Whisperer, Zombies, revived, Survivors — then name. */
  const order: Record<ZombieChipStatus, number> = { whisperer: 0, zombie: 1, revived: 2, survivor: 3 }
  const cells = [...summary.statuses].sort((a, b) => {
    if (a.rosterId === summary.myRosterId) return -1
    if (b.rosterId === summary.myRosterId) return 1
    const d = order[chipFor(a.rosterId, a.status)] - order[chipFor(b.rosterId, b.status)]
    return d !== 0 ? d : nameOf(a.rosterId).localeCompare(nameOf(b.rosterId))
  })

  const m = summary.myMatchup
  const items = summary.myResources ?? { serums: 0, weapons: 0, ambush: 0 }
  const bashRules: ZombieBashingRules | null = rules
    ? { bashingThreshold: rules.bashingMargin, maulingThreshold: rules.maulingMargin, bashShare: rules.bashShare, maulShare: rules.maulShare }
    : null
  const board = summary.weeklyBoard ?? []
  const turnedThisWeek = board.filter((e): e is Extract<ZombieBoardEntry, { kind: 'infection' }> => e.kind === 'infection')
  const blowouts = board.filter((e) => e.kind !== 'infection')
  const infectedPct = total ? Math.round((turned / total) * 100) : 0

  return (
    <div className="space-y-5 text-[var(--zombie-text-full)]">
      <ZombieTurnOverlay
        leagueId={leagueId}
        leagueName={lg?.name}
        moment={summary.turnMoment}
        ctx={{
          reviveSerums,
          serums: items.serums,
          lossToZombieInfects,
          zombieTradeBlocked: summary.config.zombieTradeBlocked,
        }}
      />
      {/* Hero */}
      <header className="relative overflow-hidden rounded-3xl border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.4)]">
        <ZombieSceneBackground themeId={lg?.backgroundTheme} />
        <div className="relative z-[1] flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
          <img
            src={`/zombie/art/char-${myChip ?? 'survivor'}.svg`}
            alt=""
            className="h-20 w-20 shrink-0 drop-shadow-[0_8px_24px_rgba(0,0,0,0.6)] sm:h-28 sm:w-28"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {[lg?.sport, lg?.season ? String(lg.season) : null, 'Zombie', lg ? `${lg.teamCount} teams` : null]
                .filter(Boolean)
                .map((chip) => (
                  <span key={chip} className="rounded-md border border-white/15 bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-white/80">
                    {chip}
                  </span>
                ))}
              {myChip && <ZombieStatusChip status={myChip} />}
            </div>
            <h1 className="truncate text-2xl font-black tracking-tight text-[var(--zombie-toxic,#4ade80)] sm:text-4xl">
              {lg?.name || 'Zombie League'}
            </h1>
            <p className="mt-1 text-sm font-semibold text-lime-100 sm:text-base">{statusLine(summary, myChip, turned, total)}</p>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/70">
              One Whisperer hides among you. Lose to the Whisperer{lossToZombieInfects ? ' or a Zombie' : ''} and you turn.
              Infections run after the week&apos;s last game.
            </p>
            <nav className="mt-4 flex flex-wrap gap-2" aria-label="Zombie league">
              <Link href={`${hub}/matchups`} className="inline-flex min-h-[44px] items-center rounded-xl bg-lime-400 px-4 text-sm font-bold text-black hover:bg-lime-300">
                Matchups
              </Link>
              {[
                ['Items', `${hub}/items`],
                ['Standings', `${hub}/standings`],
                ['Rules', `${hub}/rules`],
                ['Chat', `/league/${leagueId}?tab=Chat`],
              ].map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 bg-black/45 px-4 text-sm font-semibold text-white/90 hover:bg-black/60"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Week selector: the whole season, defaulting to the league's current week. */}
      <div className="flex items-center gap-2">
        <label htmlFor="zombie-week" className="text-sm text-white/55">
          Week
        </label>
        <select
          id="zombie-week"
          value={summary.week}
          onChange={(e) => setWeek(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="min-h-[40px] rounded-xl border border-white/15 bg-black/30 pl-3 pr-8 text-sm text-white focus:outline-none focus:ring-2 focus:ring-lime-500/40"
        >
          {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              {w}
              {lg && w === lg.currentWeek ? ' (now)' : ''}
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-white/40">Updating…</span>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* Infection grid */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">The outbreak</h2>
              <span className="font-mono text-sm text-lime-300">
                {turned}/{total} turned
              </span>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {cells.map((s) => {
                const chip = chipFor(s.rosterId, s.status)
                const isMe = s.rosterId === summary.myRosterId
                return (
                  <li
                    key={s.rosterId}
                    className={clsx('flex min-w-0 items-center gap-2 rounded-xl border px-2 py-2', CELL_TONE[chip], isMe && 'ring-2 ring-white/60')}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
                    <img src={`/zombie/art/status-${chip}.svg`} alt="" className="h-6 w-6 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">
                        {nameOf(s.rosterId)}
                        {isMe ? ' · you' : ''}
                      </span>
                      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{chip}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
            {summary.whispererHidden && (
              <p className="mt-3 text-[12px] text-violet-200/80">A Whisperer walks among the Survivors. Nobody knows who.</p>
            )}
          </section>

          {/* This week's matchup */}
          <section className="rounded-2xl border border-lime-500/25 bg-[linear-gradient(180deg,rgba(20,30,10,0.35),rgba(7,8,13,0.9))] p-4 sm:p-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-lime-300">Week {summary.week} matchup</h2>
            {summary.myMatchupView && bashRules ? (
              <div className="mt-3">
                <ZombieBashingCard m={summary.myMatchupView} rules={bashRules} revived={revived} />
              </div>
            ) : m && myChip ? (
              <>
                <p className="mt-1 text-lg font-bold text-white">You vs {m.opponentName}</p>
                <p className="mt-1 text-[13px] text-white/70">
                  {matchupStakes(myChip, chipFor(m.opponentRosterId, m.opponentStatus), lossToZombieInfects, m.opponentName)}
                </p>
                <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                  <div>
                    <ZombieStatusChip status={myChip} />
                    <p className="mt-2 font-mono text-2xl font-bold text-white">{fmt(m.myScore)}</p>
                    <p className="text-[11px] text-white/45">You</p>
                  </div>
                  <span className="text-xl font-black text-lime-300">VS</span>
                  <div>
                    <ZombieStatusChip status={chipFor(m.opponentRosterId, m.opponentStatus)} />
                    <p className="mt-2 font-mono text-2xl font-bold text-white">{fmt(m.opponentScore)}</p>
                    <p className="truncate text-[11px] text-white/45">{m.opponentName}</p>
                  </div>
                </div>
                <p className="mt-3 text-center text-[11px] text-white/45">{m.final ? 'Final' : "Not final yet — infections run after the week's last game"}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-white/60">No matchup for you this week.</p>
            )}
          </section>

          {/* The Outbreak Report — the week's board */}
          <section
            className="rounded-2xl border border-lime-500/20 bg-[linear-gradient(180deg,rgba(20,30,10,0.3),rgba(7,8,13,0.85))] p-4 sm:p-5"
            data-testid="zombie-outbreak-report"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-lime-300 sm:text-2xl">The Outbreak Report</h2>
                <p className="text-[12px] text-white/55">
                  Week {summary.week}
                  {lg?.name ? ` · ${lg.name}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-3xl font-black text-lime-300">{infectedPct}%</p>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">infected</p>
              </div>
            </div>
            {board.length === 0 ? (
              <p className="mt-4 text-sm text-white/55">Nothing yet — the report fills once the week&apos;s matchups are final.</p>
            ) : (
              <>
                {turnedThisWeek.length ? (
                  <>
                    <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-lime-300">Turned this week</h3>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                      {turnedThisWeek.map((e) => (
                        <li key={e.victimRosterId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3">
                          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
                          <img src="/zombie/art/status-zombie.svg" alt="" className="h-9 w-9 shrink-0" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-white">{nameOf(e.victimRosterId)}</p>
                            <p className="text-[12px] text-white/55">
                              {e.infectorRosterId ? `by ${nameOf(e.infectorRosterId)}` : 'by the infection'}
                              {e.winnerScore != null && e.loserScore != null ? ` · ${fmt(e.winnerScore)} to ${fmt(e.loserScore)}` : ''}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {blowouts.length ? (
                  <>
                    <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-lime-300">Bashings and maulings</h3>
                    <ul className="mt-1 divide-y divide-white/[0.06]">
                      {blowouts.map((e, i) => (
                        <BoardRow key={i} entry={e} nameOf={nameOf} />
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
            <p className="mt-4 text-[11px] text-white/45">
              Infections run after the week&apos;s last game. A stat correction can replay a week.
            </p>
          </section>
        </div>

        <aside className="space-y-5">
          {myChip === 'whisperer' ? (
            <ZombieWhispererLair
              isPublic={summary.whispererPublic !== false}
              horde={(summary.myInfections ?? []).map((id) => nameOf(id))}
              ambushes={items.ambush}
            />
          ) : null}
          {/* Supplies — counts only in v1. */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">Your supplies</h2>
            {summary.myRosterId ? (
              <ul className="mt-3 space-y-3">
                <SupplyRow art="serum" label="Serums" count={items.serums} note={`One registered before kickoff keeps you human for a week; ${reviveSerums} bring a Zombie back.`} />
                <SupplyRow
                  art="weapon-knife"
                  label="Weapons"
                  count={items.weapons}
                  note={rules ? `Earned by big weeks: ${fmt(rules.knifeScore)}+ points, ${fmt(rules.bowScore)}+, or a ${fmt(rules.axeMargin)}+ point win.` : 'Earned by big weeks.'}
                />
                {myChip === 'whisperer' && <SupplyRow art="ambush" label="Ambushes" count={items.ambush} note="The Whisperer's alone." />}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-white/55">Join the league to collect supplies.</p>
            )}
            {summary.myWinnings && (
              <div className="mt-4 rounded-xl border border-lime-500/20 bg-lime-500/[0.06] p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-lime-300">Outbreak Points</p>
                <p className="mt-1 font-mono text-xl font-bold text-white">{fmt(summary.myWinnings.total)}</p>
                <p className="text-[11px] text-white/55">
                  {summary.myWinnings.week != null
                    ? `Week ${summary.week}: ${summary.myWinnings.week >= 0 ? '+' : ''}${fmt(summary.myWinnings.week)}`
                    : `Week ${summary.week} not settled yet`}
                </p>
              </div>
            )}
          </section>

          {/* Rules in 30 seconds — the engine's numbers for this sport. */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">Rules in 30 seconds</h2>
            <ol className="mt-3 space-y-2.5 text-[13px] leading-snug text-white/80">
              {[
                'Everyone starts as a Survivor — except one secret Whisperer.',
                `Lose to the Whisperer${lossToZombieInfects ? ' or a Zombie' : ''} and you turn into a Zombie.`,
                rules
                  ? `You bank your score every week as Outbreak Points. Get infected and that week goes to whoever turned you; lose by ${fmt(rules.maulingMargin)}+ and ${pct(rules.maulShare)} of it goes, by ${fmt(rules.bashingMargin)}+ and ${pct(rules.bashShare)}.`
                  : 'You bank your score every week as Outbreak Points.',
                `A serum registered before kickoff keeps you human for a week; ${reviveSerums} bring a Zombie back.`,
                `Infections run after the week's last game.${summary.config.zombieTradeBlocked ? ' Zombies can\'t trade.' : ''}`,
              ].map((text, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="font-mono font-bold text-lime-300">{i + 1}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            <Link href={`${hub}/rules`} className="mt-3 inline-block text-xs font-semibold text-lime-300 hover:underline">
              Full rules
            </Link>
          </section>
        </aside>
      </div>
    </div>
  )
}

function SupplyRow({ art, label, count, note }: { art: string; label: string; count: number; note: string }) {
  return (
    <li className="flex items-start gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
      <img src={`/zombie/art/${art}.svg`} alt="" className="h-9 w-9 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-white">
          {label} <span className="font-mono text-lime-300">×{count}</span>
        </p>
        <p className="text-[12px] leading-snug text-white/55">{note}</p>
      </div>
    </li>
  )
}

function BoardRow({ entry, nameOf }: { entry: ZombieBoardEntry; nameOf: (id: string | null) => string }) {
  const [art, title] =
    entry.kind === 'infection'
      ? ['turn', entry.infectorRosterId ? `${nameOf(entry.infectorRosterId)} infected ${nameOf(entry.victimRosterId)}` : `${nameOf(entry.victimRosterId)} was infected`]
      : entry.kind === 'mauling'
        ? ['maul', `${nameOf(entry.winnerRosterId)} mauled ${nameOf(entry.loserRosterId)} by ${fmt(entry.margin)}`]
        : ['bash', `${nameOf(entry.winnerRosterId)} bashed ${nameOf(entry.loserRosterId)} by ${fmt(entry.margin)}`]
  return (
    <li className="flex items-center gap-3 py-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
      <img src={`/zombie/art/${art}.svg`} alt="" className="h-8 w-8 shrink-0" />
      <p className="min-w-0 flex-1 text-sm font-semibold text-white/90">{title}</p>
      {entry.amount != null ? (
        <span className="shrink-0 font-mono text-sm text-amber-300" title="Outbreak Points moved">
          +{fmt(entry.amount)}
        </span>
      ) : null}
    </li>
  )
}
