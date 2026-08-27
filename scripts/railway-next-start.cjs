/**
 * railway-next-start.cjs
 *
 * Starts Next on Railway. That is all it does.
 *
 * It used to run Next on PORT+1 behind an HTTP proxy that buffered every HTML
 * response and, when the document arrived without a shell, wrapped it in a
 * hand-built <!DOCTYPE html><html><head>…<body> before sending it on.
 *
 * That could not work, and it is why every page rendered for an instant and
 * then went blank. React hydrates against the document it rendered; a <html>
 * and <body> it never produced are a mismatch at the root, so hydration failed
 * with #418, escalated to #423, and the client re-render tore the document
 * down — "Failed to execute 'appendChild' on 'Node': Only one element on
 * document allowed", then an AggregateError, then an empty page. A missing
 * shell renders unstyled; a fabricated one renders nothing.
 *
 * It also hid the problem it was papering over: the fabricated
 * <body class="antialiased min-h-screen mode-readable"> in the served HTML was
 * this file's string literal, not the root layout's, so the output looked far
 * healthier than the build actually was.
 *
 * If HTML arrives without a document shell, fix the render. Do not re-add a
 * rewriter here.
 */
'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')

const port = process.env.PORT || '8080'
const hostname = process.env.HOST || '0.0.0.0'
const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')

console.log(`[railway-next-start] starting next on ${hostname}:${port}`)

const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', hostname], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

let shuttingDown = false

function forward(signal) {
  if (shuttingDown) return
  shuttingDown = true
  if (!child.killed) child.kill(signal)
}

process.on('SIGTERM', () => forward('SIGTERM'))
process.on('SIGINT', () => forward('SIGINT'))

child.on('exit', (code, signal) => {
  console.error(
    `[railway-next-start] next exited code=${code ?? 'null'} signal=${signal ?? 'null'}`,
  )
  process.exit(code ?? 1)
})
