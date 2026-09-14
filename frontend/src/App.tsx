import { useEffect, useRef, useState } from 'react';
import { getScenario, listScenarios, startRun, subscribeRunEvents } from './api';
import { RunTrace } from './components/RunTrace';
import { ScenarioPanel } from './components/ScenarioPanel';
import type { RunEvent, RunStatus, ScenarioDetail, ScenarioSummary } from './types';

export default function App() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [extraPrompt, setExtraPrompt] = useState('');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    listScenarios()
      .then((list) => {
        if (cancelled) return;
        setScenarios(list);
        if (list[0]) setSelectedId(list[0].id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBootError(
          err instanceof Error
            ? err.message
            : 'Could not load scenarios. Is the API running on :3001?'
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    getScenario(selectedId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setError(err instanceof Error ? err.message : 'Failed to load scenario');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  async function handleRun() {
    if (!selectedId) return;
    unsubscribeRef.current?.();
    setError(null);
    setEvents([]);
    setRunId(null);
    setStatus('starting');

    try {
      const { runId: id } = await startRun(selectedId, extraPrompt);
      setRunId(id);
      setStatus('running');

      unsubscribeRef.current = subscribeRunEvents(
        id,
        (event) => {
          setEvents((prev) => [...prev, event]);
          if (event.type === 'done') {
            setStatus('completed');
            unsubscribeRef.current?.();
            unsubscribeRef.current = null;
          } else if (event.type === 'error') {
            setStatus('failed');
            setError(event.message);
            unsubscribeRef.current?.();
            unsubscribeRef.current = null;
          }
        },
        (message) => {
          setStatus((current) => (current === 'running' ? 'failed' : current));
          setError(message);
        }
      );
    } catch (err: unknown) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Failed to start run');
    }
  }

  const running = status === 'starting' || status === 'running';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">Rappi Purchasing Agent</p>
          <p className="tagline">Investigate recommendations. Act. Validate.</p>
        </div>
        <p className="api-hint">API · localhost:3001</p>
      </header>

      {bootError && (
        <div className="boot-error">
          <strong>Cannot reach API.</strong> {bootError}
          <span> Start it with <code>cd api && yarn dev</code>.</span>
        </div>
      )}

      <main className="layout">
        <ScenarioPanel
          scenarios={scenarios}
          selectedId={selectedId}
          detail={detail}
          loadingDetail={loadingDetail}
          extraPrompt={extraPrompt}
          running={running}
          onSelect={setSelectedId}
          onExtraPromptChange={setExtraPrompt}
          onRun={() => {
            void handleRun();
          }}
        />
        <RunTrace status={status} runId={runId} events={events} error={error} />
      </main>
    </div>
  );
}
