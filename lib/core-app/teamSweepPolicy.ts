/** Rotate the starting target each sweep so a bounded batch cannot permanently starve later entries. */
export function rotateSweepTargets<T>(targets:readonly T[],now:number):T[]{
  if(!targets.length)return []
  const tick=Math.floor(now/300_000),offset=((tick%targets.length)+targets.length)%targets.length
  return [...targets.slice(offset),...targets.slice(0,offset)]
}
/** Native execution must leave admission time for the alert phase in the same sweep. */
export function nativeSweepDeadline(deadline:number,now:number){return Math.min(deadline,now+10_000)}
