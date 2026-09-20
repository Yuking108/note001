/**
 * content/ 配下のスキーマ定義。アプリとスクリプトで共有する唯一の型。
 * 設計書 §5 / §6.4 に対応。
 */

export const SCHEMA_VERSION = 1 as const;

/** content/pages/<slug>/meta.json */
export type PageMeta = {
  schemaVersion: number;
  /** slug。ディレクトリ名と一致すること */
  id: string;
  /** 表示用タイトル（こちらが正。HTML の <title> は補助） */
  title: string;
  /** 1〜2文。一覧プレビューと将来の検索対象 */
  summary: string;
  /** 正規化済みラベルパスの配列 */
  labels: string[];
  /** YYYY-MM-DD */
  createdAt: string;
  /** YYYY-MM-DD */
  updatedAt: string;
  visibility: 'private';
  /** 他ページの id。Phase 4 のバックリンク用に器だけ用意 */
  links?: string[];
  source?: {
    kind: string;
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

export type LabelDefinition = {
  /** スラッシュ区切りの階層パス */
  path: string;
  /** AI がラベルを選ぶための判断材料。必須運用 */
  description: string;
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
  labels: string[];
  createdAt: string;
  updatedAt: string;
};

export type IndexedLabel = {
  path: string;
  /** 階層の最下層セグメント（表示用） */
  name: string;
  /** 階層の深さ。'技術' = 1, '技術/SQLite' = 2 */
  depth: number;
  /** 親パス。ルートなら null */
  parent: string | null;
  /** 子孫を含むページ数 */
  count: number;
  /** このラベルが直接付いたページ数 */
  selfCount: number;
  /** 直下の子パス */
  children: string[];
  description: string;
};
