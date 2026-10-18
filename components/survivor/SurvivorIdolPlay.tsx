"use client"

import { useEffect, useRef, useState } from 'react'
import type { getStealThreePreview } from '@/lib/survivor/survivorStealThree'
import { idolDefinition, type IdolPlayPreview } from '@/lib/survivor/survivorIdolCatalog'
import { BUNDLED_SURVIVOR_IDOL_TYPES, survivorIdolTag } from '@/lib/survivor/survivorIdolTypes'
import { survivorIdolPlayEngine } from '@/lib/survivor/survivorIdolEngines'
import { survivorIdolGlowStyle } from './SurvivorIdolCard'
import './survivorIdolPlay.css'

type PreviewResult = Awaited<ReturnType<typeof getStealThreePreview>>
type Preview = Extract<PreviewResult, { ok: true }>['value']
type Played = { playerNames: string[]; dropNames: string[]; week: number }
const STEPS = ['Pick a team', 'Pick 3 players', 'Make room', 'Confirm']

function SurvivorRosterIdolPlay({ leagueId, idolId, powerType, onFinished }: { leagueId: string; idolId: string; powerType: string; onFinished: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [step, setStep] = useState(1)
  const [teamId, setTeamId] = useState('')
  const [playerIds, setPlayerIds] = useState<string[]>([])
  const [dropIds, setDropIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [played, setPlayed] = useState<Played | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const submitting = useRef(false)

  async function request(action: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/leagues/${leagueId}/survivor/${action}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw Object.assign(new Error(result.error ?? 'The action could not be completed.'), { code: result.code })
    return result
  }

  useEffect(() => {
    let active = true
    setBusy(true)
    request('steal-three-preview', { idolId }).then(result => { if (active) setPreview(result) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load players.') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [leagueId, idolId])
  useEffect(() => { heading.current?.focus() }, [step, played, preview])

  async function confirm() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setError(null)
    try {
      const result = await request('play-steal-three', { idolId, playerRowIds: playerIds, dropRowIds: dropIds })
      setPlayed(result); onFinished()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The raid could not be completed.')
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null
      if (['player_locked', 'player_ir', 'player_changed', 'roster_changed', 'drop_unavailable', 'incorrect_drops'].includes(String(code))) {
        setStep(2); setPlayerIds([]); setDropIds([])
        try { setPreview(await request('steal-three-preview', { idolId })) } catch { setPreview(null) }
      }
    } finally { setBusy(false); submitting.current = false }
  }

  function toggle(id: string, values: string[], set: (next: string[]) => void, max: number) {
    if (values.includes(id)) set(values.filter(value => value !== id))
    else if (values.length < max) set([...values, id])
  }

  const title = powerType === 'island_raid' ? 'Island Raid' : 'Steal 3'
  const team = preview?.teams.find(team => team.rosterId === teamId)
  const visibleTeams = preview?.powerType === 'island_raid' ? preview.teams : team ? [team] : []
  const incoming = preview?.teams.flatMap(team => team.players).filter(player => playerIds.includes(player.id)) ?? []
  const outgoing = preview?.myBench.filter(player => dropIds.includes(player.id)) ?? []
  const ready = preview && !preview.lockWarnings.length && (step === 1 ? preview.powerType === 'island_raid' || Boolean(team) : step === 2 ? incoming.length === 3 && incoming.every(player => !player.disabled) : step === 3 ? dropIds.length === preview.requiredDrops : true)

  return <section className="survivor-idol-play" aria-label={`Play ${title}`} aria-busy={busy} style={survivorIdolGlowStyle('#e5484d')}>
    <header><img src="/survivor/idols/steal-three-icon.svg" alt="" width={36} height={36} /><div><h3>{title}</h3><p>Your idols - only you can see this page{preview ? ` - week ${preview.week}` : ''}</p></div></header>
    <div className="idol-layout">
      <aside className="idol-card"><img src="/survivor/idols/steal-three.svg" alt="" /><h3>{title}</h3><span className="svi-tag">Roster · ●●●</span><p>{powerType === 'island_raid' ? 'Take 3 players across opposing teams.' : "Take any 3 players from one team's roster and add them to yours."}</p><dl><dt>When</dt><dd>Before the playoffs</dd><dt>Cannot take</dt><dd>Players whose game has started, or players on IR</dd><dt>Make room</dt><dd>Drop bench players to waivers</dd><dt>Who sees it</dt><dd>The whole league, as soon as it is played</dd></dl></aside>
      <div className="idol-flow">
        <ol className="idol-steps" aria-label="Raid progress">{STEPS.map((label, index) => <li key={label} aria-current={!played && step === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}{(played || step > index + 1) && <span className="sr-only"> completed</span>}</li>)}</ol>
        {error && <p role="alert" className="idol-warning">{error}</p>}
        {!preview && !played && <p role="status">{busy ? 'Checking available players...' : 'Available players could not be loaded. Close this flow and reopen it to try again.'}</p>}
        {played ? <>
          <div className="idol-played" role="status"><img className="idol-played-art" src="/survivor/idols/steal-three.svg" alt="" /><h4 ref={heading} tabIndex={-1}>The hand has struck</h4><p>{title} played - week {played.week}</p><div className="idol-arrivals">{played.playerNames.map((name, index) => <div key={name} className="idol-arrival" style={{ animationDelay: `${index * 150}ms` }}><strong>{name}</strong><p>from {team?.teamName ?? 'the raided teams'}</p></div>)}</div><p>They're on your bench now. The idol is gone from your vault.</p><a className="idol-primary" href={`/league/${leagueId}?tab=team`}>Set lineup</a></div>
          <div className="idol-summary"><div><h4>What the league sees - league chat</h4><strong>AF Host</strong><p>The raid names the manager, raided team and all 3 players.</p></div><div><h4>What the raided team gets - DM and push</h4><strong>You've been raided</strong><p>Top waiver priority this week. {played.dropNames.length ? `${played.dropNames.join(', ')} went to waivers.` : 'No players needed to be dropped.'}</p></div></div>
        </> : preview && <>
          {preview.lockWarnings.length > 0 && <p role="alert" className="idol-warning">Player locks cannot be verified. Try again when schedule data is available.</p>}
          <div className="idol-panel">
            <h4 ref={heading} tabIndex={-1}>{step === 1 ? 'Whose roster do you raid?' : step === 2 ? `Pick 3 from ${team?.teamName ?? 'opposing teams'}` : step === 3 ? `Make room: drop ${preview.requiredDrops} from your roster` : 'Check the raid'}</h4>
            {step === 1 && <><p>Any team still in the game, either tribe</p>{preview.teams.map(team => <button className="idol-row" key={team.rosterId} type="button" disabled={busy} aria-pressed={teamId === team.rosterId} onClick={() => { setTeamId(team.rosterId); setPlayerIds([]); setDropIds([]) }}><span><strong>{team.teamName}</strong><small>{team.topPlayers.join(' / ') || 'Roster unavailable'}</small></span><span>{team.tribe?.logoUrl && <img src={team.tribe.logoUrl} alt="" width={24} height={24} />}{team.tribe?.name ?? 'Merged'}<small>{team.weeklyAverage == null ? 'No scored weeks' : `${team.weeklyAverage.toFixed(1)}/wk`}</small></span></button>)}{preview.teams.length === 0 && <p>No opposing active teams are available.</p>}</>}
            {step === 2 && <><p aria-live="polite">{playerIds.length} of 3 selected</p>{visibleTeams.flatMap(team => team.players).map(player => <label className="idol-row" key={player.id}><input type="checkbox" checked={playerIds.includes(player.id)} disabled={busy || player.disabled || (!playerIds.includes(player.id) && playerIds.length === 3)} onChange={() => toggle(player.id, playerIds, setPlayerIds, 3)} /><span className="idol-position">{player.position}</span><span><strong>{player.playerName}</strong><small>{player.unavailableReason ?? player.team ?? 'Team unavailable'}</small></span></label>)}</>}
            {step === 3 && <><p>Your roster: {preview.rosterSize} of {preview.maxRosterSize}. Dropped players go to waivers.</p><p aria-live="polite">{dropIds.length} of {preview.requiredDrops} selected</p>{preview.myBench.map(player => <label className="idol-row" key={player.id}><input type="checkbox" checked={dropIds.includes(player.id)} disabled={busy || (!dropIds.includes(player.id) && dropIds.length === preview.requiredDrops)} onChange={() => toggle(player.id, dropIds, setDropIds, preview.requiredDrops)} /><span className="idol-position">{player.position}</span><span><strong>{player.playerName}</strong><small>Bench</small></span></label>)}{preview.myBench.length < preview.requiredDrops && <p role="alert">Not enough unlocked bench players. Make room in your roster before playing.</p>}</>}
            {step === 4 && <><div className="idol-summary"><div><h4>Coming to you</h4>{incoming.map(player => <p key={player.id}>{player.position} - {player.playerName}</p>)}</div><div><h4>To waivers</h4>{outgoing.map(player => <p key={player.id}>{player.position} - {player.playerName}</p>)}{!outgoing.length && <p>No drops needed. You have room.</p>}</div></div><p className="idol-warning">Steal 3 is not secret. The whole league sees the raid, and {team?.teamName ?? 'the raided teams'} gets top waiver priority this week. You can't undo it.</p></>}
          </div>
          <footer><button type="button" disabled={busy || step === 1} onClick={() => setStep(step === 4 && preview.requiredDrops === 0 ? 2 : step - 1)}>Back</button><button className="idol-primary" type="button" disabled={busy || !ready} onClick={() => step === 4 ? void confirm() : setStep(step === 2 && preview.requiredDrops === 0 ? 4 : step + 1)}>{step === 4 ? busy ? 'Playing...' : `Play ${title}` : 'Next'}</button></footer>
        </>}
      </div>
    </div>
  </section>
}


type IdolPlayProps = { leagueId: string; idolId: string; powerType: string; onFinished: () => void }

export function SurvivorIdolPlay(props: IdolPlayProps) {
  return survivorIdolPlayEngine(props.powerType)?.flow === 'roster'
    ? <SurvivorRosterIdolPlay {...props} /> : <SurvivorCouncilIdolPlay {...props} />
}

/** All council/catalog powers share one target and confirmation layout. */
function SurvivorCouncilIdolPlay({ leagueId, idolId, powerType, onFinished }: IdolPlayProps) {
  const definition = idolDefinition(powerType)
  const [preview, setPreview] = useState<IdolPlayPreview | null>(null)
  const [target, setTarget] = useState('')
  const [confirming, setConfirming] = useState(!definition.needsTarget)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [played, setPlayed] = useState(false)
  const submitting = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  async function request(action: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/leagues/${leagueId}/survivor/${action}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? 'The action could not be completed.')
    return result
  }
  useEffect(() => {
    let active = true
    request('idol-play-preview', { idolId }).then(result => { if (active) setPreview(result) })
      .catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [leagueId, idolId])
  useEffect(() => { heading.current?.focus() }, [confirming, played])
  async function play() {
    if (submitting.current || !definition.action) return
    submitting.current = true; setBusy(true); setError(null)
    try {
      await request(definition.action, { idolId, ...(definition.needsTarget ? { stolenVoterUserId: target } : {}) })
      setPlayed(true); onFinished()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The idol could not be played.') }
    finally { setBusy(false); submitting.current = false }
  }
  const catalogType = BUNDLED_SURVIVOR_IDOL_TYPES.find(type => type.id === definition.id && type.name === definition.name)
  return <section className="survivor-idol-play survivor-catalog-play" aria-label={`Play ${definition.name}`} aria-busy={busy} style={survivorIdolGlowStyle(definition.glow)}>
    <header><div><h3>Play an idol</h3><p>Your idols - only you can see this page</p></div></header>
    <div className="idol-layout">
      <aside className="idol-card">
        {definition.id && <img src={`/survivor/idols/${definition.id}.svg`} alt="" />}
        <h3>{definition.name}</h3>{catalogType && <span className="svi-tag" data-always={catalogType.alwaysIn || undefined}>{survivorIdolTag(catalogType)}</span>}<p>{definition.power}</p>
        <dl><dt>When</dt><dd>{definition.when}</dd><dt>Target</dt><dd>{definition.target}</dd><dt>Who sees it</dt><dd>Nobody until the scroll is read</dd></dl>
      </aside>
      <div className="idol-flow">
        {error && <p role="alert" className="idol-warning">{error}</p>}
        <div className="idol-panel">
          <h4 ref={heading} tabIndex={-1}>{played ? 'Played in secret' : !definition.action ? 'Not playable yet' : confirming ? `Confirm ${definition.name}` : 'Whose vote do you take?'}</h4>
          {played ? <><p>{definition.power}</p><p>Nobody else can see this play until the read. Your idol has left the vault.</p>{['vote_steal', 'extra_vote'].includes(powerType) && <><p>You can now cast 2 votes at Tribal Council. Send your own vote, then your additional vote privately:</p><p><code>@Chimmy vote @manager</code><br /><code>@Chimmy extra vote @manager</code></p><a className="idol-primary" href={`/survivor/${leagueId}/tribal`}>Go to Tribal Council</a></>}</> : <>
            {!definition.action ? <p>This idol has no server play action yet. Keep it in your vault.</p> : !preview ? <p role="status">Checking the council window...</p> : <>
              {definition.needsTarget && !confirming && <><p>Choose a manager in your own tribe going to Tribal Council. They will not know until the scroll is read; their slip is stamped Taken.</p>{preview.targets.map(manager => <button type="button" className="idol-row" key={manager.userId} disabled={busy || manager.disabled} aria-pressed={target === manager.userId} onClick={() => setTarget(manager.userId)}><strong>{manager.name}</strong><span>{manager.reason ?? 'At Tribal Council'}</span></button>)}</>}
              {confirming && <><p>{definition.power}</p>{definition.needsTarget && <p>Selected manager: {preview.targets.find(manager => manager.userId === target)?.name}</p>}<p>Played in secret. You cannot undo this play.</p></>}
              <p>Votes close: {preview.deadline ? <time dateTime={preview.deadline}>{new Date(preview.deadline).toLocaleString()}</time> : 'No council scheduled'}</p>
              {preview.reason && <p role="status">{preview.reason}</p>}
              <footer>{definition.needsTarget && confirming && <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Back</button>}<button type="button" className="idol-primary" disabled={busy || !preview.playable || (definition.needsTarget && !target)} onClick={() => confirming ? void play() : setConfirming(true)}>{busy ? 'Playing...' : confirming ? `Play ${definition.name}` : 'Next'}</button></footer>
            </>}
          </>}
        </div>
      </div>
    </div>
  </section>
}
