import { NextRequest, NextResponse } from 'next/server'

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

  return headers
}

export async function proxyToExisting(req: NextRequest, options: ProxyOptions): Promise<NextResponse> {
  const method = options.method || req.method
  const target = new URL(options.targetPath, req.nextUrl.origin)

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

  const upstream = await fetch(target.toString(), {
    method,
    headers: copyHeaders(req),
    body,
    cache: 'no-store',
  })

  const text = await upstream.text()
  const response = new NextResponse(text, { status: upstream.status })
  const ct = upstream.headers.get('content-type')
  if (ct) response.headers.set('content-type', ct)
  return response
}
