/**
 * Drift detector for `db-target-identity.cjs`'s PRODUCTION_TARGETS table.
 *
 * The production endpoint id in this repo has been wrong twice (2026-07-14 had it inverted,
 * pointing every guard at a dev clone while production went unguarded). Neon endpoint ids
 * change whenever a compute is reset or a branch is re-pointed, so a hardcoded id WILL drift
 * again. This script makes that drift loud instead of silent.
 *
 * WHY NOT JUST DERIVE PROD IDENTITY FROM THE NEON API AT GUARD TIME?
 * Because the guards are fail-closed safety checks that run in front of destructive commands.
 * Making them depend on a network call means they either hang, or fall back to *something*
 * when the API is unreachable or NEON_API_KEY is absent — and any such fallback is precisely
 * the fail-open behaviour that caused the original incident. So: the table stays hardcoded and
 * offline (guards always work, with no credentials), and this script is what proves the table
 * still matches reality.
 *
 *   npm run db:verify-prod-identity
 *
 * Needs NEON_API_KEY (https://console.neon.tech/app/settings/api-keys). SKIPS cleanly (exit 0)
 * without one, so it never breaks a contributor who has no Neon access; wire it into CI where
 * the key exists to get the drift alarm.
 *
 * Read-only: issues GETs against the Neon control plane and never connects to a database.
 */
import { PRODUCTION_TARGETS } from './db-target-identity'

const PROJECT_ID = process.env.NEON_PROJECT_ID || 'icy-field-51189449'
const API = 'https://console.neon.tech/api/v2'

interface NeonBranch {
  id: string
  name: string
  primary?: boolean
  default?: boolean
  parent_id?: string
}

interface NeonEndpoint {
  id: string
  branch_id: string
  type: string
}

async function neonGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Neon API ${path} -> ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

async function main(): Promise<void> {
  const apiKey = process.env.NEON_API_KEY
  if (!apiKey) {
    console.log('[db:verify-prod-identity] SKIP — NEON_API_KEY is not set (no Neon access; nothing to verify).')
    process.exit(0)
  }

  const { branches } = await neonGet<{ branches: NeonBranch[] }>(`/projects/${PROJECT_ID}/branches`, apiKey)
  const { endpoints } = await neonGet<{ endpoints: NeonEndpoint[] }>(`/projects/${PROJECT_ID}/endpoints`, apiKey)

  // Neon's own source of truth for "this is the production branch": primary + default.
  // Branch NAME is deliberately not the signal — a branch can be called anything.
  const prodBranches = branches.filter((b) => b.primary === true && b.default === true)

  if (prodBranches.length !== 1) {
    console.error(
      `[db:verify-prod-identity] FAIL — expected exactly 1 primary+default branch, found ${prodBranches.length}: ` +
        `${prodBranches.map((b) => `${b.id} (${b.name})`).join(', ') || '<none>'}`,
    )
    process.exit(1)
  }

  const prodBranch = prodBranches[0]
  const prodEndpoints = endpoints.filter((e) => e.branch_id === prodBranch.id && e.type === 'read_write')

  if (prodEndpoints.length !== 1) {
    console.error(
      `[db:verify-prod-identity] FAIL — expected exactly 1 read_write endpoint on the production branch ` +
        `${prodBranch.id}, found ${prodEndpoints.length}.`,
    )
    process.exit(1)
  }

  const liveProdEndpoint = prodEndpoints[0].id
  const declared = PRODUCTION_TARGETS.map((t) => t.endpoint)

  console.log(`[db:verify-prod-identity] Neon project ${PROJECT_ID}`)
  console.log(`  live production branch : ${prodBranch.id} ("${prodBranch.name}", primary+default)`)
  console.log(`  live production endpoint: ${liveProdEndpoint}`)
  console.log(`  declared in db-target-identity.cjs: ${declared.join(', ')}`)

  if (!declared.includes(liveProdEndpoint)) {
    console.error(
      `\n[db:verify-prod-identity] FAIL — PRODUCTION_TARGETS has DRIFTED.\n` +
        `  Neon says production is "${liveProdEndpoint}" but the table declares [${declared.join(', ')}].\n\n` +
        `  Every guard in this repo classifies by that table. While it is wrong, the endpoint it\n` +
        `  wrongly names is the only one being protected. Update PRODUCTION_TARGETS in\n` +
        `  scripts/db-target-identity.cjs, and check whether the now-stale endpoint belongs in\n` +
        `  NONPRODUCTION_TARGETS instead.\n\n` +
        `  Do NOT assume the branch NAME settles it — on 2026-07-14 the console was misread and the\n` +
        `  value was inverted. Cross-check with pg_stat_database commit counts:\n` +
        `    SELECT datname, xact_commit, tup_returned FROM pg_stat_database WHERE datname='neondb';\n` +
        `  Production carries millions of commits; a fork carries thousands.\n`,
    )
    process.exit(1)
  }

  // A declared prod endpoint that Neon no longer considers primary+default is also drift:
  // it means the table is protecting something that is not production any more.
  const stale = declared.filter((d) => d !== liveProdEndpoint)
  if (stale.length > 0) {
    console.error(
      `\n[db:verify-prod-identity] FAIL — PRODUCTION_TARGETS declares endpoint(s) that are NOT the live\n` +
        `  production endpoint: ${stale.join(', ')}. Remove them, or the guards refuse databases that\n` +
        `  are merely forks while real production may be classified "unknown".\n`,
    )
    process.exit(1)
  }

  console.log('\n[db:verify-prod-identity] ✅ PRODUCTION_TARGETS matches the live Neon production branch.')
}

main().catch((err) => {
  console.error(`[db:verify-prod-identity] ERROR — ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
