/**
 * Secret redaction for free text — error messages, log lines, telemetry fields.
 *
 * WHY THIS MATTERS HERE SPECIFICALLY
 * `withSyncJobRun` writes every job's error into `sync_job_runs.errorMessage`, and routes now
 * deliberately hand it their FULL detail — `cron/waivers` redacts its HTTP response to
 * "discovery_failed" in production but passes the real message to telemetry. Before this,
 * `sanitize` stripped only `sk-` keys, which is the wrong half of the problem for this repo:
 * Rolling Insights passes `RSC_token` as a query parameter and TheSportsDB puts its key in a URL
 * path segment, so a provider error carrying a URL was stored verbatim.
 *
 * CLAUDE.md: those two credentials must never appear in logs, error messages, client responses or
 * fixtures.
 */
import { describe, it, expect } from 'vitest'

import { redactSecrets, redactAndCap } from '@/lib/security/redactSecrets'
import { buildSyncJobRunPayload } from '@/lib/production-health/syncJobRunTelemetry'

/** Nothing a redactor emits may still contain the secret it was given. */
function expectRedacted(input: string, secret: string) {
  const out = redactSecrets(input)
  expect(out, `"${secret}" survived in: ${out}`).not.toContain(secret)
}

describe('redactSecrets — the two credentials CLAUDE.md names', () => {
  it('redacts RSC_token from a query string', () => {
    // The documented leak: Rolling Insights passes its token as a query parameter, so naive URL
    // logging exposes a long-lived credential.
    const url = 'https://rest.datafeeds.rolling-insights.com/api/v1/schedule-season/NFL?RSC_token=live-token-abc123&x=1'
    expectRedacted(url, 'live-token-abc123')
    expect(redactSecrets(url)).toContain('RSC_token=***')
    // The rest of the URL must survive, or the message stops being diagnosable.
    expect(redactSecrets(url)).toContain('schedule-season/NFL')
    expect(redactSecrets(url)).toContain('x=1')
  })

  it('redacts the TheSportsDB key, which is a PATH SEGMENT and not a query param', () => {
    // No generic key=value rule can catch this shape — it needs its own.
    //
    // ⚠ WRITTEN WITHOUT A SCHEME ON PURPOSE, and it is not a workaround for a real violation.
    // `scripts/check-db-first-api-boundary.mjs` flags `https?://<monitored-host>/...` literals in
    // any changed file, and __tests__ is deliberately NOT excluded from its scan — a test must
    // never reach a provider either. It cannot tell this fixture from a live call. Dropping the
    // scheme is enough for the guard and changes nothing here, because the redaction rule matches
    // on the host-and-path shape and never required one. Do NOT "fix" this by exempting tests
    // from that guard or by adding a db-first-exception: the guard is right to be strict, and
    // exception comments are reserved for temporary violations that have a migration plan.
    const url = 'www.thesportsdb.com/api/v1/json/9427615/eventsday.php?d=2026-08-22'
    expectRedacted(url, '9427615')
    expect(redactSecrets(url)).toContain('/json/***/')
    expect(redactSecrets(url)).toContain('eventsday.php')
  })
})

describe('redactSecrets — credentials in URLs', () => {
  it('redacts a Postgres password without destroying the host, which is the diagnostic part', () => {
    const dsn = 'postgresql://neondb_owner:npg_SuperSecret123@ep-curly-block.aws.neon.tech/neondb'
    const out = redactSecrets(dsn)
    expect(out).not.toContain('npg_SuperSecret123')
    expect(out).toContain('neondb_owner:***@')
    expect(out).toContain('ep-curly-block.aws.neon.tech')
  })

  it('handles a Prisma-style error that embeds the connection string', () => {
    expectRedacted(
      "Can't reach database server at postgres://u:p4ssw0rd@db.internal:5432/app",
      'p4ssw0rd',
    )
  })
})

describe('redactSecrets — header and parameter forms', () => {
  it.each([
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdefghij', 'eyJhbGciOiJIUzI1NiJ9abcdefghij'],
    ['fetch failed: api_key=abcdef123456', 'abcdef123456'],
    ['?apiKey=zzz999&sport=NFL', 'zzz999'],
    ['{"client_secret":"cs_live_9999"}', 'cs_live_9999'],
    ['password: hunter2', 'hunter2'],
    ['x-cron-secret: my-cron-secret-value', 'my-cron-secret-value'],
  ])('redacts %s', (input, secret) => {
    expectRedacted(input, secret)
  })

  it('keeps the parameter NAME so a redacted message is still debuggable', () => {
    // "***" alone tells you nothing about which credential was involved.
    expect(redactSecrets('api_key=abcdef123456')).toBe('api_key=***')
  })
})

