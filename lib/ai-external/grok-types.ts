// lib/ai-external/grok-types.ts

type GrokRole = "system" | "user" | "assistant";

type GrokMessage = {
  role: GrokRole;
  content: string;
};

export type GrokChatRequest = {
  model?: string;
  messages: GrokMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  response_format?: { type: "text" | "json_object" };
  seed?: number;
  tools?: Array<
    | { type: "x_search"; from_date?: string; to_date?: string; allowed_x_handles?: string[]; excluded_x_handles?: string[]; enable_image_understanding?: boolean }
    | { type: "web_search"; allowed_domains?: string[]; excluded_domains?: string[]; enable_image_understanding?: boolean; user_location_country?: string; user_location_city?: string; user_location_region?: string; user_location_timezone?: string }
  >;
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
};

export type GrokChatResponse = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  system_fingerprint?: string | null;
  choices?: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
      refusal?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      text_tokens?: number;
      audio_tokens?: number;
      image_tokens?: number;
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
      audio_tokens?: number;
      accepted_prediction_tokens?: number;
      rejected_prediction_tokens?: number;
    };
    num_sources_used?: number;
  };
};

export type GrokEnrichmentKind =
  | "trade_message"
  | "trade_narrative"
  | "waiver_narrative"
  | "league_story"
  | "id_mapping_hint";

export type GrokEnrichmentRequest = {
  kind: GrokEnrichmentKind;
  payload: Record<string, any>;
  context?: Record<string, any>;
};

export type GrokEnrichmentResult = {
  ok: boolean;
  kind: GrokEnrichmentKind;
  confidence: "high" | "medium" | "low";
  narrative?: string[];
  messageTemplate?: string;
  tags?: string[];
  evidenceLinks?: Array<{ label: string; url: string }>;
  rawText?: string;
  blocked?: boolean;
  blockReasons?: string[];
  error?: string;
};
