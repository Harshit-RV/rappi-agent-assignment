import { Router, type Request, type Response } from 'express';
import * as registry from './registry';
import { startRun, submitDecision } from './service';
import type { RunEvent } from './types';

const router = Router();

function writeSse(res: Response, event: RunEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

router.post('/', (req: Request, res: Response) => {
  const scenarioId =
    typeof req.body?.scenarioId === 'string' ? req.body.scenarioId : '';
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : undefined;

  try {
    const run = startRun({ scenarioId, prompt });
    res.status(202).json({ runId: run.id, scenarioId: run.scenarioId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

// GET /api/runs/:id — snapshot for reconnects / polling. pendingResume holds
// a live Store + raw model messages for resuming server-side; only the
// buyer-facing pendingApproval is worth shipping to the client.
router.get('/:id', (req: Request, res: Response) => {
  const run = registry.getRun(paramId(req.params.id));

  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  const { pendingResume, ...rest } = run;
  res.json({
    ...rest,
    pendingApproval: pendingResume?.pendingApproval ?? null,
  });
});

/**
 * POST /api/runs/:id/decision — approve or reject a run paused on
 * awaiting_approval. Approving resumes the same run on the same events
 * stream (reconnect to GET /api/runs/:id/events to see it continue).
 */
router.post('/:id/decision', (req: Request, res: Response) => {
  const runId = paramId(req.params.id);
  const approved = req.body?.approved;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'approved (boolean) is required' });
    return;
  }

  try {
    const run = submitDecision(runId, { approved, reason });
    res.status(202).json({ runId: run.id, status: run.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * GET /api/runs/:id/events — Server-Sent Events.
 * Replays history, then streams live events until done/error, then closes.
 */
router.get('/:id/events', (req: Request, res: Response) => {
  const run = registry.getRun(paramId(req.params.id));
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;

  const unsubscribe = registry.subscribe(run.id, (event) => {
    if (closed) return;
    writeSse(res, event);

    if (event.type === 'done' || event.type === 'error') {
      closed = true;
      res.end();
    }
  });

  if (!unsubscribe) {
    res.end();
    return;
  }

  req.on('close', () => {
    closed = true;
    unsubscribe();
  });
});

export default router;
