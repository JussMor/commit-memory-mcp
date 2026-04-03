export type ContextFactStatus = "draft" | "promoted" | "archived";

// ---------------------------------------------------------------------------
// Research Orchestration Types
// ---------------------------------------------------------------------------

export type ResearchSessionStatus =
  | "pending"
  | "running"
  | "waiting_agent"
  | "assembling"
  | "complete"
  | "failed";

export type ResearchStepStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "skipped";

export type ResearchSession = {
  id: string;
  question: string;
  module?: string;
  status: ResearchSessionStatus;
  steps: unknown[];
  findings: unknown[];
  final_answer?: string;
  max_steps: number;
  created_at: string;
  updated_at: string;
};

export type ResearchStep = {
  id: string;
  session: string;
  index: number;
  instruction: string;
  context: string;
  status: ResearchStepStatus;
  result?: string;
  tokens_used?: number;
  created_at: string;
  completed_at?: string;
};

export type ResearchFinding = {
  id: string;
  session: string;
  step: string;
  module: string;
  text: string;
  confidence: number;
  promotes_to?: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// ATOM 5-Tuple (subject, predicate, object, t_start, t_end)
// ---------------------------------------------------------------------------

export type AtomTuple = {
  subject: string;
  predicate: string;
  object: string;
  t_start?: string;
  t_end?: string;
  confidence: number;
  source_ref: string;
};
