/**
 * アプリが読むデータはこの索引だけ。本文 HTML は React ツリーに入れず、
 * public/pages/ から iframe で読み込む（本文の JS がアプリを壊さないようにするため）。
 */

import indexJson from '@/generated/index.json';
import type { ContentIndex, IndexedLabel, IndexedPage } from './types';
import { labelKey } from './labels';

export const contentIndex = indexJson as unknown as ContentIndex;

export const allPages: IndexedPage[] = contentIndex.pages;
export const allLabels: IndexedLabel[] = contentIndex.labels;

export function findPage(id: string): IndexedPage | undefined {
  return allPages.find((page) => page.id === id);
}

export function findLabel(path: string): IndexedLabel | undefined {
  const key = labelKey(path);
  return allLabels.find((label) => labelKey(label.path) === key);
}

/**
 * 関連ページ。自分が挙げた先（links）と、自分を挙げているページ（被リンク）の両方を返す。
 * 片側にだけ書けば両方のページに出るので、関連は片方向に書けば足りる。
 */
export function relatedPages(id: string): IndexedPage[] {
  const page = findPage(id);
  if (page === undefined) return [];

  const ids = new Set(page.links);
  for (const other of allPages) {
    if (other.id !== id && other.links.includes(id)) ids.add(other.id);
  }

  return [...ids]
    .map((linked) => findPage(linked))
    .filter((linked): linked is IndexedPage => linked !== undefined);
}

/**
 * 本文の配信先。
 *
 * `index.html` まで書かない。trailingSlash: true の静的出力では、ホストが
 * `index.html` を URL から取り除いた形だけを配信するため（Vercel では
 * `/pages/<slug>/index.html` が 404 になる）。
 * `next dev` だけはディレクトリ形式を解決しないので、next.config.ts の rewrite で合わせている。
 */
export function pageHtmlUrl(id: string): string {
  return `/pages/${id}/`;
}

export function labelUrl(path: string, extra: string[] = []): string {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const query = extra.length > 0 ? `?and=${encodeURIComponent(extra.join(','))}` : '';
  return `/labels/${encoded}/${query}`;
}
