/**
 * Google Play downloads on the admin dashboard.
 *
 * The failure this pins shut: a report that cannot be read must never render as
 * "0 downloads". Play's export is UTF-16LE, and decoding it as UTF-8 produces a
 * header that matches no column — so the parser returns null rather than an
 * empty row set, and the admin card goes NOT TRACKED rather than showing zero.
 */

import { generateKeyPairSync } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  decodeReport,
  getPlayInstallStats,
  parseOverviewReport,
  readPlayConfig,
  resetPlayInstallStatsCache,
  summarizeReports,
} from "@/lib/google-play/playInstallStats"
import { buildGooglePlayMetrics } from "@/lib/admin-dashboard/AdminCommandCenterService"

// Column set of a current Play Console installs overview export.
const HEADER =
  "Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events"

function row(date: string, userInstalls: number, active: number) {
  return `${date},ai.allfantasy.app,${userInstalls + 1},0,0,0,${userInstalls},0,${active},${userInstalls + 2},0,0`
}

function utf16(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])
}

describe("decodeReport", () => {
  it("decodes Play's UTF-16LE export (the format Google actually ships)", () => {
    const csv = `${HEADER}\n${row("2026-10-20", 5, 40)}`
    expect(decodeReport(utf16(csv))).toBe(csv)
  })

  it("passes UTF-8 through, with or without a BOM", () => {
    expect(decodeReport(Buffer.from("a,b"))).toBe("a,b")
    expect(decodeReport(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a,b")]))).toBe("a,b")
  })
})

describe("parseOverviewReport", () => {
  it("reads Daily User Installs and Active Device Installs", () => {
    const parsed = parseOverviewReport(`${HEADER}\n${row("2026-10-20", 5, 40)}\n${row("2026-10-21", 7, 46)}\n`)
    expect(parsed?.column).toBe("Daily User Installs")
    expect(parsed?.rows).toEqual([
      { date: "2026-10-20", installs: 5, activeDevices: 40 },
      { date: "2026-10-21", installs: 7, activeDevices: 46 },
    ])
  })

  it("falls back to Daily Device Installs on older exports", () => {
    const parsed = parseOverviewReport("Date,Package Name,Daily Device Installs\n2026-01-02,ai.allfantasy.app,3")
    expect(parsed?.column).toBe("Daily Device Installs")
    expect(parsed?.rows[0].installs).toBe(3)
    expect(parsed?.rows[0].activeDevices).toBeNull()
  })

  it("returns null, not zero rows, when the header is unreadable", () => {
    // Positive control for the UTF-16 trap: the same bytes decoded as UTF-8.
    const mangled = utf16(`${HEADER}\n${row("2026-10-20", 5, 40)}`).toString("utf8")
    expect(parseOverviewReport(mangled)).toBeNull()
    expect(parseOverviewReport("")).toBeNull()
  })
})

describe("summarizeReports", () => {
  it("sums all time, trailing 7 and 28 days from the newest report day, and de-duplicates days", () => {
    const days = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 15 + i)).toISOString().slice(0, 10)
      return { date: d, installs: 1, activeDevices: i }
    })
    const september = { column: "Daily User Installs", rows: days.slice(0, 16) }
    // October file repeats the last September day, as Google sometimes republishes.
    const october = { column: "Daily User Installs", rows: days.slice(15) }
    const stats = summarizeReports([september, october])
    expect(stats).toMatchObject({
      installsAllTime: 40,
      installs7Days: 7,
      installs28Days: 28,
      activeDevices: 39,
      latestDate: days[39].date,
      reportMonths: 2,
    })
  })
})

describe("readPlayConfig", () => {
  it("reports exactly which variables are missing", () => {
    expect(readPlayConfig({})).toEqual({
      ok: false,
      missing: ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "GOOGLE_PLAY_REPORTS_BUCKET"],
    })
  })

  it("accepts a base64 key and a gs:// bucket, and defaults the package", () => {
    const key = JSON.stringify({ client_email: "svc@x.iam.gserviceaccount.com", private_key: "-----BEGIN-----\\nabc" })
    const cfg = readPlayConfig({
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: Buffer.from(key).toString("base64"),
      GOOGLE_PLAY_REPORTS_BUCKET: "gs://pubsite_prod_123/",
    })
    expect(cfg.ok).toBe(true)
    if (cfg.ok) {
      expect(cfg.config.bucket).toBe("pubsite_prod_123")
      expect(cfg.config.packageName).toBe("ai.allfantasy.app")
      expect(cfg.config.serviceAccount.private_key).toBe("-----BEGIN-----\nabc")
    }
  })

  it("flags a value that is not a service-account key", () => {
    const cfg = readPlayConfig({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "nope", GOOGLE_PLAY_REPORTS_BUCKET: "b" })
    expect(cfg).toMatchObject({ ok: false, invalid: expect.stringContaining("not a service-account key") })
  })
})

