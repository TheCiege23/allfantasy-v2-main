import { NextResponse } from "next/server";
import { getServedOrigin } from "@/lib/http/served-origin";
import { buildSharePayload, buildShareTargetDescriptors } from "@/lib/share-engine";
import { SHAREABLE_KINDS } from "@/lib/share-engine/types";

function getBaseUrl(req: Request): string {
  // Config-derived, never a Host header (see lib/http/served-origin.ts).
  return getServedOrigin(req);
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const kind = typeof body.kind === "string" ? body.kind : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!SHAREABLE_KINDS.includes(kind as (typeof SHAREABLE_KINDS)[number])) {
    return NextResponse.json(
      { ok: false, error: "Invalid share kind", allowed: [...SHAREABLE_KINDS] },
      { status: 400 }
    );
  }

  if (!url) {
    return NextResponse.json({ ok: false, error: "Missing share URL" }, { status: 400 });
  }

  const payload = buildSharePayload(
    {
      kind: kind as (typeof SHAREABLE_KINDS)[number],
      url,
      title: body.title,
      description: body.description,
      imageUrl: body.imageUrl,
      sport: body.sport,
      shareId: body.shareId,
      leagueName: body.leagueName,
      bracketName: body.bracketName,
      weekOrRound: body.weekOrRound,
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : undefined,
      cta: body.cta,
      creatorName: body.creatorName,
      visibility: body.visibility,
      safeForPublic: body.safeForPublic,
    },
    { baseUrl: getBaseUrl(req) }
  );

  return NextResponse.json({
    ok: true,
    payload,
    targets: buildShareTargetDescriptors(payload),
  });
}
