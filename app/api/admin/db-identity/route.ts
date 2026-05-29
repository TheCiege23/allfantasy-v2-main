/**
 * TEMPORARY — production DB identity diagnostic.
 *
 * Returns only safe, non-secret database identity fields:
 * current_database, current_schema, current_user (role name),
 * inet_server_addr (proxy IP — not a credential), pg version,
 * and the count + list of WorldCup tables present in the schema.
 *
 * Does NOT return DATABASE_URL, DIRECT_URL, passwords, hostnames
 * from env vars, or any other secret.
 *
 * Auth: admin session cookie  OR  Authorization: Bearer <ADMIN_PASSWORD>
 *       OR  x-admin-secret header.
 *
 * Remove this route (or guard with NODE_ENV !== 'production') once
 * the Railway smoke test confirms the correct database is connected.
 */
import "server-only"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdminOrBearer } from "@/lib/adminAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type IdentityRow = {
  db: string | null
  schema: string | null
  role_user: string | null
  server_addr: string | null
  pg_version: string | null
}

type TableRow = {
  table_name: string
}

export async function GET(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  try {
    // Two parallel queries — keep them short and read-only.
    const [identityRows, tableRows] = await Promise.all([
      // Safe DB identity — no connection strings or env secrets.
      prisma.$queryRaw<IdentityRow[]>`
        SELECT
          current_database()       AS db,
          current_schema()         AS schema,
          current_user             AS role_user,
          inet_server_addr()::text AS server_addr,
          version()                AS pg_version
      `,

      // World Cup tables present in the connected schema.
      prisma.$queryRaw<TableRow[]>`
        SELECT table_name
        FROM   information_schema.tables
        WHERE  table_name ILIKE '%world_cup%'
          AND  table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER  BY table_name
      `,
    ])

    const id = identityRows[0] ?? {}
    const tables = tableRows.map((t) => t.table_name)

    return NextResponse.json({
      ok: true,
      database: id.db ?? null,
      schema: id.schema ?? null,
      roleUser: id.role_user ?? null,
      serverAddr: id.server_addr ?? null,
      pgVersion: id.pg_version ?? null,
      worldCupTableCount: tables.length,
      worldCupTables: tables,
      checkedAt: new Date().toISOString(),
      _note:
        "Temporary diagnostic — remove or add NODE_ENV guard before public launch.",
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 300) : "query_failed",
      },
      { status: 500 }
    )
  }
}
