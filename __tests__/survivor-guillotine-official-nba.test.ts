import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { officialNbaSchedule, matchOfficialNbaGame, prepareSGOfficialNbaBox } from '@/lib/survivor-guillotine/providerNbaOfficial'
import { acceptedDailyBoxSource, statCoverageCorrectionsReady } from '@/lib/sports-data/statCoverage'
import cle from '@/__tests__/fixtures/survivor-official-nba/cle-dal.json'
import mem from '@/__tests__/fixtures/survivor-official-nba/mem-bkn.json'
import mia from '@/__tests__/fixtures/survivor-official-nba/mia-det.json'
import identities from '@/__tests__/fixtures/survivor-official-nba/identities.json'
const now = new Date('2026-11-15T19:00:00Z')
const target = (box: any) => ({ externalId:'primary:'+box.game.gameId,homeTeam:box.game.homeTeam.teamTricode,awayTeam:box.game.awayTeam.teamTricode,startTime:new Date(box.game.gameTimeUTC),week:0 })
const match = (box: any) => ({ id:box.game.gameId,home:box.game.homeTeam.teamTricode,away:box.game.awayTeam.teamTricode,start:box.game.gameTimeUTC,season:2026 })
describe('official NBA recovery of real incomplete primary boxes', () => {
 it.each([[cle,18],[mem,25],[mia,25]])('reconciles an actual full official box, including personal versus team rebounds', (box,count) => {
   const prepared=prepareSGOfficialNbaBox(target(box),match(box),box,identities,now)
   expect(prepared.rows).toHaveLength(count as number); expect(prepared.coverage.source).toBe('nba_official_live')
   expect(new Set(prepared.rows.map(r=>r.playerId)).size).toBe(count)
   expect(prepared.rows.every(r=>r.source==='nba_official_live'&&r.gameId===target(box).externalId)).toBe(true)
 })
 it('matches exact game time and teams, ignores explicit Cup TBD slots, and rejects ambiguity',()=>{
   const g={gameId:cle.game.gameId,homeTeam:cle.game.homeTeam,awayTeam:cle.game.awayTeam,gameDateTimeUTC:cle.game.gameTimeUTC}
   const games=officialNbaSchedule({leagueSchedule:{seasonYear:'2026-27',gameDates:[{games:[g,{...g,gameId:'0022601201',homeTeam:{teamId:0},awayTeam:{teamId:0}}]}]}},2026)
   expect(games).toHaveLength(1);expect(matchOfficialNbaGame(target(cle),games).id).toBe(cle.game.gameId)
   expect(()=>matchOfficialNbaGame({...target(cle),startTime:new Date('2026-11-15T01:00:00Z')},games)).toThrow('SCHEDULE_GAME_MISMATCH')
   expect(()=>matchOfficialNbaGame(target(cle),[...games,...games])).toThrow('SCHEDULE_GAME_MISMATCH')
 })
 it('requires a verified final game and matching official game ID',()=>{
   const wrong=structuredClone(cle);wrong.game.gameStatus=2
   expect(()=>prepareSGOfficialNbaBox(target(cle),match(cle),wrong,identities,now)).toThrow('GAME_NOT_VERIFIED_FINAL')
   expect(()=>prepareSGOfficialNbaBox(target(cle),{...match(cle),id:'0022609999'},cle,identities,now)).toThrow('GAME_NOT_VERIFIED_FINAL')
 })
 it('rejects missing appearances, extra contributions, malformed minutes and a nonzero DNP',()=>{
   const missing=structuredClone(cle);missing.game.homeTeam.players=missing.game.homeTeam.players.slice(1)
   expect(()=>prepareSGOfficialNbaBox(target(cle),match(cle),missing,identities,now)).toThrow()
   const extra=structuredClone(mia);extra.game.homeTeam.players[0].statistics.assists++
   expect(()=>prepareSGOfficialNbaBox(target(mia),match(mia),extra,identities,now)).toThrow('TEAM_TOTAL_MISMATCH')
   const bad=structuredClone(cle);bad.game.homeTeam.players[0].statistics.minutes='PT20M99.00S'
   expect(()=>prepareSGOfficialNbaBox(target(cle),match(cle),bad,identities,now)).toThrow('INVALID_MINUTES')
   const dnp=structuredClone(cle);dnp.game.homeTeam.players.find(p=>p.played==='0')!.statistics.assists=1
   expect(()=>prepareSGOfficialNbaBox(target(cle),match(cle),dnp,identities,now)).toThrow('INCONSISTENT_DNP')
 })
 it('never guesses missing or ambiguous identities, and checks the reviewed alias name as well as ID',()=>{
   expect(()=>prepareSGOfficialNbaBox(target(cle),match(cle),cle,[],now)).toThrow('UNRESOLVED_PLAYER')
   expect(()=>prepareSGOfficialNbaBox(target(cle),match(cle),cle,[...identities,...identities],now)).toThrow('UNRESOLVED_PLAYER')
   const spoof=structuredClone(cle);spoof.game.awayTeam.players.find(p=>p.personId===1629023)!.name='Different Washington'
   expect(()=>prepareSGOfficialNbaBox(target(cle),match(cle),spoof,identities,now)).toThrow('UNRESOLVED_PLAYER_1629023')
 })
 it('accepts official provenance only for NBA and preserves the genuine correction window',()=>{
   expect(acceptedDailyBoxSource('NBA','nba_official_live')).toBe(true)
   expect(acceptedDailyBoxSource('NFL','nba_official_live')).toBe(false)
   const proof={...prepareSGOfficialNbaBox(target(cle),match(cle),cle,identities,now).coverage,firstFinalObservedAt:now,recordedAt:now}
   expect(statCoverageCorrectionsReady(proof,now)).toBe(false)
   const later=new Date(now.getTime()+12*3600000)
   expect(statCoverageCorrectionsReady({...proof,recordedAt:later},later)).toBe(true)
 })
})
