import { foldIcsLine } from './commissioner/calendar'
export type WeeklyCalendarKind = 'game'|'lineup'|'waivers'|'trade'|'keeper'|'draft'|'poll'|'commissioner'
export type WeeklyCalendarEvent = { id:string; leagueId:string; leagueName:string; kind:WeeklyCalendarKind; title:string; at:string; source:'league-settings'|'waiver-engine'|'league-chat'|'commissioner-workspace'|'stored-lineup'; href:string }
export type WeeklyCalendar = { generatedAt:string; through:string; events:WeeklyCalendarEvent[]; gaps:Array<{leagueId:string;leagueName:string;kind:'lineup'|'waivers'|'read'}> }
export type WeeklyCalendarLeague = { id:string;name?:string|null;settings?:unknown; lineupAutomatic?:boolean }
/** A local wall clock without an offset is not an absolute deadline. */
export function absoluteCalendarTime(raw:unknown):string|null {
  if(typeof raw==='string'){
    const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(raw)
    if(!m || Number(m[4])>23 || Number(m[5])>59 || Number(m[6]??0)>59)return null
    const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])))
    if(d.getUTCFullYear()!==Number(m[1]) || d.getUTCMonth()+1!==Number(m[2]) || d.getUTCDate()!==Number(m[3]))return null
  }
  const ms=raw instanceof Date?raw.getTime():typeof raw==='number'&&raw>0?(raw<1e12?raw*1000:raw):typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)?Date.parse(raw):NaN
  return Number.isFinite(ms)&&ms>Date.UTC(2000,0,1)?new Date(ms).toISOString():null
}
export function buildWeeklyCalendar(leagues:WeeklyCalendarLeague[], now:Date, extra:WeeklyCalendarEvent[]=[], games:Array<{leagueId:string;at:string|null}>=[], focus?:string|null, unavailable=false):WeeklyCalendar {
  const scoped=leagues.filter(l=>!focus||l.id===focus), allowed=new Map(scoped.map(l=>[l.id,l])), events:WeeklyCalendarEvent[]=[], gaps:WeeklyCalendar['gaps']=[]
  const end=now.getTime()+7*86400000
  const add=(event:WeeklyCalendarEvent)=>{const at=absoluteCalendarTime(event.at);if(at&&allowed.has(event.leagueId)&&Date.parse(at)>=now.getTime()&&Date.parse(at)<end)events.push({...event,at,leagueName:allowed.get(event.leagueId)!.name?.trim()||'League'})}
  for(const l of scoped){
    const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
    const outer=obj(l.settings), s={...obj(outer.settings),...outer}, name=l.name?.trim()||'League'
    for(const [kind,keys] of [['lineup',['lineupLockAt','lineup_lock_at']],['waivers',['waiver_next_run','nextWaiverRunAt','waiverProcessAt']],['trade',['tradeDeadlineAt','trade_deadline_at']],['keeper',['keeperDeadlineAt','keeper_deadline_at']],['draft',['draft_start','draftStartTime','draft_date']]] as const){
      const at=keys.map(k=>absoluteCalendarTime(s[k])).find(Boolean)
      if(at)add({id:l.id+':'+kind,leagueId:l.id,leagueName:name,kind,title:'',at,source:'league-settings',href:'/core/'+(kind==='lineup'?'my-team':kind==='waivers'?'waivers':'commissioner')+'?league='+encodeURIComponent(l.id)})
      if((kind==='waivers'||kind==='lineup'&&!l.lineupAutomatic)&&(!at || Date.parse(at)<now.getTime())&&!extra.some(e=>e.leagueId===l.id&&e.kind===kind&&absoluteCalendarTime(e.at)&&Date.parse(e.at)>=now.getTime()))gaps.push({leagueId:l.id,leagueName:name,kind})
    }
    if(unavailable)gaps.push({leagueId:l.id,leagueName:name,kind:'read'})
  }
  for(const e of extra)add(e)
  for(const g of games)if(g.at)add({id:g.leagueId+':game:'+g.at,leagueId:g.leagueId,leagueName:'',kind:'game',title:'',at:g.at,source:'stored-lineup',href:'/core/my-team?league='+encodeURIComponent(g.leagueId)})
  const unique=new Map(events.map(e=>[e.leagueId+':'+e.kind+':'+e.at+':'+(e.kind==='poll'||e.kind==='commissioner'?e.id:''),e]))
  return {generatedAt:now.toISOString(),through:new Date(end).toISOString(),events:[...unique.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.leagueName.localeCompare(b.leagueName)),gaps}
}
export function weeklyCalendarTitle(e:WeeklyCalendarEvent,es=false):string{return e.title || (es?{game:'Próximo partido (no es un cierre confirmado)',lineup:'Cierre de alineación',waivers:'Procesamiento de agentes libres',trade:'Fecha límite de intercambios',keeper:'Fecha límite de keepers',draft:'Draft',poll:'Cierre de encuesta',commissioner:'Tarea del comisionado'}:{game:'Next game (not a confirmed lock)',lineup:'Lineup lock',waivers:'Waiver processing',trade:'Trade deadline',keeper:'Keeper deadline',draft:'Draft',poll:'Poll closes',commissioner:'Commissioner task'})[e.kind]}
export function weeklyCalendarIcs(calendar:WeeklyCalendar, reminders=false, es=false):string|null {
  if(!calendar.events.length)return null
  const escape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/([,;])/g,'\\$1')
  const stamp=(s:string)=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AllFantasy//Your Week//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:'+escape(es?'AllFantasy: Tu semana':'AllFantasy: Your Week')]
  for(const e of calendar.events){const title=e.leagueName+': '+weeklyCalendarTitle(e,es);lines.push('BEGIN:VEVENT','UID:'+Array.from(new TextEncoder().encode(e.id)).map(b=>b.toString(16).padStart(2,'0')).join('')+'@allfantasy.ai','DTSTAMP:'+stamp(calendar.generatedAt),'DTSTART:'+stamp(e.at),'SUMMARY:'+escape(title),'DESCRIPTION:'+escape((es?'Fuente: ':'Source: ')+e.source),'URL:https://www.allfantasy.ai'+e.href);if(reminders)lines.push('BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-PT15M','DESCRIPTION:'+escape(title),'END:VALARM');lines.push('END:VEVENT')}
  return [...lines,'END:VCALENDAR'].map(foldIcsLine).join('\r\n')+'\r\n'
}
