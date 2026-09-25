import { NextRequest } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PostHog asset proxy: /ingest/static/* and /ingest/array/* are rewritten here
 * (next.config.js) instead of straight to us-assets.i.posthog.com.
 *
 * ⚠ A NEXT.JS EXTERNAL REWRITE FORWARDS THE VISITOR'S CLOUDFLARE HEADERS, AND
 * us-assets.i.posthog.com IS ITSELF BEHIND CLOUDFLARE, WHICH REFUSES THEM:
 * 403 "DNS points to prohibited IP" (error 1000) on every page load, so the
 * exception-autocapture extension and the remote config never loaded. The
 * us.i.posthog.com rewrite (events, flags) is not on Cloudflare and was fine.
 * Same trap as lib/api/proxy-adapter (#1216): never forward cf-connecting-ip
 * (or any cf-* header) to a Cloudflare-fronted host. This fetch sends only an
 * Accept header, by construction.
 */
const UPSTREAM = "https://us-assets.i.posthog.com"
const ALLOWED_ROOTS = new Set(["static", "array"])
const PASSTHROUGH_HEADERS = ["content-type", "cache-control", "etag", "last-modified", "vary"]

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path || []
  if (path.length < 2 || !ALLOWED_ROOTS.has(path[0])) {
    return new Response("Not found", { status: 404 })
  }

  const url = `${UPSTREAM}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`
  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: { accept: req.headers.get("accept") || "*/*" },
      cache: "no-store",
    })
  } catch {
    return new Response("PostHog asset fetch failed", { status: 502 })
  }

  const headers = new Headers()
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
