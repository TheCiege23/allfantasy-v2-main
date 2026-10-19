'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { LeagueTeam } from '@prisma/client'
import type { UserLeague } from '@/app/dashboard/types'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { buildDisplayPlayerMap, type DisplayPlayerMap, type DisplayPlayerRecord } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import { applyLineupPick, buildPlayerRow, buildSwapCandidates, initOrSyncLineupLists, type RosterLineupLists } from '@/app/league/[leagueId]/tabs/team-tab-roster-helpers'
import { playerEligibleForSlot } from '@/lib/league/lineup-swap'
import { evaluateLineupLock } from '@/lib/league/lineup-lock'
import { writeAuthorityCopy } from '@/lib/league/write-authority'
import { invalidateIntelligence } from '@/lib/dashboard/intelligence-events'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import { fmt1, formatRecord, optimalLineupListsRespectingLocks, ordinal, projectedTotal } from '@/lib/league/native/nativeScreenModels'
import { Card, InjuryFlag, PosPill, ScreenHead, Segmented } from './NativeScreenParts'

/**
 * My team / Lineup — handoff §3, `Lineup.png` / `MobileLineup.png`.
 *
 * Same reads and the same write as the existing Team tab: `/api/league/roster` for the roster and
 * slot template, `/api/leagues/roster/save` for the lineup. Swap candidates come from the Team
 * tab's own helpers (`team-tab-roster-helpers`), so eligibility is decided in one place, and the
 * server still validates every save. "Optimize lineup" proposes the exact optimum over the
 * players whose games have not started; it never moves a locked player.
 */
type DbRoster = {
  source?: string
  roster: unknown
  unifiedRoster?: UnifiedPlayerWireDto[]
  rosterId?: string
  faabRemaining?: number | null
  leagueWeek?: number
  starterSlots?: ExpandedStarterSlot[]
  canEditLineup?: boolean
  lineupLockHelp?: string | null
}
type Move = { kind: 'starter'; slotIndex: number } | { kind: 'bench'; playerId: string }

function kickoff(p: DisplayPlayerRecord | undefined): Date | null {
  const iso = p?.kickoffTimeIso
  if (!iso) return null
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d : null
}

function gameDone(p: DisplayPlayerRecord | undefined): boolean {
  const s = String(p?.gameStatus ?? p?.liveGameStatus ?? '').toLowerCase()
  return /final|complete|closed|post/.test(s)
}

/** A player is locked once his game has kicked off (per-game lock, Sleeper default). */
function isGameLocked(p: DisplayPlayerRecord | undefined, now: Date): boolean {
  const s = String(p?.gameStatus ?? p?.liveGameStatus ?? '').toLowerCase()
  if (/live|in_progress|inprogress|final|complete|closed|halftime/.test(s)) return true
  const k = kickoff(p)
  return k != null && k.getTime() <= now.getTime()
}

function gameLine(p: DisplayPlayerRecord | undefined): string {
  if (!p) return ''
  const bits: string[] = []
  if (p.team) bits.push(p.team)
  if (p.opponent) bits.push(`${p.homeAway === 'away' ? '@' : 'vs'} ${p.opponent}`)
  if (gameDone(p)) bits.push('Final')
  else if (p.gameClock) bits.push(p.gameClock)
  else {
    const k = kickoff(p)
    if (k) bits.push(k.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
  }
  return bits.join(' · ')
}

function untilLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d >= 1) return `${d}d ${h % 24}h`
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

