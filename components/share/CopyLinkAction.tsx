"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { SharePayload } from "@/lib/share-engine/types";
import {
  trackShareAttempt,
  trackShareComplete,
} from "@/lib/share-engine/ShareTrackingService";

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // continue to manual fallback
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

interface CopyLinkActionProps {
  payload: SharePayload;
  onCopy?: () => void;
  className?: string;
  track?: boolean;
  testId?: string;
}

export function CopyLinkAction({
  payload,
  onCopy,
  className = "",
  track = true,
  testId = "share-copy-link",
}: CopyLinkActionProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = payload.description
      ? `${payload.title}\n${payload.description}\n${payload.url}`
      : `${payload.title}\n${payload.url}`;

    if (track) {
      trackShareAttempt({
        shareType: payload.kind,
        destination: "copy_link",
        shareId: payload.shareId,
        sport: payload.sport?.toString(),
        shareUrl: payload.url,
        visibility: payload.visibility,
      });
    }

    const didCopy = await copyText(text).catch(() => false);
    if (!didCopy) return;

    setCopied(true);
    if (track) {
      trackShareComplete({
        shareType: payload.kind,
        destination: "copy_link",
        shareId: payload.shareId,
        sport: payload.sport?.toString(),
        shareUrl: payload.url,
        visibility: payload.visibility,
      });
    }
    onCopy?.();
    window.setTimeout(() => setCopied(false), 2000);
  }, [onCopy, payload, track]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={className}
      aria-label="Copy link"
      title="Copy link"
      data-testid={testId}
    >
      {copied ? (
        <Check className="h-5 w-5 text-green-500" aria-hidden />
      ) : (
        <Copy className="h-5 w-5" aria-hidden />
      )}
    </button>
  );
}
