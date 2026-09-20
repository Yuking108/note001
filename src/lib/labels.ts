/**
 * ラベルの正規化・検証・ツリー構築・絞り込み。設計書 §6 に対応。
 *
 * フォルダを作らない設計では分類の負荷がすべてラベルに乗るため、
 * 「似ているが違うラベル」の増殖を機械的に止めることがこのモジュールの役目。
 */

import {
  MAIN_LABEL_SEGMENTS,
  type IndexedLabel,
  type IndexedPage,
  type LabelKind,
  type LabelRegistry,
} from './types';

export const LABEL_SEPARATOR = '/';
export const RECOMMENDED_MAX_DEPTH = 3;

export type IssueLevel = 'error' | 'warning';
export type LabelIssue = { level: IssueLevel; message: string };

/** セグメント内で禁止する文字: カンマ（クエリ区切り）と制御文字 */
function hasForbiddenChar(segment: string): boolean {
  for (const char of segment) {
    if (char === ',') return true;
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export type NormalizeOptions = {
  /**
   * レジストリに登録済みの正規表記として扱う。
   * `After Effects` のように公式表記が空白を含むラベルがあるため、
   * 登録済みのものには「空白は非推奨」の警告を出さない（label-spec.md §7.3）。
   */
  registered?: boolean;
};

/**
 * ラベルパスを正規化する。**大小文字は保存する**（表示のため）。
 * 比較・重複判定には labelKey() を使う。
 */
export function normalizeLabelPath(
  raw: string,
  options: NormalizeOptions = {},
): { path: string; issues: LabelIssue[] } {
  const issues: LabelIssue[] = [];

  // 1. NFKC 正規化（全角英数・半角カナのゆらぎを吸収）
  let value = raw.normalize('NFKC');

  // 2-3. 前後の空白、先頭末尾のスラッシュ、連続スラッシュを畳む
  value = value.trim().replace(/\/+/g, LABEL_SEPARATOR).replace(/^\/|\/$/g, '');

  if (value === '') {
    issues.push({ level: 'error', message: `ラベルが空です: ${JSON.stringify(raw)}` });
    return { path: '', issues };
  }

  const segments = value.split(LABEL_SEPARATOR).map((segment) => segment.trim());

  // 4. 空セグメントを禁止
  if (segments.some((segment) => segment === '')) {
    issues.push({ level: 'error', message: `空のセグメントを含みます: ${JSON.stringify(raw)}` });
  }

  for (const segment of segments) {
    // 5. 禁止文字
    if (hasForbiddenChar(segment)) {
      issues.push({
        level: 'error',
        message: `使用できない文字（カンマ・制御文字）を含みます: ${JSON.stringify(raw)}`,
      });
    }
    // 6. 空白は許可するが非推奨（登録済みの正規表記は対象外）
    if (!options.registered && /\s/.test(segment)) {
      issues.push({
        level: 'warning',
        message: `セグメントに空白が含まれています（非推奨）: ${JSON.stringify(raw)}`,
      });
    }
  }

  // 深さの目安を超えたら軸の切り方を疑うサイン
  if (segments.length > RECOMMENDED_MAX_DEPTH) {
    issues.push({
      level: 'warning',
      message: `深さが ${segments.length} 段です（推奨は ${RECOMMENDED_MAX_DEPTH} 段以下）: ${value}`,
    });
  }

  return { path: segments.join(LABEL_SEPARATOR), issues };
}

/**
 * 比較用のキー。大小文字を無視するため、`技術/SQLite` と `技術/sqlite` は同一と判定される。
 * 表示にはレジストリの正規パス（元の大小文字）を使う。
 */
export function labelKey(path: string): string {
  return normalizeLabelPath(path).path.toLocaleLowerCase('en');
}

export function labelSegments(path: string): string[] {
  return path === '' ? [] : path.split(LABEL_SEPARATOR);
}

export function labelName(path: string): string {
  const segments = labelSegments(path);
  return segments[segments.length - 1] ?? path;
}

export function labelDepth(path: string): number {
  return labelSegments(path).length;
}

export function labelParent(path: string): string | null {
  const segments = labelSegments(path);
  return segments.length <= 1 ? null : segments.slice(0, -1).join(LABEL_SEPARATOR);
}

/** 自分自身を含む祖先パスの配列。'技術/SQLite' -> ['技術', '技術/SQLite'] */
export function labelAncestry(path: string): string[] {
  const segments = labelSegments(path);
  return segments.map((_, i) => segments.slice(0, i + 1).join(LABEL_SEPARATOR));
}

/** path が ancestor 自身か、その子孫か。セグメント境界で判定する */
export function isDescendantOrSelf(path: string, ancestor: string): boolean {
  const a = labelKey(path);
  const b = labelKey(ancestor);
  return a === b || a.startsWith(`${b}${LABEL_SEPARATOR}`);
}

// ---------------------------------------------------------------------------
// レジストリ
// ---------------------------------------------------------------------------

export type ResolvedRegistry = {
  /** キー -> 正規パス。正規パス自身・別名・改名前パスをすべて含む */
  resolve: Map<string, string>;
  /** 正規パス -> description */
  descriptions: Map<string, string>;
  /** 正規パス -> kind（第一階層のみ） */
  kinds: Map<string, LabelKind>;
  /** 正規パスの一覧（登録順） */
  paths: string[];
  /** kind が app の第一階層（メインラベルに使えるアプリ）。登録順 */
  apps: string[];
  /** アプリ -> そのアプリ配下の2段ラベル（メインラベルの固定リスト）。登録順 */
  sectionsOf: Map<string, string[]>;
  issues: LabelIssue[];
};

/**
 * レジストリを引き当て表に変換する。
 * 正規パス・別名・改名前パスが衝突していればエラーとして報告する
 * （静かに片方が勝つと、後から原因不明の分類ずれになる）。
 */
export function resolveRegistry(registry: LabelRegistry): ResolvedRegistry {
  const resolve = new Map<string, string>();
  const descriptions = new Map<string, string>();
  const kinds = new Map<string, LabelKind>();
  const paths: string[] = [];
  const issues: LabelIssue[] = [];

  const claim = (key: string, canonical: string, kind: string) => {
    const existing = resolve.get(key);
    if (existing !== undefined && existing !== canonical) {
      issues.push({
        level: 'error',
        message: `${kind} "${key}" が "${existing}" と "${canonical}" の両方に一致します`,
      });
      return;
    }
    resolve.set(key, canonical);
  };

  for (const definition of registry.labels) {
    // 登録済みの正規表記として正規化する（`After Effects` の空白を警告にしない）
    const { path, issues: pathIssues } = normalizeLabelPath(definition.path, { registered: true });
    issues.push(...pathIssues);
    if (path === '') continue;

    if (descriptions.has(path)) {
      issues.push({ level: 'error', message: `ラベルが重複登録されています: ${path}` });
      continue;
    }

    if (definition.kind !== undefined) {
      if (labelDepth(path) !== 1) {
        issues.push({
          level: 'error',
          message: `kind は第一階層にだけ指定できます: ${path}`,
        });
      } else {
        kinds.set(path, definition.kind);
      }
    }

    paths.push(path);
    descriptions.set(path, definition.description ?? '');
    claim(labelKey(path), path, 'ラベル');

    if (!definition.description || definition.description.trim() === '') {
      issues.push({
        level: 'warning',
        message: `description が空です（AI のラベル選択精度が落ちます）: ${path}`,
      });
    }

    // 別名はフルパス（技術/sqlite）でも裸の名前（sqlite）でも引ける。
    // 裸の名前が複数の軸で衝突したら claim() がエラーとして報告する。
    for (const alias of definition.aliases ?? []) {
      const aliasPath = normalizeLabelPath(alias).path;
      if (aliasPath === '') continue;
      claim(labelKey(aliasPath), path, '別名');
    }
  }

  for (const [from, to] of Object.entries(registry.renamed ?? {})) {
    const fromPath = normalizeLabelPath(from).path;
    const toPath = normalizeLabelPath(to).path;
    if (fromPath === '' || toPath === '') continue;
    if (!descriptions.has(toPath)) {
      issues.push({
        level: 'error',
        message: `改名先 "${toPath}" がレジストリに存在しません（renamed: ${fromPath}）`,
      });
      continue;
    }
    claim(labelKey(fromPath), toPath, '改名前パス');
  }

  // メインラベルの固定リストを組む。
  // 「アプリ」は kind: 'app' を明示した第一階層だけ。kind: 'axis' の補助軸はここに入らないので、
  // アプリ以外の第一階層を足しても、その配下がメインラベルとして通ることはない。
  const apps = paths.filter((path) => kinds.get(path) === 'app');
  const appKeys = new Map(apps.map((app) => [labelKey(app), app] as const));
  const sectionsOf = new Map<string, string[]>(apps.map((app) => [app, []]));

  for (const path of paths) {
    if (labelDepth(path) !== MAIN_LABEL_SEGMENTS) continue;
    const parent = labelParent(path);
    if (parent === null) continue;
    const app = appKeys.get(labelKey(parent));
    if (app === undefined) continue;
    sectionsOf.get(app)?.push(path);
  }

  for (const app of apps) {
    if ((sectionsOf.get(app) ?? []).length === 0) {
      issues.push({
        level: 'error',
        message: `アプリ "${app}" に第二階層が1つも登録されていません（メインラベルを付けられません）`,
      });
    }
  }

  return { resolve, descriptions, kinds, paths, apps, sectionsOf, issues };
}

export type LabelResolution =
  | { ok: true; path: string; renamedFrom?: string }
  | { ok: false; issues: LabelIssue[] };

/** meta.json に書かれた生のラベルを、レジストリの正規パスに解決する */
export function resolveLabel(raw: string, registry: ResolvedRegistry): LabelResolution {
  const { path, issues } = normalizeLabelPath(raw);
  const errors = issues.filter((issue) => issue.level === 'error');
  if (errors.length > 0 || path === '') {
    return { ok: false, issues };
  }

  const canonical = registry.resolve.get(labelKey(path));
  if (canonical === undefined) {
    return {
      ok: false,
      issues: [
        ...issues,
        {
          level: 'error',
          message: `ラベル "${path}" は content/labels.json に未登録です（先に description 付きで登録してください）`,
        },
      ],
    };
  }

  if (canonical !== path) {
    return { ok: true, path: canonical, renamedFrom: path };
  }
  return { ok: true, path: canonical };
}

/**
 * メインラベルを解決する（label-spec.md §3・§7.2 のエラー 2〜4）。
 *
 * 形式チェックを resolveLabel と分けているのは、メインだけが
 * 「ちょうど2段」「第一階層は登録済みアプリ」「第二階層は固定リスト」という
 * 追加の制約を負うため。サブラベルはこの制約を受けない。
 */
export function resolveMainLabel(raw: string, registry: ResolvedRegistry): LabelResolution {
  const resolution = resolveLabel(raw, registry);
  if (!resolution.ok) return resolution;

  const path = resolution.path;
  const segments = labelSegments(path);

  if (segments.length !== MAIN_LABEL_SEGMENTS) {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          message:
            `メインラベル "${path}" は ${segments.length} 段です` +
            `（\`<アプリ>/<セクション>\` のちょうど ${MAIN_LABEL_SEGMENTS} 段にしてください）`,
        },
      ],
    };
  }

  const app = labelParent(path) ?? '';
  const sections = registry.sectionsOf.get(app);

  if (sections === undefined) {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          message:
            `メインラベルの第一階層 "${app}" は登録済みアプリではありません` +
            `（使えるのは ${registry.apps.join(' / ') || 'なし'}）`,
        },
      ],
    };
  }

  if (!sections.includes(path)) {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          message:
            `メインラベル "${path}" は "${app}" の固定リストにありません` +
            `（docs/label-spec.md の一覧から選んでください）`,
        },
      ],
    };
  }

  return resolution;
}

