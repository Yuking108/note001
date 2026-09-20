import assert from 'node:assert/strict';
import {
  buildLabelTree,
  decodeLabelQuery,
  filterPages,
  isDescendantOrSelf,
  labelAncestry,
  labelKey,
  normalizeLabelPath,
  resolveLabel,
  resolveRegistry,
} from '../src/lib/labels';
import type { IndexedPage, LabelRegistry } from '../src/lib/types';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

// --- 正規化 -------------------------------------------------------------
check('スラッシュと空白のゆらぎを畳む', () => {
  assert.equal(normalizeLabelPath('  /技術//SQLite/ ').path, '技術/SQLite');
  assert.equal(normalizeLabelPath('技術 / SQLite').path, '技術/SQLite');
});

check('NFKC で全角英数を吸収する', () => {
  assert.equal(normalizeLabelPath('技術/ＳＱＬｉｔｅ').path, '技術/SQLite');
});

check('大小文字は保存され、キーは小文字で一致する', () => {
  assert.equal(normalizeLabelPath('技術/SQLite').path, '技術/SQLite');
  assert.equal(labelKey('技術/SQLite'), labelKey('技術/sqlite'));
});

check('空ラベルと空セグメントはエラー', () => {
  assert.equal(normalizeLabelPath('   ').issues[0]?.level, 'error');
  assert.ok(
    normalizeLabelPath('技術/ /SQLite').issues.some((i) => i.level === 'error'),
    '空セグメントがエラーになっていない',
  );
});

check('カンマと制御文字はエラー、ハイフンは通す', () => {
  assert.ok(normalizeLabelPath('技術/a,b').issues.some((i) => i.level === 'error'));
  const withControlChar = `技術/a${String.fromCharCode(1)}b`;
  assert.ok(normalizeLabelPath(withControlChar).issues.some((i) => i.level === 'error'));
  assert.deepEqual(normalizeLabelPath('技術/next-js').issues, []);
});

check('空白と深すぎる階層は警告（エラーにはしない）', () => {
  const spaced = normalizeLabelPath('技術/全文 検索');
  assert.equal(spaced.path, '技術/全文 検索');
  assert.ok(spaced.issues.every((i) => i.level === 'warning'));
  assert.ok(normalizeLabelPath('a/b/c/d').issues.some((i) => i.level === 'warning'));
});

// --- 階層 ---------------------------------------------------------------
check('祖先の列挙と子孫判定', () => {
  assert.deepEqual(labelAncestry('技術/SQLite/FTS5'), ['技術', '技術/SQLite', '技術/SQLite/FTS5']);
  assert.ok(isDescendantOrSelf('技術/SQLite', '技術'));
  assert.ok(isDescendantOrSelf('技術', '技術'));
  // セグメント境界で判定する（前方一致だけだと誤爆する）
  assert.equal(isDescendantOrSelf('技術者', '技術'), false);
  assert.equal(isDescendantOrSelf('技術', '技術/SQLite'), false);
});

// --- レジストリ ---------------------------------------------------------
const registry: LabelRegistry = {
  schemaVersion: 1,
  labels: [
    { path: '技術/SQLite', description: 'SQLite 本体と拡張', aliases: ['sqlite3'] },
    { path: '技術/全文検索', description: '全文検索の設計' },
    { path: '形式/調べ物', description: '調査してまとめたもの' },
  ],
  renamed: { '技術/sqlite-fts': '技術/SQLite' },
};
const resolved = resolveRegistry(registry);

check('レジストリに矛盾がない', () => {
  assert.deepEqual(
    resolved.issues.filter((i) => i.level === 'error'),
    [],
  );
});

check('大小文字ゆらぎ・別名・改名前パスを正規パスに寄せる', () => {
  assert.deepEqual(resolveLabel('技術/sqlite', resolved), {
    ok: true,
    path: '技術/SQLite',
    renamedFrom: '技術/sqlite',
  });
  assert.deepEqual(resolveLabel('sqlite3', resolved), {
    ok: true,
    path: '技術/SQLite',
    renamedFrom: 'sqlite3',
  });
  assert.deepEqual(resolveLabel('技術/sqlite-fts', resolved), {
    ok: true,
    path: '技術/SQLite',
    renamedFrom: '技術/sqlite-fts',
  });
  assert.deepEqual(resolveLabel('技術/SQLite', resolved), { ok: true, path: '技術/SQLite' });
});

check('未登録ラベルはエラーになる', () => {
  const result = resolveLabel('技術/未登録のなにか', resolved);
  assert.equal(result.ok, false);
});

