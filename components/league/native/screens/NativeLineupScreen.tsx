'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { LeagueTeam } from '@prisma/client'
import type { UserLeague } from '@/app/dashboard/types'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { buildDisplayPlayerMap, type DisplayPlayerMap, type DisplayPlayerRecord } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import { buildPlayerRow, buildSwapCandidates, initOrSyncLineupLists, type RosterLineupLists } from '@/app/league/[leagueId]/tabs/team-tab-roster-helpers'
import { resolveLineupMove, resolveLineupTap, seatStartersInSlots, startersOnBye, type LineupMoveContext, type LineupSpot, type LineupTap } from '@/lib/league/native/lineupMoves'
import { isIrEligibleStatus, type IrRules } from '@/lib/roster-lineup-engine/irEligibility'
import { evaluateLineupLock } from '@/lib/league/lineup-lock'
import { writeAuthorityCopy } from '@/lib/league/write-authority'
import { invalidateIntelligence } from '@/lib/dashboard/intelligence-events'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import { fmt1, formatRecord, optimalLineupListsRespectingLocks, ordinal, projectedTotal } from '@/lib/league/native/nativeScreenModels'
import { slotCategory } from '@/lib/league-runtime/redraftSlotType'
import type { DailyLineupDay, DailyLineupView } from '@/lib/redraft/dailyLineupView'
import { Card, InjuryFlag, PosPill, ScreenHead, Segmented } from './NativeScreenParts'
import { AutoBenchByeToggle } from './AutoBenchByeToggle'
import { MyTeamAutomations } from './MyTeamAutomations'
import { AutomaticChangesLog } from '@/components/league/AutomaticChangesLog'
import { WelcomeBackCard } from '@/components/league/WelcomeBackCard'
import { AF_FORM_PROJECTION_EXPLAINER, AF_FORM_PROJECTION_SOURCE, AF_POSITION_RANK_TITLE } from '@/lib/projections/dailySportFormLabels'
import { buildOfflineLineupSnapshot, readOfflineLineupSnapshot, saveOfflineLineupSnapshot, type OfflineLineupSnapshot } from '@/lib/pwa/offlineLineupSnapshots'
import { OfflineLineupSnapshotView } from './OfflineLineupSnapshotView'

/**
 * My team / Lineup — handoff §3, `Lineup.png` / `MobileLineup.png`.
 *
 * Same reads and the same write as the existing Team tab: `/api/league/roster` for the roster and
 * slot template, `/api/leagues/roster/save` for the lineup. Swap candidates come from the Team
 * tab's own helpers (`team-tab-roster-helpers`), so eligibility is decided in one place, and the
 * server still validates every save. "Optimize lineup" proposes the exact optimum over the
 * players whose games have not started; it never moves a locked player.
 *
 * Moves work by TAP TO SWAP (tap a player or slot, then tap where he goes — Sleeper's model, the one
 * that works on a phone), by the "Move" list, or by DRAG (the grip handle, @dnd-kit). All go through
 * `resolveLineupMove`, so slot eligibility (`playerEligibleForSlot`), lock and IR rules are decided
 * once, and both end in the same `save`. Dropping on an occupied slot swaps; dropping a starter on
 * the bench leaves his slot empty; IR takes only an IR-eligible designation under the league's flags.
 * Each saved starter carries his slot index (lib/league/lineupSlotPositions.ts), so the empty slot is
 * still where he left it after a reload.
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
  /** Daily-lineup leagues only: the week day by day (`lib/redraft/dailyLineupView.ts`). */
  dailyLineups?: DailyLineupView | null
  slotLimits?: { bench?: number | null; ir?: number | null; taxi?: number | null } | null
  /** Per-player locks from the server's lock context (kickoff, daily-lineup schedule locks). */
  lineupLock?: { lockedPlayerIds?: string[] | null; perPlayerReasons?: Record<string, string> | null } | null
  irRules?: IrRules | null
}
/** Absent `irRules` (older server): only explicit IR designations qualify, never a league option. */
const STRICT_IR_RULES: IrRules = { irAllowOut: false, irAllowCovid: false, irAllowSuspended: false, irAllowNA: false, irAllowDNR: false, irAllowDoubtful: false }
const DRAG_PREFIX = 'player:'

function spotFromDropId(id: string): LineupSpot | null {
  if (id === 'bench') return { kind: 'bench' }
  if (id === 'ir') return { kind: 'ir' }
  if (id === 'taxi') return { kind: 'taxi' }
  const m = /^slot:(\d+)$/.exec(id)
  return m ? { kind: 'starter', slotIndex: Number(m[1]) } : null
}

