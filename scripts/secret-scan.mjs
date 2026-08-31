#!/usr/bin/env node
/**
 * Secret Exposure Scanner — static analysis for the AllFantasy codebase.
 *
 * Usage:
 *   node scripts/secret-scan.mjs              # exits 1 on findings
 *   node scripts/secret-scan.mjs --warn-only  # exits 0, prints warnings
 *
 * Checks:
 *   1. Hardcoded API key patterns in committed source files
 *   2. Server-only env vars accessed inside 'use client' files
 *   3. NEXT_PUBLIC_ vars that are NOT declared in .env.example
 *   4. Server-only env vars that should never be NEXT_PUBLIC_
 *
 * This script is intentionally zero-dependency (Node.js built-ins only).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, extname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const WARN_ONLY = process.argv.includes('--warn-only')

let exitCode = 0
const findings = []

function finding(severity, file, line, message) {
  const entry = { severity, file: relative(ROOT, file), line, message }
  findings.push(entry)
  if (severity === 'error') exitCode = 1
}

// ── File walker ───────────────────────────────────────────────────────────────

function* walkFiles(dir, extensions = ['.ts', '.tsx', '.js', '.mjs']) {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const name = entry.name
      // Skip directories that are never source
      if (
        name === 'node_modules' ||
        name === '.next' ||
        name.startsWith('.next') ||  // any .next-dev-*, .next-build-*, etc.
        name === '.git' ||
        name === '.claude' ||
        name === 'coverage' ||
        name === '__pycache__' ||
        name === 'out' ||
        name === 'dist' ||
        name === '.turbo'
      ) continue
      yield* walkFiles(fullPath, extensions)
    } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
      yield fullPath
    }
  }
}

// ── Check 1: Hardcoded API key patterns ───────────────────────────────────────

const HARDCODED_KEY_PATTERNS = [
  // Google Cloud / Firebase API keys
  { pattern: /AIza[A-Za-z0-9_-]{35}/, name: 'Google Cloud / Tenor API key' },
  // Stripe live secret key
  { pattern: /sk_live_[A-Za-z0-9]{24,}/, name: 'Stripe live secret key' },
  // Stripe test secret key (warn, not error, but flag it)
  { pattern: /sk_test_[A-Za-z0-9]{24,}/, name: 'Stripe test secret key' },
  // OpenAI API key
  { pattern: /sk-[A-Za-z0-9]{32,}/, name: 'OpenAI API key' },
  // Resend API key (re_ followed by 24+ alphanum chars, not preceded by alphanum — avoids webpack identifiers)
  { pattern: /(?<![A-Za-z0-9_])re_[A-Za-z0-9]{24,}(?![A-Za-z0-9_])/, name: 'Resend API key' },
  // Sentry DSN with private auth
  { pattern: /https:\/\/[a-f0-9]{32}@[a-z0-9]+\.ingest\.sentry\.io/, name: 'Sentry DSN' },
  // Generic "token" patterns that look like real tokens
  { pattern: /\btoken\s*[:=]\s*["'][A-Za-z0-9_\-]{40,}["']/, name: 'Potential auth token' },
  // AWS access key
  { pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS access key' },
]

// Files/patterns to skip for hardcoded key checks
const HARDCODED_SKIP_PATHS = [
  '.env.example',
  '.env.local.example',
  'scripts/secret-scan.mjs',  // this file itself contains patterns
  '__tests__/',
  '.test.',
  '.spec.',
  'node_modules/',
]

function shouldSkipForHardcodedCheck(filePath) {
  const rel = relative(ROOT, filePath)
  return HARDCODED_SKIP_PATHS.some((skip) => rel.includes(skip))
}

console.log('[secret-scan] Checking for hardcoded API key patterns...')
for (const file of walkFiles(ROOT)) {
  if (shouldSkipForHardcodedCheck(file)) continue
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip comment-only lines and import/require statements for patterns
    if (/^\s*(\/\/|#|\*)/.test(line)) continue
    for (const { pattern, name } of HARDCODED_KEY_PATTERNS) {
      if (pattern.test(line)) {
        // Skip if it looks like a test fixture value or env var reference
        if (
          line.includes('process.env.') ||
          line.includes('placeholder') ||
          line.includes('example') ||
          line.includes('replace-with') ||
          line.includes('your-')
        ) continue
        finding('error', file, i + 1, `Hardcoded ${name} detected: ${line.trim().slice(0, 80)}`)
      }
    }
  }
}

// ── Check 2: Server-only secrets in 'use client' files ────────────────────────

const SERVER_ONLY_SECRETS = [
  'NEXTAUTH_SECRET',
  'AUTH_SECRET',
  'DATABASE_URL',
  'DIRECT_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'NEON_DATABASE_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'REDIS_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SENTRY_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'AI_INTEGRATIONS_OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'XAI_API_KEY',
  'GROK_API_KEY',
  'RESEND_API_KEY',
  'LEAGUE_AUTH_ENCRYPTION_KEY',
  'LEAGUE_CRON_SECRET',
  'SESSION_SECRET',
  'ADMIN_SESSION_SECRET',
  'ADMIN_PASSWORD',
  'ROLLING_INSIGHTS_CLIENT_SECRET',
  'ROLLING_INSIGHTS_CLIENT_SECRET2',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_BOT_TOKEN',
]

const SERVER_SECRET_PROCESS_ENV_PATTERNS = SERVER_ONLY_SECRETS.map((k) => ({
  key: k,
  pattern: new RegExp(`process\\.env\\.${k}(?![_A-Z])`),
}))

// Directories where client components live
const CLIENT_SOURCE_DIRS = [
  join(ROOT, 'app'),
  join(ROOT, 'components'),
  join(ROOT, 'pages'),
]

console.log('[secret-scan] Checking server-only secrets in client components...')
for (const dir of CLIENT_SOURCE_DIRS) {
  if (!existsSync(dir)) continue
  for (const file of walkFiles(dir, ['.ts', '.tsx'])) {
    // Only check files that are client-side
    const rel = relative(ROOT, file)
    // Skip API routes — they're server-side
    if (rel.includes('/api/') || rel.includes('\\api\\')) continue
    // Skip test files
    if (rel.includes('.test.') || rel.includes('.spec.')) continue

    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    // Only flag files that are actually client components or might be client-bundled
    const isClientFile = content.includes("'use client'") || content.includes('"use client"')
    // For pages dir and components without 'use server', assume client-bundled if imported
    // We check both 'use client' files AND files without explicit server marker for safety
    const isNotExplicitlyServer = !content.includes("'use server'") && !content.includes('"use server"')

    if (!isClientFile && !isNotExplicitlyServer) continue

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Skip comment lines
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue
      for (const { key, pattern } of SERVER_SECRET_PROCESS_ENV_PATTERNS) {
        if (pattern.test(line)) {
          const severity = isClientFile ? 'error' : 'warn'
          finding(
            severity,
            file,
            i + 1,
            `process.env.${key} accessed in ${isClientFile ? "'use client' file" : 'potentially client-bundled file'}`
          )
        }
      }
    }
  }
}

// ── Check 3: Server-only vars that must never be NEXT_PUBLIC_ ─────────────────

const NEVER_PUBLIC = [
  'NEXTAUTH_SECRET',
  'AUTH_SECRET',
  'DATABASE_URL',
  'DIRECT_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SENTRY_AUTH_TOKEN',
  'UPSTASH_REDIS_REST_TOKEN',
  'REDIS_URL',
  'OPENAI_API_KEY',
  'RESEND_API_KEY',
  'SESSION_SECRET',
  'ADMIN_SESSION_SECRET',
  'LEAGUE_AUTH_ENCRYPTION_KEY',
]

console.log('[secret-scan] Checking for server secrets named with NEXT_PUBLIC_ prefix...')
// Search .env.example and source for NEXT_PUBLIC_<never-public> patterns
const allFiles = [...walkFiles(ROOT, ['.ts', '.tsx', '.js', '.mjs', '.env.example'])]
for (const file of allFiles) {
  const rel = relative(ROOT, file)
  if (rel.includes('node_modules') || rel.includes('.git') || rel.includes('secret-scan.mjs')) continue
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const key of NEVER_PUBLIC) {
      if (line.includes(`NEXT_PUBLIC_${key}`)) {
        finding('error', file, i + 1, `NEXT_PUBLIC_${key} found — this secret must NEVER be a NEXT_PUBLIC_ var: ${line.trim().slice(0, 80)}`)
      }
    }
  }
}

// ── Check 4: NEXT_PUBLIC_ vars not documented in .env.example ─────────────────

console.log('[secret-scan] Cross-checking NEXT_PUBLIC_ vars against .env.example...')
const envExamplePath = join(ROOT, '.env.example')
const envExampleContent = existsSync(envExamplePath) ? readFileSync(envExamplePath, 'utf8') : ''

const usedNextPublicVars = new Set()
for (const file of walkFiles(join(ROOT, 'app'), ['.ts', '.tsx'])) {
  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }
  const matches = content.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z_0-9]+)/g)
  for (const [, key] of matches) usedNextPublicVars.add(key)
}
for (const file of walkFiles(join(ROOT, 'components'), ['.ts', '.tsx'])) {
  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }
  const matches = content.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z_0-9]+)/g)
  for (const [, key] of matches) usedNextPublicVars.add(key)
}
for (const file of walkFiles(join(ROOT, 'lib'), ['.ts'])) {
  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }
  const matches = content.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z_0-9]+)/g)
  for (const [, key] of matches) usedNextPublicVars.add(key)
}

for (const key of usedNextPublicVars) {
  if (!envExampleContent.includes(key)) {
    finding('warn', envExamplePath, 0, `${key} is used in source but not documented in .env.example`)
  }
}

// ── Check 5: real credentials in TRACKED .env* files ──────────────────────────
//
// 🛑 .gitignore DOES NOT PROTECT A FILE THAT IS ALREADY TRACKED. `.env*` is in
// .gitignore (line 131), which is why an untracked `.env` or `.env.prod-deploy`
// cannot be committed by accident. But `.env.example`, `.env.local.example` and
// `.env.production` are already tracked, so the ignore rule is silent about them
// forever — anyone who pastes a real value into one and commits it publishes it.
// This repo is public, so that is a live credential disclosure, not a lint issue.
//
// The risk is not hypothetical-looking: `.env.example` carries 194 non-empty
// values including two postgres URLs. Every one is a placeholder today. Nothing
// checked that, and nothing would have noticed the day one stopped being one.
//
// ⚠ THIS CHECK NEVER PRINTS A VALUE. A scanner that echoes the secret it found
// into CI logs has moved the leak rather than closed it. Findings name the FILE,
// LINE and KEY, plus why it looked real — which is enough to fix it and useless
// to an attacker reading a build log.
//
// Deliberately conservative: it errors only on high-confidence shapes. A noisy
// secret scanner gets disabled, and a disabled scanner is worse than none because
// its presence is read as coverage.

const PLACEHOLDER_MARKERS =
  /(your|change|placeholder|example|xxx+|replace|dummy|redacted|generate|todo|\.\.\.|^<.*>$|^""$|^''$)/i

// Vendor prefixes that are only ever emitted by the real issuer.
const LIVE_TOKEN_PATTERNS = [
  { re: /sk-[A-Za-z0-9_-]{20,}/, what: 'OpenAI-style secret key' },
  { re: /(ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}/, what: 'GitHub token' },
  { re: /github_pat_[A-Za-z0-9_]{30,}/, what: 'GitHub fine-grained PAT' },
  { re: /xox[bpars]-[A-Za-z0-9-]{10,}/, what: 'Slack token' },
  { re: /re_[A-Za-z0-9_]{20,}/, what: 'Resend API key' },
  { re: /(sk|pk|rk)_live_[A-Za-z0-9]{20,}/, what: 'Stripe live key' },
  { re: /AKIA[0-9A-Z]{16}/, what: 'AWS access key id' },
  { re: /AIza[0-9A-Za-z_-]{35}/, what: 'Google API key' },
]

function looksLikeRealPostgresUrl(value) {
  const m = value.match(/postgres(?:ql)?:\/\/[^:\s]+:([^@\s]+)@([^/\s"']+)/)
  if (!m) return null
  const [, password, host] = m
  if (PLACEHOLDER_MARKERS.test(password) || PLACEHOLDER_MARKERS.test(host)) return null
  if (/^(localhost|127\.0\.0\.1|::1|db|postgres)(:\d+)?$/i.test(host)) return null
  // A real Neon endpoint is ep-<word>-<word>-<alnum>; the doc placeholder is ep-xxx.
  const neon = /ep-[a-z]+-[a-z]+-[a-z0-9]{6,}/.test(host)
  if (!neon && password.length < 12) return null
  return neon ? 'Neon endpoint with a non-placeholder password' : 'database URL with a real-looking password'
}

console.log('[secret-scan] Checking tracked .env* files for real credentials...')

let trackedEnvFiles = []
try {
  trackedEnvFiles = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((p) => /(^|\/)\.env($|\.)/.test(p))
} catch {
  // ⚠ Fail LOUD, not open. Every other guard in this repo fails open because the
  // cost of a false stop is a blocked deploy. Here the cost of a false pass is a
  // published credential, which is not recoverable by rotating a build.
  finding('error', join(ROOT, '.env'), 0, 'could not list tracked env files via git; secret scan is UNVERIFIED')
}

for (const rel of trackedEnvFiles) {
  const full = join(ROOT, rel)
  if (!existsSync(full)) continue
  const lines = readFileSync(full, 'utf8').split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const eq = line.indexOf('=')
    if (eq < 1) return
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return
    let value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!value) return

    const pg = looksLikeRealPostgresUrl(value)
    if (pg) {
      finding('error', full, i + 1, `${key} looks like a REAL credential (${pg}) in a tracked file — this repo is public`)
      return
    }
    for (const { re, what } of LIVE_TOKEN_PATTERNS) {
      if (re.test(value)) {
        finding('error', full, i + 1, `${key} looks like a REAL credential (${what}) in a tracked file — this repo is public`)
        return
      }
    }
    if (value.length >= 32 && /^[A-Za-z0-9+/_=-]+$/.test(value) && !PLACEHOLDER_MARKERS.test(value)) {
      finding('error', full, i + 1, `${key} is a ${value.length}-char high-entropy value in a tracked file with no placeholder marker — this repo is public`)
    }
  })
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log('')
if (findings.length === 0) {
  console.log('[secret-scan] ✅ No issues found.')
  process.exit(0)
}

const errors = findings.filter((f) => f.severity === 'error')
const warnings = findings.filter((f) => f.severity === 'warn')

if (warnings.length > 0) {
  console.log(`[secret-scan] ⚠️  ${warnings.length} warning(s):`)
  for (const w of warnings) {
    console.log(`  WARN  ${w.file}:${w.line}  ${w.message}`)
  }
}

if (errors.length > 0) {
  console.log(`[secret-scan] ❌ ${errors.length} error(s):`)
  for (const e of errors) {
    console.log(`  ERROR ${e.file}:${e.line}  ${e.message}`)
  }
}

if (WARN_ONLY) {
  console.log('[secret-scan] Running in --warn-only mode; exiting 0.')
  process.exit(0)
}

process.exit(exitCode)
