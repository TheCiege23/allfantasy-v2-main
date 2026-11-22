import {z} from 'zod'
export const SG_COMMISSIONER_KEY='survivorGuillotineCommissioner'
export const SG_RUNTIME_KEY='survivorGuillotineCommissionerRuntime'
export const SG_ACTIONS={selections:'Fill missing legal choices at the selection deadline',auctions:'Settle due Gauntlet idol auctions',chops:'Run Chop Night after finalized scoring',rewards:'Deliver configured private weekly rewards',corrections:'Check latest-period stat corrections',advance:'Advance through the saved season calendar'} as const
export type SGAutomationAction=keyof typeof SG_ACTIONS
export const sgAdvancedSchema=z.object({selections:z.boolean(),auctions:z.boolean(),chops:z.boolean(),rewards:z.boolean(),corrections:z.boolean(),advance:z.boolean(),reviewPhaseChanges:z.boolean(),ceremonyDelayMinutes:z.number().int().min(0).max(10080)}).strict()
export const sgCommissionerSchema=z.object({version:z.literal(1),season:z.number().int().min(2020).max(2200),paused:z.boolean(),legacy:z.boolean().default(false),advanced:sgAdvancedSchema.nullable()}).strict().refine(p=>!p.legacy||p.advanced===null,'Choose legacy behavior or advanced controls.')
export type SGCommissionerRules=z.infer<typeof sgCommissionerSchema>
export const sgAdvancedDefaults={selections:true,auctions:true,chops:true,rewards:true,corrections:true,advance:true,reviewPhaseChanges:true,ceremonyDelayMinutes:60}
export function sgDecision(settings:unknown,season:number|null,action:SGAutomationAction,emergencyPaused=false){
 const raw=(settings as Record<string,unknown>|null)?.[SG_COMMISSIONER_KEY]
 if(emergencyPaused)return {allowed:false,managed:raw!=null,reason:'League emergency pause is active.',rules:null}
 if(raw==null)return {allowed:true,managed:false,reason:'Existing season behavior.',rules:null}
 const parsed=sgCommissionerSchema.safeParse(raw)
 if(!parsed.success)return {allowed:false,managed:true,reason:'Commissioner controls need repair.',rules:null}
 const p=parsed.data
 const reason=p.season!==season?'Controls belong to a previous season.':p.paused?'Commissioner automation is paused.':!p.advanced&&!p.legacy?'Manual operation selected.':p.advanced&&!p.advanced[action]?'This action is set to manual.':null
 return {allowed:reason===null,managed:true,reason,rules:p}
}
