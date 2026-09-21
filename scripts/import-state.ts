/**
 * 夜間取り込みの見送り台帳。
 *
 * ページ化を見送った md をここに記録し、pending.ts が翌晩以降の候補から外す。
 * 外しっぱなしにはしない：記録時の mtime を持っておき、**本人が md を書き直したら候補に戻す**。
 * こうしておかないと「毎晩同じ md で判断に失敗し、毎晩同じコストを払う」ループになる。
 *
 * 使い方:
 *   tsx scripts/import-state.ts skip  "Q&A_xxx.md" "メインラベルを決められなかった"
 *   tsx scripts/import-state.ts clear "Q&A_xxx.md"
 *   tsx scripts/import-state.ts list
 */

import fs from 'node:fs';
import path from 'node:path';
import { IMPORT_STATE_FILE, VAULT_DIR } from './paths';

export type SkipRecord = {
  /** 見送った時点の md の更新時刻。これが変わっていれば候補に戻す */
  mtimeMs: number;
  /** 見送った日時（ISO） */
  at: string;
  reason: string;
};

export type ImportState = {
  skipped: Record<string, SkipRecord>;
};

const EMPTY: ImportState = { skipped: {} };

export function loadState(): ImportState {
  if (!fs.existsSync(IMPORT_STATE_FILE)) return structuredClone(EMPTY);
  try {
    const raw = JSON.parse(fs.readFileSync(IMPORT_STATE_FILE, 'utf8')) as Partial<ImportState>;
    return { skipped: raw.skipped ?? {} };
  } catch {
    // 壊れた台帳は「記録なし」と同じ扱いにする。
    // ここで落ちると取り込み全体が止まるが、台帳は失っても作り直せる。
    console.warn(`警告  ${IMPORT_STATE_FILE} を読めませんでした。空の台帳として扱います`);
    return structuredClone(EMPTY);
  }
}

export function saveState(state: ImportState): void {
  fs.writeFileSync(IMPORT_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function mtimeOf(file: string): number {
  const full = path.join(VAULT_DIR, file);
  return fs.existsSync(full) ? fs.statSync(full).mtimeMs : 0;
}

function main(): void {
  const [command, file, ...rest] = process.argv.slice(2);
  const state = loadState();

  if (command === 'skip') {
    if (file === undefined || file === '') {
      console.error('使い方: tsx scripts/import-state.ts skip "<md のファイル名>" "<理由>"');
      process.exit(1);
    }
    state.skipped[file] = {
      mtimeMs: mtimeOf(file),
      at: new Date().toISOString(),
      reason: rest.join(' ') || '（理由の記録なし）',
    };
    saveState(state);
    console.log(`見送りを記録しました: ${file}`);
    return;
  }

  if (command === 'clear') {
    if (file !== undefined && file !== '') {
      delete state.skipped[file];
    } else {
      state.skipped = {};
    }
    saveState(state);
    console.log(file ? `見送りを解除しました: ${file}` : 'すべての見送りを解除しました');
    return;
  }

  if (command === 'list' || command === undefined) {
    const entries = Object.entries(state.skipped);
    if (entries.length === 0) {
      console.log('見送り中の md はありません');
      return;
    }
    for (const [name, record] of entries) {
      const changed = mtimeOf(name) !== record.mtimeMs ? '（更新あり → 次回再挑戦）' : '';
      console.log(`${name}${changed}\n  ${record.at}  ${record.reason}`);
    }
    return;
  }

  console.error(`不明なコマンド: ${command}（skip / clear / list）`);
  process.exit(1);
}

// モジュールとして import されたときは CLI を動かさない
if (process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith('import-state.ts')) {
  main();
}
