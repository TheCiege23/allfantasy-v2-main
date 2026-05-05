/**
 * Prisma singleton (Node server only).
 *
 * We do not use `import "server-only"` here yet: webpack still bundles client paths that
 * transitively import this module (e.g. mock-draft → player-media). Module splits
 * (orphan-platform-ids, mood-options, player-media-urls, rank-xp-constants, SportTeamMetadataRegistry.db)
 * reduce leakage; re-add `server-only` once no client graph pulls `@/lib/prisma`.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { getDatabaseUrlOrThrow, isDomRuntime } from "@/lib/env/database-url";

const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

function isConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientRustPanicError) return true;

  const err = error as { code?: string; message?: string };
  const code = err?.code ?? "";
  const message = String(err?.message ?? "");
  const messageLower = message.toLowerCase();

  if (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(code)) {
    return true;
  }

  if (messageLower.includes("terminating connection due to administrator command")) {
    return true;
  }

  if (messageLower.includes("can't reach database server")) {
    return true;
  }

  if (messageLower.includes("connection timed out")) {
    return true;
  }

  if (
    messageLower.includes("maxclientsinsessionmode") ||
    messageLower.includes("too many clients")
  ) {
    return true;
  }

  if (
    messageLower.includes("prepared statement") &&
    (messageLower.includes("does not exist") || messageLower.includes("already exists"))
  ) {
    return true;
  }

  if (
    messageLower.includes("bind message supplies") &&
    messageLower.includes("prepared statement")
  ) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyNonProdConnectionGuardrails(rawUrl: string): string {
  if (process.env.NODE_ENV === "production") return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has("connection_limit")) {
      // Keep local/dev and e2e runs from exhausting pooled DB sessions.
      // Note: 1 causes deadlocks when a service starts a $transaction and any
      // inner helper (e.g. resolveDraftPickPresentation) uses the global
      // `prisma` client for reads — it waits for a 2nd connection the pool
      // will never give it. 5 is safe for Neon free-tier + a few retries.
      parsed.searchParams.set("connection_limit", "5");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "30");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//i.test(value);
}

/** True for Prisma Accelerate / Data Proxy style datasource URLs (not direct Postgres TCP). */
function isPrismaProtocolUrl(value: string): boolean {
  return /^prisma(\+postgres)?:\/\//i.test(value.trim());
}

/**
 * Prisma validates `schema.prisma` `env("DATABASE_URL")` / `env("DIRECT_URL")` at runtime.
 * If `.env` sets `DATABASE_URL=prisma://...` (Accelerate) but `resolveDatabaseUrl` picks a
 * `postgresql://...` value from `POSTGRES_URL` / `POSTGRES_PRISMA_URL`, leaving the old
 * `DATABASE_URL` in `process.env` can trigger P6001 ("URL must start with prisma://").
 * When we connect with a direct Postgres URL, align env so validation matches the client.
 */
function syncPrismaEnvWithResolvedPostgresUrl(resolvedUrl: string): void {
  if (!isPostgresUrl(resolvedUrl)) return;

  const prevDb = process.env.DATABASE_URL?.trim() ?? "";
  if (prevDb && !isPostgresUrl(prevDb)) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Prisma] Replacing non-postgres DATABASE_URL in process.env with the resolved postgres URL " +
          "(from lib/env/database-url.ts). Use postgresql:// for direct DB access; prisma:// is only for Accelerate."
      );
    }
  }
  process.env.DATABASE_URL = resolvedUrl;

  const prevDirect = process.env.DIRECT_URL?.trim() ?? "";
  if (
    !prevDirect ||
    !isPostgresUrl(prevDirect) ||
    isPrismaProtocolUrl(prevDirect)
  ) {
    process.env.DIRECT_URL = resolvedUrl;
  }
}

function normalizePrismaEngineForDatabaseUrl(databaseUrl: string): void {
  if (!isPostgresUrl(databaseUrl)) return;

  const engineType = process.env.PRISMA_CLIENT_ENGINE_TYPE?.trim().toLowerCase();
  // Direct postgres URLs require the Node query engine. Data Proxy / mistaken env breaks queries.
  if (
    engineType === "dataproxy" ||
    engineType === "data-proxy" ||
    engineType === "accelerate"
  ) {
    process.env.PRISMA_CLIENT_ENGINE_TYPE = "library";
  }
}

/**
 * Build-phase stub: during `next build`'s static prerender, return a Proxy that
 * answers every Prisma operation with an empty value. Without this, Server
 * Components that hit the DB during prerender would attempt a real TCP connect
 * to the noop fallback URL (postgresql://noop:noop@localhost:5432/noop), fail,
 * and crash the build. At runtime the real Prisma client takes over via SSR.
 *
 * Read ops → null / []  |  count → 0  |  aggregate → {}  |  $transaction → runs
 * its callback with the same stub. Pages that depend on real data will render
 * an empty shell at build time and SSR with real data on first request.
 */
