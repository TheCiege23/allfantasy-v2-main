"use client";

import { useCallback } from "react";
import { Share2 } from "lucide-react";
import type { SharePayload } from "@/lib/share-engine/types";
import {
  trackShareAttempt,
  trackShareComplete,
  trackShareFallback,
} from "@/lib/share-engine/ShareTrackingService";

interface NativeShareActionProps {
  payload: SharePayload;
  onShare?: () => void;
  className?: string;
  fallback?: () => void;
  track?: boolean;
  testId?: string;
}

export function NativeShareAction({
  payload,
  onShare,
  className = "",
  fallback,
  track = true,
  testId = "share-native-action",
}: NativeShareActionProps) {
  const handleClick = useCallback(async () => {
    const shareData: ShareData = {
      title: payload.title,
      text: payload.description ?? payload.title,
      url: payload.url,
    };

    const canNativeShare =
      typeof navigator !== "undefined" && typeof navigator.share === "function";

    if (!canNativeShare) {
      if (track) {
        trackShareFallback({
          shareType: payload.kind,
          destination: "native_share",
          shareId: payload.shareId,
          sport: payload.sport?.toString(),
          shareUrl: payload.url,
          visibility: payload.visibility,
        });
      }
      fallback?.();
      return;
    }

    if (track) {
      trackShareAttempt({
        shareType: payload.kind,
        destination: "native_share",
        shareId: payload.shareId,
        sport: payload.sport?.toString(),
        shareUrl: payload.url,
        visibility: payload.visibility,
      });
    }

    try {
      await navigator.share(shareData);
      if (track) {
        trackShareComplete({
          shareType: payload.kind,
          destination: "native_share",
          shareId: payload.shareId,
          sport: payload.sport?.toString(),
          shareUrl: payload.url,
          visibility: payload.visibility,
        });
      }
      onShare?.();
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        if (track) {
          trackShareFallback({
            shareType: payload.kind,
            destination: "native_share",
            shareId: payload.shareId,
            sport: payload.sport?.toString(),
            shareUrl: payload.url,
            visibility: payload.visibility,
          });
        }
        fallback?.();
      }
    }
  }, [fallback, onShare, payload, track]);

  const canShowButton =
    typeof navigator !== "undefined" && (typeof navigator.share === "function" || !!fallback);

  if (!canShowButton) return null;

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      className={className}
      aria-label="Share with your device"
      title="Share with your device"
      data-testid={testId}
    >
      <Share2 className="h-5 w-5" aria-hidden />
    </button>
  );
}
