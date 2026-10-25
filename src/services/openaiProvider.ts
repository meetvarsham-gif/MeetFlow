import type { RawExtraction } from '../types';

const SYSTEM_PROMPT = `You are a meeting analysis assistant. You will be given a raw meeting transcript.
Extract ONLY information explicitly present in the transcript. Never invent, guess, or infer owners,
deadlines, or decisions that are not clearly stated. If a task has no clearly stated owner, set "owner"
to null. If it has no clearly stated deadline, set "deadline" to null.

For each task, classify its lifecycle "status" as one of:
- "done": the transcript clearly states the task is already complete (e.g. "finished", "completed", "already submitted"). Never infer completion merely because a deadline has passed.
- "ongoing": the transcript clearly indicates the task has started but is not yet complete (e.g. "currently working on", "in progress", "nearly finished").
- "pending": the task has not started, is a future commitment ("will", "needs to"), or there isn't enough evidence of progress or completion. Use this when unsure.
"status" is independent of whether the task is missing an owner or deadline — a "pending" or "ongoing" task does not need clarification just because it hasn't started, and a "done" task can still be missing an owner.
A single statement that mentions multiple distinct pieces of work (e.g. "Testing is finished, but two bugs remain.") should become separate tasks with their own status, not one task.
Do not create a task from a statement that merely discusses or mentions a topic without describing actual work, a commitment, progress, or completion.

Respond with strict JSON only, matching this shape:
{
  "summary": string,            // concise 2-4 sentence factual summary of the meeting
  "decisions": string[],        // key decisions explicitly made
  "tasks": [
    { "description": string, "owner": string | null, "deadline": string | null, "status": "done" | "ongoing" | "pending" }
  ]
}`;

export async function analyzeWithOpenAI(
  transcript: string,
  apiKey: string,
  model: string
): Promise<RawExtraction> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response did not include content.');
  }

  let parsed: RawExtraction;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('OpenAI response was not valid JSON.');
  }

  if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.decisions) || typeof parsed.summary !== 'string') {
    throw new Error('OpenAI response did not match the expected schema.');
  }

  return parsed;
}
