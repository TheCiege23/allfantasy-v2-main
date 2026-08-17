/**
 * Spotify scope contract.
 *
 * Sign-in and the music widget authorize against the SAME Spotify app through two separate
 * flows. When their scope lists drifted, both broke at once: next-auth's default
 * `user-read-email` alone is not enough for its own `/v1/me` userinfo step, which needs
 * `user-read-private` and answers 403 without it, and the resulting token carried no
 * playback scope for the Web Playback SDK.
 *
 * These are source assertions rather than a live OAuth run — the failure mode was a
 * hardcoded list quietly diverging, which is exactly what source assertions catch.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { SPOTIFY_SCOPES, SPOTIFY_SCOPE_LIST } from "@/lib/spotify/scopes"

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

describe("the shared scope list", () => {
  it("requests user-read-private — its absence is the 403 that broke sign-in", () => {
    expect(SPOTIFY_SCOPE_LIST).toContain("user-read-private")
  })

  it("requests user-read-email so next-auth can map the account", () => {
    expect(SPOTIFY_SCOPE_LIST).toContain("user-read-email")
  })

  it("carries the playback scopes the Web Playback SDK needs", () => {
    for (const scope of [
      "streaming",
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
    ]) {
      expect(SPOTIFY_SCOPE_LIST).toContain(scope)
    }
  })

  it("serializes space-delimited, as Spotify's scope parameter expects", () => {
    expect(SPOTIFY_SCOPES).toBe(SPOTIFY_SCOPE_LIST.join(" "))
    expect(SPOTIFY_SCOPES).not.toContain(",")
  })

  it("has no duplicates", () => {
    expect(new Set(SPOTIFY_SCOPE_LIST).size).toBe(SPOTIFY_SCOPE_LIST.length)
  })
})

describe("both flows consume the shared list — neither re-inlines its own", () => {
  const authTs = read("lib/auth.ts")
  const connectRoute = read("app/api/auth/spotify/route.ts")

  it("the NextAuth provider overrides the default scope with the shared list", () => {
    expect(authTs).toContain("SPOTIFY_SCOPES")
    // The provider default would otherwise silently win and 403 again.
    expect(authTs).toMatch(/SpotifyProvider\(\{[\s\S]{0,1500}authorization:/)
    expect(authTs).toMatch(/authorization:[\s\S]{0,200}scope: SPOTIFY_SCOPES/)
  })

  it("the custom connect flow uses the shared list", () => {
    expect(connectRoute).toContain("SPOTIFY_SCOPES")
  })

  it("neither file rebuilds a literal scope array", () => {
    // The original bug: two hardcoded lists that drifted apart.
    for (const source of [authTs, connectRoute]) {
      expect(source).not.toMatch(/['"]user-modify-playback-state['"]\s*,/)
    }
  })
})

describe("login copy no longer blames the browser for a provider failure", () => {
  it("drops the sign-in-cookie claim from both surfaces", () => {
    for (const rel of ["app/login/LoginContent.tsx", "app/auth/error/page.tsx"]) {
      expect(read(rel)).not.toContain("browser blocked the sign-in cookie")
    }
  })
})
