'use client';

import Link from 'next/link';
import type { IndexedPage } from '@/lib/types';
import { labelKey } from '@/lib/labels';

type Props = {
  pages: IndexedPage[];
  selected: string[];
  onToggleLabel: (path: string) => void;
};

export function PageList({ pages, selected, onToggleLabel }: Props) {
  const selectedKeys = new Set(selected.map(labelKey));

  if (pages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
        <p className="text-sm text-fg-muted">
          {selected.length > 0
            ? 'この条件に当てはまるページはありません。'
            : 'ページがまだありません。'}
        </p>
        <p className="mt-2 font-mono text-xs text-fg-faint">
          npm run new -- --title &quot;タイトル&quot;
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {pages.map((page) => (
        <li
          key={page.id}
          className="group rounded-lg border border-border-base bg-bg-elevated transition-colors hover:border-border-strong"
        >
          <div className="p-4">
            <Link href={`/p/${page.id}/`} className="block">
              <h2 className="text-[15px] font-semibold leading-snug text-fg group-hover:text-accent">
                {page.title}
              </h2>
              {page.summary !== '' ? (
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-fg-muted">
                  {page.summary}
                </p>
              ) : (
                <p className="mt-1.5 text-sm italic text-fg-faint">summary が未記入</p>
              )}
            </Link>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {page.labels.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onToggleLabel(label)}
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors ${
                    selectedKeys.has(labelKey(label))
                      ? 'bg-accent-soft text-accent'
                      : 'bg-bg-subtle text-fg-muted hover:text-fg'
                  }`}
                >
                  {label}
                </button>
              ))}
              <time className="ml-auto font-mono text-[11px] text-fg-faint" dateTime={page.updatedAt}>
                {page.updatedAt}
              </time>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
