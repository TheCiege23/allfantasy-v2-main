#!/usr/bin/env node
/**
 * Live shape probe for xAI `x_search`.
 *
 *   node scripts/x-news-probe.mjs "Player Name"
 *   node scripts/x-news-probe.mjs "Player Name" --raw
 *
 * Confirms against the REAL API that the fields lib/ai/xNewsSearch.ts depends on
 * actually exist — specifically `output[].content[].annotations` (citations) and
 * `usage.num_sources_used`. If xAI changes either, this fails loudly here rather
 * than silently returning zero citations in production.
 *
 * NOT one search call. Grok decides its own retrieval budget: an observed run on
 * 2026-08-27 issued 15 (`usage.server_side_tool_usage_details.x_search_calls`),
 * mixing keyword, semantic, thread-fetch and user searches, and reported
 * `cost_in_usd_ticks: 1377980000`. Server-side tools bill per call, so treat one
 * invocation as a double-digit multiple of a plain completion. Run it when
 * something changes, never in a loop, and never from a request path.
 */

import fs from 'node:fs'
import path from 'node:path'

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

const subject = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ')
const showRaw = process.argv.includes('--raw')
if (!subject) {
  console.error('Usage: node scripts/x-news-probe.mjs "Player Name" [--raw]')
  process.exit(2)
}

const apiKey = process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim()
if (!apiKey) {
  console.error('No XAI_API_KEY / GROK_API_KEY found in .env.local or .env')
  process.exit(2)
}

const baseUrl = (process.env.XAI_BASE_URL?.trim() || 'https://api.x.ai/v1')
  .replace(/\/+$/, '')
  .replace(/\/(chat\/completions|responses)$/i, '')
const model = process.env.XAI_MODEL?.trim() || 'grok-4.5'

const handles = (process.env.X_SEARCH_HANDLES_NFL?.trim() || 'AdamSchefter,RapSheet,TomPelissero,MikeGarafolo,FieldYates')
  .split(',').map((h) => h.trim().replace(/^@/, '')).filter(Boolean)

const fromDate = new Date(Date.now() - 48 * 3600_000).toISOString().slice(0, 10)

console.log(`\nsubject   ${subject}`)
console.log(`model     ${model}`)
console.log(`handles   ${handles.length ? handles.join(', ') : '(none — searching all of X)'}`)
console.log(`from_date ${fromDate}\n`)

const body = {
  model,
  input: [
    {
      role: 'system',
      content:
        'You report what sources on X actually said. Never speculate, never give fantasy advice. ' +
        'Respond with a single JSON object: {"summary": string, "bullets": string[]}. ' +
        'Return empty values if nothing relevant was found.',
    },
    {
      role: 'user',
      content: `Latest injury status, practice participation, and inactive/active designation for ${subject}.`,
    },
  ],
  tools: [
    {
      type: 'x_search',
      from_date: fromDate,
      ...(handles.length ? { allowed_x_handles: handles } : {}),
    },
  ],
  temperature: 0,
  max_output_tokens: 700,
}

const started = Date.now()
const res = await fetch(`${baseUrl}/responses`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body),
})

