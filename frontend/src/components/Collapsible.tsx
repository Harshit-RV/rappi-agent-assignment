import { useEffect, useId, useState, type ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function Collapsible({ title, subtitle, open, onOpenChange, children }: Props) {
  const panelId = useId();

  return (
    <div className={open ? 'collapsible open' : 'collapsible'}>
      <button
        type="button"
        className="collapsible-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        <span className="collapsible-copy">
          <span className="collapsible-title">{title}</span>
          {subtitle && <span className="collapsible-subtitle">{subtitle}</span>}
        </span>
        <span className="collapsible-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <div
        id={panelId}
        className="collapsible-panel"
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

/** Keeps events open while running; collapses when the run finishes. Manual toggle still works. */
export function useRunEventsOpen(status: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (status === 'starting' || status === 'running') {
      setOpen(true);
    } else if (status === 'completed' || status === 'failed') {
      setOpen(false);
    }
  }, [status]);

  return [open, setOpen];
}
