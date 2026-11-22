'use strict'
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/** Run the existing CSS validation in a killable process; never turn a timeout into a pass. */
function runLayoutCssGate(distDir, { timeoutMs = 120_000, spawn = spawnSync, log = console.log } = {}) {
  const started = Date.now()
  log(`[next-build] layout CSS gate starting (timeout ${timeoutMs}ms)`)
  const result = spawn(process.execPath, [path.join(__dirname, 'layout-css-gate.cjs'), distDir], {
    stdio: 'inherit', timeout: timeoutMs, killSignal: 'SIGKILL',
  })
  const ok = !result.error && !result.signal && result.status === 0
  log(`[next-build] layout CSS gate ${ok ? 'passed' : 'failed'} after ${Date.now() - started}ms` +
    (result.error ? ` (${result.error.code || result.error.message})` : result.signal ? ` (${result.signal})` : ''))
  return { ok, problems: ok ? [] : ['Layout CSS validation failed or exceeded its time budget; build must not ship.'] }
}
module.exports = { runLayoutCssGate }
