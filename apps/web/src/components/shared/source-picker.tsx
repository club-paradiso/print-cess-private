import type { ReactNode } from "react";

export type FileSource = {
  id: string;
  icon: ReactNode;
  label: string;
  hint?: string | undefined;
  onPick: () => void;
};

export function SourcePicker({ sources }: { sources: readonly FileSource[] }) {
  return (
    <div className="source-picker">
      {sources.map((source) => (
        <button key={source.id} type="button" className="source-tile" onClick={source.onPick}>
          <span className="source-tile__icon" aria-hidden="true">
            {source.icon}
          </span>
          <span className="source-tile__label">{source.label}</span>
          {source.hint ? <span className="source-tile__hint">{source.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
