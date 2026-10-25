import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLocally } from './localAnalyzer.ts';
import { SAMPLE_TRANSCRIPT } from '../data/sampleTranscript.ts';

test('existing sample transcript extraction is not disrupted by the status changes', () => {
  const raw = analyzeLocally(SAMPLE_TRANSCRIPT);
  // Same task count as before this change (7), confirming clause-splitting/broadened
  // keywords did not introduce duplicates or new false positives on existing data.
  assert.equal(raw.tasks.length, 7);
  for (const t of raw.tasks) {
    assert.ok(['done', 'ongoing', 'pending'].includes(t.status), `unexpected status: ${t.status}`);
  }
  assert.equal(raw.decisions.length, 4);
});
