import type { MyTeamData } from './myTeam'
import { hasStarted } from './lineupDecision'
import { isEligibleForSlot } from './rosterSlots'

export function automaticLineup(format: string | null | undefined, settings?: unknown): boolean {
  const s = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const records = [s, s.settings, s.sleeper, s.sleeperLeague].filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
  return /best[ _-]?ball/i.test(format ?? '') || records.some(r => [r.best_ball, r.bestBall, (r.settings as Record<string, unknown> | undefined)?.best_ball].some(v => v === true || v === 1 || v === '1'))
}

export function autoSubsSetting(settings: unknown): boolean | null {
  if (!settings || typeof settings !== 'object') return null
  const s=settings as Record<string,unknown>
  const nested=s.settings && typeof s.settings==='object' ? s.settings as Record<string,unknown> : {}
  for (const v of [s.player_auto_subs,nested.player_auto_subs]) {
    if (v===true || v===1 || v==='1') return true
    if (v===false || v===0 || v==='0') return false
  }
  return null
}

export function teamHealth(data: MyTeamData) {
  const checks: Array<{ id: string; label: string; detail: string; tone: 'bad' | 'warn' | 'info' }> = []
  const automatic = data.league.lineupMode === 'automatic' || automaticLineup(data.league.format)
  if (!data.starters.available) checks.push({ id: 'coverage', label: 'Lineup unavailable', detail: data.starters.reason, tone: 'info' })
  else for (const [index, slot] of data.starters.data.entries()) {
    const p = slot.player
    if (!automatic && slot.empty) checks.push({ id: `slot-${index}`, label: `${slot.slotLabel} is empty`, detail: 'Review an eligible player and the provider deadline.', tone: 'bad' })
    if (!automatic && p && !isEligibleForSlot(slot.slotLabel, p.position)) checks.push({ id: `eligibility-${index}`, label: `${p.name}: position mismatch`, detail: `${p.position ?? 'Unknown position'} does not match ${slot.slotLabel}; verify the provider’s eligibility.`, tone: 'warn' })
    if (p?.ruledOut || p?.onBye) checks.push({ id: `player-${p.sleeperId}`, label: `${p.name}: ${p.onBye ? 'bye' : 'unavailable'}`, detail: automatic ? 'Review depth; scoring selects players automatically.' : 'Review eligibility and individual game locks.', tone: 'bad' })
    if (slot.unresolvedId) checks.push({ id: `identity-${index}`, label: 'Player identity unavailable', detail: `${slot.slotLabel}: this player could not be resolved.`, tone: 'info' })
  }
  if (data.taxi.available) for (const p of data.taxi.data) if (p.tenure?.yearsRemaining === 0) checks.push({ id: `taxi-${p.sleeperId}`, label: `${p.name}: taxi tenure reached`, detail: 'Review the league’s promotion rules before moving this player.', tone: 'warn' })
  if (data.ir.available && data.ir.data.length) {
    if (data.rosterRules) for (const p of data.ir.data) {
      if (p.injuryStatus && !data.rosterRules.irStatuses.includes(p.injuryStatus.toUpperCase())) checks.push({id:`ir-${p.sleeperId}`,label:`${p.name}: review IR eligibility`,detail:'The saved injury designation does not match this league’s allowed IR statuses. Verify current status before moving.',tone:'warn'})
    }
    else checks.push({ id: 'ir', label: 'Review injured reserve eligibility', detail: 'Injury labels alone do not establish your provider’s IR eligibility. Verify before adding or moving a player.', tone: 'info' })
  }
  if (data.taxi.available && data.rosterRules?.taxiSlots != null && data.taxi.data.length>data.rosterRules.taxiSlots) checks.push({id:'taxi-capacity',label:'Taxi squad exceeds capacity',detail:`${data.taxi.data.length} players for ${data.rosterRules.taxiSlots} saved slots.`,tone:'bad'})
  return checks
}

export function eligibleComparisons(data: MyTeamData, now: number) {
  if (!data.starters.available || !data.bench.available) return []
  return data.starters.data.map((slot, index) => ({ slot, index, candidates: data.bench.available ? data.bench.data.filter(p => isEligibleForSlot(slot.slotLabel, p.position)).map(p => ({ player: p, started: hasStarted(p, now), delta: slot.player?.afProjectedPoints != null && p.afProjectedPoints != null ? p.afProjectedPoints - slot.player.afProjectedPoints : null })).sort((a,b) => (b.player.afProjectedPoints ?? -Infinity) - (a.player.afProjectedPoints ?? -Infinity)) : [] }))
}
