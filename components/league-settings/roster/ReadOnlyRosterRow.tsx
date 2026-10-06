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
}

export function ReadOnlyRosterRow({
  def,
  count,
}: {
  def: SlotDef
  count: number
}) {
  const { t } = useLanguage()
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <span className="w-[76px] text-left text-xs text-white/35">{t('lsEd.ro.readOnly')}</span>
      <span className="w-6 text-center font-mono text-sm text-white">{count}</span>
      <div className="flex items-center gap-2">
        <div className={`h-3 w-3 rounded-full ${SLOT_DOT_CLASS[def.key] ?? CATEGORY_DOT_CLASS[def.category] ?? 'bg-white/60'}`} />
        <span className="text-[12px] text-white/80">{def.label}</span>
      </div>
    </div>
  )
}