describe("buildGooglePlayMetrics", () => {
  it("shows NOT TRACKED, never zero, when unconfigured or unreadable", () => {
    const unconfigured = buildGooglePlayMetrics({ status: "not_configured", missing: ["GOOGLE_PLAY_REPORTS_BUCKET"] })
    expect(unconfigured).toHaveLength(1)
    expect(unconfigured[0]).toMatchObject({ label: "Google Play downloads", tracked: false })
    expect(unconfigured[0].note).toContain("GOOGLE_PLAY_REPORTS_BUCKET")

    const failed = buildGooglePlayMetrics({ status: "error", reason: "Reports bucket not found" })
    expect(failed[0]).toMatchObject({ tracked: false, value: "Reports bucket not found" })
  })

  it("shows a real zero as tracked once reports load", () => {
    const metrics = buildGooglePlayMetrics({
      status: "ok",
      fetchedAt: "2026-10-24T00:00:00Z",
      stats: {
        installsAllTime: 0,
        installs7Days: 0,
        installs28Days: 0,
        activeDevices: null,
        latestDate: "2026-10-22",
        installColumn: "Daily User Installs",
        reportMonths: 1,
      },
    })
    expect(metrics.map((m) => [m.label, m.value, m.tracked])).toEqual([
      ["Google Play downloads", 0, true],
      ["Google Play downloads 7 days", 0, true],
      ["Google Play downloads 28 days", 0, true],
    ])
    expect(metrics[0].note).toContain("2026-10-22")
  })
})

describe("getPlayInstallStats (end to end with Google mocked)", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const fetchMock = vi.fn()

  beforeEach(() => {
    resetPlayInstallStatsCache()
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
      JSON.stringify({ client_email: "svc@x.iam.gserviceaccount.com", private_key: pem }),
    )
    vi.stubEnv("GOOGLE_PLAY_REPORTS_BUCKET", "pubsite_prod_123")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("exchanges a signed JWT, lists the overview reports and sums them", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 })
      }
      if (url.includes("/o?")) {
        expect(url).toContain(encodeURIComponent("stats/installs/installs_ai.allfantasy.app_"))
        return new Response(
          JSON.stringify({
            items: [
              { name: "stats/installs/installs_ai.allfantasy.app_202610_overview.csv" },
              { name: "stats/installs/installs_ai.allfantasy.app_202610_country.csv" },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.includes("alt=media")) {
        return new Response(utf16(`${HEADER}\n${row("2026-10-21", 4, 4)}\n${row("2026-10-22", 6, 10)}`), {
          status: 200,
        })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const result = await getPlayInstallStats()
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.stats).toMatchObject({ installsAllTime: 10, activeDevices: 10, latestDate: "2026-10-22" })
    }

    const tokenCall = fetchMock.mock.calls.find(([u]) => String(u).startsWith("https://oauth2"))
    const assertion = new URLSearchParams(String(tokenCall?.[1]?.body)).get("assertion") ?? ""
    expect(assertion.split(".")).toHaveLength(3)
    // Only the overview file is downloaded.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("alt=media"))).toHaveLength(1)
    expect(fetchMock.mock.calls.find(([u]) => String(u).includes("alt=media"))?.[0]).toContain("overview.csv")
  })

  it("turns a permission failure into a readable reason and does not throw", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith("https://oauth2")
        ? new Response(JSON.stringify({ access_token: "tok" }), { status: 200 })
        : new Response("forbidden", { status: 403 }),
    )
    const result = await getPlayInstallStats()
    expect(result).toEqual({ status: "error", reason: expect.stringContaining("Play Console permissions") })
  })

  it("does not call Google at all when unconfigured", async () => {
    vi.stubEnv("GOOGLE_PLAY_REPORTS_BUCKET", "")
    const result = await getPlayInstallStats()
    expect(result).toEqual({ status: "not_configured", missing: ["GOOGLE_PLAY_REPORTS_BUCKET"] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
