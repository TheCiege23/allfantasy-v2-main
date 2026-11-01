'use client'

import { Coins } from 'lucide-react'

export function FutureCapitalPanel({
  summary,
  picksByYear,
}: {
  summary: string
  picksByYear: Record<string, string[]>
}) {
  const years = Object.keys(picksByYear).sort()

  return (
    <section className="rounded-2xl border rdt-warn-line p-5 md:p-6">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 rdt-warn" aria-hidden />
        <h2 className="text-sm font-bold rdt-text">Future picks & capital</h2>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed rdt-warn">{summary}</p>
      {years.length === 0 ? (
        <p className="mt-4 text-[12px] rdt-faint">No draft picks parsed yet — re-sync imports if picks should show.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {years.map((y) => (
            <div key={y} className="rounded-xl border rdt-line rdt-well p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide rdt-faint">{y}</p>
              <ul className="mt-2 space-y-1 text-[12px] rdt-muted">
                {picksByYear[y]!.map((line, i) => (
                  <li key={i} className="leading-snug">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
