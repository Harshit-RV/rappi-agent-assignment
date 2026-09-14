import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { RunEvent, RunStatus } from '../types';
import { Collapsible, useRunEventsOpen } from './Collapsible';

type Props = {
  status: RunStatus;
  runId: string | null;
  events: RunEvent[];
  error: string | null;
  onDecision: (approved: boolean, reason?: string) => void;
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
    case 'awaiting_approval':
      return 'Needs approval';
    case 'escalated':
      return 'Escalated';
    case 'rejected':
      return 'Rejected';
  }
}

function formatToolArgsInline(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ');
}

export function RunTrace({ status, runId, events, error, onDecision }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const [eventsOpen, setEventsOpen] = useRunEventsOpen(status);
  const [listOverflows, setListOverflows] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // Last done, not first — a resumed run appends a second done with the
  // real outcome after the pre-approval pause's done (which is just intent).
  // A rejection never resumes, so its only done is that stale pre-approval
  // intent — there is no real final text for a rejected run, show none.
  const done = [...events].reverse().find((e) => e.type === 'done');
  const isTerminal = status === 'completed' || status === 'escalated';
  const finalText = isTerminal && done?.type === 'done' ? done.summary.finalText : null;
  const isLive = status === 'starting' || status === 'running';

  // Most recent pending approval / escalation still relevant to this run.
  // A later approval_decided or a fresh approval_requested supersedes it.
  const latestApprovalRequest = [...events]
    .reverse()
    .find((e) => e.type === 'approval_requested');
  const latestEscalation = [...events].reverse().find((e) => e.type === 'escalation');
  const pending =
    status === 'awaiting_approval' && latestApprovalRequest?.type === 'approval_requested'
      ? latestApprovalRequest.pending
      : null;
  const escalation =
    status === 'escalated' && latestEscalation?.type === 'escalation'
      ? latestEscalation.escalation
      : null;
  const rejection =
    status === 'rejected'
      ? [...events].reverse().find((e) => e.type === 'approval_decided' && !e.approved)
      : null;

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
              if (event.type === 'approval_requested') {
                return (
                  <li key={`approval-req-${index}`} className="event approval-request">
                    <span className="event-label">gate → needs approval</span>
                    <strong>{event.pending.toolName}</strong>
                    <pre>{formatToolArgsInline(event.pending.args)}</pre>
                    <p>{event.pending.reason}</p>
                  </li>
                );
              }
              if (event.type === 'approval_decided') {
                return (
                  <li
                    key={`approval-dec-${index}`}
                    className={
                      event.approved
                        ? 'event approval-decision approved'
                        : 'event approval-decision denied'
                    }
                  >
                    <span className="event-label">
                      buyer → {event.approved ? 'approved' : 'rejected'}
                    </span>
                    {event.reason && <p>{event.reason}</p>}
                  </li>
                );
              }
              if (event.type === 'escalation') {
                return (
                  <li key={`escalation-${index}`} className="event escalation">
                    <span className="event-label">agent → escalated to buyer</span>
                    <p>{event.escalation.reason}</p>
                    {event.escalation.context && <p>{event.escalation.context}</p>}
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

      {pending && (
        <article className="approval-panel">
          <p className="eyebrow">Human approval required</p>
          <h3>{pending.toolName}</h3>
          <pre className="approval-args">{formatToolArgsInline(pending.args)}</pre>
          <p className="approval-reason">{pending.reason}</p>
          <p className="approval-note">
            The orchestrator blocked this write — validation didn't cleanly pass, so it
            won't execute without your sign-off.
          </p>
          <label className="field">
            <span className="eyebrow">Note (optional, shown to the agent if rejected)</span>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Use the alternate supplier instead"
              rows={2}
            />
          </label>
          <div className="approval-actions">
            <button
              type="button"
              className="approve-btn"
              onClick={() => onDecision(true)}
            >
              Approve
            </button>
            <button
              type="button"
              className="reject-btn"
              onClick={() => onDecision(false, rejectReason)}
            >
              Reject
            </button>
          </div>
        </article>
      )}

      {escalation && (
        <article className="escalation-panel">
          <p className="eyebrow">Escalated to buyer</p>
          <p>{escalation.reason}</p>
          {escalation.context && <p className="muted">{escalation.context}</p>}
        </article>
      )}

      {rejection && rejection.type === 'approval_decided' && (
        <article className="escalation-panel">
          <p className="eyebrow">Outcome</p>
          <h3>Request rejected</h3>
          <p>Nothing was written — the plan was blocked before it could execute.</p>
          {rejection.reason && <p className="muted">{rejection.reason}</p>}
        </article>
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
