'use client'

export function BubbleLine({ nextN }: { nextN: number }) {
  return (
    <tr className="pointer-events-none">
      <td colSpan={99} className="px-2 py-2">
        <div className="flex items-center gap-2 border-t border-b border-dashed border-[var(--tournament-bubble)]/55 bg-amber-500/5 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-amber-200">
          <span className="flex-1">━━</span>
          <span>BUBBLE LINE — Next {nextN} earn last chance</span>
          <span className="flex-1">━━</span>
        </div>
      </td>
    </tr>
  )
}
