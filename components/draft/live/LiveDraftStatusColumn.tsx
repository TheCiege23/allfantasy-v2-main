'use client'

import type { DraftPickSnapshot, DraftSessionSnapshot, QueueEntry } from '@/lib/live-draft-engine/types'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { getUpcomingPickOwners } from '@/lib/live-draft-engine/DraftOrderService'
import type { OnClockTeamSpotlight } from './OnTheClockPanel'
import { DraftQueue } from './DraftQueue'
import { DraftTeamSidebar } from './DraftTeamSidebar'
import { DraftTimer } from './DraftTimer'
import { OnTheClockPanel } from './OnTheClockPanel'
import { PickHistory } from './PickHistory'
import { AvailablePlayerPool } from './AvailablePlayerPool'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'

export type LiveDraftStatusColumnProps = {
  session: DraftSessionSnapshot
  queueEntries: QueueEntry[]
  leagueId: string
  /** League sport (for pick history / player headshots) */
  sport?: string
  isCommissioner: boolean
  onSessionUpdated?: () => void
  /** First rows from the normalized pool for quick-add (optional). */
  poolPreview?: NormalizedDraftEntry[] | null
  onPoolPreviewSelect?: (playerId: string) => void
  poolSelectDisabled?: boolean
  /** Hide duplicate timer when parent already shows auction spotlight, etc. */
  showTimer?: boolean
  /**
   * When true (live snake), hide the full scrollable draft-order list — the board + top bar
   * already show order. Linear and auction keep the list for orientation.
   */
  hideFullDraftOrderList?: boolean
  /** Logged-in user’s roster id — enables “My roster” summary when set. */
  viewerRosterId?: string | null
  /** Picks for the viewer’s roster (pre-filtered). */
  viewerRosterPicks?: DraftPickSnapshot[]
  /** League chrome for the roster currently on the clock (snake spotlight). */
  onClockSpotlight?: OnClockTeamSpotlight | null
}

function pickIndexInRound(overall: number, teamCount: number): number {
  if (teamCount < 1) return 1
  return ((overall - 1) % teamCount) + 1
}

const currentPickMetaShell =
  'rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.12] via-[#0a1228]/95 to-[#070d18]/95 px-3 py-2.5 text-center shadow-[0_8px_32px_rgba(34,211,238,0.12)] ring-1 ring-cyan-400/10'

function CurrentPickMeta({ session }: { session: DraftSessionSnapshot }) {
  if (session.status === 'completed') return null

  const teamCount = Math.max(1, session.teamCount)

  if (session.status === 'pre_draft') {
    const order = session.slotOrder ?? []
    const first = order[0]
    const firstLabel =
      first?.displayName?.trim() ? first.displayName : first ? `Slot ${first.slot}` : '—'
    return (
      <div className={currentPickMetaShell} data-testid="draft-live-current-pick-meta">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">Round and pick</p>
        <p className="mt-1.5 text-[13px] font-medium leading-snug text-white/90">
          Round <span className="font-bold text-cyan-100">1</span>
          <span className="text-white/35"> · </span>
          Pick <span className="font-bold text-cyan-100">1</span>
          <span className="text-white/45"> / {teamCount}</span>
        </p>
        <p className="mt-1 font-mono text-[11px] font-medium text-white/50">Pick 1.01</p>
        <p className="mt-2 text-[11px] font-medium leading-snug text-amber-100/90">Draft has not started.</p>
        <p className="mt-1 text-[11px] text-white/60">
          First up: <span className="font-medium text-white/85">{firstLabel}</span>
        </p>
        <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Waiting to start</p>
      </div>
    )
  }

  const cp = session.currentPick
  if (!cp) {
    return (
      <div className={currentPickMetaShell} data-testid="draft-live-current-pick-meta">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">Round and pick</p>
        <p className="mt-3 text-[12px] font-medium text-white/55">Syncing round and pick…</p>
        <p className="mt-1 text-[11px] text-white/40">Same layout when the board reconnects.</p>
      </div>
    )
  }

  const pir = pickIndexInRound(cp.overall, teamCount)
  return (
    <div className={currentPickMetaShell} data-testid="draft-live-current-pick-meta">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">Round and pick</p>
      <p className="mt-1.5 text-[13px] font-medium leading-snug text-white/90">
        Round <span className="font-bold text-cyan-100">{cp.round}</span>
        <span className="text-white/35"> · </span>
        Pick <span className="font-bold text-cyan-100">{pir}</span>
        <span className="text-white/45"> / {teamCount}</span>
      </p>
      <p className="mt-1 font-mono text-[11px] font-medium text-white/50">Overall #{cp.overall}</p>
    </div>
  )
}

