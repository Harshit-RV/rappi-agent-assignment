import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { RunEvent, RunStatus } from '../types';
import { Collapsible, useRunEventsOpen } from './Collapsible';

type Props = {
  status: RunStatus;
  runId: string | null;
  events: RunEvent[];
  error: string | null;
};

function truncate(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function formatArgs(args: unknown): string {
  try {
    return truncate(JSON.stringify(args));
  } catch {
    return String(args);
  }
}

function statusLabel(status: RunStatus): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'starting':
      return 'Starting';
    case 'running':
      return 'Investigating';
    case 'completed':
      return 'Complete';
    case 'failed':
      return 'Failed';
  }
}

export function RunTrace({ status, runId, events, error }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const [eventsOpen, setEventsOpen] = useRunEventsOpen(status);
  const [listOverflows, setListOverflows] = useState(false);
  const done = events.find((e) => e.type === 'done');
  const finalText = done?.type === 'done' ? done.summary.finalText : null;
  const isLive = status === 'starting' || status === 'running';

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      setListOverflows(list.scrollHeight > list.clientHeight + 1);
    };

    // Wait a frame so the collapsible panel has laid out before measuring.
    const raf = requestAnimationFrame(measure);
    if (eventsOpen) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
    return () => cancelAnimationFrame(raf);
  }, [events, status, eventsOpen]);

  const eventSubtitle =
    events.length === 0
      ? 'No events yet'
      : `${events.length} event${events.length === 1 ? '' : 's'}${
          eventsOpen ? '' : ' · collapsed'
        }`;

  return (
    <section className="panel trace">
      <header className="panel-head trace-head">
        <div>
          <p className="eyebrow">Live trace</p>
          <h2>Agent activity</h2>
        </div>
        <div className="status-block">
          <span className={`pill status-${status}`}>
            {isLive && <span className="spinner" aria-hidden="true" />}
            {statusLabel(status)}
          </span>
          {runId && <code className="run-id">{runId.slice(0, 8)}</code>}
        </div>
      </header>

      {status === 'idle' && events.length === 0 && (
        <p className="empty">
          Select a scenario and run the agent. Tool calls and the final decision
          will stream here.
        </p>
      )}

      {error && <p className="error-banner">{error}</p>}

      {isLive && (
        <div className="live-banner" role="status" aria-live="polite">
          <span className="spinner large" aria-hidden="true" />
          <div>
            <strong>
              {status === 'starting' ? 'Starting agent run…' : 'Agent is working…'}
            </strong>
            <p>
              {events.length === 0
                ? 'Waiting for the first tool call.'
                : `${events.length} event${events.length === 1 ? '' : 's'} so far — streaming live.`}
            </p>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <Collapsible
          title="Events"
          subtitle={eventSubtitle}
          open={eventsOpen}
          onOpenChange={setEventsOpen}
        >
          <ol
            className={listOverflows ? 'event-list has-overflow' : 'event-list'}
            ref={listRef}
          >
            {events.map((event, index) => {
              if (event.type === 'tool_call') {
                return (
                  <li key={`${event.id}-call-${index}`} className="event tool-call">
                    <span className="event-label">tool →</span>
                    <strong>{event.name}</strong>
                    <pre>{formatArgs(event.args)}</pre>
                  </li>
                );
              }
              if (event.type === 'tool_result') {
                return (
                  <li
                    key={`${event.id}-result-${index}`}
                    className={
                      event.isError ? 'event tool-result error' : 'event tool-result'
                    }
                  >
                    <span className="event-label">
                      ← {event.isError ? 'error' : 'ok'} · {event.durationMs.toFixed(0)}ms
                    </span>
                    <strong>{event.name}</strong>
                    <pre>{truncate(event.content, 420)}</pre>
                  </li>
                );
              }
              if (event.type === 'assistant_message') {
                return (
                  <li key={`asst-${index}`} className="event assistant">
                    <span className="event-label">assistant</span>
                    <p>{event.text}</p>
                  </li>
                );
              }
              if (event.type === 'error') {
                return (
                  <li key={`err-${index}`} className="event run-error">
                    <span className="event-label">error</span>
                    <p>{event.message}</p>
                  </li>
                );
              }
              if (event.type === 'done') {
                return (
                  <li key={`done-${index}`} className="event done-meta">
                    <span className="event-label">done</span>
                    <p>
                      {event.summary.stopReason} · {event.summary.iterations} steps ·{' '}
                      {(event.summary.durationMs / 1000).toFixed(1)}s
                    </p>
                  </li>
                );
              }
              return null;
            })}
          </ol>
        </Collapsible>
      )}

      {finalText && (
        <article className="decision">
          <p className="eyebrow">Decision</p>
          <div className="decision-body markdown">
            <Markdown>{finalText}</Markdown>
          </div>
        </article>
      )}
    </section>
  );
}