/** Pointer first (touch and mouse land where the finger is); keyboard drags have no pointer. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : closestCenter(args)
}

/** A drop target. `state` is set only while a drag is live: would this drop be accepted? */
function DropZone({ id, state, as = 'div', className, label, moving, row, children }: { id: string; state?: 'ok' | 'no'; as?: 'div' | 'section'; className?: string; label?: string; moving?: boolean; row?: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const Tag = as
  return (
    <Tag ref={setNodeRef} className={className} aria-label={label} data-moving={moving || undefined} data-dnd={row || undefined} data-drop={state} data-over={(isOver && Boolean(state)) || undefined}>
      {children}
    </Tag>
  )
}

function DragHandle({ id, name }: { id: string; name: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${DRAG_PREFIX}${id}` })
  return (
    <button type="button" ref={setNodeRef} className="nls-drag" data-dragging={isDragging || undefined} {...attributes} {...listeners} aria-label={`Drag ${name}`}>
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" /></g></svg>
    </button>
  )
}
type Move = { kind: 'starter'; slotIndex: number } | { kind: 'bench'; playerId: string }

const TAP_HELP = 'Tap a player, then tap where he goes or who he swaps with. You can also drag by the handle.'

function sameTap(a: LineupTap, b: LineupTap): boolean {
  if (a.kind === 'slot' && b.kind === 'slot') return a.slotIndex === b.slotIndex
  if (a.kind === 'player' && b.kind === 'player') return a.playerId === b.playerId
  return false
}

/** What a screen reader hears for the tap target on a row. */
function tapLabel(o: { name?: string; empty: boolean; slot: string; picked: boolean; target?: 'ok' | 'no'; waiting: boolean }): string {
  const who = o.empty ? `Empty ${o.slot} slot` : `${o.name ?? 'Player'}, ${o.slot}`
  if (o.picked) return `${who}. Selected. Tap again to cancel.`
  if (o.waiting) return o.target === 'ok' ? `${who}. Tap to move here.` : `${who}. Not a legal move.`
  return `${who}. Tap to select.`
}

/** The player cell: a button while the lineup is editable, so a row is one tap target on a phone. */
function PlayerCell({ tappable, picked, label, disabled, onTap, children }: { tappable: boolean; picked: boolean; label: string; disabled: boolean; onTap: () => void; children: ReactNode }) {
  if (!tappable) return <div className="nls-player">{children}</div>
  return (
    <button type="button" className="nls-player nls-tap" aria-pressed={picked} aria-label={label} disabled={disabled} onClick={onTap} data-testid="lineup-tap">
      {children}
    </button>
  )
}

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
  if (String(p.opponent ?? '').toUpperCase() === 'BYE') bits.push('Bye week')
  else if (p.opponent) bits.push(`${p.homeAway === 'away' ? '@' : 'vs'} ${p.opponent}`)
  if (gameDone(p)) bits.push('Final')
  else if (p.gameClock) bits.push(p.gameClock)
  else {
    const k = kickoff(p)
    if (k) bits.push(k.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
  }
  return bits.join(' · ')
}

/** `2026-10-20` → `Tue 20`, read as the calendar day it names (not shifted by the viewer's zone). */
function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** NBA / NHL / MLB: "C12" beside the name — rank within position by season points in this league's scoring. */
function RankTag({ p }: { p: DisplayPlayerRecord | undefined }) {
  if (!p?.positionRankLabel) return null
  return <span className="nls-player-pos" title={AF_POSITION_RANK_TITLE} data-testid={`lineup-position-rank-${p.id}`}> {p.positionRankLabel}</span>
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
  /** Tap to swap: the first tap, waiting for the second. */
  const [picked, setPicked] = useState<LineupTap | null>(null)
  const [tab, setTab] = useState<'lineup' | 'roster'>('lineup')
  const [pendingClaims, setPendingClaims] = useState<number | null>(null)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [faabBudget, setFaabBudget] = useState<number | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  /** Set only when the roster fetch failed for lack of a network and a saved copy exists. */
  const [offlineSnapshot, setOfflineSnapshot] = useState<OfflineLineupSnapshot | null>(null)
  const copy =useMemo(() => writeAuthorityCopy('lineup', league.platform), [league.platform])
  /** Only the newest load may land: switching days quickly must not let an older day's answer win. */
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    if (!userTeam) {
      setLoading(false)
      return
    }
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      // Daily leagues: the AF projection, its games and the opponent are for the day being looked at.
      const dayParam = pickedDay ? `&day=${encodeURIComponent(pickedDay)}` : ''
      const res = await fetch(`/api/league/roster?leagueId=${encodeURIComponent(league.id)}${dayParam}`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as DbRoster
      if (seq !== loadSeq.current) return
      if (!res.ok) {
        setError(res.status === 404 ? 'No roster yet for your team.' : 'We could not load your roster.')
        setData(null)
        return
      }
      setData(json)
      const slots = json.starterSlots ?? []
      if (slots.length) {
        const base = initOrSyncLineupLists(json.roster, slots)
        // A lineup saved with slot positions comes back slot-for-slot, holes included, and the re-seat
        // leaves it alone. One saved without them (before positions) is compacted; re-seat it.
        const byId = buildDisplayPlayerMap(null, json.unifiedRoster ?? [])
        setLists({ ...base, starters: seatStartersInSlots(base.starters, slots, (pid) => byId[pid]?.position) })
      } else setLists(null)
      setOfflineSnapshot(null)
    } catch {
      // The fetch itself failed — no network, not a server answer. Fall back to the copy this screen
      // saved on its last online load, if there is one; only an error when there is nothing to show.
      const snapshot = await readOfflineLineupSnapshot(league.id)
      if (seq !== loadSeq.current) return
      if (snapshot) setOfflineSnapshot(snapshot)
      else setError('We could not load your roster.')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [league.id, userTeam, pickedDay])

  useEffect(() => {
    void load()
  }, [load])
  // Back online: reload, which replaces the offline copy with the live lineup.
  useEffect(() => {
    const onOnline = () => void load()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
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
  const daily = data?.dailyLineups ?? null
  const weekLock = useMemo(
    () =>
      data?.leagueWeek
        ? evaluateLineupLock({ sport: String(league.sport ?? 'NFL'), now, leagueWeek: data.leagueWeek, editingWeek: data.leagueWeek, dailyLineups: Boolean(daily) })
        : null,
    [data?.leagueWeek, league.sport, now, daily],
  )
  // Daily leagues: the day being looked at. Only today is edited; a save applies to today and every later day.
  const viewDay: DailyLineupDay | null = daily ? daily.days.find((d) => d.day === (pickedDay ?? daily.today)) ?? daily.days.find((d) => d.status === 'today') ?? null : null
  const viewingOtherDay = Boolean(viewDay && viewDay.status !== 'today')
  const editable = Boolean(data?.rosterId && lists && data.canEditLineup !== false && weekLock && !weekLock.locked && !viewingOtherDay)
  const serverLocked = useMemo(() => new Set(data?.lineupLock?.lockedPlayerIds ?? []), [data])
  const locked = useCallback((id: string) => serverLocked.has(id) || isGameLocked(players[id], now), [serverLocked, players, now])
  const lockReason = useCallback(
    (id: string): string | undefined => {
      const r = data?.lineupLock?.perPlayerReasons?.[id]
      if (r) return r
      if (isGameLocked(players[id], now)) return 'His game has started.'
      return serverLocked.has(id) ? 'Locked for this scoring period.' : undefined
    },
    [data, players, now, serverLocked],
  )
  const canIr = useCallback((id: string) => isIrEligibleStatus(data?.irRules ?? STRICT_IR_RULES, players[id]?.injuryStatus), [data, players])
  const irCapacity = data?.slotLimits?.ir ?? null
  /** Bench spots the commissioner set (roster positions → BN); each unfilled one shows as an open slot. */
  const benchCapacity = data?.slotLimits?.bench ?? null
  const hasIr = (irCapacity ?? 0) > 0 || Boolean(lists?.ir.some(Boolean))
  const taxiCapacity = data?.slotLimits?.taxi ?? null
  /** Shown when the league has a taxi squad, or when someone already sits on one. */
  const hasTaxi = (taxiCapacity ?? 0) > 0 || Boolean(lists?.taxi.some(Boolean))

  const nextLock = useMemo(() => {
    if (!lists) return null
    let best: Date | null = null
    for (const id of [...lists.starters, ...lists.bench]) {
      const k = kickoff(players[id])
      if (k && k.getTime() > now.getTime() && (!best || k < best)) best = k
    }
    return best
  }, [lists, players, now])

  /** Weekly lineups only: a daily league has no bye weeks, only days without a game. */
  const byeStarters = useMemo(
    () => (lists && editable && !daily ? startersOnBye(lists.starters, (id) => players[id], data?.leagueWeek) : []),
    [lists, editable, daily, players, data?.leagueWeek],
  )

  const savingRef = useRef(false)
  const save = useCallback(
    async (next: RosterLineupLists) => {
      if (!data?.rosterId || !editable || savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const roster = {
          // Each starter carries his slot, so an empty slot reloads where the manager left it.
          starters: next.starters.flatMap((id, slotIndex) => (id ? [{ ...buildPlayerRow(id, players), slotIndex }] : [])),
          bench: next.bench.map((id) => buildPlayerRow(id, players)),
          // The save route admits an IR row by its status, so send the real designation, not 'healthy'.
          ir: next.ir.map((id) => ({ ...buildPlayerRow(id, players), status: String(players[id]?.injuryStatus ?? 'healthy').toLowerCase() })),
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
        setPicked(null)
        invalidateIntelligence({ leagueId: league.id, reason: 'lineup_saved' })
        void load()
        return true
      } catch {
        toast.error('Lineup was not saved. Your previous lineup is still active.')
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [data, editable, players, league.id, copy, load],
  )

  const moveCtx: LineupMoveContext | null = useMemo(
    () =>
      lists
        ? { lists, slots, positionOf: (id: string) => players[id]?.position, isLocked: locked, lockReason, canIr, limits: { bench: data?.slotLimits?.bench ?? null, ir: hasIr ? irCapacity : 0, taxi: hasTaxi ? taxiCapacity : 0 } }
        : null,
    [lists, slots, players, locked, lockReason, canIr, data?.slotLimits?.bench, hasIr, irCapacity, hasTaxi, taxiCapacity],
  )
  const tryMove = useCallback((playerId: string, target: LineupSpot) => (moveCtx ? resolveLineupMove(moveCtx, playerId, target) : null), [moveCtx])
  const doMove = useCallback(
    (playerId: string, target: LineupSpot) => {
      const r = tryMove(playerId, target)
      if (!r || !editable) return
      if (!r.ok) {
        if (!r.noop) toast.error(r.reason)
        return
      }
      void save(r.next)
    },
    [tryMove, editable, save],
  )

  const [dragId, setDragId] = useState<string | null>(null)
  const sensors = useSensors(
    // A short travel before a drag starts, so a tap on the handle (or a scroll) is never a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )
  const onDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id)
    setDragId(id.startsWith(DRAG_PREFIX) ? id.slice(DRAG_PREFIX.length) : null)
  }, [])
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragId(null)
      const id = String(e.active.id)
      const target = e.over ? spotFromDropId(String(e.over.id)) : null
      if (!id.startsWith(DRAG_PREFIX) || !target) return
      doMove(id.slice(DRAG_PREFIX.length), target)
    },
    [doMove],
  )
  const spotLabel = useCallback(
    (dropId: string) => {
      const t = spotFromDropId(dropId)
      if (!t) return 'nowhere'
      return t.kind === 'starter' ? `the ${slots[t.slotIndex]?.label ?? ''} slot` : t.kind === 'ir' ? 'injured reserve' : t.kind === 'taxi' ? 'the taxi squad' : 'the bench'
    },
    [slots],
  )
  const nameOf = useCallback((dragKey: string | number) => players[String(dragKey).slice(DRAG_PREFIX.length)]?.name ?? 'player', [players])
  const announcements: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${spotLabel(String(over.id))}.` : `${nameOf(active.id)} is not over a lineup spot.`),
      onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} dropped on ${spotLabel(String(over.id))}.` : `${nameOf(active.id)} was dropped.`),
      onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
    }),
    [nameOf, spotLabel],
  )
  /** While dragging, every target says whether the drop would be accepted. */
  const dropState = (target: LineupSpot): 'ok' | 'no' | undefined => {
    if (!dragId) return undefined
    return tryMove(dragId, target)?.ok ? 'ok' : 'no'
  }

  /** Tap to swap: what the second tap would do, for every row and section while a first tap waits. */
  const tapMove = (second: LineupTap) => (picked && lists ? resolveLineupTap(lists, picked, second) : null)
  const tapState = (second: LineupTap): 'ok' | 'no' | undefined => {
    if (!picked || dragId || sameTap(picked, second)) return undefined
    const m = tapMove(second)
    return m && tryMove(m.playerId, m.target)?.ok ? 'ok' : 'no'
  }
  const onTap = (tap: LineupTap) => {
    if (!editable || saving || !lists) return
    if (picked && sameTap(picked, tap)) return setPicked(null)
    const m = picked ? tapMove(tap) : null
    if (m) {
      setPicked(null)
      doMove(m.playerId, m.target)
      return
    }
    // A first tap, or a second tap that makes no move: it becomes the new first tap.
    if (tap.kind === 'section') return setPicked(null)
    const id = tap.kind === 'player' ? tap.playerId : lists.starters[tap.slotIndex] ?? ''
    if (id && locked(id)) {
      toast.error(lockReason(id) ?? 'This player is locked.')
      return setPicked(null)
    }
    setMove(null)
    setPicked(tap)
  }
  useEffect(() => {
    if (!picked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicked(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked])
  /** Section header button: "Move here" while a first tap could land in this section. */
  const sectionTap = (section: 'bench' | 'ir' | 'taxi', label: string) =>
    picked && tapState({ kind: 'section', section }) === 'ok' ? (
      <button type="button" className="nls-btn" data-size="sm" disabled={saving} onClick={() => onTap({ kind: 'section', section })}>
        Move to {label}
      </button>
    ) : null

  const optimal = useMemo(() => (lists && editable ? optimalLineupListsRespectingLocks(slots, lists, players, locked) : null), [lists, editable, slots, players, locked])

  // Keep the device's offline copy current. Only the live lineup is saved — a past or future day in a
  // daily league is a view of another day, not what the reader would want to see with no signal.
  const teamName = userTeam?.teamName ?? ''
  useEffect(() => {
    if (!data || !lists || !slots.length || !teamName || viewingOtherDay) return
    void saveOfflineLineupSnapshot(
      buildOfflineLineupSnapshot({
        leagueId: league.id,
        leagueName: league.name,
        sport: String(league.sport ?? ''),
        teamName,
        week: data.leagueWeek,
        slots,
        lists,
        players,
      }),
    )
  }, [data, lists, slots, players, teamName, viewingOtherDay, league.id, league.name, league.sport])

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
  const afFormProjected = Object.values(players).some((p) => p.projectionsSource === AF_FORM_PROJECTION_SOURCE)
  const faab = data?.faabRemaining ?? null
  const runLabel = nextRunAt ? new Date(nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null

  const lastDay = daily?.days[daily.days.length - 1]?.day
  const lockText = !data
    ? null
    : viewDay && viewDay.status === 'past'
      ? `${dayLabel(viewDay.day)} is over. This is the lineup that scored that day.`
      : viewDay && viewDay.status === 'future'
        ? `Your lineup carries forward to ${dayLabel(viewDay.day)}. Changes you make today apply to every remaining day this week.`
        : !editable
          ? weekLock?.reason ?? data.lineupLockHelp ?? 'Lineup changes are closed right now.'
          : daily
            ? `Daily lineup: each player locks when his game starts today. Changes apply today${lastDay ? ` through ${dayLabel(lastDay)}` : ''}. ${TAP_HELP}`
            : `${data.lineupLockHelp ?? 'Each game locks at kickoff.'} ${TAP_HELP}`

  const renderPastDay = (d: DailyLineupDay) => {
    const ids = Object.keys(d.slots)
    const starters = ids.filter((id) => slotCategory(d.slots[id]) === 'starter')
    const others = ids.filter((id) => slotCategory(d.slots[id]) !== 'starter')
    const row = (id: string) => (
      <li key={`${d.day}-${id}`}>
        <div className="nls-lrow" data-cols="3">
          <PosPill label={slotCategory(d.slots[id]) === 'starter' ? d.slots[id] : slotCategory(d.slots[id]) === 'bench' ? 'BN' : d.slots[id].toUpperCase()} />
          <div className="nls-player"><strong>{players[id]?.name ?? 'Unknown player'}</strong><small>{d.points[id] != null ? 'Played' : 'No game'}</small></div>
          <span className="nls-proj">{d.points[id] != null ? fmt1(d.points[id]) : '—'}</span>
        </div>
      </li>
    )
    return (
      <>
        <section className="nls-card nls-card-flush" aria-label={`Starters on ${dayLabel(d.day)}`}>
          <h3 className="nls-label nls-card-head"><span>Starters · {dayLabel(d.day)}</span><span>{fmt1(d.starterPoints)} pts</span></h3>
          <ul className="nls-rows">{starters.length ? starters.map(row) : <li><div className="nls-lrow nls-lrow-empty"><span>No lineup was recorded for this day.</span></div></li>}</ul>
        </section>
        {others.length ? (
          <section className="nls-card nls-card-flush" aria-label={`Bench on ${dayLabel(d.day)}`}>
            <h3 className="nls-label nls-card-head">Bench</h3>
            <ul className="nls-rows">{others.map(row)}</ul>
          </section>
        ) : null}
      </>
    )
  }

  type RowKind = 'starter' | 'bench' | 'ir' | 'taxi'
  const renderRow = (id: string, slot: { label: string; index?: number } | null, kind: RowKind, slotIndex?: number) => {
    const p = id ? players[id] : undefined
    const isLocked = id ? locked(id) : false
    const reason = id && isLocked ? lockReason(id) : undefined
    const moving = Boolean(
      move &&
        ((move.kind === 'starter' && kind === 'starter' && move.slotIndex === slotIndex) ||
          (move.kind === 'bench' && kind === 'bench' && move.playerId === id)),
    )
    const pill = kind === 'starter' ? slot?.label ?? '—' : kind === 'ir' ? 'IR' : kind === 'taxi' ? 'TX' : 'BN'
    const tap: LineupTap = kind === 'starter' ? { kind: 'slot', slotIndex: slotIndex ?? 0 } : { kind: 'player', playerId: id }
    const isPicked = Boolean(picked && sameTap(picked, tap))
    const tapTarget = tapState(tap)
    const reasonId = reason ? `nls-lock-${kind}-${slotIndex ?? id}` : undefined
    const cells = (
      <>
        {editable ? <span className="nls-drag-cell">{id && !isLocked ? <DragHandle id={id} name={p?.name ?? 'player'} /> : null}</span> : null}
        <PosPill label={pill} tone={kind === 'starter' ? slot?.label : pill} />
        <PlayerCell
          tappable={editable}
          picked={isPicked}
          label={tapLabel({ name: p?.name, empty: !id, slot: pill, picked: isPicked, target: tapTarget, waiting: Boolean(picked) })}
          disabled={saving}
          onTap={() => onTap(tap)}
        >
          <strong>
            {p?.name ?? (id ? 'Unknown player' : 'Empty')}
            {kind !== 'starter' && p?.position ? <span className="nls-player-pos"> {p.position}</span> : null}
            <RankTag p={p} />
            <InjuryFlag status={p?.injuryStatus} />
          </strong>
          <small>{isPicked ? 'Selected · tap where he goes' : gameLine(p) || (id ? '—' : 'Open slot')}</small>
        </PlayerCell>
        <span className="nls-proj">{fmt1(p?.projectedPoints ?? null)}</span>
        <span className="nls-lrow-action">
          {editable ? (
            isLocked ? (
              <>
                <button type="button" className="nls-btn" data-size="sm" disabled aria-describedby={reasonId}>Locked</button>
                {reason ? <small className="nls-lock-reason" id={reasonId}>{reason}</small> : null}
              </>
            ) : kind === 'ir' || kind === 'taxi' ? (
              <button type="button" className="nls-btn" data-size="sm" disabled={saving} aria-label={`Move ${p?.name ?? 'player'} to bench`} onClick={() => doMove(id, { kind: 'bench' })}>
                To bench
              </button>
            ) : (
              <button
                type="button"
                className="nls-btn"
                data-size="sm"
                aria-expanded={moving}
                disabled={saving}
                onClick={() => setMove(moving ? null : kind === 'starter' ? { kind: 'starter', slotIndex: slotIndex ?? 0 } : { kind: 'bench', playerId: id })}
              >
                {moving ? 'Cancel' : 'Move'}
              </button>
            )
          ) : null}
        </span>
      </>
    )
    return (
      <li key={`${kind}-${slotIndex ?? id}`}>
        {kind === 'starter' && editable ? (
          <DropZone id={`slot:${slotIndex}`} className="nls-lrow" row moving={moving || isPicked} state={dragId ? dropState({ kind: 'starter', slotIndex: slotIndex ?? 0 }) : tapTarget}>
            {cells}
          </DropZone>
        ) : (
          <div className="nls-lrow" data-moving={moving || isPicked || undefined} data-dnd={editable || undefined} data-drop={tapTarget}>
            {cells}
          </div>
        )}
        {moving && lists && (kind === 'starter' || kind === 'bench') ? renderSwapper(kind, id, slotIndex) : null}
      </li>
    )
  }

  /** Bench / IR moves for the open row, below its swap list. Every one goes through `doMove`. */
  const renderSectionMoves = (id: string, kind: 'starter' | 'bench') => {
    if (!id) return null
    const name = players[id]?.name ?? 'this player'
    const bench = kind === 'starter' ? tryMove(id, { kind: 'bench' }) : null
    const ir = hasIr && canIr(id) ? tryMove(id, { kind: 'ir' }) : null
    const taxi = hasTaxi ? tryMove(id, { kind: 'taxi' }) : null
    if (!bench && !ir && !taxi) return null
    return (
      <div className="nls-swapper-actions">
        {bench ? (
          <button type="button" className="nls-btn" data-size="sm" disabled={!bench.ok || saving} title={bench.ok ? undefined : bench.reason} onClick={() => doMove(id, { kind: 'bench' })}>
            Move to bench <span className="nls-muted">· leave slot empty</span>
          </button>
        ) : null}
        {ir ? (
          <button type="button" className="nls-btn" data-size="sm" disabled={!ir.ok || saving} title={ir.ok ? `Move ${name} to injured reserve` : ir.reason} onClick={() => doMove(id, { kind: 'ir' })}>
            Move to IR
          </button>
        ) : null}
        {taxi ? (
          <button type="button" className="nls-btn" data-size="sm" disabled={!taxi.ok || saving} title={taxi.ok ? `Move ${name} to the taxi squad` : taxi.reason} onClick={() => doMove(id, { kind: 'taxi' })}>
            Move to taxi
          </button>
        ) : null}
      </div>
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
                const r = tryMove(c.id, { kind: 'starter', slotIndex })
                return (
                  <li key={c.id}>
                    <button type="button" disabled={!r?.ok || saving} onClick={() => doMove(c.id, { kind: 'starter', slotIndex })} title={r && !r.ok ? r.reason : undefined}>
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
          {renderSectionMoves(id, 'starter')}
        </div>
      )
    }
    const p = players[id]
    const targets = slots.map((s, i) => ({ s, i })).filter(({ i }) => tryMove(id, { kind: 'starter', slotIndex: i })?.ok)
    return (
      <div className="nls-swapper">
        <p className="nls-swapper-title"><span>Start {p?.name ?? 'this player'} in…</span></p>
        {targets.length ? (
          <ul>
            {targets.map(({ s, i }) => {
              const out = lists.starters[i] ? players[lists.starters[i]] : undefined
              return (
                <li key={i}>
                  <button type="button" disabled={saving} onClick={() => doMove(id, { kind: 'starter', slotIndex: i })}>
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
        {renderSectionMoves(id, 'bench')}
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
      {!data && offlineSnapshot ? <OfflineLineupSnapshotView snapshot={offlineSnapshot} /> : null}

      {data ? (
        <div className="nls-cols">
          <div className="nls nls-stack">
            {lockText ? (
              <div className="nls-lockbar" data-tone={editable ? undefined : 'locked'} role="status">
                {editable && nextLock ? <span className="nls-chip" data-tone="warn">Next lock {untilLabel(nextLock.getTime() - now.getTime())}</span> : null}
                <span>{lockText}</span>
              </div>
            ) : null}

            {tab === 'lineup' && daily ? (
              <div className="nls-daypick" data-testid="daily-day-picker">
                <Segmented
                  label="Lineup day"
                  value={viewDay?.day ?? ''}
                  onChange={setPickedDay}
                  options={daily.days.map((d) => ({ id: d.day, label: d.status === 'today' ? 'Today' : dayLabel(d.day) }))}
                />
                <p className="nls-muted">Week {daily.week} so far: <strong>{fmt1(daily.weekPoints)}</strong> pts from each day&apos;s starters.</p>
              </div>
            ) : null}

            {tab === 'lineup' && viewDay?.status === 'past' ? (
              renderPastDay(viewDay)
            ) : tab === 'lineup' ? (
              lists && slots.length ? (
                <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)} accessibility={{ announcements }}>
                  {byeStarters.length ? (
                    <p className="nls-error" role="alert" data-testid="lineup-bye-warning">
                      {byeStarters.length === 1
                        ? `${players[byeStarters[0]]?.name ?? 'A starter'} is on bye this week and will score 0. Swap him out before lock.`
                        : `${byeStarters.length} starters are on bye this week and will score 0: ${byeStarters.map((id) => players[id]?.name ?? 'Unknown').join(', ')}. Swap them out before lock.`}
                    </p>
                  ) : null}
                  {data?.rosterId && !daily ? <AutoBenchByeToggle leagueId={league.id} /> : null}
                  {data?.rosterId ? <WelcomeBackCard leagueId={league.id} /> : null}
                  {data?.rosterId ? <MyTeamAutomations leagueId={league.id} /> : null}
                  {data?.rosterId ? <AutomaticChangesLog leagueId={league.id} className="nls-card" onUndone={() => void load()} /> : null}
                  <section className="nls-card nls-card-flush" aria-label="Starters">
                    <h3 className="nls-label nls-card-head"><span>Starters</span><span>{startersProj != null ? `Proj ${fmt1(startersProj)}` : ''}</span></h3>
                    <ul className="nls-rows">{slots.map((s, i) => renderRow(lists.starters[i] ?? '', s, 'starter', i))}</ul>
                    {afFormProjected ? <p className="nls-muted" data-testid="lineup-af-projection-note">{AF_FORM_PROJECTION_EXPLAINER}{daily && viewDay ? ` Projections are for ${viewDay.status === 'today' ? 'today' : dayLabel(viewDay.day)}.` : ''}</p> : null}
                  </section>
                  <DropZone as="section" id="bench" className="nls-card nls-card-flush nls-dropzone" label="Bench" state={dragId ? dropState({ kind: 'bench' }) : tapState({ kind: 'section', section: 'bench' })}>
                    <h3 className="nls-label nls-card-head"><span>Bench</span>{dragId ? <span>Drop to bench</span> : sectionTap('bench', 'bench') ?? (benchCapacity != null ? <span>{lists.bench.filter(Boolean).length} / {benchCapacity}</span> : null)}</h3>
                    <ul className="nls-rows">
                      {lists.bench.filter(Boolean).map((id) => renderRow(id, null, 'bench'))}
                      {benchCapacity != null
                        ? Array.from({ length: Math.max(0, benchCapacity - lists.bench.filter(Boolean).length) }, (_, i) => (
                            <li key={`bn-open-${i}`} data-testid="bench-open-slot">
                              <div className="nls-lrow nls-lrow-empty"><PosPill label="BN" /><div className="nls-player"><strong>Empty</strong><small>Open slot</small></div></div>
                            </li>
                          ))
                        : !lists.bench.some(Boolean) ? (
                            <li><div className="nls-lrow nls-lrow-empty"><PosPill label="BN" /><span>No one on the bench.</span></div></li>
                          ) : null}
                    </ul>
                  </DropZone>
                  {hasIr ? (
                    <DropZone as="section" id="ir" className="nls-card nls-card-flush nls-dropzone" label="Injured reserve" state={dragId ? dropState({ kind: 'ir' }) : tapState({ kind: 'section', section: 'ir' })}>
                      <h3 className="nls-label nls-card-head"><span>Injured reserve</span>{sectionTap('ir', 'IR') ?? <span>{irCapacity != null ? `${lists.ir.filter(Boolean).length} / ${irCapacity}` : ''}</span>}</h3>
                      <ul className="nls-rows">
                        {lists.ir.filter(Boolean).map((id) => renderRow(id, null, 'ir'))}
                        {!lists.ir.some(Boolean) ? (
                          <li><div className="nls-lrow nls-lrow-empty"><PosPill label="IR" /><span>Empty — move an injured player here to free a roster spot.</span></div></li>
                        ) : null}
                      </ul>
                    </DropZone>
                  ) : null}
                  {hasTaxi ? (
                    <DropZone as="section" id="taxi" className="nls-card nls-card-flush nls-dropzone" label="Taxi squad" state={dragId ? dropState({ kind: 'taxi' }) : tapState({ kind: 'section', section: 'taxi' })}>
                      <h3 className="nls-label nls-card-head"><span>Taxi squad</span>{sectionTap('taxi', 'taxi') ?? <span>{taxiCapacity != null && taxiCapacity > 0 ? `${lists.taxi.filter(Boolean).length} / ${taxiCapacity}` : ''}</span>}</h3>
                      <ul className="nls-rows">
                        {lists.taxi.filter(Boolean).map((id) => renderRow(id, null, 'taxi'))}
                        {!lists.taxi.some(Boolean) ? (
                          <li><div className="nls-lrow nls-lrow-empty"><PosPill label="TX" /><span>Empty: stash a young player here and he stays off your active roster.</span></div></li>
                        ) : null}
                      </ul>
                    </DropZone>
                  ) : null}
                  <DragOverlay dropAnimation={null}>
                    {dragId ? <div className="nls-drag-overlay"><PosPill label={players[dragId]?.position ?? '—'} /><strong>{players[dragId]?.name ?? 'Player'}</strong></div> : null}
                  </DragOverlay>
                </DndContext>
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
                          <div className="nls-player"><strong>{p?.name ?? 'Unknown player'}<RankTag p={p} /><InjuryFlag status={p?.injuryStatus} /></strong><small>{gameLine(p) || '—'}</small></div>
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
