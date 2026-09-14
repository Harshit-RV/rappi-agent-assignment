import { randomUUID } from 'crypto';
import type { CreateRunInput, PendingResumeState, RunEvent, RunRecord } from './types';

type Subscriber = (event: RunEvent, isReplay: boolean) => void;

const runs = new Map<string, RunRecord>();
const subscribers = new Map<string, Set<Subscriber>>();

export function createRun(input: CreateRunInput & { prompt: string }): RunRecord {
  const run: RunRecord = {
    id: randomUUID(),
    scenarioId: input.scenarioId,
    prompt: input.prompt,
    status: 'running',
    createdAt: Date.now(),
    events: [],
    summary: null,
    error: null,
    pendingResume: null,
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
    run.summary = event.summary;
    switch (event.summary.stopReason) {
      case 'AWAITING_APPROVAL':
        run.status = 'awaiting_approval';
        break;
      case 'ESCALATED':
        run.status = 'escalated';
        break;
      default:
        run.status = 'completed';
    }
  } else if (event.type === 'error') {
    run.status = 'failed';
    run.error = event.message;
  }

  const subs = subscribers.get(runId);
  if (!subs) return;
  for (const sub of subs) {
    sub(event, false);
  }
}

export function setPendingResume(runId: string, pending: PendingResumeState): void {
  const run = runs.get(runId);
  if (!run) return;
  run.pendingResume = pending;
}

export function clearPendingResume(runId: string): void {
  const run = runs.get(runId);
  if (!run) return;
  run.pendingResume = null;
}

export function markRunning(runId: string): void {
  const run = runs.get(runId);
  if (!run) return;
  run.status = 'running';
  if (!subscribers.has(runId)) {
    subscribers.set(runId, new Set());
  }
}

export function markRejected(runId: string): void {
  const run = runs.get(runId);
  if (!run) return;
  run.status = 'rejected';
}

export type SubscribeResult = {
  unsubscribe: () => void;
  // False if the run had already ended before subscribing — no live events
  // are coming, so the replay above is the complete picture.
  isLive: boolean;
};

/**
 * Replay every event so far, then deliver live events until the run ends.
 */
export function subscribe(runId: string, onEvent: Subscriber): SubscribeResult | undefined {
  const run = runs.get(runId);
  if (!run) return undefined;

  for (const event of run.events) {
    onEvent(event, true);
  }

  if (run.status !== 'running') {
    return { unsubscribe: () => undefined, isLive: false };
  }

  let subs = subscribers.get(runId);
  if (!subs) {
    subs = new Set();
    subscribers.set(runId, subs);
  }
  subs.add(onEvent);

  return { unsubscribe: () => subs?.delete(onEvent), isLive: true };
}
