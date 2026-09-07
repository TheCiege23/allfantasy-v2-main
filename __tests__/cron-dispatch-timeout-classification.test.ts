import { spawn } from 'node:child_process'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// @ts-expect-error -- .mjs script, no types. Importable only because of the module's
// `invokedDirectly` guard; without that, this import would fire every slow-tier cron.
import { isTimeoutError } from '../scripts/cron-dispatch.mjs'

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/cron-dispatch.mjs',
)

/**
 * The slow-tier dispatcher retries a failed job once, and deliberately never retries a TIMEOUT:
 * a timed-out request was abandoned client-side, so the handler is very likely still running and
 * still writing. A second fire is then a concurrent double-ingest.
 *
 * That guard was classifying on `err.name === 'AbortError'`, which does not cover the ceiling that
 * actually fires. Node's global `fetch` enforces an undici `headersTimeout` of ~300s that no option
 * on the call can raise, and it surfaces as `TypeError: fetch failed` with `cause.code`. So the
 * real ceiling took the RETRY branch.
 *
 * Production, 2026-09-07, run 34122569411, no deploy or outage in the window:
 *
 *     12:38:58  /api/cron/import-schedules  300,007ms  499
 *     12:43:58  /api/cron/import-schedules  300,009ms  499   <- the wrongful retry
 *
 * ⚠ THE ERROR SHAPES BELOW ARE MEASURED, NOT INVENTED. Node v22.22.2, global `fetch`, against a
 * server that accepts the connection and never sends headers, AbortController set to 600_000:
 *     { name: 'TypeError', message: 'fetch failed', cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }
 * A synthesised error is only as good as the observation behind it; this one has one.
 */
describe('isTimeoutError', () => {
  it('recognises the undici headers timeout that global fetch actually enforces', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Headers Timeout Error'), {
        code: 'UND_ERR_HEADERS_TIMEOUT',
        name: 'HeadersTimeoutError',
      }),
    })
    // The old test, kept visible: this is precisely why it let the retry through.
    expect(err.name).not.toBe('AbortError')
    expect(isTimeoutError(err)).toBe(true)
  })

  it('recognises a body timeout, the same class reached mid-stream', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'UND_ERR_BODY_TIMEOUT' },
    })
    expect(isTimeoutError(err)).toBe(true)
  })

  it('still recognises the AbortController path it always covered', () => {
    expect(isTimeoutError(Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    }))).toBe(true)
  })

  it.each([
    ['ECONNREFUSED', 'the host is down'],
    ['ECONNRESET', 'the connection dropped mid-flight'],
    ['ENOTFOUND', 'DNS did not resolve'],
  ])('does NOT claim %s is a timeout (%s)', (code) => {
    // These are the cases the single retry exists FOR. Widening the timeout test to swallow them
    // would trade a double-run for a lost run, which is the opposite error and just as quiet.
    const err = Object.assign(new TypeError('fetch failed'), { cause: { code } })
    expect(isTimeoutError(err)).toBe(false)
  })
})

/** Run the real script against a local server and report how many requests reached it. */
function dispatchAgainst(
  handler: http.RequestListener,
  extraArgs: string[],
): Promise<{ hits: number; code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    let hits = 0
    const srv = http.createServer((req, res) => {
      hits += 1
      handler(req, res)
    })
    srv.setTimeout(0)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      const child = spawn(
        process.execPath,
        [SCRIPT, '--path', '/api/cron/import-stat-lines', ...extraArgs],
        {
          cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
          env: {
            ...process.env,
            APP_URL: `http://127.0.0.1:${port}`,
            CRON_SECRET: 'test-secret-never-a-real-one',
          },
        },
      )
      let out = ''
      child.stdout.on('data', (d) => { out += String(d) })
      child.stderr.on('data', (d) => { out += String(d) })
      child.on('error', reject)
      child.on('close', (code) => {
        srv.close()
        resolve({ hits, code, out })
      })
    })
  })
}

describe('the dispatcher end to end', () => {
  /**
   * 🛑 THE CONTROL FOR THE TEST BELOW. A "sent exactly one request" assertion is worthless unless
   * this file can demonstrably SEE a retry, and a dispatcher that had quietly stopped retrying
   * anything would pass the timeout test for entirely the wrong reason.
   */
  it('retries a 5xx exactly once -- so two requests is what a retry looks like here', async () => {
    const { hits, code } = await dispatchAgainst((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{"error":"boom"}')
    }, [])
    expect(hits).toBe(2)
    expect(code).toBe(1)
  }, 30_000)

  it('does not retry a timeout, because the handler is still running', async () => {
    const { hits, code, out } = await dispatchAgainst(() => {
      /* accept the request and never answer it */
    }, ['--timeout', '800'])
    expect(hits).toBe(1)
    expect(code).toBe(1)
    // Reports the clock, not the budget. Quoting `timeoutMs` is how a 300s ceiling read as
    // "timed out after 600000ms" and nobody looked twice.
    expect(out).toMatch(/timed out after \d+ms/)
    expect(out).not.toContain('timed out after 800ms (NOT')
  }, 30_000)
})
