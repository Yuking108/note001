/**
 * content/ 配下のスキーマ定義。アプリとスクリプトで共有する唯一の型。
 * ラベルの仕様は docs/label-spec.md v2（design.md §5.1 / §6 を上書きする）に対応。
 */

export const SCHEMA_VERSION = 2 as const;

/** メインラベルのセグメント数。`<アプリ>/<セクション>` のちょうど2段に固定する */
export const MAIN_LABEL_SEGMENTS = 2 as const;

/** メイン + サブの合計がこれ以上なら警告（付けすぎは分類を諦めた兆候） */
export const LABEL_COUNT_WARN_THRESHOLD = 8 as const;

/** content/pages/<slug>/meta.json */
export type PageMeta = {
  schemaVersion: number;
  /** slug。ディレクトリ名と一致すること */
  id: string;
  /** 表示用タイトル（こちらが正。HTML の <title> は補助） */
  title: string;
  /** 1〜2文。一覧プレビューと将来の検索対象 */
  summary: string;
  /**
   * メインラベル。「フォルダを作るならどこに置くか」がちょうど1つ。
   * 配列ではなく文字列にして「1つしか付かない」を型で保証する。
   */
  mainLabel: string;
  /** サブラベル。0件以上、複数可。メイン体系の3段目や、もう一方のアプリ／別セクションなど */
  subLabels: string[];
  /** YYYY-MM-DD */
  createdAt: string;
  /** YYYY-MM-DD */
  updatedAt: string;
  visibility: 'private';
  /** 他ページの id。Phase 4 のバックリンク用に器だけ用意 */
  links?: string[];
  source?: {
    kind: string;
    /**
     * 取り込み元の Obsidian ノートのファイル名（`Q&A_xxx.md`）。
     * 夜間取り込み（docs/daily-import.md）が「この md はページ化済みか」を機械的に判定する唯一の鍵。
     * 人が読む `note` と違い、書式を崩さないこと。
     */
    file?: string;
    note?: string;
  };
};

/** content/labels.json */
export type LabelRegistry = {
  schemaVersion: number;
  labels: LabelDefinition[];
  /** 改名履歴: 旧パス -> 新パス */
  renamed?: Record<string, string>;
};

/**
 * 第一階層の種別。
 * - `app`  … 対象アプリ。**メインラベルの第一階層になれるのはこれだけ**
 * - `axis` … アプリ以外の補助軸。サブラベル専用（現在は登録なし。label-spec.md §6 で廃止）
 * 第二階層以下では指定しない。
 */
export type LabelKind = 'app' | 'axis';

export type LabelDefinition = {
  /** スラッシュ区切りの階層パス */
  path: string;
  /** AI がラベルを選ぶための判断材料。必須運用 */
  description: string;
  /** 第一階層のみ指定する */
  kind?: LabelKind;
  /**
   * アプリ直下の2段ラベルを、メインラベルの固定リストに**入れない**ための印。
   * 既定は true（公式ドキュメントのセクション）。
   * `Blender/Q&A` のように「アプリの下に置くがセクションではない」ラベルにだけ false を付ける。
   * false のラベルはサブラベル専用になる。
   */
  section?: boolean;
  /** 表記ゆれの受け皿 */
  aliases?: string[];
};

/** src/generated/index.json — アプリが読む唯一のデータ */
export type ContentIndex = {
  generatedAt: string;
  pages: IndexedPage[];
  labels: IndexedLabel[];
};

export type IndexedPage = {
  id: string;
  title: string;
  summary: string;
  /** 解決済みのメインラベル */
  mainLabel: string;
  /** 解決済みのサブラベル */
  subLabels: string[];
  /**
   * [mainLabel, ...subLabels] を展開したもの。絞り込みとツリーはこちらを見るので、
   * ラベルツリーの実装はメイン / サブの区別を意識しないまま動く。
   */
  allLabels: string[];
  /** このページが挙げている関連ページの id。存在しない id はビルドで弾く */
  links: string[];
  createdAt: string;
  updatedAt: string;
};

export type IndexedLabel = {
  path: string;
  /** 階層の最下層セグメント（表示用） */
  name: string;
  /** 階層の深さ。'Blender' = 1, 'Blender/モデリング' = 2 */
  depth: number;
  /** 親パス。ルートなら null */
  parent: string | null;
  /** 子孫を含むページ数 */
  count: number;
  /** このラベルが直接付いたページ数（メイン・サブの両方を数える） */
  selfCount: number;
  /** このラベルが**メインラベルとして**直接付いたページ数 */
  mainCount: number;
  /** 直下の子パス */
  children: string[];
  description: string;
  /** 第一階層のみ入る */
  kind?: LabelKind;
};
