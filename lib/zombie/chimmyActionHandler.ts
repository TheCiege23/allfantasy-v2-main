import type { ZombieChimmyAction } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { processSerumAction, processRevive } from '@/lib/zombie/serumEngine'
import { getStatus } from '@/lib/zombie/ZombieOwnerStatusService'
import { getSerumBalance } from '@/lib/zombie/ZombieSerumEngine'
import { getWeaponBalance } from '@/lib/zombie/ZombieWeaponEngine'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import {
  applyZombieHordeSitOutToChallenges,
  nominateZombieHordeSitOut,
} from '@/lib/zombie/ZombieHordeSitOutEngine'

export type ChimmyActionResult = {
  ok: boolean
  chimmyActionId?: string
  publicMessage?: string | null
  privateMessage?: string | null
  error?: string
}

export type ZombieChimmyIntent =
  | 'use_serum'
  | 'use_weapon'
  | 'declare_bomb'
  | 'trigger_ambush'
  | 'horde_sit_out_nominate'
  | 'query_inventory'
  | 'query_role'
  | 'query_rules'
  | 'query_week_state'
  | 'activate_power'
  | 'unknown'

/** Enhanced intent detection for @Chimmy messages. */
export function detectZombieChimmyIntent(rawMessage: string): ZombieChimmyIntent {
  const lower = rawMessage.toLowerCase()
  if (!lower.includes('@chimmy')) return 'unknown'

  if (
    /@chimmy\s+horde\s+sit\s*out\s+.+/i.test(rawMessage) ||
    /@chimmy\s+sit\s*out\s+.+/i.test(rawMessage) ||
    /@chimmy\s+nominate\s+.+\s+to\s+sit(?:\s*out)?/i.test(rawMessage) ||
    /@chimmy\s+.+\s+sit\s*out/i.test(rawMessage)
  ) {
    return 'horde_sit_out_nominate'
  }

  // Action intents (higher priority)
  if (lower.match(/ambush|trigger.*ambush/)) return 'trigger_ambush'
  if (lower.match(/serum.*revive|revive/)) return 'use_serum'
  if (lower.match(/use.*serum|serum.*use/)) return 'use_serum'
  if (lower.match(/bomb|dynamite|tnt|💣|detonate/)) return 'declare_bomb'
  if (lower.match(/use.*(axe|gun|knife|bow|🪓|🔫|🔪|🏹)/)) return 'use_weapon'
  if (lower.match(/activate.*(power|horde|whisper|infection|serum)/)) return 'activate_power'

  // Query intents
  if (lower.match(/inventory|items?|what.*have|show.*serums?|show.*weapons?|serum.*count|weapon.*count/))
    return 'query_inventory'
  if (lower.match(/role|status|am.*i|survivor|zombie|whisperer|my.*status/)) return 'query_role'
  if (lower.match(/rules?|how.*work|explain|help|what.*happen|infection.*rules/)) return 'query_rules'
  if (lower.match(/week|current.*week|update|standings|scores|matchup/)) return 'query_week_state'

  return 'unknown'
}

