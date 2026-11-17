/**
 * The plan behind scripts/provision-partner-workspace.ts — PURE, so every refusal is testable without a database.
 *
 * Owner's decisions 2026-11-17: the first partner workspaces are created by an owner-run script, and a partner's
 * leagues are LINKED (a `LeagueBinding` row in the partner's workspace), never moved — the league keeps its
 * AllFantasy tenant, so its players' screens are untouched.
 */
import { validateSlug } from '@/lib/domain/provisioning'
import type { DomainError } from '@/lib/domain/errors'

/** A domain error as one readable sentence (an INVARIANT carries it in `detail`, not `message`). */
export function domainErrorText(e: DomainError): string {
  return 'detail' in e && typeof e.detail === 'string' ? e.detail : e.code
}

export type PlanArgs = {
  mode: 'create' | 'link'
  slug: string
  /** Required to create a workspace; ignored when linking into an existing one. */
  name: string | null
  /** Required to create a workspace: the first owner. */
  ownerEmail: string | null
  leagueIds: string[]
}

export type PlanFacts = {
  owner: { id: string; email: string; displayName: string | null } | null
  /** The workspace this slug already names, if any (read on the owner connection). */
  existingTenant: { id: string; name: string } | null
  leagues: { id: string; name: string | null; platform: string; platformLeagueId: string; season: number | null }[]
  /** Leagues already linked into the target workspace (link mode only). */
  alreadyLinkedLeagueIds: string[]
}

export type BindingPlan = { leagueId: string; leagueName: string; provider: string; externalLeagueId: string; externalSeason: string | null }

export type ProvisionPlan =
  | { ok: false; problems: string[] }
  | {
      ok: true
      mode: 'create' | 'link'
      slug: string
      name: string
      tenantId: string | null
      owner: { userId: string; email: string; displayName: string } | null
      bindings: BindingPlan[]
      skipped: string[]
    }

export function parsePlanArgs(argv: string[]): PlanArgs & { apply: boolean } {
  const value = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3).trim() || null : null
  }
  const leagueIds = argv
    .filter((a) => a.startsWith('--league='))
    .flatMap((a) => a.slice('--league='.length).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    mode: argv.includes('--link-only') ? 'link' : 'create',
    slug: value('slug') ?? '',
    name: value('name'),
    ownerEmail: value('owner-email'),
    leagueIds: [...new Set(leagueIds)],
    apply: argv.includes('--apply'),
  }
}

/** The problems knowable from the arguments alone — checked BEFORE any database read, so a typo costs nothing. */
export function argumentProblems(args: PlanArgs): string[] {
  const problems: string[] = []
  const slug = validateSlug(args.slug)
  if (!slug.ok) problems.push(`--slug: ${domainErrorText(slug.error)}`)
  if (args.mode === 'create') {
    if (!args.name) problems.push('--name is required to create a workspace.')
    if (!args.ownerEmail || !args.ownerEmail.includes('@')) problems.push('--owner-email is required to create a workspace.')
  } else if (args.leagueIds.length === 0) {
    problems.push('--link-only needs at least one --league=<id>.')
  }
  return problems
}

export function planPartnerProvision(args: PlanArgs, facts: PlanFacts): ProvisionPlan {
  const problems: string[] = []
  const slug = validateSlug(args.slug)
  if (!slug.ok) problems.push(`--slug: ${domainErrorText(slug.error)}`)

  if (args.mode === 'create') {
    if (!args.name) problems.push('--name is required to create a workspace.')
    if (!args.ownerEmail || !args.ownerEmail.includes('@')) problems.push('--owner-email is required to create a workspace.')
    else if (!facts.owner) problems.push(`No AllFantasy account uses ${args.ownerEmail}. The owner has to sign up first.`)
    if (facts.existingTenant) {
      problems.push(`A workspace already uses the slug "${args.slug}" (${facts.existingTenant.name}). Slugs are permanent; pick another, or pass --link-only to add leagues to it.`)
    }
  } else if (!facts.existingTenant) {
    problems.push(`--link-only: no workspace uses the slug "${args.slug}".`)
  }

  const found = new Map(facts.leagues.map((l) => [l.id, l]))
  for (const id of args.leagueIds) if (!found.has(id)) problems.push(`League ${id} does not exist.`)
  if (args.mode === 'link' && args.leagueIds.length === 0) problems.push('--link-only needs at least one --league=<id>.')

  if (problems.length) return { ok: false, problems }

  const already = new Set(facts.alreadyLinkedLeagueIds)
  const skipped: string[] = []
  const bindings: BindingPlan[] = []
  for (const id of args.leagueIds) {
    const l = found.get(id)!
    if (already.has(id)) {
      skipped.push(`${l.name ?? id} is already linked`)
      continue
    }
    bindings.push({
      leagueId: l.id,
      leagueName: l.name?.trim() || l.id,
      // `LeagueBinding.provider` is a short namespaced key (sleeper, yahoo, espn…); League.platform already is one.
      provider: l.platform.trim().toLowerCase().slice(0, 32),
      externalLeagueId: (l.platformLeagueId || l.id).slice(0, 128),
      externalSeason: l.season != null ? String(l.season).slice(0, 16) : null,
    })
  }

  return {
    ok: true,
    mode: args.mode,
    slug: slug.ok ? slug.value : args.slug,
    name: args.mode === 'create' ? args.name! : facts.existingTenant!.name,
    tenantId: args.mode === 'link' ? facts.existingTenant!.id : null,
    owner:
      args.mode === 'create' && facts.owner
        ? { userId: facts.owner.id, email: facts.owner.email, displayName: facts.owner.displayName?.trim() || facts.owner.email }
        : null,
    bindings,
    skipped,
  }
}

/** What the dry run prints. One line per fact, so the owner reads exactly what --apply would do. */
export function describePlan(plan: ProvisionPlan): string[] {
  if (!plan.ok) return ['Nothing will be written. Fix these first:', ...plan.problems.map((p) => `  - ${p}`)]
  const lines = [
    plan.mode === 'create'
      ? `Create workspace "${plan.name}" (slug ${plan.slug}), status TRIAL, with ${plan.owner!.email} as Owner.`
      : `Link leagues into the existing workspace "${plan.name}" (slug ${plan.slug}).`,
    plan.bindings.length ? `Link ${plan.bindings.length} league(s) (they stay AllFantasy leagues; nothing about them changes for players):` : 'Link no leagues.',
    ...plan.bindings.map((b) => `  - ${b.leagueName} [${b.provider} ${b.externalLeagueId}${b.externalSeason ? `, ${b.externalSeason}` : ''}]`),
    ...plan.skipped.map((s) => `  - skipped: ${s}`),
  ]
  return lines
}
