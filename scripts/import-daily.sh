#!/bin/bash
#
# Obsidian に増えた Q&A ノートを、毎晩まとめてページ化して push する。
#
#   scripts/import-daily.sh            通常実行（launchd から毎日呼ばれる）
#   scripts/import-daily.sh --dry-run  取り込む対象を出すだけ
#   scripts/import-daily.sh --no-push  コミットまでで止める
#   scripts/import-daily.sh --all      見送り台帳を無視して全部やり直す
#
# 設計上の約束:
#   - 1 つの md の取り込みは「全部成功したらコミット / どこかで失敗したら丸ごと巻き戻す」。
#     中途半端なページをリポジトリに残さない。
#   - 判断が付かないものは **無理に作らず見送る**（.import-state.json に記録し、
#     本人が md に手を入れたら翌晩また候補に戻る）。
#   - 検証を通らない限り push しない。
#
# macOS 標準の bash 3.2 で動かす（mapfile などの 4.x 機能は使わない）。
# 詳細は docs/daily-import.md

set -uo pipefail

# launchd の PATH とロケールは最小限なので、使うものを明示的に足す。
# LANG を指定しないと bash 3.2 が日本語を含む文字列の変数展開を読み違える
export LANG="${LANG:-ja_JP.UTF-8}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

BRANCH="${NOTE001_BRANCH:-main}"
MODEL="${NOTE001_MODEL:-opus}"
MAX_USD="${NOTE001_MAX_USD:-4}"
CLASSIFY_TIMEOUT="${NOTE001_CLASSIFY_TIMEOUT:-600}"
WRITE_TIMEOUT="${NOTE001_WRITE_TIMEOUT:-1800}"

DRY_RUN=0
NO_PUSH=0
PENDING_ALL=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-push) NO_PUSH=1 ;;
    --all) PENDING_ALL=1 ;;
    *) echo "不明な引数: $arg" >&2; exit 1 ;;
  esac
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

created=0
skipped=0
failed=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

notify() {
  # 朝いちで気づけるように通知を出す。通知が使えなくても処理は止めない
  local title="${1//\"/}" body="${2//\"/}"
  osascript -e "display notification \"$body\" with title \"note001 $title\"" >/dev/null 2>&1 || true
}

abort() {
  log "中止: $1"
  notify "取り込みを中止しました" "$1"
  exit 1
}

ts() { npx --no-install tsx "$@"; }

# プロンプトの雛形に値を差し込む。
# sed を使うと & や | を含むタイトルで壊れるため、bash の置換で行う
render() {
  local template; template="$(cat "$1")"; shift
  while [ "$#" -ge 2 ]; do
    template="${template//\{\{$1\}\}/$2}"
    shift 2
  done
  printf '%s' "$template"
}

# claude を時間制限つきで動かし、結果 JSON を $1 に書く。
# 無人実行なので、応答が返らないまま朝まで居座る事態を防ぐ
run_claude() {
  local out_file="$1" limit="$2"; shift 2
  # stdin は必ず切る。開けたままだと、取り込み対象を流している while ループの
  # 入力を claude が飲み込んでしまう
  claude "$@" >"$out_file" 2>>"$TMP_DIR/claude.err" </dev/null &
  local pid=$!
  ( sleep "$limit"; kill -TERM "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid"; local rc=$?
  { kill "$watcher" && wait "$watcher"; } 2>/dev/null
  return $rc
}

# 取り込み中に散らかしたものを、コミット前の状態まで戻す。
# 開始時に作業ツリーが綺麗なことを確認済みなので、content/ docs/ を白紙に戻して安全
rollback() {
  git reset -q HEAD -- content docs >/dev/null 2>&1
  git checkout -q -- content docs >/dev/null 2>&1
  git clean -qfd content docs >/dev/null 2>&1
}

# --- 前提の確認 ---------------------------------------------------------

log "=== 夜間取り込み 開始 ==="

for cmd in git node npx claude jq; do
  command -v "$cmd" >/dev/null 2>&1 || abort "$cmd が見つかりません（PATH: ${PATH}）"
done

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "$BRANCH" ] || abort "$BRANCH 以外のブランチ（${branch}）にいます"

if [ -n "$(git status --porcelain)" ]; then
  abort "作業ツリーに未コミットの変更があります（巻き戻しで巻き添えにするため実行しません）"
fi

start_commit="$(git rev-parse HEAD)"

# --- iCloud の実体を落とす ----------------------------------------------

VAULT="$(ts scripts/pending.ts --vault)"
[ -d "$VAULT" ] || abort "取り込み元が見つかりません: $VAULT"
log "取り込み元: $VAULT"
brctl download "$VAULT" >/dev/null 2>&1 ||
  log "警告 brctl download が失敗しました（未同期のファイルがあるかもしれません）"

