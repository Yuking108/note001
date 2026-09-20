/**
 * ページの器を作る。使い方:
 *   npm run new -- --title "SQLite FTS5 の基本と日本語対応"
 *
 * slug は日付 + 短い ID（例 20260920-a3f2）。
 * タイトルを後から変えても URL が壊れないように、slug にタイトルを含めない。
 */

import fs from 'node:fs';
import path from 'node:path';
import { HTML_FILENAME, META_FILENAME, PAGES_DIR, today } from './paths';
import { SCHEMA_VERSION, type PageMeta } from '../src/lib/types';

function parseArgs(argv: string[]): { title: string; labels: string[] } {
  let title = '';
  const labels: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--title' || arg === '-t') {
      title = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--label' || arg === '-l') {
      const value = argv[i + 1];
      if (value !== undefined) labels.push(value);
      i += 1;
    } else if (arg !== undefined && !arg.startsWith('-') && title === '') {
      title = arg;
    }
  }

  return { title: title.trim(), labels };
}

function generateSlug(): string {
  const stamp = today().replaceAll('-', '');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    const slug = `${stamp}-${suffix}`;
    if (!fs.existsSync(path.join(PAGES_DIR, slug))) return slug;
  }
  throw new Error('slug の採番に失敗しました（同日に大量のページを作りすぎた可能性）');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * 本文 HTML の雛形。設計書 §7 の規約を満たした状態から書き始められるようにする。
 * - 自己完結（外部ホストへの参照なし）
 * - 明色/暗色の両対応（トークンは :root と prefers-color-scheme で定義）
 * - 横スクロールは表・コードの内側だけに閉じる
 */
function htmlTemplate(title: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      /* 明色パレット（既定） */
      :root {
        --bg: #fbfaf9;
        --fg: #1c1a18;
        --fg-muted: #6b645d;
        --border: #e3dfdb;
        --accent: #b4551f;
        --code-bg: #f3f1ef;
      }
      /* 暗色パレット：色の定義をここだけに置かない（既定は必ず :root に持つ） */
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #17161a;
          --fg: #eceaf0;
          --fg-muted: #a39fab;
          --border: #322f38;
          --accent: #e8925c;
          --code-bg: #26252b;
        }
      }

      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        /* 透明にすると iframe 越しに親の色が透けるため、必ず不透明で塗る */
        background-color: var(--bg);
        color: var(--fg);
        font-family:
          ui-sans-serif, system-ui, -apple-system, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP',
          Meiryo, sans-serif;
        line-height: 1.85;
        font-size: 16px;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 40px 24px 96px;
      }
      h1,
      h2,
      h3 {
        line-height: 1.4;
        letter-spacing: -0.01em;
      }
      h1 {
        font-size: 1.75rem;
        margin: 0 0 1.5rem;
      }
      h2 {
        font-size: 1.25rem;
        margin: 2.5rem 0 0.75rem;
        padding-bottom: 0.4rem;
        border-bottom: 1px solid var(--border);
      }
      p {
        margin: 0 0 1.1rem;
      }
      a {
        color: var(--accent);
      }
      code {
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 0.9em;
        background: var(--code-bg);
        padding: 0.15em 0.4em;
        border-radius: 4px;
      }
      /* 広い要素はそれぞれの内側でスクロールさせ、文書本体は横に伸ばさない */
      pre,
      .scroll-x {
        overflow-x: auto;
        max-width: 100%;
      }
      pre {
        background: var(--code-bg);
        padding: 1rem;
        border-radius: 8px;
        line-height: 1.6;
      }
      pre code {
        background: none;
        padding: 0;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.95rem;
      }
      th,
      td {
        border: 1px solid var(--border);
        padding: 0.5rem 0.7rem;
        text-align: left;
      }
      th {
        background: var(--code-bg);
      }
      figure {
        margin: 1.5rem 0;
      }
      figcaption {
        color: var(--fg-muted);
        font-size: 0.85rem;
        margin-top: 0.5rem;
      }
      img,
      svg {
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>ここから本文を書く。図解が要るなら SVG を直接埋める。</p>
    </main>
  </body>
</html>
`;
}

function main(): void {
  const { title, labels } = parseArgs(process.argv.slice(2));

  if (title === '') {
    console.error('使い方: npm run new -- --title "ページのタイトル" [--label 技術/SQLite ...]');
    process.exit(1);
  }

  const slug = generateSlug();
  const dir = path.join(PAGES_DIR, slug);
  const date = today();

  const meta: PageMeta = {
    schemaVersion: SCHEMA_VERSION,
    id: slug,
    title,
    summary: '',
    labels,
    createdAt: date,
    updatedAt: date,
    visibility: 'private',
    links: [],
    source: { kind: 'claude-code' },
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, META_FILENAME), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, HTML_FILENAME), htmlTemplate(title), 'utf8');

  const relative = path.relative(process.cwd(), dir);
  console.log(`作成しました: ${relative}/`);
  console.log(`  ${HTML_FILENAME}  本文をここに書く`);
  console.log(`  ${META_FILENAME}  summary と labels を埋める`);
  if (labels.length === 0) {
    console.log('\n次: content/labels.json を見てラベル候補を 3〜7 件に絞り、本人の確認を取る。');
  }
}

main();
