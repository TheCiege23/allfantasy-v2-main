/**
 * Keeper cost, shown BESIDE the grade in a keeper league — never part of the letter (Guap,
 * 2026-09-28). The route computes it (`lib/keeper/tradeKeeperCosts.ts`); this only renders it.
 *
 * ⚠ CLIENT-SAFE ON PURPOSE: no import from the server loader, not even a type, so the page cannot
 * pull `server-only` into the client bundle through this file.
 */

/** The route's `keeperCosts` field, as the page receives it. */
export type KeeperCostsPayload =
  | { applies: false }
  | { applies: true; lines?: Array<{ name: string; sentence: string }>; notOnFile?: string[]; note?: string | null }

export type KeeperCostsView = {
  lines: Array<{ name: string; sentence: string }>
  notOnFile: string[]
  note: string | null
}

/** The keeper block, or null when this is not a keeper league (or it has nothing to say). */
export function keeperCostsViewFor(payload: { keeperCosts?: KeeperCostsPayload | null }): KeeperCostsView | null {
  const k = payload.keeperCosts
  if (!k || !k.applies) return null
  const lines = (k.lines ?? []).filter((l) => l && l.name && l.sentence)
  const notOnFile = (k.notOnFile ?? []).filter(Boolean)
  const note = k.note ?? null
  if (lines.length === 0 && !note) return null
  return { lines, notOnFile, note }
}

export function KeeperCostNote({ view }: { view: KeeperCostsView }) {
  return (
    <div data-testid="keeper-costs" className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Keeper cost</div>
      <p className="mt-1 text-[11px] text-white/40">Shown beside the grade — it does not change the letter.</p>
      {view.note ? <p className="mt-3 text-[12px] text-white/60">{view.note}</p> : null}
      {view.lines.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {view.lines.map((l) => (
            <li key={l.name} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[12px] text-white/75">
              {l.sentence}
            </li>
          ))}
        </ul>
      ) : null}
      {view.lines.length > 0 && view.notOnFile.length > 0 ? (
        <p className="mt-3 text-[11px] text-white/40">
          No keeper cost on file for {view.notOnFile.join(', ')} — not in this season&rsquo;s draft.
        </p>
      ) : null}
    </div>
  )
}
