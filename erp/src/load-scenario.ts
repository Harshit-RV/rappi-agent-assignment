import fs from 'fs';
import path from 'path';
import { Store } from './store';
import type { Scenario } from './types';

// Walk up from this file until we find <repo>/data/scenarios.
// Works from erp/src, erp/dist, and when nested under another package's node_modules.
export function scenariosDir(): string {
  if (process.env.SCENARIOS_DIR) {
    return path.resolve(process.env.SCENARIOS_DIR);
  }

  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'data', 'scenarios');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Could not find data/scenarios (started from ${__dirname}). Set SCENARIOS_DIR.`
  );
}

export function listScenarioIds(): string[] {
  const dir = scenariosDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadScenarioFile(scenarioId: string): Scenario {
  const filePath = path.join(scenariosDir(), `${scenarioId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Scenario not found: ${scenarioId} (looked in ${scenariosDir()})`
    );
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Scenario;
  assertScenario(raw, scenarioId);
  return raw;
}

function assertScenario(raw: Scenario, expectedId: string): void {
  if (!raw.id || raw.id !== expectedId) {
    throw new Error(
      `Scenario id mismatch: file says "${raw.id}", expected "${expectedId}"`
    );
  }
  if (!raw.situation?.productId || !raw.situation?.nodeId) {
    throw new Error(`Scenario ${expectedId} is missing situation.productId/nodeId`);
  }
  if (!Array.isArray(raw.products) || raw.products.length === 0) {
    throw new Error(`Scenario ${expectedId} has no products`);
  }
}

/**
 * Fresh Store for one agent run. Scenario carries StoreSnapshot's fields
 * plus metadata, so this just re-reads the file — the file is tiny and
 * this isn't a hot path, so there's no cache to invalidate. Add one only
 * if profiling says the disk read actually matters.
 */
export function loadStore(scenarioId: string): Store {
  return Store.fromSnapshot(loadScenarioFile(scenarioId));
}

export type ScenarioSummary = {
  id: string;
  name: string;
  description: string;
  situation: Scenario['situation'];
};

export function listScenarioSummaries(): ScenarioSummary[] {
  return listScenarioIds().map((id) => {
    const s = loadScenarioFile(id);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      situation: s.situation,
    };
  });
}
