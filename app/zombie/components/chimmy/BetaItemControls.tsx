'use client'
import { useState } from 'react'
import { useZombieDmCommand } from './useZombieDmCommand'
import { betaItemBonus, readyItem, WEAPON_POINTS, type BetaItem, type ItemBonus } from '@/lib/zombie/beta2025Items'

type Inventory = { appliedItemBonus?: ItemBonus | null; items: Array<BetaItem & { itemLabel: string }>; teamStatus: string; week: number; experienceMode: string | null; isCommissionerView?: boolean; weekBecameZombie?: number | null }
export function BetaItemControls({ leagueId, data, onChange }: { leagueId: string; data: Inventory; onChange?: () => void }) {
  const [count, setCount] = useState(1)
  const { isSending, feedback, sendCommand } = useZombieDmCommand(leagueId)
  const serums = data.items.filter(i => readyItem(i, data.week) && i.itemType.includes('serum'))
  const bomb = data.items.find(i => readyItem(i, data.week) && i.itemType === 'weapon_bomb')
  let bonus: ItemBonus
  try { bonus = data.appliedItemBonus ?? betaItemBonus('self', data.teamStatus, data.items, data.week, data.experienceMode !== 'simple') }
  catch { return <p role="alert" className="rounded-xl border border-amber-400/30 p-4 text-sm text-amber-100">Your roster status needs commissioner review before item bonuses are available.</p> }
  const zombie = bonus.role === 'Zombie'
  const canAct = !data.isCommissionerView && !isSending
  const run = async (message: string) => { if (await sendCommand(message)) onChange?.() }
  return <section className="space-y-5 rounded-2xl border border-teal-400/25 bg-teal-950/20 p-4 sm:p-5" data-testid="beta-item-controls">
    <div>
      <h2 className="text-lg font-bold text-teal-100">Your armory · Week {data.week}</h2>
      <p className="mt-1 text-sm text-white/70">{data.appliedItemBonus ? 'Applied item bonus' : 'Equipped item bonus'}: <strong className="text-teal-200">+{bonus.bonus}</strong> · Weapons +{bonus.weaponBonus} · Serums +{bonus.serumBonus}</p>
      <p className="mt-1 text-xs text-white/55">Bonuses count in matchups. Player scores without bonuses determine new item awards.</p>
    </div>
    <div>
      <h3 className="font-semibold text-teal-100">🧪 {serums.length} available serum(s)</h3>
      <p className="mt-1 text-sm text-white/65">Each gives +10 against a Zombie. Use as many as you hold before your last starter begins. Used serums are spent even if you lose.</p>
      {zombie ? <p className="mt-3 text-sm text-amber-100">Zombies cannot use scoring bonuses. Two serums automatically revive you. {data.weekBecameZombie === data.week ? 'You cannot revive during the week you were infected.' : 'Eligible revival is processed automatically.'}</p> : <div className="mt-3 flex flex-wrap gap-2">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-white">Serums
          <input aria-label="Serums to use" type="number" min={1} max={serums.length || 1} value={count} onChange={e => setCount(Number(e.target.value))} className="w-20 rounded-lg border border-white/20 bg-black/30 p-2" />
        </label>
        <button type="button" disabled={!canAct || !Number.isInteger(count) || count < 1 || count > serums.length} onClick={() => void run(`@Chimmy use ${count} serums`)} className="min-h-[44px] rounded-lg bg-teal-500/25 px-4 font-semibold text-teal-50 disabled:opacity-40">Use {Number.isInteger(count) && count > 0 ? count : '…'} · +{Number.isInteger(count) && count > 0 ? count * 10 : '…'} points</button>
      </div>}
    </div>
    {data.experienceMode !== 'simple' && <div>
      <h3 className="font-semibold text-amber-100">⚔️ Automatically equipped weapons</h3>
      <p className="mt-1 text-sm text-white/65">Survivors and Whisperers use their strongest two ordinary weapons every week. Zombies hold weapons without a bonus.</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.items.filter(i => !i.isUsed && !i.isExpired && WEAPON_POINTS[i.itemType]).map(i => <li key={i.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
          <span className="font-semibold text-white">{i.itemLabel} · +{WEAPON_POINTS[i.itemType]}</span>
          <span className="mt-1 block text-xs text-white/60">{i.activatesAtWeek && i.activatesAtWeek > data.week ? `Available week ${i.activatesAtWeek}` : i.itemType === 'weapon_bomb' ? 'One use · replaces other weapons' : bonus.weaponIds.includes(i.id) ? 'Equipped · reusable' : 'Held in inventory'}</span>
        </li>)}
      </ul>
      {bomb && !zombie && !bonus.bombId && <button type="button" disabled={!canAct} onClick={() => { if (window.confirm('Use this bomb once for +35 points? Other weapon bonuses will not count this week.')) void run('@Chimmy use bomb') }} className="mt-3 min-h-[44px] rounded-lg border border-red-400/40 bg-red-600/20 px-4 font-semibold text-red-100 disabled:opacity-40">Use bomb · +35 once</button>}
      <p className="mt-3 text-xs text-white/55">Unboosted NFL score: 100–104.99 Knife +4 · 105–109.99 Axe +6 · 110–114.99 Bow +8 · 115–119.99 Gun +10 · 120+ Bomb +35 once.</p>
    </div>}
    {feedback && <p role="status" className={feedback.kind === 'success' ? 'text-sm text-emerald-200' : 'text-sm text-red-200'}>{feedback.text}</p>}
  </section>
}
