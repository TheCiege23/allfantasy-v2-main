/**
 * Import FIRST in node-environment integration test files. It ensures the Prisma singleton can initialize even
 * when no real database is configured — the integration tests are gated on TEST_DATABASE_URL and SKIP when it
 * is absent, so this only prevents an import-time crash (the noop client is never queried). A real
 * TEST_DATABASE_URL run sets DATABASE_URL first (via the sourced env), so this is a no-op there.
 */
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://noop:noop@localhost:5432/noop'
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL
export {}
