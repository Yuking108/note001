import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const CONTENT_DIR = path.join(ROOT, 'content');
export const DOCS_DIR = path.join(ROOT, 'docs');
export const PAGES_DIR = path.join(CONTENT_DIR, 'pages');
export const LABELS_FILE = path.join(CONTENT_DIR, 'labels.json');
export const GENERATED_DIR = path.join(ROOT, 'src', 'generated');
export const INDEX_FILE = path.join(GENERATED_DIR, 'index.json');
export const PUBLIC_PAGES_DIR = path.join(ROOT, 'public', 'pages');

export const META_FILENAME = 'meta.json';
export const HTML_FILENAME = 'index.html';

// --- 夜間取り込み（docs/daily-import.md） ---

/** 取り込み元の Obsidian フォルダ。launchd から環境変数で差し替えられる */
export const VAULT_DIR =
  process.env.NOTE001_VAULT_DIR ??
  path.join(
    os.homedir(),
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/yuki_1/Blender',
  );

/**
 * 取り込み元の中のフォルダ（`Q&A` / `テクニック` / `知識`）。
 * 本人がノートを書き分けている単位であり、分類の手掛かりとして扱う。
 * ここに無いフォルダが増えても取り込みは動く（`VAULT_IGNORED_DIRS` 以外は全部見る）。
 */
export const VAULT_FOLDER_HINTS: Record<string, string> = {
  'Q&A': '疑問とその答え。作業中に詰まった点の記録（Q&A_）',
  テクニック: '手順・ワークフロー・効率化のテクニック（TIPS_）',
  知識: '仕組み・概念・用語など「理解」にあたる内容（KNOW_）',
};

/** 取り込み対象外のフォルダ。画像などノート本文ではないもの */
export const VAULT_IGNORED_DIRS = new Set(['assets', '.obsidian', '.trash']);

/**
 * 各フォルダの索引ノート（`Q&A まとめ.md` など）。
 * 一覧であってページにする中身ではないので、末尾一致で除外する。
 */
export const VAULT_INDEX_SUFFIX = 'まとめ.md';

/** 見送った md の台帳。git には入れない（判断の履歴であって、コンテンツではない） */
export const IMPORT_STATE_FILE = path.join(ROOT, '.import-state.json');

/** ローカル時刻の YYYY-MM-DD（UTC 変換で日付が前後するのを避ける） */
export function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
