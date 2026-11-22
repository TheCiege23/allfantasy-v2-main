'use client'

import '@/components/core-app/af-war-chest.css'
import type { WarChest as WarChestView } from '@/lib/core-app/warRoomWarChest'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomWarChestMessages } from '@/lib/core-app/messages/warRoomWarChest'

/**
 * The war chest — War Room phase 6, for the league on screen (rules in lib/core-app/warRoomWarChest.ts).
 * Free. A league that does not run FAAB shows nothing here: there is no money to count.
 */

const money = (n: number) => `$${n}`

export function WarChest({ view }: { view: WarChestView }) {
  const m = useMessages(warRoomWarChestMessages)
  if (view.kind === 'none' && view.why === 'not_faab') return null

  return (
    <section className="af-wch" id="war-chest" aria-labelledby="af-wch-heading">
      <h2 id="af-wch-heading" className="af-label af-wch-heading">
        {m.heading}
      </h2>

      {view.kind === 'none' ? (
        <p className="af-wch-note">{m.notRead}</p>
      ) : (
        <>
          <p className="af-wch-lead">
            {view.you != null && view.rank != null
              ? m.you(money(view.you), view.budget == null ? null : money(view.budget), view.rank, view.known)
              : m.youUnknown}
          </p>
          {view.useIt && view.weeksRemaining != null ? (
            <p className="af-wch-callout">{m.useIt(view.weeksRemaining)}</p>
          ) : null}
          <ol className="af-wch-list">
            {view.rows.map((r) => {
              // Bars are against the league's budget when it is recorded, else against the largest balance.
              const scale = view.budget ?? Math.max(1, ...view.rows.map((x) => x.remaining ?? 0))
              const share = r.remaining == null ? 0 : Math.max(0, Math.min(100, (r.remaining / scale) * 100))
              return (
                <li key={r.rosterId} className="af-wch-row" data-you={r.isYou ? 'true' : undefined}>
                  <span className="af-wch-name">{r.isYou ? m.youLabel : (r.name ?? '—')}</span>
                  <span className="af-wch-amount" data-unknown={r.remaining == null ? 'true' : undefined}>
                    {r.remaining == null ? m.unknown : money(r.remaining)}
                  </span>
                  <span className="af-wch-bar" aria-hidden="true">
                    <span className="af-wch-bar-fill" style={{ width: `${share}%` }} />
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="af-wch-note">{m.basis}</p>
        </>
      )}
    </section>
  )
}

export default WarChest
