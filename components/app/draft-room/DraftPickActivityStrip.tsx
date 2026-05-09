'use client'

import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'

export type DraftPickActivityStripProps = {
  picks: DraftPickSnapshot[]
  slotOrder: Array<{ rosterId: string; displayName: string }>
  limit?: number
  presentationVariant?: 'default' | 'redraft_snake'
}

export function DraftPickActivityStrip({
  picks,
  slotOrder,
  limit = 14,
  presentationVariant = 'default',
}: DraftPickActivityStripProps) {
  const rs = presentationVariant === 'redraft_snake'
  const nameByRoster = new Map(slotOrder.map((s) => [s.rosterId, s.displayName]))
  const recent = picks.slice(-limit).reverse()

  return (
    <div
      className={`flex h-full min-h-[72px] flex-col ${rs ? 'bg-[linear-gradient(180deg,rgba(8,18,36,0.98),rgba(4,9,17,1))] shadow-[inset_0_1px_0_rgba(34,211,238,0.06)]' : 'bg-[#050c1d]/95'}`}
      data-testid="draft-activity-strip"
    >
      <div className={`shrink-0 border-b px-2 py-1.5 ${rs ? 'border-cyan-500/15' : 'border-white/8'}`}>
        <p className={`text-[9px] font-semibold uppercase tracking-wider ${rs ? 'text-cyan-200/55' : 'text-white/45'}`}>
          Live activity
        </p>
      </div>
      <div className="flex-1 overflow-x-auto overflow-y-auto px-2 py-1.5">
        <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {recent.length === 0 ? (
            <li className="text-[10px] text-white/35">No picks yet.</li>
          ) : (
            recent.map((p, idx) => (
              <li
                key={p.id}
                className={`draft-live-activity-item shrink-0 rounded-lg border px-2 py-1.5 text-[10px] md:shrink md:px-2 ${
                  idx === 0
                    ? 'draft-live-activity-latest border-amber-400/30 bg-[linear-gradient(135deg,rgba(246,196,69,0.1),rgba(10,18,40,0.95))] shadow-[0_4px_20px_rgba(246,196,69,0.12)]'
                    : rs
                      ? 'border-white/12 bg-[linear-gradient(135deg,rgba(15,23,42,0.9),rgba(8,16,32,0.95))] shadow-[0_4px_16px_rgba(0,0,0,0.25)]'
                      : 'border-white/10 bg-[#0a1228]'
                }`}
                style={{ animationDelay: `${Math.min(idx, 6) * 28}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-white/90 truncate">{p.playerName}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {idx === 0 ? (
                      <span className="rounded border border-amber-400/40 bg-amber-500/15 px-1 py-px text-[8px] font-bold uppercase tracking-[0.1em] text-amber-200">
                        Latest
                      </span>
                    ) : null}
                    <span className="tabular-nums text-cyan-200/80">#{p.overall}</span>
                  </div>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-1 text-[9px] text-white/45">
                  <span>
                    {p.position}
                    {p.team ? ` · ${p.team}` : ''}
                  </span>
                  <span className="truncate max-w-[100px]" title={nameByRoster.get(p.rosterId) ?? ''}>
                    {nameByRoster.get(p.rosterId) ?? 'Team'}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