// ---------------------------------------------------------------------------
// ツリー構築と絞り込み
// ---------------------------------------------------------------------------

/**
 * ページ群とレジストリからラベルツリーを組む。
 * 親ラベルは暗黙に存在する（`技術/SQLite` があれば `技術` も現れる）。
 */
export function buildLabelTree(pages: IndexedPage[], registry: ResolvedRegistry): IndexedLabel[] {
  const selfCounts = new Map<string, number>();
  const mainCounts = new Map<string, number>();
  const counts = new Map<string, number>();
  const known = new Set<string>(registry.paths);

  for (const page of pages) {
    // 1ページが同じ祖先を複数回持っても、祖先の count は1回だけ数える
    const ancestors = new Set<string>();
    for (const label of page.allLabels) {
      selfCounts.set(label, (selfCounts.get(label) ?? 0) + 1);
      for (const ancestor of labelAncestry(label)) {
        known.add(ancestor);
        ancestors.add(ancestor);
      }
    }
    for (const ancestor of ancestors) {
      counts.set(ancestor, (counts.get(ancestor) ?? 0) + 1);
    }
    // mainCount は「メインラベルとして直接付いた件数」。祖先には配らない
    mainCounts.set(page.mainLabel, (mainCounts.get(page.mainLabel) ?? 0) + 1);
    for (const ancestor of labelAncestry(page.mainLabel)) known.add(ancestor);
  }

  // 暗黙の親も含めて全パスを確定させる
  for (const path of [...known]) {
    for (const ancestor of labelAncestry(path)) known.add(ancestor);
  }

  const childrenOf = new Map<string, string[]>();
  for (const path of known) {
    const parent = labelParent(path);
    if (parent === null) continue;
    const siblings = childrenOf.get(parent) ?? [];
    siblings.push(path);
    childrenOf.set(parent, siblings);
  }

  const collator = new Intl.Collator('ja');
  const sortPaths = (a: string, b: string) => collator.compare(a, b);

  return [...known].sort(sortPaths).map((path) => {
    const kind = registry.kinds.get(path);
    return {
      path,
      name: labelName(path),
      depth: labelDepth(path),
      parent: labelParent(path),
      count: counts.get(path) ?? 0,
      selfCount: selfCounts.get(path) ?? 0,
      mainCount: mainCounts.get(path) ?? 0,
      children: (childrenOf.get(path) ?? []).sort(sortPaths),
      description: registry.descriptions.get(path) ?? '',
      ...(kind === undefined ? {} : { kind }),
    };
  });
}

