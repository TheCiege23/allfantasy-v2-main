import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react"
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest"
import BracketExperiencePanel from "@/components/brackets/playoffs/BracketExperiencePanel"
import ChimmyMatchupAdvice from "@/components/brackets/playoffs/ChimmyMatchupAdvice"
import {defaultBracketAlerts,type BracketExperience} from "@/lib/playoffs/bracketExperience"
import {bracketCompanionCopy} from "@/lib/brackets/bracketCompanionCopy"
import {bracketExperienceCopy as hubCopy} from "@/lib/brackets/bracketExperienceCopy"
import CupGameCard from "@/components/brackets/playoffs/cup/CupGameCard"
import {buildPlayoffTemplate} from "@/lib/playoffs/playoffTemplate"
const language=vi.hoisted(()=>({value:"en"}))
const paid=vi.hoisted(()=>vi.fn())
vi.mock("@/components/i18n/LanguageProviderClient",()=>({useOptionalLanguage:()=>({language:language.value})}))
vi.mock("@/lib/tokens/paidToolClient",()=>({paidToolFetchWithConfirm:paid}))
vi.mock("next/link",()=>({default:({href,children}:any)=><a href={href}>{children}</a>}))
const data=():BracketExperience=>({checklist:{hasEntry:true,finalizedAt:null,available:2,saved:1,missing:1,firstMissingId:"g2",nextDeadline:"2099-11-07T01:20:00Z",readyToFinalize:false,pendingMatchups:7},officialTotal:1,explainedTotal:1,
 ledger:[{id:"g1",round:"cup_group_play",home:"Boston Celtics",away:"Atlanta Hawks",pick:"Boston Celtics",winner:"Boston Celtics",points:1,available:1,reason:"correct",homeScore:100,awayScore:90,sourceAt:"2026-11-07T01:00:00Z"}],history:{available:false,since:null,events:[],trimmed:0},alerts:{...defaultBracketAlerts},standings:{asOf:"2026-11-07T01:00:00Z",liveGames:1,staleGames:1,rows:[{id:"mine",name:"My bracket",officialScore:1,officialRank:2,provisionalScore:2,provisionalRank:1,livePoints:1,movement:1}]}})