async function handleQueryInventory(leagueId: string, userId: string): Promise<string> {
  try {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
    })
    if (!roster) return '⚠️ You are not on a roster in this league.'

    const serums = await getSerumBalance(leagueId, roster.id)
    const weapons = await prisma.zombieResourceLedger.findMany({
      where: { leagueId, rosterId: roster.id, resourceType: 'weapon' },
    })

    const weaponList = weapons.map((w) => `${w.resourceKey}: ${w.balance}`).join(', ')
    return `📦 **Inventory**: ${serums} serum(s), weapons: ${weaponList || 'none'}`
  } catch (e) {
    return `⚠️ Error fetching inventory: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function handleQueryRole(leagueId: string, userId: string): Promise<string> {
  try {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
    })
    if (!roster) return '⚠️ You are not on a roster in this league.'

    const status = await getStatus(leagueId, roster.id)
    const zombieLeague = await prisma.zombieLeague.findFirst({
      where: { leagueId },
      select: { id: true },
    })
    if (!zombieLeague) {
      return '⚠️ This is not a Zombie league.'
    }
    const whisperer = await prisma.whispererRecord.findFirst({
      where: { userId, zombieLeagueId: zombieLeague.id },
    })

    const icon = status === 'Whisperer' ? '🔴' : status === 'Zombie' ? '🟢' : '👤'
    const extra = whisperer ? ` (${whisperer.ambushesRemaining} ambushes left)` : ''
    return `${icon} **Your status**: ${status}${extra}`
  } catch (e) {
    return `⚠️ Error fetching role: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function handleQueryRules(leagueId: string): Promise<string> {
  try {
    const config = await getZombieLeagueConfig(leagueId)
    if (!config)
      return '⚠️ Unable to load league rules. Contact your commissioner.'

    return `📋 **Rules Summary**: Infection threshold ${config.infectionLossToZombie ? 'on loss' : 'off'}, Serum revive cost: ${config.serumReviveCount}, Weapons: ${config.weaponTopTwoActive ? 'top 2 only' : 'all qualify'}`
  } catch (e) {
    return `⚠️ Error fetching rules: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function handleQueryWeekState(leagueId: string, week: number): Promise<string> {
  try {
    const z = await prisma.zombieLeague.findFirst({
      where: { leagueId },
      select: { currentWeek: true, status: true },
    })
    if (!z) return '⚠️ League not found.'

    const infectionCount = await prisma.zombieLeagueTeam.count({
      where: { leagueId, status: 'Zombie' },
    })
    const survivorCount = await prisma.zombieLeagueTeam.count({
      where: { leagueId, status: 'Survivor' },
    })

    return `📊 **Week ${z.currentWeek}**: ${survivorCount} alive, ${infectionCount} infected, league status: ${z.status}`
  } catch (e) {
    return `⚠️ Error fetching week state: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function handleZombieChimmyAction(
  leagueId: string,
  userId: string,
  rawMessage: string,
  week: number,
): Promise<ChimmyActionResult> {
  const intent = detectZombieChimmyIntent(rawMessage)
  const lower = rawMessage.toLowerCase()

  try {
    if (intent === 'horde_sit_out_nominate') {
      const nomination = await nominateZombieHordeSitOut({
        leagueId,
        week,
        nominatorUserId: userId,
        rawCommand: rawMessage,
      })
      if (!nomination.ok) {
        const eligible = nomination.eligibleCandidates?.map((candidate) => candidate.displayName).join(', ')
        return {
          ok: false,
          privateMessage: eligible
            ? `${nomination.error} Eligible now: ${eligible}.`
            : nomination.error,
        }
      }
      return {
        ok: true,
        publicMessage: `${nomination.nominatedDisplayName} was nominated to sit out. They must accept for it to become official.`,
        privateMessage: `Nomination submitted for ${nomination.nominatedDisplayName}. Waiting on Yes/No response.`,
      }
    }

    // Query intents (no @prisma action creation)
    if (intent === 'query_inventory') {
      const msg = await handleQueryInventory(leagueId, userId)
      return { ok: true, privateMessage: msg }
    }
    if (intent === 'query_role') {
      const msg = await handleQueryRole(leagueId, userId)
      return { ok: true, privateMessage: msg }
    }
    if (intent === 'query_rules') {
      const msg = await handleQueryRules(leagueId)
      return { ok: true, privateMessage: msg }
    }
    if (intent === 'query_week_state') {
      const msg = await handleQueryWeekState(leagueId, week)
      return { ok: true, privateMessage: msg }
    }

    // Action intents (with audit)
    if (intent === 'trigger_ambush' || intent === 'use_weapon' || intent === 'declare_bomb' || intent === 'activate_power') {
      const challengeGuard = await applyZombieHordeSitOutToChallenges({
        leagueId,
        week,
        userId,
      })
      if (challengeGuard.blocked) {
        return {
          ok: false,
          privateMessage: `${challengeGuard.reason ?? 'Sit-out active for this week.'} You can still view status/inventory commands.`,
        }
      }
    }

    /*
     * 🛑 WEAPONS, BOMBS, AMBUSHES AND POWERS SPENT THE ITEM AND DID NOTHING. `processWeaponAction` marked the
     * weapon used ("Your weapon is active for week N") but nothing reads `usedEffect: 'active_weapon'`; a
     * bomb waited on a commissioner approval nothing processes; an ambush decremented the Whisperer's count
     * and re-paired no matchup; a power announced itself and changed nothing. Until those mechanics exist
     * (the 2026-10-17 decision: read-only for this season), the command keeps the item and says so.
     * Serums are different and stay live: a registered serum really does block an infection, and a revive
     * really does bring a Zombie back.
     */
    if (intent === 'use_weapon' || intent === 'declare_bomb' || intent === 'trigger_ambush' || intent === 'activate_power') {
      const what = {
        use_weapon: 'Weapons are',
        declare_bomb: 'The bomb is',
        trigger_ambush: 'Ambushes are',
        activate_power: 'Whisperer powers are',
      }[intent]
      return {
        ok: false,
        privateMessage: `${what} tracked this season but don't change matchups or scores yet, so nothing was spent — it's still yours.`,
        error: 'not_active_this_season',
      }
    }
    if (intent === 'use_serum') {
      if (lower.includes('revive')) {
        try {
          await processRevive(leagueId, userId, week)
          return { ok: true, publicMessage: '⚡ A Zombie has been brought back from the dead.' }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const row = await prisma.zombieChimmyAction.create({
            data: {
              leagueId,
              userId,
              week,
              actionType: 'revive_self',
              rawMessage,
              isValid: false,
              validationError: 'revive_failed',
              privateResponse: `⚠️ ${msg}`,
            },
          })
          return { ok: false, chimmyActionId: row.id, privateMessage: msg }
        }
      } else {
        const row = (await processSerumAction(leagueId, userId, rawMessage, week)) as ZombieChimmyAction
        return {
          ok: row.isValid,
          chimmyActionId: row.id,
          publicMessage: row.publicResponse,
          privateMessage: row.privateResponse,
          error: row.validationError ?? undefined,
        }
      }
    }

    // Unknown intent
    const row = await prisma.zombieChimmyAction.create({
      data: {
        leagueId,
        userId,
        week,
        actionType: 'unknown',
        rawMessage,
        isValid: false,
        validationError: 'unrecognized',
        privateResponse:
          "⚠️ I didn't recognize that command. Try:\n" +
          '• `@Chimmy inventory` — Show your serums & weapons\n' +
          '• `@Chimmy role` — Show your status (Survivor/Zombie/Whisperer)\n' +
          '• `@Chimmy horde sit out [manager]` — Nominate a horde sit-out\n' +
          '• `@Chimmy rules` — Show infection & serum rules\n' +
          '• `@Chimmy week` — Show this week\'s standings\n' +
          '• `@Chimmy revive` — Use serum to revive\n' +
          '• `@Chimmy bomb 💣` — Detonate bomb\n' +
          '• `@Chimmy axe/gun/knife/bow` — Use weapon\n' +
          '• `@Chimmy ambush [target]` — Whisperer ambush',
      },
    })
    return { ok: false, chimmyActionId: row.id, privateMessage: row.privateResponse }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
