import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const CONTENT_DIR = path.join(ROOT, 'content');
export const PAGES_DIR = path.join(CONTENT_DIR, 'pages');
export const LABELS_FILE = path.join(CONTENT_DIR, 'labels.json');
export const GENERATED_DIR = path.join(ROOT, 'src', 'generated');
export const INDEX_FILE = path.join(GENERATED_DIR, 'index.json');
export const PUBLIC_PAGES_DIR = path.join(ROOT, 'public', 'pages');

export const META_FILENAME = 'meta.json';
export const HTML_FILENAME = 'index.html';

/** ローカル時刻の YYYY-MM-DD（UTC 変換で日付が前後するのを避ける） */
export function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
