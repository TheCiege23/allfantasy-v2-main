"use client";

import Image from "next/image";
import type { SharePayload } from "@/lib/share-engine/types";
import { cn } from "@/lib/utils";

const SPORT_ACCENT: Record<string, string> = {
  NFL: "from-amber-500/20 to-orange-600/10 border-amber-500/30",
  NBA: "from-orange-500/20 to-red-600/10 border-orange-500/30",
  MLB: "from-red-500/20 to-rose-600/10 border-red-500/30",
  NHL: "from-sky-500/20 to-blue-600/10 border-sky-500/30",
  NCAAF: "from-emerald-500/20 to-teal-600/10 border-emerald-500/30",
  NCAAB: "from-blue-500/20 to-indigo-600/10 border-blue-500/30",
  SOCCER: "from-green-500/20 to-emerald-600/10 border-green-500/30",
};

interface SharePreviewCardProps {
  payload: SharePayload;
  className?: string;
}

export function SharePreviewCard({ payload, className }: SharePreviewCardProps) {
  const sport = payload.sport?.toString().toUpperCase() ?? "NFL";
  const accent = SPORT_ACCENT[sport] ?? SPORT_ACCENT.NFL;

  return (
    <div
      className={cn("rounded-2xl border bg-gradient-to-br p-4 text-left", accent, className)}
      data-sport={sport}
      data-testid="share-preview-card"
    >
      {payload.imageUrl ? (
        <div className="mb-3 aspect-video w-full overflow-hidden rounded-xl bg-black/20 relative">
          <Image
            src={payload.imageUrl}
            alt=""
            fill
            className="object-cover"
          />
        </div>
      ) : null}

      {payload.eyebrow ? (
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
          data-testid="share-preview-eyebrow"
        >
          {payload.eyebrow}
        </p>
      ) : null}

      <h3 className="mt-2 font-semibold text-foreground" data-testid="share-preview-title">
        {payload.title}
      </h3>

      {payload.description ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="share-preview-description">
          {payload.description}
        </p>
      ) : null}

      {payload.chips?.length ? (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="share-preview-chips">
          {payload.chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-white/15 bg-black/10 px-2.5 py-1 text-[11px] font-medium text-foreground/90"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      {payload.cta ? (
        <p className="mt-3 text-xs font-medium text-muted-foreground" data-testid="share-preview-cta">
          {payload.cta}
        </p>
      ) : null}
    </div>
  );
}
