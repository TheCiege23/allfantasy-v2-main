import { prisma } from '@/lib/prisma'
import { isGuildMember } from '@/lib/discord/bot'

/**
 * Who a members-only league channel can let in, decided ONCE, at creation.
 *
 * ⚠ ONCE, BECAUSE THE BOT CANNOT CHANGE IT LATER. Setting overwrites while creating a
 * channel needs only MANAGE_CHANNELS; editing them afterwards needs MANAGE_ROLES, which
 * the install link deliberately does not request ("we do not assign roles" is a promise
 * on the screen). So anyone who joins the server later is added by the commissioner, in
 * Discord — and the screen says so in plain steps rather than offering a button that
 * would need a scarier permission.
 *
 * ⚠ ONLY PEOPLE WE CAN PROVE ARE IN THE SERVER. A league member is included when they
 * have linked Discord on AllFantasy AND Discord confirms that account is in this server
 * right now. "Unknown" (Discord did not answer) is reported, never guessed either way.
 */

const SNOWFLAKE = /^\d{17,20}$/

/** Discord allows 100 overwrites; the @everyone deny and the bot take two. */
const MAX_MEMBERS = 98
const CONCURRENCY = 4

export type PrivateAccessPlan = {
  /** Discord user ids to grant, bot excluded. */
  discordUserIds: string[]
  /** Display names, for telling the commissioner what happened. */
  included: string[]
  /** Have not linked Discord on AllFantasy. */
  notLinked: string[]
  /** Linked, but that Discord account is not in the server (yet). */
  notInServer: string[]
  /** Discord could not tell us. */
  unknown: string[]
}

type Person = { userId: string; name: string }

export async function planPrivateChannelAccess(input: {
  leagueId: string
  guildId: string
  commissionerUserId: string
}): Promise<PrivateAccessPlan> {
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: input.leagueId },
    select: { teamName: true, ownerName: true, claimedByUserId: true },
    orderBy: { teamName: 'asc' },
  })

  // One entry per person: a manager with two teams, or a commissioner who also plays,
  // is still one Discord account.
  const people = new Map<string, Person>()
  people.set(input.commissionerUserId, { userId: input.commissionerUserId, name: 'You' })
  for (const t of teams) {
    if (!t.claimedByUserId || people.has(t.claimedByUserId)) continue
    people.set(t.claimedByUserId, { userId: t.claimedByUserId, name: t.ownerName || t.teamName || 'A manager' })
  }

  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: [...people.keys()] } },
    select: { userId: true, discordUserId: true, discordConnectedAt: true },
  })
  const discordByUser = new Map(
    profiles
      .filter((p) => p.discordUserId && p.discordConnectedAt && SNOWFLAKE.test(p.discordUserId))
      .map((p) => [p.userId, p.discordUserId as string]),
  )

  const plan: PrivateAccessPlan = { discordUserIds: [], included: [], notLinked: [], notInServer: [], unknown: [] }
  const toCheck: Array<Person & { discordUserId: string }> = []
  for (const person of people.values()) {
    const discordUserId = discordByUser.get(person.userId)
    if (!discordUserId) plan.notLinked.push(person.name)
    else toCheck.push({ ...person, discordUserId })
  }

  // Small fixed concurrency: a 12-team league is 12 lookups, and Discord rate-limits
  // per route, so firing them all at once only buys 429s.
  const results: Array<boolean | null> = new Array(toCheck.length).fill(null)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, toCheck.length) }, async () => {
      while (next < toCheck.length) {
        const i = next++
        results[i] = await isGuildMember(input.guildId, toCheck[i].discordUserId)
      }
    }),
  )

  toCheck.forEach((person, i) => {
    const inServer = results[i]
    if (inServer === true) {
      if (plan.discordUserIds.length < MAX_MEMBERS && !plan.discordUserIds.includes(person.discordUserId)) {
        plan.discordUserIds.push(person.discordUserId)
        plan.included.push(person.name)
      } else {
        plan.unknown.push(person.name)
      }
    } else if (inServer === false) {
      plan.notInServer.push(person.name)
    } else {
      plan.unknown.push(person.name)
    }
  })

  return plan
}
