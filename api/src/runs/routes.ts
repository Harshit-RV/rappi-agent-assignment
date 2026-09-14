import { Router, type Request, type Response } from 'express';
import * as registry from './registry';
import { startRun } from './service';
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

// GET /api/runs/:id — snapshot for reconnects / polling
router.get('/:id', (req: Request, res: Response) => {
  const run = registry.getRun(paramId(req.params.id));

  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  res.json(run);
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
