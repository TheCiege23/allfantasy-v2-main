/**
 * AI Social Clip generation (PROMPT 146). Multi-provider orchestration.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runAISocialClipPipeline } from "@/lib/ai-social-clip-engine";
import {
  CLIP_INPUT_TYPES,
  CLIP_OUTPUT_TYPES,
  type ClipInputType,
  type ClipOutputType,
  type DeterministicFacts,
} from "@/lib/ai-social-clip-engine/types";
import { normalizeToSupportedSport } from "@/lib/sport-scope";

export const dynamic = "force-dynamic";

function safeStr(v: unknown, max = 500): string | undefined {
  const s = typeof v === "string" ? v : "";
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t || undefined;
}

function safeNum(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const inputType = CLIP_INPUT_TYPES.includes((body.inputType as ClipInputType) ?? "")
    ? (body.inputType as ClipInputType)
    : "matchup_result";
  const outputType = CLIP_OUTPUT_TYPES.includes((body.outputType as ClipOutputType) ?? "")
    ? (body.outputType as ClipOutputType)
    : "short_post";
  const sport = normalizeToSupportedSport(body.sport ?? "NFL");
  const leagueName = safeStr(body.leagueName);
  const tone = safeStr(body.tone);
  const brandingHint = safeStr(body.brandingHint);

  const rawFacts = body.deterministicFacts && typeof body.deterministicFacts === "object"
    ? body.deterministicFacts
    : {};
  const deterministicFacts: DeterministicFacts = {
    sport: rawFacts.sport ?? sport,
    leagueName: rawFacts.leagueName ?? leagueName,
    week: safeNum(rawFacts.week) ?? rawFacts.week,
    round: safeStr(rawFacts.round),
    matchupSummary: safeStr(rawFacts.matchupSummary),
    tradeVerdictSummary: safeStr(rawFacts.tradeVerdictSummary),
    rankingsSummary: safeStr(rawFacts.rankingsSummary),
    trendAlertSummary: safeStr(rawFacts.trendAlertSummary),
    storySummary: safeStr(rawFacts.storySummary),
    promoContext: safeStr(rawFacts.promoContext),
    bracketSummary: safeStr(rawFacts.bracketSummary),
  };

  const pipeline = await runAISocialClipPipeline({
    inputType,
    outputType,
    sport,
    leagueName,
    deterministicFacts,
    tone,
    brandingHint,
  });

  if (!pipeline.success || !pipeline.result) {
    return NextResponse.json(
      {
        error: pipeline.error ?? "Generation failed",
        providerStatus: pipeline.providerStatus,
      },
      { status: pipeline.providerStatus?.xai || pipeline.providerStatus?.openai ? 500 : 503 }
    );
  }

  const result = pipeline.result;
  const contentBody = JSON.stringify({
    shortCaption: result.shortCaption,
    headline: result.headline,
    ctaText: result.ctaText,
    hashtags: result.hashtags,
    socialCardCopy: result.socialCardCopy,
    clipTitle: result.clipTitle,
    platformVariants: result.platformVariants,
    thread: result.thread,
  });
  const metadata = {
    shortCaption: result.shortCaption,
    headline: result.headline,
    ctaText: result.ctaText,
    hashtags: result.hashtags,
    socialCardCopy: result.socialCardCopy,
    clipTitle: result.clipTitle,
    platformVariants: result.platformVariants,
    thread: result.thread,
    aiClipAudit: {
      inputType,
      outputType,
      sport,
      providersUsed: result.providersUsed,
      providerStatus: pipeline.providerStatus,
      factCheckPassed: result.factCheckPassed,
      moderationPassed: true,
      generatedAt: new Date().toISOString(),
    },
  };

  const asset = await prisma.socialContentAsset.create({
    data: {
      userId: session.user.id,
      sport,
      assetType: `ai_clip_${inputType}`,
      title: result.headline || result.clipTitle || "Chimmy Social Clip",
      contentBody,
      provider: "ai_multi",
      metadata: metadata as object,
      approvedForPublish: false,
    },
  });

  return NextResponse.json({
    id: asset.id,
    title: asset.title,
    sport: asset.sport,
    assetType: asset.assetType,
    createdAt: asset.createdAt.toISOString(),
    providerStatus: pipeline.providerStatus,
  });
}
