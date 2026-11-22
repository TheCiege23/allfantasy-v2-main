export type WaiverPlayerRef = {
  id?: string;
  name?: string;
  pos?: string;
  team?: string;
  tags?: string[];
};

type WaiverSuggestionAI = {
  narrative?: string[];
  messageTemplate?: string;
  tags?: string[];
  evidenceLinks?: Array<{ label: string; url: string }>;
  confidence?: "high" | "medium" | "low";
};

export type WaiverSuggestion = {
  id: string;

  add?: WaiverPlayerRef;
  drop?: WaiverPlayerRef;

  reasons?: string[];

  ai?: WaiverSuggestionAI;
};
