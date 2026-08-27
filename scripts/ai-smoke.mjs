#!/usr/bin/env node
/**
 * AI provider smoke test.
 *
 *   node scripts/ai-smoke.mjs
 *
 * Sends one tiny request to every configured provider and reports HTTP status,
 * which env key was used, the resolved model, and the reply. Costs a fraction of
 * a cent total. Run this after changing keys, models, or billing state.
 *
 * Exit code 0 if every provider with a key responded 200; 1 otherwise.
 */

import fs from 'node:fs'
import path from 'node:path'

// Next.js precedence: .env.local overrides .env
function loadEnv(file) {
  const full = path.resolve(process.cwd(), file)
  if (!fs.existsSync(full)) return
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    const val = m[2].trim().replace(/^["']|["']$/g, '')
    if (val && process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
loadEnv('.env.local')
loadEnv('.env')

const env = (...keys) => {
  for (const k of keys) {
    const v = process.env[k]?.trim()
    if (v) return { value: v, key: k }
  }
  return { value: '', key: null }
}
const fingerprint = (k) => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '—')
const TIMEOUT_MS = 30_000

const PROMPT = 'Reply with the single word: PONG'

const providers = [
  {
    label: 'DeepSeek',
    cred: env('DEEPSEEK_API_KEY'),
    model: env('DEEPSEEK_MODEL').value || 'deepseek-chat',
    url: () => `${(env('DEEPSEEK_BASE_URL').value || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`,
    dialect: 'openai',
  },
  {
    label: 'Grok/xAI',
    cred: env('XAI_API_KEY', 'GROK_API_KEY'),
    model: env('XAI_MODEL', 'GROK_MODEL').value || 'grok-2-latest',
    url: () => `${(env('XAI_BASE_URL', 'GROK_BASE_URL').value || 'https://api.x.ai/v1').replace(/\/+$/, '').replace(/\/(chat\/completions|responses)$/i, '')}/chat/completions`,
    dialect: 'openai',
  },
  {
    label: 'OpenAI',
    cred: env('OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY'),
    model: env('OPENAI_MODEL').value || 'gpt-4o-mini',
    url: () => `${(env('OPENAI_BASE_URL').value || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`,
    dialect: 'openai',
  },
  {
    label: 'Claude',
    cred: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL', 'ANTHROPIC_MODEL_STANDARD').value || 'claude-sonnet-5',
    url: () => 'https://api.anthropic.com/v1/messages',
    dialect: 'anthropic',
  },
]

function buildRequest(p) {
  if (p.dialect === 'anthropic') {
    return {
      headers: {
        'content-type': 'application/json',
        'x-api-key': p.cred.value,
        'anthropic-version': '2023-06-01',
      },
      body: { model: p.model, max_tokens: 16, messages: [{ role: 'user', content: PROMPT }] },
    }
  }
  return {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.cred.value}` },
    body: { model: p.model, max_tokens: 16, messages: [{ role: 'user', content: PROMPT }] },
  }
}

function extract(json) {
  return (
    json?.choices?.[0]?.message?.content ??
    json?.content?.find?.((b) => b.type === 'text')?.text ??
    json?.error?.message ??
    null
  )
}

// ── --models mode: ask each provider what THIS account can actually call ──────
if (process.argv.includes('--models')) {
  for (const p of providers) {
    const name = p.label.padEnd(9)
    if (!p.cred.value) {
      console.log(`\n${name} SKIP  no key set`)
      continue
    }
    const listUrl = p.url().replace(/\/(chat\/completions|messages)$/, '/models')
    const headers =
      p.dialect === 'anthropic'
        ? { 'x-api-key': p.cred.value, 'anthropic-version': '2023-06-01' }
        : { authorization: `Bearer ${p.cred.value}` }
    try {
      const res = await fetch(listUrl, { headers })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        console.log(`\n${name} HTTP ${res.status}  ${String(json?.error?.message ?? '').slice(0, 120)}`)
        continue
      }
      const ids = (json?.data ?? json?.models ?? [])
        .map((m) => m.id ?? m.name)
        .filter(Boolean)
        .sort()
      console.log(`\n${name} ${ids.length} model(s) available:`)
      for (const id of ids) console.log(`          ${id}`)
    } catch (err) {
      console.log(`\n${name} FAIL  ${err.name}: ${err.message}`)
    }
  }
  console.log('')
  process.exit(0)
}

const spendOn = process.env.AI_FEATURES_ENABLED?.trim() === 'true'
console.log(`\nAI_FEATURES_ENABLED = ${spendOn ? 'true  (provider spend permitted)' : `${process.env.AI_FEATURES_ENABLED ?? 'unset'}  ← app-level calls will throw 402`}`)
console.log(`AI_PROVIDER_ORDER   = ${process.env.AI_PROVIDER_ORDER?.trim() || 'unset (default: openai,anthropic,xai,deepseek)'}\n`)

let failures = 0
for (const p of providers) {
  const name = p.label.padEnd(9)
  if (!p.cred.value) {
    console.log(`${name} SKIP    no key set`)
    continue
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const { headers, body } = buildRequest(p)
    const res = await fetch(p.url(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const raw = await res.text()
    let reply
    try {
      reply = extract(JSON.parse(raw))
    } catch {
      reply = raw.slice(0, 140)
    }
    const ms = Date.now() - started
    const mark = res.ok ? 'OK  ' : 'FAIL'
    if (!res.ok) failures++
    console.log(
      `${name} ${mark}  ${String(res.status).padEnd(4)} ${String(ms + 'ms').padEnd(7)} ` +
        `${p.cred.key}=${fingerprint(p.cred.value)}  model=${p.model}\n` +
        `          ↳ ${String(reply ?? '(empty)').trim().replace(/\s+/g, ' ').slice(0, 150)}`,
    )
  } catch (err) {
    failures++
    const why = err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : `${err.name}: ${err.message}`
    console.log(`${name} FAIL   ${why}`)
  } finally {
    clearTimeout(timer)
  }
}

console.log(failures === 0 ? '\nAll configured providers responded.\n' : `\n${failures} provider(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
