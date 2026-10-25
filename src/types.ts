export type TaskLifecycleStatus = 'done' | 'ongoing' | 'pending';

export type ClarificationReason = 'missing-owner' | 'missing-deadline';

export interface ExtractedTask {
  id: string;
  description: string;
  owner: string | null;
  deadline: string | null;
  /** What the transcript (or a valid edit) says about the work itself — never inferred from clarification state. */
  status: TaskLifecycleStatus;
  /** Whether an important detail (owner/deadline) is missing or ambiguous — independent of `status`. */
  needsClarification: boolean;
  clarificationReasons: ClarificationReason[];
}

export interface KeyDecision {
  id: string;
  text: string;
}

export interface FollowUpQuestion {
  id: string;
  taskId: string;
  field: 'owner' | 'deadline';
  question: string;
  answer: string;
  answered: boolean;
}

export type AnalysisProvider = 'demo' | 'openai';

export interface MeetingMeta {
  title: string;
  date: string | null;
  attendees: string[];
}

export interface MeetingAnalysis {
  id: string;
  createdAt: string;
  updatedAt: string;
  transcript: string;
  meta: MeetingMeta;
  summary: string;
  decisions: KeyDecision[];
  tasks: ExtractedTask[];
  followUps: FollowUpQuestion[];
  provider: AnalysisProvider;
  warning?: string;
}

export interface RawExtraction {
  summary: string;
  decisions: string[];
  tasks: {
    description: string;
    owner: string | null;
    deadline: string | null;
    status: TaskLifecycleStatus;
  }[];
}

export interface AppSettings {
  openaiApiKey: string;
  model: string;
}
