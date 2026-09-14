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

const EVENT_TYPES = [
  'tool_call',
  'tool_result',
  'assistant_message',
  'done',
  'error',
] as const;

export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onConnectionError?: (message: string) => void
): () => void {
  const source = new EventSource(`${API_BASE}/api/runs/${runId}/events`);

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      try {
        const data = JSON.parse((message as MessageEvent).data) as RunEvent;
        onEvent(data);
      } catch {
        onConnectionError?.(`Failed to parse ${type} event`);
      }
    });
  }

  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) return;
    onConnectionError?.('Lost connection to the run stream');
    source.close();
  };

  return () => source.close();
}
