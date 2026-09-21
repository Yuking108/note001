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

/** 各ノートへの索引。それ自体はページにしない */
export const VAULT_INDEX_NOTE = 'Q&A まとめ.md';

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
