// @vitest-environment node
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

// No fallback to DATABASE_URL/DIRECT_URL or .env. This suite accepts a dedicated local DB only.
const target = process.env.LS_PHASE1_TEST_DATABASE_URL
function localTarget(value: string) {
  const url = new URL(value)
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/af_leaguesafe_phase1_test(?:_[a-z0-9]+)?$/.test(url.pathname) ||
      url.username !== "af_phase1_test" || url.search || url.hash) {
    throw new Error("Phase 1 database tests require an explicitly named dedicated local test database.")
  }
  return value
}

describe("Phase 1 database target guard", () => {
  it.each([
    "postgresql://af_phase1_test@production.example/af_leaguesafe_phase1_test",
    "postgresql://af_phase1_test@127.0.0.1/neondb",
    "postgresql://owner@127.0.0.1/af_leaguesafe_phase1_test",
    "postgresql://af_phase1_test@127.0.0.1/af_leaguesafe_phase1_test?host=production.example",
  ])("refuses unsafe target %s", (value) => expect(() => localTarget(value)).toThrow())
})

describe.skipIf(!target)("Phase 1 PostgreSQL migration and constraints", () => {
  let db: Client
  const schema = `ls_phase1_${randomUUID().replaceAll("-", "")}`
  const query = (sql: string, values?: unknown[]) => db.query(sql, values)
  const ledger = (extra: Record<string, unknown> = {}) => {
    const row = {
      id: "entry1", connectionId: "conn1", memberId: "member1", type: "payment",
      amountCents: 1000, occurredAt: new Date("2026-11-15T00:00:00Z"),
      sourceRawEmailId: null, sourceType: "manual", dedupeKey: "synthetic-entry1",
      createdBy: "creator", ...extra,
    }
    const fields = Object.keys(row)
    return query(`INSERT INTO "DuesLedgerEntry" (${fields.map(f => `"${f}"`).join(",")})
      VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row))
  }

  beforeAll(async () => {
    db = new Client({ connectionString: localTarget(target!), connectionTimeoutMillis: 5000 })
    await db.connect()
    await query("BEGIN")
    await query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`)
    // Existing parent tables expose their actual referenced keys; no production data is used.
    await query(`CREATE TABLE app_users (id TEXT PRIMARY KEY);
      CREATE TABLE leagues (id TEXT PRIMARY KEY);
      CREATE TABLE league_teams (id TEXT PRIMARY KEY, "leagueId" TEXT NOT NULL REFERENCES leagues(id));
      INSERT INTO app_users VALUES ('creator'); INSERT INTO leagues VALUES ('league1'), ('league2');
      INSERT INTO league_teams VALUES ('team1','league1'),('team2','league2');`)
    await query(readFileSync("prisma/migrations/20261114000000_leaguesafe_raw_email_capture/migration.sql", "utf8"))
    await query(`INSERT INTO "LeagueSafeRawEmail"
      (id,"messageId","receivedAt","from","to",subject,"rawBody","authResults","processingStatus")
      SELECT 'raw'||i, 'gmail'||i, '2026-11-15'::timestamp, 'sender@example.invalid',
        'bot@example.invalid', 'Synthetic sample', 'synthetic MIME '||i, '{}',
        CASE WHEN i=10 THEN 'rejected' ELSE 'captured' END::"LeagueSafeEmailProcessingStatus"
      FROM generate_series(1,10) i`)
    await query(readFileSync("prisma/migrations/20261116030000_leaguesafe_phase1_models/migration.sql", "utf8"))
    await query(`INSERT INTO "LeagueSafeConnection" (id,"afLeagueId","lsLeagueName","createdBy","updatedAt")
      VALUES ('conn1','league1','Synthetic League','creator',now()),('conn2','league2','Synthetic League','creator',now());
      INSERT INTO "LeagueSafeMember" (id,"connectionId","afLeagueId","lsDisplayName","updatedAt")
      VALUES ('member1','conn1','league1','Synthetic Person',now()),('member2','conn2','league2','Synthetic Person',now());
      UPDATE "LeagueSafeRawEmail" SET "leagueConnectionId"='conn1' WHERE id='raw1';
      UPDATE "LeagueSafeRawEmail" SET "leagueConnectionId"='conn2' WHERE id='raw2';`)
  }, 30000)
  beforeEach(async () => { await query("SAVEPOINT test_case") })
  afterEach(async () => { await query("ROLLBACK TO SAVEPOINT test_case") })
  afterAll(async () => {
    if (db) { try { await query("ROLLBACK") } finally { await db.end() } }
  })

  it("preserves all ten existing raw bodies, statuses and default-null assignments", async () => {
    const { rows } = await query(`SELECT count(*)::int AS total,
      count(DISTINCT "messageId")::int AS unique,
      count(*) FILTER (WHERE "processingStatus"='captured')::int AS captured,
      count(*) FILTER (WHERE "rawBody"='synthetic MIME '||substring(id from 4))::int AS unchanged,
      count(*) FILTER (WHERE "leagueConnectionId" IS NULL)::int AS unassigned FROM "LeagueSafeRawEmail"`)
    expect(rows[0]).toEqual({ total: 10, unique: 10, captured: 9, unchanged: 10, unassigned: 8 })
    expect((await query(`SELECT "leaguesafeEmail" FROM app_users`)).rows[0].leaguesafeEmail).toBeNull()
  })
  it("defaults to pending and unconfirmed, allowing shared inbox and duplicate league/person names", async () => {
    const connections = (await query(`SELECT status,"botAddress","lastEmailAt" FROM "LeagueSafeConnection"`)).rows
    expect(connections).toHaveLength(2)
    for (const row of connections) expect(row).toEqual({ status: "pending_invite", botAddress: "allfantasysportsapp@gmail.com", lastEmailAt: null })
    expect((await query(`SELECT "afTeamId","lsEmail","matchMethod","confirmedByCommish" FROM "LeagueSafeMember" WHERE id='member1'`)).rows[0])
      .toEqual({ afTeamId: null, lsEmail: null, matchMethod: null, confirmedByCommish: false })
  })
  it("preserves plus-addresses and optional secondary emails", async () => {
    await query(`UPDATE "LeagueSafeConnection" SET "botAddress"='allfantasysportsapp+league-1@gmail.com' WHERE id='conn1'`)
    await query(`UPDATE app_users SET "leaguesafeEmail"='alternate@example.invalid' WHERE id='creator'`)
    expect((await query(`SELECT "botAddress" FROM "LeagueSafeConnection" WHERE id='conn1'`)).rows[0].botAddress)
      .toBe("allfantasysportsapp+league-1@gmail.com")
  })
  it("accepts explicitly confirmed same-league mappings", async () => {
    await query(`UPDATE "LeagueSafeMember" SET "afTeamId"='team1',"matchMethod"='manual',"confirmedByCommish"=true WHERE id='member1'`)
  })
  it("keeps future Phase 0 captures unassigned and creates no ledger entries", async () => {
    await query(`INSERT INTO "LeagueSafeRawEmail" (id,"messageId","receivedAt","from","to",subject,"rawBody","authResults")
      VALUES ('new','new-gmail',now(),'s@example.invalid','b@example.invalid','Synthetic','MIME','{}')`)
    expect((await query(`SELECT "processingStatus","leagueConnectionId" FROM "LeagueSafeRawEmail" WHERE id='new'`)).rows[0])
      .toEqual({ processingStatus: "captured", leagueConnectionId: null })
    expect((await query(`SELECT count(*)::int AS n FROM "DuesLedgerEntry"`)).rows[0].n).toBe(0)
  })
  it("accepts same-connection email provenance and signed adjustments", async () => {
    await ledger({ sourceType: "email", sourceRawEmailId: "raw1", createdBy: null })
    await ledger({ id: "adjustment", type: "adjustment", amountCents: -100, dedupeKey: "adjustment" })
    await ledger({ id: "screenshot", sourceType: "screenshot", dedupeKey: "screenshot" })
  })
  it("deduplicates independently of member, source, and insertion attempt", async () => {
    await ledger()
    await expect(ledger({ id: "another", memberId: "member2", connectionId: "conn2" })).rejects.toMatchObject({ code: "23505" })
  })
  it.each([
    ["another connection's member", { memberId: "member2" }, "23503"],
    ["another connection's email", { sourceType: "email", sourceRawEmailId: "raw2" }, "23503"],
    ["an unassigned email", { sourceType: "email", sourceRawEmailId: "raw3" }, "23503"],
    ["email without a source", { sourceType: "email" }, "23514"],
    ["manual entry with an email source", { sourceRawEmailId: "raw1" }, "23514"],
    ["manual entry without an actor", { createdBy: null }, "23514"],
    ["screenshot without an actor", { sourceType: "screenshot", createdBy: null }, "23514"],
    ["unknown actor", { createdBy: "missing" }, "23503"],
    ["negative payment", { amountCents: -100 }, "23514"],
    ["zero adjustment", { type: "adjustment", amountCents: 0 }, "23514"],
    ["empty dedupe key", { dedupeKey: " " }, "23514"],
    ["unknown event type", { type: "allocation_approved" }, "22P02"],
  ] as const)("rejects %s", async (_, values, code) => {
    await expect(ledger(values)).rejects.toMatchObject({ code })
  })
  it.each([
    [`UPDATE "LeagueSafeMember" SET "afTeamId"='team2' WHERE id='member1'`, "23503"],
    [`UPDATE "LeagueSafeMember" SET "afLeagueId"='league2' WHERE id='member1'`, "23503"],
    [`UPDATE "LeagueSafeMember" SET "confirmedByCommish"=true WHERE id='member1'`, "23514"],
    [`UPDATE "LeagueSafeMember" SET "duesAmountCents"=-1 WHERE id='member1'`, "23514"],
    [`UPDATE "LeagueSafeConnection" SET "duesAmountCents"=-1 WHERE id='conn1'`, "23514"],
    [`UPDATE "LeagueSafeConnection" SET "botAddress"='other@gmail.com' WHERE id='conn1'`, "23514"],
    [`UPDATE "LeagueSafeConnection" SET "afLeagueId"='league2' WHERE id='conn1'`, "23505"],
    [`UPDATE "LeagueSafeRawEmail" SET "leagueConnectionId"='missing' WHERE id='raw3'`, "23503"],
    [`DELETE FROM "LeagueSafeConnection" WHERE id='conn1'`, expect.stringMatching(/^(23503|23001)$/)],
    [`DELETE FROM app_users WHERE id='creator'`, expect.stringMatching(/^(23503|23001)$/)],
  ])("protects mappings and audit references: %s", async (sql, code) => {
    await expect(query(sql)).rejects.toMatchObject({ code })
  })
  it.each([
    `UPDATE "LeagueSafeRawEmail" SET "leagueConnectionId"='conn2' WHERE id='raw1'`,
    `UPDATE "LeagueSafeRawEmail" SET "leagueConnectionId"=NULL WHERE id='raw1'`,
    `DELETE FROM "LeagueSafeRawEmail" WHERE id='raw1'`,
  ])("protects source attribution: %s", async (sql) => {
    await ledger({ sourceType: "email", sourceRawEmailId: "raw1", createdBy: null })
    await expect(query(sql)).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) })
  })
})
