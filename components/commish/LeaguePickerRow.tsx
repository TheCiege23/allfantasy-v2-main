'use client'

/**
 * One selectable league in the 10b "@everyone" picker.
 *
 * Imported leagues render dashed, dimmed and uncheckable with a READ-ONLY tag rather than being
 * hidden (handoff build rule 1). Hiding them would read as "AllFantasy forgot my league"; showing
 * them read-only answers the question the commissioner is actually asking — why can't I broadcast
 * there? Because that league's chat lives on Sleeper/ESPN/Yahoo and we never write to it.
 */

export type PickerLeague = {
  id: string
  name: string
  subtitle: string
  memberCount: number
  /** AllFantasy-hosted. False for imported leagues, which cannot receive a broadcast. */
  isNative: boolean
}

function badge(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '—'
  )
}

export default function LeaguePickerRow({
  league,
  checked,
  onToggle,
}: {
  league: PickerLeague
  checked: boolean
  onToggle: (id: string) => void
}) {
  const disabled = !league.isNative

  if (disabled) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-dashed border-white/15 px-3 py-3 opacity-50"
        data-testid={`broadcast-league-${league.id}`}
        data-disabled="true"
      >
        <span className="h-5 w-5 shrink-0 rounded-md border border-white/20" aria-hidden />
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] font-mono text-[11px] font-bold text-white/60">
          {badge(league.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold text-white/70">{league.name}</span>
          <span className="block truncate text-xs text-white/45">
            {league.subtitle} — chat lives there
          </span>
        </span>
        <span className="shrink-0 rounded-md border border-white/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-white/45">
          Read-only
        </span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onToggle(league.id)}
      aria-pressed={checked}
      data-testid={`broadcast-league-${league.id}`}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
        checked
          ? 'border-cyan-400/60 bg-cyan-400/[0.08]'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
    >
      <span
        aria-hidden
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] font-bold ${
          checked ? 'border-cyan-400 bg-cyan-400 text-[#04121a]' : 'border-white/25'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-bold ${
          checked ? 'bg-cyan-400/15 text-cyan-300' : 'bg-white/[0.07] text-white/60'
        }`}
      >
        {badge(league.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-white">{league.name}</span>
        <span className="block truncate text-xs text-white/50">
          {league.subtitle} · {league.memberCount}{' '}
          {league.memberCount === 1 ? 'member' : 'members'}
        </span>
      </span>
      {checked ? (
        <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-cyan-300">
          {league.memberCount} notified
        </span>
      ) : null}
    </button>
  )
}
