'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { TribeShuffleView } from '@/lib/survivor/tribeSwapService'
import { swapHeadline } from '@/lib/survivor/tribeSwapHeadline'
import { TribeBuff } from './TribeBuff'
import { LateAvatar, usePrefersReducedMotion } from './lateUi'
import './late-season.css'

type Tab = 'swap' | 'merge'
type SwapPhase = 'before' | 'drop' | 'after'

function TribeColumn({ tribe, members, subtitle, names, phase, statusFor }: {
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
        <span className="svl-chip">{members.length} manager{members.length === 1 ? '' : 's'}</span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {members.map((rosterId, index) => {
          const status = statusFor(rosterId)
          return (
            <li key={`${phase}-${rosterId}`} className={`svl-member ${phase === 'after' ? 'svl-card-pop' : ''}`} style={phase === 'after' ? { animationDelay: `${index * 0.12}s` } : undefined}>
              <LateAvatar id={rosterId} name={names[rosterId] ?? 'Manager'} ring={tribe.primary} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{names[rosterId] ?? 'Manager'}</p>
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

function SwapPanel({ view, onReveal, revealing, revealError }: { view: TribeShuffleView; onReveal: () => void; revealing: boolean; revealError: string | null }) {
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
    const fromName = from ? tribeById.get(from)?.name ?? 'another tribe' : null
    if (phase !== 'after') return { text: fromName ? `Original ${fromName}` : 'Tribe member', gold: false }
    if (from && from !== tribeId) return { text: `From ${fromName}`, gold: true }
    return { text: `Stays in ${tribeById.get(tribeId)?.name ?? 'the tribe'}`, gold: false }
  }
  const week = swap?.week ?? view.swapWeek

  if (!swap) {
    return (
      <section className="svl-card" style={{ padding: 22 }}>
        <span className="svl-lbl" style={{ color: '#a99cf0' }}>{view.swapWeek ? `Week ${view.swapWeek} · Tribe swap` : 'Tribe swap'}</span>
        <h3 className="svl-display" style={{ marginTop: 6 }}>No swap yet</h3>
        <p className="svl-t2" style={{ marginTop: 8 }}>
          {view.swapWeek ? `The new tribes are drawn in week ${view.swapWeek} and stay sealed until that week's lineup lock.` : 'This league has no tribe swap scheduled.'}
        </p>
      </section>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: '1 1 280px' }}>
          <span className="svl-lbl" style={{ color: '#a99cf0' }}>Week {week} · {phase === 'after' ? 'New tribes' : 'Tribe swap'}</span>
          <h3 className="svl-display" style={{ marginTop: 4 }} aria-live="polite">
            {phase === 'after' && swap.movedCount != null ? swapHeadline(swap.movedCount) : 'Drop your buffs'}
          </h3>
        </div>
        {swap.sealed ? (
          view.viewer.isCommissioner ? (
            <button type="button" className="svl-btn svl-btn-gold" onClick={onReveal} disabled={revealing}>{revealing ? 'Revealing…' : 'Reveal the new tribes now'}</button>
          ) : (
            <span className="svl-chip">Sealed until {new Date(swap.revealAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          )
        ) : phase === 'before' ? (
          <button type="button" className="svl-btn svl-btn-gold" onClick={play}>Drop your buffs</button>
        ) : (
          <button type="button" className="svl-btn" onClick={replay} disabled={phase === 'drop'}>Replay</button>
        )}
      </div>
      {revealError ? <p role="alert" style={{ color: '#ff8a6a', fontSize: 13 }}>{revealError}</p> : null}
      {swap.sealed ? <p className="svl-t2">The new tribes have been drawn on the server and stay sealed until the next lineup lock. Your tribe and tribe chat stay as they are until then.</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        {columns.map((col) => {
          const tribe = tribeById.get(col.tribeId)
          if (!tribe) return null
          return (
            <TribeColumn
              key={`${phase === 'after' ? 'a' : 'b'}-${col.tribeId}`}
              tribe={tribe}
              members={col.rosterIds}
              subtitle={phase === 'after' ? `New ${tribe.name}` : 'Before the swap'}
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

function MergePanel({ view, onName, busy, error }: { view: TribeShuffleView; onName: (name: string) => void; busy: boolean; error: string | null }) {
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
        <span className="svl-lbl" style={{ color: '#d9b45a' }}>{view.mergeWeek ? `Week ${view.mergeWeek} · The merge` : 'The merge'}</span>
        <h3 className="svl-display" style={{ marginTop: 6 }}>The tribes are still apart</h3>
        <p className="svl-t2" style={{ marginTop: 8 }}>When the merge arrives the tribes become one, immunity goes to the top single score each week, and everyone voted out from then on joins the jury.</p>
      </section>
    )
  }
  const crests = view.tribes.slice(0, 2)
  const title = merge.named && merge.name ? `Welcome to ${merge.name}` : 'Welcome to the merge'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      <section className="svl-card" style={{ flex: '2 1 520px', padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', background: 'radial-gradient(ellipse at 50% 40%, rgba(217,180,90,.14), transparent 60%), var(--svl-card)' }}>
        <span className="svl-lbl" style={{ color: '#d9b45a' }}>{view.mergeWeek ? `Week ${view.mergeWeek} · ` : ''}The merge</span>
        <div style={{ position: 'relative', height: 340, width: '100%', display: 'grid', placeItems: 'center' }}>
          {stage === 'crests' ? (
            <div style={{ display: 'flex', gap: 60 }} aria-hidden="true">
              {crests.map((t, i) => t.crestUrl ? <img key={t.id} src={t.crestUrl} alt="" width={120} height={120} className={i === 0 ? 'svl-crest-l' : 'svl-crest-r'} /> : null)}
            </div>
          ) : (
            <img className="svl-banner-pop" src="/survivor/late/merge-banner.svg" alt="Merged tribe banner" style={{ height: 320, width: 'auto' }} />
          )}
        </div>
        <h3 className="svl-display" style={{ fontSize: 'clamp(26px,4vw,40px)' }} aria-live="polite">{title}</h3>
        <p className="svl-t2" style={{ fontSize: 16 }}>The tribes are now one. From here on it is every manager for themselves.</p>
        <button type="button" className="svl-btn" onClick={replay}>Replay</button>
      </section>

      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Name the merged tribe">
          <span className="svl-lbl">Name the merged tribe</span>
          <div role="radiogroup" aria-label="Suggested names" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
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
              {merge.canName ? (busy ? 'Saving…' : 'Name the tribe') : busy ? 'Voting…' : merge.myVote ? 'Change my vote' : 'Cast my vote'}
            </button>
          ) : null}
          {error ? <p role="alert" style={{ color: '#ff8a6a', fontSize: 13 }}>{error}</p> : null}
          <p className="svl-t3">
            {merge.named
              ? 'The merged tribe has its name.'
              : merge.mode === 'manager_vote'
                ? `The remaining managers vote. ${merge.votesIn} of ${merge.votersTotal} votes in; the last vote names the tribe.`
                : 'The commissioner picks the name.'}{' '}
            Three original names are suggested from the tribe name pool.
          </p>
        </section>

        <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }} aria-label="After the merge">
          <span className="svl-lbl">After the merge</span>
          <p style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="/survivor/weekly/immunity-necklace-icon.svg" alt="" width={36} height={36} /><span className="svl-t2">Immunity goes to the top single score each week.</span></p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="/survivor/late/jury-icon.svg" alt="" width={36} height={36} /><span className="svl-t2">Everyone voted out from here on joins the jury.</span></p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 12 }}><TribeBuff merge style={{ width: 40 }} /><span className="svl-t2">Everyone wears the gold merge buff.</span></p>
        </section>

        <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Managers in the merge">
          <span className="svl-lbl">{merge.members.length} managers in the merge</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {merge.members.map((rosterId) => <LateAvatar key={rosterId} id={rosterId} name={view.names[rosterId] ?? 'Manager'} ring="#d9b45a" />)}
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

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/tribes?leagueId=${encodeURIComponent(leagueId)}&view=shuffle`, { credentials: 'include' })
      const data = (await res.json()) as { view?: TribeShuffleView; error?: string }
      if (!res.ok || !data.view) return setError(data.error ?? 'The tribe swap could not load.')
      setView(data.view)
    } catch {
      setError('The tribe swap could not load.')
    }
  }, [leagueId])
  useEffect(() => {
    if (leagueId) void load()
  }, [leagueId, load])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/survivor/tribes', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...body }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setActionError(data.error ?? 'That did not go through.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="svl" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <Link href={`/survivor/${leagueId}`} aria-label="Back to the island" className="svl-btn" style={{ padding: '0 14px' }}>‹</Link>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 className="svl-h1">Tribe swap and merge</h1>
          <span className="svl-t2">The two mid-season shake-ups. Dates come from the league&apos;s Survivor settings.</span>
        </div>
        <div className="svl-seg" role="tablist" aria-label="Swap or merge">
          <button type="button" role="tab" aria-selected={tab === 'swap'} onClick={() => setTab('swap')}>Swap{view?.swapWeek ? ` · Week ${view.swapWeek}` : ''}</button>
          <button type="button" role="tab" aria-selected={tab === 'merge'} onClick={() => setTab('merge')}>Merge{view?.mergeWeek ? ` · Week ${view.mergeWeek}` : ''}</button>
        </div>
      </header>
      {error ? <p role="alert" style={{ color: '#ff8a6a' }}>{error}</p> : null}
      {!view && !error ? <p className="svl-t2">Loading…</p> : null}
      {view && tab === 'swap' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ flex: '3 1 600px', minWidth: 0 }}>
            <SwapPanel view={view} onReveal={() => post({ action: 'reveal_swap' })} revealing={busy} revealError={actionError} />
          </div>
          <aside style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="svl-card" style={{ padding: 18 }}>
              <span className="svl-lbl">How the swap works</span>
              <ol style={{ margin: '12px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {['The new tribes are drawn at random on the server and sealed until the reveal.', 'Everyone drops their buff at the same time, then picks up their new one.', 'Idols travel with the manager. Tribe chat switches over at the next lock.'].map((text, i) => (
                  <li key={i} style={{ display: 'flex', gap: 12 }}><span style={{ color: '#d9b45a' }}>{i + 1}</span><span className="svl-t2">{text}</span></li>
                ))}
              </ol>
            </section>
            <section className="svl-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="svl-lbl">Buffs</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {view.tribes.map((t) => <TribeBuff key={t.id} primary={t.primary} secondary={t.secondary} style={{ width: 120 }} label={`${t.name} buff`} />)}
                <TribeBuff merge style={{ width: 120 }} label="Merge buff" />
              </div>
              <p className="svl-t3" style={{ fontSize: 14 }}>One buff per tribe, coloured from the tribe&apos;s crest. Shown on the manager&apos;s card and profile. The gold one is the merge buff.</p>
            </section>
          </aside>
        </div>
      ) : null}
      {view && tab === 'merge' ? (
        <MergePanel view={view} busy={busy} error={actionError} onName={(name) => post({ action: view.merge?.canName ? 'name_merge' : 'merge_name_vote', name })} />
      ) : null}
    </div>
  )
}
