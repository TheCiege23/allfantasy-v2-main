// @vitest-environment node
/**
 * "[geo] anonymizer block" — which service blocked a connection, and in what words.
 *
 * Added 2026-10-02 after the owner's own residential Optimum line was refused as a "proxy" for
 * ~3 minutes and then cleared on a re-check. Both vendors are asked with paid keys and nothing
 * recorded which one said yes, so the false positive could not be pinned on either.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(), fetchProxycheck: vi.fn() }))

import { __resetAnonymizerCache, resolveAnonymizerDetailByIp } from "@/lib/geo/anonymizerCache"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"
import {
  __resetAnonymizerBlockLog,
  combineAnonymizerDetail,
  describeAnonymizerBlock,
  logAnonymizerBlock,
  parseIpApiPayload,
  parseProxycheckPayload,
} from "@/lib/geo/geoIpParse"

/** RFC 5737 documentation addresses — never a real user's. */
const HOME_IP = "198.51.100.81"
const VPN_IP = "198.51.100.82"

const saved = { pc: process.env.PROXYCHECK_API_KEY, ipapi: process.env.IPAPI_KEY }
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  __resetAnonymizerCache()
  __resetAnonymizerBlockLog()
  process.env.PROXYCHECK_API_KEY = "test-proxycheck-key-not-real"
  process.env.IPAPI_KEY = "test-ipapi-key-not-real"
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
  process.env.PROXYCHECK_API_KEY = saved.pc
  process.env.IPAPI_KEY = saved.ipapi
})

const blockLines = () => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[geo]"))

describe("which signal decided", () => {
  it("names proxycheck, with its type, proxy flag and network", () => {
    const pc = parseProxycheckPayload(
      { status: "ok", [HOME_IP]: { proxy: "yes", type: "Residential", provider: "Cablevision Systems Corp." } },
      HOME_IP,
    )
    const detail = combineAnonymizerDetail({ tor: false, proxycheck: pc, ipapi: null })
    expect(detail).toMatchObject({ anonymized: true, kind: "proxy", decidedBy: "proxycheck" })
    expect(describeAnonymizerBlock("middleware", detail, { proxycheck: pc, ipapi: null })).toBe(
      "[geo] anonymizer flagged path=middleware decidedBy=proxycheck kind=proxy " +
        "proxycheck={answered:true,type:Residential,proxy:yes,network:Cablevision Systems Corp.} ipapi=not-asked",
    )
  })

  it("names ipapi when its network name carried the hint", () => {
    const pc = parseProxycheckPayload({ status: "ok", [HOME_IP]: { proxy: "no", type: "Residential" } }, HOME_IP)
    const ip = parseIpApiPayload({ country_code: "US", region_code: "NJ", org: "Example Proxy Networks" })
    const detail = combineAnonymizerDetail({ tor: false, proxycheck: pc, ipapi: ip })
    expect(detail.decidedBy).toBe("ipapi")
    expect(describeAnonymizerBlock("detectUserState", detail, { proxycheck: pc, ipapi: ip })).toContain(
      "ipapi={hint:proxy,org:Example Proxy Networks}",
    )
  })

  it("a clear verdict carries no decidedBy", () => {
    const pc = parseProxycheckPayload({ status: "ok", [HOME_IP]: { proxy: "no", type: "Residential" } }, HOME_IP)
    expect(combineAnonymizerDetail({ tor: false, proxycheck: pc, ipapi: null }).decidedBy).toBeUndefined()
  })
})

describe("the middleware path logs a fresh block — and never the address", () => {
  it("one line naming the vendor, with no IP in it", async () => {
    vi.mocked(fetchProxycheck).mockResolvedValue({
      status: "ok",
      [VPN_IP]: { proxy: "yes", type: "VPN", provider: "M247 Europe SRL" },
    })
    const detail = await resolveAnonymizerDetailByIp(VPN_IP)
    expect(detail).toMatchObject({ anonymized: true, decidedBy: "proxycheck" })
    const lines = blockLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("decidedBy=proxycheck kind=vpn")
    expect(lines.join("\n")).not.toContain(VPN_IP)
    expect(lines.join("\n")).not.toContain("test-proxycheck-key")
  })

  it("logs nothing for a clear connection", async () => {
    vi.mocked(fetchProxycheck).mockResolvedValue({ status: "ok", [HOME_IP]: { proxy: "no", type: "Residential" } })
    vi.mocked(fetchIpApi).mockResolvedValue({ country_code: "US", region_code: "NJ", org: "Optimum Online" })
    await resolveAnonymizerDetailByIp(HOME_IP)
    expect(blockLines()).toEqual([])
  })

  it("reports a block that a forced re-check then cleared — the false-positive signature", async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetchProxycheck).mockResolvedValueOnce({
        status: "ok",
        [HOME_IP]: { proxy: "yes", type: "Residential", provider: "Cablevision Systems Corp." },
      })
      expect((await resolveAnonymizerDetailByIp(HOME_IP)).anonymized).toBe(true)

      vi.advanceTimersByTime(15_000) // past the per-address forced-recheck floor
      vi.mocked(fetchProxycheck).mockResolvedValueOnce({ status: "ok", [HOME_IP]: { proxy: "no", type: "Residential" } })
      vi.mocked(fetchIpApi).mockResolvedValueOnce({ country_code: "US", region_code: "NJ", org: "Optimum Online" })
      expect((await resolveAnonymizerDetailByIp(HOME_IP, { fresh: true })).anonymized).toBe(false)

      const lines = blockLines()
      expect(lines.some((l) => l.includes("forced re-check cleared a block: was decidedBy=proxycheck kind=proxy"))).toBe(true)
      expect(lines.join("\n")).not.toContain(HOME_IP)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("throttle", () => {
  it("prints an identical line once per 10 minutes, then again", () => {
    const pc = parseProxycheckPayload({ status: "ok", [VPN_IP]: { proxy: "yes", type: "VPN" } }, VPN_IP)
    const detail = combineAnonymizerDetail({ tor: false, proxycheck: pc, ipapi: null })
    const t0 = 1_000_000
    expect(logAnonymizerBlock("detectUserState", detail, { proxycheck: pc, ipapi: null }, t0)).toBe(true)
    expect(logAnonymizerBlock("detectUserState", detail, { proxycheck: pc, ipapi: null }, t0 + 60_000)).toBe(false)
    expect(logAnonymizerBlock("detectUserState", detail, { proxycheck: pc, ipapi: null }, t0 + 11 * 60_000)).toBe(true)
    expect(blockLines()).toHaveLength(2)
  })

  it("strips control characters a vendor might put in a network name", () => {
    const pc = parseProxycheckPayload(
      { status: "ok", [VPN_IP]: { proxy: "yes", type: "VPN", provider: "Evil\nCorp\u0007" } },
      VPN_IP,
    )
    expect(pc.network).toBe("EvilCorp")
  })
})
