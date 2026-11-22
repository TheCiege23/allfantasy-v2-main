// @vitest-environment node
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined }))
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.client } }))
import { processLeagueSafeNotification } from "@/lib/leaguesafe/process-notification"

const target = process.env.LS_PHASE1_TEST_DATABASE_URL
function localTarget(value: string) {
  const url = new URL(value)
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/af_leaguesafe_phase1_test(?:_[a-z0-9]+)?$/.test(url.pathname) ||
      url.username !== "af_phase1_test" || url.search || url.hash) throw new Error("Phase 2 requires a dedicated local test database.")
  return url
}
describe("Phase 2 database target guard", () => {
  it.each([
    "postgresql://af_phase1_test@production.example/af_leaguesafe_phase1_test",
    "postgresql://af_phase1_test@127.0.0.1/neondb",
    "postgresql://owner@127.0.0.1/af_leaguesafe_phase1_test",
    "postgresql://af_phase1_test@127.0.0.1/af_leaguesafe_phase1_test?host=production.example",
  ])("refuses %s", value => expect(() => localTarget(value)).toThrow())
})

describe.skipIf(!target)("Phase 2 processing with real PostgreSQL and Prisma", () => {
  const schema = "ls_phase2_" + randomUUID().replaceAll("-", "")
  let sql: Client
  const rawBody = readFileSync("__tests__/fixtures/leaguesafe/payment-received.eml", "utf8")
  beforeAll(async () => {
    const url = localTarget(target!)
    sql = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 })
    await sql.connect()
    await sql.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`)
    await sql.query(readFileSync("prisma/migrations/20261114000000_leaguesafe_raw_email_capture/migration.sql", "utf8"))
    await sql.query(readFileSync("prisma/migrations/20261117060000_leaguesafe_phase2_parsing/migration.sql", "utf8"))
    url.searchParams.set("schema", schema)
    state.client = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    for (const [id, messageId, status, subject] of [
      ["accepted", "aabb01", "captured", rawBody],
      ["unknown", "aabb02", "captured", rawBody.replace("Subject:", "Subject: Unsupported ")],
      ["rejected", "aabb03", "rejected", rawBody],
    ]) await sql.query(`INSERT INTO "LeagueSafeRawEmail"
      (id,"messageId","receivedAt","from","to",subject,"rawBody","authResults","processingStatus")
      VALUES ($1,$2,'2026-01-02','noreply@leaguesafe.com','recipient@example.invalid','fixture',$3,'{}',$4::"LeagueSafeEmailProcessingStatus")`, [id, messageId, subject, status])
  }, 30000)
  afterAll(async () => {
    await state.client?.$disconnect()
    if (sql) {
      // Only this random, local synthetic test schema; never public or an application schema.
      try { await sql.query(`DROP SCHEMA "${schema}" CASCADE`) } finally { await sql.end() }
    }
  })
  it("publishes one result under concurrent requests and preserves source bytes", async () => {
    const outcomes = await Promise.all([
      processLeagueSafeNotification("accepted", ["leaguesafe.com"]),
      processLeagueSafeNotification("accepted", ["leaguesafe.com"]),
    ])
    expect(outcomes.filter(value => value === "parsed")).toHaveLength(1)
    expect(outcomes.every(value => ["parsed", "conflict", "unchanged"].includes(value))).toBe(true)
    const row = (await sql.query(`SELECT * FROM "LeagueSafeRawEmail" WHERE id='accepted'`)).rows[0]
    expect(row.rawBody).toBe(rawBody)
    expect(row.authResults).toEqual({})
    expect(row.parsedPayload.details.amountCents).toBe(1250)
    expect(row.parseDedupeKey).toMatch(/^leaguesafe:message:[a-f0-9]{64}$/)
    expect(await processLeagueSafeNotification("accepted", ["leaguesafe.com"])).toBe("unchanged")
    expect((await sql.query(`SELECT "parseAttemptedAt" FROM "LeagueSafeRawEmail" WHERE id='accepted'`)).rows[0].parseAttemptedAt).toEqual(row.parseAttemptedAt)
  })
  it("persists only one review alert across repeated attempts", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(await processLeagueSafeNotification("unknown", ["leaguesafe.com"])).toBe("unparseable")
      expect(await processLeagueSafeNotification("unknown", ["leaguesafe.com"])).toBe("unchanged")
      expect(log).toHaveBeenCalledTimes(1)
      expect((await sql.query(`SELECT count(*)::int AS n FROM "LeagueSafeRawEmail" WHERE "processingStatus"='unparseable'`)).rows[0].n).toBe(1)
    } finally { log.mockRestore() }
  })
  it("does not promote rejection or insert any extra rows", async () => {
    expect(await processLeagueSafeNotification("rejected", ["leaguesafe.com"])).toBe("rejected")
    const row = (await sql.query(`SELECT "processingStatus","parsedPayload","parseAttemptedAt" FROM "LeagueSafeRawEmail" WHERE id='rejected'`)).rows[0]
    expect(row).toEqual({ processingStatus: "rejected", parsedPayload: null, parseAttemptedAt: null })
    expect((await sql.query(`SELECT count(*)::int AS n FROM "LeagueSafeRawEmail"`)).rows[0].n).toBe(3)
  })
})
