/**
 * Decision OS — Phase 7.4 Widget SDK embed target capability matrix.
 *
 * Eight embed targets sharing the same auth/lifecycle/event contracts —
 * only isolation and rendering-path properties differ. Contracts only, no
 * implementation.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKEmbedCapabilities, SDKEmbedTarget } from './types'

export const EMBED_CAPABILITIES: Readonly<Record<SDKEmbedTarget, SDKEmbedCapabilities>> = {
  iframe: {
    target: 'iframe',
    supportsSandboxing: true,
    supportsPostMessage: true,
    supportsDirectDOM: false,
    supportsNativeRendering: false,
    isolationLevel: 'full',
  },
  js_embed: {
    target: 'js_embed',
    supportsSandboxing: false,
    supportsPostMessage: false,
    supportsDirectDOM: true,
    supportsNativeRendering: false,
    isolationLevel: 'none',
  },
  web_component: {
    target: 'web_component',
    supportsSandboxing: false,
    supportsPostMessage: true,
    supportsDirectDOM: true,
    supportsNativeRendering: false,
    isolationLevel: 'partial',
  },
  react_wrapper: {
    target: 'react_wrapper',
    supportsSandboxing: false,
    supportsPostMessage: false,
    supportsDirectDOM: true,
    supportsNativeRendering: false,
    isolationLevel: 'none',
  },
  vue_wrapper: {
    target: 'vue_wrapper',
    supportsSandboxing: false,
    supportsPostMessage: false,
    supportsDirectDOM: true,
    supportsNativeRendering: false,
    isolationLevel: 'none',
  },
  angular_wrapper: {
    target: 'angular_wrapper',
    supportsSandboxing: false,
    supportsPostMessage: false,
    supportsDirectDOM: true,
    supportsNativeRendering: false,
    isolationLevel: 'none',
  },
  native_bridge: {
    target: 'native_bridge',
    supportsSandboxing: false,
    supportsPostMessage: false,
    supportsDirectDOM: false,
    supportsNativeRendering: true,
    isolationLevel: 'none',
  },
  flutter_bridge: {
    target: 'flutter_bridge',
    supportsSandboxing: false,
    supportsPostMessage: false,
    supportsDirectDOM: false,
    supportsNativeRendering: true,
    isolationLevel: 'none',
  },
}

export const ALL_EMBED_TARGETS: readonly SDKEmbedTarget[] = [
  'iframe', 'js_embed', 'web_component', 'react_wrapper',
  'vue_wrapper', 'angular_wrapper', 'native_bridge', 'flutter_bridge',
]

/** Returns the capability matrix entry for a given embed target. */
export function getEmbedCapabilities(target: SDKEmbedTarget): SDKEmbedCapabilities {
  return EMBED_CAPABILITIES[target]
}

/** Only 'iframe' provides full process isolation — the strongest tenant boundary. */
export function isFullyIsolatedEmbed(target: SDKEmbedTarget): boolean {
  return EMBED_CAPABILITIES[target].isolationLevel === 'full'
}
