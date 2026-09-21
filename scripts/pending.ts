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
import {
  META_FILENAME,
  PAGES_DIR,
  VAULT_DIR,
  VAULT_IGNORED_DIRS,
  VAULT_INDEX_SUFFIX,
} from './paths';
import { loadState } from './import-state';
import type { PageMeta } from '../src/lib/types';

export type PendingNote = {
  /** 取り込み元からの相対パス（`Q&A/Q&A_xxx.md`）。フォルダ名ごと持つ */
  file: string;
  /** Obsidian 側の絶対パス */
  path: string;
  mtimeMs: number;
  size: number;
};

/**
 * ファイル名の比較は NFC に寄せてから行う。
 * macOS のファイルシステムと JSON に書かれた文字列で、濁点の表現（NFC / NFD）が
 * 食い違うことがあり、そのままでは「取り込み済みなのに未取り込み」と誤判定する
 */
function key(file: string): string {
  return file.normalize('NFC');
}

/** すでにページ化された md の相対パス */
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
      if (typeof file === 'string' && file !== '') files.add(key(file));
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

  // フォルダ（Q&A / テクニック / 知識）の中まで見る。
  // 新しいフォルダが増えても、こちらを直さずに拾えるようにする
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (VAULT_IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.md')) continue;
      if (entry.name.endsWith(VAULT_INDEX_SUFFIX)) continue;

      const relative = path.relative(VAULT_DIR, full);
      if (imported.has(key(relative))) continue;

      const stat = fs.statSync(full);

      // 見送り済みで、その後 md に手が入っていないものは候補から外す
      const skipped = state.skipped[relative] ?? state.skipped[key(relative)];
      if (!ignoreSkipped && skipped !== undefined && skipped.mtimeMs === stat.mtimeMs) continue;

      notes.push({ file: relative, path: full, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  };

  walk(VAULT_DIR);

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
