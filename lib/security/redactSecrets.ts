/**
 * One redactor for secrets in free text — error messages, log lines, telemetry fields.
 *
 * WHY THIS EXISTS
 * The repo had FOUR private half-redactors, each covering whatever its author happened to think
 * of, and none covering the others' cases:
 *
 *   lib/production-health/syncJobRunTelemetry.ts   sk- only
 *   lib/sports-os/PlayerGameLogImportService.ts    sk- only
 *   lib/sports-live-scores-service.ts              RSC_token= only
 *   app/api/brackets/playoffs/.../refresh-schedule Bearer + key= only
 *
 * So a Rolling Insights token in a message reaching sync_job_runs was redacted by exactly none of
 * them. This function is a strict superset of all four, so each can delegate to it without losing
 * coverage.
 *
 * THE RULE IT ENFORCES (CLAUDE.md): `RSC_token` and the TheSportsDB key must never appear in logs,
 * error messages, client responses, or fixtures. Rolling Insights passes its token as a QUERY
 * PARAMETER, so any code that puts a URL in an error message leaks a long-lived credential.
 *
 * DESIGN
 * - Over-redaction is safe; under-redaction is a leak. When a pattern is ambiguous it redacts.
 * - Order matters. Connection strings run first because a later, narrower rule would only catch
 *   part of the credential and leave the rest readable.
 * - It does NOT truncate. Callers cap length themselves (they disagree: 240 vs 500), and
 *   truncating here would let a caller slice a secret in half before it was ever redacted.
 * - Pure and total: any input, including non-strings, returns a string.
 */

/**
 * Applied in order. Each entry keeps the identifying prefix so a redacted message still says WHAT
 * was removed — "RSC_token=***" is debuggable, a bare "***" is not.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // 1. Credentials embedded in a URL's authority: postgres://user:password@host/db.
  //    First, because rule 5 would otherwise redact only a trailing fragment of the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, "$1$2:***@"],

  // 2. TheSportsDB puts its API key in a PATH SEGMENT, not a query string, so no generic
  //    key=value rule can ever catch it: .../api/v1/json/<KEY>/eventsday.php
  [/(thesportsdb\.com\/api\/v\d+\/json\/)[^/\s"']+/gi, "$1***"],

  // 3. Rolling Insights. Needs its own rule: `_` is a word character, so rule 5's `token` never
  //    matches inside `RSC_token`.
  //
  //    NO \b ANCHOR, here or in rule 5. A leading \b requires a non-word character before the
  //    match, so a credential concatenated straight onto preceding text — which is exactly what a
  //    truncated or joined log line looks like — slips through untouched. Over-redaction is safe;
  //    a miss is a leak. The cost is that `monkey=1` redacts as `monkey=***`, which is fine in a
  //    telemetry field.
  [/RSC_?token(["']?\s*[=:]\s*["']?)[^&\s"',;}]+/gi, "RSC_token$1***"],

  // 4. Authorization headers, in either header or prose form.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***"],

  // 5. Generic credential-bearing parameters, in query-string, header and JSON form alike. The
  //    quotes belong INSIDE the separator group: a JSON body reads `"client_secret":"v"`, so a
  //    separator of just `[=:]` never matches — the key's closing quote sits in the way.
  [
    /(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|session[_-]?token|token|secret|password|passwd|pwd|signature|sig|key)(["']?\s*[=:]\s*["']?)[^&\s"',;}]+/gi,
    "$1$2***",
  ],

  // 6. Shapes that are recognisable on their own, with no `key=` in front of them. These are the
  //    ones that leak when a provider echoes a credential back inside a message body.
  [/\bsk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***"],
  //    The lookaheads keep this from re-redacting rule 6's own output: without them `sk-ant-***`
  //    is matched again on `sk-ant-` and becomes `sk-******`, which loses which vendor it was.
  [/\bsk-(?!ant-)(?!\*)[A-Za-z0-9_-]+/g, "sk-***"], // pre-existing behaviour, kept deliberately loose
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***"],
  [/\bghp_[A-Za-z0-9]{16,}/g, "ghp_***"],
  [/\bgh[opsu]_[A-Za-z0-9]{16,}/g, "gh_***"],
  [/\bnpg_[A-Za-z0-9]{12,}/g, "npg_***"], // Neon
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***"], // AWS access key id
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "xox-***"], // Slack
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "<jwt>"],
]

/**
 * Strip anything that looks like a credential out of free text.
 *
 * Safe to call on text that contains no secrets — it is a no-op then.
 */
export function redactSecrets(input: unknown): string {
  let text = typeof input === "string" ? input : input instanceof Error ? input.message : String(input)
  for (const [pattern, replacement] of RULES) {
    text = text.replace(pattern, replacement)
  }
  return text
}

/**
 * Redact, then cap. Always in that order: capping first can slice a secret in half and leave the
 * front of it readable, which is worse than either operation alone.
 */
export function redactAndCap(input: unknown, maxLength: number): string {
  return redactSecrets(input).slice(0, Math.max(0, maxLength))
}
