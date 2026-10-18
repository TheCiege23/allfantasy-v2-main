'use client'

/**
 * Big Brother league home in the specialty-league design
 * (design-refs/native-league-handoff/specialty-leagues/bigbrother/: BigBrotherHome,
 * BigBrotherEviction, MobileBigBrother). Presentation only — every value comes from
 * /api/leagues/[leagueId]/big-brother/summary; nominations post to the existing route.
 *
 * 🛑 Sealed ballots: the eviction moment shows the result and, only when the league shows exact
 * totals, the per-nominee count. Who voted for whom is never in the payload (PRD §5.5).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  SpecialtyCard,
  SpecialtyCountdown,
  SpecialtyFeed,
  SpecialtyGrid,
  SpecialtyHero,
  SpecialtyReplayButton,
  SpecialtyRules,
  SpecialtyShell,
  SpecialtyTag,
  specialtyAsset,
  specialtyAvatarColor,
  specialtyInitials,
  spStyles as sp,
  usePrefersReducedMotion,
  type SpecialtyFeedItem,
  type SpecialtyTone,
} from '@/components/league/specialty/SpecialtyShell'
import type { BigBrotherHomeExtras } from '@/lib/league-specialty/bigBrotherHome'
import type { BigBrotherSummary, BigBrotherUserStatus } from './types'
import bb from './big-brother-specialty.module.css'

export const BB_PHASE_STEPS = ['HOH', 'Nominations', 'Veto comp', 'Veto meeting', 'Eviction vote', 'Live eviction'] as const

export type BigBrotherSpecialtySummary = BigBrotherSummary & { home?: BigBrotherHomeExtras | null }

const asset = (f: string) => specialtyAsset('bigbrother', f)

const STATUS_TAG: Record<BigBrotherUserStatus, { label: string; tone: SpecialtyTone }> = {
  HOH: { label: 'HOH', tone: 'gold' },
  VETO_WINNER: { label: 'Veto', tone: 'acc' },
  NOMINATED: { label: 'Nominee', tone: 'pink' },
  VETO_PLAYER: { label: 'Safe', tone: 'safe' },
  SAFE: { label: 'Safe', tone: 'safe' },
  JURY: { label: 'Jury', tone: 'muted' },
  ELIMINATED: { label: 'Evicted', tone: 'muted' },
}

/** Vote reveal: tick k shows nominee i at min(final, k - i); one vote at a time. */
export function revealCounts(finals: readonly number[], tick: number): number[] {
  return finals.map((f, i) => Math.max(0, Math.min(f, tick - i)))
}
export function revealTicks(finals: readonly number[]): number {
  return finals.reduce((m, f, i) => Math.max(m, f + i), 0)
}

function Avatar({ id, name, url, size = 44, className = '' }: { id: string; name: string; url?: string | null; size?: number; className?: string }) {
  return (
    <span className={`${sp.av} ${className}`} style={{ background: specialtyAvatarColor(id), width: size, height: size }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : specialtyInitials(name)}
    </span>
  )
}

function yourWeek(s: BigBrotherSpecialtySummary): { title: string; body: string } {
  const st = s.myStatus
  const ballot = s.ballot
  if (!st) return { title: 'You’re watching this house', body: 'You don’t have a houseguest in this league.' }
  if (st === 'ELIMINATED') return { title: 'You’ve been evicted', body: 'Your team no longer plays this season.' }
  if (st === 'JURY') return { title: 'You’re on the jury', body: 'You vote for the winner in the finale.' }
  if (st === 'HOH') return { title: 'You’re Head of Household', body: 'You name two nominees. You only vote to break a tie.' }
  if (st === 'NOMINATED') return { title: 'You’re on the block', body: 'Win the Veto or hope the house keeps you.' }
  if (st === 'VETO_WINNER') return { title: 'You hold the Veto', body: 'You can save one nominee at the Veto meeting.' }
  if (ballot?.canVote) return { title: 'You’re safe and you vote this week', body: 'Your eviction ballot is private until the season ends.' }
  return { title: 'You’re safe this week', body: 'You’re not nominated. Your ballot stays private until the season ends.' }
}