check('同じ別名を2つのラベルが主張したらエラー', () => {
  const conflicting = resolveRegistry({
    schemaVersion: 1,
    labels: [
      { path: '技術/Go', description: 'a', aliases: ['go'] },
      { path: '仕事/Go案件', description: 'b', aliases: ['go'] },
    ],
  });
  assert.ok(conflicting.issues.some((i) => i.level === 'error'));
});

check('裸の別名は明示された側に寄る（末尾が同名の別ラベルとは衝突しない）', () => {
  const registryWithBareAlias = resolveRegistry({
    schemaVersion: 1,
    labels: [
      { path: '技術/Go', description: 'a', aliases: ['go'] },
      { path: '状態/go', description: 'b' },
    ],
  });
  assert.deepEqual(
    registryWithBareAlias.issues.filter((i) => i.level === 'error'),
    [],
  );
  // 裸の 'go' は別名を明示している技術/Go に解決される
  assert.equal(resolveLabel('go', registryWithBareAlias).ok, true);
  assert.deepEqual(resolveLabel('go', registryWithBareAlias), {
    ok: true,
    path: '技術/Go',
    renamedFrom: 'go',
  });
  // フルパスで書けば従来どおり別ラベルに解決される
  assert.deepEqual(resolveLabel('状態/go', registryWithBareAlias), { ok: true, path: '状態/go' });
});

check('改名先が存在しないとエラー', () => {
  const broken = resolveRegistry({
    schemaVersion: 1,
    labels: [{ path: '技術/Go', description: 'a' }],
    renamed: { '技術/golang': '技術/存在しない' },
  });
  assert.ok(broken.issues.some((i) => i.level === 'error'));
});

// --- ツリーと絞り込み ---------------------------------------------------
const pages: IndexedPage[] = [
  {
    id: '20260920-aaaa',
    title: 'FTS5',
    summary: '',
    labels: ['技術/SQLite', '技術/全文検索', '形式/調べ物'],
    createdAt: '2026-09-20',
    updatedAt: '2026-09-20',
  },
  {
    id: '20260921-bbbb',
    title: 'SQLite 入門',
    summary: '',
    labels: ['技術/SQLite'],
    createdAt: '2026-09-21',
    updatedAt: '2026-09-21',
  },
  {
    id: '20260922-cccc',
    title: '調べ物メモ',
    summary: '',
    labels: ['形式/調べ物'],
    createdAt: '2026-09-22',
    updatedAt: '2026-09-22',
  },
];
const tree = buildLabelTree(pages, resolved);
const find = (path: string) => tree.find((l) => l.path === path);

check('暗黙の親ラベルが現れる', () => {
  assert.ok(find('技術'), '技術 が生成されていない');
  assert.equal(find('技術')?.selfCount, 0);
  assert.deepEqual(find('技術')?.children, ['技術/SQLite', '技術/全文検索']);
});

check('count は子孫を含み、1ページを二重に数えない', () => {
  // ページ1 は 技術/SQLite と 技術/全文検索 の両方を持つが、技術 の count は 1 回だけ
  assert.equal(find('技術')?.count, 2);
  assert.equal(find('技術/SQLite')?.count, 2);
  assert.equal(find('技術/SQLite')?.selfCount, 2);
  assert.equal(find('形式/調べ物')?.count, 2);
});

check('レジストリにあるが0件のラベルも索引に載る', () => {
  const withUnused = buildLabelTree([], resolved);
  assert.equal(withUnused.find((l) => l.path === '技術/SQLite')?.count, 0);
});

check('絞り込みは子孫を含む AND / OR', () => {
  assert.equal(filterPages(pages, ['技術']).length, 2);
  assert.equal(filterPages(pages, ['技術', '形式/調べ物']).length, 1);
  assert.equal(filterPages(pages, ['技術', '形式/調べ物'], { mode: 'or' }).length, 3);
  assert.equal(filterPages(pages, []).length, 3);
});

check('exact 指定なら親ラベル単体では拾わない', () => {
  assert.equal(filterPages(pages, ['技術'], { exact: true }).length, 0);
  assert.equal(filterPages(pages, ['技術/SQLite'], { exact: true }).length, 2);
});

check('クエリ文字列の復号', () => {
  assert.deepEqual(decodeLabelQuery('技術/SQLite,形式/調べ物'), ['技術/SQLite', '形式/調べ物']);
  assert.deepEqual(decodeLabelQuery(''), []);
  assert.deepEqual(decodeLabelQuery(null), []);
});

console.log(`\n${passed} 件すべて通過`);
