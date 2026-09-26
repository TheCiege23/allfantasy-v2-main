import 'server-only'
import { prisma } from '@/lib/prisma'

/** Account preferences, never the shared provider collector's state. Throws on read failure. */
export async function getPausedSyncKeys(userId: string): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ preferences: unknown }>>`
    SELECT core_preferences AS preferences FROM user_profiles WHERE "userId" = ${userId}
  `
  const preferences = rows[0]?.preferences
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return new Set()
  const keys = (preferences as Record<string, unknown>).syncPausedKeys
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return new Set()
  return new Set(Object.entries(keys).filter(([, value]) => value === true).map(([key]) => key))
}

/** Merge one key atomically so simultaneous edits cannot discard other leagues or preferences. */
export async function setSyncPaused(userId: string, key: string, paused: boolean): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (${userId}, NOW(), jsonb_build_object('syncPausedKeys', jsonb_build_object(${key}::text, ${paused}::boolean)))
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
        jsonb_build_object('syncPausedKeys', COALESCE(user_profiles.core_preferences->'syncPausedKeys', '{}'::jsonb) ||
          jsonb_build_object(${key}::text, ${paused}::boolean)),
      "updatedAt" = NOW()
  `
}
