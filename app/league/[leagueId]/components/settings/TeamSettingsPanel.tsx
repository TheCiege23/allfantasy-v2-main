'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { SeatInvitePanel } from './SeatInvitePanel'
import { TeamCoOwnerPanel } from './TeamCoOwnerPanel'
import { SettingsPanelHeading, controlClassSm } from './settings-ui'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import { LeagueInvitePanel } from '@/components/core-app/LeagueInvitePanel'
import { MAX_NATIVE_TEAMS } from '@/lib/league/teamCountLimits'
import { MAX_TEAM_NAME_LENGTH } from '@/lib/league/myTeamEdit'
import { buildTeamDirectoryCsv, type TeamDirectoryRow } from '@/lib/league/teamDirectoryExport'

type Directory = {
  leagueName: string; capacity: number; native: boolean; canManage: boolean; isHeadCommissioner: boolean
  multiTeamSupported: boolean; allowMultiTeamManagers: boolean; allowManagerTeamNameEdits: boolean; teams: TeamDirectoryRow[]
}
type Save = (url: string, method: string, body?: object) => Promise<boolean>
const button = 'rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40'
const input = controlClassSm + ' w-full'
const seatLabel = { open: 'Open', managed: 'Managed', automated: 'Automated' }

async function request(url: string, method: string, body?: object) {
  const response = await fetch(url, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Request failed. Try again.')
  return result
}

export function TeamSettingsPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const id = encodeURIComponent(leagueId)
  const base = `/api/commissioner/leagues/${id}`
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [seat, setSeat] = useState('')
  const [division, setDivision] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [view, setView] = useState<'teams' | 'divisions' | 'invites'>('teams')
  const editable = Boolean(directory?.canManage && canEdit)
  const load = useCallback(async () => {
    const result = await request(base + '/managers', 'GET')
    if (!result.directory) throw new Error('Team settings are unavailable.')
    setDirectory(result.directory)
  }, [base])
  useEffect(() => { setDirectory(null); setEditing(null); setStatus(null); setView('teams'); setSearch(''); setSeat(''); setDivision(''); void load().catch(error => setStatus({ error: true, message: error.message })) }, [load])
  const save: Save = async (url, method, body) => {
    setBusy(true); setStatus(null)
    try { await request(url, method, body); await load(); setStatus({ error: false, message: 'Changes saved.' }); return true }
    catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : 'Could not save changes.' }); return false }
    finally { setBusy(false) }
  }
  const teams = directory?.teams ?? []
  const managers = new Map<string, number>()
  for (const team of teams) if (team.status === 'managed' && team.manager?.id) managers.set(team.manager.id, (managers.get(team.manager.id) ?? 0) + 1)
  const usernames = [...new Set(teams.flatMap(team => team.status === 'managed' && team.manager?.username ? [team.manager.username] : []))].sort()
  const divisions = [...new Set(teams.flatMap(team => team.division ? [team.division] : []))].sort()
  const filtered = teams.filter(team => (!seat || team.status === seat) && (!division || team.division === division) &&
    [team.name, team.abbreviation, team.manager?.username, team.manager?.name].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())))

  function download() {
    const url = URL.createObjectURL(new Blob([buildTeamDirectoryCsv(teams)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'allfantasy-team-assignments.csv'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="min-h-0 flex-1 space-y-5 p-4 text-sm text-white/85 sm:p-6" data-testid="settings-team-panel">
    <SettingsPanelHeading title="Team Settings" subtitle={directory?.leagueName || 'Manage franchises, managers, and divisions.'} />
    {status && <p className={status.error ? 'text-red-200' : 'text-teal-200'} role={status.error ? 'alert' : 'status'}>{status.message}</p>}
    {!directory && (status ? <button className={button} type="button" onClick={() => { setStatus(null); void load().catch(error => setStatus({ error: true, message: error.message })) }}>Retry</button> : <p role="status">Loading team settings…</p>)}
    {directory && <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/10 p-3">
        <span><strong>{teams.filter(team => team.status === 'managed').length} / {directory.capacity}</strong> managed teams</span>
        <span><strong>{teams.filter(team => team.status === 'open').length}</strong> open</span><span><strong>{managers.size}</strong> primary managers</span>
        <button className={button + ' sm:ml-auto'} type="button" onClick={download}>Export assignments with aliases</button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Team setup sections">
        {(['teams', 'divisions', ...(editable ? ['invites'] as const : [])] as const).map(section => <button key={section} type="button"
          className={button + (view === section ? ' bg-teal-800' : '')} aria-pressed={view === section}
          onClick={() => { setView(section); if (section === 'teams') void load().catch(error => setStatus({ error: true, message: error.message })) }}>
          {section === 'teams' ? 'Teams & managers' : section === 'divisions' ? 'Divisions & pools' : 'Invite managers'}</button>)}
      </div>
      {!directory.native && <p>Team assignments come from the source platform.</p>}
      {view === 'divisions' && <DivisionSettingsCommissionerPanel leagueId={leagueId} />}
      {view === 'invites' && editable && <><LeagueInvitePanel leagueId={leagueId} leagueName={directory.leagueName} /><TeamInviteForm endpoint={base + '/invite/send'} /></>}
      {view === 'teams' && <>
        {editable && <details className="rounded-xl border border-white/10 p-3">
          <summary className="cursor-pointer font-semibold">Capacity and manager rules</summary>
          <form key={`${directory.capacity}:${directory.allowMultiTeamManagers}:${directory.allowManagerTeamNameEdits}`} className="mt-3 grid gap-3" onSubmit={event => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const leagueSize = Number(form.get('capacity'))
            const multiTeam = form.has('multiTeam'), rename = form.has('rename')
            const patch = {
              ...(leagueSize !== directory.capacity ? { leagueSize } : {}),
              ...(directory.multiTeamSupported && multiTeam !== directory.allowMultiTeamManagers ? { allowMultiTeamManagers: multiTeam } : {}),
              ...(rename !== directory.allowManagerTeamNameEdits ? { allowManagerTeamNameEdits: rename } : {}),
            }
            if (Object.keys(patch).length) void save(`/api/leagues/${id}/settings`, 'PATCH', { section: 'general', updates: patch })
          }}>
            <label className="grid max-w-xs gap-1">Team capacity<input className={input} type="number" required name="capacity" defaultValue={directory.capacity} min={Math.min(4, directory.capacity)} max={MAX_NATIVE_TEAMS} /></label>
            {directory.multiTeamSupported && <label className="flex gap-2"><input type="checkbox" name="multiTeam" defaultChecked={directory.allowMultiTeamManagers} /> Allow one manager to run multiple teams</label>}
            <label className="flex gap-2"><input type="checkbox" name="rename" defaultChecked={directory.allowManagerTeamNameEdits} /> Allow managers to edit team names and abbreviations</label>
            <p className="text-xs text-white/70">Opening a seat keeps its franchise, players, and history. Lower capacity to remove eligible empty seats before the draft.</p>
            <button className={button + ' justify-self-start bg-teal-800'} disabled={busy}>Save team rules</button>
          </form>
        </details>}
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          <input aria-label="Search teams or managers" type="search" placeholder="Find a team or manager" value={search} onChange={event => setSearch(event.target.value)} className={input} />
          <select aria-label="Seat status" value={seat} onChange={event => setSeat(event.target.value)} className={input}>
            <option value="">All seats</option><option value="open">Open seats</option><option value="managed">Managed seats</option><option value="automated">Automated seats</option>
          </select>
          {divisions.length > 0 && <select aria-label="Division" value={division} onChange={event => setDivision(event.target.value)} className={input}>
            <option value="">All divisions</option>{divisions.map(name => <option key={name}>{name}</option>)}</select>}
        </div>
        <datalist id={`af-assign-managers-${id}`}>{usernames.map(name => <option key={name} value={name} />)}</datalist>
        <ul className="grid gap-2">{filtered.map(team => {
          const count = team.manager?.id ? managers.get(team.manager.id) ?? 0 : 0
          return <li key={team.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><strong className="break-words text-white">{team.name || 'Open team'}</strong>{team.abbreviation && <span className="ml-2 text-xs">{team.abbreviation}</span>}
                <p className="text-xs text-white/70">{[team.status === 'managed' ? team.manager?.name || 'Managed' : seatLabel[team.status], team.role, team.division, count > 1 ? `${count} teams` : null, team.coOwners.length ? `${team.coOwners.length} co-owner assignments` : null].filter(Boolean).join(' · ')}</p>
              </div>
              {editable && <button type="button" className={button} aria-expanded={editing === team.id} aria-label={`${editing === team.id ? 'Close' : 'Manage'} ${team.name}`}
                onClick={() => setEditing(editing === team.id ? null : team.id)}>{editing === team.id ? 'Close' : 'Manage'}</button>}
            </div>
            {editable && editing === team.id && <TeamEditor key={team.id} team={team} leagueId={leagueId} listId={`af-assign-managers-${id}`} base={base} busy={busy}
              canManageSeat={!team.role || directory.isHeadCommissioner} save={save} onCoOwnersChange={() => void load().catch(error => setStatus({ error: true, message: error.message }))} />}
          </li>
        })}</ul>
        {!filtered.length && <p role="status">No teams match these filters.</p>}
      </>}
    </>}
  </div>
}

function TeamEditor({ team, leagueId, listId, base, busy, canManageSeat, save, onCoOwnersChange }: {
  team: TeamDirectoryRow; leagueId: string; listId: string; base: string; busy: boolean; canManageSeat: boolean; save: Save; onCoOwnersChange: () => void
}) {
  const [confirmRelease, setConfirmRelease] = useState(false)
  const [showCoOwners, setShowCoOwners] = useState(false)
  return <div className="mt-3 space-y-4 border-t border-white/10 pt-3">
    <form key={JSON.stringify([team.name, team.abbreviation, team.avatarUrl])} className="grid gap-2 sm:grid-cols-2" onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      void save(base + '/teams', 'PATCH', { leagueTeamId: team.id, teamName: form.get('name'), avatarUrl: form.get('avatar') || null,
        ...(team.rosterId ? { abbreviation: form.get('abbr') } : {}) })
    }}>
      <label>Team name<input className={input} required name="name" defaultValue={team.name} maxLength={MAX_TEAM_NAME_LENGTH} /></label>
      {team.rosterId && <label>Abbreviation<input className={input} name="abbr" defaultValue={team.abbreviation} maxLength={6} /></label>}
      <label>Logo URL<input className={input} name="avatar" type="url" defaultValue={team.avatarUrl ?? ''} /></label>
      <button disabled={busy} className={button + ' self-end justify-self-start bg-teal-800'}>Save team details</button>
    </form>
    {canManageSeat && team.rosterId && <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget
        if (await save(base + '/managers', 'PATCH', { rosterId: team.rosterId, username: new FormData(form).get('username') })) form.reset()
      }}>
        <label>AllFantasy username<input className={input} required name="username" list={listId} /></label>
        <button className={button + ' bg-teal-800'} disabled={busy}>{team.status !== 'open' ? 'Replace manager' : 'Assign manager'}</button>
        {team.status !== 'open' && !confirmRelease && <button className={button} type="button" onClick={() => setConfirmRelease(true)}>Open seat</button>}
      </form>
      {confirmRelease && team.status !== 'open' && <div role="group" aria-label="Confirm opening the seat" className="flex flex-wrap items-center gap-2">
        <span>Open this seat and keep the franchise?</span>
        <button className={button} type="button" disabled={busy} onClick={async () => { if (await save(base + '/managers?rosterId=' + encodeURIComponent(team.rosterId!), 'DELETE')) setConfirmRelease(false) }}>Confirm open seat</button>
        <button className={button} type="button" onClick={() => setConfirmRelease(false)}>Cancel</button>
      </div>}
      {team.status === 'managed' && <><button className={button} type="button" aria-expanded={showCoOwners} onClick={() => setShowCoOwners(!showCoOwners)}>Co-owners</button>
        {showCoOwners && <TeamCoOwnerPanel leagueId={leagueId} rosterId={team.rosterId} onChange={onCoOwnersChange} />}</>}
    </>}
    <SeatInvitePanel base={base} teamId={team.id} open={team.status !== 'managed'} />
  </div>
}

