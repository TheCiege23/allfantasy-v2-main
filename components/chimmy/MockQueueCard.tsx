'use client'

import type { MockQueueProposal } from '@/lib/mock-draft/mockChimmyBoard'

export type MockQueueCardState = 'pending' | 'applied' | 'stale' | 'dismissed'

/**
 * A queue change Chimmy proposed in a mock draft — the /mock-draft room and the league mock room
 * (/draft/mock/[id]) both render this. Nothing changes until Confirm, and it never makes a pick.
 */
export function MockQueueCard({
  proposal,
  state = 'pending',
  note,
  onResolve,
}: {
  proposal: MockQueueProposal
  state?: MockQueueCardState
  note?: string
  onResolve: (action: 'confirm' | 'dismiss') => void
}) {
  const label = (p: { name: string; position: string }) => `${p.name}${p.position ? ` (${p.position})` : ''}`
  return (
    <div className="mt-2 rounded-lg border border-cyan-300/25 bg-black/25 p-2 text-white/80" data-testid="mock-draft-queue-card">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">Queue change</div>
      {proposal.add.length > 0 ? <div className="mt-1">Add to the {proposal.addAt}: {proposal.add.map(label).join(', ')}</div> : null}
      {proposal.remove.length > 0 ? <div className="mt-1">Take off: {proposal.remove.map(label).join(', ')}</div> : null}
      {state === 'pending' ? (
        <>
          {proposal.resultingTop.length > 0 ? <div className="mt-1 text-white/45">Your queue will start: {proposal.resultingTop.join(', ')}</div> : null}
          <div className="mt-1 text-white/45">Nothing changes until you tap Confirm. Chimmy never makes a pick.</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onResolve('confirm')}
              className="min-h-[36px] rounded-lg bg-cyan-400 px-3 py-1 font-bold text-[#04121c] hover:bg-cyan-300"
              data-testid="mock-draft-queue-confirm"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => onResolve('dismiss')}
              className="min-h-[36px] rounded-lg bg-white/10 px-3 py-1 text-white/70 hover:text-white"
              data-testid="mock-draft-queue-dismiss"
            >
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <div className="mt-1 font-semibold" data-testid="mock-draft-queue-card-state">
          {state === 'applied'
            ? 'Done — your queue is updated.'
            : state === 'stale'
              ? 'Your queue changed after this card was made, so nothing was applied. Ask Chimmy again.'
              : 'Dismissed — nothing changed.'}
          {note ? <span className="ml-1 font-normal text-white/50">{note}</span> : null}
        </div>
      )}
    </div>
  )
}
