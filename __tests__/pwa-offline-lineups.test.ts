// @vitest-environment node
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  OFFLINE_LINEUP_CACHE,
  buildOfflineLineupSnapshot,
  offlineLineupKey,
  readOfflineLineupSnapshot,
  saveOfflineLineupSnapshot,
  type OfflineLineupSnapshot,
} from "@/lib/pwa/offlineLineupSnapshots"
import { PRIVATE_CACHE_PREFIXES } from "@/lib/pwa/signOutAndPurge"

const script = readFileSync("public/sw.js", "utf8")

/** A Cache Storage double with real per-name caches, `keys()` included. */
function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>()
  const keyOf = (k: Request | string) => (typeof k === "string" ? k : new URL(k.url).pathname)
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      put: async (k: Request | string, v: Response) => void store.set(keyOf(k), v),
      match: async (k: Request | string) => store.get(keyOf(k))?.clone(),
      keys: async () => [...store.keys()].map((p) => new Request(`https://www.allfantasy.ai${p}`)),
    }
  }
  return {
    stores,
    open: vi.fn(async (name: string) => cacheFor(name)),
    match: vi.fn(async (k: Request | string) => {
      for (const s of stores.values()) if (s.has(keyOf(k))) return s.get(keyOf(k))!.clone()
      return undefined
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  }
}

function worker(caches: ReturnType<typeof cacheStorage>) {
  const listeners = new Map<string, (event: any) => void>()
  const self = {
    location: { origin: "https://www.allfantasy.ai" },
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    clients: { claim: async () => {} },
    registration: {},
    skipWaiting: async () => {},
  }
  const fetch = vi.fn(async () => { throw new Error("network down") })
  runInNewContext(script, { self, caches, fetch, URL, Request, Response, console })
  async function navigate() {
    let response: Promise<Response> | undefined
    listeners.get("fetch")!({
      request: { method: "GET", mode: "navigate", url: "https://www.allfantasy.ai/core" },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (value: Promise<Response>) => { response = value },
    })
    return response!
  }
  async function activate() {
    let work: Promise<unknown> | undefined
    listeners.get("activate")!({ waitUntil: (p: Promise<unknown>) => { work = p } })
    await work
  }
  return { navigate, activate }
}

const snapshot = (over: Partial<OfflineLineupSnapshot> = {}): OfflineLineupSnapshot => ({
  v: 1,
  leagueId: "lg1",
  leagueName: "Sunday League",
  sport: "NFL",
  teamName: "The <Bombers>",
  week: 9,
  savedAt: "2026-10-30T17:00:00.000Z",
  starters: [
    { slot: "QB", name: "Joe Burrow", position: "QB", team: "CIN", game: "vs PIT", injury: null },
    { slot: "FLEX", name: null, position: null, team: null, game: null, injury: null },
  ],
  bench: [{ slot: "BN", name: "<img src=x onerror=alert(1)>", position: "WR", team: "DAL", game: null, injury: "Questionable" }],
  ir: [],
  taxi: [],
  ...over,
})

async function seed(caches: ReturnType<typeof cacheStorage>, s: OfflineLineupSnapshot) {
  const c = await caches.open(OFFLINE_LINEUP_CACHE)
  await c.put(offlineLineupKey(s.leagueId), new Response(JSON.stringify(s)))
}

describe("offline lineup snapshots — the cache name is shared by three files", () => {
  it("the worker uses the same cache name as the page module", () => {
    expect(script).toContain("const APP_NAME = 'AllFantasy';")
    expect(script).toContain("const CACHE_OFFLINE_LINEUPS = `${APP_NAME}-pages-offline-lineups`;")
    expect(OFFLINE_LINEUP_CACHE).toBe("AllFantasy-pages-offline-lineups")
  })

  it("sign-out purges it, so the next person on a shared device cannot see this lineup", () => {
    expect(PRIVATE_CACHE_PREFIXES.some((p) => OFFLINE_LINEUP_CACHE.startsWith(p))).toBe(true)
  })

  it("a worker update keeps the saved lineups but still drops stale versioned caches", async () => {
    const caches = cacheStorage()
    await seed(caches, snapshot())
    await caches.open("AllFantasy-pages-v1.0.7")
    await worker(caches).activate()
    expect(caches.stores.has(OFFLINE_LINEUP_CACHE)).toBe(true)
    expect(caches.stores.has("AllFantasy-pages-v1.0.7")).toBe(false)
  })
})

describe("offline cold launch", () => {
  it("shows the saved lineup, escaped, instead of the plain offline page", async () => {
    const caches = cacheStorage()
    await seed(caches, snapshot())
    ;(await caches.open("AllFantasy-static-v1.0.8")).put("/offline", new Response("offline help"))

    const html = await (await worker(caches).navigate()).text()
    expect(html).toContain("Joe Burrow")
    expect(html).toContain("Sunday League · Week 9")
    expect(html).toContain("The &lt;Bombers&gt;")
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("Questionable")
    expect(html).toContain("Changes are off until you reconnect")
    expect(html).not.toContain("offline help")
  })

  it("falls back to the plain offline page when nothing usable is saved", async () => {
    const caches = cacheStorage()
    await seed(caches, { ...snapshot(), v: 2 } as unknown as OfflineLineupSnapshot)
    ;(await caches.open("AllFantasy-static-v1.0.8")).put("/offline", new Response("offline help"))
    expect(await (await worker(caches).navigate()).text()).toBe("offline help")
  })
})

describe("buildOfflineLineupSnapshot", () => {
  it("keeps empty starter slots in place and drops empty bench entries", () => {
    const s = buildOfflineLineupSnapshot({
      leagueId: "lg1",
      leagueName: "L",
      sport: "NFL",
      teamName: "T",
      week: 3,
      slots: [
        { index: 0, label: "QB", allowedPositions: ["QB"], isFlexible: false },
        { index: 1, label: "FLEX", allowedPositions: ["RB", "WR"], isFlexible: true },
      ],
      lists: { starters: ["p1", ""], bench: ["", "p2"], ir: [], taxi: [], devy: [] },
      players: {
        p1: { id: "p1", name: "Joe Burrow", position: "QB", team: "CIN", opponent: "PIT", homeAway: "home" },
        p2: { id: "p2", name: "CeeDee Lamb", position: "WR", team: "DAL", opponent: "BYE", injuryStatus: "Out" },
      },
      now: new Date("2026-10-30T17:00:00Z"),
    })
    expect(s.starters.map((r) => [r.slot, r.name])).toEqual([["QB", "Joe Burrow"], ["FLEX", null]])
    expect(s.starters[0].game).toBe("vs PIT")
    expect(s.bench).toEqual([{ slot: "BN", name: "CeeDee Lamb", position: "WR", team: "DAL", game: "Bye week", injury: "Out" }])
    expect(s.savedAt).toBe("2026-10-30T17:00:00.000Z")
  })
})

describe("save / read round trip", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads back what was saved, and nothing for another league or an unknown version", async () => {
    const caches = cacheStorage()
    vi.stubGlobal("caches", caches)
    expect(await saveOfflineLineupSnapshot(snapshot())).toBe(true)
    expect((await readOfflineLineupSnapshot("lg1"))?.teamName).toBe("The <Bombers>")
    expect(await readOfflineLineupSnapshot("other")).toBeNull()

    await seed(caches, { ...snapshot({ leagueId: "lg2" }), v: 2 } as unknown as OfflineLineupSnapshot)
    expect(await readOfflineLineupSnapshot("lg2")).toBeNull()
  })

  it("never throws when the Cache API is missing or broken", async () => {
    expect(await readOfflineLineupSnapshot("lg1")).toBeNull()
    vi.stubGlobal("caches", { open: async () => { throw new Error("blocked") } })
    expect(await saveOfflineLineupSnapshot(snapshot())).toBe(false)
    expect(await readOfflineLineupSnapshot("lg1")).toBeNull()
  })
})