const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}\n${text.slice(0, 800)}`)
  process.exitCode = 1
}

// A 200 carrying a non-JSON body is itself a contract break, and it must not
// look like a crash — that is the failure this probe exists to name.
let json = null
let parseError = null
if (res.ok) {
  try {
    json = JSON.parse(text)
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e)
  }
}
if (json && showRaw) {
  console.log(JSON.stringify(json, null, 2))
}

// Mirror the extraction lib/ai/xNewsSearch.ts performs. This runs under --raw
// too: --raw is the documented way to inspect a failed assumption, so skipping
// extraction there made every check report MISS on the one invocation you
// reach for when something is already wrong.
let outputText = null
const annotations = []
for (const item of json?.output ?? []) {
  if (item.type !== 'message' || !Array.isArray(item.content)) continue
  for (const c of item.content) {
    if (c.type === 'output_text' && typeof c.text === 'string' && outputText === null) outputText = c.text
    if (Array.isArray(c.annotations)) annotations.push(...c.annotations)
  }
}

const sourcesUsed = json?.usage?.num_sources_used
const toolsUsed = json?.usage?.num_server_side_tools_used

console.log(`HTTP ${res.status}  ${Date.now() - started}ms  status=${json?.status ?? '(no body)'}\n`)
if (parseError) console.log(`body did not parse as JSON: ${parseError}\n`)
console.log('--- model output ---')
console.log((outputText ?? '(no output_text found)').slice(0, 1200))

// Show the label toCitations() would actually produce, not the raw title. xAI
// sets `title` to a copy of `url`, so printing both listed every source twice
// and hid the fact that there is no human-readable label to show.
console.log(`\n--- citations (${annotations.length}) ---`)
for (const a of annotations.slice(0, 12)) {
  const url = a.url?.trim() ?? ''
  const title = a.title?.trim()
  const label = title && title !== url ? title : url.replace(/^https?:\/\//, '').slice(0, 80)
  console.log(`  ${label || '(no url)'}`)
}
if (!annotations.length) console.log('  (none returned)')
if (annotations.length && annotations.every((a) => a.title?.trim() === a.url?.trim())) {
  console.log('  note: every title is a copy of its url — no real labels available.')
}

console.log('\n--- assumptions xNewsSearch.ts depends on ---')
if (!json) {
  // A failed or unparseable request says nothing about the response contract.
  // Running the checks anyway prints five MISSes, which reads like the vendor
  // changed the shape when in fact we never got a body to look at.
  console.log('  skipped — no JSON body to check.')
  process.exitCode = 1
} else {
  const checks = [
    ['output[].content[].type === "output_text"', outputText !== null],
    ['output[].content[].annotations present', annotations.length > 0],
    ['annotations carry .url', annotations.some((a) => typeof a?.url === 'string')],
    ['usage.num_sources_used present', typeof sourcesUsed === 'number'],
    ['usage.num_server_side_tools_used present', typeof toolsUsed === 'number'],
  ]
  let failed = 0
  for (const [label, pass] of checks) {
    if (!pass) failed++
    console.log(`  ${pass ? 'ok  ' : 'MISS'} ${label}`)
  }
  console.log(
    `\nsources_used=${sourcesUsed ?? 'n/a'}  server_tools=${toolsUsed ?? 'n/a'}  annotations=${annotations.length}`,
  )
  if (typeof sourcesUsed === 'number' && sourcesUsed === 0 && annotations.length > 0) {
    console.log('  note: num_sources_used is 0 despite annotations — treat that field as unreliable.')
  }

  // An empty result has two causes that the numbers above cannot tell apart:
  // the model found nothing worth reporting (correct — the answer is "no news"),
  // or our extraction broke (a defect). Parse exactly the way xNewsSearch.ts
  // does and say which one happened, because guessing wrong in either direction
  // is expensive: one hides a bug, the other invents an outage.
  if (outputText === null) {
    console.log('  note: no output_text — EXTRACTION IS FAILING. This is not "no news".')
  } else {
    let parsed = null
    try {
      parsed = JSON.parse(outputText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    } catch {
      console.log('  note: output_text is not the JSON the prompt asked for — the lib keeps it as raw prose.')
    }
    if (parsed) {
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
      const bullets = Array.isArray(parsed.bullets)
        ? parsed.bullets.filter((b) => typeof b === 'string' && b.trim() !== '')
        : []
      if (!summary && bullets.length === 0) {
        console.log(
          annotations.length > 0
            ? '  note: well-formed EMPTY result. Posts matched the subject, none answered the question — a valid "no news".'
            : '  note: well-formed EMPTY result and no posts matched — a valid "no news".',
        )
      } else {
        console.log(`  note: model returned ${bullets.length} bullet(s) and ${summary ? 'a' : 'no'} summary.`)
      }
    }
  }
  if (failed) console.log(`\n${failed} assumption(s) not met — inspect with --raw.`)

  // Set exitCode rather than calling process.exit(): an immediate exit while
  // fetch's handles are still closing trips a libuv assertion on Windows
  // (UV_HANDLE_CLOSING in src\win\async.c). Letting the loop drain avoids it.
  process.exitCode = failed ? 1 : 0
}
