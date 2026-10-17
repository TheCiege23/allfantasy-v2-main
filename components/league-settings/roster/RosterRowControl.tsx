import { Minus, Plus } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { SlotDef } from './types'

const CATEGORY_DOT_CLASS: Record<string, string> = {
  offense: 'bg-cyan-400',
  flex: 'bg-fuchsia-400',
  kicker: 'bg-zinc-400',
  dst: 'bg-slate-400',
  idp: 'bg-emerald-400',
  bench: 'bg-zinc-500',
  reserve: 'bg-rose-400',
  college: 'bg-violet-400',
}

const SLOT_DOT_CLASS: Record<string, string> = {
  QB: 'bg-red-400',
  RB: 'bg-emerald-400',
  WR: 'bg-sky-400',
  TE: 'bg-orange-400',
  FLEX: 'bg-fuchsia-400',
  FLX: 'bg-fuchsia-400',
  SF: 'bg-violet-400',
  SUPERFLEX: 'bg-violet-400',
  K: 'bg-zinc-300',
  DST: 'bg-slate-300',
  DEF: 'bg-slate-300',
  BN: 'bg-amber-400',
  IR: 'bg-rose-400',
  IL: 'bg-rose-400',
}

/** Position dot colour: a known slot key first, then its category, then neutral. */
export function rosterDotClass(def: SlotDef): string {
  return SLOT_DOT_CLASS[def.key] ?? CATEGORY_DOT_CLASS[def.category] ?? 'bg-white/60'
}

/** The slot's name, with its short code when the long label does not already say it. */
export function RosterSlotLabel({ def }: { def: SlotDef }) {
  const short = def.shortLabel || def.key
  const showShort = short && short.toUpperCase() !== def.label.toUpperCase()
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${rosterDotClass(def)}`} aria-hidden />
      {showShort ? (
        <span className="w-11 shrink-0 font-mono text-[12px] font-bold text-white">{short}</span>
      ) : null}
      <span className="min-w-0 truncate text-[13px] text-white/80">{def.label}</span>
    </span>
  )
}

/** One editable roster slot: label left, a compact [− n +] stepper right — never wider than the screen. */
export function RosterRowControl({
  def,
  count,
  disabled,
  onAdjust,
}: {
  def: SlotDef
  count: number
  disabled?: boolean
  onAdjust: (key: string, delta: number) => void
}) {
  const { t } = useLanguage()
  const decrease = t('lsEd.ro.decrease').replace('{{label}}', def.label)
  const increase = t('lsEd.ro.increase').replace('{{label}}', def.label)
  return (
    <div className="af-ls-stepper-row" data-testid={`roster-row-${def.key}`}>
      <RosterSlotLabel def={def} />
      <div className="af-ls-stepper">
        <button
          type="button"
          title={decrease}
          aria-label={decrease}
          disabled={disabled || count <= def.minCount}
          onClick={() => onAdjust(def.key, -1)}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <output aria-live="polite">{count}</output>
        <button
          type="button"
          title={increase}
          aria-label={increase}
          disabled={disabled || count >= def.maxCount}
          onClick={() => onAdjust(def.key, 1)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
