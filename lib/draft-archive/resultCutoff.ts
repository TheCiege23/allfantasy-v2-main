/** A last-pick date is a conservative result cutoff, never an inferred draft start. */
export function importedResultCutoff(draft:Record<string,unknown>,now=new Date()){
 const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=now.getTime()&&Number.isFinite(new Date(v).getTime());
 if(valid(draft.start_time))return {at:draft.start_time,basis:'provider_start' as const};
 if(draft.status==='complete'&&valid(draft.last_picked))return {at:draft.last_picked,basis:'provider_last_pick' as const};
 return null;
}
