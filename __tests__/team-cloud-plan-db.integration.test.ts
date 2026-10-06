// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect} from 'vitest'
import {prisma} from '@/lib/prisma'
import {readTeamPreference,saveTeamPreference} from '@/lib/core-app/teamPreferenceStore'
import {planScopeKey} from '@/lib/core-app/teamPlan'
const target=process.env.DATABASE_URL??''
const safe=process.env.TEAM_WORKSPACE_DB_SPECS==='1'&&/^postgresql:\/\/postgres@127\.0\.0\.1:5446\//.test(target)
const userId=`team-plan-test-${Date.now()}`,otherId=`team-plan-other-${Date.now()}`
describe.skipIf(!safe)('cloud plan real local Postgres concurrency',()=>{
 beforeAll(async()=>{await prisma.appUser.createMany({data:[{id:userId,email:`${userId}@tests.invalid`,username:userId},{id:otherId,email:`${otherId}@tests.invalid`,username:otherId}]});await prisma.$executeRaw`INSERT INTO user_profiles ("userId","updatedAt",core_preferences) VALUES (${userId},NOW(),'{"favoriteLeagueKeys":["L"]}'::jsonb)`})
 afterAll(async()=>{await prisma.userProfile.deleteMany({where:{userId:{in:[userId,otherId]}}});await prisma.appUser.deleteMany({where:{id:{in:[userId,otherId]}}})})
 it('exactly one concurrent device wins and other preferences survive',async()=>{const key=planScopeKey('L','R',2026,5);const results=await Promise.all([saveTeamPreference(userId,key,0,{slots:{0:'a'},note:'phone',deleted:false}),saveTeamPreference(userId,key,0,{slots:{0:'b'},note:'PC',deleted:false})]);expect(results.sort()).toEqual([false,true]);const saved=await readTeamPreference<{version:number;note:string}>(userId,key);expect(saved?.version).toBe(1);expect(['phone','PC']).toContain(saved?.note);expect(await readTeamPreference(otherId,key)).toBeNull();expect(await readTeamPreference(userId,'favoriteLeagueKeys')).toEqual(['L'])})
 it('a delete tombstone rejects stale resurrection and permits a later explicit save',async()=>{const key=planScopeKey('L','R',2026,6);expect(await saveTeamPreference(userId,key,0,{slots:{},note:'initial',deleted:false})).toBe(true);expect(await saveTeamPreference(userId,key,1,{slots:{},note:'',deleted:true})).toBe(true);expect(await saveTeamPreference(userId,key,1,{slots:{},note:'stale',deleted:false})).toBe(false);expect(await saveTeamPreference(userId,key,2,{slots:{},note:'new',deleted:false})).toBe(true);expect(await readTeamPreference(userId,key)).toMatchObject({version:3,note:'new',deleted:false})})
})
