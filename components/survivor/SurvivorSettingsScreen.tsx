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
import { seasonPreviewMessages, settingsErrorMessages, survivorSettingsScreenMessages } from '@/lib/survivor/survivorSettingsScreenCopy'
import { messagesFor } from '@/lib/i18n/messages'
import { SurvivorStateCard } from './core/SurvivorStateCard'
import { SurvivorChallengeSettingsSection, SurvivorExileExtras, SurvivorJuryExtras, SurvivorPrizesSection, SurvivorRulesSection, survivorSettingsExtrasMessages } from './SurvivorSettingsExtras'
import { useMessages } from '@/components/i18n/useMessages'
import { SvkEmpty, SvkField, SvkSegmented, SvkSkeleton, SvkStepper, SvkToggle } from './core/SurvivorKit'
import './survivor-core.css'

type ScreenState = {
  leagueName: string
  form: SurvivorSettingsForm
  context: SurvivorSettingsContext
  locks: SurvivorSettingsLocks
  chimmyBossAvailable: boolean
  commissionerPlays: boolean
  language?: 'en' | 'es'
}

type NavKey = 'navTribes' | 'navTribal' | 'navIdols' | 'navExile' | 'navSwap' | 'navChallenges' | 'navSharing' | null

const SECTIONS: readonly { id: string; nav: NavKey; icon: string }[] = [
  { id: 'svt-tribes', nav: 'navTribes', icon: '/survivor/late/buff-koa.svg' },
  { id: 'svt-tribal', nav: 'navTribal', icon: '/survivor/weekly/torch-lit-icon.svg' },
  { id: 'svt-idols', nav: 'navIdols', icon: '/survivor/idols/immunity-icon.svg' },
  { id: 'svt-exile', nav: 'navExile', icon: '/survivor/exile/token-icon.svg' },
  { id: 'svt-swap', nav: 'navSwap', icon: '/survivor/late/jury-icon.svg' },
  { id: 'svt-prizes', nav: null, icon: '/survivor/weekly/urn.svg' },
  { id: 'svt-rules', nav: null, icon: '/survivor/exile/wax-seal.svg' },
  { id: 'svt-challenges', nav: 'navChallenges', icon: '/survivor/weekly/torch-lit-icon.svg' },
  { id: 'svt-sharing', nav: 'navSharing', icon: '/survivor/late/champion-icon.svg' },
]

const WEEK_ICON: Record<string, string> = {
  tribal: '/survivor/weekly/torch-lit-icon.svg',
  swap: '/survivor/late/buff-vela.svg',
  merge: '/survivor/late/buff-merge.svg',
  jury: '/survivor/late/jury-icon.svg',
  finale: '/survivor/late/champion-icon.svg',
}

