export type WeekPlan = { version: number; slots: Record<string,string>; note: string; updatedAt: string; deleted: boolean }
export function planScopeKey(leagueId: string, rosterKey: string, season: number, week: number): string {
  return `weekPlan:${JSON.stringify([leagueId,rosterKey,season,week])}`
}
export function parseWeekPlan(value: unknown): { slots: Record<string,string>; note: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan')
  const v=value as Record<string,unknown>
  if (typeof v.note !== 'string' || v.note.length>2000 || !v.slots || typeof v.slots!=='object' || Array.isArray(v.slots)) throw new Error('Invalid plan')
  const entries=Object.entries(v.slots)
  if(entries.length>40 || entries.some(([k,id])=>!/^\d{1,2}$/.test(k) || typeof id!=='string' || id.length>128)) throw new Error('Invalid slots')
  const ids=entries.map(([,id])=>id).filter(Boolean)
  if(new Set(ids).size!==ids.length) throw new Error('A player can occupy only one slot')
  return { note:v.note, slots:Object.fromEntries(entries) as Record<string,string> }
}
