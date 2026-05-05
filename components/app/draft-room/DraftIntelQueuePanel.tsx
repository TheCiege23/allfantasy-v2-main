'use client'

import { useMemo } from 'react'
import type { DraftIntelQueueEntry } from '@/lib/draft-intelligence'
import { DraftRoomAccordion } from '@/components/app/draft-room/DraftRoomAccordion'

export interface DraftIntelQueuePanelProps {
  loading: boolean
  headline: string | null
  picksUntilUser: number | null
  onClock: boolean
  queue: DraftIntelQueueEntry[]
  canDraft: boolean
  onDraftTopChoice?: () => void
  presentationVariant?: 'default' | 'redraft_snake'
  /** One-tap queue add when the intel row resolves to the live pool */
  onAddIntelSuggestion?: (entry: DraftIntelQueueEntry) => void
}

function availabilityColor(probability: number) {
  if (probability >= 70) return 'rgba(103, 232, 249, 0.9)'
  if (probability >= 40) return 'rgba(251, 191, 36, 0.9)'
  return 'rgba(248, 113, 113, 0.9)'
}

export function DraftIntelQueuePanel({
  loading,
  headline,
  picksUntilUser,
  onClock,
  queue,
  canDraft,
  onDraftTopChoice,
  presentationVariant = 'default',
  onAddIntelSuggestion,
}: DraftIntelQueuePanelProps) {
  const rs = presentationVariant === 'redraft_snake'
  const topAvailable = queue.find((entry) => !entry.isTaken) ?? null

  const collapsedSummary = useMemo(() => {
    const bits: string[] = []
    if (topAvailable?.playerName) bits.push(topAvailable.playerName)
    else if (headline?.trim()) bits.push(headline.trim())
    if (onClock) bits.push('You are on the clock')
    else if (picksUntilUser != null) bits.push(`${picksUntilUser} picks to you`)
    if (bits.length === 0) bits.push(loading ? 'Building lookahead…' : 'Waiting for intel window')
    return bits.join(' · ')
  }, [topAvailable?.playerName, headline, onClock, picksUntilUser, loading])

  const inner = (
    <>
      <div className="mt-1 space-y-2">
        {queue.length === 0 ? (
          <div
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-sm text-slate-300"
            data-testid="draft-intel-empty"
          >
            {loading ? 'Refreshing draft intel…' : 'Chimmy will queue picks when you are five selections out.'}
          </div>
        ) : (
          queue.map((entry) => (
            <div
              key={`${entry.rank}-${entry.playerName}`}
              className="rounded-xl border border-white/10 bg-[linear-gradient(180deg,rgba(12,24,45,0.7),rgba(6,14,28,0.9))] px-3 py-3 transition-all"
              data-testid={`draft-intel-entry-${entry.rank}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                      #{entry.rank}
                    </span>
                    <span
                      className={`truncate text-sm font-semibold ${entry.isTaken ? 'line-through opacity-50' : 'text-white'}`}
                    >
                      {entry.playerName}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">
                      {entry.position}
                      {entry.team ? ` · ${entry.team}` : ''}
                    </span>
                    {!entry.isTaken ? (
                      <span className="rounded border border-cyan-300/30 bg-cyan-500/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-100">
                        Assistant guidance
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={`mt-1 text-[12px] ${entry.isTaken ? 'text-slate-500' : 'text-slate-300'}`}
                    data-testid={`draft-intel-entry-reason-${entry.rank}`}
                  >
                    {entry.reason}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`text-[11px] font-semibold ${entry.isTaken ? 'text-rose-300' : 'text-sky-300'}`}
                    data-testid={`draft-intel-entry-availability-${entry.rank}`}
                  >
                    {entry.isTaken ? 'Taken' : `${entry.availabilityProbability}%`}
                  </span>
                  {!entry.isTaken ? <span className="text-[9px] text-white/45">availability signal</span> : null}
                  {!entry.isTaken && onAddIntelSuggestion ? (
                    <button
                      type="button"
                      onClick={() => onAddIntelSuggestion(entry)}
                      className="rounded-md border border-cyan-400/30 bg-cyan-500/12 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-500/22"
                      data-testid={`draft-intel-add-queue-${entry.rank}`}
                    >
                      + Queue
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${entry.isTaken ? 100 : entry.availabilityProbability}%`,
                    background: entry.isTaken ? 'rgba(248,113,113,0.9)' : availabilityColor(entry.availabilityProbability),
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {topAvailable && onDraftTopChoice ? (
        <button
          type="button"
          onClick={onDraftTopChoice}
          disabled={!canDraft}
          className="mt-4 w-full rounded-xl px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: 'rgba(56, 189, 248, 0.92)',
            color: '#04101d',
          }}
          data-testid="draft-intel-draft-top-choice"
        >
          Draft {topAvailable.playerName}
        </button>
      ) : null}
      <p className="mt-2 text-[10px] text-white/45">
        AI queue is advisory. Use your board context and league strategy before committing a pick.
      </p>
    </>
  )

  if (rs) {
    return (
      <div className={onClock ? 'animate-pulse' : ''} data-testid="draft-intel-queue-panel">
        <DraftRoomAccordion
          variant="redraft_snake"
          persistenceKey="af:draft:redraft:intel-queue"
          defaultOpen={false}
          title="Draft intelligence"
          collapsedSubtitle={collapsedSummary}
          testId="draft-intel-accordion"
        >
          <div className="rounded-xl border border-cyan-400/20 bg-black/20 p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-white/10 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/75">AI queue · lookahead</p>
                <p className="mt-1 text-sm font-semibold text-white" data-testid="draft-intel-headline">
                  {headline || (loading ? 'Chimmy is building your queue…' : 'No active lookahead window yet.')}
                </p>
                <p className="mt-1 text-[10px] text-white/45">Assistant guidance, not deterministic pick lock.</p>
              </div>
              <div
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium"
                style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(191,219,254,0.95)' }}
                data-testid="draft-intel-picks-until-user"
              >
                {onClock
                  ? "You're on the clock"
                  : picksUntilUser == null
                    ? 'Waiting'
                    : `${picksUntilUser} picks away`}
              </div>
            </div>
            {inner}
          </div>
        </DraftRoomAccordion>
      </div>
    )
  }

  return (
    <section
      className={`rounded-2xl border p-4 ${onClock ? 'animate-pulse' : ''}`}
      style={{
        borderColor: onClock ? 'rgba(103, 232, 249, 0.85)' : 'rgba(255,255,255,0.12)',
        background: 'linear-gradient(180deg, rgba(4,9,21,0.96), rgba(10,18,40,0.92))',
        boxShadow: onClock ? '0 0 0 1px rgba(103,232,249,0.2), 0 0 28px rgba(14,165,233,0.22)' : 'none',
      }}
      data-testid="draft-intel-queue-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300/80">
            AI Queue
          </p>
          <p className="mt-1 text-sm font-semibold text-white" data-testid="draft-intel-headline">
            {headline || (loading ? 'Chimmy is building your queue…' : 'No active lookahead window yet.')}
          </p>
          <p className="mt-1 text-[10px] text-white/45">Assistant guidance, not deterministic pick lock.</p>
        </div>
        <div
          className="rounded-full border px-2.5 py-1 text-[11px] font-medium"
          style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(191,219,254,0.95)' }}
          data-testid="draft-intel-picks-until-user"
        >
          {onClock
            ? "You're on the clock"
            : picksUntilUser == null
              ? 'Waiting'
              : `${picksUntilUser} picks away`}
        </div>
      </div>
      {inner}
    </section>
  )
}
