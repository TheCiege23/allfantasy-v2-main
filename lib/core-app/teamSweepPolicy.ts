/** Match /api/cron/alert-sweep's 15-minute schedule; smaller ticks alias scheduled rotations. */
export const TEAM_SWEEP_INTERVAL_MS = 900_000
/** Rotate the starting target each sweep so a bounded batch cannot permanently starve later entries. */
export function rotateSweepTargets<T>(targets:readonly T[],now:number):T[]{
  if(!targets.length)return []
  const tick=Math.floor(now/TEAM_SWEEP_INTERVAL_MS),offset=((tick%targets.length)+targets.length)%targets.length
  return [...targets.slice(offset),...targets.slice(0,offset)]
}
/** Native execution must leave admission time for the alert phase in the same sweep. */
export function nativeSweepDeadline(deadline:number,now:number){return Math.min(deadline,now+10_000)}

/** Advance one contiguous batch per scheduled run, preserving coverage for divisible counts. */
export function teamSweepBatchOffset(count:number,batchSize:number,now:number):number{
  if(count<=0)return 0
  const offset=(Math.floor(now/TEAM_SWEEP_INTERVAL_MS)*batchSize)%count
  return (offset+count)%count
}
