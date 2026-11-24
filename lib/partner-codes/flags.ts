/**
 * Commissioner Partner Codes switches.
 *
 * PARTNER_CODES_ENABLED=1  — the program exists: pages render, APIs answer, the
 *                            Stripe webhook records commission, the jobs run.
 * PARTNER_DEMO=1           — the seeded demo data may be shown (with a "Demo"
 *                            banner). Refused in production whatever it says.
 */
export function isPartnerCodesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PARTNER_CODES_ENABLED?.trim() === '1'
}

export function isPartnerDemoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PARTNER_DEMO?.trim() !== '1') return false
  // The demo is for showing people before launch — never on the production deployment.
  const railwayEnv = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase()
  return railwayEnv !== 'production'
}

/** Name of the cookie that carries a code from /join/CODE to signup and checkout. */
export const PARTNER_CODE_COOKIE = 'af_partner_code'
export const PARTNER_CODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