# --- リモートに追いつく --------------------------------------------------

if git fetch --quiet origin "$BRANCH" 2>/dev/null; then
  git merge --ff-only --quiet "origin/$BRANCH" 2>/dev/null ||
    abort "origin/$BRANCH と分岐しています（手で解消してください）"
else
  log "警告 fetch に失敗しました（オフライン？）。コミットまで進めて push は後回しにします"
fi

# --- 対象を洗い出す ------------------------------------------------------

if [ "$PENDING_ALL" -eq 1 ]; then
  pending_json="$(ts scripts/pending.ts --json --all)"
else
  pending_json="$(ts scripts/pending.ts --json)"
fi
[ -n "$pending_json" ] || abort "未取り込みの一覧を作れませんでした"

count="$(echo "$pending_json" | jq 'length')"
log "未取り込み: ${count} 件"

if [ "$count" -eq 0 ]; then
  log "=== 何もせず終了 ==="
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "$pending_json" | jq -r '.[] | "  " + .file'
  log "=== --dry-run のため終了 ==="
  exit 0
fi

# 体裁を合わせる参考として、直近のページを 1 つ選ぶ
reference_slug="$(ls -1 content/pages | tail -1)"

# --- 1 件ずつ取り込む ----------------------------------------------------

while IFS= read -r md_file; do
  [ -n "$md_file" ] || continue
  log "--- $md_file ---"

  # 原文をリポジトリに取り込む。以降はリポジトリ内のコピーだけを見る
  # （claude に iCloud 配下へのアクセスを許可せずに済む）
  if ! cp "$VAULT/$md_file" "docs/$md_file"; then
    log "失敗 $md_file: 原文をコピーできませんでした"
    failed=$((failed + 1)); continue
  fi

  # 1. 分類（読むだけ）
  prompt="$(render scripts/import/classify-prompt.md MD_FILE "$md_file")"
  if ! run_claude "$TMP_DIR/classify.json" "$CLASSIFY_TIMEOUT" \
    -p "$prompt" \
    --model "$MODEL" \
    --max-budget-usd "$MAX_USD" \
    --output-format json \
    --json-schema "$(cat scripts/import/classify-schema.json)" \
    --allowedTools "Read,Glob,Grep" \
    --disallowedTools "Bash,Write,Edit"; then
    log "失敗 $md_file: 分類が終わりませんでした（時間切れかエラー）"
    rollback; failed=$((failed + 1)); continue
  fi
  if ! jq -e '.is_error == false and (.structured_output | type) == "object"' \
    "$TMP_DIR/classify.json" >/dev/null 2>&1; then
    log "失敗 $md_file: 分類の結果を読めませんでした"
    log "$(jq -r '.result // "（出力なし）"' "$TMP_DIR/classify.json" 2>/dev/null | head -3)"
    rollback; failed=$((failed + 1)); continue
  fi

  decision="$(jq -r '.structured_output.decision // "skip"' "$TMP_DIR/classify.json")"
  reason="$(jq -r '.structured_output.reason // "理由の記録なし"' "$TMP_DIR/classify.json")"
  title="$(jq -r '.structured_output.title // ""' "$TMP_DIR/classify.json")"
  main_label="$(jq -r '.structured_output.mainLabel // ""' "$TMP_DIR/classify.json")"
  summary="$(jq -r '.structured_output.summary // ""' "$TMP_DIR/classify.json")"

  sub_args=""
  while IFS= read -r sub; do
    [ -n "$sub" ] || continue
    sub_args="$sub_args"$'\n'"--sub"$'\n'"$sub"
  done < <(jq -r '.structured_output.subLabels // [] | .[]' "$TMP_DIR/classify.json")

  if [ "$decision" != "create" ] || [ -z "$title" ] || [ -z "$main_label" ]; then
    log "見送り $md_file: $reason"
    ts scripts/import-state.ts skip "$md_file" "$reason" >/dev/null
    rollback; skipped=$((skipped + 1)); continue
  fi

  log "分類: $title / $main_label / $(echo "$sub_args" | grep -v '^--sub$' | tr '\n' ' ')"

  # 2. 器を作る（ラベルが実在するかは new-page.ts が判定する）
  #    引数は改行区切りで組み立て、IFS を改行に切り替えて渡す（bash 3.2 での配列の取り回しを避ける）
  old_ifs="$IFS"; IFS=$'\n'
  # shellcheck disable=SC2086
  new_out="$(ts scripts/new-page.ts --title "$title" --main "$main_label" $sub_args 2>&1)"
  new_rc=$?
  IFS="$old_ifs"

  if [ "$new_rc" -ne 0 ]; then
    log "見送り $md_file: ラベルが通りませんでした"
    log "$new_out"
    ts scripts/import-state.ts skip "$md_file" "ラベルが通らなかった: $main_label" >/dev/null
    rollback; skipped=$((skipped + 1)); continue
  fi

  slug="$(echo "$new_out" | sed -n 's|^作成しました: content/pages/\([^/]*\)/.*|\1|p' | head -1)"
  if [ -z "$slug" ] || [ ! -d "content/pages/$slug" ]; then
    log "失敗 $md_file: slug を取れませんでした"
    rollback; failed=$((failed + 1)); continue
  fi
  log "器: content/pages/$slug/"

  # 3. meta.json の残りを埋める（要約と取り込み元。ここは機械的に書く）
  meta="content/pages/$slug/meta.json"
  jq --arg s "$summary" --arg f "$md_file" \
    '.summary = $s | .source = {kind: "claude-code", file: $f, note: ("docs/" + $f + " を夜間取り込みでページ化したもの")}' \
    "$meta" >"$meta.tmp" && mv "$meta.tmp" "$meta"

  # 4. 本文を書く
  prompt="$(render scripts/import/write-prompt.md \
    MD_FILE "$md_file" SLUG "$slug" REFERENCE_SLUG "$reference_slug" TITLE "$title")"
  if ! run_claude "$TMP_DIR/write.json" "$WRITE_TIMEOUT" \
    -p "$prompt" \
    --model "$MODEL" \
    --max-budget-usd "$MAX_USD" \
    --output-format json \
    --permission-mode acceptEdits \
    --allowedTools "Read,Write,Edit,Glob,Grep" \
    --disallowedTools "Bash"; then
    log "失敗 $md_file: 本文の執筆が終わりませんでした（時間切れかエラー）"
    rollback; failed=$((failed + 1)); continue
  fi
  if ! jq -e '.is_error == false' "$TMP_DIR/write.json" >/dev/null 2>&1; then
    log "失敗 $md_file: 執筆がエラーで終わりました"
    log "$(jq -r '.result // "（出力なし）"' "$TMP_DIR/write.json" 2>/dev/null | head -3)"
    rollback; failed=$((failed + 1)); continue
  fi

  # 5. 検証。ここを通らないものはコミットしない
  html="content/pages/$slug/index.html"
  if grep -q "ここから本文を書く" "$html"; then
    log "失敗 $md_file: 雛形のままです"
    rollback; failed=$((failed + 1)); continue
  fi
  if [ "$(wc -c <"$html")" -lt 3000 ]; then
    log "失敗 $md_file: 本文が短すぎます"
    rollback; failed=$((failed + 1)); continue
  fi
  if ! index_out="$(ts scripts/build-index.ts 2>&1)"; then
    log "失敗 $md_file: 索引の検証に落ちました"
    log "$(echo "$index_out" | grep '^エラー' | head -5)"
    rollback; failed=$((failed + 1)); continue
  fi

  # 6. コミット
  git add content docs >/dev/null 2>&1
  if ! git commit -q -F - <<EOF
