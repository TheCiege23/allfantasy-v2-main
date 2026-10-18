'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { TribalCouncilView } from '@/lib/survivor/survivorTribalView'
import { idolDefinition } from '@/lib/survivor/survivorIdolCatalog'
import { SurvivorAvatar } from './SurvivorAvatar'
import './survivor-weekly.css'

const AVATAR_COLORS = ['#3a2410', '#1f2a4d', '#12352a', '#22314f', '#3b1f3f', '#2c3a14']
const IDOL_ART: Record<string, string> = {
  protect_self: 'immunity', vote_shield: 'immunity', extra_vote: 'extra-vote',
  vote_nullifier: 'idol-nullifier', skip_tribal: 'safety-net', vote_steal: 'vote-steal',
}
const DROP_MS = 1100

type Phase = 'choose' | 'dropping' | 'cast'

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function useCountdown(targetIso: string | null): string | null {
  const [now, setNow] = useState(() => Date.now())
  const target = targetIso ? new Date(targetIso).getTime() : NaN
  useEffect(() => {
    if (!Number.isFinite(target)) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [target])
  if (!Number.isFinite(target)) return null
  const left = Math.max(0, Math.floor((target - now) / 1000))
  const days = Math.floor(left / 86400)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(Math.floor((left % 86400) / 3600))}:${pad(Math.floor((left % 3600) / 60))}`
  return days > 0 ? `${days}d ${clock}` : `${clock}:${pad(left % 60)}`
}

function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Cast your vote (VoteCast / MobileVoteCast). One component, two layouts: the CSS swaps the
 * three-column desktop screen for the phone screen with tiles and a sticky action bar.
 * The ballot goes through the same private vote command as @Chimmy, so both paths stay one rule.
 */
export function SurvivorVoteCast({
  leagueId,
  tribeName,
  backHref,
  idolHref,
  initialView = null,
}: {
  leagueId: string
  tribeName?: string | null
  backHref: string
  idolHref?: string
  initialView?: TribalCouncilView | null
}) {
  const [view, setView] = useState<TribalCouncilView | null>(initialView)
  const [selected, setSelected] = useState<string | null>(initialView?.you.yourVoteTargetUserId ?? null)
  const [inkKey, setInkKey] = useState(0)
  const [phase, setPhase] = useState<Phase>(initialView?.you.hasVoted ? 'cast' : 'choose')
  const [instant, setInstant] = useState(Boolean(initialView?.you.hasVoted))
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const refresh = useCallback(async (adopt: boolean) => {
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'The ballot did not load.')
      const next = payload.tribalCouncil as TribalCouncilView
      if (!mounted.current) return
      setView(next)
      setLoadError(null)
      if (adopt && next?.you.hasVoted) {
        setSelected(next.you.yourVoteTargetUserId)
        setPhase('cast')
        setInstant(true)
      }
    } catch (cause) {
      if (mounted.current) setLoadError(cause instanceof Error ? cause.message : 'The ballot did not load.')
    }
  }, [leagueId])

  useEffect(() => { if (!initialView) void refresh(true) }, [initialView, refresh])

  const clock = useCountdown(view?.votingDeadline ?? null)
  const candidates = useMemo(() => view?.ballot?.candidates ?? [], [view?.ballot?.candidates])
  const choice = candidates.find(candidate => candidate.userId === selected) ?? null
  const choiceName = choice?.displayName ?? (selected && selected === view?.you.yourVoteTargetUserId ? view?.you.yourVoteTargetName ?? null : null)
  const immuneNames = candidates.filter(candidate => candidate.isImmune).map(candidate => candidate.displayName)
  const selfBlocked = !view?.ballot?.selfVotesAllowed
  const deadlinePassed = view?.votingDeadline ? new Date(view.votingDeadline).getTime() <= Date.now() : false
  const open = view?.status === 'voting_open' && !deadlinePassed
  const canVote = Boolean(open && view?.you.isEligibleVoter && !view?.you.isSafeFromVote)
  const canChange = Boolean(canVote && view?.you.voteChangeAllowed && !view?.you.voteLocked)
  const votesIn = view?.votesIn ?? null
  const idol = (view?.you.playableIdols ?? []).find(item => !item.alreadyPlayed) ?? null
  const idolDef = idol ? idolDefinition(idol.powerType) : null
  const idolName = idolDef?.name ?? null
  const week = view?.week ?? null

  function pick(userId: string) {
    if (phase !== 'choose') return
    setSelected(userId)
    setInkKey(key => key + 1)
    setError(null)
  }

  async function drop() {
    if (!selected || !canVote || phase !== 'choose') return
    const reduced = prefersReducedMotion()
    setError(null)
    setInstant(reduced)
    setPhase('dropping')
    const wait = reduced ? Promise.resolve() : new Promise(resolve => window.setTimeout(resolve, DROP_MS))
    try {
      const [response] = await Promise.all([
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/submit-vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit-vote', message: `@Chimmy <@${selected}>` }),
        }),
        wait,
      ])
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) throw new Error(typeof payload.error === 'string' ? payload.error : 'Your vote did not go in. Try again.')
      if (!mounted.current) return
      setPhase('cast')
      void refresh(false)
    } catch (cause) {
      if (!mounted.current) return
      setPhase('choose')
      setError(cause instanceof Error ? cause.message : 'Your vote did not go in. Try again.')
    }
  }

  function changeVote() {
    if (!canChange) return
    setPhase('choose')
    setInstant(false)
    setInkKey(key => key + 1)
  }

  if (!view) {
    return <div className="swl-vc" data-testid="survivor-vote-cast"><div className="swl-vc-body"><p className="swl-t2">{loadError ?? 'Loading your ballot…'}</p></div></div>
  }

  const headerSub = `Tribal Council · Week ${week ?? '—'}${tribeName ? ` · Tribe ${tribeName}` : ''}`
  const castButton = <button type="button" className="swl-btn swl-btn-gold" onClick={() => void drop()} disabled={!selected || !canVote || phase !== 'choose'} data-testid="survivor-vote-drop">Drop it in the urn</button>
  const changeButton = canChange ? <button type="button" className="swl-btn" onClick={changeVote} data-testid="survivor-vote-change">Change my vote</button> : null
  const actions = phase === 'choose' ? castButton : phase === 'cast' ? changeButton : null

  return <div className="swl-vc" data-testid="survivor-vote-cast">
    <header className="swl-vc-head">
      <Link className="swl-vc-back" href={backHref} aria-label="Back">‹</Link>
      <div className="swl-vc-title">
        <h1>Cast your vote</h1>
        <span className="swl-t2 swl-vc-dtitle">{headerSub}</span>
        {clock && <span className="swl-vc-mclock">{tribeName ? `Tribe ${tribeName} · ` : ''}closes in <span className="swl-gold swl-num">{clock}</span></span>}
      </div>
      {clock && <div className="swl-vc-clock" role="timer" aria-live="off"><span className="swl-lbl">Votes close in</span><span className="swl-num">{clock}</span></div>}
    </header>

    {error && <p role="alert" className="swl-vc-alert" style={{ marginTop: 16 }}>{error}</p>}

    <div className="swl-vc-body">
      <aside className="swl-vc-list" aria-label="Who goes home?">
        <span className="swl-lbl">Who goes home?</span>
        <div className="swl-vc-picks">
          {candidates.map(candidate => {
            const blockedSelf = candidate.isSelf && selfBlocked
            const disabled = !canVote || phase !== 'choose' || blockedSelf || candidate.isImmune || !candidate.canReceiveYourVote
            const sub = candidate.isImmune ? 'Immune this week' : candidate.isSelf ? (selfBlocked ? 'That’s you' : 'You') : `Week ${week ?? '—'} · ${candidate.weekScore != null ? candidate.weekScore.toFixed(1) : '—'}`
            return <button
              key={candidate.userId}
              type="button"
              className="swl-pick"
              aria-pressed={selected === candidate.userId}
              disabled={disabled}
              onClick={() => pick(candidate.userId)}
              data-testid="survivor-vote-pick"
            >
              <SurvivorAvatar name={candidate.displayName} status={candidate.isImmune ? 'immune' : 'active'} background={colorFor(candidate.userId)} size={40} gapColor="#07080d" />
              <span className="swl-pick-text">
                <span className="swl-pick-name">{candidate.displayName}</span>
                <span className="swl-pick-sub" data-immune={candidate.isImmune}>{sub}</span>
              </span>
              <span className="swl-pick-pts swl-num">{candidate.weekScore != null ? candidate.weekScore.toFixed(1) : '—'}</span>
            </button>
          })}
        </div>
        <p className="swl-vc-note">
          {[selfBlocked ? 'You can’t vote for yourself.' : '', immuneNames.length ? `${joinNames(immuneNames)} won immunity this week and can’t receive votes.` : ''].filter(Boolean).join(' ')}
        </p>
        {!view.you.isEligibleVoter && <p className="swl-vc-note">You aren’t voting at this Tribal Council.</p>}
        {view.you.isSafeFromVote && <p className="swl-vc-note">You’re safe at this council and don’t cast a vote.</p>}
      </aside>

      <section className="swl-vc-center" aria-label="Your ballot">
        <div className="swl-vc-stage">
          <div className={`swl-slip${phase === 'dropping' ? ' is-dropping' : ''}${phase === 'cast' ? ' is-gone' : ''}`} aria-hidden={phase === 'cast'}>
            <div className="swl-slip-top"><span>Tribal Council</span><span>{week ? `Week ${week}` : ''}</span></div>
            <div className="swl-slip-ink-wrap">
              {choiceName
                ? <span key={inkKey} className="swl-ink" data-testid="survivor-vote-ink">{choiceName}</span>
                : <span className="swl-ink-empty">Choose a name…</span>}
            </div>
            <div className="swl-slip-line" />
            <span className="swl-slip-foot">Your vote is secret</span>
          </div>
          {phase === 'cast' && <div className={`swl-vc-confirm${instant ? ' is-instant' : ''}`} role="status" data-testid="survivor-vote-confirm">
            <strong>Your vote is in the urn</strong>
            <span className="swl-t2">{canChange ? 'You can change it until votes close. Nobody sees it until the reveal.' : 'Nobody sees it until the reveal.'}</span>
          </div>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={`swl-urn${phase !== 'choose' && !instant ? ' is-bumping' : ''}`} src="/survivor/weekly/urn.svg" alt="Voting urn" />
        <div className="swl-vc-actions">{actions}</div>
      </section>

      <aside className="swl-vc-rail">
        {idol && idolName && <>
          <div className="swl-card swl-card-gold swl-idol-desktop" data-testid="survivor-vote-idol">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="swl-idol-art" src={`/survivor/idols/${IDOL_ART[idol.powerType] ?? 'immunity'}.svg`} alt="" />
            <div className="swl-idol-text">
              <span className="swl-lbl swl-gold">You hold an idol</span>
              <span style={{ fontWeight: 600 }}>{idolName}</span>
              <span className="swl-t2" style={{ fontSize: 12 }}>{idolDef?.power ? `${idolDef.power} Play it before votes close.` : 'Play it before votes close.'}</span>
              {idolHref && <Link className="swl-idol-link" href={idolHref}>Play idol ›</Link>}
            </div>
          </div>
          <div className="swl-card swl-card-gold swl-idol-mobile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/survivor/idols/${IDOL_ART[idol.powerType] ?? 'immunity'}-icon.svg`} alt="" />
            <span style={{ flex: 1, fontSize: 12.5 }}>You hold an <b className="swl-gold">{idolName}</b>. Play it before votes close.</span>
            {idolHref && <Link className="swl-idol-link" href={idolHref}>Play ›</Link>}
          </div>
        </>}
        {votesIn && <div className="swl-card" data-testid="survivor-votes-in">
          <span className="swl-lbl">Votes in</span>
          <div className="swl-tally" aria-hidden>{Array.from({ length: votesIn.eligibleVoterCount }, (_, index) => <span key={index} data-on={index < votesIn.submittedCount} />)}</div>
          <span className="swl-t2" style={{ fontSize: 12.5 }}>{votesIn.submittedCount} of {votesIn.eligibleVoterCount} managers have voted. Who voted for whom stays sealed.</span>
        </div>}
      </aside>
    </div>

    <div className="swl-vc-bar">{actions}</div>
  </div>
}
