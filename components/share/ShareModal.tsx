"use client";

import { ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShareDestination, SharePayload } from "@/lib/share-engine/types";
import { SharePreviewCard } from "./SharePreviewCard";
import { CopyLinkAction } from "./CopyLinkAction";
import { NativeShareAction } from "./NativeShareAction";
import { PlatformShareActions } from "./PlatformShareActions";

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: SharePayload;
  onShareComplete?: (destination: ShareDestination) => void;
  preferNativeOnMobile?: boolean;
}

export function ShareModal({
  open,
  onOpenChange,
  payload,
  onShareComplete,
  preferNativeOnMobile = true,
}: ShareModalProps) {
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const showNativeAction = preferNativeOnMobile && canNativeShare;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-md"
        style={{ color: "var(--text)" }}
        data-testid="share-modal"
      >
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
        </DialogHeader>

        <SharePreviewCard payload={payload} />

        {payload.helperText ? (
          <div
            className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            data-testid="share-privacy-note"
          >
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{payload.helperText}</span>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <div
            className="flex items-center justify-between gap-2"
            data-testid="share-copy-row"
          >
            <span className="text-sm text-muted-foreground">Copy link</span>
            <CopyLinkAction
              payload={payload}
              onCopy={() => onShareComplete?.("copy_link")}
              className="rounded-lg border border-border bg-muted/50 p-2 hover:bg-muted"
            />
          </div>

          {showNativeAction ? (
            <div
              className="flex items-center justify-between gap-2"
              data-testid="share-native-row"
            >
              <span className="text-sm text-muted-foreground">Use your device</span>
              <NativeShareAction
                payload={payload}
                onShare={() => {
                  onShareComplete?.("native_share");
                  onOpenChange(false);
                }}
                fallback={() => {}}
                className="rounded-lg border border-border bg-muted/50 p-2 hover:bg-muted"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2" data-testid="share-platform-section">
            <span className="text-sm text-muted-foreground">Share to</span>
            <PlatformShareActions
              payload={payload}
              onShareComplete={(destination) => {
                onShareComplete?.(destination);
                if (destination !== "discord") {
                  onOpenChange(false);
                }
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
