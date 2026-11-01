import { DoorOpen, Layers3, ShieldCheck, Users } from 'lucide-react'
import { resolveZombieUniverseTier, zombieTierBadgeClasses } from '@/lib/zombie/zombie-visual-system'

export const renewalControl = 'min-h-[44px] rounded-xl border border-white/20 px-4 font-medium text-slate-100 transition-colors hover:border-cyan-300/50 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none'

/** Shared renewal presentation. Counts come from the current proposal or server preview. */
export function RenewalSummary({ managers, leagues, openSeats, unassigned }: {
  managers: number; leagues: number; openSeats: number; unassigned?: number
}) {
  const metrics = [
    { label: 'Returning managers', value: managers, icon: Users },
    { label: 'Destination leagues', value: leagues, icon: Layers3 },
    { label: 'Open seats', value: openSeats, icon: DoorOpen },
    { label: unassigned === undefined ? 'Placement review' : 'Unassigned managers',
      value: unassigned === undefined ? 'Required' : unassigned, icon: ShieldCheck },
  ]
  return <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
    {metrics.map(({ label, value, icon: Icon }) => <div key={label} className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/60 p-3 sm:p-4">
      <dt className="flex items-start gap-2 text-xs leading-relaxed text-slate-300"><Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />{label}</dt>
      <dd className="mt-2 break-words text-xl font-semibold tracking-tight text-white tabular-nums sm:text-2xl">{value}</dd>
    </div>)}
  </dl>
}

export function RenewalTierBadge({ name }: { name: string }) {
  const tier = resolveZombieUniverseTier({ name })
  return <span className={'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ' + zombieTierBadgeClasses(tier)}>
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /><span className="break-words">{name}</span>
  </span>
}

export function RenewalCapacity({ assigned, seats }: { assigned: number; seats: number }) {
  const overflow = assigned > seats
  return <div className="space-y-2">
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs leading-relaxed">
      <span className="text-slate-300"><strong className="font-semibold text-white tabular-nums">{assigned} / {seats}</strong> seats assigned</span>
      <span className={overflow ? 'font-semibold text-rose-200' : 'text-cyan-200'}>{overflow ? `${assigned - seats} over capacity` : `${seats - assigned} open seats`}</span>
    </div>
    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={'h-full rounded-full ' + (overflow ? 'bg-rose-400' : 'bg-cyan-300')} style={{ width: `${Math.min(100, seats > 0 ? assigned / seats * 100 : 0)}%` }} /></div>
  </div>
}
