/**
 * Create a partner workspace and link leagues into it — OWNER-RUN, DRY RUN BY DEFAULT.
 *
 * Owner's decisions 2026-11-17 (see lib/partner-portal/provisionPlan.ts and docs/os/OS_BACKBONE_PRINCIPLES.md §4):
 *   - partner workspaces are created deliberately, by this script, not by any page or default;
 *   - leagues are LINKED into a workspace (a LeagueBinding row), never moved — players see no change.
 *
 * Create a workspace with its first owner and link two leagues:
 *
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/provision-partner-workspace.ts \
 *     --slug=acme-fantasy --name="Acme Fantasy" --owner-email=owner@example.com \
 *     --league=<leagueId> --league=<leagueId>
 *
 * Add leagues to an existing workspace:
 *
 *   … scripts/provision-partner-workspace.ts --link-only --slug=acme-fantasy --league=<leagueId>
 *
 * Nothing is written until you add --apply. Against production, run it the same way through
 * `railway run` so the environment supplies the database connections; read the dry run first.
 *
 * 🛑 --apply NEEDS COMMISH_APP_URL. Every write goes through `withTenant`, which runs on the row-level-security
 * role and refuses the owner connection (lib/domain/db.ts). That is the point: creating a workspace stays inside
 * its own tenant scope, with no bypass. The dry run needs only DATABASE_URL — it reads, never writes.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { withTenant } from '@/lib/domain/db'
import { provisionTenant } from '@/lib/domain/provisioning'
import { argumentProblems, describePlan, domainErrorText, parsePlanArgs, planPartnerProvision, type PlanFacts } from '@/lib/partner-portal/provisionPlan'

function modelKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}

async function readFacts(args: ReturnType<typeof parsePlanArgs>): Promise<PlanFacts> {
  // Reads on the app's owner connection: it sees every tenant, which a slug-is-taken check needs.
  const [owner, existingTenant, leagues] = await Promise.all([
    args.ownerEmail
      ? prisma.appUser.findFirst({ where: { email: { equals: args.ownerEmail, mode: 'insensitive' } }, select: { id: true, email: true, displayName: true } })
      : Promise.resolve(null),
    args.slug ? prisma.tenant.findUnique({ where: { slug: args.slug.trim().toLowerCase() }, select: { id: true, name: true } }) : Promise.resolve(null),
    args.leagueIds.length
      ? prisma.league.findMany({ where: { id: { in: args.leagueIds } }, select: { id: true, name: true, platform: true, platformLeagueId: true, season: true } })
      : Promise.resolve([]),
  ])
  const alreadyLinked =
    existingTenant && args.leagueIds.length
      ? await prisma.leagueBinding.findMany({
          where: { tenantId: existingTenant.id, leagueId: { in: args.leagueIds }, deletedAt: null },
          select: { leagueId: true },
        })
      : []
  return {
    owner: owner && owner.email ? { id: owner.id, email: owner.email, displayName: owner.displayName } : null,
    existingTenant,
    leagues,
    alreadyLinkedLeagueIds: alreadyLinked.map((b) => b.leagueId),
  }
}

async function main() {
  const args = parsePlanArgs(process.argv.slice(2))
  const early = argumentProblems(args)
  if (early.length) {
    for (const line of describePlan({ ok: false, problems: early })) console.log(line)
    process.exitCode = 1
    return
  }
  const facts = await readFacts(args)
  const plan = planPartnerProvision(args, facts)
  for (const line of describePlan(plan)) console.log(line)
  if (!plan.ok) {
    process.exitCode = 1
    return
  }
  if (!args.apply) {
    console.log('\nDry run. Nothing was written. Re-run with --apply to do exactly the above.')
    return
  }
  if (!process.env.COMMISH_APP_URL) {
    console.error(
      '\n--apply refused: COMMISH_APP_URL is not set. Writes go through withTenant on the row-level-security role, ' +
        'which refuses the owner connection by design. Nothing was written.',
    )
    process.exitCode = 1
    return
  }

  let tenantId = plan.tenantId
  if (plan.mode === 'create') {
    tenantId = randomUUID()
    const created = await provisionTenant(
      {
        withTenant,
        create: async (tx, model, data) => {
          await (tx as unknown as Record<string, { create: (a: { data: unknown }) => Promise<unknown> }>)[modelKey(model)]!.create({ data })
        },
        newId: randomUUID,
      },
      { tenantId, slug: plan.slug, name: plan.name, owner: plan.owner! },
    )
    if (!created.ok) {
      console.error(`\nWorkspace not created: ${domainErrorText(created.error)}`)
      process.exitCode = 1
      return
    }
    console.log(`\nCreated workspace ${plan.slug} (${tenantId}); ${plan.owner!.email} is its Owner.`)
  }

  if (plan.bindings.length) {
    await withTenant(tenantId!, async (tx) => {
      const t = tx as unknown as { leagueBinding: { create: (a: { data: unknown }) => Promise<unknown> } }
      for (const b of plan.bindings) {
        await t.leagueBinding.create({
          data: { tenantId, leagueId: b.leagueId, provider: b.provider, externalLeagueId: b.externalLeagueId, externalSeason: b.externalSeason },
        })
      }
    })
    console.log(`Linked ${plan.bindings.length} league(s).`)
  }
  console.log(`\nDone. The owner signs in and opens /partners/portal.`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
