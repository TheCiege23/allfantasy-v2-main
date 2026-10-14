'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSGSchedule, SG_MODE_LABELS } from '@/lib/survivor-guillotine/config'
import { SG_POWER_LABELS } from '@/lib/survivor-guillotine/powers'
import { buildSGCalendarPreset } from '@/lib/survivor-guillotine/calendar-presets'
import type { SGConfig, SGPower } from '@/lib/survivor-guillotine/types'
import type { SGLivePeriod, SGTribeMember } from '@/lib/survivor-guillotine/live'
import type { SGCalendarEntry, SGTribeDraftState } from '@/lib/survivor-guillotine/operations'
import styles from './league.module.css'

type Team = { legacyRosterId: string | null; teamName: string; ownerName: string; eliminatedAt: string | null }
type Player = { id: string; name: string; position: string; team: string | null }
type Day = { gameDay: string; playerIds: string[] }
type CorrectionCase = { period: number; result: string; changedRosterIds: string[];
  originalChops?: string[]; proposedChops?: string[];
  review?: { decision: string; reason: string; reviewedAt: string } | null }
type Data = { season: { config: SGConfig; tribes: SGTribeMember[]; periodState: SGLivePeriod | null;
  currentPeriod: number; status: string; periodHistory: Record<string, { mode: string; completedAt?: string; choppedTeamIds: string[];
    savedTeamIds: string[]; scores: Record<string, number>; immuneTribeId: string | null }>;
  tribeDraftState: SGTribeDraftState | null };
  ownRoster: { id: string; faabRemaining: number; players: Player[]; dailyLineups: Day[];
    ownBid: { amount: number; status: string } | null; tribeChoice: string | null } | null;
  teams: Team[]; scores: { rosterId: string; totalPoints: number; status: string }[];
  powers: SGPower[]; chops: { period: number; rosterId: string }[];
  stealTargets: (Player & { rosterId: string })[] }

function localDay() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric',
  month: '2-digit', day: '2-digit' }).format(new Date()) }