export type FilterMode = 'and' | 'or';

/**
 * ページが指定ラベル（子孫を含む）に該当するか。
 * 判定はメイン / サブを区別せず allLabels を見る（label-spec.md §7.1）。
 */
export function pageMatchesLabel(page: IndexedPage, label: string): boolean {
  return page.allLabels.some((owned) => isDescendantOrSelf(owned, label));
}

/** 「直下のみ」判定: そのラベルが直接付いているか */
export function pageMatchesLabelExactly(page: IndexedPage, label: string): boolean {
  const key = labelKey(label);
  return page.allLabels.some((owned) => labelKey(owned) === key);
}

export function filterPages(
  pages: IndexedPage[],
  selected: string[],
  options: { mode?: FilterMode; exact?: boolean } = {},
): IndexedPage[] {
  if (selected.length === 0) return pages;
  const mode = options.mode ?? 'and';
  const match = options.exact ? pageMatchesLabelExactly : pageMatchesLabel;
  return pages.filter((page) =>
    mode === 'and'
      ? selected.every((label) => match(page, label))
      : selected.some((label) => match(page, label)),
  );
}

/** URL のクエリ（`Blender/モデリング,Blender/モデリング/ベベル`）とラベル配列の相互変換 */
export function encodeLabelQuery(labels: string[]): string {
  return labels.join(',');
}

export function decodeLabelQuery(query: string | null | undefined): string[] {
  if (!query) return [];
  return query
    .split(',')
    .map((part) => normalizeLabelPath(part).path)
    .filter((part) => part !== '');
}
