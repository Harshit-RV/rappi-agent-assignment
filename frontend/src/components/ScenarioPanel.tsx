import type { ScenarioDetail, ScenarioSummary } from '../types';

type Props = {
  scenarios: ScenarioSummary[];
  selectedId: string | null;
  detail: ScenarioDetail | null;
  loadingDetail: boolean;
  extraPrompt: string;
  running: boolean;
  onSelect: (id: string) => void;
  onExtraPromptChange: (value: string) => void;
  onRun: () => void;
};

export function ScenarioPanel({
  scenarios,
  selectedId,
  detail,
  loadingDetail,
  extraPrompt,
  running,
  onSelect,
  onExtraPromptChange,
  onRun,
}: Props) {
  const situation = detail?.situation;

  return (
    <aside className="panel sidebar">
      <header className="panel-head">
        <p className="eyebrow">Scenarios</p>
        <h2>What should the buyer review?</h2>
      </header>

      <ul className="scenario-list">
        {scenarios.map((scenario) => {
          const active = scenario.id === selectedId;
          return (
            <li key={scenario.id}>
              <button
                type="button"
                className={active ? 'scenario-item active' : 'scenario-item'}
                onClick={() => onSelect(scenario.id)}
              >
                <span className="scenario-name">{scenario.name}</span>
                <span className="scenario-desc">{scenario.description}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="situation">
        <p className="eyebrow">Situation</p>
        {loadingDetail && <p className="muted">Loading scenario…</p>}
        {!loadingDetail && situation && (
          <dl className="kv">
            <div>
              <dt>Product</dt>
              <dd>{situation.productId}</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{situation.nodeId}</dd>
            </div>
            <div>
              <dt>Recommended qty</dt>
              <dd className="qty">{situation.recommendedQuantity}</dd>
            </div>
            {situation.note && (
              <div className="full">
                <dt>Note</dt>
                <dd>{situation.note}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <label className="field">
        <span className="eyebrow">Extra buyer instructions (optional)</span>
        <textarea
          value={extraPrompt}
          onChange={(e) => onExtraPromptChange(e.target.value)}
          placeholder="e.g. Prefer SUP-VEND-02 if price is close"
          rows={3}
          disabled={running}
        />
      </label>

      <button
        type="button"
        className="run-btn"
        disabled={!selectedId || running}
        onClick={onRun}
      >
        {running ? 'Agent running…' : 'Run purchasing agent'}
      </button>
    </aside>
  );
}
