'use client'

import React from 'react'

export type PostDraftReportModalProps = {
  open: boolean
  onClose: () => void
  leagueId: string
}

export function PostDraftReportModal({ open, onClose, leagueId }: PostDraftReportModalProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="war-room-post-draft-report-modal"
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0a1228] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Post-draft</p>
            <h2 className="text-sm font-semibold text-white">Roster report</h2>
            <p className="mt-1 text-[11px] text-white/50">
              <code className="text-cyan-200/80">POST /api/war-room/post-draft-report</code> reads{' '}
              <code className="text-white/50">draft_picks</code> · {leagueId.slice(0, 8)}…
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5"
          >
            Close
          </button>
        </div>
        <a
          href={`/trade-evaluator?leagueId=${encodeURIComponent(leagueId)}`}
          className="mt-3 inline-flex text-[11px] text-cyan-300 underline"
        >
          Open Trade Finder
        </a>
      </div>
    </div>
  )
}
