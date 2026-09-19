'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import '@/components/core-app/af-connected-war-room.css'

export type ConnectedFranchiseWarRoomSide = {
  memberId: string
  role: string
  leagueId: string | null
  memberLeagueId: string
  name: string
  platform: string
  sport: string | null
  season: number | null
  teamLabel: string | null
  teamCandidates: Array<{ id: string; label: string }>
  avatarUrl: string | null
  playerCount: number | null
  unavailableReason: string | null
  players: Array<{ id: string; name: string; position: string | null; team: string | null }>
  draft: { phase: string; headline: string; detail: string | null; href: string | null } | null
  activity:
    | { available: true; trades: number; waivers: number; rosterMoves: number; newest: Date | string | null }
    | { available: false; reason: string }
    | null
  sync: {
    lastSyncedAt: Date | string | null
    stale: boolean
    refreshHref: string | null
    detail: string
  }
}

function leagueHref(screen: string, leagueId: string) {
  return `/core/${screen}?league=${encodeURIComponent(leagueId)}`
}

function TeamCrest({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="af-cwr-crest" aria-hidden="true">
      {src && !failed
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span>{name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase()}</span>}
    </span>
  )
}

export function ConnectedFranchiseWarRoom({
  linkId,
  franchiseName,
  primaryMemberId,
  selectedLeagueId,
  sides,
}: {
  linkId: string
  franchiseName: string
  primaryMemberId: string | null
  selectedLeagueId: string
  sides: ConnectedFranchiseWarRoomSide[]
}) {
  const router = useRouter()
  const [savingTeam, setSavingTeam] = useState<string | null>(null)
  const [mappingError, setMappingError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState(franchiseName)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([sides.find((side) => side.leagueId === selectedLeagueId)?.memberId ?? sides[0]?.memberId].filter((id): id is string => Boolean(id))),
  )
  const visibleCounts = sides.filter((side) => side.unavailableReason == null && side.playerCount != null)
  const effectivePrimaryMemberId = primaryMemberId ?? sides[0]?.memberId ?? null
  const totalPlayers = visibleCounts.length === sides.length
    ? visibleCounts.reduce((sum, side) => sum + (side.playerCount ?? 0), 0)
    : null
  const positionCounts = new Map<string, number>()
  for (const player of sides.flatMap((side) => side.players)) {
    if (!player.position) continue
    positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1)
  }
  const positions = [...positionCounts.entries()].sort((a, b) => b[1] - a[1])
  const activeMoves = sides.reduce((sum, side) => (
    side.activity?.available
      ? sum + side.activity.trades + side.activity.waivers + side.activity.rosterMoves
      : sum
  ), 0)

  async function updateTeam(side: ConnectedFranchiseWarRoomSide, teamExternalId: string) {
    setSavingTeam(side.memberLeagueId)
    setMappingError(null)
    try {
      const response = await fetch('/api/legacy/franchise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-team-mapping',
          linkId,
          member: { platform: side.platform, leagueId: side.memberLeagueId, teamExternalId },
        }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not save this team')
      router.refresh()
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : 'Could not save this team')
    } finally {
      setSavingTeam(null)
    }
  }

  async function manage(action: string, values: Record<string, unknown> = {}) {
    setBusyAction(action + String(values.memberId ?? ''))
    setMappingError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/legacy/franchise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, linkId, ...values }),
      })
      const body = (await response.json()) as { error?: string; dissolved?: boolean }
      if (!response.ok) throw new Error(body.error ?? 'Could not update this franchise')
      setNotice(body.dissolved ? 'The shared hub was dissolved. Each league is separate again.' : 'Franchise updated.')
      if (body.dissolved) router.push('/leagues')
      else router.refresh()
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : 'Could not update this franchise')
    } finally {
      setBusyAction(null)
    }
  }

  function toggleExpanded(memberId: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  function askChimmy() {
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, {
      detail: {
        tab: 'chimmy',
        prefill: `Review my entire ${franchiseName} franchise across ${sides.map((side) => side.name).join(', ')}. What decision should I make next?`,
      },
    }))
  }

  return (
    <section className="af-cwr" aria-label={`${franchiseName} connected franchise command center`}>
      <header className="af-cwr-head">
        <div>
          <span className="af-label">CONNECTED FRANCHISE · COMMAND CENTER</span>
          <h1>{franchiseName}</h1>
          <p>Every roster, draft and league pulse in one home. Each league still keeps its own rules, scoring and lineup.</p>
        </div>
        <div className="af-cwr-head-actions">
          <Link className="af-cwr-cta" href={`/core?league=${encodeURIComponent(selectedLeagueId)}`}>
            Open combined roster →
          </Link>
          <Link className="af-cwr-add" href={`/core/connect-leagues?league=${encodeURIComponent(selectedLeagueId)}`}>
            + Add another league
          </Link>
          <button className="af-cwr-add" type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            Manage hub
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <section className="af-cwr-settings" aria-label="Franchise settings">
          <div className="af-cwr-rename">
            <label htmlFor="af-cwr-name">Franchise name</label>
            <input id="af-cwr-name" value={nameDraft} maxLength={80} onChange={(event) => setNameDraft(event.target.value)} />
            <button type="button" disabled={busyAction != null || !nameDraft.trim() || nameDraft.trim() === franchiseName} onClick={() => void manage('rename-franchise', { franchiseName: nameDraft.trim() })}>Save name</button>
          </div>
          <p>Choose the league that opens first, repair team matching, or remove a league from this hub.</p>
        </section>
      ) : null}

      <div className="af-cwr-scoreboard">
        <div><strong>{sides.length}</strong><span>connected leagues</span></div>
        <div><strong>{totalPlayers ?? '—'}</strong><span>players across the franchise</span></div>
        <div><strong>{positions.length}</strong><span>positions represented</span></div>
        <div><strong>{activeMoves}</strong><span>recorded roster moves</span></div>
      </div>

      {mappingError ? <p className="af-cwr-error" role="alert">{mappingError}</p> : null}
      {notice ? <p className="af-cwr-notice" role="status">{notice}</p> : null}

      <nav className="af-cwr-mobile-switcher" aria-label="Connected league switcher">
        {sides.map((side) => (
          <button key={side.memberId} type="button" data-current={expanded.has(side.memberId) || undefined} onClick={() => toggleExpanded(side.memberId)}>
            {side.name}
          </button>
        ))}
      </nav>

      <section className="af-cwr-tools" aria-label="Franchise decision tools">
        <div><span className="af-label">ONE FRANCHISE · EVERY DECISION</span><h2>Work across the whole hub</h2><p>Keep every roster in view, then apply each move under that league’s own rules.</p></div>
        <nav>
          <Link href={`/core/trades?league=${encodeURIComponent(selectedLeagueId)}&franchise=${encodeURIComponent(linkId)}`}>Trade Analyzer</Link>
          <Link href={`/core/waivers?league=${encodeURIComponent(selectedLeagueId)}&franchise=${encodeURIComponent(linkId)}`}>Waivers</Link>
          <Link href={`/core/my-team?league=${encodeURIComponent(selectedLeagueId)}&franchise=${encodeURIComponent(linkId)}`}>Lineup Optimizer</Link>
          <Link href={`/core/draft-hq?league=${encodeURIComponent(selectedLeagueId)}&franchise=${encodeURIComponent(linkId)}`}>Draft Assistant</Link>
          <Link href={`/core/players?league=${encodeURIComponent(selectedLeagueId)}&franchise=${encodeURIComponent(linkId)}`}>Player Search</Link>
          <button type="button" onClick={askChimmy}>Ask Chimmy</button>
        </nav>
      </section>

      <div className="af-cwr-pipeline" aria-label="Connected league dashboard">
        {sides.map((side, index) => {
          const current = side.leagueId === selectedLeagueId
          const selectedTeam = side.teamCandidates.find((team) => team.label === side.teamLabel || team.id === side.teamLabel)?.id ?? ''
          const activityText = side.activity?.available
            ? `${side.activity.trades} trades · ${side.activity.waivers} waivers · ${side.activity.rosterMoves} roster moves`
            : side.activity?.reason ?? 'Activity will appear after the next sync'
          return (
            <div className="af-cwr-lane-wrap" key={`${side.platform}:${side.memberLeagueId}`}>
              <article className="af-cwr-lane" data-current={current || undefined} data-expanded={expanded.has(side.memberId) || undefined} aria-label={`${side.name}${current ? ', current league' : ''}`}>
                <div className="af-cwr-lane-top">
                  <span className="af-cwr-role">{side.sport?.toUpperCase() ?? side.role.toUpperCase()}</span>
                  <span className="af-cwr-mobile-name">{side.name}</span>
                  {current ? <span className="af-cwr-current">CURRENT</span> : null}
                  <button className="af-cwr-expand" type="button" onClick={() => toggleExpanded(side.memberId)} aria-expanded={expanded.has(side.memberId)} aria-label={`${expanded.has(side.memberId) ? 'Collapse' : 'Expand'} ${side.name}`}>⌄</button>
                </div>
                <div className="af-cwr-lane-body">
                <div className="af-cwr-identity"><TeamCrest src={side.avatarUrl} name={side.teamLabel ?? side.name} /><div><h2>{side.name}</h2><p className="af-cwr-platform">{side.platform.toUpperCase()}{side.season ? ` · ${side.season}` : ''}</p></div></div>

                <div className="af-cwr-team">
                  <span>Your team</span>
                  {side.teamCandidates.length > 1 ? (
                    <select
                      aria-label={`Your team in ${side.name}`}
                      value={selectedTeam}
                      disabled={savingTeam === side.memberLeagueId}
                      onChange={(event) => void updateTeam(side, event.target.value)}
                    >
                      <option value="" disabled>Choose your team</option>
                      {side.teamCandidates.map((team) => <option key={team.id} value={team.id}>{team.label}</option>)}
                    </select>
                  ) : <strong>{side.teamLabel ?? 'Team not mapped'}</strong>}
                </div>

                <div className="af-cwr-pulse">
                  <div><span>Roster</span><strong>{side.playerCount == null ? 'Needs attention' : `${side.playerCount} players`}</strong></div>
                  <div><span>Draft</span><strong>{side.draft?.headline ?? 'No draft on file'}</strong><small>{side.draft?.detail}</small></div>
                  <div><span>Activity</span><strong>{side.activity?.available ? 'Connected' : 'Limited'}</strong><small>{activityText}</small></div>
                </div>

                {side.unavailableReason ? <p className="af-cwr-warning">{side.unavailableReason}</p> : null}
                <div className="af-cwr-sync" data-stale={side.sync.stale || undefined}>
                  <div><strong>{side.sync.stale ? 'Refresh recommended' : 'Data up to date'}</strong><span>{side.sync.lastSyncedAt ? `Synced ${new Date(side.sync.lastSyncedAt).toLocaleString()}` : 'No sync time recorded'}</span></div>
                  {side.sync.refreshHref ? <Link href={side.sync.refreshHref}>{side.platform === 'fantrax' ? 'Re-import' : 'Refresh'}</Link> : null}
                  <small>{side.sync.detail}</small>
                </div>
                {side.leagueId ? (
                  <nav className="af-cwr-links" aria-label={`${side.name} shortcuts`}>
                    <Link href={leagueHref('my-team', side.leagueId)}>Roster</Link>
                    <Link href={leagueHref('matchup', side.leagueId)}>Matchup</Link>
                    <Link href={leagueHref('standings', side.leagueId)}>Standings</Link>
                    <Link href={side.draft?.href ?? leagueHref('draft-hq', side.leagueId)}>Draft</Link>
                    <Link href={leagueHref('trades', side.leagueId)}>Trades</Link>
                  </nav>
                ) : null}
                {settingsOpen ? (
                  <div className="af-cwr-manage-row">
                    <button type="button" disabled={effectivePrimaryMemberId === side.memberId || busyAction != null} onClick={() => void manage('set-primary-league', { memberId: side.memberId })}>{effectivePrimaryMemberId === side.memberId ? 'Opens first' : 'Make primary'}</button>
                    <button type="button" disabled={busyAction != null} onClick={() => void manage('repair-team-mapping', { memberId: side.memberId })}>Repair team match</button>
                    <button className="af-cwr-remove" type="button" disabled={busyAction != null} onClick={() => {
                      if (window.confirm(`Remove ${side.name} from this shared hub?`)) void manage('remove-league', { memberId: side.memberId })
                    }}>Remove</button>
                  </div>
                ) : null}
                </div>
              </article>
              {index < sides.length - 1 ? <span className="af-cwr-connector" aria-hidden="true">↔</span> : null}
            </div>
          )
        })}
      </div>

      {positions.length > 0 ? (
        <div className="af-cwr-positions" aria-label="Combined roster positions">
          {positions.map(([position, count]) => <span key={position}><strong>{count}</strong> {position}</span>)}
        </div>
      ) : null}
    </section>
  )
}

export default ConnectedFranchiseWarRoom
