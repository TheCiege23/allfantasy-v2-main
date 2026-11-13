/**
 * AllFantasy Social Share Engine URL helpers.
 * Safe for client usage and public previews.
 */

import { getPublicSiteOrigin } from "@/lib/site-public-origin";
import type {
  ShareDestination,
  SharePayload,
  ShareTargetDescriptor,
} from "./types";

function getOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return getPublicSiteOrigin();
}

function trimToLength(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function buildShareText(payload: SharePayload, overrideMessage?: string): string {
  if (overrideMessage?.trim()) return trimToLength(overrideMessage.trim(), 240);
  const base = payload.description?.trim()
    ? `${payload.title} - ${payload.description.trim()}`
    : payload.title;
  const hashtags = payload.hashtags?.length
    ? ` ${payload.hashtags.map((tag) => `#${tag.replace(/[^A-Za-z0-9]/g, "")}`).join(" ")}`
    : "";
  return trimToLength(`${base}${hashtags}`.trim(), 260);
}

export function getXShareUrl(url: string, text: string): string {
  const params = new URLSearchParams({
    url,
    text: trimToLength(text, 240),
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function getRedditShareUrl(url: string, title: string): string {
  const params = new URLSearchParams({
    url,
    title: trimToLength(title, 300),
  });
  return `https://www.reddit.com/submit?${params.toString()}`;
}

export function getEmailShareUrl(url: string, subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(trimToLength(subject, 120))}&body=${encodeURIComponent(body)}`;
}

export function getSmsShareUrl(url: string, message: string): string {
  return `sms:?body=${encodeURIComponent(`${trimToLength(message, 220)} ${url}`.trim())}`;
}

export function getPlatformShareUrl(
  destination: ShareDestination,
  payload: SharePayload,
  options?: { subject?: string; message?: string }
): string {
  const url = payload.url;
  const subject = options?.subject ?? payload.title;
  const message = buildShareText(payload, options?.message);

  switch (destination) {
    case "copy_link":
    case "discord":
    case "native_share":
      return url;
    case "x":
      return getXShareUrl(url, message);
    case "reddit":
      return getRedditShareUrl(url, subject);
    case "email":
      return getEmailShareUrl(url, subject, `${message}\n\n${url}`);
    case "sms":
      return getSmsShareUrl(url, message);
    default:
      return url;
  }
}

export function buildShareTargetDescriptors(
  payload: SharePayload,
  destinations: ShareDestination[] = ["x", "discord", "reddit", "email", "sms"]
): ShareTargetDescriptor[] {
  return destinations.map((destination) => {
    switch (destination) {
      case "x":
        return {
          destination,
          label: "X",
          href: getPlatformShareUrl(destination, payload),
          action: "external",
          helperText: "Post this share card on X.",
          opensExternal: true,
        };
      case "discord":
        return {
          destination,
          label: "Discord",
          href: null,
          action: "manual_copy",
          helperText: "Copy the link and paste it into Discord.",
          opensExternal: false,
        };
      case "reddit":
        return {
          destination,
          label: "Reddit",
          href: getPlatformShareUrl(destination, payload),
          action: "external",
          helperText: "Create a Reddit post with this card.",
          opensExternal: true,
        };
      case "email":
        return {
          destination,
          label: "Email",
          href: getPlatformShareUrl(destination, payload),
          action: "external",
          helperText: "Open an email draft with the share link.",
          opensExternal: false,
        };
      case "sms":
        return {
          destination,
          label: "SMS",
          href: getPlatformShareUrl(destination, payload),
          action: "external",
          helperText: "Open your device messaging app.",
          opensExternal: false,
        };
      case "copy_link":
        return {
          destination,
          label: "Copy link",
          href: payload.url,
          action: "copy",
          helperText: "Copy the public share link.",
          opensExternal: false,
        };
      case "native_share":
      default:
        return {
          destination,
          label: "Share",
          href: payload.url,
          action: "external",
          helperText: "Open the system share sheet.",
          opensExternal: false,
        };
    }
  });
}

export { buildShareText, getOrigin };
