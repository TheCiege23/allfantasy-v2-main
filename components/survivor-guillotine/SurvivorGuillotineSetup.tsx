'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { buildSGSchedule, defaultSGConfig, SG_MODE_LABELS } from '@/lib/survivor-guillotine/config'
import { SG_POWER_LABELS } from '@/lib/survivor-guillotine/powers'
import type { SGConfig, SGMode, SGPowerKind } from '@/lib/survivor-guillotine/types'
import styles from './setup.module.css'

export function SurvivorGuillotineSetup() {
  const [config, setConfig] = useState<SGConfig>(() => defaultSGConfig())
  const [leagueName, setLeagueName] = useState('')
  const [draftType, setDraftType] = useState('snake')
  const [inviteLink, setInviteLink] = useState('')
  const [notice, setNotice] = useState('')
  const [leagueId, setLeagueId] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('leagueId')?.trim() ?? ''
    setLeagueId(id)
    if (!id) return
    fetch(`/api/leagues/${encodeURIComponent(id)}/survivor-guillotine`)
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (data?.season?.config) { setConfig(data.season.config as SGConfig); void loadInvite(id) } })
      .catch(() => setNotice('Could not load saved league rules.'))
  }, [])
  const schedule = useMemo(() => buildSGSchedule(config), [config])
  const merge = schedule.periods.find(period => period.mode === 'merged')
  const gauntlet = schedule.periods.find(period => period.mode === 'gauntlet')
  async function loadInvite(id: string) {
    try {
      const response = await fetch(`/api/leagues/join?leagueId=${encodeURIComponent(id)}`)
      if (!response.ok) return
      const data = await response.json()
      if (typeof data.inviteLink === 'string') setInviteLink(data.inviteLink)
    } catch {
      // Saving rules succeeds independently of invite-link retrieval.
    }
  }
  function update<K extends keyof SGConfig>(key: K, value: SGConfig[K]) {
    setConfig(current => ({ ...current, [key]: value }))
    setNotice('')
  }
  function numberField(key: 'teamCount' | 'tribeCount' | 'championshipPeriod' | 'gauntletPeriods' | 'mergedChopPeriods' | 'faabBudget' | 'nbaGameCap', label: string, min: number, max: number) {
    return <label className={styles.field}>{label}<input type="number" min={min} max={max} value={Number.isFinite(config[key]) ? config[key] : ''} onChange={event => update(key, event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value))} /></label>
  }
  function selectField<K extends keyof SGConfig>(key: K, label: string, options: [SGConfig[K], string][]) {
    return <label className={styles.field}>{label}<select value={String(config[key])} onChange={event => update(key, event.currentTarget.value as SGConfig[K])}>{options.map(([value, text]) => <option key={String(value)} value={String(value)}>{text}</option>)}</select></label>
  }
  function toggle(key: 'gauntletTribeImmunity' | 'gauntletIdolAuction' | 'tradesEnabled' | 'ceremonyPresentation', label: string) {
    return <label className={styles.check}><input type="checkbox" checked={config[key]} onChange={event => update(key, event.currentTarget.checked)} />{label}</label>
  }
  function exportRules() {
    if (schedule.errors.length) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, config, schedule: schedule.periods }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `survivor-guillotine-${config.sport.toLowerCase()}-rules.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Rules exported. This setup preview has not changed a live league.')
  }
  async function saveRules() {
    if (!leagueId || schedule.errors.length) return
    setSaving(true)
    setNotice('Saving league rules…')
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor-guillotine`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rules', config }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Save failed')
      setNotice(`Saved to live league · revision ${data.result.revision}`)
      await loadInvite(leagueId)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Save failed') }
    finally { setSaving(false) }
  }
  async function createLeague() {
    if (leagueId || schedule.errors.length || !leagueName.trim()) return
    if (config.teamCount > 32) { setNotice('New league creation currently supports up to 32 managers.'); return }
    setSaving(true)
    setNotice('Creating your league…')
    try {
      const response = await fetch('/api/leagues', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          concept: 'redraft', sport: config.sport, scoringPreset: config.sport === 'NFL' ? 'fb_half_ppr' : 'nba_points',
          teamCount: config.teamCount, draftType, leagueName: leagueName.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
          conceptSetup: { visibility: 'private', isPublic: false },
        }) })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.error ?? 'League creation failed')
      const id = data.league?.id as string | undefined
      if (!id) throw new Error('League creation returned no league ID')
      setLeagueId(id)
      window.history.replaceState(null, '', `/survivor-guillotine/setup?leagueId=${encodeURIComponent(id)}`)
      const rules = await fetch(`/api/leagues/${encodeURIComponent(id)}/survivor-guillotine`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rules', config }),
      })
      const saved = await rules.json()
      if (!rules.ok) throw new Error(`League ${id} was created. Save its Survivor rules before inviting managers: ${saved.error ?? 'save failed'}`)
      await loadInvite(id)
      setNotice('Survivor Guilly league created. Review your rules, then share the invite link.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'League creation failed') }
    finally { setSaving(false) }
  }
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>ALLFANTASY · COMMISSIONER WORKSHOP</span><h1><Image src="/survivor-guillotine/emblem.svg" alt="" width={52} height={52} className={styles.emblem} />Survivor Guilly</h1><p>Build your island. Set the rules. Leave three standing.</p></div>
      <span className={styles.badge}>{leagueId ? 'Live league setup' : 'Setup preview'}</span>
    </header>
    <p className={styles.preview}>{leagueId ? 'Configure the league rules, then save them to this league. Tribes and each live scoring period are managed after rosters are ready.' : 'Choose your rules and create a private NFL or NBA league. The invite link appears after Survivor Guilly is configured.'}</p>
    <div className={styles.stats}>
      <article><strong>{Number.isFinite(config.teamCount) ? config.teamCount : '—'}</strong><span>Starting teams</span></article>
      <article><strong>{Number.isFinite(config.tribeCount) ? config.tribeCount : '—'}</strong><span>Starting tribes</span></article>
      <article><strong>{merge?.period ?? '—'}</strong><span>Merge period</span></article>
      <article><strong>3</strong><span>Finalists</span></article>
    </div>
    <div className={styles.columns}>
      <div>
        {!leagueId && <section className={styles.card}><h2>Create your league</h2><div className={styles.fields}>
          <label className={styles.field}>League name<input value={leagueName} maxLength={100} onChange={event => setLeagueName(event.currentTarget.value)} placeholder="Survivor All Stars" /></label>
          <label className={styles.field}>Draft format<select value={draftType} onChange={event => setDraftType(event.currentTarget.value)}><option value="snake">Snake</option><option value="linear">Linear</option><option value="auction">Auction</option><option value="offline">Offline</option><option value="auto">Auto</option></select></label>
        </div><p className={styles.hint}>Create the league first; share its invitation after the rules are saved. You can schedule the draft and choose tribes in league control.</p></section>}
        <section className={styles.card}><h2>Your season</h2><div className={styles.fields}>
          {selectField('sport', 'Sport', [['NFL', 'Football'], ['NBA', 'Basketball']])}
          {numberField('teamCount', 'Starting managers', 4, 64)}
          {numberField('tribeCount', 'Starting tribes', 2, 4)}
          {numberField('championshipPeriod', 'Championship scoring period', 2, 60)}
          {numberField('gauntletPeriods', 'Gauntlet periods', 0, 20)}
          {numberField('mergedChopPeriods', 'Individual chop periods', 1, 20)}
          {numberField('faabBudget', 'Season FAAB budget', 0, 100000)}
          {selectField('tribeFormation', 'Form tribes', [['commissioner', 'Commissioner assigns'], ['random', 'Random draw'], ['captain_draft', 'Captain draft'], ['manager_choice', 'Manager choice']])}
        </div><p className={styles.hint}>The last three elimination periods are individual by default. The Gauntlet sits immediately before them. Change the lengths or individual periods below.</p>
        {config.sport === 'NBA' && <div className={styles.inset}><h3>NBA scoring calendar</h3><p>Use your league’s actual weekly scoring periods, including combined weeks. Choose your championship period; football’s Week 14 merge does not apply.</p><div className={styles.fields}>
          {selectField('nbaScoring', 'Weekly scoring', [['total_points', 'Total weekly fantasy points'], ['capped_games', 'Cap player games']])}
          {config.nbaScoring === 'capped_games' && numberField('nbaGameCap', 'Player games per team / period', 1, 200)}
        </div><p className={styles.hint}>For an All-Star or shortened period, choose the elimination format or “No elimination” in the schedule.</p></div>}
        </section>
        <section className={styles.card}><h2>Tribe decisions</h2><div className={styles.fields}>
          {selectField('submissionMode', 'Submission approval', [['first_valid', 'First valid submission'], ['tribe_vote', 'Tribe vote'], ['captain', 'Captain submits'], ['commissioner', 'Commissioner resolves']])}
          {selectField('matchupOrder', 'Matchup selection order', [['alternating', 'Alternating tribes'], ['random', 'Random order'], ['commissioner', 'Commissioner choice']])}
          <label className={styles.field}>Picks per batch<select value={config.matchupBatchSize} onChange={event => update('matchupBatchSize', Number(event.currentTarget.value) as 2 | 3)}><option value={2}>2 matchups</option><option value={3}>3 matchups</option></select></label>
          {selectField('missingSubmission', 'Missed or invalid selections', [['commissioner', 'Commissioner resolves'], ['random', 'League randomizes']])}
        </div><p className={styles.hint}>Each selection pairs both teams. Extra tribe members sit out matchup scoring, remain eligible for the chop, and cannot sit out consecutive periods. Tribes elect captains and replace eliminated captains by vote.</p></section>
        <section className={styles.card}><h2>The Gauntlet</h2><div className={styles.fields}>
          {selectField('gauntletDraft', 'New tribe draft', [['snake', 'Snake'], ['alternating', 'Alternating'], ['commissioner', 'Commissioner choice']])}
          {selectField('gauntletCaptains', 'Captain selection', [['previous_period_top_two', 'Previous period’s two highest scorers'], ['commissioner', 'Commissioner chooses']])}
          {selectField('gauntletElimination', 'Double elimination', [['per_tribe', 'Lowest eligible manager per tribe'], ['league_lowest_two', 'Two lowest eligible managers overall']])}
        </div><p className={styles.hint}>Reset to two equal tribes{gauntlet ? ` before period ${gauntlet.period}` : ''}. No tribe immunity by default.</p>{toggle('gauntletTribeImmunity', 'Enable tribe immunity during the Gauntlet')}{toggle('gauntletIdolAuction', 'Enable FAAB bidding for a recirculating Gauntlet idol')}</section>
        <section className={styles.card}><h2>Hidden powers & Chop Night</h2>
          <p className={styles.hint}>One personal immunity idol is guaranteed in the draft pool. Other powers and reward weeks are concealed, including from a participating commissioner. Player-bound idols follow the player through waivers; weekly rewards disappear when their manager is chopped.</p>
          <div className={styles.powers}>{(Object.keys(SG_POWER_LABELS) as SGPowerKind[]).map(kind => <label className={styles.check} key={kind}><input type="checkbox" disabled={kind === 'personal_immunity'} checked={config.enabledPowers.includes(kind)} onChange={event => update('enabledPowers', event.currentTarget.checked ? [...config.enabledPowers, kind] : config.enabledPowers.filter(item => item !== kind))} />{SG_POWER_LABELS[kind]}{kind === 'personal_immunity' ? ' · required' : ''}</label>)}</div>
          <div className={styles.fields}>
            {selectField('ceremonyMode', 'Chop Night', [['automatic', 'Automatic resolution'], ['hosted', 'Commissioner-hosted ceremony']])}
            {selectField('immunityDeadline', 'Immunity deadline', [['scheduled_ceremony', 'Scheduled ceremony start'], ['custom', 'Custom deadline']])}
            {config.immunityDeadline === 'custom' && <label className={styles.field}>Immunity deadline (UTC)<input type="datetime-local" value={config.customImmunityDeadline?.replace('Z', '') ?? ''} onChange={event => update('customImmunityDeadline', event.currentTarget.value ? `${event.currentTarget.value}Z` : null)} /></label>}
            {selectField('playerPowerDeadline', 'Player-bound power deadline', [['next_game_lock', 'Before attached player’s next game'], ['custom', 'Custom deadline']])}
            {config.playerPowerDeadline === 'custom' && <label className={styles.field}>Player power deadline (UTC)<input type="datetime-local" value={config.customPlayerPowerDeadline?.replace('Z', '') ?? ''} onChange={event => update('customPlayerPowerDeadline', event.currentTarget.value ? `${event.currentTarget.value}Z` : null)} /></label>}
          </div>{toggle('ceremonyPresentation', 'Suspenseful chop presentation and replay')}{toggle('tradesEnabled', 'Allow trading (off by default)')}
          <p className={styles.hint}>Activate privately through @Chimmy. Action powers reveal when executed; immunity reveals during the chop. All powers expire before the merge.</p>
        </section>
      </div>
      <aside className={styles.card}>
        <div className={styles.scheduleHeading}><div><span className={styles.eyebrow}>YOUR SEASON PATH</span><h2>Road to the final three</h2></div><span className={styles.badge}>{config.sport}</span></div>
        <p className={styles.hint}>Choose each period’s format. The preview validates the remaining field before rules can be exported.</p>
        <div aria-live="polite">{schedule.errors.length > 0 ? <div className={styles.errors}><strong>Adjust your schedule</strong><ul>{schedule.errors.map(error => <li key={error}>{error}</li>)}</ul></div> : <p className={styles.valid}>Season fits · three finalists remain</p>}</div>
        <div className={styles.tableWrap}><table><caption className={styles.srOnly}>Weekly elimination schedule</caption><thead><tr><th scope="col">Period</th><th scope="col">Format</th><th scope="col">Teams</th><th scope="col">Chops</th></tr></thead><tbody>{schedule.periods.map(row => <tr key={row.period}>
          <th scope="row">{row.period}</th><td>{row.mode === 'final_three' ? <strong>Final Three</strong> : <select aria-label={`Period ${row.period} format`} value={row.mode} onChange={event => update('periodOverrides', { ...config.periodOverrides, [row.period]: event.currentTarget.value as SGMode })}>{(Object.entries(SG_MODE_LABELS) as [SGMode, string][]).filter(([mode]) => mode !== 'final_three').map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select>}</td><td>{row.teamsEntering}</td><td>{row.chops || '—'}</td>
        </tr>)}</tbody></table></div>
        <button className={styles.secondary} type="button" onClick={() => update('periodOverrides', {})}>Reset period overrides</button>
        <button className={styles.primary} type="button" disabled={schedule.errors.length > 0} onClick={exportRules}>Export season rules</button>
        {!leagueId && <button className={styles.primary} type="button" disabled={schedule.errors.length > 0 || saving || !leagueName.trim()} onClick={createLeague}>{saving ? 'Creating…' : 'Create Survivor Guilly league'}</button>}
        {leagueId && <button className={styles.primary} type="button" disabled={schedule.errors.length > 0 || saving} onClick={saveRules}>{saving ? 'Saving…' : 'Save to league'}</button>}
        {leagueId && <a className={styles.primary} href={`/survivor-guillotine/${encodeURIComponent(leagueId)}`}>Open league island</a>}
        {inviteLink && <div className={styles.inset}><h3>Invite managers</h3><p>Share this link when your league is ready.</p><a href={inviteLink}>{inviteLink}</a><button className={styles.secondary} type="button" onClick={() => { void navigator.clipboard?.writeText(inviteLink).then(() => setNotice('Invite link copied.')) }}>Copy invite link</button></div>}
        <p role="status" className={styles.hint}>{notice}</p>
        <div className={styles.inset}><h3>Manager home</h3><ol><li>Your lineup</li><li>This week’s rules & actions</li><li>Tribe race & matchups</li><li>Elimination danger</li><li>Your private powers</li><li>League activity</li></ol><p>Chopped managers keep chat, spectating, recaps, and ceremony access.</p></div>
      </aside>
    </div>
  </main>
}
