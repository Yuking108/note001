# 夜間取り込み

Obsidian に増えた Q&A ノートを、毎日 0:10 に自動でページ化して push する仕組み。
設計書 §8 の取り込み工程を、人の手を介さずに回す版。

- 対象: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/yuki_1/Blender/*.md`
- 除外: `Q&A まとめ.md`（各ノートへの索引であって、ページにする中身ではない）
- 実行: launchd（`com.yuking108.note001.daily-import`）
- ログ: `~/Library/Logs/note001-import.log`

---

## 1. 流れ

```
launchd 0:10
  └ scripts/import-daily.sh
      ├ 前提確認   main ブランチ / 作業ツリーが綺麗 / 必要なコマンドが揃っている
      ├ brctl download   iCloud 上の実体を落とす
      ├ git fetch + ff-only   リモートに追いつく
      ├ npm run pending   ページ化されていない md を洗い出す
      │
      └ md ごとに:
          ├ docs/ に原文をコピー
          ├ claude -p（読むだけ）  title / mainLabel / subLabels / summary を決める
          │                        決めきれなければ **見送り**
          ├ npm run new            器を作る（ラベルの実在チェックはここ）
          ├ meta.json              summary と source を機械的に書く
          ├ claude -p（書く）      index.html を1枚書く
          ├ 検証                   雛形のまま / 短すぎ / 索引エラー → 巻き戻して失敗扱い
          └ git commit             ここまで全部通ったものだけ
      │
      ├ npm test / typecheck / build   1件でもコミットがあれば全体を検証
      └ git push origin main           検証を通ったときだけ
```

## 2. ページ化済みの判定

`content/pages/<slug>/meta.json` の **`source.file`** が唯一の鍵。

```json
"source": {
  "kind": "claude-code",
  "file": "Q&A_レンダリングの時刻予約.md",
  "note": "docs/Q&A_レンダリングの時刻予約.md を夜間取り込みでページ化したもの"
}
```

人が読む `note` と違い、`file` は書式を崩さないこと。ここが崩れると同じ md が二重にページ化される。

## 3. 見送り（skip）

無人実行では **メインラベルの確定に自信が持てないものを作らない**。次のときは見送る。

- mainLabel の候補が複数あって、公式ドキュメントの構成から決めきれない
- 原文が短すぎる・書きかけ
- どのアプリ（第一階層）にも属さない
- レジストリに無いラベルを返してきた（`npm run new` が弾く）

見送った md は `.import-state.json`（git 管理外）に理由とその時点の更新時刻を記録し、翌晩以降は候補から外れる。
**md に手を入れれば更新時刻が変わり、自動で候補に戻る。** 台帳を無視して全部やり直すなら `--all`。

```bash
npx tsx scripts/import-state.ts list          # 見送り中の一覧と理由
npx tsx scripts/import-state.ts clear "Q&A_xxx.md"   # 個別に解除
```

サブラベルは**既存レジストリから選ぶだけ**で、新規ラベルは作らせていない。
3段目のラベルを増やすのは本人の判断（設計書 §8.1 の手順4）なので、そこは自動化の対象外。

## 4. 失敗したとき何が残るか

| 状況 | リポジトリの状態 | 通知 |
|---|---|---|
| 見送り | 何も残らない（docs のコピーも消す） | 見送り件数 |
| 執筆や検証に失敗 | 何も残らない（丸ごと巻き戻す） | 失敗件数 |
| テスト・ビルドに落ちた | コミットは残る。**push しない** | 中止した旨 |
| push に失敗 | コミットは残る。翌晩の実行で一緒に push される | 中止した旨 |

通知は macOS の通知センター。詳細はログを見る。

```bash
tail -50 ~/Library/Logs/note001-import.log
```

## 5. 手で動かす

```bash
npm run pending                  # 取り込み対象を確認するだけ
npm run import -- --dry-run      # 前提確認 + 対象の表示
npm run import -- --no-push      # コミットまで（push しない）
npm run import                   # 本番と同じ
npm run import -- --all          # 見送り台帳を無視
```

## 6. 設定

環境変数で差し替えられる。既定値は `scripts/import-daily.sh` の先頭。

| 変数 | 既定 | 用途 |
|---|---|---|
| `NOTE001_VAULT_DIR` | iCloud の Blender フォルダ | 取り込み元 |
| `NOTE001_MODEL` | `opus` | 分類と執筆に使うモデル |
| `NOTE001_MAX_USD` | `4` | 1回の claude 呼び出しの上限 |
| `NOTE001_CLASSIFY_TIMEOUT` | `600` | 分類の制限時間（秒） |
| `NOTE001_WRITE_TIMEOUT` | `1800` | 執筆の制限時間（秒） |
| `NOTE001_BRANCH` | `main` | 対象ブランチ（検証用） |

## 7. launchd

```bash
# 登録
cp scripts/launchd/com.yuking108.note001.daily-import.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yuking108.note001.daily-import.plist

# 今すぐ1回走らせる（動作確認）
launchctl kickstart -p gui/$(id -u)/com.yuking108.note001.daily-import

# 状態
launchctl print gui/$(id -u)/com.yuking108.note001.daily-import | head -20

# 停止
launchctl bootout gui/$(id -u)/com.yuking108.note001.daily-import
```

## 8. 前提と限界

- **Mac が動いていること。** スリープ中に 0:10 を迎えた場合は起床時に走る。電源が落ちていた間は走らない。
  毎晩必ず走らせたいなら `sudo pmset repeat wake MTWRFSU 00:05:00` で起こす。
- **キーチェーンが開いていること。** git push（osxkeychain）と claude の認証の両方がキーチェーンを読む。
- **iCloud の同期が済んでいること。** `brctl download` を先に叩くが、同期が追いついていない md は次の晩に回る。
- **画像は取り込まない。** Obsidian 側の `assets/` は対象外で、原文がスクリーンショットを参照していても
  本文では文章に置き換える。図が要る箇所はインライン SVG で描かせる。
- 1件あたりの費用はモデルと原文の長さ次第（Opus で概ね数百円規模）。抑えるなら `NOTE001_MODEL=sonnet`。
