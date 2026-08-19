/**
 * Staging environment safety validator (pure).
 *
 * Guards a staging verification run against the dangerous mistakes: live Stripe
 * keys (real charges), a missing cron secret (crons can't fire), and pointing at
 * the production database by accident. Pure so it is unit-tested without env.
 *
 * `scripts/check-staging-env.ts` is the thin CLI that loads `.env` and runs this.
 */

export type StagingEnvInput = Record<string, string | undefined>

export type StagingEnvOptions = {
  /** Allow DATABASE_URL that doesn't look like staging (DANGEROUS). */
  allowProdDb?: boolean
  /** Allow live Stripe keys (DANGEROUS — real charges). */
  allowLiveStripe?: boolean
  /**
   * The production database host (e.g. the endpoint host of the prod
   * DATABASE_URL). When provided, a staging DATABASE_URL whose host DIFFERS is
   * the authoritative "not production" signal — this lets Neon branch URLs
   * (which carry no literal "staging" marker) validate correctly, while a URL
   * matching the prod host is rejected.
   */
  prodDbHost?: string
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return ''
  }
}

export type StagingEnvResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
  info: string[]
}

function val(env: StagingEnvInput, key: string): string {
  const raw = env[key]
  if (raw == null) return ''
  let v = raw.trim()
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1).trim()
  return v
}

export function validateStagingEnv(env: StagingEnvInput, opts: StagingEnvOptions = {}): StagingEnvResult {
  const errors: string[] = []
  const warnings: string[] = []
  const info: string[] = []

  // ── Stripe must be TEST mode ────────────────────────────────────────────
  const sk = val(env, 'STRIPE_SECRET_KEY')
  const pk = val(env, 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
  const live = sk.startsWith('sk_live') || pk.startsWith('pk_live')
  const test = sk.startsWith('sk_test') || pk.startsWith('pk_test')
  if (live) {
    if (opts.allowLiveStripe) {
      warnings.push('Stripe keys are LIVE but --allow-live-stripe is set. REAL CHARGES are possible — do not run a checkout flow.')
    } else {
      errors.push('Stripe keys are LIVE (sk_live/pk_live). Staging must use TEST keys (sk_test/pk_test). Replace them, or pass --allow-live-stripe to override (NOT recommended).')
    }
  } else if (test) {
    info.push('Stripe keys are TEST mode.')
  } else if (!sk && !pk) {
    warnings.push('No Stripe keys set — the Stripe checkout/webhook verification will be skipped.')
  } else {
    warnings.push('Stripe keys present but mode is unrecognized (not sk_test/sk_live). Confirm they are TEST keys.')
  }

  // ── Cron secret required ────────────────────────────────────────────────
  const cron = val(env, 'CRON_SECRET') || val(env, 'LEAGUE_CRON_SECRET')
  if (!cron) {
    errors.push('CRON_SECRET (or LEAGUE_CRON_SECRET) is required — the scheduled crons (score-sync, waiver-process) authenticate the GET request with it.')
  } else {
    info.push('CRON_SECRET present — redraft crons accept it via requireCronAuth.')
  }

  // ── CRON_SECRET vs ADMIN_PASSWORD ───────────────────────────────────────
  const admin = val(env, 'ADMIN_PASSWORD')
  if (cron && admin && cron !== admin) {
    info.push('CRON_SECRET != ADMIN_PASSWORD — fine: the redraft crons now accept CRON_SECRET via requireCronAuth (before the fix they only accepted ADMIN_PASSWORD and the cron 401ed).')
  }

  // ── Stripe webhook secret ───────────────────────────────────────────────
  if (!val(env, 'STRIPE_WEBHOOK_SECRET')) {
    warnings.push('STRIPE_WEBHOOK_SECRET missing — webhook → entitlement verification cannot run.')
  } else {
    info.push('STRIPE_WEBHOOK_SECRET present.')
  }

  // ── Database must look like staging ─────────────────────────────────────
  const db = val(env, 'DATABASE_URL')
  if (!db) {
    errors.push('DATABASE_URL is required.')
  } else {
    // Test only the host + database name (after credentials), so the "stg" in
    // "po-stg-res://" can't false-match every connection string.
    const dbTarget = db.replace(/^\w+:\/\/[^@]*@?/, '')
    const looksStaging = /staging|\bstg\b|dev|test|preview|sandbox/i.test(dbTarget)
    const stagingHost = hostOf(db)
    const prodHost = opts.prodDbHost ? opts.prodDbHost.trim() : ''
    if (opts.allowProdDb) {
      warnings.push('--allow-prod-db is set — DATABASE_URL may point at PRODUCTION. Seeded E2E data is cascade-cleaned, but proceed with caution.')
    } else if (prodHost && stagingHost && stagingHost === prodHost) {
      // Authoritative: the host matches the known production host.
      errors.push(`DATABASE_URL host (${stagingHost}) MATCHES the production database host. This IS production. Use a separate staging database/branch. Pass --allow-prod-db only if truly intentional.`)
    } else if (prodHost && stagingHost && stagingHost !== prodHost) {
      // Authoritative: a different host than production = a separate database.
      // This is how Neon branch URLs (no literal "staging" marker) validate.
      info.push(`DATABASE_URL host (${stagingHost}) differs from the production host — a separate (non-production) database.`)
    } else if (!looksStaging) {
      errors.push("DATABASE_URL does not look like a staging database (no staging/dev/test/preview marker) and the production host is unknown, so it can't be confirmed non-production. If this is production, STOP. Pass --allow-prod-db only if intentional.")
    } else {
      info.push('DATABASE_URL appears to be a staging/dev database.')
    }
  }

  // ── App URL for the browser E2E ─────────────────────────────────────────
  const appUrl = val(env, 'PLAYWRIGHT_BASE_URL') || val(env, 'NEXT_PUBLIC_APP_URL') || val(env, 'NEXTAUTH_URL')
  if (!appUrl) {
    warnings.push('No app URL (PLAYWRIGHT_BASE_URL / NEXT_PUBLIC_APP_URL / NEXTAUTH_URL) — the browser E2E needs PLAYWRIGHT_BASE_URL pointing at the running app.')
  } else {
    info.push(`App URL configured (${appUrl}).`)
  }

  // ── Auth secret ─────────────────────────────────────────────────────────
  if (!val(env, 'NEXTAUTH_SECRET') && !val(env, 'AUTH_SECRET')) {
    warnings.push('NEXTAUTH_SECRET / AUTH_SECRET missing — login/auth will fail, so the browser E2E cannot sign in.')
  }

  return { ok: errors.length === 0, errors, warnings, info }
}
