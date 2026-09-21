/**
 * まだページになっていない Obsidian ノートを一覧する。
 *
 * 判定は meta.json の `source.file` だけを見る（人が読む `source.note` は当てにしない）。
 * 夜間取り込み（docs/daily-import.md）の入口であり、手で叩いて「取りこぼしが無いか」を
 * 確かめるための道具でもある。
 *
 * 使い方:
 *   npm run pending            未取り込みの md を人が読む形で出す
 *   npm run pending -- --json  同じものを JSON で出す（取り込みスクリプトが読む）
 *   npm run pending -- --all   見送り台帳を無視して、未ページ化の md を全部出す
 */

import fs from 'node:fs';
import path from 'node:path';
import { META_FILENAME, PAGES_DIR, VAULT_DIR, VAULT_INDEX_NOTE } from './paths';
import { loadState } from './import-state';
import type { PageMeta } from '../src/lib/types';

export type PendingNote = {
  /** md のファイル名（拡張子込み） */
  file: string;
  /** Obsidian 側の絶対パス */
  path: string;
  mtimeMs: number;
  size: number;
};

/** すでにページ化された md のファイル名 */
function importedFiles(): Set<string> {
  const files = new Set<string>();
  if (!fs.existsSync(PAGES_DIR)) return files;

  for (const entry of fs.readdirSync(PAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const metaFile = path.join(PAGES_DIR, entry.name, META_FILENAME);
    if (!fs.existsSync(metaFile)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as PageMeta;
      const file = meta.source?.file;
      if (typeof file === 'string' && file !== '') files.add(file);
    } catch {
      // 壊れた meta.json は index.ts 側がエラーにする。ここでは無視して先へ進む
    }
  }
  return files;
}

export function findPending(ignoreSkipped = false): PendingNote[] {
  if (!fs.existsSync(VAULT_DIR)) {
    throw new Error(
      `取り込み元が見つかりません: ${VAULT_DIR}\n` +
        'iCloud の同期が未完了か、NOTE001_VAULT_DIR の指定が違います',
    );
  }

  const imported = importedFiles();
  const state = loadState();
  const notes: PendingNote[] = [];

  for (const entry of fs.readdirSync(VAULT_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (!entry.name.endsWith('.md')) continue;
    if (entry.name === VAULT_INDEX_NOTE) continue;
    if (imported.has(entry.name)) continue;

    const full = path.join(VAULT_DIR, entry.name);
    const stat = fs.statSync(full);

    // 見送り済みで、その後 md に手が入っていないものは候補から外す
    const skipped = state.skipped[entry.name];
    if (!ignoreSkipped && skipped !== undefined && skipped.mtimeMs === stat.mtimeMs) continue;

    notes.push({ file: entry.name, path: full, mtimeMs: stat.mtimeMs, size: stat.size });
  }

  // 古いものから。作られた順に取り込むほうが、一覧の並びが自然になる
  notes.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return notes;
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const ignoreSkipped = argv.includes('--all');

  // 取り込み元のパスを 1 箇所（paths.ts）に閉じ込めるための出口。
  // シェル側がこれを呼ぶので、同じパスを二重に書かずに済む
  if (argv.includes('--vault')) {
    console.log(VAULT_DIR);
    return;
  }

  let notes: PendingNote[];
  try {
    notes = findPending(ignoreSkipped);
  } catch (error) {
    if (asJson) {
      // 取り込みスクリプトが「0件」と「読めなかった」を取り違えないよう、必ず異常終了させる
      console.error((error as Error).message);
    } else {
      console.error(`エラー ${(error as Error).message}`);
    }
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify(notes));
    return;
  }

  if (notes.length === 0) {
    console.log('未取り込みの md はありません');
    return;
  }

  console.log(`未取り込み: ${notes.length} 件`);
  for (const note of notes) {
    const date = new Date(note.mtimeMs).toISOString().slice(0, 10);
    console.log(`  ${date}  ${note.file}`);
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith('pending.ts')) {
  main();
}
