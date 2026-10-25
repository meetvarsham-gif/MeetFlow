import type { MeetingAnalysis } from '../types';
import { formatDeadlineDisplay } from './validation';

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function safeFileSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'meeting-analysis';
}

export function exportAsJSON(analysis: MeetingAnalysis): void {
  const slug = safeFileSlug(analysis.meta.title);
  triggerDownload(`${slug}.json`, JSON.stringify(analysis, null, 2), 'application/json');
}

export function exportAsText(analysis: MeetingAnalysis): void {
  const lines: string[] = [];
  lines.push(`MEETING ANALYSIS: ${analysis.meta.title}`);
  if (analysis.meta.date) lines.push(`Date: ${analysis.meta.date}`);
  if (analysis.meta.attendees.length) lines.push(`Attendees: ${analysis.meta.attendees.join(', ')}`);
  lines.push(`Generated: ${new Date(analysis.updatedAt).toLocaleString()}`);
  lines.push(`Mode: ${analysis.provider === 'openai' ? 'AI Provider (OpenAI)' : 'Local Demo Mode'}`);
  lines.push('');
  lines.push('SUMMARY');
  lines.push('-------');
  lines.push(analysis.summary);
  lines.push('');
  lines.push('KEY DECISIONS');
  lines.push('-------------');
  if (analysis.decisions.length === 0) {
    lines.push('(none identified)');
  } else {
    analysis.decisions.forEach((d, i) => lines.push(`${i + 1}. ${d.text}`));
  }
  lines.push('');
  lines.push('ACTION ITEMS');
  lines.push('------------');
  if (analysis.tasks.length === 0) {
    lines.push('(none identified)');
  } else {
    analysis.tasks.forEach((t, i) => {
      const owner = t.owner ?? 'UNASSIGNED';
      const deadline = formatDeadlineDisplay(t.deadline) ?? 'NO DEADLINE';
      const flag = t.needsClarification ? '  [NEEDS CLARIFICATION]' : '';
      lines.push(`${i + 1}. [${t.status.toUpperCase()}] ${t.description}`);
      lines.push(`   Owner: ${owner} | Deadline: ${deadline}${flag}`);
    });
  }

  const unanswered = analysis.followUps.filter((f) => !f.answered);
  if (unanswered.length > 0) {
    lines.push('');
    lines.push('OPEN FOLLOW-UP QUESTIONS');
    lines.push('------------------------');
    unanswered.forEach((f, i) => lines.push(`${i + 1}. ${f.question}`));
  }

  const slug = safeFileSlug(analysis.meta.title);
  triggerDownload(`${slug}.txt`, lines.join('\n'), 'text/plain');
}
