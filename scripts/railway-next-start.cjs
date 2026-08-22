'use strict'

const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const port = process.env.PORT || '3000'
const hostname = process.env.HOST || '0.0.0.0'
const parsedPort = Number(port)
const nextPort =
  process.env.AF_NEXT_INTERNAL_PORT ||
  String(Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort + 1 : 3001)
const nextHostname = '127.0.0.1'
const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')

function findBodyStart(html) {
  const candidates = ['<div', '<main', '<section', '<header', '<nav', '<form']
    .map((needle) => html.indexOf(needle))
    .filter((index) => index > -1)

  return candidates.length > 0 ? Math.min(...candidates) : -1
}

function parseCookieHeader(cookieHeader) {
  const cookies = new Map()
  for (const pair of String(cookieHeader || '').split(';')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex < 0) continue
    const key = pair.slice(0, separatorIndex).trim()
    const value = pair.slice(separatorIndex + 1).trim()
    if (!key) continue
    try {
      cookies.set(key, decodeURIComponent(value))
    } catch {
      cookies.set(key, value)
    }
  }
  return cookies
}

function resolveDocumentPreferences(req) {
  const cookies = parseCookieHeader(req.headers.cookie)
  const lang = cookies.get('af_lang') === 'es' ? 'es' : 'en'
  const mode = cookies.get('af_mode')
  const dataMode = mode === 'dark' || mode === 'legacy' || mode === 'system' ? mode : 'light'

  return {
    lang,
    dataMode: dataMode === 'system' ? 'dark' : dataMode,
  }
}

function restoreDocumentShellIfNeeded(html, req) {
  if (/^<!DOCTYPE html><html[\s>]/i.test(html) || /^<html[\s>]/i.test(html)) {
    return { html, changed: false }
  }

  if (!/^(?:<meta|<link|<script|<title)/i.test(html)) {
    return { html, changed: false }
  }

  const bodyStart = findBodyStart(html)
  if (bodyStart < 0) {
    return { html, changed: false }
  }

  const headContent = html.slice(0, bodyStart)
  const bodyContent = html.slice(bodyStart)
  const { lang, dataMode } = resolveDocumentPreferences(req)
  const normalized = [
    '<!DOCTYPE html>',
    `<html lang="${lang}" data-lang="${lang}" data-mode="${dataMode}" class="scroll-smooth">`,
    '<head>',
    // Do NOT inject a stylesheet here. React never rendered this node, so it is an
    // extra child of <head> at hydration time -> React #418 -> #423 -> the document
    // is torn down and every page renders blank. Next's own
    // /_next/static/css/*.css links are already inside headContent.
    headContent,
    '</head>',
    '<body class="antialiased min-h-screen mode-readable" style="background:var(--bg);color:var(--text)">',
    bodyContent,
  ].join('')

  return { html: normalized, changed: true }
}

function forwardRequest(req, res) {
  const headers = { ...req.headers, host: `${nextHostname}:${nextPort}` }
  delete headers['accept-encoding']

  const upstream = http.request(
    {
      hostname: nextHostname,
      port: nextPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      const contentType = String(upstreamRes.headers['content-type'] || '')
      const isHtml = contentType.includes('text/html')

      if (!isHtml) {
        res.writeHead(upstreamRes.statusCode || 500, {
          ...upstreamRes.headers,
          'x-af-railway-proxy': '1',
        })
        upstreamRes.pipe(res)
        return
      }

      const chunks = []
      upstreamRes.on('data', (chunk) => chunks.push(chunk))
      upstreamRes.on('end', () => {
        const original = Buffer.concat(chunks).toString('utf8')
        const normalized = restoreDocumentShellIfNeeded(original, req)
        const body = Buffer.from(normalized.html)
        const responseHeaders = { ...upstreamRes.headers, 'x-af-railway-proxy': '1' }

        delete responseHeaders['content-encoding']
        delete responseHeaders['transfer-encoding']
        responseHeaders['content-length'] = String(body.length)
        // DIAGNOSTIC: what Next actually emits before the proxy touches it.
        responseHeaders['x-af-raw-prefix'] = encodeURIComponent(original.slice(0, 200))
        responseHeaders['x-af-raw-len'] = String(original.length)
        if (normalized.changed) {
          responseHeaders['x-af-railway-shell-normalized'] = '1'
        }

        res.writeHead(upstreamRes.statusCode || 200, responseHeaders)
        res.end(body)
      })
    },
  )

  upstream.on('error', (error) => {
    console.error('[railway-next-start] upstream request failed:', error)
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    }
    res.end('Bad gateway')
  })

  req.pipe(upstream)
}

function startRailwayNext() {
  console.log(`[railway-next-start] starting next on ${nextHostname}:${nextPort}`)

  const child = spawn(process.execPath, [nextBin, 'start', '-p', nextPort, '-H', nextHostname], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  const server = http.createServer(forwardRequest)
  let shuttingDown = false

  function shutdown(code = 0) {
    server.close(() => process.exit(code))
    setTimeout(() => process.exit(code), 1000).unref()
  }

  function forward(signal) {
    if (shuttingDown) return
    shuttingDown = true
    if (!child.killed) child.kill(signal)
    shutdown(0)
  }

  server.listen(Number(port), hostname, () => {
    console.log(`[railway-next-start] proxy listening on ${hostname}:${port}`)
  })

  process.on('SIGTERM', () => forward('SIGTERM'))
  process.on('SIGINT', () => forward('SIGINT'))

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[railway-next-start] next exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    shuttingDown = true
    shutdown(code ?? 1)
  })

  return { child, server }
}

if (require.main === module) {
  startRailwayNext()
}

module.exports = {
  findBodyStart,
  forwardRequest,
  parseCookieHeader,
  resolveDocumentPreferences,
  restoreDocumentShellIfNeeded,
  startRailwayNext,
}
