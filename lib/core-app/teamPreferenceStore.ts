import 'server-only'
import { prisma } from '@/lib/prisma'

/** Atomic single-key merges preserve favorites, sync preferences and other plans. */
export async function readTeamPreference<T>(userId: string, key: string): Promise<T | null> {
  const rows=await prisma.$queryRaw<Array<{value:T|null}>>`SELECT core_preferences -> ${key}::text AS value FROM user_profiles WHERE "userId"=${userId}`
  return rows[0]?.value ?? null
}
export async function saveTeamPreference(userId:string,key:string,expectedVersion:number,value:Record<string,unknown>):Promise<boolean> {
  if(!Number.isSafeInteger(expectedVersion) || expectedVersion<0 || expectedVersion>=2147483646) throw new Error('Invalid version')
  const json=JSON.stringify({...value,version:expectedVersion+1,updatedAt:new Date().toISOString()})
  await prisma.$executeRaw`INSERT INTO user_profiles ("userId","updatedAt",core_preferences) VALUES (${userId},NOW(),'{}'::jsonb) ON CONFLICT ("userId") DO NOTHING`
  const count=await prisma.$executeRaw`UPDATE user_profiles SET core_preferences=COALESCE(core_preferences,'{}'::jsonb) || jsonb_build_object(${key}::text,${json}::jsonb),"updatedAt"=NOW()
    WHERE "userId"=${userId} AND COALESCE((core_preferences -> ${key}::text ->> 'version')::int,0)=${expectedVersion}`
  return count===1
}
