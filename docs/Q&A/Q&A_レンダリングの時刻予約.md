---
title: アニメーションのレンダリングを時刻予約したい
tags:
  - Blender
  - QandA
  - rendering
  - addon
date: 2026-09-21
---

# Q. Blenderでアニメーションのレンダリングの「予約」はできないの？

「深夜2時から自動でレンダリング開始」のような時刻指定の予約をしたい。

## A. Blender単体にはスケジュール機能はない。やり方は3通り

| 方法 | できること | 向いている用途 |
| --- | --- | --- |
| レンダーキュー系アドオン | 複数シーン/複数.blendを**順番に**処理 | 寝る前にまとめて流す |
| コマンドライン + macOSのスケジューラ | **時刻指定の予約**が本当にできる | 「深夜2時から」など |
| Flamenco | 複数マシンでのジョブ管理・分散レンダリング | 本格的なファーム運用 |

---

## 方法1: レンダーキュー系アドオン（順番待ち）

Blender Extensions プラットフォームから入る。時刻予約ではなく「キューに積んで順番に処理」する仕組み。

- **Render Queque** — https://extensions.blender.org/add-ons/render-queque/
- **RenderCue** — https://extensions.blender.org/add-ons/rendercue/
- **BLeQ** — https://extensions.blender.org/add-ons/bleq-extension/
- **Blender Queue**（有料）— https://blenderqueue.com/

インストール: 編集 > プリファレンス > 拡張機能 から検索してインストール。

### どれが一般的か（2026-09-21時点の公式Extensionsの実績）

| アドオン | DL数 | 評価 | 最終更新 | 特徴 |
| --- | --- | --- | --- | --- |
| **RenderCue** | 2,771 | ★4.0（2件） | 2025-12-08 (v1.1.3) | 最有力。複数シーンをキュー化、ジョブごとに設定上書き、**バックグラウンド実行**、Webhook通知、複数ファイルのリンクシーン対応。UIが固まらない |
| BLeQ | 1,223 | レビューなし | 2026-02-07 | シーン+**カメラ**の組み合わせで自動切替。マルチカメラ案件向け。欠損エントリを自動スキップ。別途スタンドアロンアプリ連携あり |
| Render Queque | 299 | レビューなし | 2026-07-28 (v0.4.1) | 複数の**.blendファイル**を最大30個まで順次処理。解像度プリセット、プレビューサムネイル。まだ新しく実績は少なめ |

いずれも Blender 4.2 LTS 以降対応。

**結論**: 迷うなら **RenderCue**。DL数が他の2〜9倍で、バックグラウンド実行と通知まで揃っている。

ただし正直なところ、3つとも数千DL規模のニッチなアドオンで「定番」と呼べるほど普及したものはない。**コミュニティで一般的なのはむしろ方法2のコマンドライン**で、こちらは壊れないし、そのまま時刻予約にもつなげられる。

- 複数シーンをGUIで管理したい → RenderCue
- カメラごとに出し分けたい → BLeQ
- 複数の .blend をまとめたい → Render Queque、またはコマンドラインの `for` ループ（後述）

---

## 方法2: コマンドライン + cron（時刻予約・macOS）

これが本当の「予約」。Blenderをバックグラウンド（`-b`）で起動してレンダリングさせる。

### まず手動で動作確認

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b "/path/to/file.blend" -a
```

出力先やフォーマットを上書きしたい場合（**`-a` は必ず最後**）:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b "/path/to/file.blend" \
  -o "/Users/theory/Desktop/render/frame_####" -F PNG -s 1 -e 250 -a
```

| オプション | 意味 |
| --- | --- |
| `-b` | バックグラウンド（GUIなし）。メモリを食わず速い |
| `-a` | アニメーションをレンダリング |
| `-o` | 出力パス（`####` が連番に置換される） |
| `-F` | フォーマット（PNG / OPEN_EXR / FFMPEG など） |
| `-s` / `-e` | 開始 / 終了フレーム |
| `-f 100` | 特定フレームだけ |

### スケジューラはどれが一般的か（macOS）

レンダリングを走らせるコマンド自体は `blender -b file.blend -a` 一択で、これは全プラットフォーム共通。分かれるのは「時刻で叩く側」。

