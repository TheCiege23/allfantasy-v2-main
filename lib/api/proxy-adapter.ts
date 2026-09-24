import { NextRequest, NextResponse } from 'next/server'
import { getServedOrigin } from '@/lib/http/served-origin'
import { internalHopHeaders } from '@/lib/http/internalHop'

type ProxyOptions = {
  targetPath: string
  query?: Record<string, string | number | boolean | undefined>
  method?: string
  body?: unknown
}

function copyHeaders(req: NextRequest): Headers {
  const headers = new Headers()
  const cookie = req.headers.get('cookie')
  const authorization = req.headers.get('authorization')
  const contentType = req.headers.get('content-type')
  // The proxied fetch originates from the function itself, so the target sees the
  // platform's IP rather than the caller's. Forward the original client IP or every
  // proxied request looks like one caller to an IP-keyed rate limiter, collapsing
  // all proxied traffic into a single shared bucket.
  const forwardedFor = req.headers.get('x-forwarded-for')
  const realIp = req.headers.get('x-real-ip')

  if (cookie) headers.set('cookie', cookie)
  if (authorization) headers.set('authorization', authorization)
  if (contentType) headers.set('content-type', contentType)
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor)
  if (realIp) headers.set('x-real-ip', realIp)
  // 🛑 NEVER forward `cf-connecting-ip`. This self-call goes back out through the
  // public hostname, and Cloudflare REFUSES any request that arrives already
  // carrying that header: 403, error 1000 "DNS points to prohibited IP". It does
  // not overwrite it, as this file used to say. Forwarding it (#1199) broke every
  // proxied route in production — league list, standings, league sections, AI
  // waiver/trade advice — from the moment it deployed. Measured 2026-09-24:
  // `curl -H 'cf-connecting-ip: …' https://www.allfantasy.ai/api/health` → 403;
  // the same request with x-forwarded-for, x-real-ip, cookie or authorization
  // → 200. The cost of dropping it is that an IP-keyed limit on the TARGET sees
  // Railway's address, which is the state before #1199. The outer request has
  // already been geo- and VPN-checked on the real client by middleware.ts.

  return headers
}

export async function proxyToExisting(req: NextRequest, options: ProxyOptions): Promise<NextResponse> {
  const method = options.method || req.method
  // This proxy fetches our OWN routes. req.nextUrl.origin is the bind address
  // (https://0.0.0.0:8080 on Railway), so every proxied call failed its TLS handshake.
  const target = new URL(options.targetPath, getServedOrigin(req))

  const currentQuery = req.nextUrl.searchParams
  for (const [k, v] of currentQuery.entries()) {
    if (!target.searchParams.has(k)) target.searchParams.set(k, v)
  }

  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null) continue
      target.searchParams.set(k, String(v))
    }
  }

  let body: string | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    if (options.body !== undefined) {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
    } else {
      const raw = await req.text()
      body = raw.length ? raw : undefined
    }
  }

  const headers = copyHeaders(req)
  // Cloudflare stamps this hop with Railway's data-centre address, which the VPN
  // gate would refuse; the signed marker says "already checked" — lib/http/internalHop.
  for (const [k, v] of Object.entries(await internalHopHeaders(method, target))) headers.set(k, v)

  const upstream = await fetch(target.toString(), {
    method,
    headers,
    body,
    cache: 'no-store',
  })

  const text = await upstream.text()
  const response = new NextResponse(text, { status: upstream.status })
  const ct = upstream.headers.get('content-type')
  if (ct) response.headers.set('content-type', ct)
  return response
}
