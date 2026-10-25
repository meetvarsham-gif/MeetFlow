// Lightweight test harness using Node's built-in test runner (no new dependency).
// Run with: node --test src/services/taskStatus.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLocally } from './localAnalyzer.ts';
import { applyFollowUpAnswer, runAnalysis } from './analyze.ts';
import type { AppSettings } from '../types.ts';

const SETTINGS: AppSettings = { openaiApiKey: '', model: 'gpt-4o-mini' };

function firstTaskFor(transcript: string, matchText: string) {
  const raw = analyzeLocally(transcript);
  const task = raw.tasks.find((t) => t.description.toLowerCase().includes(matchText.toLowerCase()));
  assert.ok(task, `expected a task matching "${matchText}" in: ${JSON.stringify(raw.tasks)}`);
  return task!;
}

test('1. "The report is finished." -> done', () => {
  const t = firstTaskFor('Rahul: The report is finished.', 'report');
  assert.equal(t.status, 'done');
});

test('2. "The report is currently being written." -> ongoing', () => {
  const t = firstTaskFor('Rahul: The report is currently being written.', 'report');
  assert.equal(t.status, 'ongoing');
});

test('3. "We need to write the report." -> pending', () => {
  const t = firstTaskFor('Rahul: We need to write the report.', 'report');
  assert.equal(t.status, 'pending');
});

test('4. "Rahul will start tomorrow." -> pending', () => {
  const raw = analyzeLocally('Attendees: Rahul\nPriya: Rahul will start tomorrow.');
  const task = raw.tasks.find((t) => t.description.toLowerCase().includes('rahul will start'));
  assert.ok(task, `expected a task in: ${JSON.stringify(raw.tasks)}`);
  assert.equal(task!.status, 'pending');
  assert.equal(task!.owner, 'Rahul');
});

test('5. "The task is nearly finished." -> ongoing', () => {
  const t = firstTaskFor('Rahul: The task is nearly finished.', 'task');
  assert.equal(t.status, 'ongoing');
});

test('6. "We discussed the report." -> not treated as an active task', () => {
  const raw = analyzeLocally('Rahul: We discussed the report.');
  assert.equal(raw.tasks.length, 0);
});

test('7. "Testing is finished, but two bugs remain." -> testing done, bug fix pending (two tasks)', () => {
  const raw = analyzeLocally('Rahul: Testing is finished, but two bugs remain.');
  assert.equal(raw.tasks.length, 2);
  const [first, second] = raw.tasks;
  assert.equal(first.status, 'done');
  assert.match(first.description.toLowerCase(), /testing/);
  assert.equal(second.status, 'pending');
  assert.match(second.description.toLowerCase(), /bug/);
});

test('8. "The task is ongoing, but nobody owns it." -> ongoing, single task, owner unresolved', () => {
  const raw = analyzeLocally('Attendees: Rahul, Priya\nRahul: The task is ongoing, but nobody owns it.');
  assert.equal(raw.tasks.length, 1);
  assert.equal(raw.tasks[0].status, 'ongoing');
  assert.equal(raw.tasks[0].owner, null);
});

test('9. "The task must be done by Friday, but nobody has started." -> pending, single task', () => {
  const raw = analyzeLocally('Rahul: The task must be done by Friday, but nobody has started.');
  assert.equal(raw.tasks.length, 1);
  assert.equal(raw.tasks[0].status, 'pending');
});

test('10. An invalid clarification answer must not change the task status', async () => {
  const transcript = `Meeting: Status Test
Attendees: Rahul, Priya

Rahul: We need to write the report.
`;
  const analysis = await runAnalysis(transcript, SETTINGS);
  const task = analysis.tasks.find((t) => t.description.toLowerCase().includes('report'));
  assert.ok(task);
  assert.equal(task!.status, 'pending');

  const followUp = analysis.followUps.find((f) => f.taskId === task!.id && f.field === 'owner');
  assert.ok(followUp, 'expected an owner follow-up since no owner was identified');

  // "ME" is not a valid attendee — this must be rejected without touching the task.
  const result = applyFollowUpAnswer(analysis, followUp!.id, 'ME');
  assert.ok(result.error, 'expected validation to reject "ME" as an owner');
  const unchangedTask = result.analysis.tasks.find((t) => t.id === task!.id)!;
  assert.equal(unchangedTask.status, 'pending');
  assert.equal(unchangedTask.owner, null);

  // A VALID clarification answer must also leave status untouched (test 8's rule, generalized):
  // resolving the owner should not flip 'pending' to 'done'. The task still has no deadline, so
  // needsClarification correctly stays true (now only for the still-missing deadline).
  const validResult = applyFollowUpAnswer(analysis, followUp!.id, 'Rahul');
  assert.equal(validResult.error, null);
  const resolvedTask = validResult.analysis.tasks.find((t) => t.id === task!.id)!;
  assert.equal(resolvedTask.owner, 'Rahul');
  assert.equal(resolvedTask.status, 'pending', 'answering a clarification question must not change status');
  assert.deepEqual(resolvedTask.clarificationReasons, ['missing-deadline']);
});

// Bonus: the illustrative "Priya finished the database integration. She is now testing the API.
// The frontend still needs to be built." example from the spec — not a numbered test case, but
// a good regression check that distinct commitments aren't merged or duplicated.
test('bonus: three distinct statements yield three distinct tasks', () => {
  const transcript = `Attendees: Priya
Priya: Priya finished the database integration. The frontend still needs to be built.`;
  const raw = analyzeLocally(transcript);
  assert.equal(raw.tasks.length, 2);
  assert.equal(raw.tasks[0].status, 'done');
  assert.equal(raw.tasks[0].owner, 'Priya');
  assert.equal(raw.tasks[1].status, 'pending');
});
