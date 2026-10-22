'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Lock } from 'lucide-react'
import { SurvivorIdolSetup } from '@/components/survivor/SurvivorIdolSetup'
import { SurvivorTribesPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTribesPanel'
import {
  buildSeasonPreview,
  changedSettingsKeys,
  formatVoteTime,
  isSettingLocked,
  SURVIVOR_SETTINGS_EDITABLE_ALL_SEASON,
  SURVIVOR_VOTE_DAYS,
  SURVIVOR_VOTE_TIMES,
  type SurvivorSettingsContext,
  type SurvivorSettingsForm,
  type SurvivorSettingsKey,
  type SurvivorSettingsLocks,
} from '@/lib/survivor/survivorSettingsScreen'
import { SurvivorStateCard } from './core/SurvivorStateCard'
import { SvkEmpty, SvkField, SvkSegmented, SvkSkeleton, SvkStepper, SvkToggle } from './core/SurvivorKit'
import './survivor-core.css'

type ScreenState = {
  leagueName: string
  form: SurvivorSettingsForm
  context: SurvivorSettingsContext
  locks: SurvivorSettingsLocks
  chimmyBossAvailable: boolean
  commissionerPlays: boolean
}

const SECTIONS = [
  { id: 'svt-tribes', label: 'Tribes', icon: '/survivor/late/buff-koa.svg' },
  { id: 'svt-tribal', label: 'Tribal Council', icon: '/survivor/weekly/torch-lit-icon.svg' },
  { id: 'svt-idols', label: 'Hidden idols', icon: '/survivor/idols/immunity-icon.svg' },
  { id: 'svt-exile', label: 'Exile Island', icon: '/survivor/exile/token-icon.svg' },
  { id: 'svt-swap', label: 'Swap, merge, jury', icon: '/survivor/late/jury-icon.svg' },
  { id: 'svt-sharing', label: 'Sharing', icon: '/survivor/late/champion-icon.svg' },
] as const

const WEEK_ICON: Record<string, string> = {
  tribal: '/survivor/weekly/torch-lit-icon.svg',
  swap: '/survivor/late/buff-vela.svg',
  merge: '/survivor/late/buff-merge.svg',
  jury: '/survivor/late/jury-icon.svg',
  finale: '/survivor/late/champion-icon.svg',
}

/** Commissioner Survivor settings (survivor-core handoff §2, SurvivorSettings). */
export function SurvivorSettingsScreen({ leagueId, backHref }: { leagueId: string; backHref: string }) {
  const [state, setState] = useState<ScreenState | null>(null)
  const [draft, setDraft] = useState<SurvivorSettingsForm | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [panel, setPanel] = useState<'crests' | 'idols' | null>(null)
  const [active, setActive] = useState<string>(SECTIONS[0].id)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/settings-screen`, { cache: 'no-store', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not load Survivor settings')
      setState(data as ScreenState)
      setDraft((data as ScreenState).form)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load Survivor settings')
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load])

  const changed = useMemo(() => (state && draft ? changedSettingsKeys(state.form, draft) : []), [state, draft])
  const preview = useMemo(() => (state && draft ? buildSeasonPreview(draft, state.context) : null), [state, draft])

  function set<K extends SurvivorSettingsKey>(key: K, value: SurvivorSettingsForm[K]) {
    setMessage(null)
    setDraft(current => (current ? { ...current, [key]: value } : current))
  }

  async function save() {
    if (!draft || !changed.length || preview?.errors.length) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/settings-screen`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form: draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save Survivor settings')
      if (data.state) { setState(data.state); setDraft(data.state.form) }
      setMessage({ tone: 'ok', text: 'Settings saved.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save Survivor settings' })
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return <div className="svk" style={{ minHeight: '100vh' }}>
      <div className="svk-page" style={{ paddingTop: 40 }}>
        <div className="svk-card"><SvkEmpty icon="/survivor/exile/wax-seal.svg" title="Survivor settings didn't load" body={loadError}><button type="button" className="svk-btn" onClick={() => void load()}>Try again</button></SvkEmpty></div>
      </div>
    </div>
  }
  if (!state || !draft || !preview) {
    return <div className="svk" style={{ minHeight: '100vh' }} role="status" aria-label="Loading Survivor settings">
      <div className="svt-layout"><SvkSkeleton height={260} /><SvkSkeleton height={620} radius={14} /><SvkSkeleton height={320} radius={14} /></div>
    </div>
  }

  const locked = (key: SurvivorSettingsKey) => isSettingLocked(key, state.locks)
  const lockNote = (key: SurvivorSettingsKey) => locked(key)
    ? <span className="svt-lock"><Lock size={12} aria-hidden /> Locked</span>
    : state.locks.draftStarted && SURVIVOR_SETTINGS_EDITABLE_ALL_SEASON.includes(key) ? <span className="svk-pill svk-pill-warn">Editable all season</span> : null
  const disabled = (key: SurvivorSettingsKey) => saving || locked(key)
  const perTribe = Math.round(state.context.managers / Math.max(1, draft.tribeCount))
  const bossOptions = [
    ...(state.chimmyBossAvailable ? [{ value: 'chimmy_roster' as const, label: 'Chimmy’s roster' }] : []),
    { value: 'median' as const, label: 'League median' },
    { value: 'fixed' as const, label: 'Fixed score' },
    { value: 'topN' as const, label: `Top-${draft.exileBossTopN} average` },
  ]

  return <div className="svk" style={{ minHeight: '100vh' }} data-testid="survivor-settings-screen">
    <header className="svk-head">
      <Link href={backHref} className="svk-btn svk-btn-icon" aria-label="Back to the league"><ChevronLeft size={18} aria-hidden /></Link>
      <div className="svk-grow">
        <h1>Survivor settings</h1>
        <p className="svk-head-sub">{state.leagueName} · Commissioner · {state.locks.draftStarted ? 'The draft has started; only marked settings can change' : 'Locks when the draft starts, except where marked'}</p>
      </div>
      <span className={changed.length ? 'svk-pill svk-pill-warn' : 'svk-pill svk-pill-ok'} role="status" data-testid="survivor-settings-unsaved">{changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}` : 'All saved'}</span>
      <button type="button" className="svk-btn svk-btn-gold" disabled={!changed.length || saving || preview.errors.length > 0} onClick={() => void save()} data-testid="survivor-settings-save">{saving ? 'Saving…' : 'Save settings'}</button>
    </header>
    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} style={{ padding: '10px 28px 0', fontSize: 14, color: message.tone === 'error' ? '#ffb4a6' : '#8fd694' }}>{message.text}</p>}

    <div className="svt-layout">
      <nav className="svt-nav" aria-label="Settings sections">
        {SECTIONS.map(s => <a key={s.id} href={`#${s.id}`} aria-current={active === s.id} onClick={() => setActive(s.id)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.icon} alt="" />{s.label}
        </a>)}
      </nav>

      <div className="svt-main">
        {state.locks.draftStarted && <div className="svk-card"><SurvivorStateCard state="locked" compact /></div>}
        <section id="svt-tribes" className="svk-card svt-sec" aria-labelledby="svt-tribes-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-tribes-h"><img src={SECTIONS[0].icon} alt="" />Tribes</h2>
          <SvkField title="Number of tribes" hint={`${perTribe} managers per tribe with ${state.context.managers} in the league. Changing it resets tribe crests to the defaults.`}>
            {lockNote('tribeCount')}
            <SvkStepper label="Number of tribes" value={draft.tribeCount} min={2} max={5} onChange={n => set('tribeCount', n)} disabled={disabled('tribeCount')} testId="survivor-settings-tribe-count" />
          </SvkField>
          <SvkField title="How tribes are formed" hint={draft.tribeFormation === 'random' ? 'Random is drawn on the server and revealed after the draft.' : draft.tribeFormation === 'draft_pattern' ? 'Snake by draft order, revealed after the draft.' : 'You place every manager before the draft.'}>
            {lockNote('tribeFormation')}
            <SvkSegmented label="How tribes are formed" value={draft.tribeFormation} onChange={v => set('tribeFormation', v)} disabled={disabled('tribeFormation')} options={[
              { value: 'random', label: 'Random' },
              { value: 'commissioner_manual', label: 'Commissioner', disabled: state.commissionerPlays },
              { value: 'draft_pattern', label: 'Snake by draft' },
            ]} />
          </SvkField>
          <SvkField title="Tribe names and crests" hint="Picked from the original tribes. Saved on its own; you can swap them before the reveal.">
            <button type="button" className="svk-btn" aria-expanded={panel === 'crests'} onClick={() => setPanel(p => (p === 'crests' ? null : 'crests'))}>{panel === 'crests' ? 'Close crests' : 'Choose crests'}</button>
          </SvkField>
          {panel === 'crests' && <div className="svt-sub-panel"><SurvivorTribesPanel leagueId={leagueId} canEdit hasAfCommissionerSub={false} /></div>}
        </section>

        <section id="svt-tribal" className="svk-card svt-sec" aria-labelledby="svt-tribal-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-tribal-h"><img src={SECTIONS[1].icon} alt="" />Tribal Council</h2>
          <SvkField title="Votes close" hint="Eastern time. Managers see it in their own time zone.">
            {lockNote('voteDay')}
            <select className="svk-select" aria-label="Vote deadline day" value={draft.voteDay} onChange={e => set('voteDay', e.target.value)} disabled={disabled('voteDay')} data-testid="survivor-settings-vote-day">
              {SURVIVOR_VOTE_DAYS.map(day => <option key={day} value={day}>{day}</option>)}
            </select>
            <select className="svk-select" aria-label="Vote deadline time" value={draft.voteTime} onChange={e => set('voteTime', e.target.value)} disabled={disabled('voteTime')}>
              {[...new Set([...SURVIVOR_VOTE_TIMES, draft.voteTime])].sort().map(time => <option key={time} value={time}>{formatVoteTime(time)} ET</option>)}
            </select>
          </SvkField>
          <SvkField title="Allow voting for yourself" hint="Off by default.">
            {lockNote('selfVotesAllowed')}
            <SvkToggle label="Allow voting for yourself" checked={draft.selfVotesAllowed} onChange={v => set('selfVotesAllowed', v)} disabled={disabled('selfVotesAllowed')} />
          </SvkField>
          <SvkField title="Tied vote" hint="What happens when two or more managers get the most votes.">
            {lockNote('tieRule')}
            <SvkSegmented label="Tied vote" value={draft.tieRule} onChange={v => set('tieRule', v as SurvivorSettingsForm['tieRule'])} disabled={disabled('tieRule')} options={[
              { value: 'revote_then_rocks', label: 'Revote, then rocks' },
              { value: 'rocks_immediately', label: 'Rocks immediately' },
              ...(draft.tieRule === 'revote_then_season_points' ? [{ value: 'revote_then_season_points', label: 'Revote, then season points (legacy)' }] : []),
              ...(draft.tieRule === 'season_points_only' ? [{ value: 'season_points_only', label: 'Season points (legacy)' }] : []),
            ]} />
          </SvkField>
          <SvkField title="Immunity" hint="Top score in each tribe going to Tribal Council. After the merge, top score overall.">
            <span className="svk-pill svk-pill-warn">Always on</span>
          </SvkField>
        </section>

        <section id="svt-idols" className="svk-card svt-sec" aria-labelledby="svt-idols-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-idols-h"><img src={SECTIONS[2].icon} alt="" />Hidden idols</h2>
          <SvkField title="Idols in the league" hint="Immunity and tribe immunity are always included.">
            {lockNote('idolCount')}
            <SvkStepper label="Idols in the league" value={draft.idolCount} min={6} max={8} onChange={n => set('idolCount', n)} disabled={disabled('idolCount')} />
          </SvkField>
          <SvkField title="Which idols" hint="Random uses the balanced draw of playable idols. Pick lets you choose. Saved on its own in idol setup.">
            <button type="button" className="svk-btn" aria-expanded={panel === 'idols'} onClick={() => setPanel(p => (p === 'idols' ? null : 'idols'))}>{panel === 'idols' ? 'Close idol setup' : 'Open idol setup'}</button>
          </SvkField>
          {panel === 'idols' && <div className="svt-sub-panel"><SurvivorIdolSetup leagueId={leagueId} canEdit /></div>}
          <SvkField title="Hide idol locations from me" hint="Recommended if you're also playing.">
            {lockNote('hideIdolsFromCommissioner')}
            <SvkToggle label="Hide idol locations from me" checked={draft.hideIdolsFromCommissioner} onChange={v => set('hideIdolsFromCommissioner', v)} disabled={disabled('hideIdolsFromCommissioner')} />
          </SvkField>
        </section>

        <section id="svt-exile" className="svk-card svt-sec" aria-labelledby="svt-exile-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-exile-h"><img src={SECTIONS[3].icon} alt="" />Exile Island</h2>
          <SvkField title="Exile Island" hint="Voted-out managers keep playing for a way back.">
            {lockNote('exileEnabled')}
            <SvkToggle label="Exile Island" checked={draft.exileEnabled} onChange={v => set('exileEnabled', v)} disabled={disabled('exileEnabled')} />
          </SvkField>
          {draft.exileEnabled && <>
            <SvkField title="Tokens to return" hint="Hold up to 5.">
              {lockNote('exileReturnTokens')}
              <SvkStepper label="Tokens to return" value={draft.exileReturnTokens} min={1} max={Math.max(5, state.form.exileReturnTokens)} onChange={n => set('exileReturnTokens', n)} disabled={disabled('exileReturnTokens')} />
            </SvkField>
            <SvkField title="Exile boss score" hint="Finish below it and your tokens are wiped. Editable during the season.">
              {lockNote('exileBossMode')}
              <SvkSegmented label="Exile boss score" value={draft.exileBossMode} onChange={v => set('exileBossMode', v)} disabled={disabled('exileBossMode')} options={bossOptions} testId="survivor-settings-boss" />
              {draft.exileBossMode === 'fixed' && <input className="svk-input" type="number" min={0} max={10000} step={0.5} aria-label="Fixed boss score" value={draft.exileBossFixedScore ?? ''} onChange={e => set('exileBossFixedScore', e.target.value === '' ? null : Number(e.target.value))} disabled={disabled('exileBossFixedScore')} />}
              {draft.exileBossMode === 'topN' && <SvkStepper label="Scores averaged" value={draft.exileBossTopN} min={1} max={20} onChange={n => set('exileBossTopN', n)} disabled={disabled('exileBossTopN')} />}
            </SvkField>
          </>}
        </section>

        <section id="svt-swap" className="svk-card svt-sec" aria-labelledby="svt-swap-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-swap-h"><img src={SECTIONS[4].icon} alt="" />Swap, merge and jury</h2>
          <SvkField title="Tribe swap" hint="Optional. Reshuffles tribes once.">
            {lockNote('swapEnabled')}
            <SvkToggle label="Tribe swap" checked={draft.swapEnabled} onChange={v => set('swapEnabled', v)} disabled={disabled('swapEnabled')} />
            {draft.swapEnabled && <SvkStepper label="Swap week" value={draft.swapWeek} min={state.context.firstWeek + 1} max={state.context.lastWeek - 1} format={n => `Wk ${n}`} onChange={n => set('swapWeek', n)} disabled={disabled('swapWeek')} testId="survivor-settings-swap-week" />}
          </SvkField>
          <SvkField title="Merge" hint="Tribes become one. Everyone voted out after this joins the jury.">
            {lockNote('mergeTrigger')}
            <SvkSegmented label="Merge trigger" value={draft.mergeTrigger} onChange={v => set('mergeTrigger', v)} disabled={disabled('mergeTrigger')} options={[{ value: 'week', label: 'By week' }, { value: 'active_player_count', label: 'By managers left' }]} />
            {draft.mergeTrigger === 'week'
              ? <SvkStepper label="Merge week" value={draft.mergeWeek} min={state.context.firstWeek + 1} max={state.context.lastWeek - 1} format={n => `Wk ${n}`} onChange={n => set('mergeWeek', n)} disabled={disabled('mergeWeek')} testId="survivor-settings-merge-week" />
              : <SvkStepper label="Managers left at the merge" value={draft.mergeActivePlayerCount} min={draft.finalistCount + 1} max={state.context.managers - 1} onChange={n => set('mergeActivePlayerCount', n)} disabled={disabled('mergeActivePlayerCount')} />}
          </SvkField>
          <SvkField title="Finalists" hint="The jury picks the champion from these.">
            {lockNote('finalistCount')}
            <SvkSegmented label="Finalists" value={draft.finalistCount} onChange={v => set('finalistCount', v)} disabled={disabled('finalistCount')} options={[{ value: 2, label: '2 finalists' }, { value: 3, label: '3 finalists' }]} />
          </SvkField>
        </section>

        <section id="svt-sharing" className="svk-card svt-sec" aria-labelledby="svt-sharing-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-sharing-h"><img src={SECTIONS[5].icon} alt="" />Sharing</h2>
          <SvkField title="Share cards" hint="Lets managers post big moments outside the app. Off stops every existing card and link.">
            {lockNote('shareCardsEnabled')}
            <SvkToggle label="Share cards" checked={draft.shareCardsEnabled} onChange={v => set('shareCardsEnabled', v)} disabled={disabled('shareCardsEnabled')} />
          </SvkField>
          <SvkField title="Public moment pages" hint="Read-only pages with display names only. Off makes shared links show a sign-in page.">
            {lockNote('publicMomentPages')}
            <SvkToggle label="Public moment pages" checked={draft.publicMomentPages} onChange={v => set('publicMomentPages', v)} disabled={disabled('publicMomentPages') || !draft.shareCardsEnabled} testId="survivor-settings-public-pages" />
          </SvkField>
        </section>
      </div>

      <aside className="svt-side" aria-label="Season preview">
        <div className="svk-card svt-sec" data-testid="survivor-settings-preview">
          <span className="svk-lbl">Season preview · {state.context.managers} managers · {preview.weeks.length} weeks</span>
          <div className="svt-weeks" style={{ marginTop: 12 }}>
            {preview.weeks.map(w => <div key={w.week} className="svt-wk" data-kind={w.kind} title={`Week ${w.week}`}>
              <b>{w.week}</b>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={WEEK_ICON[w.kind]} alt="" />
            </div>)}
          </div>
          <div className="svt-legend">
            <span className="svk-pill">Tribal Council</span>
            {draft.swapEnabled && <span className="svk-pill">Swap</span>}
            <span className="svk-pill">Merge</span>
            <span className="svk-pill">Finale</span>
          </div>
        </div>
        <div className="svk-card svt-sec">
          <span className="svk-lbl">What managers will see</span>
          <ul className="svt-bullets">{preview.summary.map(line => <li key={line}>{line}</li>)}</ul>
        </div>
        {preview.errors.length
          ? <div className="svk-card svt-msg" data-tone="error" role="alert" data-testid="survivor-settings-errors">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/survivor/exile/wax-seal-broken.svg" alt="" />
            <div>{preview.errors.map(error => <p key={error}>{error}</p>)}</div>
          </div>
          : <div className="svk-card svt-msg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/survivor/weekly/urn.svg" alt="" />
            <p>{preview.note}</p>
          </div>}
      </aside>
    </div>
  </div>
}
