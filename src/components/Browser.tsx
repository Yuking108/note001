'use client';

import { useEffect, useMemo, useState } from 'react';
import { LabelTree } from './LabelTree';
import { PageList } from './PageList';
import { allLabels, allPages, labelUrl } from '@/lib/content';
import { decodeLabelQuery, filterPages, labelKey } from '@/lib/labels';

type SortKey = 'updated' | 'created' | 'title';

const SORT_LABELS: Record<SortKey, string> = {
  updated: '更新日',
  created: '作成日',
  title: 'タイトル',
};

/**
 * 一覧の本体。索引はすべてクライアントに載っているので、
 * 絞り込みと並び替えはページ遷移なしで完結する。
 * URL は replaceState で「ラベル1件 + ?and=残り」に同期し、リロードとブックマークに耐えるようにする。
 */
export function Browser({ baseLabel }: { baseLabel?: string }) {
  const [selected, setSelected] = useState<string[]>(baseLabel === undefined ? [] : [baseLabel]);
  const [sort, setSort] = useState<SortKey>('updated');
  const [mounted, setMounted] = useState(false);

  // マウント時に ?and= を取り込む（静的出力なので URL の解釈はクライアント側で行う）
  useEffect(() => {
    const extra = decodeLabelQuery(new URLSearchParams(window.location.search).get('and'));
    if (extra.length > 0) {
      setSelected((current) => {
        const keys = new Set(current.map(labelKey));
        return [...current, ...extra.filter((label) => !keys.has(labelKey(label)))];
      });
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const [first, ...rest] = selected;
    window.history.replaceState(null, '', first === undefined ? '/' : labelUrl(first, rest));
  }, [selected, mounted]);

  const toggleLabel = (path: string) => {
    setSelected((current) => {
      const key = labelKey(path);
      return current.some((label) => labelKey(label) === key)
        ? current.filter((label) => labelKey(label) !== key)
        : [...current, path];
    });
  };

  const visible = useMemo(() => {
    const filtered = filterPages(allPages, selected);
    const collator = new Intl.Collator('ja');
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return collator.compare(a.title, b.title);
      const key = sort === 'created' ? 'createdAt' : 'updatedAt';
      return a[key] === b[key] ? b.id.localeCompare(a.id) : b[key].localeCompare(a[key]);
    });
  }, [selected, sort]);

  const tree = <LabelTree labels={allLabels} selected={selected} onToggle={toggleLabel} />;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[264px_minmax(0,1fr)]">
      {/* 広い画面: 左に常設。狭い画面: 折りたたみ */}
      <aside className="hidden lg:block">
        <div className="sticky top-20">
          <h2 className="mb-2 px-1.5 text-xs font-semibold tracking-wide text-fg-muted">ラベル</h2>
          <nav className="max-h-[calc(100dvh-8rem)] overflow-y-auto pb-4 pr-1">{tree}</nav>
        </div>
      </aside>

      <details className="rounded-lg border border-border-base bg-bg-elevated lg:hidden">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">ラベルで絞り込む</summary>
        <div className="max-h-[50dvh] overflow-y-auto border-t border-border-base p-2">{tree}</div>
      </details>

      <main className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <p className="font-mono text-xs text-fg-muted">
            {visible.length} / {allPages.length} 件
          </p>

          <div className="ml-auto flex items-center gap-1 rounded-md border border-border-base p-0.5">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  sort === key ? 'bg-bg-subtle font-medium text-fg' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        {selected.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-fg-muted">
              選択中{selected.length > 1 ? '（すべて含む）' : ''}:
            </span>
            {selected.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleLabel(label)}
                className="group flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[11px] text-accent"
                title={`${label} を外す`}
              >
                {label}
                <span aria-hidden="true" className="opacity-60 group-hover:opacity-100">
                  ×
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelected([])}
              className="ml-1 text-xs text-fg-faint underline decoration-dotted hover:text-fg"
            >
              すべて解除
            </button>
          </div>
        ) : null}

        <PageList pages={visible} selected={selected} onToggleLabel={toggleLabel} />
      </main>
    </div>
  );
}
