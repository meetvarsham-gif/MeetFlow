import type { MeetingMeta, RawExtraction, TaskLifecycleStatus } from '../types';

interface SpeakerLine {
  speaker: string | null;
  text: string;
}

const DECISION_KEYWORDS =
  /\b(decided|decision made|we'll go with|agreed|that's final|final decision|confirmed|resolved|let's go with)\b/i;

const ACTION_KEYWORDS =
  /\b(I'll|I will|will own|needs to|need to|should own|should take|action item|todo|to-do|can you|could you|has to|going to|can take|can own)\b/i;

const NOISE_PATTERN =
  /\b(not sure|unclear|let's figure that out|let's leave that|good question|we'll confirm|we discussed|discussed the)\b/i;

const DEADLINE_PATTERNS = [
  /\bby\s+([^,.!?;]+)/i,
  /\b(today|tomorrow|end of (?:day|week|month)|EOD|EOW|next (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
];

// Splits a sentence into independent clauses on strong contrastive conjunctions, so a sentence
// describing two distinct things ("Testing is finished, but two bugs remain.") can yield two
// separate tasks instead of being forced into one. Sentences without these conjunctions are
// unaffected (the split simply returns the original sentence as a single clause).
const CLAUSE_SPLIT_PATTERN = /\s*,?\s+\b(?:but|however|although|though)\b\s*/i;

// Lifecycle classification — checked in this order: ONGOING, then explicit future/modal
// obligation (forces PENDING even if a completion word like "done" appears), then DONE,
// defaulting to PENDING when none match. "Nearly/almost finished" is ONGOING, not DONE.
const ONGOING_PATTERNS = [
  /\b(?:is|are)\s+(?:now|currently)\s+\w+ing\b/i,
  /\b(?:is|are)\s+being\s+\w+ed\b/i,
  /\b(?:nearly|almost|mostly|partially)\s+(?:finished|done|complete|completed)\b/i,
  /\b(?:in progress|halfway through|ongoing|still\s+\w+ing)\b/i,
];

const MODAL_OBLIGATION_PATTERN =
  /\b(?:must|should|needs?\s+to|has\s+to|have\s+to)\s+be\s+(?:finished|done|completed|complete)\b/i;

const DONE_PATTERNS = [
  /\b(?:is|are|has|have|was|were)\s+(?:already\s+)?(?:finished|done|completed|complete)\b/i,
  /\b(?:completed|finished|submitted|wrapped up)\b/i,
];

// Catches future-commitment / outstanding-work phrasing that the other patterns miss, so
// sentences like "Rahul will start tomorrow." or "Two bugs remain." are still recognized as
// tasks (defaulting to pending) rather than silently dropped.
const PENDING_TRIGGER_PATTERN = /\b(?:must|will|remain(?:s|ing)?)\b/i;

function isTaskCandidate(clause: string): boolean {
  return (
    ACTION_KEYWORDS.test(clause) ||
    DONE_PATTERNS.some((p) => p.test(clause)) ||
    ONGOING_PATTERNS.some((p) => p.test(clause)) ||
    PENDING_TRIGGER_PATTERN.test(clause)
  );
}

function classifyLifecycleStatus(clause: string): TaskLifecycleStatus {
  if (ONGOING_PATTERNS.some((p) => p.test(clause))) return 'ongoing';
  if (MODAL_OBLIGATION_PATTERN.test(clause)) return 'pending';
  if (DONE_PATTERNS.some((p) => p.test(clause))) return 'done';
  return 'pending';
}

function parseMeta(lines: string[]): { meta: MeetingMeta; bodyStartIndex: number } {
  let title = 'Untitled Meeting';
  let date: string | null = null;
  let attendees: string[] = [];
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const titleMatch = line.match(/^meeting:\s*(.+)$/i);
    const dateMatch = line.match(/^date:\s*(.+)$/i);
    const attendeesMatch = line.match(/^attendees:\s*(.+)$/i);

    if (titleMatch) {
      title = titleMatch[1].trim();
      bodyStartIndex = i + 1;
    } else if (dateMatch) {
      date = dateMatch[1].trim();
      bodyStartIndex = i + 1;
    } else if (attendeesMatch) {
      attendees = attendeesMatch[1]
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      bodyStartIndex = i + 1;
    } else if (line === '') {
      if (bodyStartIndex === i) bodyStartIndex = i + 1;
    } else if (/^[A-Za-z][\w'. -]{0,30}:\s*/.test(line)) {
      // Reached dialogue, stop scanning headers
      break;
    }
  }

  return { meta: { title, date, attendees }, bodyStartIndex };
}

function parseSpeakerLines(lines: string[]): SpeakerLine[] {
  const result: SpeakerLine[] = [];
  const speakerRegex = /^([A-Za-z][\w'. -]{0,30}):\s*(.*)$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(speakerRegex);
    if (match) {
      result.push({ speaker: match[1].trim(), text: match[2].trim() });
    } else {
      result.push({ speaker: null, text: line });
    }
  }
  return result;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitIntoClauses(sentence: string): string[] {
  return sentence
    .split(CLAUSE_SPLIT_PATTERN)
    .map((c) => c.trim())
    .filter(Boolean);
}

function extractDeadline(clause: string): string | null {
  for (const pattern of DEADLINE_PATTERNS) {
    const match = clause.match(pattern);
    if (match) {
      return (match[1] ?? match[0]).trim().replace(/\s+/g, ' ');
    }
  }
  return null;
}

function extractOwner(clause: string, speaker: string | null, knownNames: string[]): string | null {
  const directAddress = clause.match(/^([A-Z][a-zA-Z]+),\s*/);
  if (directAddress && knownNames.includes(directAddress[1])) {
    return directAddress[1];
  }

  if (/\bI('ll| will)\b/i.test(clause) && speaker) {
    return speaker;
  }

  const nameWill = clause.match(
    /\b([A-Z][a-zA-Z]+)\s+(?:will|needs to|should|is going to|can take|can own)\b/
  );
  if (nameWill && knownNames.includes(nameWill[1])) {
    return nameWill[1];
  }

  if (/\bcan take\b|\bcan own\b/i.test(clause) && speaker) {
    return speaker;
  }

  // Fallback: the clause's leading subject matches a known attendee. Covers third-person
  // completion/progress statements the patterns above don't address, e.g. "Rahul completed
  // the database integration." or "Priya is currently testing the API."
  const leadingName = clause.match(/^([A-Z][a-zA-Z]+)\b/);
  if (leadingName && knownNames.includes(leadingName[1])) {
    return leadingName[1];
  }

  return null;
}

function cleanDescription(clause: string): string {
  return clause
    .replace(/^([A-Z][a-zA-Z]+),\s*/, '')
    .replace(/\?+$/, '.')
    .trim();
}

export function analyzeLocally(transcript: string): RawExtraction {
  const lines = transcript.split('\n');
  const { meta, bodyStartIndex } = parseMeta(lines);
  const bodyLines = lines.slice(bodyStartIndex);
  const speakerLines = parseSpeakerLines(bodyLines);

  const detectedNames = new Set<string>(meta.attendees);
  for (const sl of speakerLines) {
    if (sl.speaker) detectedNames.add(sl.speaker);
  }
  const knownNames = Array.from(detectedNames);

  const decisions: string[] = [];
  const tasks: RawExtraction['tasks'] = [];

  for (const { speaker, text } of speakerLines) {
    const sentences = splitIntoSentences(text);
    for (const sentence of sentences) {
      if (NOISE_PATTERN.test(sentence)) continue;

      if (DECISION_KEYWORDS.test(sentence)) {
        decisions.push(sentence.replace(/^(great,?|correct,?|alright,?)\s*/i, '').trim());
      }

      for (const clause of splitIntoClauses(sentence)) {
        if (NOISE_PATTERN.test(clause)) continue;
        if (!isTaskCandidate(clause)) continue;

        const owner = extractOwner(clause, speaker, knownNames);
        const deadline = extractDeadline(clause);
        const description = cleanDescription(clause);
        const status = classifyLifecycleStatus(clause);
        if (description.length > 3) {
          tasks.push({ description, owner, deadline, status });
        }
      }
    }
  }

  const dedupedDecisions = Array.from(new Set(decisions)).filter((d) => d.length > 4);

  const summaryParts: string[] = [];
  summaryParts.push(
    `"${meta.title}"${meta.date ? ` (${meta.date})` : ''} covered ${speakerLines.length} discussion turns` +
      `${meta.attendees.length ? ` among ${meta.attendees.join(', ')}` : ''}.`
  );
  summaryParts.push(
    `The team reached ${dedupedDecisions.length} key decision(s) and identified ${tasks.length} action item(s).`
  );
  const missing = tasks.filter((t) => !t.owner || !t.deadline).length;
  if (missing > 0) {
    summaryParts.push(`${missing} action item(s) are missing an owner and/or deadline and need clarification.`);
  }

  return {
    summary: summaryParts.join(' '),
    decisions: dedupedDecisions,
    tasks,
  };
}

export function extractMeta(transcript: string): MeetingMeta {
  const { meta } = parseMeta(transcript.split('\n'));
  return meta;
}

/** Union of explicitly declared attendees and speakers detected in the dialogue, case-insensitively deduped. */
export function extractAttendees(transcript: string): string[] {
  const lines = transcript.split('\n');
  const { meta, bodyStartIndex } = parseMeta(lines);
  const bodyLines = lines.slice(bodyStartIndex);
  const speakerLines = parseSpeakerLines(bodyLines);

  const seen = new Map<string, string>();
  const addName = (name: string) => {
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  };

  meta.attendees.forEach(addName);
  speakerLines.forEach((sl) => {
    if (sl.speaker) addName(sl.speaker);
  });

  return Array.from(seen.values());
}
