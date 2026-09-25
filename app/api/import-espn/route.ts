import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth-guard";
import { encrypt } from "@/lib/league-auth-crypto";
import { runImportedLeagueNormalizationPipeline } from "@/lib/league-import/ImportedLeagueNormalizationPipeline";
import { persistImportedLeagueFromNormalization } from "@/lib/league-import/ImportedLeagueCommitService";
import { assertImportCommissioner, recordImportAttestation } from "@/lib/league-import/commissionerGate";
import { commissionerGateFailureResponse } from "@/lib/league-import/commissionerGateResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURRENT_IMPORT_SEASON = new Date().getFullYear();

const bodySchema = z.object({
  leagueId: z.string().min(1),
  season: z.number().int().default(CURRENT_IMPORT_SEASON),
  isLegacy: z.boolean().optional(),
  espnS2: z.string().optional(),
  swid: z.string().optional(),
  /** Same shape the unified commit route accepts; see `assertImportCommissioner`. */
  attestation: z
    .object({ accepted: z.boolean().optional(), statement: z.string().optional() })
    .optional(),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function mapImportErrorStatus(code: string): number {
  if (code === "LEAGUE_NOT_FOUND") return 404;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "CONNECTION_REQUIRED") return 400;
  return 500;
}

export async function POST(req: Request) {
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

    if ((espnS2 && !swid) || (!espnS2 && swid)) {
      return NextResponse.json(
        { error: "Provide both ESPN S2 and SWID cookies for private leagues." },
        { status: 400 }
      );
    }

    if (espnS2 && swid) {
      await (prisma as any).leagueAuth.upsert({
        where: {
          userId_platform: {
            userId,
            platform: "espn",
          },
        },
        update: {
          espnSwid: encrypt(swid),
          espnS2: encrypt(espnS2),
          updatedAt: new Date(),
        },
        create: {
          userId,
          platform: "espn",
          espnSwid: encrypt(swid),
          espnS2: encrypt(espnS2),
        },
      });
    }

    const trimmedLeagueId = leagueId.trim();
    const sourceId =
      trimmedLeagueId.startsWith("http://") ||
      trimmedLeagueId.startsWith("https://") ||
      /^\d{4}[:/]/.test(trimmedLeagueId)
        ? trimmedLeagueId
        : `${season}:${trimmedLeagueId}`;

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
        { error: normalized.error },
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
      season,
      historicalBackfill: persisted.historicalBackfill,
    });
  } catch (error) {
    console.error("[Import ESPN]", error);

    return NextResponse.json(
      { error: getErrorMessage(error) || "ESPN import failed" },
      { status: 500 }
    );
  }
}
