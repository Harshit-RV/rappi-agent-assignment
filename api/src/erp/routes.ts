import { Router, type Request, type Response } from 'express';
import { Store, listScenarioSummaries, loadScenarioFile } from 'erp';

const router = Router();

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ scenarios: listScenarioSummaries() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const id = paramId(req.params.id);
  try {
    const scenario = loadScenarioFile(id);
    const store = Store.fromSnapshot(scenario);

    res.json({
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      situation: scenario.situation,
      state: store.snapshot(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

export default router;
