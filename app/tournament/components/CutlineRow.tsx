'use client'

export function CutlineRow({ topN }: { topN: number }) {
  return (
    <tr className="pointer-events-none">
      <td colSpan={99} className="px-2 py-2">
        <div className="flex items-center gap-2 border-t border-b border-dashed border-[var(--tournament-gold)]/55 bg-yellow-500/5 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-[var(--tournament-gold)]">
          <span className="flex-1">━━</span>
          <span>QUALIFICATION LINE — Top {topN} advance</span>
          <span className="flex-1">━━</span>
        </div>
      </td>
    </tr>
  )
}
