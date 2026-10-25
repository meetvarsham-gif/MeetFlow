import type { AppSettings, ClarificationReason, ExtractedTask, MeetingAnalysis } from '../types';

const HISTORY_KEY = 'meeting-assistant.history.v1';
const SETTINGS_KEY = 'meeting-assistant.settings.v1';
const DRAFT_KEY = 'meeting-assistant.draft.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  openaiApiKey: '',
  model: 'gpt-4o-mini',
};

/**
 * Pre-existing saved data used `status: 'complete' | 'ambiguous'` and `ambiguousReasons` to mean
 * what `needsClarification`/`clarificationReasons` mean now. Migrates that shape on load so old
 * localStorage entries keep working instead of crashing the app; the lifecycle status can't be
 * recovered retroactively, so it defaults to 'pending' (the same safe default used when the
 * transcript provides no evidence either way).
 */
function migrateTask(task: unknown): ExtractedTask {
  const t = (task ?? {}) as Record<string, unknown>;
  if (
    typeof t.needsClarification === 'boolean' &&
    typeof t.status === 'string' &&
    ['done', 'ongoing', 'pending'].includes(t.status)
  ) {
    return t as unknown as ExtractedTask;
  }

  const legacyReasons: ClarificationReason[] = Array.isArray(t.ambiguousReasons)
    ? (t.ambiguousReasons as ClarificationReason[])
    : [];

  return {
    id: typeof t.id === 'string' ? t.id : '',
    description: typeof t.description === 'string' ? t.description : '',
    owner: typeof t.owner === 'string' ? t.owner : null,
    deadline: typeof t.deadline === 'string' ? t.deadline : null,
    status: 'pending',
    needsClarification: legacyReasons.length > 0 || t.status === 'ambiguous',
    clarificationReasons: legacyReasons,
  };
}

function migrateAnalysis(analysis: unknown): MeetingAnalysis {
  const a = (analysis ?? {}) as Record<string, unknown>;
  return {
    ...a,
    tasks: Array.isArray(a.tasks) ? a.tasks.map(migrateTask) : [],
  } as MeetingAnalysis;
}

export function loadHistory(): MeetingAnalysis[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(migrateAnalysis) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history: MeetingAnalysis[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function upsertHistoryEntry(analysis: MeetingAnalysis): MeetingAnalysis[] {
  const history = loadHistory();
  const idx = history.findIndex((h) => h.id === analysis.id);
  if (idx >= 0) {
    history[idx] = analysis;
  } else {
    history.unshift(analysis);
  }
  saveHistory(history);
  return history;
}

export function deleteHistoryEntry(id: string): MeetingAnalysis[] {
  const history = loadHistory().filter((h) => h.id !== id);
  saveHistory(history);
  return history;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadDraft(): { transcript: string; analysis: MeetingAnalysis | null } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      transcript: parsed?.transcript ?? '',
      analysis: parsed?.analysis ? migrateAnalysis(parsed.analysis) : null,
    };
  } catch {
    return null;
  }
}

export function saveDraft(transcript: string, analysis: MeetingAnalysis | null): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ transcript, analysis }));
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}