export function NativeLineupScreen({ league, userTeam, onSelectTab }: { league: UserLeague; userTeam: LeagueTeam | null; onSelectTab: (id: string) => void }) {
  const [data, setData] = useState<DbRoster | null>(null)
  const [lists, setLists] = useState<RosterLineupLists | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [move, setMove] = useState<Move | null>(null)
  const [tab, setTab] = useState<'lineup' | 'roster'>('lineup')
  const [pendingClaims, setPendingClaims] = useState<number | null>(null)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [faabBudget, setFaabBudget] = useState<number | null>(null)
  const [now, setNow] = useState(() => new Date())
  const copy = useMemo(() => writeAuthorityCopy('lineup', league.platform), [league.platform])

  const load = useCallback(async () => {
    if (!userTeam) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/league/roster?leagueId=${encodeURIComponent(league.id)}`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as DbRoster
      if (!res.ok) {
        setError(res.status === 404 ? 'No roster yet for your team.' : 'We could not load your roster.')
        setData(null)
        return
      }
      setData(json)
      const slots = json.starterSlots ?? []
      setLists(slots.length ? initOrSyncLineupLists(json.roster, slots) : null)
    } catch {
      setError('We could not load your roster.')
    } finally {
      setLoading(false)
    }
  }, [league.id, userTeam])

  useEffect(() => {
    void load()
  }, [load])
  useLeagueRealtimeRefresh(league.id, (env) => {
    const t = String(env.eventType ?? '')
    if (t === 'player_changed' || t === 'league_changed' || t.includes('score')) void load()
  })
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    const id = encodeURIComponent(league.id)
    let cancelled = false
    void Promise.all([
      fetch(`/api/waiver-wire/leagues/${id}/claims`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/waiver-wire/leagues/${id}/state`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/waiver-wire/leagues/${id}/settings`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([claims, state, settings]) => {
      if (cancelled) return
      const rows = Array.isArray(claims?.claims) ? (claims.claims as Array<{ status?: string }>) : null
      setPendingClaims(rows ? rows.filter((c) => !c.status || c.status === 'pending').length : null)
      const nr = state?.state?.nextRunAt
      setNextRunAt(typeof nr === 'string' ? nr : null)
      const b = Number(settings?.faabBudget)
      setFaabBudget(settings?.waiverType === 'faab' && Number.isFinite(b) && b > 0 ? b : null)
    })
    return () => {
      cancelled = true
    }
  }, [league.id])

  const players: DisplayPlayerMap = useMemo(() => buildDisplayPlayerMap(null, data?.unifiedRoster ?? []), [data])
  const slots = useMemo(() => data?.starterSlots ?? [], [data])
  const weekLock = useMemo(
    () => (data?.leagueWeek ? evaluateLineupLock({ sport: String(league.sport ?? 'NFL'), now, leagueWeek: data.leagueWeek, editingWeek: data.leagueWeek }) : null),
    [data?.leagueWeek, league.sport, now],
  )
  const editable = Boolean(data?.rosterId && lists && data.canEditLineup !== false && weekLock && !weekLock.locked)
  const locked = useCallback((id: string) => isGameLocked(players[id], now), [players, now])

  const nextLock = useMemo(() => {
    if (!lists) return null
    let best: Date | null = null
    for (const id of [...lists.starters, ...lists.bench]) {
      const k = kickoff(players[id])
      if (k && k.getTime() > now.getTime() && (!best || k < best)) best = k
    }
    return best
  }, [lists, players, now])

  const save = useCallback(
    async (next: RosterLineupLists) => {
      if (!data?.rosterId || !editable) return false
      setSaving(true)
      try {
        const roster = {
          starters: next.starters.map((id) => (id ? buildPlayerRow(id, players) : null)).filter((x): x is Record<string, unknown> => x != null),
          bench: next.bench.map((id) => buildPlayerRow(id, players)),
          ir: next.ir.map((id) => buildPlayerRow(id, players)),
          taxi: next.taxi.map((id) => buildPlayerRow(id, players)),
          devy: next.devy.map((id) => buildPlayerRow(id, players)),
        }
        const res = await fetch('/api/leagues/roster/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId: league.id, rosterId: data.rosterId, week: data.leagueWeek ?? 1, roster }),
        })
        const j = (await res.json().catch(() => ({}))) as { writeAuthority?: { copy?: { title?: string; detail?: string } }; error?: string }
        if (!res.ok) {
          toast.error(j.error ? `Lineup was not saved: ${j.error}` : 'Lineup was not saved. Your previous lineup is still active.')
          return false
        }
        const c = j.writeAuthority?.copy ?? copy
        toast.success(c.title ?? copy.title, { description: c.detail || undefined })
        setLists(next)
        setMove(null)
        invalidateIntelligence({ leagueId: league.id, reason: 'lineup_saved' })
        void load()
        return true
      } catch {
        toast.error('Lineup was not saved. Your previous lineup is still active.')
        return false
      } finally {
        setSaving(false)
      }
    },
    [data, editable, players, league.id, copy, load],
  )

  const optimal = useMemo(() => (lists && editable ? optimalLineupListsRespectingLocks(slots, lists, players, locked) : null), [lists, editable, slots, players, locked])

  if (!userTeam) {
    return (
      <div className="nls" data-testid="native-lineup-screen">
        <ScreenHead eyebrow={`${league.name} · My team`} title="My team" />
        <Card><p>You have not claimed a team in this league yet. Ask your commissioner for an invite.</p></Card>
      </div>
    )
  }

  const record = formatRecord({ wins: userTeam.wins, losses: userTeam.losses, ties: userTeam.ties })
  const place = ordinal(userTeam.currentRank)
  const startersProj = lists ? projectedTotal(lists.starters, players) : null
  const faab = data?.faabRemaining ?? null
  const runLabel = nextRunAt ? new Date(nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null

  const lockText = !data
    ? null
    : !editable
      ? weekLock?.reason ?? data.lineupLockHelp ?? 'Lineup changes are closed right now.'
      : `${data.lineupLockHelp ?? 'Each game locks at kickoff.'} Tap Move on a starter to swap.`

  const renderRow = (id: string, slot: { label: string; index?: number } | null, kind: 'starter' | 'bench', slotIndex?: number) => {
    const p = id ? players[id] : undefined
    const isLocked = id ? locked(id) : false
    const moving = move && ((move.kind === 'starter' && kind === 'starter' && move.slotIndex === slotIndex) || (move.kind === 'bench' && move.playerId === id))
    const pill = kind === 'starter' ? slot?.label ?? '—' : 'BN'
    return (
      <li key={`${kind}-${slotIndex ?? id}`}>
        <div className="nls-lrow" data-moving={moving || undefined}>
          <PosPill label={pill} tone={kind === 'starter' ? slot?.label : 'BN'} />
          <div className="nls-player">
            <strong>
              {p?.name ?? (id ? 'Unknown player' : 'Empty')}
              {kind === 'bench' && p?.position ? <span className="nls-player-pos"> {p.position}</span> : null}
              <InjuryFlag status={p?.injuryStatus} />
            </strong>
            <small>{gameLine(p) || (id ? '—' : 'Open slot')}</small>
          </div>
          <span className="nls-proj">{fmt1(p?.projectedPoints ?? null)}</span>
          <span className="nls-lrow-action">
            {editable ? (
              isLocked ? (
                <button type="button" className="nls-btn" data-size="sm" disabled>Locked</button>
              ) : (
                <button
                  type="button"
                  className="nls-btn"
                  data-size="sm"
                  aria-expanded={Boolean(moving)}
                  disabled={saving}
                  onClick={() => setMove(moving ? null : kind === 'starter' ? { kind: 'starter', slotIndex: slotIndex ?? 0 } : { kind: 'bench', playerId: id })}
                >
                  {moving ? 'Cancel' : 'Move'}
                </button>
              )
            ) : null}
          </span>
        </div>
        {moving && lists ? renderSwapper(kind, id, slotIndex) : null}
      </li>
    )
  }

  const renderSwapper = (kind: 'starter' | 'bench', id: string, slotIndex?: number) => {
    if (!lists) return null
    if (kind === 'starter' && slotIndex != null) {
      const slot = slots[slotIndex]
      const candidates = buildSwapCandidates({ lists, slot, slotIndex, players }).filter((c) => c.badge !== 'IR' && c.badge !== 'TX' && c.badge !== 'DV')
      return (
        <div className="nls-swapper">
          <p className="nls-swapper-title"><span>Swap into {slot.label}</span></p>
          {candidates.length ? (
            <ul>
              {candidates.map((c) => {
                const off = !c.eligible || locked(c.id)
                return (
                  <li key={c.id}>
                    <button type="button" disabled={off || saving} onClick={() => void save(applyLineupPick({ lists, slotIndex, incomingId: c.id }))} title={!c.eligible ? `Not eligible for ${slot.label}` : locked(c.id) ? 'His game has started' : undefined}>
                      <PosPill label={c.position} />
                      <span className="nls-player"><strong>{c.name}</strong><small>{c.badge === 'S' ? 'Starter' : 'Bench'} · {gameLine(players[c.id]) || c.team}</small></span>
                      <span className="nls-proj nls-mono">{fmt1(players[c.id]?.projectedPoints ?? null)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="nls-muted">No one on your roster can fill this slot.</p>
          )}
        </div>
      )
    }
    const p = players[id]
    const targets = slots.map((s, i) => ({ s, i })).filter(({ s, i }) => playerEligibleForSlot(s, p?.position) && !(lists.starters[i] && locked(lists.starters[i])))
    return (
      <div className="nls-swapper">
        <p className="nls-swapper-title"><span>Start {p?.name ?? 'this player'} in…</span></p>
        {targets.length ? (
          <ul>
            {targets.map(({ s, i }) => {
              const out = lists.starters[i] ? players[lists.starters[i]] : undefined
              return (
                <li key={i}>
                  <button type="button" disabled={saving} onClick={() => void save(applyLineupPick({ lists, slotIndex: i, incomingId: id }))}>
                    <PosPill label={s.label} />
                    <span className="nls-player"><strong>{out ? `Replace ${out.name}` : 'Empty slot'}</strong><small>{out ? gameLine(out) : s.label}</small></span>
                    <span className="nls-proj nls-mono">{fmt1(out?.projectedPoints ?? null)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="nls-muted">No open starting slot fits his position right now.</p>
        )}
      </div>
    )
  }

  const allRoster = data ? [...(lists?.starters ?? []), ...(lists?.bench ?? []), ...(lists?.ir ?? []), ...(lists?.taxi ?? []), ...(lists?.devy ?? [])].filter(Boolean) : []

  return (
    <div className="nls" data-testid="native-lineup-screen">
      <ScreenHead eyebrow={`${league.name} · My team`} title={userTeam.teamName} sub={`${record}${place ? ` · ${place} place` : ''} · PF ${fmt1(userTeam.pointsFor)}`}>
        <button type="button" className="nls-btn" onClick={() => onSelectTab('trades')}>Propose trade</button>
        <button type="button" className="nls-btn" onClick={() => onSelectTab('waivers')}>Add / drop</button>
        <button type="button" className="nls-btn" data-variant="primary" disabled={!optimal || saving} title={optimal ? 'Start the highest projected legal lineup' : 'Your lineup is already the best projected lineup'} onClick={() => optimal && void save(optimal)}>
          Optimize lineup
        </button>
      </ScreenHead>

      <Segmented label="Team view" value={tab} onChange={setTab} options={[{ id: 'lineup', label: 'Lineup' }, { id: 'roster', label: 'Full roster' }]} />

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {loading && !data ? <p className="nls-empty" role="status">Loading your roster…</p> : null}

      {data ? (
        <div className="nls-cols">
          <div className="nls nls-stack">
            {lockText ? (
              <div className="nls-lockbar" data-tone={editable ? undefined : 'locked'} role="status">
                {editable && nextLock ? <span className="nls-chip" data-tone="warn">Next lock {untilLabel(nextLock.getTime() - now.getTime())}</span> : null}
                <span>{lockText}</span>
              </div>
            ) : null}

            {tab === 'lineup' ? (
              lists && slots.length ? (
                <>
                  <section className="nls-card nls-card-flush" aria-label="Starters">
                    <h3 className="nls-label nls-card-head"><span>Starters</span><span>{startersProj != null ? `Proj ${fmt1(startersProj)}` : ''}</span></h3>
                    <ul className="nls-rows">{slots.map((s, i) => renderRow(lists.starters[i] ?? '', s, 'starter', i))}</ul>
                  </section>
                  <section className="nls-card nls-card-flush" aria-label="Bench">
                    <h3 className="nls-label nls-card-head">Bench</h3>
                    <ul className="nls-rows">
                      {lists.bench.filter(Boolean).map((id) => renderRow(id, null, 'bench'))}
                      {lists.ir.filter(Boolean).map((id) => (
                        <li key={`ir-${id}`}>
                          <div className="nls-lrow">
                            <PosPill label="IR" />
                            <div className="nls-player"><strong>{players[id]?.name ?? 'Unknown player'}<InjuryFlag status={players[id]?.injuryStatus} /></strong><small>{gameLine(players[id]) || '—'}</small></div>
                            <span className="nls-proj">{fmt1(players[id]?.projectedPoints ?? null)}</span>
                            <span />
                          </div>
                        </li>
                      ))}
                      {!lists.ir.filter(Boolean).length ? (
                        <li><div className="nls-lrow nls-lrow-empty"><PosPill label="IR" /><span>Empty — move an Out or IR player here to free a roster spot.</span></div></li>
                      ) : null}
                    </ul>
                  </section>
                </>
              ) : (
                <Card><p>Your league has no starting lineup template yet, so there is nothing to set. Your commissioner can set roster slots in league settings.</p></Card>
              )
            ) : (
              <section className="nls-card nls-card-flush" aria-label="Full roster">
                <h3 className="nls-label nls-card-head"><span>Full roster</span><span>{allRoster.length} players</span></h3>
                <ul className="nls-rows">
                  {allRoster.map((id) => {
                    const p = players[id]
                    return (
                      <li key={id}>
                        <div className="nls-lrow" data-cols="3">
                          <PosPill label={p?.position ?? '—'} />
                          <div className="nls-player"><strong>{p?.name ?? 'Unknown player'}<InjuryFlag status={p?.injuryStatus} /></strong><small>{gameLine(p) || '—'}</small></div>
                          <span className="nls-proj">{fmt1(p?.projectedPoints ?? null)}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </div>

          <aside className="nls-aside" aria-label="Roster moves">
            <Card label="Roster moves">
              <dl className="nls-stats">
                <div className="nls-stat"><dt>FAAB left</dt><dd>{faab != null ? <>${faab}{faabBudget ? <small> / {faabBudget}</small> : null}</> : '—'}</dd></div>
                <div className="nls-stat"><dt>Pending claims</dt><dd>{pendingClaims ?? '—'}</dd></div>
              </dl>
              <p>{runLabel ? `Waivers run ${runLabel}.` : 'Waiver timing follows your league settings.'}</p>
              <div className="nls-actions nls-actions-top">
                <button type="button" className="nls-btn" data-block="true" onClick={() => onSelectTab('waivers')}>Manage claims</button>
              </div>
            </Card>
            <Card label="Trade block">
              <p>List players you would move and AF will flag managers who need your positions.</p>
              <div className="nls-actions nls-actions-top">
                <button type="button" className="nls-btn" data-block="true" onClick={() => onSelectTab('trades')}>Open trade block</button>
              </div>
            </Card>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
