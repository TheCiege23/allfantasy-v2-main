'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { TribeShuffleView } from '@/lib/survivor/tribeSwapService'
import { castawayNameWithTribeEmoji } from '@/lib/survivor/survivorTribeEmoji'
import { tribeShuffleCopy, tribeShuffleMessages, type TribeShuffleMessages } from '@/lib/survivor/tribeShuffleMessages'
import { useMessages } from '@/components/i18n/useMessages'
import { TribeBuff } from './TribeBuff'
import { LateAvatar, usePrefersReducedMotion } from './lateUi'
import './late-season.css'

type Tab = 'swap' | 'merge'
type SwapPhase = 'before' | 'drop' | 'after'

function TribeColumn({ tribe, members, subtitle, names, phase, statusFor, m }: {
  m: TribeShuffleMessages
  tribe: TribeShuffleView['tribes'][number]
  members: string[]
  subtitle: string
  names: Record<string, string>
  phase: SwapPhase
  statusFor: (rosterId: string) => { text: string; gold: boolean }
}) {
  return (
    <section className="svl-card" style={{ flex: '1 1 300px', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, borderColor: phase === 'after' ? `${tribe.primary}55` : undefined }} aria-label={tribe.name}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {tribe.crestUrl ? <img src={tribe.crestUrl} alt="" width={64} height={64} style={{ flex: 'none' }} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ font: "700 22px 'Cinzel', serif", letterSpacing: '.04em', color: tribe.primary, overflowWrap: 'anywhere' }}>{tribe.name}</p>
          <p className="svl-t3" style={{ fontSize: 14 }}>{subtitle}</p>
        </div>
        <span className="svl-chip">{m.managers(members.length)}</span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {members.map((rosterId, index) => {
          const status = statusFor(rosterId)
          return (
            <li key={`${phase}-${rosterId}`} className={`svl-member ${phase === 'after' ? 'svl-card-pop' : ''}`} style={phase === 'after' ? { animationDelay: `${index * 0.12}s` } : undefined}>
              <LateAvatar id={rosterId} name={names[rosterId] ?? m.manager} ring={tribe.primary} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{castawayNameWithTribeEmoji(names[rosterId] ?? m.manager, tribe.emoji, Boolean(tribe.emoji))}</p>
                <p style={{ fontSize: 14, color: status.gold ? '#f1c95b' : 'var(--svl-t3)' }}>{status.text}</p>
              </div>
              <span
                className={`svl-member-buff ${phase === 'drop' ? 'svl-buff-drop' : phase === 'after' ? 'svl-buff-on' : ''}`}
                style={phase === 'after' ? { animationDelay: `${index * 0.12 + 0.15}s` } : undefined}
              >
                <TribeBuff primary={tribe.primary} secondary={tribe.secondary} style={{ width: '100%' }} />
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function SwapPanel({ view, onReveal, revealing, revealError, m }: { view: TribeShuffleView; onReveal: () => void; revealing: boolean; revealError: string | null; m: TribeShuffleMessages }) {
  const reduced = usePrefersReducedMotion()
  const swap = view.swap
  const revealed = Boolean(swap && !swap.sealed && swap.after)
  const [phase, setPhase] = useState<SwapPhase>(revealed ? 'after' : 'before')
  useEffect(() => setPhase(revealed ? 'after' : 'before'), [revealed])

  const play = useCallback(() => {
    if (reduced) return setPhase('after')
    setPhase('drop')
    setTimeout(() => setPhase('after'), 700)
  }, [reduced])
  const replay = () => {
    setPhase('before')
    setTimeout(play, 350)
  }

  const tribeById = new Map(view.tribes.map((t) => [t.id, t]))
  const before = swap?.before?.length ? swap.before : view.tribes.map((t) => ({ tribeId: t.id, rosterIds: [] as string[] }))
  const columns = phase === 'after' && swap?.after ? swap.after : before
  const oldTribe = new Map<string, string>()
  for (const t of before) for (const id of t.rosterIds) oldTribe.set(id, t.tribeId)
  const statusFor = (rosterId: string, tribeId: string) => {
    const from = oldTribe.get(rosterId)
    const fromName = from ? tribeById.get(from)?.name ?? m.anotherTribe : null
    if (phase !== 'after') return { text: fromName ? m.original(fromName) : m.tribeMember, gold: false }
    if (from && from !== tribeId) return { text: m.from(fromName ?? m.anotherTribe), gold: true }
    return { text: m.staysIn(tribeById.get(tribeId)?.name ?? m.theTribe), gold: false }
  }
  const week = swap?.week ?? view.swapWeek

  if (!swap) {
    return (
      <section className="svl-card" style={{ padding: 22 }}>
        <span className="svl-lbl" style={{ color: '#a99cf0' }}>{view.swapWeek ? m.weekSwapLabel(view.swapWeek) : m.tribeSwap}</span>
        <h3 className="svl-display" style={{ marginTop: 6 }}>{m.noSwapYet}</h3>
        <p className="svl-t2" style={{ marginTop: 8 }}>
          {view.swapWeek ? m.swapScheduled(view.swapWeek) : m.noSwapScheduled}
        </p>
      </section>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: '1 1 280px' }}>
          <span className="svl-lbl" style={{ color: '#a99cf0' }}>{m.weekLabel(week ?? '', phase === 'after' ? m.newTribes : m.tribeSwap)}</span>
          <h3 className="svl-display" style={{ marginTop: 4 }} aria-live="polite">
            {phase === 'after' && swap.movedCount != null ? m.headline(swap.movedCount) : m.dropBuffs}
          </h3>
        </div>
        {swap.sealed ? (
          view.viewer.isCommissioner ? (
            <button type="button" className="svl-btn svl-btn-gold" onClick={onReveal} disabled={revealing}>{revealing ? m.revealing : m.revealNow}</button>
          ) : (
            <span className="svl-chip">{m.sealedUntil(new Date(swap.revealAt).toLocaleString(m.locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span>
          )
        ) : phase === 'before' ? (
          <button type="button" className="svl-btn svl-btn-gold" onClick={play}>{m.dropBuffs}</button>
        ) : (
          <button type="button" className="svl-btn" onClick={replay} disabled={phase === 'drop'}>{m.replay}</button>
        )}
      </div>
      {revealError ? <p role="alert" style={{ color: '#ff8a6a', fontSize: 13 }}>{revealError}</p> : null}
      {swap.sealed ? <p className="svl-t2">{m.sealedNote}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        {columns.map((col) => {
          const tribe = tribeById.get(col.tribeId)
          if (!tribe) return null
          return (
            <TribeColumn
              key={`${phase === 'after' ? 'a' : 'b'}-${col.tribeId}`}
              tribe={tribe}
              members={col.rosterIds}
              m={m}
              subtitle={phase === 'after' ? m.newTribe(tribe.name) : m.beforeSwap}
              names={view.names}
              phase={phase}
              statusFor={(rosterId) => statusFor(rosterId, col.tribeId)}
            />
          )
        })}
      </div>
    </div>
  )
}

function MergePanel({ view, onName, busy, error, m }: { view: TribeShuffleView; onName: (name: string) => void; busy: boolean; error: string | null; m: TribeShuffleMessages }) {
  const reduced = usePrefersReducedMotion()
  const merge = view.merge
  const [stage, setStage] = useState<'crests' | 'banner'>(reduced ? 'banner' : 'crests')
  const replay = useCallback(() => {
    if (reduced) return setStage('banner')
    setStage('crests')
    setTimeout(() => setStage('banner'), 900)
  }, [reduced])
  useEffect(() => {
    if (merge) replay()
  }, [merge, replay])
  const [choice, setChoice] = useState<string | null>(null)
  useEffect(() => setChoice(merge?.myVote ?? merge?.name ?? null), [merge?.myVote, merge?.name])

  if (!merge) {
    return (
      <section className="svl-card" style={{ padding: 22 }}>
        <span className="svl-lbl" style={{ color: '#d9b45a' }}>{view.mergeWeek ? m.weekMergeLabel(view.mergeWeek) : m.theMerge}</span>
        <h3 className="svl-display" style={{ marginTop: 6 }}>{m.stillApart}</h3>
        <p className="svl-t2" style={{ marginTop: 8 }}>{m.mergeExplainer}</p>
      </section>
    )
  }
  const crests = view.tribes.slice(0, 2)
  const title = merge.named && merge.name ? m.welcomeTo(merge.name) : m.welcomeMerge
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      <section className="svl-card" style={{ flex: '2 1 520px', padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', background: 'radial-gradient(ellipse at 50% 40%, rgba(217,180,90,.14), transparent 60%), var(--svl-card)' }}>
        <span className="svl-lbl" style={{ color: '#d9b45a' }}>{view.mergeWeek ? m.weekMergeLabel(view.mergeWeek) : m.theMerge}</span>
        <div style={{ position: 'relative', height: 340, width: '100%', display: 'grid', placeItems: 'center' }}>
          {stage === 'crests' ? (
            <div style={{ display: 'flex', gap: 60 }} aria-hidden="true">
              {crests.map((t, i) => t.crestUrl ? <img key={t.id} src={t.crestUrl} alt="" width={120} height={120} className={i === 0 ? 'svl-crest-l' : 'svl-crest-r'} /> : null)}
            </div>
          ) : (
            <img className="svl-banner-pop" src="/survivor/late/merge-banner.svg" alt={m.mergedBanner} style={{ height: 320, width: 'auto' }} />
          )}
        </div>
        <h3 className="svl-display" style={{ fontSize: 'clamp(26px,4vw,40px)' }} aria-live="polite">{title}</h3>
        <p className="svl-t2" style={{ fontSize: 16 }}>{m.nowOne}</p>
        <button type="button" className="svl-btn" onClick={replay}>{m.replay}</button>
      </section>

      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label={m.nameMerged}>
          <span className="svl-lbl">{m.nameMerged}</span>
          <div role="radiogroup" aria-label={m.suggestedNames} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {(merge.named && merge.name ? [merge.name] : merge.suggestions).map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={choice === name}
                className="svl-name"
                disabled={merge.named || (!merge.canName && !merge.canVote) || busy}
                onClick={() => setChoice(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {!merge.named && (merge.canName || merge.canVote) ? (
            <button type="button" className="svl-btn svl-btn-gold" disabled={!choice || busy || choice === merge.myVote} onClick={() => choice && onName(choice)}>
              {merge.canName ? (busy ? m.saving : m.nameTribe) : busy ? m.voting : merge.myVote ? m.changeVote : m.castVote}
            </button>
          ) : null}
          {error ? <p role="alert" style={{ color: '#ff8a6a', fontSize: 13 }}>{error}</p> : null}
          <p className="svl-t3">
            {merge.named
              ? m.hasName
              : merge.mode === 'manager_vote'
                ? m.managersVote(merge.votesIn, merge.votersTotal)
                : m.commissionerPicks}{' '}
            {m.threeSuggested}
          </p>
        </section>

        <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }} aria-label={m.afterMerge}>
          <span className="svl-lbl">{m.afterMerge}</span>
          <p style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="/survivor/weekly/immunity-necklace-icon.svg" alt="" width={36} height={36} /><span className="svl-t2">{m.immunityTop}</span></p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="/survivor/late/jury-icon.svg" alt="" width={36} height={36} /><span className="svl-t2">{m.juryFromHere}</span></p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 12 }}><TribeBuff merge style={{ width: 40 }} /><span className="svl-t2">{m.goldBuff}</span></p>
        </section>

        <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label={m.managersInMerge}>
          <span className="svl-lbl">{m.inMerge(merge.members.length)}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {merge.members.map((rosterId) => <LateAvatar key={rosterId} id={rosterId} name={view.names[rosterId] ?? m.manager} ring="#d9b45a" />)}
          </div>
        </section>
      </div>
    </div>
  )
}

/** Tribe swap and merge screen (late-season handoff, TribeShuffle). */
export function TribeShuffle({ leagueId, initialTab = 'swap' }: { leagueId: string; initialTab?: Tab }) {
  const [view, setView] = useState<TribeShuffleView | null>(null)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // League.language once the view has loaded (sent with it); the app language until then.
  const appM = useMessages(tribeShuffleMessages)
  const m = view ? tribeShuffleCopy(view.language) : appM

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/tribes?leagueId=${encodeURIComponent(leagueId)}&view=shuffle`, { credentials: 'include' })
      const data = (await res.json()) as { view?: TribeShuffleView; error?: string }
      if (!res.ok || !data.view) return setError(data.error ?? appM.loadFailed)
      setView(data.view)
    } catch {
      setError(appM.loadFailed)
    }
  }, [leagueId, appM.loadFailed])
  useEffect(() => {
    if (leagueId) void load()
  }, [leagueId, load])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/survivor/tribes', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...body }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setActionError(data.error ?? m.actionFailed)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="svl" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <Link href={`/survivor/${leagueId}`} aria-label={m.backToIsland} className="svl-btn" style={{ padding: '0 14px' }}>‹</Link>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 className="svl-h1">{m.title}</h1>
          <span className="svl-t2">{m.subtitle}</span>
        </div>
        <div className="svl-seg" role="tablist" aria-label={m.swapOrMerge}>
          <button type="button" role="tab" aria-selected={tab === 'swap'} onClick={() => setTab('swap')}>{m.swapTab}{view?.swapWeek ? m.tabWeek(view.swapWeek) : ''}</button>
          <button type="button" role="tab" aria-selected={tab === 'merge'} onClick={() => setTab('merge')}>{m.mergeTab}{view?.mergeWeek ? m.tabWeek(view.mergeWeek) : ''}</button>
        </div>
      </header>
      {error ? <p role="alert" style={{ color: '#ff8a6a' }}>{error}</p> : null}
      {!view && !error ? <p className="svl-t2">{m.loading}</p> : null}
      {view && tab === 'swap' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ flex: '3 1 600px', minWidth: 0 }}>
            <SwapPanel m={m} view={view} onReveal={() => post({ action: 'reveal_swap' })} revealing={busy} revealError={actionError} />
          </div>
          <aside style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="svl-card" style={{ padding: 18 }}>
              <span className="svl-lbl">{m.howSwapWorks}</span>
              <ol style={{ margin: '12px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[m.howStep1, m.howStep2, m.howStep3].map((text, i) => (
                  <li key={i} style={{ display: 'flex', gap: 12 }}><span style={{ color: '#d9b45a' }}>{i + 1}</span><span className="svl-t2">{text}</span></li>
                ))}
              </ol>
            </section>
            <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="svl-lbl">{m.buffs}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {view.tribes.map((t) => <TribeBuff key={t.id} primary={t.primary} secondary={t.secondary} style={{ width: 120 }} label={m.buffOf(t.name)} />)}
                <TribeBuff merge style={{ width: 120 }} label={m.mergeBuff} />
              </div>
              <p className="svl-t3" style={{ fontSize: 14 }}>{m.buffsNote}</p>
            </section>
          </aside>
        </div>
      ) : null}
      {view && tab === 'merge' ? (
        <MergePanel m={m} view={view} busy={busy} error={actionError} onName={(name) => post({ action: view.merge?.canName ? 'name_merge' : 'merge_name_vote', name })} />
      ) : null}
    </div>
  )
}
