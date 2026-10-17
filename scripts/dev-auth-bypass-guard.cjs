/**
 * Turns the local dev sign-in bypass OFF unless the database is positively known to be safe.
 *
 * 🛑 WHY THIS EXISTS. `DEV_AUTH_BYPASS_ENABLED=true` signs every visitor in as a dev account —
 * `local-dev-user` by default, or whatever `DEV_AUTH_BYPASS_EMAIL` names — and the bypass was gated
 * on `NODE_ENV` alone. The primary checkout's `.env.local` sets it AND points `DATABASE_URL` at
 * production, so every `next dev` started there was a production session: the dev account was
 * created in the production `app_users` table, and everything clicked as it was written to
 * production. Measured 2026-10-01: production's only co-commissioner row belonged to
 * `local-dev-user`. One `.claude/launch.json` config even pointed the bypass at the owner's REAL
 * account, which made a local preview a signed-in production session as that person.
 *
 * FAIL-CLOSED, by the same rule as `db-target-identity.cjs`: only a target that module positively
 * classifies as SAFE (a local database, or a listed non-production Neon target) keeps the bypass.
 * Production, an unrecognised target and an unset URL all turn it off. A guard that refused only
 * the production endpoint would go quietly open the next time that endpoint changes — it already
 * changed once, on 2026-07-14.
 *
 * It DISABLES rather than throws, so a dev server pointed at production still starts and simply
 * stops signing you in. Both flags go off, because the server provider (`lib/auth.ts`), the live
 * draft engine (`lib/live-draft-engine/auth.ts`) and the two login buttons each read their own.
 *
 * Called from `next.config.js`, which runs as plain Node when a server starts — never from a route
 * bundle — and returns before touching anything when NODE_ENV is production.
 */
const { identifyTarget, describeTarget } = require("./db-target-identity.cjs");

const FLAGS = ["DEV_AUTH_BYPASS_ENABLED", "NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED"];

/**
 * @param {NodeJS.ProcessEnv} env  mutated in place when the bypass is refused
 * @param {(message: string) => void} [warn]
 * @returns {"production-build" | "off" | "allowed" | "refused"}
 */
function applyDevAuthBypassGuard(env, warn = (m) => console.warn(m)) {
  if (env.NODE_ENV === "production") return "production-build";
  const requested = FLAGS.some((k) => String(env[k] ?? "").trim() === "true");
  if (!requested) return "off";

  const target = identifyTarget(env.DATABASE_URL);
  if (target.kind === "safe") return "allowed";

  for (const k of FLAGS) env[k] = "false";
  warn(
    `\n🛑 [dev-auth-bypass] DISABLED: DATABASE_URL is ${describeTarget(env.DATABASE_URL)}, ` +
      `not a database known to be safe. The dev sign-in bypass would have signed you in and ` +
      `written to it. Point DATABASE_URL at a local or listed non-production database ` +
      `(e.g. .env.test) to use it — see scripts/db-target-identity.cjs.\n`,
  );
  return "refused";
}

module.exports = { applyDevAuthBypassGuard, DEV_AUTH_BYPASS_FLAGS: FLAGS };
