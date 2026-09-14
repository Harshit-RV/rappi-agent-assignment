import { randomUUID } from 'crypto';
import type { CreateRunInput, RunEvent, RunRecord } from './types';

type Subscriber = (event: RunEvent) => void;

const runs = new Map<string, RunRecord>();
const subscribers = new Map<string, Set<Subscriber>>();

export function createRun(input: CreateRunInput): RunRecord {
  const run: RunRecord = {
    id: randomUUID(),
    prompt: input.prompt,
    status: 'running',
    createdAt: Date.now(),
    events: [],
    summary: null,
    error: null,
  };

  runs.set(run.id, run);
  subscribers.set(run.id, new Set());
  return run;
}

export function getRun(id: string): RunRecord | undefined {
  return runs.get(id);
}

export function appendEvent(runId: string, event: RunEvent): void {
  const run = runs.get(runId);
  if (!run) return;

  run.events.push(event);

  if (event.type === 'done') {
    run.status = 'completed';
    run.summary = event.summary;
  } else if (event.type === 'error') {
    run.status = 'failed';
    run.error = event.message;
  }

  const subs = subscribers.get(runId);
  if (!subs) return;
  for (const sub of subs) {
    sub(event);
  }
}

/**
 * Replay every event so far, then deliver live events until the run ends.
 * Returns an unsubscribe function for client disconnects.
 */
export function subscribe(
  runId: string,
  onEvent: Subscriber
): (() => void) | undefined {
  const run = runs.get(runId);
  if (!run) return undefined;

  for (const event of run.events) {
    onEvent(event);
  }

  // Already finished before subscribe — nothing live to wait for.
  if (run.status !== 'running') {
    return () => undefined;
  }

  let subs = subscribers.get(runId);
  if (!subs) {
    subs = new Set();
    subscribers.set(runId, subs);
  }
  subs.add(onEvent);

  return () => {
    subs?.delete(onEvent);
  };
}
