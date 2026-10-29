import { myTeamReasonText } from './myTeamReasonText'
import type { MyTeamData } from './myTeam'
import { hasStarted } from './lineupDecision'
import { isEligibleForSlot } from './rosterSlots'
import { messagesFor } from '@/lib/i18n/messages'
import { teamWorkspaceMessages } from './messages/teamWorkspace'

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
  const m = messagesFor(teamWorkspaceMessages, language)
  const checks: Array<{ id: string; label: string; detail: string; tone: 'bad' | 'warn' | 'info'; player?: { name: string; imageUrl: string | null } }> = []
  const automatic = !!data.bestBall || !!data.league.bestBall || data.league.lineupMode === 'automatic' || automaticLineup(data.league.format)
  if (!data.starters.available) checks.push({ id: 'coverage', label: m.lineupUnavailable, detail: myTeamReasonText(data.starters.reason, language), tone: 'info' })
  else for (const [index, slot] of data.starters.data.entries()) {
    const p = slot.player
    if (!automatic && slot.empty) checks.push({ id: `slot-${index}`, label: m.slotEmpty(slot.slotLabel), detail: m.slotEmptyDetail, tone: 'bad' })
    if (!automatic && p && !isEligibleForSlot(slot.slotLabel, p.position, data.league.sport)) checks.push({ id: `eligibility-${index}`, label: m.positionMismatch(p.name), detail: m.positionMismatchDetail(p.position, slot.slotLabel), tone: 'warn', player: { name: p.name, imageUrl: p.imageUrl } })
    if (p?.ruledOut || p?.onBye) checks.push({ id: `player-${p.sleeperId}`, label: `${p.name}: ${p.onBye ? m.bye : m.unavailable}`, detail: automatic ? m.unavailableDetailAutomatic : m.unavailableDetailManual, tone: 'bad', player: { name: p.name, imageUrl: p.imageUrl } })
    if (slot.unresolvedId) checks.push({ id: `identity-${index}`, label: m.identityUnavailable, detail: m.identityDetail(slot.slotLabel), tone: 'info' })
  }
  if (data.taxi.available) for (const p of data.taxi.data) if (p.tenure?.yearsRemaining === 0) checks.push({ id: `taxi-${p.sleeperId}`, label: m.taxiTenureReached(p.name), detail: m.taxiTenureDetail, tone: 'warn', player: { name: p.name, imageUrl: p.imageUrl } })
  if (data.ir.available && data.ir.data.length) {
    if (data.rosterRules) for (const p of data.ir.data) {
      if (p.injuryStatus && !data.rosterRules.irStatuses.includes(p.injuryStatus.toUpperCase())) checks.push({id:`ir-${p.sleeperId}`,label:m.irReview(p.name),detail:m.irReviewDetail,tone:'warn',player:{name:p.name,imageUrl:p.imageUrl}})
    }
    else checks.push({ id: 'ir', label: m.irGeneral, detail: m.irGeneralDetail, tone: 'info' })
  }
  if (data.taxi.available && data.rosterRules?.taxiSlots != null && data.taxi.data.length>data.rosterRules.taxiSlots) checks.push({id:'taxi-capacity',label:m.taxiOverCapacity,detail:m.taxiOverCapacityDetail(data.taxi.data.length, data.rosterRules.taxiSlots),tone:'bad'})
  return checks
}

export function eligibleComparisons(data: MyTeamData, now: number) {
  if (!data.starters.available || !data.bench.available) return []
  return data.starters.data.map((slot, index) => ({ slot, index, candidates: data.bench.available ? data.bench.data.filter(p => isEligibleForSlot(slot.slotLabel, p.position, data.league.sport)).map(p => ({ player: p, started: hasStarted(p, now), delta: slot.player?.afProjectedPoints != null && p.afProjectedPoints != null ? p.afProjectedPoints - slot.player.afProjectedPoints : null })).sort((a,b) => (b.player.afProjectedPoints ?? -Infinity) - (a.player.afProjectedPoints ?? -Infinity)) : [] }))
}
