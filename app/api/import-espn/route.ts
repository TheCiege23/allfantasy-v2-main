import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth-guard";
import { encrypt } from "@/lib/league-auth-crypto";
import { getDecryptedAuth } from "@/lib/league-sync-core";
import { consumeRateLimit, buildRateLimit429 } from "@/lib/rate-limit";
import { runImportedLeagueNormalizationPipeline } from "@/lib/league-import/ImportedLeagueNormalizationPipeline";
import { persistImportedLeagueFromNormalization } from "@/lib/league-import/ImportedLeagueCommitService";
import { assertImportCommissioner, recordImportAttestation } from "@/lib/league-import/commissionerGate";
import { commissionerGateFailureResponse } from "@/lib/league-import/commissionerGateResponse";
import { testEspnLeagueConnection } from "@/lib/league-import/espn/EspnConnectionTestService";
import { buildEspnImportSummary } from "@/lib/league-import/espn/espnImportSummary";
import {
  espnHealthResetFields,
  recordEspnCookiesAccepted,
  recordEspnCookiesRejected,
} from "@/lib/league-import/espn/espnConnectionHealth";
import {
  EspnFormatChangedError,
  EspnUnavailableError,
  redactEspnSecrets,
  validateEspnCookieInput,
  type EspnCredentials,
} from "@/lib/league-import/espn/espnFantasyClient";
import {
  EspnImportConnectionError,
  EspnImportLeagueNotFoundError,
} from "@/lib/league-import/espn/EspnLeagueFetchService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/import-espn
 *
 *   mode "test"   (guided flow, step 2) — read the league WITHOUT saving anything: public or
 *                 private, league name, team count, and whether pasted/saved cookies open it.
 *   mode "import" (default, every existing caller) — save cookies if given, verify the importer
 *                 has a team, normalize and persist.
 *
 * 🛑 THE COOKIES ARE AN ESPN LOGIN. They arrive in the BODY (never a query string), are validated
 * before anything is stored, are encrypted at rest by `/lib/league-auth-crypto`, and are never
 * echoed back — no response from this route contains them, and no log line does either
 * (`redactEspnSecrets` runs over anything logged from here).
 */
const bodySchema = z.object({
  mode: z.enum(["test", "import"]).optional(),
  /** A league id, a full ESPN league URL, or `2025:123`. */
  leagueId: z.string().min(1).max(600),
  /** Optional: omitted means "work it out" (see `espnSeasonCandidates`). */
  season: z.number().int().min(2004).max(2100).optional(),
  isLegacy: z.boolean().optional(),
  espnS2: z.string().max(4000).optional(),
  swid: z.string().max(200).optional(),
  /** Same shape the unified commit route accepts; see `assertImportCommissioner`. */
  attestation: z
    .object({ accepted: z.boolean().optional(), statement: z.string().optional() })
    .optional(),
});

/** Messages from these are written for users; anything else gets a generic line. */
function userSafeMessage(error: unknown): { message: string; status: number } {
  if (error instanceof EspnUnavailableError || error instanceof EspnFormatChangedError) {
    return { message: error.message, status: 503 };
  }
  if (error instanceof EspnImportLeagueNotFoundError) return { message: error.message, status: 404 };
  if (error instanceof EspnImportConnectionError) return { message: error.message, status: 400 };
  return { message: "ESPN import failed. Please try again in a moment.", status: 500 };
}

function mapImportErrorStatus(code: string): number {
  if (code === "LEAGUE_NOT_FOUND") return 404;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "CONNECTION_REQUIRED") return 400;
  if (code === "PROVIDER_UNAVAILABLE") return 503;
  if (code === "UNSUPPORTED_SPORT") return 422;
  return 500;
}

