import { planMlbFantraxIdentityLinks, type MlbIdentityRow } from './mlbFantraxIdentityPlan'
export type MlbEspnIdentityRow = Omit<MlbIdentityRow,'fantraxId'> & { espnId:string|null }
/** Reuses the same strict MLB name/team/role matcher; source ids remain separate namespaces. */
export function planMlbEspnIdentityLinks(refs: Array<{id:string;name:string;position:string;team:string}>, rows: MlbEspnIdentityRow[]) {
  const {links,...coverage}=planMlbFantraxIdentityLinks(refs.map(r=>({fantraxId:r.id,name:r.name,position:r.position,team:r.team})),rows.map(({espnId,...r})=>({...r,fantraxId:espnId})))
  return {...coverage,links:links.map(({fantraxId,...r})=>({...r,espnId:fantraxId}))}
}