const upcomingOnDeckOuter =
  'overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-[#0c1528] to-[#070d18]/98 shadow-[0_12px_40px_rgba(0,0,0,0.35)]'

function UpcomingOnDeck({ session }: { session: DraftSessionSnapshot }) {
  if (session.status === 'completed') return null

  const teamCount = Math.max(1, session.teamCount)
  const totalPicks = Math.max(1, session.rounds * teamCount)

  const listHeader = (label: string, pulse: boolean) => (
    <div className="border-b border-white/[0.06] bg-black/20 px-3 py-2">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">
        {pulse ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/40 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-cyan-400/50" aria-hidden />
        )}
        {label}
      </p>
    </div>
  )

  if (session.status === 'pre_draft') {
    const upcoming = getUpcomingPickOwners(1, 4, teamCount, session.draftType, session.thirdRoundReversal, session.slotOrder, totalPicks)
    return (
      <div className={upcomingOnDeckOuter} data-testid="draft-upcoming-on-deck">
        {listHeader('Opening order', false)}
        {upcoming.length === 0 ? (
          <p className="px-3 py-3 text-center text-[12px] text-white/45">Draft order appears here once slots sync.</p>
        ) : (
          <ol className="space-y-0.5 px-2.5 py-2">
            {upcoming.map((u, i) => (
              <li
                key={`${u.rosterId}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-[12px] text-white/90 transition duration-150 hover:bg-white/[0.04]"
              >
                <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-bold text-cyan-100">T{u.slot}</span>
                <span className="min-w-0 flex-1 truncate text-right font-medium text-white/82">{u.displayName}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  const cp = session.currentPick
  if (!cp) return null

  const nextOverall = cp.overall + 1
  if (nextOverall > totalPicks) {
    return (
      <div
        className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] to-[#070d18]/95 px-3 py-2.5 text-center text-[12px] font-medium text-amber-100/80 shadow-[0_6px_24px_rgba(245,158,11,0.1)]"
        data-testid="draft-upcoming-on-deck"
      >
        Final pick approaching
      </div>
    )
  }
  const upcoming = getUpcomingPickOwners(
    nextOverall,
    4,
    teamCount,
    session.draftType,
    session.thirdRoundReversal,
    session.slotOrder,
    totalPicks,
  )
  return (
    <div className={upcomingOnDeckOuter} data-testid="draft-upcoming-on-deck">
      {listHeader('Next up', true)}
      {upcoming.length === 0 ? (
        <p className="px-3 py-3 text-center text-[12px] text-white/45">Order syncing…</p>
      ) : (
        <ol className="space-y-0.5 px-2.5 py-2">
          {upcoming.map((u, i) => (
            <li
              key={`${u.rosterId}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-[12px] text-white/90 transition duration-150 hover:bg-white/[0.04]"
            >
              <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-bold text-cyan-100">T{u.slot}</span>
              <span className="min-w-0 flex-1 truncate text-right font-medium text-white/82">{u.displayName}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function MyRosterSidebarSummary({
  picks,
  rounds,
  viewerRosterId,
}: {
  picks: DraftPickSnapshot[]
  rounds: number
  viewerRosterId: string | null
}) {
  const recent = picks.slice(-4).reverse()
  return (
    <div
      className="rounded-2xl border border-violet-400/15 bg-gradient-to-b from-[#0c1528] to-[#070d18]/95 shadow-[0_10px_36px_rgba(0,0,0,0.35)]"
      data-testid="draft-sidebar-my-roster"
    >
      <div className="border-b border-white/[0.06] bg-black/15 px-3 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">My roster</p>
        {!viewerRosterId ? (
          <p className="mt-1 text-[11px] font-medium leading-snug text-amber-100/85">
            Link your team in this league to track picks here.
          </p>
        ) : (
          <p className="mt-0.5 text-[13px] font-semibold text-cyan-100/95">
            {picks.length} / {rounds} picks
          </p>
        )}
      </div>
      {!viewerRosterId ? (
        <p className="px-3 py-4 text-center text-[12px] text-white/45">Claim your seat from the league page if you haven&apos;t yet.</p>
      ) : recent.length === 0 ? (
        <p className="px-3 py-4 text-center text-[12px] text-white/40">No picks yet — slots fill as you draft.</p>
      ) : (
        <ul className="max-h-[200px] divide-y divide-white/[0.05] overflow-y-auto">
          {recent.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-2 px-3 py-2.5 text-[11px] transition duration-150 hover:bg-white/[0.03]"
            >
              <span className="shrink-0 font-mono text-cyan-300/70">{p.pickLabel}</span>
              <span className="min-w-0 flex-1 text-right">
                <span className="font-medium text-white/90">{p.playerName}</span>
                <span className="text-white/45">
                  {' '}
                  {p.position}
                  {p.team ? ` · ${p.team}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LiveDraftStatusColumn({
  session,
  queueEntries,
  leagueId,
  sport = DEFAULT_SPORT,
  isCommissioner: _isCommissioner,
  onSessionUpdated: _onSessionUpdated,
  poolPreview,
  onPoolPreviewSelect,
  poolSelectDisabled,
  showTimer = true,
  hideFullDraftOrderList = false,
  viewerRosterId = null,
  viewerRosterPicks = [],
  onClockSpotlight = null,
}: LiveDraftStatusColumnProps) {
  const onClockId = session.currentPick?.rosterId ?? null
  const poolRows =
    poolPreview?.slice(0, 40).map((e) => ({
      id: e.display?.playerId ?? e.playerId ?? e.name,
      name: e.name,
      position: e.position,
      team: e.team,
    })) ?? []

  const showSnakeCompact = hideFullDraftOrderList && session.draftType === 'snake'

  return (
    <div
      className="flex flex-col gap-2.5 lg:min-w-[260px] lg:max-w-[min(340px,32vw)]"
      data-testid="draft-live-status-column"
    >
      {showSnakeCompact ? <CurrentPickMeta session={session} /> : null}
      <OnTheClockPanel status={session.status} currentPick={session.currentPick} spotlight={onClockSpotlight} />
      {showTimer ? <DraftTimer timer={session.timer} /> : null}

      {showSnakeCompact ? <UpcomingOnDeck session={session} /> : null}

      {!showSnakeCompact ? (
        <DraftTeamSidebar slotOrder={session.slotOrder} onClockRosterId={onClockId} />
      ) : null}

      <PickHistory picks={session.picks ?? []} max={20} sport={sport} />

      {showSnakeCompact ? (
        <MyRosterSidebarSummary picks={viewerRosterPicks} rounds={session.rounds} viewerRosterId={viewerRosterId} />
      ) : null}

      <DraftQueue entries={queueEntries} />
      {poolRows.length > 0 ? (
        <AvailablePlayerPool
          players={poolRows}
          onSelect={onPoolPreviewSelect}
          disabled={poolSelectDisabled}
        />
      ) : null}
    </div>
  )
}
