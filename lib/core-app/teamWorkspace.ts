import { myTeamReasonText } from './myTeamReasonText'
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

export function teamHealth(data: MyTeamData, language = 'en') {
  const es = language === 'es'
  const text = (en: string, spanish: string) => es ? spanish : en
  const checks: Array<{ id: string; label: string; detail: string; tone: 'bad' | 'warn' | 'info' }> = []
  const automatic = !!data.bestBall || !!data.league.bestBall || data.league.lineupMode === 'automatic' || automaticLineup(data.league.format)
  if (!data.starters.available) checks.push({ id: 'coverage', label: text("Lineup unavailable","Alineación no disponible"), detail: myTeamReasonText(data.starters.reason, language), tone: 'info' })
  else for (const [index, slot] of data.starters.data.entries()) {
    const p = slot.player
    if (!automatic && slot.empty) checks.push({ id: `slot-${index}`, label: text(`${slot.slotLabel} is empty`, `${slot.slotLabel} está vacía`), detail: text("Review an eligible player and the provider deadline.","Revisa un jugador elegible y el plazo de la plataforma."), tone: 'bad' })
    if (!automatic && p && !isEligibleForSlot(slot.slotLabel, p.position)) checks.push({ id: `eligibility-${index}`, label: text(`${p.name}: position mismatch`, `${p.name}: posición incompatible`), detail: text(`${p.position ?? 'Unknown position'} does not match ${slot.slotLabel}; verify the provider’s eligibility.`, `${p.position ?? 'Posición desconocida'} no coincide con ${slot.slotLabel}; verifica la elegibilidad en la plataforma.`), tone: 'warn' })
    if (p?.ruledOut || p?.onBye) checks.push({ id: `player-${p.sleeperId}`, label: `${p.name}: ${p.onBye ? text("bye","descanso") : text("unavailable","no disponible")}`, detail: automatic ? text("Review depth; scoring selects players automatically.","Revisa la profundidad; la puntuación selecciona jugadores automáticamente.") : text("Review eligibility and individual game locks.","Revisa la elegibilidad y los bloqueos de cada partido."), tone: 'bad' })
    if (slot.unresolvedId) checks.push({ id: `identity-${index}`, label: text("Player identity unavailable","Identidad de jugador no disponible"), detail: text(`${slot.slotLabel}: this player could not be resolved.`, `${slot.slotLabel}: no se pudo identificar a este jugador.`), tone: 'info' })
  }
  if (data.taxi.available) for (const p of data.taxi.data) if (p.tenure?.yearsRemaining === 0) checks.push({ id: `taxi-${p.sleeperId}`, label: text(`${p.name}: taxi tenure reached`, `${p.name}: límite de permanencia en taxi alcanzado`), detail: text("Review the league’s promotion rules before moving this player.","Revisa las reglas de promoción de la liga antes de mover a este jugador."), tone: 'warn' })
  if (data.ir.available && data.ir.data.length) {
    if (data.rosterRules) for (const p of data.ir.data) {
      if (p.injuryStatus && !data.rosterRules.irStatuses.includes(p.injuryStatus.toUpperCase())) checks.push({id:`ir-${p.sleeperId}`,label:text(`${p.name}: review IR eligibility`, `${p.name}: revisar elegibilidad para IR`),detail:text("The saved injury designation does not match this league’s allowed IR statuses. Verify current status before moving.","El estado de lesión guardado no coincide con los estados permitidos en IR en esta liga. Verifica el estado actual antes de mover al jugador."),tone:'warn'})
    }
    else checks.push({ id: 'ir', label: text("Review injured reserve eligibility","Revisar elegibilidad para reserva por lesión"), detail: text("Injury labels alone do not establish your provider’s IR eligibility. Verify before adding or moving a player.","El estado de lesión por sí solo no determina la elegibilidad para IR en tu plataforma. Verifica antes de añadir o mover a un jugador."), tone: 'info' })
  }
  if (data.taxi.available && data.rosterRules?.taxiSlots != null && data.taxi.data.length>data.rosterRules.taxiSlots) checks.push({id:'taxi-capacity',label:text("Taxi squad exceeds capacity","La plantilla taxi supera la capacidad"),detail:text(`${data.taxi.data.length} players for ${data.rosterRules.taxiSlots} saved slots.`, `${data.taxi.data.length} jugadores para ${data.rosterRules.taxiSlots} plazas guardadas.`),tone:'bad'})
  return checks
}

export function eligibleComparisons(data: MyTeamData, now: number) {
  if (!data.starters.available || !data.bench.available) return []
  return data.starters.data.map((slot, index) => ({ slot, index, candidates: data.bench.available ? data.bench.data.filter(p => isEligibleForSlot(slot.slotLabel, p.position)).map(p => ({ player: p, started: hasStarted(p, now), delta: slot.player?.afProjectedPoints != null && p.afProjectedPoints != null ? p.afProjectedPoints - slot.player.afProjectedPoints : null })).sort((a,b) => (b.player.afProjectedPoints ?? -Infinity) - (a.player.afProjectedPoints ?? -Infinity)) : [] }))
}