/** Commissioner Survivor settings (survivor-core handoff §2, SurvivorSettings). English and Spanish. */
export function SurvivorSettingsScreen({ leagueId, backHref }: { leagueId: string; backHref: string }) {
  const [state, setState] = useState<ScreenState | null>(null)
  const [draft, setDraft] = useState<SurvivorSettingsForm | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [panel, setPanel] = useState<'crests' | 'idols' | null>(null)
  const [active, setActive] = useState<string>(SECTIONS[0]!.id)
  const extrasText = useMessages(survivorSettingsExtrasMessages)
  const t = useMessages(survivorSettingsScreenMessages)
  const previewCopy = useMessages(seasonPreviewMessages)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/settings-screen`, { cache: 'no-store', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? t.loadFailed)
      setState(data as ScreenState)
      setDraft((data as ScreenState).form)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.loadFailed)
    }
  }, [leagueId, t.loadFailed])

  useEffect(() => { void load() }, [load])

  const changed = useMemo(() => (state && draft ? changedSettingsKeys(state.form, draft) : []), [state, draft])
  // Validation errors follow League.language (the API's `language`), like the server's 422 message.
  const uiErrorCopy = useMessages(settingsErrorMessages)
  const errorCopy = state?.language ? messagesFor(settingsErrorMessages, state.language) : uiErrorCopy
  const preview = useMemo(() => (state && draft ? buildSeasonPreview(draft, state.context, previewCopy, errorCopy) : null), [state, draft, previewCopy, errorCopy])

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
      if (!res.ok) throw new Error(data.error ?? t.saveFailed)
      if (data.state) { setState(data.state); setDraft(data.state.form) }
      setMessage({ tone: 'ok', text: t.saved })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : t.saveFailed })
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return <div className="svk" style={{ minHeight: '100vh' }}>
      <div className="svk-page" style={{ paddingTop: 40 }}>
        <div className="svk-card"><SvkEmpty icon="/survivor/exile/wax-seal.svg" title={t.didntLoad} body={loadError}><button type="button" className="svk-btn" onClick={() => void load()}>{t.tryAgain}</button></SvkEmpty></div>
      </div>
    </div>
  }
  if (!state || !draft || !preview) {
    return <div className="svk" style={{ minHeight: '100vh' }} role="status" aria-label={t.loading}>
      <div className="svt-layout"><SvkSkeleton height={260} /><SvkSkeleton height={620} radius={14} /><SvkSkeleton height={320} radius={14} /></div>
    </div>
  }

  const locked = (key: SurvivorSettingsKey) => isSettingLocked(key, state.locks)
  const lockNote = (key: SurvivorSettingsKey) => locked(key)
    ? <span className="svt-lock"><Lock size={12} aria-hidden /> {t.locked}</span>
    : state.locks.draftStarted && SURVIVOR_SETTINGS_EDITABLE_ALL_SEASON.includes(key) ? <span className="svk-pill svk-pill-warn">{t.editableAllSeason}</span> : null
  const disabled = (key: SurvivorSettingsKey) => saving || locked(key)
  const extraProps = { draft, set, disabled, lockNote }
  const perTribe = Math.round(state.context.managers / Math.max(1, draft.tribeCount))
  const bossOptions = [
    ...(state.chimmyBossAvailable ? [{ value: 'chimmy_roster' as const, label: t.bossChimmy }] : []),
    { value: 'median' as const, label: t.bossMedian },
    { value: 'fixed' as const, label: t.bossFixed },
    { value: 'topN' as const, label: t.bossTopN(draft.exileBossTopN) },
  ]
  const navLabel = (s: (typeof SECTIONS)[number]) => s.id === 'svt-prizes' ? extrasText.prizesHeading : s.id === 'svt-rules' ? extrasText.rulesHeading : s.nav ? t[s.nav] : s.id

  return <div className="svk" style={{ minHeight: '100vh' }} data-testid="survivor-settings-screen">
    <header className="svk-head">
      <Link href={backHref} className="svk-btn svk-btn-icon" aria-label={t.back}><ChevronLeft size={18} aria-hidden /></Link>
      <div className="svk-grow">
        <h1>{t.title}</h1>
        <p className="svk-head-sub">{state.leagueName} · {t.commissioner} · {state.locks.draftStarted ? t.subLocked : t.subOpen}</p>
      </div>
      <span className={changed.length ? 'svk-pill svk-pill-warn' : 'svk-pill svk-pill-ok'} role="status" data-testid="survivor-settings-unsaved">{changed.length ? t.unsaved(changed.length) : t.allSaved}</span>
      <button type="button" className="svk-btn svk-btn-gold" disabled={!changed.length || saving || preview.errors.length > 0} onClick={() => void save()} data-testid="survivor-settings-save">{saving ? t.saving : t.save}</button>
    </header>
    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} style={{ padding: '10px 28px 0', fontSize: 14, color: message.tone === 'error' ? '#ffb4a6' : '#8fd694' }}>{message.text}</p>}

    <div className="svt-layout">
      <nav className="svt-nav" aria-label={t.sections}>
        {SECTIONS.map(s => <a key={s.id} href={`#${s.id}`} aria-current={active === s.id} onClick={() => setActive(s.id)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.icon} alt="" />{navLabel(s)}
        </a>)}
      </nav>

      <div className="svt-main">
        {state.locks.draftStarted && <div className="svk-card"><SurvivorStateCard state="locked" compact /></div>}
        <section id="svt-tribes" className="svk-card svt-sec" aria-labelledby="svt-tribes-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-tribes-h"><img src={SECTIONS[0]!.icon} alt="" />{t.tribesHeading}</h2>
          <SvkField title={t.tribeCount} hint={t.tribeCountHint(perTribe, state.context.managers)}>
            {lockNote('tribeCount')}
            <SvkStepper label={t.tribeCount} value={draft.tribeCount} min={2} max={5} onChange={n => set('tribeCount', n)} disabled={disabled('tribeCount')} testId="survivor-settings-tribe-count" />
          </SvkField>
          <SvkField title={t.formation} hint={draft.tribeFormation === 'random' ? t.formationRandomHint : draft.tribeFormation === 'draft_pattern' ? t.formationSnakeHint : t.formationManualHint}>
            {lockNote('tribeFormation')}
            <SvkSegmented label={t.formation} value={draft.tribeFormation} onChange={v => set('tribeFormation', v)} disabled={disabled('tribeFormation')} options={[
              { value: 'random', label: t.fRandom },
              { value: 'commissioner_manual', label: t.fCommissioner, disabled: state.commissionerPlays },
              { value: 'draft_pattern', label: t.fSnake },
            ]} />
          </SvkField>
          <SvkField title={t.crests} hint={t.crestsHint}>
            <button type="button" className="svk-btn" aria-expanded={panel === 'crests'} onClick={() => setPanel(p => (p === 'crests' ? null : 'crests'))}>{panel === 'crests' ? t.closeCrests : t.chooseCrests}</button>
          </SvkField>
          {panel === 'crests' && <div className="svt-sub-panel"><SurvivorTribesPanel leagueId={leagueId} canEdit hasAfCommissionerSub={false} /></div>}
        </section>

        <section id="svt-tribal" className="svk-card svt-sec" aria-labelledby="svt-tribal-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-tribal-h"><img src={SECTIONS[1]!.icon} alt="" />{t.tribalHeading}</h2>
          <SvkField title={t.votesClose} hint={t.votesCloseHint}>
            {lockNote('voteDay')}
            <select className="svk-select" aria-label={t.voteDay} value={draft.voteDay} onChange={e => set('voteDay', e.target.value)} disabled={disabled('voteDay')} data-testid="survivor-settings-vote-day">
              {SURVIVOR_VOTE_DAYS.map(day => <option key={day} value={day}>{t.day(day)}</option>)}
            </select>
            <select className="svk-select" aria-label={t.voteTime} value={draft.voteTime} onChange={e => set('voteTime', e.target.value)} disabled={disabled('voteTime')}>
              {[...new Set([...SURVIVOR_VOTE_TIMES, draft.voteTime])].sort().map(time => <option key={time} value={time}>{formatVoteTime(time)} ET</option>)}
            </select>
          </SvkField>
          <SvkField title={t.selfVote} hint={t.selfVoteHint}>
            {lockNote('selfVotesAllowed')}
            <SvkToggle label={t.selfVote} checked={draft.selfVotesAllowed} onChange={v => set('selfVotesAllowed', v)} disabled={disabled('selfVotesAllowed')} />
          </SvkField>
          <SvkField title={t.tie} hint={t.tieHint}>
            {lockNote('tieRule')}
            <SvkSegmented label={t.tie} value={draft.tieRule} onChange={v => set('tieRule', v as SurvivorSettingsForm['tieRule'])} disabled={disabled('tieRule')} options={[
              { value: 'revote_then_rocks', label: t.tieRevoteRocks },
              { value: 'rocks_immediately', label: t.tieRocks },
              ...(draft.tieRule === 'revote_then_season_points' ? [{ value: 'revote_then_season_points', label: t.tieRevotePoints }] : []),
              ...(draft.tieRule === 'season_points_only' ? [{ value: 'season_points_only', label: t.tiePoints }] : []),
            ]} />
          </SvkField>
          <SvkField title={t.immunity} hint={t.immunityHint}>
            <span className="svk-pill svk-pill-warn">{t.alwaysOn}</span>
          </SvkField>
        </section>

        <section id="svt-idols" className="svk-card svt-sec" aria-labelledby="svt-idols-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-idols-h"><img src={SECTIONS[2]!.icon} alt="" />{t.idolsHeading}</h2>
          <SvkField title={t.idolCount} hint={t.idolCountHint}>
            {lockNote('idolCount')}
            <SvkStepper label={t.idolCount} value={draft.idolCount} min={6} max={8} onChange={n => set('idolCount', n)} disabled={disabled('idolCount')} />
          </SvkField>
          <SvkField title={t.whichIdols} hint={t.whichIdolsHint}>
            <button type="button" className="svk-btn" aria-expanded={panel === 'idols'} onClick={() => setPanel(p => (p === 'idols' ? null : 'idols'))}>{panel === 'idols' ? t.closeIdols : t.openIdols}</button>
          </SvkField>
          {panel === 'idols' && <div className="svt-sub-panel"><SurvivorIdolSetup leagueId={leagueId} canEdit /></div>}
          <SvkField title={t.hideIdols} hint={t.hideIdolsHint}>
            {lockNote('hideIdolsFromCommissioner')}
            <SvkToggle label={t.hideIdols} checked={draft.hideIdolsFromCommissioner} onChange={v => set('hideIdolsFromCommissioner', v)} disabled={disabled('hideIdolsFromCommissioner')} />
          </SvkField>
        </section>

        <section id="svt-exile" className="svk-card svt-sec" aria-labelledby="svt-exile-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-exile-h"><img src={SECTIONS[3]!.icon} alt="" />{t.exileHeading}</h2>
          <SvkField title={t.exile} hint={t.exileHint}>
            {lockNote('exileEnabled')}
            <SvkToggle label={t.exile} checked={draft.exileEnabled} onChange={v => set('exileEnabled', v)} disabled={disabled('exileEnabled')} />
          </SvkField>
          {draft.exileEnabled && <>
            <SvkField title={t.tokens} hint={t.tokensHint}>
              {lockNote('exileReturnTokens')}
              <SvkStepper label={t.tokens} value={draft.exileReturnTokens} min={1} max={Math.max(5, state.form.exileReturnTokens)} onChange={n => set('exileReturnTokens', n)} disabled={disabled('exileReturnTokens')} />
            </SvkField>
            <SvkField title={t.boss} hint={t.bossHint}>
              {lockNote('exileBossMode')}
              <SvkSegmented label={t.boss} value={draft.exileBossMode} onChange={v => set('exileBossMode', v)} disabled={disabled('exileBossMode')} options={bossOptions} testId="survivor-settings-boss" />
              {draft.exileBossMode === 'fixed' && <input className="svk-input" type="number" min={0} max={10000} step={0.5} aria-label={t.fixedScore} value={draft.exileBossFixedScore ?? ''} onChange={e => set('exileBossFixedScore', e.target.value === '' ? null : Number(e.target.value))} disabled={disabled('exileBossFixedScore')} />}
              {draft.exileBossMode === 'topN' && <SvkStepper label={t.scoresAveraged} value={draft.exileBossTopN} min={1} max={20} onChange={n => set('exileBossTopN', n)} disabled={disabled('exileBossTopN')} />}
            </SvkField>
            <SurvivorExileExtras {...extraProps} />
          </>}
        </section>

        <section id="svt-swap" className="svk-card svt-sec" aria-labelledby="svt-swap-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-swap-h"><img src={SECTIONS[4]!.icon} alt="" />{t.swapHeading}</h2>
          <SvkField title={t.swap} hint={t.swapHint}>
            {lockNote('swapEnabled')}
            <SvkToggle label={t.swap} checked={draft.swapEnabled} onChange={v => set('swapEnabled', v)} disabled={disabled('swapEnabled')} />
            {draft.swapEnabled && <SvkStepper label={t.swapWeek} value={draft.swapWeek} min={state.context.firstWeek + 1} max={state.context.lastWeek - 1} format={n => t.week(n)} onChange={n => set('swapWeek', n)} disabled={disabled('swapWeek')} testId="survivor-settings-swap-week" />}
          </SvkField>
          <SvkField title={t.merge} hint={t.mergeHint}>
            {lockNote('mergeTrigger')}
            <SvkSegmented label={t.mergeTrigger} value={draft.mergeTrigger} onChange={v => set('mergeTrigger', v)} disabled={disabled('mergeTrigger')} options={[{ value: 'week', label: t.byWeek }, { value: 'active_player_count', label: t.byManagers }]} />
            {draft.mergeTrigger === 'week'
              ? <SvkStepper label={t.mergeWeek} value={draft.mergeWeek} min={state.context.firstWeek + 1} max={state.context.lastWeek - 1} format={n => t.week(n)} onChange={n => set('mergeWeek', n)} disabled={disabled('mergeWeek')} testId="survivor-settings-merge-week" />
              : <SvkStepper label={t.managersLeft} value={draft.mergeActivePlayerCount} min={draft.finalistCount + 1} max={state.context.managers - 1} onChange={n => set('mergeActivePlayerCount', n)} disabled={disabled('mergeActivePlayerCount')} />}
          </SvkField>
          <SvkField title={t.finalists} hint={t.finalistsHint}>
            {lockNote('finalistCount')}
            <SvkSegmented label={t.finalists} value={draft.finalistCount} onChange={v => set('finalistCount', v)} disabled={disabled('finalistCount')} options={[{ value: 2, label: t.finalists2 }, { value: 3, label: t.finalists3 }]} />
          </SvkField>
          <SurvivorJuryExtras {...extraProps} />
        </section>

        <SurvivorPrizesSection {...extraProps} icon="/survivor/weekly/urn.svg" sport={state.context.sport} />
        <SurvivorRulesSection {...extraProps} icon="/survivor/exile/wax-seal.svg" />
        <SurvivorChallengeSettingsSection {...extraProps} icon="/survivor/weekly/torch-lit-icon.svg" />

        <section id="svt-sharing" className="svk-card svt-sec" aria-labelledby="svt-sharing-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h2 id="svt-sharing-h"><img src={SECTIONS[5]!.icon} alt="" />{t.sharingHeading}</h2>
          <SvkField title={t.shareCards} hint={t.shareCardsHint}>
            {lockNote('shareCardsEnabled')}
            <SvkToggle label={t.shareCards} checked={draft.shareCardsEnabled} onChange={v => set('shareCardsEnabled', v)} disabled={disabled('shareCardsEnabled')} />
          </SvkField>
          <SvkField title={t.publicPages} hint={t.publicPagesHint}>
            {lockNote('publicMomentPages')}
            <SvkToggle label={t.publicPages} checked={draft.publicMomentPages} onChange={v => set('publicMomentPages', v)} disabled={disabled('publicMomentPages') || !draft.shareCardsEnabled} testId="survivor-settings-public-pages" />
          </SvkField>
          <SvkField title={t.watch} hint={<>{t.watchHint}{draft.spectatorPageEnabled ? <> <a href={`/l/${encodeURIComponent(leagueId)}/watch`} target="_blank" rel="noreferrer">{t.openWatch}</a></> : null}</>} testId="survivor-settings-spectator">
            {lockNote('spectatorPageEnabled')}
            <SvkToggle label={t.watch} checked={draft.spectatorPageEnabled} onChange={v => set('spectatorPageEnabled', v)} disabled={disabled('spectatorPageEnabled')} testId="survivor-settings-spectator-toggle" />
          </SvkField>
        </section>
      </div>

      <aside className="svt-side" aria-label={t.preview}>
        <div className="svk-card svt-sec" data-testid="survivor-settings-preview">
          <span className="svk-lbl">{t.previewLabel(state.context.managers, preview.weeks.length)}</span>
          <div className="svt-weeks" style={{ marginTop: 12 }}>
            {preview.weeks.map(w => <div key={w.week} className="svt-wk" data-kind={w.kind} title={t.weekTitle(w.week)}>
              <b>{w.week}</b>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={WEEK_ICON[w.kind]} alt="" />
            </div>)}
          </div>
          <div className="svt-legend">
            <span className="svk-pill">{t.legendTribal}</span>
            {draft.swapEnabled && <span className="svk-pill">{t.legendSwap}</span>}
            <span className="svk-pill">{t.legendMerge}</span>
            <span className="svk-pill">{t.legendFinale}</span>
          </div>
        </div>
        <div className="svk-card svt-sec">
          <span className="svk-lbl">{t.whatManagersSee}</span>
          <ul className="svt-bullets" data-testid="survivor-settings-summary">{preview.summary.map(line => <li key={line}>{line}</li>)}</ul>
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