function TeamInviteForm({ endpoint }: { endpoint: string }) {
  const [type, setType] = useState<'email' | 'username'>('email')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ message: string; url?: string; failures?: string[] } | null>(null)

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = String(form.get('recipient') ?? '').trim()
    const recipients: string[] = []
    if (type === 'email') {
      const seen = new Set<string>()
      for (const address of value.split(/[,;\s]+/).filter(Boolean)) {
        const key = address.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        recipients.push(address)
      }
    } else if (value) {
      recipients.push(value.replace(/^@/, ''))
    }
    if (!recipients.length || recipients.length > 20) {
      setResult({ message: type === 'email' ? 'Enter 1 to 20 email addresses.' : 'Enter an AllFantasy username.' })
      return
    }
    if (type === 'email' && recipients.some(address => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address))) {
      setResult({ message: 'Check the email addresses before sending.' })
      return
    }

    setBusy(true)
    setResult(null)
    const failures: string[] = []
    let url: string | undefined
    try {
      for (const recipient of recipients) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, [type]: recipient, message: String(form.get('note') ?? '') }),
          })
          const data = await response.json()
          url ??= data.inviteUrl
          if (!response.ok || (type === 'email' && !data.sent)) {
            failures.push(recipient + ' — ' + (response.status === 429 ? 'Email limit reached' : 'Invite could not be sent'))
          }
        } catch {
          failures.push(recipient + ' — Connection failed')
        }
      }

      setResult({
        url,
        failures,
        message: type === 'email'
          ? (recipients.length - failures.length) + ' of ' + recipients.length + ' email invites accepted by the delivery provider.'
          : failures.length ? 'Could not create an invite.' : 'Invite link ready to share.',
      })
    } finally {
      setBusy(false)
    }
  }

  return <form className="grid gap-2 rounded-xl border border-white/10 p-3" onSubmit={send}>
    <label>Invite by<select className={input} disabled={busy} value={type} onChange={event => { setType(event.target.value as typeof type); setResult(null) }}><option value="email">Email</option><option value="username">AllFantasy username</option></select></label>
    {type === 'email' ? <>
      <label>Email addresses<textarea className={input} disabled={busy} required name="recipient" rows={3} maxLength={6400} placeholder="One address per line, up to 20" /></label>
      <label>Personal note<textarea className={input} disabled={busy} name="note" rows={3} maxLength={320} /></label>
    </> : <label>AllFantasy username<input className={input} disabled={busy} required name="recipient" /></label>}
    <button disabled={busy} className={button + ' justify-self-start bg-teal-800'}>{busy ? 'Working…' : type === 'email' ? 'Send invites' : 'Create invite'}</button>
    {result && <div role="status">
      <p>{result.message} {result.url && <a href={result.url} className="text-teal-300 underline">Open shareable invite link</a>}</p>
      {Boolean(result.failures?.length) && <ul className="list-inside list-disc">{result.failures?.map(failure => <li key={failure}>{failure}</li>)}</ul>}
    </div>}
  </form>
}