| 方法 | 一般度 | 備考 |
| --- | --- | --- |
| **launchd**（LaunchAgent） | **macOS ではこれが正解** | Apple 公式の仕組み。スリープ中に時刻を過ぎても、**復帰時に実行してくれる** |
| cron（crontab） | チュートリアルで最もよく見る | 昔から非推奨扱い。今も動くが、TCC（フルディスクアクセス）で詰まる・スリープ中の回はスキップされる |
| at | ほぼ使われない | macOS では `atrun` が既定で無効 |
| `sleep` + コマンド | 今夜1回だけの時に便利 | ターミナルを閉じると消える |

Blender のチュートリアルは Windows（タスクスケジューラ）か Linux（cron）前提のものが多いので cron の記事をよく見かけるが、**macOS で恒常運用するなら launchd** が確実。

### launchd での設定（推奨）

`~/Library/LaunchAgents/com.yuki.blenderrender.plist` を作成:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.yuki.blenderrender</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>/Applications/Blender.app/Contents/MacOS/Blender</string>
    <string>-b</string>
    <string>/path/to/file.blend</string>
    <string>-a</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>2</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/blender_render.log</string>
  <key>StandardErrorPath</key><string>/tmp/blender_render.err</string>
</dict>
</plist>
```

登録・確認・解除:

```bash
# 登録
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yuki.blenderrender.plist

# 今すぐテスト実行（時刻を待たずに確認できる）
launchctl kickstart -k gui/$(id -u)/com.yuki.blenderrender

# 登録されているか確認
launchctl list | grep blenderrender

# 解除
launchctl bootout gui/$(id -u)/com.yuki.blenderrender
```

注意点:

- LaunchAgent は**ログイン中のユーザーセッションで動く**。ログアウト状態でも動かしたいなら `/Library/LaunchDaemons/` に置く（root 実行になるのでパスと権限に注意）
- plist を編集したら必ず `bootout` → `bootstrap` で入れ直す
- `ProgramArguments` は**スペース区切りのコマンドではなく1要素ずつ配列にする**。ここを間違えると静かに起動しない

### cron でやる場合（簡易版）

手軽さ優先ならこちらでも動く。

```bash
crontab -e
```

で以下を追記（毎日深夜2時の例）:

```
0 2 * * * /usr/bin/caffeinate -i /Applications/Blender.app/Contents/MacOS/Blender -b "/path/to/file.blend" -a >> ~/blender_render.log 2>&1
```

- `caffeinate -i` を挟むと**レンダリング中にMacがスリープしない**
- `>> ~/blender_render.log 2>&1` でログが残るので、失敗しても原因を追える

### 今夜1回だけでいい場合

ターミナルを開いたまま放置するだけ。指定時刻まで待って実行する:

```bash
sleep $(( $(date -j -f "%Y-%m-%d %H:%M" "2026-09-22 02:00" +%s) - $(date +%s) )) && \
/usr/bin/caffeinate -i /Applications/Blender.app/Contents/MacOS/Blender -b "/path/to/file.blend" -a
```

### 複数ファイルを順番に

```bash
for f in ~/projects/*.blend; do
  /usr/bin/caffeinate -i /Applications/Blender.app/Contents/MacOS/Blender -b "$f" -a
done
```

---

## 方法3: Flamenco（本格運用）

Blender Studio公式のオープンソース・レンダーファームマネージャ。マネージャ + ワーカー構成でジョブをキュー管理し、複数マシンに分散できる。1台でもジョブ管理ツールとして使える。

- https://studio.blender.org/blog/scaling-render-power-with-flamenco-orchestra/
- セルフホスト解説: https://blog.cg-wire.com/self-hosted-blender-render-farm/

---

## macOSでの注意点

- **スリープ対策**: `caffeinate -i` を必ず付ける。それでもディスプレイスリープからの復帰でこける場合は、システム設定 > ロック画面 で自動スリープを切る
- **電源オフからの起動**: `sudo pmset repeat wakeorpoweron MTWRFSU 01:55:00` で毎日1:55に自動起動させておくと、2時のcronが確実に走る
- **cronの権限**: macOSではcronから実行するプログラムに「フルディスクアクセス」が必要な場合がある。システム設定 > プライバシーとセキュリティ > フルディスクアクセス に `/usr/sbin/cron` を追加する
- **パスに日本語やスペースが含まれる場合**は必ずダブルクォートで囲む

## 補足

レンダリング中にPCを使いたいなら `-b` のバックグラウンドレンダリングが有利。GUIを起動しないぶんメモリに余裕ができ、他の作業への影響も小さい。

## 関連

- [[Q&A まとめ]]
