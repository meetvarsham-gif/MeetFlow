import type {
  AppSettings,
  ClarificationReason,
  ExtractedTask,
  FollowUpQuestion,
  MeetingAnalysis,
  RawExtraction,
  TaskLifecycleStatus,
} from '../types';
import { analyzeLocally, extractAttendees, extractMeta } from './localAnalyzer';
import { analyzeWithOpenAI } from './openaiProvider';
import { parseMeetingDateToIso, validateDeadline, validateOwner } from './validation';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function computeClarificationReasons(owner: string | null, deadline: string | null): ClarificationReason[] {
  const reasons: ClarificationReason[] = [];
  if (!owner) reasons.push('missing-owner');
  if (!deadline) reasons.push('missing-deadline');
  return reasons;
}

const VALID_STATUSES: TaskLifecycleStatus[] = ['done', 'ongoing', 'pending'];
function normalizeStatus(status: unknown): TaskLifecycleStatus {
  return typeof status === 'string' && VALID_STATUSES.includes(status as TaskLifecycleStatus)
    ? (status as TaskLifecycleStatus)
    : 'pending';
}

function buildTasksAndFollowUps(
  raw: RawExtraction,
  attendees: string[],
  meetingDateIso: string | null
): { tasks: ExtractedTask[]; followUps: FollowUpQuestion[] } {
  const tasks: ExtractedTask[] = [];
  const followUps: FollowUpQuestion[] = [];

  for (const t of raw.tasks) {
    // Auto-extracted owner/deadline values are heuristic guesses, not user input — they still
    // must pass the same validation before being treated as resolved, so an invalid or
    // unrecognized extraction correctly falls back to "missing" instead of displaying as fact.
    let owner: string | null = null;
    if (t.owner) {
      const result = validateOwner(t.owner, attendees);
      if (result.ok) owner = result.value;
    }

    let deadline: string | null = null;
    if (t.deadline) {
      const result = validateDeadline(t.deadline, { meetingDateIso });
      if (result.ok) deadline = result.value;
    }

    const clarificationReasons = computeClarificationReasons(owner, deadline);
    const taskId = nextId('task');
    tasks.push({
      id: taskId,
      description: t.description,
      owner,
      deadline,
      status: normalizeStatus(t.status),
      needsClarification: clarificationReasons.length > 0,
      clarificationReasons,
    });

    if (clarificationReasons.includes('missing-owner')) {
      followUps.push({
        id: nextId('fu'),
        taskId,
        field: 'owner',
        question: `Who should own: "${t.description}"?`,
        answer: '',
        answered: false,
      });
    }
    if (clarificationReasons.includes('missing-deadline')) {
      followUps.push({
        id: nextId('fu'),
        taskId,
        field: 'deadline',
        question: `What is the deadline for: "${t.description}"?`,
        answer: '',
        answered: false,
      });
    }
  }

  return { tasks, followUps };
}

export async function runAnalysis(
  transcript: string,
  settings: AppSettings
): Promise<MeetingAnalysis> {
  const meta = extractMeta(transcript);
  const attendees = extractAttendees(transcript);
  const meetingDateIso = parseMeetingDateToIso(meta.date);

  let raw: RawExtraction;
  let provider: 'demo' | 'openai' = 'demo';
  let warning: string | undefined;

  if (settings.openaiApiKey.trim()) {
    try {
      raw = await analyzeWithOpenAI(transcript, settings.openaiApiKey.trim(), settings.model || 'gpt-4o-mini');
      provider = 'openai';
    } catch (err) {
      warning = `OpenAI analysis failed, fell back to local demo mode: ${
        err instanceof Error ? err.message : String(err)
      }`;
      raw = analyzeLocally(transcript);
      provider = 'demo';
    }
  } else {
    raw = analyzeLocally(transcript);
  }

  const { tasks, followUps } = buildTasksAndFollowUps(raw, attendees, meetingDateIso);
  const decisions = raw.decisions.map((text) => ({ id: nextId('dec'), text }));
  const now = new Date().toISOString();

  return {
    id: nextId('analysis'),
    createdAt: now,
    updatedAt: now,
    transcript,
    meta,
    summary: raw.summary,
    decisions,
    tasks,
    followUps,
    provider,
    warning,
  };
}

