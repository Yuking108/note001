/**
 * content/ を検証し、アプリが読む索引と配信用の本文コピーを生成する。
 *   npm run index
 *
 * 出力（いずれも git 管理外）:
 *   src/generated/index.json   全ページのメタ + ラベルツリー
 *   public/pages/<slug>/…      本文 HTML（CSP と高さ通知を注入したコピー）と同居ファイル
 *
 * 壊れたコンテンツが静かに混ざるのを防ぐため、設計書 §10.4 の条件でビルドを失敗させる。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildLabelTree,
  labelKey,
  resolveLabel,
  resolveMainLabel,
  resolveRegistry,
  type LabelIssue,
  type ResolvedRegistry,
} from '../src/lib/labels';
import {
  LABEL_COUNT_WARN_THRESHOLD,
  SCHEMA_VERSION,
  type ContentIndex,
  type IndexedPage,
  type LabelRegistry,
  type PageMeta,
} from '../src/lib/types';
import {
  GENERATED_DIR,
  HTML_FILENAME,
  INDEX_FILE,
  LABELS_FILE,
  META_FILENAME,
  PAGES_DIR,
  PUBLIC_PAGES_DIR,
} from './paths';

const verbose = process.argv.slice(2).includes('--verbose');

const errors: string[] = [];
const warnings: string[] = [];

const fail = (message: string) => errors.push(message);
const warn = (message: string) => warnings.push(message);

function collect(issues: LabelIssue[], prefix: string): void {
  for (const issue of issues) {
    const message = `${prefix}${issue.message}`;
    if (issue.level === 'error') fail(message);
    else warn(message);
  }
}

// ---------------------------------------------------------------------------
// 本文 HTML への注入（コピー先だけを加工し、content/ の原本は汚さない）
// ---------------------------------------------------------------------------

/**
 * 「自己完結」を努力目標ではなく強制にするための CSP。
 * iframe は allow-same-origin なしで動くのでオリジンは opaque になる。
 * その状態では 'self' がどの URL にも一致しないため、
 * 画像・フォントは data: / blob: だけを許可し、外部通信は全面的に閉じる。
 */