Add page: $title

取り込み元: docs/$md_file
scripts/import-daily.sh による自動取り込み
EOF
  then
    log "失敗 $md_file: コミットできませんでした"
    rollback; failed=$((failed + 1)); continue
  fi

  log "作成 ${title}（content/pages/${slug}/）"
  created=$((created + 1))
  reference_slug="$slug"
done < <(echo "$pending_json" | jq -r '.[].file')

# --- まとめて検証して push ----------------------------------------------

log "--- 結果: 作成 ${created} / 見送り ${skipped} / 失敗 ${failed} ---"

if [ "$(git rev-parse HEAD)" = "$start_commit" ]; then
  log "=== 新しいコミットなし。終了 ==="
  if [ "$skipped" -gt 0 ] || [ "$failed" -gt 0 ]; then
    notify "取り込めませんでした" "見送り ${skipped} / 失敗 ${failed}。ログを確認してください"
  fi
  exit 0
fi

for check in "npm test" "npm run typecheck" "npm run build"; do
  if ! check_out="$($check 2>&1)"; then
    log "$check_out"
    abort "$check に落ちました。コミットは残しましたが push しません"
  fi
done
log "検証を通過しました"

if [ "$NO_PUSH" -eq 1 ]; then
  log "=== --no-push のため push せず終了 ==="
  exit 0
fi

if ! push_out="$(git push origin "$BRANCH" 2>&1)"; then
  log "$push_out"
  abort "push に失敗しました（認証切れ？ コミットはローカルに残っています）"
fi

log "push しました"
notify "取り込み完了" "作成 ${created} / 見送り ${skipped} / 失敗 ${failed}"
log "=== 夜間取り込み 終了 ==="
