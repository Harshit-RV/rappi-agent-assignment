import type { RunEvent, ScenarioDetail, ScenarioSummary } from './types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function listScenarios(): Promise<ScenarioSummary[]> {
  const data = await getJson<{ scenarios: ScenarioSummary[] }>('/api/scenarios');
  return data.scenarios;
}

export async function getScenario(id: string): Promise<ScenarioDetail> {
  return getJson<ScenarioDetail>(`/api/scenarios/${id}`);
}

export async function startRun(
  scenarioId: string,
  prompt?: string
): Promise<{ runId: string; scenarioId: string }> {
  const res = await fetch(`${API_BASE}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId, prompt: prompt?.trim() || undefined }),
  });
  const body = (await res.json().catch(() => null)) as
    | { runId: string; scenarioId: string; error?: string }
    | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to start run (${res.status})`);
  }
  if (!body?.runId) throw new Error('API did not return a runId');
  return body;
}

// Approve or reject a run paused on awaiting_approval. On approve, the run
// resumes on the same id — reconnect subscribeRunEvents to see it continue.
export async function submitDecision(
  runId: string,
  approved: boolean,
  reason?: string
): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approved, reason: reason?.trim() || undefined }),
  });
  const body = (await res.json().catch(() => null)) as
    | { runId: string; status: string; error?: string }
    | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to submit decision (${res.status})`);
  }
  if (!body?.runId) throw new Error('API did not return a runId');
  return body;
}

const EVENT_TYPES = [
  'tool_call',
  'tool_result',
  'assistant_message',
  'approval_requested',
  'approval_decided',
  'escalation',
  'done',
  'error',
] as const;

// GET /events replays the run's full history before streaming live events.
// On a resumed run that history includes the original pause's done event —
// skip already-seen events so only ones past the resume point are acted on.
export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onConnectionError?: (message: string) => void,
  skip = 0
): () => void {
  const source = new EventSource(`${API_BASE}/api/runs/${runId}/events`);
  // EventSource fires onerror on any connection drop, including our own
  // clean close after done/error — readyState goes to CONNECTING (it
  // auto-reconnects) before CLOSED, so track intentional closes ourselves.
  let closedIntentionally = false;
  let seen = 0;

  function closeIntentionally() {
    closedIntentionally = true;
    source.close();
  }

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      try {
        const data = JSON.parse((message as MessageEvent).data) as RunEvent;
        seen += 1;
        if (seen <= skip) return;

        onEvent(data);
        if (data.type === 'done' || data.type === 'error') {
          closeIntentionally();
        }
      } catch {
        onConnectionError?.(`Failed to parse ${type} event`);
      }
    });
  }

  source.onerror = () => {
    if (closedIntentionally || source.readyState === EventSource.CLOSED) return;
    onConnectionError?.('Lost connection to the run stream');
    closeIntentionally();
  };

  return () => closeIntentionally();
}