function localInput(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function SurvivorGuillotineLeague({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [calendar, setCalendar] = useState<Record<number, SGCalendarEntry>>({})
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [gameDay, setGameDay] = useState(localDay)
  const [lineup, setLineup] = useState<string[]>([])
  const [choiceA, setChoiceA] = useState('')
  const [choiceB, setChoiceB] = useState('')
  const [bid, setBid] = useState('')
  const [activePower, setActivePower] = useState('')
  const [powerTarget, setPowerTarget] = useState('')
  const [dropPlayer, setDropPlayer] = useState('')
  const [rewardWeeks, setRewardWeeks] = useState('')
  const [presetStart, setPresetStart] = useState('')
  const [presetDays, setPresetDays] = useState(7)
  const [extendedPeriods, setExtendedPeriods] = useState('')
  const [captainDeadline, setCaptainDeadline] = useState('')
  const [tribeDraft, setTribeDraft] = useState<Record<string, string>>({})
  const [retribePeriod, setRetribePeriod] = useState(0)
  const [retribeDraft, setRetribeDraft] = useState<Record<string, string>>({})
  const [retribeCaptains, setRetribeCaptains] = useState<Record<string, string>>({})
  const [vote, setVote] = useState('')
  const [preferredTribe, setPreferredTribe] = useState('')
  const [draftPick, setDraftPick] = useState('')
  const [captainChoices, setCaptainChoices] = useState<Record<string, string>>({})
  const [tieTribe, setTieTribe] = useState('')
  const [tieChops, setTieChops] = useState('')
  const [tiePlacements, setTiePlacements] = useState('')
  const [tieReason, setTieReason] = useState('')
  const [correctionCases, setCorrectionCases] = useState<CorrectionCase[]>([])
  const [correctionReasons, setCorrectionReasons] = useState<Record<number, string>>({})
  const [replayPeriod, setReplayPeriod] = useState('')
  const [replayStep, setReplayStep] = useState(0)
  const [replayAuto, setReplayAuto] = useState(true)
  const newestSeen = useRef<number | null>(null)
  const lineupLoadedFor = useRef('')
  const api = `/api/leagues/${encodeURIComponent(leagueId)}/survivor-guillotine`
  const refresh = useCallback(async (includeCommissioner = true) => {
    const response = await fetch(api, { cache: 'no-store' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error ?? 'League unavailable')
    setData(payload as Data)
    const latest = Math.max(0, ...Object.keys((payload as Data).season.periodHistory ?? {}).map(Number))
    if (newestSeen.current !== null && latest > newestSeen.current &&
        (payload as Data).season.config.ceremonyPresentation) {
      const completedAt = (payload as Data).season.periodHistory[String(latest)]?.completedAt
      const completedMs = completedAt ? Date.parse(completedAt) : NaN
      const elapsed = Number.isFinite(completedMs) ? Math.max(0, Date.now() - completedMs) : 0
      setReplayPeriod(String(latest)); setReplayStep(Math.min(3, Math.floor(elapsed / 3_500))); setReplayAuto(true)
    }
    newestSeen.current = latest
    setTribeDraft(current => Object.keys(current).length ? current : Object.fromEntries(
      (payload as Data).teams.filter(t => t.legacyRosterId).map((t, index) => [t.legacyRosterId!,
        (payload as Data).season.tribes.find(m => m.rosterId === t.legacyRosterId)?.tribeId ?? `tribe-${index % (payload as Data).season.config.tribeCount}`])))
    if (includeCommissioner) {
      const ops = await fetch(`${api}/operations`, { cache: 'no-store' })
      if (ops.ok) { const privateData = await ops.json(); setIsCommissioner(true); setCalendar(privateData.calendar ?? {}) }
    }
  }, [api])
  useEffect(() => { refresh().catch(error => setNotice(error instanceof Error ? error.message : 'Could not load league')) }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => { refresh(false).catch(() => undefined) }, 8_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    if (!replayPeriod || !replayAuto || replayStep >= 3 ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setTimeout(() => setReplayStep(step => Math.min(step + 1, 3)), 3_500)
    return () => window.clearTimeout(timer)
  }, [replayPeriod, replayAuto, replayStep])
  useEffect(() => {
    const key = `${data?.ownRoster?.id ?? ''}:${gameDay}`
    if (lineupLoadedFor.current === key) return
    lineupLoadedFor.current = key
    const saved = data?.ownRoster?.dailyLineups.find(row => row.gameDay.slice(0, 10) === gameDay)
    setLineup(saved?.playerIds ?? [])
  }, [data, gameDay])
  async function action(path: string, body: Record<string, unknown>, method = 'POST') {
    setBusy(true); setNotice('Saving…')
    try {
      const response = await fetch(`${api}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Action failed')
      if (body.action === 'audit_corrections') setCorrectionCases(payload.result?.changes ?? [])
      setNotice(body.action === 'audit_corrections'
        ? (payload.result?.changes?.length ? `${payload.result.changes.length} earlier periods need commissioner review: ${payload.result.changes.map((row: { period: number; result: string }) => `${row.period} (${row.result})`).join(', ')}` : 'No earlier score changes found.')
        : payload.result?.votesNeeded ? `Private tribe vote recorded: ${payload.result.votesForChoice} of ${payload.result.votesNeeded} needed.`
          : 'Saved. League state is up to date.')
      await refresh()
      if (body.action === 'review_correction') {
        const audit = await fetch(`${api}/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'audit_corrections' }) }).then(response => response.json())
        setCorrectionCases(audit.result?.changes ?? [])
      }
      if (body.action === 'start_captain_draft') setCaptainChoices({})
      if (path === '/chop' && Number.isInteger(body.period)) { setReplayPeriod(String(body.period)); setReplayStep(0) }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Action failed') }
    finally { setBusy(false) }
  }
  const season = data?.season
  const state = season?.periodState
  const schedule = useMemo(() => season ? buildSGSchedule(season.config).periods : [], [season])
  const current = schedule.find(row => row.period === season?.currentPeriod)
  const myTribe = season?.tribes.find(m => m.rosterId === data?.ownRoster?.id)?.tribeId
  const names = new Map(data?.teams.map(t => [t.legacyRosterId, t.teamName || t.ownerName]) ?? [])
  const alive = data?.teams.filter(t => t.legacyRosterId && !t.eliminatedAt) ?? []
  const history = Object.entries(season?.periodHistory ?? {}).sort((a, b) => Number(b[0]) - Number(a[0]))
  const resetPeriods = schedule.filter(row => row.period === (season?.currentPeriod ?? 0) + 1 && state?.ceremonyStarted &&
    (row.mode === 'gauntlet' && schedule.find(p => p.mode === 'gauntlet')?.period === row.period ||
      season?.config.shufflePeriods.includes(row.period)))
  const captainDraft = season?.tribeDraftState
  const pickPlace = captainDraft ? captainDraft.pickIndex % (captainDraft.leaders.length * 2) : 0
  const pickLeader = captainDraft?.leaders[pickPlace < captainDraft.leaders.length
    ? pickPlace : captainDraft.leaders.length * 2 - pickPlace - 1]
  if (!data) return <main className={styles.page}><p role="status">{notice || 'Loading Survivor Guillotine…'}</p></main>
  return <main className={styles.page}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>ALLFANTASY · SURVIVOR GUILLOTINE</span><h1>The island</h1>
      <p>{season?.status === 'completed' ? 'The Sole Survivor has been crowned.' : `Period ${season?.currentPeriod || 1} · ${current ? SG_MODE_LABELS[current.mode] : 'Season setup'}`}</p></div>
      <div className={styles.heroActions}><span>{alive.length} managers standing</span>{isCommissioner && <a href={`/survivor-guillotine/setup?leagueId=${encodeURIComponent(leagueId)}`}>League rules</a>}</div></header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.grid}><div>
      <section className={styles.card}><h2>Your lineup</h2><p>{season?.config.sport === 'NBA' && season.config.nbaScoring === 'capped_games'
        ? `Set starters before the first NBA tip-off each day. The first ${season.config.nbaGameCap} eligible player-games count.`
        : 'Set your starting lineup in the league roster before player lock.'}</p>
        {data.ownRoster && season?.config.sport === 'NBA' && season.config.nbaScoring === 'capped_games' && state && !state.ceremonyStarted ? <>
          <label>Game day (Eastern)<input type="date" value={gameDay} onChange={e => setGameDay(e.target.value)} /></label>
          <div className={styles.playerGrid}>{data.ownRoster.players.map(p => <label key={p.id} className={styles.player}><input type="checkbox" checked={lineup.includes(p.id)} onChange={e => setLineup(v => e.target.checked ? [...v, p.id] : v.filter(id => id !== p.id))} />{p.name} <small>{p.position} · {p.team}</small></label>)}</div>
          <button disabled={busy || !lineup.length} onClick={() => action('/operations', { action: 'daily_lineup', period: state.period, gameDay, playerIds: lineup })}>Save daily starters</button>
        </> : <p>{data.ownRoster ? 'Use your league roster to set the starting lineup for this period.' : 'Claim a league team to manage a lineup.'}</p>}</section>
      <section className={styles.card}><h2>Tribe race</h2><p>{current?.tribeImmunity ? 'The winning tribe earns immunity. The lowest eligible manager outside that tribe faces the chop.' : 'This period has no default tribe immunity.'}</p>
        {season?.currentPeriod === 0 && season.config.tribeFormation === 'manager_choice' && !season.tribes.length && data.ownRoster && <div className={styles.controls}><p>Choose your starting tribe. The league keeps tribe sizes balanced.{data.ownRoster.tribeChoice ? ` Your current choice is ${data.ownRoster.tribeChoice}.` : ''}</p><label>Starting tribe<select value={preferredTribe} onChange={e => setPreferredTribe(e.target.value)}><option value="">Choose tribe</option>{Array.from({ length: season.config.tribeCount }, (_, i) => <option key={i} value={`tribe-${i}`}>Tribe {i + 1}</option>)}</select></label><button disabled={busy || !preferredTribe} onClick={() => action('/operations', { action: 'choose_tribe', tribeId: preferredTribe })}>Choose tribe</button></div>}
        {captainDraft?.status === 'active' && pickLeader && <div className={styles.controls}><h3>Captain draft · {pickLeader.tribeId} on the clock</h3><p>Pick an undrafted manager. Captains will be elected by their finished tribes before Period 1.</p><label>Draft manager<select value={draftPick} onChange={e => setDraftPick(e.target.value)}><option value="">Choose available manager</option>{alive.filter(t => !season?.tribes.some(m => m.rosterId === t.legacyRosterId)).map(t => <option key={t.legacyRosterId} value={t.legacyRosterId!}>{t.teamName}</option>)}</select></label>{(isCommissioner || data.ownRoster?.id === pickLeader.rosterId) && <button disabled={busy || !draftPick} onClick={() => action('/operations', { action: isCommissioner ? 'commissioner_draft_pick' : 'captain_draft_pick', rosterId: draftPick })}>Draft manager</button>}</div>}
        <div className={styles.tribes}>{[...new Set(season?.tribes.map(m => m.tribeId) ?? [])].map(tribeId => <article key={tribeId}><h3>{tribeId}{tribeId === myTribe ? ' · yours' : ''}</h3><ul>{season?.tribes.filter(m => m.tribeId === tribeId).map(m => <li key={m.rosterId}>{names.get(m.rosterId) ?? m.rosterId}{m.captain ? ' ★ captain' : ''}{state?.sitOuts.includes(m.rosterId) ? ' · sitting out' : ''}</li>)}</ul></article>)}</div>
        {state?.matchups.length ? <ol>{state.matchups.map((m, i) => <li key={i}>{names.get(m.team1)} vs {names.get(m.team2)}</li>)}</ol> : null}
        {data.ownRoster && state && !state.ceremonyStarted && (current?.mode === 'match_play' || current?.mode === 'tribe_champion') && <div className={styles.controls}>
          <label>Team 1 / nominee<select value={choiceA} onChange={e => setChoiceA(e.target.value)}><option value="">Choose manager</option>{alive.map(t => <option key={t.legacyRosterId} value={t.legacyRosterId!}>{t.teamName}</option>)}</select></label>
          {current.mode === 'match_play' && <label>Team 2<select value={choiceB} onChange={e => setChoiceB(e.target.value)}><option value="">Choose opponent</option>{alive.map(t => <option key={t.legacyRosterId} value={t.legacyRosterId!}>{t.teamName}</option>)}</select></label>}
          <button disabled={busy || !choiceA || (current.mode === 'match_play' && !choiceB)} onClick={() => action('/operations', { action: isCommissioner ? 'commissioner_choice' : 'tribe_choice', choice: current.mode === 'match_play' ? { kind: 'matchup', team1: choiceA, team2: choiceB } : { kind: 'champion', rosterId: choiceA } })}>Submit {current.mode === 'match_play' ? 'matchup' : 'champion'}</button>
          {current.mode === 'match_play' && <button disabled={busy || !choiceA} onClick={() => action('/operations', { action: isCommissioner ? 'commissioner_choice' : 'tribe_choice', choice: { kind: 'sit_out', rosterId: choiceA } })}>Sit out Team 1</button>}
        </div>}
        {data.ownRoster && !season?.tribes.some(m => m.captain && m.tribeId === myTribe) && <div className={styles.controls}><label>Vote for captain<select value={vote} onChange={e => setVote(e.target.value)}><option value="">Choose manager</option>{season?.tribes.filter(m => m.tribeId === myTribe).map(m => <option key={m.rosterId} value={m.rosterId}>{names.get(m.rosterId)}</option>)}</select></label><button disabled={busy || !vote} onClick={() => action('/operations', { action: 'vote_captain', candidateRosterId: vote })}>Cast private vote</button></div>}
      </section>
      <section className={styles.card}><h2>Chop Night & replay</h2>{state?.ceremonyAt && <p>Scheduled ceremony: {new Date(state.ceremonyAt).toLocaleString()}</p>}
        {history.length ? history.map(([period, row]) => <article className={styles.recap} key={period}><strong>Period {period} · {row.mode.replaceAll('_', ' ')}</strong><p>{row.immuneTribeId ? `${row.immuneTribeId} won immunity. ` : ''}{row.savedTeamIds.length ? `${row.savedTeamIds.map(id => names.get(id)).join(', ')} saved by idols. ` : ''}{row.choppedTeamIds.length ? `${row.choppedTeamIds.map(id => names.get(id)).join(', ')} chopped.` : 'Final placements set.'}</p>{season?.config.ceremonyPresentation && <button onClick={() => { setReplayPeriod(period); setReplayStep(0) }}>Replay ceremony</button>}</article>) : <p>The first ceremony recap will appear here after the chop.</p>}
        {replayPeriod && (() => { const row = season?.periodHistory[replayPeriod]; if (!row) return null
          const stages = [
            `Period ${replayPeriod}: ${row.mode.replaceAll('_', ' ')}. The tribe race is complete.`,
            row.immuneTribeId ? `${row.immuneTribeId} won immunity.` : 'No tribe has immunity in this period.',
            row.savedTeamIds.length ? `${row.savedTeamIds.map(id => names.get(id)).join(', ')} survived through an immunity idol.` : 'No immunity idol changed the chop line.',
            row.choppedTeamIds.length ? `${row.choppedTeamIds.map(id => names.get(id)).join(', ')} eliminated. Their players enter league waivers.` : 'The final placements are complete.',
          ]
          return <div className={styles.replay} role="dialog" aria-modal="true" aria-label={`Period ${replayPeriod} ceremony replay`}><span className={styles.eyebrow}>CHOP NIGHT REPLAY · {replayStep + 1} / {stages.length}</span><p aria-live="polite">{stages[replayStep]}</p><button onClick={() => setReplayPeriod('')}>Close</button><button onClick={() => setReplayStep(step => Math.min(step + 1, stages.length - 1))} disabled={replayStep === stages.length - 1}>Next reveal</button><button onClick={() => setReplayAuto(value => !value)}>{replayAuto ? 'Pause reveals' : 'Play reveals'}</button></div>
        })()}
        {isCommissioner && state && !state.ceremonyStarted && <button disabled={busy} onClick={() => action('/chop', { period: state.period })}>Run hosted Chop Night</button>}
      </section>
    </div><aside>
      <section className={styles.card}><h2>Elimination watch</h2>{season?.config.sport === 'NBA' && season.config.nbaScoring === 'capped_games' && <p>Live raw points are provisional. The capped player-game total determines the chop after period close.</p>}{data.scores.length ? <ol>{[...data.scores].sort((a, b) => a.totalPoints - b.totalPoints).map(s => <li key={s.rosterId}>{names.get(s.rosterId) ?? s.rosterId} · {s.totalPoints.toFixed(1)} {s.status}</li>)}</ol> : <p>Scores will appear when this period starts.</p>}</section>
      <section className={styles.card}><h2>Private powers & reveals</h2>{data.powers.length ? <ul>{data.powers.map(power => <li key={power.id}>{SG_POWER_LABELS[power.kind]} · {power.status} · through period {power.expiresAfterPeriod}{power.status === 'held' && data.ownRoster && <button onClick={() => { setActivePower(power.id); setPowerTarget(''); setDropPlayer('') }}>Use privately</button>}</li>)}</ul> : <p>No known powers on your team. Hidden powers are revealed only to their current owner.</p>}
        {activePower && (() => { const power = data.powers.find(p => p.id === activePower); if (!power) return null
          const needsRoster = power.kind === 'ally_immunity' || power.kind === 'tribe_swap'
          const needsPlayer = power.kind === 'steal_player'
          const command = `@chimmy use ${power.kind.includes('immunity') ? 'idol' : 'token'} ${power.id}${powerTarget ? ` on ${powerTarget}` : ''}${dropPlayer ? ` drop ${dropPlayer}` : ''}`
          return <div className={styles.controls}><h3>{SG_POWER_LABELS[power.kind]}</h3><p>This command goes privately to Chimmy. Immunity is announced only at the chop; action tokens reveal when played.</p>{needsRoster && <label>Target manager<select value={powerTarget} onChange={e => setPowerTarget(e.target.value)}><option value="">Choose manager</option>{alive.map(t => <option key={t.legacyRosterId} value={t.legacyRosterId!}>{t.teamName}</option>)}</select></label>}{needsPlayer && <><label>Player to steal<select value={powerTarget} onChange={e => setPowerTarget(e.target.value)}><option value="">Choose an opponent’s player</option>{data.stealTargets?.map(p => <option key={`${p.rosterId}:${p.id}`} value={p.id}>{p.name} · {p.position} · {names.get(p.rosterId)}</option>)}</select></label><p>Players already locked for a game cannot be stolen. Chimmy checks the lock when you submit.</p><label>Your player to drop if the roster is full<select value={dropPlayer} onChange={e => setDropPlayer(e.target.value)}><option value="">No drop</option>{data.ownRoster?.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></>}<button disabled={busy || ((needsRoster || needsPlayer) && !powerTarget)} onClick={() => action('/chimmy', { message: command })}>Send private Chimmy command</button><button onClick={() => setActivePower('')}>Cancel</button></div>
        })()}</section>
      {data.ownRoster && current?.mode === 'gauntlet' && season?.config.gauntletIdolAuction && <section className={styles.card}><h2>Sealed Gauntlet auction</h2><p>Available FAAB: {data.ownRoster.faabRemaining}. Only your own bid is visible.</p><label>FAAB bid<input type="number" min={1} max={data.ownRoster.faabRemaining} value={bid} onChange={e => setBid(e.target.value)} /></label><button disabled={busy || !bid} onClick={() => action('/operations', { action: 'auction_bid', amount: Number(bid) })}>Submit sealed bid</button>{data.ownRoster.ownBid && <p>Your bid: {data.ownRoster.ownBid.amount} · {data.ownRoster.ownBid.status}</p>}</section>}
      {isCommissioner && <section className={styles.card}><h2>Commissioner control</h2><p>Set real scoring dates, including combined NBA and All-Star periods. Reward weeks stay concealed from league members.</p>
        <div className={styles.controls}><h3>Calendar preset</h3><p>Fill unscheduled periods from one start date. Review the resulting dates below before saving. For an NBA combined week, enter its period number to make it two weeks long.</p><label>First scoring period starts<input type="datetime-local" value={presetStart} onChange={e => setPresetStart(e.target.value)} /></label><label>Days per period<input type="number" min={1} max={28} value={presetDays} onChange={e => setPresetDays(Number(e.target.value))} /></label>{season?.config.sport === 'NBA' && <label>Combined period numbers (comma separated)<input value={extendedPeriods} onChange={e => setExtendedPeriods(e.target.value)} placeholder="9, 14" /></label>}<button disabled={busy || !presetStart} onClick={() => { try { setCalendar(buildSGCalendarPreset(schedule, calendar, season?.currentPeriod ?? 0, { firstStart: presetStart, daysPerPeriod: presetDays, extendedPeriods: extendedPeriods.split(',').map(s => Number(s.trim())).filter(Boolean), selectionHoursBeforeStart: 24, ceremonyHoursAfterEnd: 2 })); setNotice('Calendar draft ready. Review each date and save it below.') } catch (error) { setNotice(error instanceof Error ? error.message : 'Calendar preset failed') } }}>Fill empty dates</button></div>
        {season?.currentPeriod === 0 && season.config.tribeFormation === 'captain_draft' && !captainDraft && <div className={styles.controls}><h3>Start captain draft</h3>{Array.from({ length: season.config.tribeCount }, (_, i) => <label key={i}>Tribe {i + 1} draft leader<select value={captainChoices[`tribe-${i}`] ?? ''} onChange={e => setCaptainChoices(v => ({ ...v, [`tribe-${i}`]: e.target.value }))}><option value="">Choose leader</option>{alive.map(t => <option key={t.legacyRosterId} value={t.legacyRosterId!}>{t.teamName}</option>)}</select></label>)}<label>Draft deadline<input type="datetime-local" value={captainDeadline} onChange={e => setCaptainDeadline(e.target.value)} /></label><button disabled={busy || Array.from({ length: season.config.tribeCount }, (_, i) => !captainChoices[`tribe-${i}`]).some(Boolean)} onClick={() => action('/operations', { action: 'start_captain_draft', captainRosterIds: Array.from({ length: season.config.tribeCount }, (_, i) => captainChoices[`tribe-${i}`]), deadlineAt: captainDeadline ? new Date(captainDeadline).toISOString() : null })}>Open captain draft</button></div>}
        {season?.currentPeriod === 0 && <div className={styles.controls}><h3>Form starting tribes</h3>{data.teams.filter(t => t.legacyRosterId).map(t => <label key={t.legacyRosterId}>{t.teamName}<select value={tribeDraft[t.legacyRosterId!] ?? ''} onChange={e => setTribeDraft(v => ({ ...v, [t.legacyRosterId!]: e.target.value }))}>{Array.from({ length: season.config.tribeCount }, (_, i) => <option key={i} value={`tribe-${i}`}>Tribe {i + 1}</option>)}</select></label>)}
          <label>Captain vote deadline<input type="datetime-local" value={captainDeadline} onChange={e => setCaptainDeadline(e.target.value)} /></label><button disabled={busy} onClick={() => action('/operations', { action: 'set_tribes', members: Object.entries(tribeDraft).map(([rosterId, tribeId]) => ({ rosterId, tribeId })), deadlineAt: captainDeadline ? new Date(captainDeadline).toISOString() : null })}>Save tribes & open captain vote</button></div>}
        {resetPeriods.length > 0 && <div className={styles.controls}><h3>Shuffle / Gauntlet draft</h3><label>Upcoming reset<select value={retribePeriod} onChange={e => setRetribePeriod(Number(e.target.value))}><option value={0}>Choose period</option>{resetPeriods.map(p => <option key={p.period} value={p.period}>Period {p.period} · {SG_MODE_LABELS[p.mode]}</option>)}</select></label>
          {retribePeriod > 0 && <>{alive.map(t => <label key={t.legacyRosterId}>{t.teamName}<select value={retribeDraft[t.legacyRosterId!] ?? ''} onChange={e => setRetribeDraft(v => ({ ...v, [t.legacyRosterId!]: e.target.value }))}><option value="">Assign tribe</option>{Array.from({ length: schedule.find(p => p.period === retribePeriod)?.mode === 'gauntlet' ? 2 : season!.config.tribeCount }, (_, i) => <option key={i} value={schedule.find(p => p.period === retribePeriod)?.mode === 'gauntlet' ? `gauntlet-${i + 1}` : `tribe-${i}`}>Tribe {i + 1}</option>)}</select></label>)}{[...new Set(Object.values(retribeDraft).filter(Boolean))].map(id => <label key={id}>{id} captain<select value={retribeCaptains[id] ?? ''} onChange={e => setRetribeCaptains(v => ({ ...v, [id]: e.target.value }))}><option value="">Use league default / prior captain</option>{Object.entries(retribeDraft).filter(([, tribe]) => tribe === id).map(([rosterId]) => <option key={rosterId} value={rosterId}>{names.get(rosterId)}</option>)}</select></label>)}<button disabled={busy || alive.some(t => !retribeDraft[t.legacyRosterId!])} onClick={() => { setCalendar(v => ({ ...v, [retribePeriod]: { ...v[retribePeriod], ceremonyAt: v[retribePeriod]?.ceremonyAt ?? '', tribes: Object.entries(retribeDraft).map(([rosterId, tribeId]) => ({ rosterId, tribeId, captain: retribeCaptains[tribeId] === rosterId })) } })); setNotice('Assignments added to the calendar. Save the calendar to publish them.') }}>Use assignments for this reset</button></>}</div>}
        <div className={styles.calendar}>{schedule.map(row => <div key={row.period}><strong>{row.period} · {SG_MODE_LABELS[row.mode]}</strong><label>Start<input type="datetime-local" value={localInput(calendar[row.period]?.scoringStartsAt)} onChange={e => setCalendar(v => ({ ...v, [row.period]: { ...v[row.period], ceremonyAt: v[row.period]?.ceremonyAt ?? '', scoringStartsAt: e.target.value ? new Date(e.target.value).toISOString() : '' } }))} /></label><label>End<input type="datetime-local" value={localInput(calendar[row.period]?.scoringEndsAt)} onChange={e => setCalendar(v => ({ ...v, [row.period]: { ...v[row.period], ceremonyAt: v[row.period]?.ceremonyAt ?? '', scoringEndsAt: e.target.value ? new Date(e.target.value).toISOString() : '' } }))} /></label><label>Chop<input type="datetime-local" value={localInput(calendar[row.period]?.ceremonyAt)} onChange={e => setCalendar(v => ({ ...v, [row.period]: { ...v[row.period], ceremonyAt: e.target.value ? new Date(e.target.value).toISOString() : '' } }))} /></label><label>Selection cutoff<input type="datetime-local" value={localInput(calendar[row.period]?.selectionDeadlineAt)} onChange={e => setCalendar(v => ({ ...v, [row.period]: { ...v[row.period], ceremonyAt: v[row.period]?.ceremonyAt ?? '', selectionDeadlineAt: e.target.value ? new Date(e.target.value).toISOString() : '' } }))} /></label>{row.mode === 'gauntlet' && <label>Sealed auction closes<input type="datetime-local" value={localInput(calendar[row.period]?.auctionClosesAt)} onChange={e => setCalendar(v => ({ ...v, [row.period]: { ...v[row.period], ceremonyAt: v[row.period]?.ceremonyAt ?? '', auctionClosesAt: e.target.value ? new Date(e.target.value).toISOString() : '' } }))} /></label>}</div>)}</div>
        <label>Concealed reward periods (comma separated)<input value={rewardWeeks} onChange={e => setRewardWeeks(e.target.value)} placeholder="2, 4, 7" /></label><button disabled={busy} onClick={() => action('/operations', { action: 'save_calendar', calendar, rewardPeriods: rewardWeeks.split(',').map(s => Number(s.trim())).filter(Boolean) })}>Save calendar & hidden rewards</button>
        {[...new Set(season?.tribes.map(m => m.tribeId) ?? [])].map(id => <label key={id}>{id} captain tie fallback<select value={captainChoices[id] ?? ''} onChange={e => setCaptainChoices(v => ({ ...v, [id]: e.target.value }))}><option value="">Use votes</option>{season?.tribes.filter(m => m.tribeId === id).map(m => <option key={m.rosterId} value={m.rosterId}>{names.get(m.rosterId)}</option>)}</select></label>)}
        <button disabled={busy} onClick={() => action('/operations', { action: 'finalize_captains', choices: captainChoices })}>Finalize captain votes</button>
        <button disabled={busy} onClick={() => action('/operations', { action: 'advance' })}>Advance period</button><button disabled={busy} onClick={() => action('/operations', { action: 'settle_auction' })}>Settle sealed auction</button>
        <button disabled={busy} onClick={() => action('/operations', { action: 'audit_corrections' })}>Audit earlier stat corrections</button>
        {correctionCases.filter(row => row.changedRosterIds.length).map(row => <div key={row.period} className={styles.controls}><h3>Period {row.period} correction</h3><p>{row.result.replaceAll('_', ' ')}. Played chop: {(row.originalChops ?? []).map(id => names.get(id) ?? id).join(', ') || 'none'}. Corrected projection: {(row.proposedChops ?? []).map(id => names.get(id) ?? id).join(', ') || 'requires tie review'}.</p>{row.review ? <p>Reviewed: {row.review.decision.replaceAll('_', ' ')} · {row.review.reason}</p> : <><p>Later drafts, waivers, and chops remain in place until the commissioner resolves their consequences. This records the decision and alerts the league.</p><label>Review reason<input value={correctionReasons[row.period] ?? ''} onChange={e => setCorrectionReasons(current => ({ ...current, [row.period]: e.target.value }))} /></label><button disabled={busy || (correctionReasons[row.period] ?? '').trim().length < 10} onClick={() => action('/operations', { action: 'review_correction', period: row.period, decision: 'keep_played_result', reason: correctionReasons[row.period] })}>Keep played result</button><button disabled={busy || (correctionReasons[row.period] ?? '').trim().length < 10} onClick={() => action('/operations', { action: 'review_correction', period: row.period, decision: 'manual_followup', reason: correctionReasons[row.period] })}>Flag manual follow-up</button></>}</div>)}
        {state && !state.ceremonyStarted && <div className={styles.controls}><h3>Resolve a true scoring tie</h3><p>Use after Chop Night reports a tie. The server accepts this decision only when finalized scores remain tied; include a reason for the replay audit.</p><label>Immune tribe<select value={tieTribe} onChange={e => setTieTribe(e.target.value)}><option value="">No tribe immunity</option>{[...new Set(season?.tribes.map(m => m.tribeId) ?? [])].map(id => <option key={id} value={id}>{id}</option>)}</select></label><fieldset><legend>Managers to chop</legend>{alive.map(team => <label key={team.legacyRosterId} className={styles.player}><input type="checkbox" checked={tieChops.split(',').includes(team.legacyRosterId!)} onChange={e => setTieChops(current => { const ids = current.split(',').filter(Boolean); return (e.target.checked ? [...ids, team.legacyRosterId!] : ids.filter(id => id !== team.legacyRosterId)).join(',') })} />{team.teamName}</label>)}</fieldset>{current?.mode === 'final_three' && <><label>First place<select value={tiePlacements.split(',')[0] ?? ''} onChange={e => setTiePlacements([e.target.value, ...tiePlacements.split(',').slice(1)].join(','))}><option value="">Choose manager</option>{alive.map(team => <option key={team.legacyRosterId} value={team.legacyRosterId!}>{team.teamName}</option>)}</select></label><label>Second place<select value={tiePlacements.split(',')[1] ?? ''} onChange={e => { const ids = tiePlacements.split(','); ids[1] = e.target.value; setTiePlacements(ids.join(',')) }}><option value="">Choose manager</option>{alive.map(team => <option key={team.legacyRosterId} value={team.legacyRosterId!}>{team.teamName}</option>)}</select></label><label>Third place<select value={tiePlacements.split(',')[2] ?? ''} onChange={e => { const ids = tiePlacements.split(','); ids[2] = e.target.value; setTiePlacements(ids.join(',')) }}><option value="">Choose manager</option>{alive.map(team => <option key={team.legacyRosterId} value={team.legacyRosterId!}>{team.teamName}</option>)}</select></label></>}<label>Reason<input value={tieReason} onChange={e => setTieReason(e.target.value)} /></label><button disabled={busy || !tieReason} onClick={() => action('/operations', { action: 'resolve_tie', decision: { immuneTribeId: tieTribe || null, choppedTeamIds: tieChops.split(',').map(s => s.trim()).filter(Boolean), placements: tiePlacements.split(',').map(s => s.trim()).filter(Boolean), reason: tieReason } })}>Record tie decision</button></div>}
      </section>}
    </aside></div>
  </main>
}