const CSP = [
  "default-src 'none'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const HEAD_INJECTION = `
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />
    <meta name="robots" content="noindex, nofollow" />
    <style>
      /* 親が iframe の高さを本文に合わせるので、本文側のスクロールバーには出番がない。
         溝が残っていると「埋め込まれている」継ぎ目として見えてしまうため隠す。
         overflow は既定のままなので、高さ通知が届かなかった場合もホイールで読める。 */
      html {
        scrollbar-width: none;
      }
      html::-webkit-scrollbar {
        width: 0;
        height: 0;
      }
    </style>`;

/**
 * 本文の高さを親に通知する。iframe は opaque origin なので親から高さを読めない。
 * 親側（PageFrame）は origin ではなく event.source で送信元を検証する。
 */
const HEIGHT_NOTIFIER = `
    <script>
      (function () {
        var last = -1;
        function send(force) {
          var height = Math.ceil(document.documentElement.scrollHeight);
          if (!force && height === last) return;
          last = height;
          parent.postMessage({ type: 'note001:height', height: height }, '*');
        }
        // 親（React）がリスナーを張るのは iframe の読み込みより後になりうる。
        // 高さは変化したときしか送らないので、黙っていると初回の1通が捨てられて
        // 親が初期値のまま固定される。親からの測定要求には必ず答えて取りこぼしを防ぐ。
        window.addEventListener('message', function (event) {
          var data = event.data;
          if (data && data.type === 'note001:measure') send(true);
        });
        if (typeof ResizeObserver === 'function') {
          new ResizeObserver(function () {
            send(false);
          }).observe(document.documentElement);
        }
        document.addEventListener('DOMContentLoaded', function () {
          send(false);
        });
        window.addEventListener('load', function () {
          send(false);
        });
        // 遅延読み込みされる図やフォントで高さが変わる分を拾う
        [100, 400, 1200, 3000].forEach(function (delay) {
          setTimeout(function () {
            send(false);
          }, delay);
        });
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () {
            send(false);
          });
        }
        send(false);
      })();
    </script>`;

/** CSP で遮断される外部参照を洗い出す（規約違反を人が気づく前に知らせる） */
function findExternalReferences(html: string): string[] {
  const found = new Set<string>();

  const subresource = /(?:src|srcset)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi;
  const cssUrl = /url\(\s*["']?\s*((?:https?:)?\/\/[^"')\s]+)/gi;
  const stylesheet = /<link\b[^>]*\bhref\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi;
  const cssImport = /@import\s+(?:url\()?\s*["']?\s*((?:https?:)?\/\/[^"')\s;]+)/gi;

  for (const pattern of [subresource, cssUrl, stylesheet, cssImport]) {
    for (const match of html.matchAll(pattern)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found];
}

/**
 * 完結した文書であることを要求する（設計書 §7.1）。
 * 注入の足場が無い HTML は索引を書く前に弾く。
 */
function validateHtmlStructure(html: string, slug: string): boolean {
  const where = `${slug}/${HTML_FILENAME}`;
  let ok = true;

  if (html.search(/<head\b[^>]*>/i) === -1) {
    fail(`${where}: <head> がありません（<!doctype html> から始まる完結した文書にしてください）`);
    ok = false;
  }
  if (!html.toLowerCase().includes('</body>')) {
    fail(`${where}: </body> がありません（<!doctype html> から始まる完結した文書にしてください）`);
    ok = false;
  }
  if (html.search(/<title\b[^>]*>/i) === -1) {
    warn(`${where}: <title> がありません（HTML 単体で開いたときに識別できません）`);
  }

  for (const reference of findExternalReferences(html)) {
    warn(`${where}: 外部参照 "${reference}" は CSP で遮断されます`);
  }

  return ok;
}

function transformHtml(html: string): string {
  const headOpen = html.search(/<head\b[^>]*>/i);
  const headTagEnd = html.indexOf('>', headOpen) + 1;
  let output = html.slice(0, headTagEnd) + HEAD_INJECTION + html.slice(headTagEnd);

  const closingBody = output.toLowerCase().lastIndexOf('</body>');
  output = output.slice(0, closingBody) + HEIGHT_NOTIFIER + '\n  ' + output.slice(closingBody);

  return output;
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readJson<T>(file: string, label: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (error) {
    fail(`${label}: 読み込みに失敗しました（${(error as Error).message}）`);
    return null;
  }
}

function validateMeta(raw: unknown, slug: string, registry: ResolvedRegistry): IndexedPage | null {
  if (typeof raw !== 'object' || raw === null) {
    fail(`${slug}/${META_FILENAME}: オブジェクトではありません`);
    return null;
  }
  const meta = raw as Partial<PageMeta>;
  const where = `${slug}/${META_FILENAME}`;
  let broken = false;

  const requireString = (field: keyof PageMeta, value: unknown): string => {
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${where}: ${field} が必要です`);
      broken = true;
      return '';
    }
    return value;
  };

  const title = requireString('title', meta.title);
  const id = requireString('id', meta.id);
  const createdAt = requireString('createdAt', meta.createdAt);
  const updatedAt = requireString('updatedAt', meta.updatedAt);

  if (meta.schemaVersion !== SCHEMA_VERSION) {
    fail(`${where}: schemaVersion が ${SCHEMA_VERSION} ではありません（${meta.schemaVersion}）`);
    broken = true;
  }
  if (id !== '' && id !== slug) {
    fail(`${where}: id "${id}" がディレクトリ名 "${slug}" と一致しません`);
    broken = true;
  }
  for (const [field, value] of [
    ['createdAt', createdAt],
    ['updatedAt', updatedAt],
  ] as const) {
    if (value !== '' && !DATE_PATTERN.test(value)) {
      fail(`${where}: ${field} は YYYY-MM-DD 形式にしてください（${value}）`);
      broken = true;
    }
  }
  if (meta.visibility !== 'private') {
    fail(`${where}: visibility は "private" のみです（${String(meta.visibility)}）`);
    broken = true;
  }
  if ('labels' in meta) {
    fail(
      `${where}: labels は廃止されました（schemaVersion 2 では mainLabel と subLabels に分けます）`,
    );
    broken = true;
  }
  if (meta.subLabels !== undefined && !Array.isArray(meta.subLabels)) {
    fail(`${where}: subLabels は配列が必要です`);
    broken = true;
  }
  if (meta.links !== undefined && !Array.isArray(meta.links)) {
    fail(`${where}: links は配列にしてください`);
    broken = true;
  }

  // 警告（ビルドは通す。書きかけを許容する）
  const summary = typeof meta.summary === 'string' ? meta.summary : '';
  if (summary.trim() === '') {
    warn(`${where}: summary が空です（一覧で中身を判断できません）`);
  }
  if (DATE_PATTERN.test(createdAt) && DATE_PATTERN.test(updatedAt) && updatedAt < createdAt) {
    warn(`${where}: updatedAt が createdAt より前です`);
  }

  // --- メインラベル: ちょうど1つ。無ければエラー（label-spec.md §7.2 の 1〜4） ---
  let mainLabel = '';
  if (Array.isArray(meta.mainLabel)) {
    fail(`${where}: mainLabel は配列ではなく文字列です（メインラベルはちょうど1つ）`);
    broken = true;
  } else if (typeof meta.mainLabel !== 'string' || meta.mainLabel.trim() === '') {
    fail(`${where}: mainLabel が必要です（\`<アプリ>/<セクション>\` の2段で1つだけ）`);
    broken = true;
  } else {
    const resolution = resolveMainLabel(meta.mainLabel, registry);
    if (!resolution.ok) {
      collect(resolution.issues, `${where}: `);
      broken = true;
    } else {
      if (resolution.renamedFrom !== undefined) {
        warn(
          `${where}: mainLabel "${resolution.renamedFrom}" を "${resolution.path}" に読み替えました（meta.json を更新してください）`,
        );
      }
      mainLabel = resolution.path;
    }
  }

  // --- サブラベル: 0件以上。メインとの重複・自身の重複はエラー（同 5〜7） ---
  const rawSubLabels = Array.isArray(meta.subLabels) ? meta.subLabels : [];
  const subLabels: string[] = [];

  for (const rawLabel of rawSubLabels) {
    if (typeof rawLabel !== 'string') {
      fail(`${where}: subLabels に文字列でない要素があります`);
      broken = true;
      continue;
    }
    const resolution = resolveLabel(rawLabel, registry);
    if (!resolution.ok) {
      collect(resolution.issues, `${where}: `);
      broken = true;
      continue;
    }
    if (resolution.renamedFrom !== undefined) {
      warn(
        `${where}: サブラベル "${resolution.renamedFrom}" を "${resolution.path}" に読み替えました（meta.json を更新してください）`,
      );
    }
    if (mainLabel !== '' && labelKey(resolution.path) === labelKey(mainLabel)) {
      fail(`${where}: サブラベル "${resolution.path}" がメインラベルと同じです`);
      broken = true;
      continue;
    }
    if (subLabels.some((owned) => labelKey(owned) === labelKey(resolution.path))) {
      fail(`${where}: サブラベル "${resolution.path}" が重複しています`);
      broken = true;
      continue;
    }
    subLabels.push(resolution.path);
  }

  // 警告（同 8〜9）
  if (subLabels.length === 0) {
    warn(`${where}: subLabels が空です（メインラベル以外の切り口から引けません）`);
  }
  if (1 + subLabels.length >= LABEL_COUNT_WARN_THRESHOLD) {
    warn(
      `${where}: ラベルが ${1 + subLabels.length} 件あります（${LABEL_COUNT_WARN_THRESHOLD} 件以上は付けすぎの兆候）`,
    );
  }

  // --- 関連ページ。存在確認は全ページを読み終えてから行う（下の main 内） ---
  const links: string[] = [];
  for (const rawLink of Array.isArray(meta.links) ? meta.links : []) {
    if (typeof rawLink !== 'string') {
      fail(`${where}: links に文字列でない要素があります`);
      broken = true;
      continue;
    }
    if (rawLink === slug) {
      warn(`${where}: links が自分自身を指しています`);
      continue;
    }
    if (!links.includes(rawLink)) links.push(rawLink);
  }

  if (broken) return null;

  return {
    id: slug,
    title,
    summary,
    mainLabel,
    subLabels,
    allLabels: [mainLabel, ...subLabels],
    links,
    createdAt,
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// public/pages への同期
// ---------------------------------------------------------------------------

function syncPage(slug: string): void {
  const sourceDir = path.join(PAGES_DIR, slug);
  const targetDir = path.join(PUBLIC_PAGES_DIR, slug);
  fs.mkdirSync(targetDir, { recursive: true });

  const copyTree = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      // メタデータは索引に入るので配信しない
      if (entry.name === META_FILENAME && from === sourceDir) continue;
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copyTree(source, target);
        continue;
      }
      if (entry.name === HTML_FILENAME && from === sourceDir) {
        const html = fs.readFileSync(source, 'utf8');
        fs.writeFileSync(target, transformHtml(html), 'utf8');
        continue;
      }
      fs.copyFileSync(source, target);
    }
  };

  copyTree(sourceDir, targetDir);
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function main(): void {
  const registryRaw = readJson<LabelRegistry>(LABELS_FILE, 'content/labels.json');
  if (registryRaw === null) {
    report();
    return;
  }
  if (registryRaw.schemaVersion !== SCHEMA_VERSION) {
    fail(`content/labels.json: schemaVersion が ${SCHEMA_VERSION} ではありません`);
  }
  if (!Array.isArray(registryRaw.labels)) {
    fail('content/labels.json: labels は配列が必要です');
    report();
    return;
  }

  const registry = resolveRegistry(registryRaw);
  collect(registry.issues, 'content/labels.json: ');

  if (!fs.existsSync(PAGES_DIR)) {
    fs.mkdirSync(PAGES_DIR, { recursive: true });
  }

  const slugs = fs
    .readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  const pages: IndexedPage[] = [];

  for (const slug of slugs) {
    const dir = path.join(PAGES_DIR, slug);
    const metaFile = path.join(dir, META_FILENAME);
    const htmlFile = path.join(dir, HTML_FILENAME);

    if (!fs.existsSync(metaFile)) {
      fail(`${slug}: ${META_FILENAME} がありません`);
      continue;
    }
    if (!fs.existsSync(htmlFile)) {
      fail(`${slug}: ${HTML_FILENAME} がありません`);
      continue;
    }

    const htmlOk = validateHtmlStructure(fs.readFileSync(htmlFile, 'utf8'), slug);

    const raw = readJson<unknown>(metaFile, `${slug}/${META_FILENAME}`);
    if (raw === null) continue;

    const page = validateMeta(raw, slug, registry);
    if (page !== null && htmlOk) pages.push(page);
  }

  // 関連ページの参照先が実在するかを確かめる。
  // 壊れたリンクは一覧に出ないので、気づかないまま放置されやすい
  const knownIds = new Set(pages.map((page) => page.id));
  for (const page of pages) {
    for (const link of page.links) {
      if (!knownIds.has(link)) {
        fail(`${page.id}/${META_FILENAME}: links の "${link}" に対応するページがありません`);
      }
    }
  }

  // 更新日の新しい順。同日なら slug の降順で安定させる
  pages.sort((a, b) => (a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : b.updatedAt.localeCompare(a.updatedAt)));

  const labels = buildLabelTree(pages, registry);

  // メインラベルの固定リスト（アプリ自身とその第二階層）は、先に全部登録するのが本仕様の前提。
  // 0件でも「放置」ではないので警告には数えず、使用状況だけ最後に一行で出す（label-spec.md §7.2 の警告10）。
  const sectionPaths = new Set<string>(registry.apps);
  for (const sections of registry.sectionsOf.values()) {
    for (const section of sections) sectionPaths.add(section);
  }

  // 未使用ラベルは件数だけ出す。毎回全件並べると他の警告が埋もれる
  const unused = labels
    .filter(
      (label) =>
        label.count === 0 && registry.descriptions.has(label.path) && !sectionPaths.has(label.path),
    )
    .map((label) => label.path);

  if (unused.length > 0) {
    if (verbose) {
      for (const label of unused) warn(`content/labels.json: ラベル "${label}" は 0 件です（未使用）`);
    } else {
      warn(
        `content/labels.json: 未使用ラベルが ${unused.length} 件あります（一覧は npm run index -- --verbose）`,
      );
    }
  }

  if (errors.length > 0) {
    report();
    return;
  }

  const index: ContentIndex = {
    generatedAt: new Date().toISOString(),
    pages,
    labels,
  };

  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  // 配信用コピーは毎回作り直す（消したページが残り続けるのを防ぐ）
  fs.rmSync(PUBLIC_PAGES_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_PAGES_DIR, { recursive: true });
  for (const page of pages) syncPage(page.id);

  report();

  if (errors.length === 0) {
    console.log(
      `索引を生成しました: ${pages.length} ページ / ${labels.filter((l) => l.count > 0).length} ラベル（使用中）`,
    );

    const usedSections = labels.filter((l) => sectionPaths.has(l.path) && l.mainCount > 0).length;
    const totalSections = [...registry.sectionsOf.values()].reduce((sum, s) => sum + s.length, 0);
    console.log(
      `メインラベル: ${totalSections} セクション中 ${usedSections} 件を使用中（${registry.apps.join(' / ')}）`,
    );
  }
}

function report(): void {
  for (const message of warnings) console.warn(`警告  ${message}`);
  for (const message of errors) console.error(`エラー ${message}`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} 件のエラーでビルドを中止しました。`);
    process.exit(1);
  }
}

main();