function createBuildPhaseStubClient(): ExtendedPrismaClient {
  const noopAsync = async () => null;
  const emptyArrayAsync = async () => [];
  const zeroAsync = async () => 0;
  const emptyObjectAsync = async () => ({});

  const modelHandler: ProxyHandler<object> = {
    get(_target, prop) {
      const name = String(prop);
      if (name === "findMany" || name === "groupBy") return emptyArrayAsync;
      if (name === "count") return zeroAsync;
      if (name === "aggregate") return emptyObjectAsync;
      if (
        name === "findUnique" ||
        name === "findFirst" ||
        name === "findUniqueOrThrow" ||
        name === "findFirstOrThrow"
      ) {
        return noopAsync;
      }
      // Writes (create/update/delete/upsert/...) — should not be called during prerender.
      // Return null instead of throwing so a stray write doesn't crash the build.
      return noopAsync;
    },
  };

  const stubClient: object = {};
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      const name = String(prop);
      if (name === "$transaction") {
        return async (arg: unknown) => {
          if (typeof arg === "function") {
            return (arg as (tx: unknown) => Promise<unknown>)(stubProxy);
          }
          if (Array.isArray(arg)) return arg.map(() => null);
          return null;
        };
      }
      if (name === "$queryRaw" || name === "$queryRawUnsafe") return emptyArrayAsync;
      if (name === "$executeRaw" || name === "$executeRawUnsafe") return zeroAsync;
      if (name === "$connect" || name === "$disconnect") return async () => undefined;
      if (name === "$on" || name === "$use") return () => undefined;
      if (name === "$extends") return () => stubProxy;
      // Default: treat any other top-level property as a Prisma model accessor.
      return new Proxy({}, modelHandler);
    },
  };

  const stubProxy = new Proxy(stubClient, handler);
  return stubProxy as unknown as ExtendedPrismaClient;
}

function createPrismaClient() {
  // Build-phase short-circuit. Prevents the prerender loop from opening a real
  // socket to the noop URL when a Server Component queries the DB at build time.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return createBuildPhaseStubClient();
  }

  // Runtime URL: resolveDatabaseUrl() prefers DATABASE_URL / pooler keys before DIRECT_URL (see lib/env/database-url.ts).
  let databaseUrl: string;
  try {
    databaseUrl = applyNonProdConnectionGuardrails(getDatabaseUrlOrThrow());
  } catch (err) {
    // Last-resort: if anything still throws in a leaked client bundle, avoid crashing the page.
    if (isDomRuntime()) {
      databaseUrl = applyNonProdConnectionGuardrails(
        "postgresql://noop:noop@localhost:5432/noop"
      );
    } else {
      throw err;
    }
  }

  syncPrismaEnvWithResolvedPostgresUrl(databaseUrl);

  normalizePrismaEngineForDatabaseUrl(databaseUrl);

  const client = new PrismaClient({
    datasourceUrl: databaseUrl,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  return client.$extends({
    query: {
      async $allOperations({
        operation,
        args,
        query,
      }: {
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) {
        const isReadOperation = READ_OPERATIONS.has(operation);
        const retryCount = isReadOperation ? 3 : 1;

        for (let retryAttempt = 0; retryAttempt <= retryCount; retryAttempt++) {
          try {
            return await query(args);
          } catch (error: unknown) {
            const isLastAttempt = retryAttempt === retryCount;

            if (!isConnectionError(error) || isLastAttempt) {
              throw error;
            }

            const backoffMs =
              150 * Math.pow(2, retryAttempt) + Math.floor(Math.random() * 50);

            if (process.env.NODE_ENV !== "production") {
              console.warn(
                `[Prisma] Retrying ${operation} after transient connection error ` +
                  `(retry ${retryAttempt + 1} of ${retryCount}, waiting ${backoffMs}ms)`
              );
            }

            await sleep(backoffMs);
          }
        }

        throw new Error("Prisma retry loop exited unexpectedly.");
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: ExtendedPrismaClient;
};

export const prisma: ExtendedPrismaClient =
  typeof window !== "undefined"
    ? (null as unknown as ExtendedPrismaClient) // Client-side: Prisma is not usable
    : (globalForPrisma.prisma ?? createPrismaClient());

if (process.env.NODE_ENV !== "production" && typeof window === "undefined") {
  globalForPrisma.prisma = prisma;
}