export interface MutationResult {
  analysis: MeetingAnalysis;
  error: string | null;
}

/**
 * Validates `answer` against the follow-up's expected type (owner or deadline) before touching
 * any state. On failure, returns the original analysis unchanged plus an error message.
 *
 * Resolving an owner or deadline only updates `needsClarification`/`clarificationReasons` — the
 * task's lifecycle `status` (done/ongoing/pending) is never touched here. Clarification is about
 * missing information, not evidence that the underlying work changed state, so answering a
 * question never marks a task done, ongoing, or any other status by itself.
 */
export function applyFollowUpAnswer(
  analysis: MeetingAnalysis,
  followUpId: string,
  answer: string
): MutationResult {
  const followUp = analysis.followUps.find((fu) => fu.id === followUpId);
  if (!followUp) return { analysis, error: null };

  const attendees = extractAttendees(analysis.transcript);
  const meetingDateIso = parseMeetingDateToIso(analysis.meta.date);

  const result =
    followUp.field === 'owner'
      ? validateOwner(answer, attendees)
      : validateDeadline(answer, { meetingDateIso });

  if (!result.ok) {
    return { analysis, error: result.error };
  }

  // Preserve exactly what the user typed on the question (for reference) while the task itself
  // stores the normalized/canonical value. For owners the normalized value IS the reference.
  const referenceAnswer = followUp.field === 'owner' ? result.value : answer.trim();

  const followUps = analysis.followUps.map((fu) =>
    fu.id === followUpId ? { ...fu, answer: referenceAnswer, answered: true } : fu
  );

  const tasks = analysis.tasks.map((task) => {
    if (task.id !== followUp.taskId) return task;
    const updated: ExtractedTask = { ...task, [followUp.field]: result.value };
    const clarificationReasons = computeClarificationReasons(updated.owner, updated.deadline);
    updated.clarificationReasons = clarificationReasons;
    updated.needsClarification = clarificationReasons.length > 0;
    return updated;
  });

  return {
    analysis: { ...analysis, tasks, followUps, updatedAt: new Date().toISOString() },
    error: null,
  };
}

/**
 * Direct table edits go through the same validation as clarification answers. Clearing a field
 * back to empty is allowed without validation (it represents "still unknown", not a new claim).
 * An invalid value never touches the task or localStorage-backed state. As with clarification
 * answers, editing owner/deadline never changes the task's lifecycle `status`.
 */
export function updateTaskField(
  analysis: MeetingAnalysis,
  taskId: string,
  field: 'owner' | 'deadline',
  value: string
): MutationResult {
  const trimmed = value.trim();

  if (!trimmed) {
    const tasks = analysis.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const updated: ExtractedTask = { ...task, [field]: null };
      const clarificationReasons = computeClarificationReasons(updated.owner, updated.deadline);
      updated.clarificationReasons = clarificationReasons;
      updated.needsClarification = clarificationReasons.length > 0;
      return updated;
    });
    const followUps = analysis.followUps.map((fu) =>
      fu.taskId === taskId && fu.field === field ? { ...fu, answer: '', answered: false } : fu
    );
    return {
      analysis: { ...analysis, tasks, followUps, updatedAt: new Date().toISOString() },
      error: null,
    };
  }

  const attendees = extractAttendees(analysis.transcript);
  const meetingDateIso = parseMeetingDateToIso(analysis.meta.date);
  const result = field === 'owner' ? validateOwner(trimmed, attendees) : validateDeadline(trimmed, { meetingDateIso });

  if (!result.ok) {
    return { analysis, error: result.error };
  }

  const referenceAnswer = field === 'owner' ? result.value : trimmed;

  const tasks = analysis.tasks.map((task) => {
    if (task.id !== taskId) return task;
    const updated: ExtractedTask = { ...task, [field]: result.value };
    const clarificationReasons = computeClarificationReasons(updated.owner, updated.deadline);
    updated.clarificationReasons = clarificationReasons;
    updated.needsClarification = clarificationReasons.length > 0;
    return updated;
  });

  const followUps = analysis.followUps.map((fu) =>
    fu.taskId === taskId && fu.field === field ? { ...fu, answer: referenceAnswer, answered: true } : fu
  );

  return {
    analysis: { ...analysis, tasks, followUps, updatedAt: new Date().toISOString() },
    error: null,
  };
}