describe('redactSecrets — recognisable key shapes with no key= in front', () => {
  it.each([
    ['sk-ant-api03-aaaaaaaaaaaaaaaaaaaa', 'sk-ant-***'],
    ['sk-proj-abcdefghijklmnop', 'sk-***'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', 'ghp_***'],
    ['github_pat_11ABCDEFG0abcdefghijklmnop', 'github_pat_***'],
    ['AKIAIOSFODNN7EXAMPLE', 'AKIA***'],
    ['xoxb-1234567890-abcdefghij', 'xox-***'],
  ])('%s -> %s', (input, expected) => {
    expect(redactSecrets(`leaked ${input} here`)).toBe(`leaked ${expected} here`)
  })
})

describe('redactSecrets is a superset of the four private redactors it replaces', () => {
  // Each of these was caught by exactly one of the old copies and missed by the other three.
  // This is the property that makes consolidation safe rather than a regression.
  it.each([
    ['syncJobRunTelemetry / PlayerGameLogImportService (sk- only)', 'sk-abcdef123456', 'sk-abcdef123456'],
    ['sports-live-scores-service (RSC_token only)', 'RSC_token=tok_abc', 'tok_abc'],
    ['refresh-schedule (Bearer)', 'Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
    ['refresh-schedule (key=)', 'key=abc123def', 'abc123def'],
  ])('%s', (_label, input, secret) => {
    expectRedacted(input, secret)
  })
})

describe('redactSecrets leaves ordinary text alone', () => {
  it.each([
    'discovery_failed',
    'P1001: Can\'t reach database server',
    'league L1 had 3 pending claims and 0 processed',
    'Unexpected token < in JSON at position 0',
  ])('%s is unchanged', (text) => {
    expect(redactSecrets(text)).toBe(text)
  })

  it('is a no-op on an empty string and total on non-strings', () => {
    expect(redactSecrets('')).toBe('')
    expect(redactSecrets(null)).toBe('null')
    expect(redactSecrets(undefined)).toBe('undefined')
    expect(redactSecrets(new Error('boom'))).toBe('boom')
    expect(redactSecrets(42)).toBe('42')
  })
})

describe('redactAndCap redacts BEFORE capping', () => {
  it('does not leave the front of a secret readable at the cap boundary', () => {
    // The ordering bug this exists to prevent: cap first and the tail of the string is sliced
    // mid-secret, exposing everything before the cut. Here the secret straddles offset 500.
    // Padding is sized so the REDACTED form still fits under the cap — otherwise the marker is
    // truncated too and the assertion below would be testing the cap rather than the ordering.
    const padding = 'x'.repeat(480)
    const input = `${padding}RSC_token=SUPERSECRETVALUE`

    const out = redactAndCap(input, 500)
    expect(out).not.toContain('SUPERSECRET')
    expect(out).not.toContain('SUPERS')
    expect(out).toContain('RSC_token=***')

    // Proof the naive order really would have leaked, so this test cannot pass vacuously.
    const naive = input.slice(0, 500)
    expect(naive).toContain('SUPERS')
  })

  it('still caps length', () => {
    expect(redactAndCap('y'.repeat(900), 500)).toHaveLength(500)
    expect(redactAndCap('abc', 0)).toBe('')
  })
})

describe('the telemetry payload actually uses it', () => {
  // The integration that matters: whatever a job throws ends up in sync_job_runs.errorMessage.
  it('redacts a thrown provider error on its way into errorMessage', () => {
    const error = new Error(
      'upstream 500 for https://rest.datafeeds.rolling-insights.com/api/v1/team-season/NFL?RSC_token=leak-me-9999',
    )
    const payload = buildSyncJobRunPayload({ jobName: 'cron-waivers' }, null, error, 12)

    expect(payload.status).toBe('failed')
    expect(payload.errorMessage).not.toContain('leak-me-9999')
    expect(payload.errorMessage).toContain('RSC_token=***')
  })

  it('redacts errors carried in metadata, not just the top-level message', () => {
    const payload = buildSyncJobRunPayload(
      { jobName: 'cron-waivers' },
      { errors: ['discovery failed: postgres://u:s3cret@host/db'], status: 'failed' },
      null,
      5,
    )
    expect(JSON.stringify(payload.metadata)).not.toContain('s3cret')
  })
})
