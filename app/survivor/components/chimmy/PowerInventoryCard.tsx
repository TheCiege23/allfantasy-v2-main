export function PowerInventoryCard({
  powers,
}: {
  powers: { name: string; phase: string; window: string; eligible: boolean; used?: boolean }[]
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">🔮 Power inventory</p>
      <ul className="mt-3 space-y-2">
        {powers.map((p) => (
          <li
            key={p.name}
            className={`flex flex-col rounded-lg border border-white/[0.06] px-3 py-2 text-[12px] ${
              p.used ? 'opacity-40 line-through' : ''
            }`}
          >
            <span className="font-semibold text-white">{p.name}</span>
            <span className="text-[11px] text-white/45">
              {p.phase} · {p.window}
            </span>
            {p.eligible && !p.used ? (
              <button type="button" className="mt-2 min-h-[40px] rounded-md bg-violet-500/20 text-[11px] font-bold text-violet-100">
                Play
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