/** Builds the pipeline's source id. A bare id stays bare so the season can be resolved. */
function toSourceId(leagueId: string, season: number | undefined): string {
  const trimmed = leagueId.trim();
  if (/^https?:\/\//i.test(trimmed) || /^\d{4}[:/]/.test(trimmed) || /^(?:\d{4}:)?MLB:/i.test(trimmed)) return trimmed;
  if (season != null && /^\d+$/.test(trimmed)) return `${season}:${trimmed}`;
  return trimmed;
}

export async function POST(req: Request) {
  let pasted: EspnCredentials | null = null;
  try {
    const auth = await requireVerifiedUser();
    if (!auth.ok) {
      return auth.response;
    }
    const userId = auth.userId;

    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { leagueId, season, espnS2, swid, attestation } = parsed.data;
    const mode = parsed.data.mode ?? "import";

    const anyCookie = Boolean(espnS2?.trim() || swid?.trim());
    if (anyCookie) {
      const check = validateEspnCookieInput({ swid, espnS2 });
      if (!check.ok) {
        return NextResponse.json({ error: check.message, field: check.field, code: "INVALID_COOKIES" }, { status: 400 });
      }
      pasted = { swid: check.swid, espnS2: check.espnS2 };
    }

    if (mode === "test") {
      const limit = consumeRateLimit({
        scope: "espn",
        action: "test_connection",
        sleeperUsername: userId,
        maxRequests: 20,
        windowMs: 10 * 60_000,
      });
      if (!limit.success) {
        return NextResponse.json(
          buildRateLimit429({ message: "Too many connection tests. Please wait a few minutes and try again.", rl: limit }),
          { status: 429 },
        );
      }
      const saved = pasted ? null : await getDecryptedAuth(userId, "espn").catch(() => null);
      const result = await testEspnLeagueConnection({
        input: toSourceId(leagueId, season),
        pastedCredentials: pasted,
        savedCredentials: saved ? { swid: saved.espnSwid, espnS2: saved.espnS2 } : null,
      });
      if (saved && !result.ok && result.reason === "cookies_rejected" && result.usedSavedCookies) {
        void recordEspnCookiesRejected(userId);
      } else if (saved && result.ok && result.usedSavedCookies && result.cookiesVerified) {
        void recordEspnCookiesAccepted(userId);
      }
      // 200 for every ANSWER (including "private" and "not found") — the UI branches on `reason`.
      return NextResponse.json(result, { status: result.ok || result.reason !== "unavailable" ? 200 : 503 });
    }

    if (pasted) {
      /*
       * ⚠ VERIFIED BEFORE SAVED. This route used to store whatever was pasted and only then try
       * the league, so a mis-copied espn_s2 overwrote a working one. Now a pair ESPN refuses for
       * this league is never written; the user keeps their old connection and gets told why.
       */
      const probe = await testEspnLeagueConnection({ input: toSourceId(leagueId, season), pastedCredentials: pasted });
      if (!probe.ok && probe.reason === "cookies_rejected") {
        return NextResponse.json({ error: probe.message, code: "COOKIES_REJECTED" }, { status: 400 });
      }
      if (!probe.ok && probe.reason !== "needs_cookies") {
        return NextResponse.json(
          { error: probe.message, code: probe.reason.toUpperCase() },
          { status: probe.reason === "not_found" ? 404 : probe.reason === "unavailable" ? 503 : 400 },
        );
      }
      if (probe.ok && probe.viewerTeamFound === false) {
        // Valid cookies, wrong ESPN account. Saving them would replace a connection that may work.
        return NextResponse.json(
          {
            error:
              "Those cookies are from an ESPN account that has no team in this league. Log in to ESPN with the account that has a team here, then copy them again.",
            code: "WRONG_ESPN_ACCOUNT",
          },
          { status: 400 },
        );
      }
      await (prisma as any).leagueAuth.upsert({
        where: {
          userId_platform: {
            userId,
            platform: "espn",
          },
        },
        update: {
          espnSwid: encrypt(pasted.swid!),
          espnS2: encrypt(pasted.espnS2!),
          ...espnHealthResetFields(),
          updatedAt: new Date(),
        },
        create: {
          userId,
          platform: "espn",
          espnSwid: encrypt(pasted.swid!),
          espnS2: encrypt(pasted.espnS2!),
          ...espnHealthResetFields(),
        },
      });
    }

    const sourceId = toSourceId(leagueId, season);

    /*
     * 🛑 THIS ROUTE USED TO PERSIST AFTER ONLY `requireVerifiedUser()`. A public ESPN league
     * reads fine with no cookies, so any verified account could import any league id and
     * become its AllFantasy owner (`League.userId`, which is what the commissioner checks
     * read). Same gate, same arguments as /api/leagues/import/commit.
     *
     * ⚠ AFTER the cookie upsert above, never before: `checkEspn` proves membership from the
     * stored SWID, so gating first would refuse the very request that supplies it.
     */
    const gateAttestation = attestation?.accepted
      ? { accepted: true, statement: attestation.statement }
      : undefined;
    const gate = await assertImportCommissioner({
      appUserId: userId,
      provider: "espn",
      sourceLeagueId: sourceId,
      requireCommissioner: true,
      attestation: gateAttestation,
    });
    if (!gate.ok) {
      return commissionerGateFailureResponse(gate, { attestationHint: true });
    }

    const normalized = await runImportedLeagueNormalizationPipeline({
      provider: "espn",
      sourceId,
      userId,
    });

    if (!normalized.success) {
      return NextResponse.json(
        { error: normalized.error, code: normalized.code },
        { status: mapImportErrorStatus(normalized.code) }
      );
    }

    const persisted = await persistImportedLeagueFromNormalization({
      userId,
      provider: "espn",
      normalized: normalized.normalized,
      allowUpdateExisting: true,
      /* The gate resolved the caller's own team to decide whether they may import at all.
         Without it the league lands with nothing claimed and never shows on /core. */
      importerSourceManagerId: gate.sourceManagerId ?? null,
    });

    if (gate.verification === "attestation" && gateAttestation) {
      void recordImportAttestation({
        leagueId: persisted.league.id,
        appUserId: userId,
        provider: "espn",
        sourceLeagueId: sourceId,
        attestation: gateAttestation,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      imported: 1,
      leagueId: persisted.league.id,
      leagueName: persisted.league.name,
      provider: "espn",
      season: normalized.normalized.league?.season ?? season ?? null,
      historicalBackfill: persisted.historicalBackfill,
      summary: buildEspnImportSummary(normalized.normalized),
    });
  } catch (error) {
    console.error("[Import ESPN]", redactEspnSecrets(error instanceof Error ? `${error.name}: ${error.message}` : String(error), pasted));
    const safe = userSafeMessage(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
