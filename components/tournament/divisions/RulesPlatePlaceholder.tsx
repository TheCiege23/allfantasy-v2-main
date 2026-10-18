/**
 * ⚠ PLACEHOLDER — the scoring/roster label plates ("HALF" · "Standard · 9 start") are
 * being built on `claude/scoring-roster-labels`. This is the ONE call site in the
 * divisions screens: swap this component for that branch's plate (fed by the
 * tournament's saved scoring + roster ids) and delete this file.
 */
export function RulesPlatePlaceholder({ sport }: { sport: 'NFL' | 'NBA' }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-[#1a1c26] px-2 py-1 text-slate-200" data-placeholder="rules-plate">
      <span className="rounded-full bg-gradient-to-r from-[#e8b84a] to-[#a57a22] px-2 text-[11px] font-black tracking-wider text-[#1a1204]">{sport === 'NBA' ? 'POINTS' : 'HALF'}</span>
      Standard · {sport === 'NBA' ? '10' : '9'} start
    </span>
  )
}
