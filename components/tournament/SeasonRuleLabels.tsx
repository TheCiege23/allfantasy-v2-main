import type { SeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { positionArtwork, seasonRuleAsset, seasonRuleLabels, seasonRosterPresets, withSeasonRosterPreset } from '@/lib/tournament/seasonRuleLabels'
export function SeasonPositionChip({ position, count = 1 }: { position: string; count?: number }) {
  const art = positionArtwork(position)
  return <span className="inline-flex min-h-8 items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-xs font-bold" style={{ backgroundColor: art?.fill ?? '#1d2130', color: art?.text ?? '#fff' }}>{position}{count !== 1 ? ' ×' + count : ''}</span>
}
export function SeasonRuleLabels({ config, compact = false }: { config: SeasonBlueprint; compact?: boolean }) {
  const label = seasonRuleLabels(config)
  if (!label) return <p className="text-sm text-amber-200">Scoring and roster labels appear after playing rules match the selected preset.</p>
  return <section aria-label="Tournament scoring and roster label" className="min-w-0 space-y-3 rounded-xl border border-amber-300/25 bg-slate-950/70 p-3">
    {compact ? <span className="inline-flex rounded-full px-3 py-1 text-sm font-bold text-white" style={{ background: `linear-gradient(135deg, ${label.scoring.colors.join(',')})` }}>{label.scoring.code} · {config.sport}</span> : <img src={seasonRuleAsset('scoring', label.scoring.id)!} alt={label.scoring.name + ' scoring'} width={280} height={112} className="h-auto w-full max-w-[280px]" />}
    <p className="font-semibold">{label.text}</p>
    <div className="flex flex-wrap gap-1.5" aria-label="Saved roster positions">{config.rules!.starters.filter(s => s.count > 0).map(s => <SeasonPositionChip key={s.position} position={s.position} count={s.count} />)}<SeasonPositionChip position="BN" count={label.bench} /><span className="inline-flex items-center rounded-md border border-dashed border-red-300/40 px-2 text-xs text-red-200">{config.sport === 'NBA' ? 'IL' : 'IR'} ×{label.ir}</span></div>
    <p className="text-xs text-slate-300">{label.starters} starters · {label.drafted} drafted slots · {label.ir} additional injured slots</p>
  </section>
}
export function SeasonRosterPresetPicker({ config, onChange }: { config: SeasonBlueprint; onChange: (next: SeasonBlueprint) => void }) {
  if (!config.rules) return null
  const selected = seasonRuleLabels(config)?.roster?.id
  return <details className="min-w-0 rounded-xl border border-white/15 p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Choose a roster layout</summary><p className="mb-3 text-sm text-slate-300">Selecting a layout replaces starter, bench and injured-slot counts. Customize individual counts in playing rules below.</p><div className="space-y-3">{seasonRosterPresets.filter(p => p.sport === config.sport).map(p => <button type="button" key={p.id} aria-pressed={selected === p.id} className="min-h-11 w-full min-w-0 rounded-xl border border-white/20 p-3 text-left aria-pressed:border-amber-300 aria-pressed:bg-amber-300/10" onClick={() => onChange(withSeasonRosterPreset(config, p.id))}><span className="block font-medium">{p.name} · {p.startCount} starters · {p.slots} drafted + {p.injured} injured</span><div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">{p.starters.map((position, i) => <SeasonPositionChip key={i} position={position} />)}</div><img src={seasonRuleAsset('roster', p.id)!} alt={p.name + ' roster positions'} className="mt-2 hidden h-auto w-full sm:block" loading="lazy" /></button>)}</div></details>
}
