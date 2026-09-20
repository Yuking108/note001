'use client';

import { useMemo, useState } from 'react';
import type { IndexedLabel } from '@/lib/types';
import { labelAncestry, labelKey } from '@/lib/labels';

type Props = {
  labels: IndexedLabel[];
  selected: string[];
  onToggle: (path: string) => void;
};

export function LabelTree({ labels, selected, onToggle }: Props) {
  const byPath = useMemo(() => {
    const map = new Map<string, IndexedLabel>();
    for (const label of labels) map.set(label.path, label);
    return map;
  }, [labels]);

  const roots = useMemo(
    () => labels.filter((label) => label.parent === null).map((label) => label.path),
    [labels],
  );

  // 選択中ラベルの祖先は最初から開いておく（選択の文脈が見えないと迷子になる）
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const path of selected) {
      for (const ancestor of labelAncestry(path)) initial.add(ancestor);
    }
    return initial;
  });

  const selectedKeys = useMemo(() => new Set(selected.map(labelKey)), [selected]);

  const toggleExpanded = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (path: string, depth: number) => {
    const label = byPath.get(path);
    if (label === undefined) return null;

    const isSelected = selectedKeys.has(labelKey(path));
    const hasChildren = label.children.length > 0;
    const isOpen = expanded.has(path);
    const isEmpty = label.count === 0;

    return (
      <li key={path}>
        <div className="flex items-center gap-0.5">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpanded(path)}
              aria-label={isOpen ? `${label.name} を閉じる` : `${label.name} を開く`}
              aria-expanded={isOpen}
              className="flex size-5 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-bg-subtle hover:text-fg"
            >
              <svg
                viewBox="0 0 12 12"
                aria-hidden="true"
                className={`size-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              >
                <path d="M4 2.5 8 6l-4 3.5z" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => onToggle(path)}
            title={label.description || label.path}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors ${
              isSelected
                ? 'bg-accent-soft font-medium text-accent'
                : `hover:bg-bg-subtle ${isEmpty ? 'text-fg-faint' : 'text-fg'}`
            }`}
          >
            <span className="truncate">{label.name}</span>
            <span
              className={`ml-auto shrink-0 font-mono text-[11px] ${
                isSelected ? 'text-accent' : 'text-fg-faint'
              }`}
            >
              {label.count}
            </span>
          </button>
        </div>

        {hasChildren && isOpen ? (
          <ul className="ml-3 border-l border-border-base pl-1.5">
            {label.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  if (labels.length === 0) {
    return <p className="px-2 text-sm text-fg-muted">ラベルがまだありません。</p>;
  }

  return <ul className="space-y-0.5">{roots.map((path) => renderNode(path, 0))}</ul>;
}
