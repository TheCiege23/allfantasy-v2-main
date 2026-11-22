'use client'

import { useState } from 'react'

/** A private @chimmy answer the server marked as shareable (never a Survivor vote or power). */
export function isShareableChimmyAnswer(meta: Record<string, unknown> | null | undefined): boolean {
  return Boolean(meta && meta.chimmyPrivateReply === true && meta.chimmyShareable === true)
}

/**
 * "Share with league" under a private @chimmy answer (2026-11-16, owner's decision). Answers stay
 * private by default; this posts the question and the answer publicly, credited to the asker, only on
 * their tap. Used by the league conversation (ChatMessageList) and the dashboard chat panel.
 */
export default function ShareChimmyAnswerButton({ shared, onShare }: { shared: boolean; onShare: () => Promise<boolean> }) {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'failed'>('idle')
  if (shared) {
    return (
      <p className="mt-1 text-[11px] text-white/45" data-testid="chimmy-share-done">
        Shared with your league
      </p>
    )
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="min-h-[32px] rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[12px] font-semibold text-white/80 hover:bg-white/[0.12] disabled:opacity-50"
        disabled={phase === 'busy'}
        data-testid="chimmy-share-button"
        onClick={async (e) => {
          e.stopPropagation()
          setPhase('busy')
          const ok = await onShare().catch(() => false)
          setPhase(ok ? 'idle' : 'failed')
        }}
      >
        {phase === 'busy' ? 'Sharing…' : 'Share with league'}
      </button>
      <span className="text-[11px] text-white/40" data-testid="chimmy-share-note">
        {phase === 'failed' ? 'Could not share it. Try again.' : 'Only you see this until you share it.'}
      </span>
    </div>
  )
}

/** POSTs the share. Resolves true when it was posted (or had already been). */
export async function postChimmyShare(leagueId: string, messageId: string): Promise<boolean> {
  const res = await fetch('/api/league/chat/chimmy-share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leagueId, messageId }),
  })
  return res.ok
}