export function BigBrotherSpecialtyHome({
  leagueId,
  summary,
  onChanged,
}: {
  leagueId: string
  summary: BigBrotherSpecialtySummary
  /** Re-load the summary after an action (nominations). */
  onChanged?: () => void
}) {
  const home = summary.home ?? null
  const names = summary.rosterDisplayNames ?? {}
  const nameOf = (id: string | null | undefined) => (id ? names[id] ?? 'A houseguest' : '—')
  const cycle = summary.cycle
  const step = home?.phaseStep ?? -1
  const total = summary.totalRosterCount ?? summary.memoryWall?.length ?? 0
  const remaining = summary.remainingCount ?? total
  const title = home?.leagueName ?? 'Big Brother'
  const wall = summary.memoryWall ?? []
  const avatarOf = new Map(wall.map((w) => [w.rosterId, w.avatarUrl]))
  const week = yourWeek(summary)
  const headline = cycle ? `Week ${cycle.week}${step >= 0 ? ` · ${BB_PHASE_STEPS[step]}` : ''}` : 'The house opens soon'

  const feed: SpecialtyFeedItem[] = (home?.feed ?? []).map((e) => ({
    id: e.id,
    icon: asset(e.kind === 'hoh' ? 'icon-hoh.svg' : e.kind === 'veto' ? 'icon-veto.svg' : 'icon-evict.svg'),
    title: e.kind === 'hoh' ? `${nameOf(e.rosterId)} won HOH` : e.kind === 'veto' ? `${nameOf(e.rosterId)} won the Veto` : `${nameOf(e.rosterId)} was evicted`,
    sub: `Week ${e.week}`,
  }))

  const juryWords =
    summary.config.juryStartMode === 'when_remaining'
      ? 'when the house reaches the configured size'
      : summary.config.juryStartMode === 'fixed_week'
        ? 'from the configured week'
        : 'after the configured number of evictions'
  const rules = [
    'Top fantasy score among eligible houseguests wins HOH.',
    'The HOH nominates two houseguests.',
    'Top score among the Veto players wins the Veto and can save a nominee.',
    'The house votes to evict. The HOH only votes to break a tie.',
    `Evicted managers lose their team and their players go to waivers. Pending trades are cancelled. The jury starts ${juryWords}.`,
  ]

  const nominate = summary.myStatus === 'HOH' && cycle?.phase === 'NOMINATION_OPEN'

  return (
    <SpecialtyShell format="bigbrother" testId="bb-specialty-home">
      <div className={bb.desktopOnly}>
        <SpecialtyHero
          format="bigbrother"
          bannerSrc={asset('banner.svg')}
          emblemSrc={asset('emblem.svg')}
          emblemAlt="Big Brother league crest"
          chips={[
            summary.config.sport.toUpperCase(),
            ...(home?.season ? [String(home.season)] : []),
            'Big Brother',
            `${total} houseguests · ${remaining} in the house`,
          ]}
          title={title}
          headline={headline}
          blurb="Redraft fantasy with a house twist: fantasy points win HOH and the Veto, the house votes someone out, and the last one in wins the league."
          actions={[
            { label: 'Go to the house', href: '#bb-houseguests', primary: true },
            ...(home?.lastEviction ? [{ label: 'Eviction night', href: '#bb-eviction' }] : []),
            { label: 'My lineup', href: `/league/${encodeURIComponent(leagueId)}?view=team` },
          ]}
          clock={
            <SpecialtyCountdown
              label={home?.nextDecision?.label ?? 'Next decision'}
              target={home?.nextDecision?.at}
              caption={home?.nextDecision ? new Date(home.nextDecision.at).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : 'Not scheduled yet'}
            />
          }
        />
      </div>

      <div className={bb.desktopOnly}>
        <SpecialtyGrid
          main={
            <>
              <SpecialtyCard label="This week in the house" testId="bb-phase-tracker">
                <ol className={bb.ph} aria-label="Week phases">
                  {BB_PHASE_STEPS.map((label, i) => (
                    <li key={label} className={i < step ? bb.done : i === step ? bb.on : undefined} aria-current={i === step ? 'step' : undefined}>
                      <i aria-hidden>{i < step ? '✓' : i + 1}</i>
                      <span>
                        {label}
                        {i < step ? <span className="sr-only"> (done)</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </SpecialtyCard>

              <div className={bb.spots}>
                <div className={bb.spot} style={{ borderColor: 'rgba(242,201,76,.4)' }} data-testid="bb-spot-hoh">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={bb.spotIcon} src={asset('icon-hoh.svg')} alt="" aria-hidden />
                  <span className={sp.lbl} style={{ color: '#f2c94c' }}>Head of Household</span>
                  {cycle?.hohRosterId ? (
                    <>
                      <Avatar id={cycle.hohRosterId} name={nameOf(cycle.hohRosterId)} url={avatarOf.get(cycle.hohRosterId)} size={64} className={`${bb.ring} ${bb.ringGold}`} />
                      <span className={bb.spotName}>{nameOf(cycle.hohRosterId)}</span>
                    </>
                  ) : (
                    <span className={sp.t3}>Not decided yet</span>
                  )}
                </div>
                <div className={`${bb.spot} ${bb.spotWide}`} style={{ borderColor: 'rgba(255,94,200,.4)' }} data-testid="bb-spot-block">
                  <span className={sp.lbl} style={{ color: '#ff9ad8' }}>On the block</span>
                  {summary.finalNomineeRosterIds.length ? (
                    <div className={bb.noms}>
                      {summary.finalNomineeRosterIds.map((id) => (
                        <div key={id} className={bb.nom}>
                          <Avatar id={id} name={nameOf(id)} url={avatarOf.get(id)} size={64} className={`${bb.ring} ${bb.ringPink}`} />
                          <span className={bb.spotName}>{nameOf(id)}</span>
                          <span className={sp.t3} style={{ fontSize: 12 }}>
                            {cycle?.replacementNomineeRosterId === id ? 'Replacement nominee' : 'Nominated by HOH'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className={sp.t3}>No nominees yet</span>
                  )}
                  {step === 3 && cycle?.vetoWinnerRosterId ? (
                    <span className={sp.t2} style={{ fontSize: 13 }}>
                      The Veto holder can save one of them. The HOH would then name a replacement.
                    </span>
                  ) : null}
                </div>
                <div className={bb.spot} style={{ borderColor: 'rgba(127,200,255,.4)' }} data-testid="bb-spot-veto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={bb.spotIcon} src={asset('icon-veto.svg')} alt="" aria-hidden />
                  <span className={sp.lbl} style={{ color: '#9fd0ff' }}>Veto holder</span>
                  {cycle?.vetoWinnerRosterId ? (
                    <>
                      <Avatar id={cycle.vetoWinnerRosterId} name={nameOf(cycle.vetoWinnerRosterId)} url={avatarOf.get(cycle.vetoWinnerRosterId)} size={64} className={`${bb.ring} ${bb.ringBlue}`} />
                      <span className={bb.spotName}>{nameOf(cycle.vetoWinnerRosterId)}</span>
                      {cycle.vetoUsed ? <span className={sp.t3} style={{ fontSize: 12 }}>Veto used</span> : null}
                    </>
                  ) : (
                    <span className={sp.t3}>Not won yet</span>
                  )}
                </div>
              </div>

              <SpecialtyCard
                id="bb-houseguests"
                label="Houseguests"
                testId="bb-houseguests"
                aside={<span className={sp.t2} style={{ fontSize: 12.5 }}>Evicted managers lose their team. Their players go to waivers.</span>}
              >
                <ul className={bb.hgGrid}>
                  {wall.map((h) => {
                    const me = h.rosterId === summary.myRosterId
                    const out = h.status === 'ELIMINATED' || h.status === 'JURY'
                    const tag = me && !out ? { label: 'You', tone: 'acc' as SpecialtyTone } : STATUS_TAG[h.status] ?? STATUS_TAG.SAFE
                    const ring =
                      h.status === 'HOH' ? bb.ringGold : h.status === 'NOMINATED' ? bb.ringPink : h.status === 'VETO_WINNER' ? bb.ringBlue : ''
                    return (
                      <li key={h.rosterId} className={`${bb.hg} ${out ? bb.hgOut : ''} ${me ? bb.hgMe : ''}`} data-status={h.status}>
                        <Avatar id={h.rosterId} name={h.displayName} url={h.avatarUrl} size={52} className={`${bb.ring} ${ring} ${bb.grey}`} />
                        <span className={bb.hgName}>{h.displayName}</span>
                        <SpecialtyTag tone={tag.tone}>{me && !out ? 'You' : tag.label}</SpecialtyTag>
                      </li>
                    )
                  })}
                </ul>
              </SpecialtyCard>
            </>
          }
          rail={
            <>
              <SpecialtyCard variant={2} borderColor="rgba(59,130,246,.4)" testId="bb-your-week">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset('icon-hoh.svg')} alt="" aria-hidden style={{ width: 44, height: 44 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className={sp.lbl} style={{ color: '#9fd0ff' }}>Your week</span>
                    <strong style={{ fontSize: 16 }}>{week.title}</strong>
                    <span className={sp.t2} style={{ fontSize: 12.5 }}>{week.body}</span>
                  </div>
                </div>
              </SpecialtyCard>
              <SpecialtyCard label="How a week works">
                <SpecialtyRules rules={rules} />
              </SpecialtyCard>
              <SpecialtyCard label="Latest">
                <SpecialtyFeed items={feed} empty="Week 1 hasn’t played out yet." />
              </SpecialtyCard>
            </>
          }
        />
      </div>

      {/* ---------- phone ---------- */}
      <div className={`${bb.phoneOnly} ${bb.phone}`} data-testid="bb-phone-home">
        <div className={bb.phoneHead}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={bb.bg} src={asset('banner.svg')} alt="" aria-hidden />
          <div className={bb.veil} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={bb.key} src={asset(nominate ? 'icon-hoh.svg' : 'emblem.svg')} alt="" aria-hidden />
          <div className={bb.phoneHeadText}>
            <span className={sp.lbl} style={{ color: nominate ? '#f2c94c' : '#9fd0ff' }}>
              {nominate ? 'You’re Head of Household' : headline}
            </span>
            <h2 className={bb.phoneTitle}>{nominate ? 'Name two nominees' : title}</h2>
          </div>
        </div>
        {nominate && cycle ? (
          <NominationPicker
            leagueId={leagueId}
            cycleId={cycle.id}
            candidates={(summary.eligibility?.canBeNominated ?? []).filter((id) => id !== summary.myRosterId)}
            nameOf={nameOf}
            avatarOf={(id) => avatarOf.get(id) ?? null}
            onLocked={onChanged}
          />
        ) : (
          <>
            <SpecialtyCountdown label={home?.nextDecision?.label ?? 'Next decision'} target={home?.nextDecision?.at} />
            <div className={sp.card} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className={sp.lbl} style={{ color: '#9fd0ff' }}>Your week</span>
              <strong>{week.title}</strong>
              <span className={sp.t2} style={{ fontSize: 12.5 }}>{week.body}</span>
            </div>
            <span className={sp.lbl}>Houseguests</span>
            <ul className={bb.hgGrid}>
              {wall.map((h) => {
                const out = h.status === 'ELIMINATED' || h.status === 'JURY'
                const tag = STATUS_TAG[h.status] ?? STATUS_TAG.SAFE
                return (
                  <li key={h.rosterId} className={`${bb.hg} ${out ? bb.hgOut : ''}`}>
                    <Avatar id={h.rosterId} name={h.displayName} url={h.avatarUrl} size={40} className={bb.grey} />
                    <span className={bb.hgName}>{h.displayName}</span>
                    <SpecialtyTag tone={h.rosterId === summary.myRosterId && !out ? 'acc' : tag.tone}>
                      {h.rosterId === summary.myRosterId && !out ? 'You' : tag.label}
                    </SpecialtyTag>
                  </li>
                )
              })}
            </ul>
            {home?.lastEviction ? (
              <a className={`${sp.btn} ${sp.btnP}`} href="#bb-eviction" style={{ minHeight: 52 }}>
                Eviction night
              </a>
            ) : null}
          </>
        )}
      </div>

      {home?.lastEviction ? <BigBrotherEvictionMoment eviction={home.lastEviction} nameOf={nameOf} avatarOf={(id) => avatarOf.get(id) ?? null} /> : null}
    </SpecialtyShell>
  )
}

/** HOH picks two nominees from the engine's eligible list. "Lock in X and Y" posts the existing route. */
export function NominationPicker({
  leagueId,
  cycleId,
  candidates,
  nameOf,
  avatarOf,
  onLocked,
}: {
  leagueId: string
  cycleId: string
  candidates: string[]
  nameOf: (id: string) => string
  avatarOf: (id: string) => string | null
  onLocked?: () => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? p : [...p, id]))
  const lock = async () => {
    if (picked.length !== 2) return
    setState('saving')
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/nominations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycleId, nominee1RosterId: picked[0], nominee2RosterId: picked[1] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(typeof data.error === 'string' ? data.error : 'Could not lock nominations')
        setState('error')
        return
      }
      setState('idle')
      onLocked?.()
    } catch {
      setError('Could not lock nominations')
      setState('error')
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="bb-nomination-picker">
      <p className={sp.t2} style={{ margin: 0, fontSize: 14 }}>
        Pick two houseguests to put on the block. You can’t nominate yourself or anyone already out.
      </p>
      <ul className={bb.hgGrid} style={{ gridTemplateColumns: '1fr' }}>
        {candidates.map((id) => {
          const on = picked.includes(id)
          return (
            <li key={id}>
              <button
                type="button"
                className={`${sp.row} ${bb.pick}`}
                aria-pressed={on}
                disabled={!on && picked.length >= 2}
                onClick={() => toggle(id)}
              >
                <Avatar id={id} name={nameOf(id)} url={avatarOf(id)} size={40} />
                <span style={{ flex: 1, fontWeight: 600 }}>{nameOf(id)}</span>
                {on ? <SpecialtyTag tone="pink">On the block</SpecialtyTag> : null}
              </button>
            </li>
          )
        })}
      </ul>
      {error ? (
        <p role="alert" style={{ margin: 0, color: '#ff9a8a', fontSize: 13 }}>
          {error}
        </p>
      ) : null}
      <div className={bb.lockBar}>
        <button
          type="button"
          className={`${sp.btn} ${sp.btnP}`}
          disabled={picked.length !== 2 || state === 'saving'}
          onClick={() => void lock()}
          data-testid="bb-lock-nominations"
        >
          {state === 'saving'
            ? 'Locking in…'
            : picked.length === 2
              ? `Lock in ${nameOf(picked[0])} and ${nameOf(picked[1])}`
              : `Pick ${2 - picked.length} more`}
        </button>
      </div>
    </div>
  )
}

/**
 * Signature moment: votes stay sealed until "Reveal the vote", then each count runs up one vote at a
 * time (0.65s apart) and the evicted nominee gets the door and EVICTED. Leagues that keep totals
 * private reveal the result only. Reduced motion shows the final state at once.
 */
export function BigBrotherEvictionMoment({
  eviction,
  nameOf,
  avatarOf,
}: {
  eviction: NonNullable<BigBrotherHomeExtras['lastEviction']>
  nameOf: (id: string) => string
  avatarOf: (id: string) => string | null
}) {
  const reduced = usePrefersReducedMotion()
  const ids = eviction.nomineeRosterIds
  const finals = useMemo(() => ids.map((id) => eviction.votesByNominee?.[id] ?? 0), [ids, eviction.votesByNominee])
  const ticks = revealTicks(finals)
  const [tick, setTick] = useState(-1)
  const timers = useRef<number[]>([])
  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }
  useEffect(() => clear, [])
  const reveal = () => {
    clear()
    if (reduced || !eviction.votesByNominee) {
      setTick(ticks)
      return
    }
    setTick(0)
    for (let i = 1; i <= ticks; i++) timers.current.push(window.setTimeout(() => setTick(i), i * 650))
  }
  const sealed = tick < 0
  const done = tick >= ticks
  const shown = sealed ? null : revealCounts(finals, tick)
  const evictedName = nameOf(eviction.evictedRosterId)
  const stayers = ids.filter((id) => id !== eviction.evictedRosterId)
  const counts = eviction.votesByNominee
  const line = !done
    ? sealed
      ? 'Votes are sealed. Nobody knows the result yet.'
      : 'Counting votes…'
    : counts && stayers.length
      ? `${evictedName} is evicted, ${counts[eviction.evictedRosterId] ?? 0} votes to ${stayers.map((s) => counts[s] ?? 0).join(' to ')}. ${stayers.map(nameOf).join(' and ')} ${stayers.length > 1 ? 'stay' : 'stays'} in the house.`
      : `${evictedName} is evicted.${stayers.length ? ` ${stayers.map(nameOf).join(' and ')} ${stayers.length > 1 ? 'stay' : 'stays'} in the house.` : ''}`

  return (
    <section
      id="bb-eviction"
      className={`${sp.card} ${sp.pad}`}
      style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(255,94,200,.12), transparent 60%), #0b0d14', gap: 16 }}
      data-testid="bb-eviction-moment"
      data-state={sealed ? 'sealed' : done ? 'revealed' : 'counting'}
      aria-labelledby="bb-eviction-title"
    >
      <div className={sp.momentHead}>
        <h2 id="bb-eviction-title" className={sp.h1} style={{ fontSize: 22 }}>
          Eviction night · week {eviction.week}
        </h2>
        {sealed ? (
          <button type="button" className={`${sp.btn} ${sp.btnP}`} onClick={reveal} data-testid="bb-reveal-vote">
            Reveal the vote
          </button>
        ) : (
          <SpecialtyReplayButton onReplay={() => { clear(); setTick(-1) }} />
        )}
      </div>
      <span className={sp.lbl}>{sealed ? 'Votes are sealed' : done ? 'Final count' : 'Counting votes…'}</span>
      <div className={bb.evictStage}>
        {ids.map((id, i) => {
          const out = done && id === eviction.evictedRosterId
          return (
            <div key={id} className={`${bb.evictCard} ${out ? bb.evictOut : ''}`} data-testid={`bb-nominee-${id}`}>
              <Avatar id={id} name={nameOf(id)} url={avatarOf(id)} size={88} className={`${bb.ring} ${bb.ringPink} ${out ? bb.fade : ''}`} />
              <span className={`${bb.spotName} ${out ? bb.fade : ''}`} style={{ fontSize: 20 }}>{nameOf(id)}</span>
              {eviction.nominatedByRosterId ? (
                <span className={`${sp.t3} ${out ? bb.fade : ''}`} style={{ fontSize: 13 }}>
                  Nominated by {nameOf(eviction.nominatedByRosterId)}
                </span>
              ) : null}
              {out ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={bb.door} src={asset('icon-evict.svg')} alt="" aria-hidden />
                  <span className={bb.evictedWord}>EVICTED</span>
                </>
              ) : null}
              {counts ? (
                <>
                  <span className={`${bb.evictCount} ${out ? bb.fade : ''}`} aria-live="polite">
                    {shown ? shown[i] : '–'}
                  </span>
                  <span className={sp.lbl}>Votes to evict</span>
                </>
              ) : null}
            </div>
          )
        })}
      </div>
      <p className={bb.result} style={{ color: done ? '#ffd0ec' : '#a3a9c2' }} aria-live="polite">
        {line}
      </p>
      {!counts ? <p className={sp.empty} style={{ textAlign: 'center' }}>This league keeps vote totals private. Only the result is shown.</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div className={sp.card2} style={{ flex: '1 1 260px', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className={sp.lbl}>What’s shown, what stays private</span>
          <ul className={sp.rules}>
            <li className={sp.rule}><b>✓</b><span>Who was evicted{counts ? ' and the vote count' : ''}.</span></li>
            <li className={sp.rule}><b>✓</b><span>Who voted is never shown until the season ends.</span></li>
            <li className={sp.rule}><b>✓</b><span>AF never reveals sealed ballots in chat or recaps.</span></li>
          </ul>
        </div>
        <div className={sp.card2} style={{ flex: '1 1 260px', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderColor: 'rgba(139,92,246,.35)' }}>
          <span className={sp.lbl} style={{ color: '#c4b5fd' }}>After the eviction</span>
          <span className={sp.t2} style={{ fontSize: 13 }}>
            {done
              ? `${evictedName}${eviction.juryEnrolled ? ' joins the jury.' : ' leaves the house.'} Their team stops scoring and ${
                  eviction.releasedPlayerCount != null ? `all ${eviction.releasedPlayerCount} players go` : 'their players go'
                } to waivers.`
              : 'The evicted manager’s players go to waivers. Pending trades with them are cancelled.'}
          </span>
        </div>
      </div>
    </section>
  )
}
