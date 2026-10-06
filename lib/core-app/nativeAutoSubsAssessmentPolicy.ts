import { definiteInactive,freshAutoSubsEvidence } from './nativeAutoSubsPolicy'
import { isEligibleForSlot } from './rosterSlots'
export type AutoSubsHoldReason = 'commissioner_disabled'|'owner_disabled'|'lineup_changed'|'roster_eliminated'|'league_locked'|'backup_unavailable'|'status_evidence_unavailable_or_stale'|'inactive_not_confirmed'|'backup_not_active'|'game_lock_or_schedule_unavailable'
type PlayerEvidence={status:string|null;position:string|null;source:string;fetchedAt:Date;expiresAt:Date}
type GameLock={scheduleKnown:boolean;lockedBecauseGameStarted:boolean;nextKickoffUtc:Date|null}
/** Shared by preview and execution; null means eligible on the evidence supplied. */
export function nativeAutoSubsSlotHold(input:{out:PlayerEvidence|undefined;into:PlayerEvidence|undefined;onBench:boolean;slotLabel:string|undefined;now:number;locks?:GameLock[]}):AutoSubsHoldReason|null {
  const {out,into,onBench,slotLabel,now,locks}=input
  if(!out||!into||!onBench||!slotLabel||!isEligibleForSlot(slotLabel,into.position))return 'backup_unavailable'
  if(!freshAutoSubsEvidence(out,now)||!freshAutoSubsEvidence(into,now))return 'status_evidence_unavailable_or_stale'
  if(!definiteInactive(out.status))return 'inactive_not_confirmed'
  if(definiteInactive(into.status)||!['ACTIVE','HEALTHY','AVAILABLE'].includes((into.status??'').toUpperCase()))return 'backup_not_active'
  if(locks && (locks.length!==2||locks.some(l=>!l.scheduleKnown||l.lockedBecauseGameStarted||!l.nextKickoffUtc||l.nextKickoffUtc.getTime()<=now||l.nextKickoffUtc.getTime()>now+7*86400_000)))return 'game_lock_or_schedule_unavailable'
  return null
}
export type NativeAutoSubsAssessment={checkedAt:string;state:'off'|'paused'|'waiting'|'ready';reason:AutoSubsHoldReason|null;slots:Array<{slot:number;slotLabel:string;starterName:string;backupName:string;reason:AutoSubsHoldReason|null;statusSource:string|null;statusFetchedAt:string|null;starterGameAt:string|null;backupGameAt:string|null}>}