beforeEach(()=>{language.value="en";vi.clearAllMocks()})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe("complete bracket experience controls",()=>{
 it("preserves the existing public hub catalog alongside the companion catalog",()=>{
   expect(hubCopy("en").myBrackets).toBe("My Brackets")
   expect(hubCopy("es").myBrackets).toBe("Mis cuadros")
   expect(hubCopy("en").noPrizes).toContain("no prizes")
   expect(bracketCompanionCopy("es").ledger).toBe("¿Por qué cambió mi puntuación?")
 })
 it.each(["draft","late"] as const)("does not label an excluded %s pick as earned points on a final game card",reason=>{
   const game={...buildPlayoffTemplate({sport:"nba_cup",seasonYear:2026})[0],id:"g",round:"cup_group_play" as const,homeTeamName:"Boston Celtics",awayTeamName:"Atlanta Hawks",winnerTeamName:"Boston Celtics",bestOf:1,status:"final" as const,liveHomeScore:100,liveAwayScore:90}
   render(<CupGameCard series={game} sport="nba_cup" pick="Boston Celtics" teamLogos={{}} groupLabel={null} recordOf={()=>"1-0"} lockedReason="Game completed" saving={false} onPick={()=>{}} onOpen={()=>{}} scoringExcludedReason={reason}/>)
   expect(screen.getByText(`${bracketCompanionCopy("en").reasons[reason]} · 0`)).toBeInTheDocument()
   expect(screen.queryByText(/Your pick was right/)).not.toBeInTheDocument()
 })
 it("gives actionable saved/finalized guidance without ever submitting or writing picks",()=>{
   const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);render(<BracketExperiencePanel experience={data()} challengeId="pool" entryId="mine"/>)
   expect(screen.getByText(/1 of 2 available picks saved/)).toBeInTheDocument()
   expect(screen.getByRole("link",{name:/Review missing picks/})).toHaveAttribute("href","/brackets/leagues/pool/entries/mine#playoff-series-g2")
   expect(screen.getByText(/Saving is not finalizing/)).toBeInTheDocument();expect(fetcher).not.toHaveBeenCalled()
   expect(screen.getByText("Correct finalized pick")).toBeInTheDocument()
 })
 it("keeps official standings separate from the live hypothesis and flags stale data",()=>{
   render(<BracketExperiencePanel experience={data()} challengeId="pool" entryId="mine"/>)
   fireEvent.click(screen.getByRole("button",{name:"Live standings movement"}))
   expect(screen.getByText("Rank if current leaders win")).toBeInTheDocument();expect(screen.getByText(/1 live games have delayed scores/)).toBeInTheDocument()
   expect(screen.getByText("↑1")).toBeInTheDocument();expect(screen.getByText(/Live points are not awarded points/)).toBeInTheDocument()
 })
 it("saves explicit opt-in only and retains unsaved edits across feed refreshes",async()=>{
   const fetcher=vi.fn(async()=>Response.json({alerts:{...defaultBracketAlerts,enabled:true}}));vi.stubGlobal("fetch",fetcher)
   const node=render(<BracketExperiencePanel experience={data()} challengeId="pool" entryId="mine"/>)
   fireEvent.click(screen.getByRole("button",{name:"My game alerts"}));const toggle=screen.getByRole("checkbox",{name:"Enable alerts for this pool"})
   expect(toggle).not.toBeChecked();fireEvent.click(toggle)
   node.rerender(<BracketExperiencePanel experience={data()} challengeId="pool" entryId="mine"/>);expect(toggle).toBeChecked();expect(fetcher).not.toHaveBeenCalled()
   fireEvent.click(screen.getByRole("button",{name:"Save alert preferences"}))
   expect(await screen.findByRole("status")).toHaveTextContent("Alert preferences saved.");expect(toggle).toBeChecked()
   expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/brackets/playoffs/pool/coach/alerts",expect.objectContaining({method:"PUT",body:expect.stringContaining('"enabled":true')}))
 })
 it("retains edits and reports a failed save without claiming success",async()=>{
   vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:503})))
   render(<BracketExperiencePanel experience={data()} challengeId="pool" entryId="mine"/>)
   fireEvent.click(screen.getByRole("button",{name:"My game alerts"}));fireEvent.click(screen.getByRole("checkbox",{name:"Enable alerts for this pool"}));fireEvent.click(screen.getByRole("button",{name:"Save alert preferences"}))
   expect(await screen.findByRole("status")).toHaveTextContent("Could not save")
   expect(screen.getByRole("checkbox",{name:"Enable alerts for this pool"})).toBeChecked()
 })
 it("renders detailed Spanish scoring, checklist, standings and preferences",()=>{
   language.value="es";render(<BracketExperiencePanel experience={data()} challengeId="pool" entryId="mine"/>)
   expect(screen.getByText("Pronóstico finalizado correcto")).toBeInTheDocument();expect(screen.getByText(/1 de 2 pronósticos disponibles guardados/)).toBeInTheDocument()
   fireEvent.click(screen.getByRole("button",{name:"Movimiento de posiciones en vivo"}));expect(screen.getByText("Posición oficial")).toBeInTheDocument()
   fireEvent.click(screen.getByRole("button",{name:"Mis alertas de partidos"}));expect(screen.getByRole("checkbox",{name:"Activar alertas de este grupo"})).not.toBeChecked()
   expect(screen.queryByText(/Saving is not finalizing/)).not.toBeInTheDocument()
 })
 it("does not display old-language analysis after a language change during generation",async()=>{
   let resolve!:(r:Response)=>void;paid.mockReturnValue(new Promise(r=>resolve=r))
   const node=render(<ChimmyMatchupAdvice challengeId="pool" seriesId="g" canPick={false} onPick={()=>{}}/>)
   fireEvent.click(screen.getByRole("button",{name:"Ask Chimmy for full analysis"}));language.value="es"
   node.rerender(<ChimmyMatchupAdvice challengeId="pool" seriesId="g" canPick={false} onPick={()=>{}}/>)
   resolve(Response.json({generative:true,analysis:"Old English analysis"}));await waitFor(()=>expect(screen.queryByText("Old English analysis")).not.toBeInTheDocument())
   expect(screen.getByText("Datos verificados antes de elegir")).toBeInTheDocument()
 })
 it("keeps both catalogs structurally complete down to nested functions and reasons",()=>{
   const compare=(en:any,es:any)=>{expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());for(const k of Object.keys(en)){expect(typeof es[k]).toBe(typeof en[k]);if(typeof en[k]==="object")compare(en[k],es[k]);if(typeof es[k]==="string")expect(es[k].trim()).not.toBe("")}}
   compare(bracketCompanionCopy("en"),bracketCompanionCopy("es"))
 })
})
