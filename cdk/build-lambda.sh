#!/bin/sh
# authorization・meals・app_api を、Lambda（arm64、Python 3.12）に載せる形にまとめて cdk/build/ に置く。
# cdk deploy の前に実行する。Docker は使わず、uv で Lambda 用のパッケージを入れる。
#
# 外部の依存は uv export で書き出し、Lambda 用の wheel を入れる。同じリポジトリのパッケージ（sync・training）は
# path の依存なので書き出さず（--no-emit-local）、ソースをそのままコピーする（wheel を作るより速く、中身が見てわかる）。
set -eu
cd "$(dirname "$0")"
services=../services

# フォルダの .py と、サブパッケージ（__init__.py のあるフォルダ）をコピーする。テストは載せない
copy_sources() {
  src=$1 out=$2
  cp "$src"/*.py "$out/"
  for pkg in "$src"/*/__init__.py; do
    [ -e "$pkg" ] || continue  # サブパッケージがない場合
    dir=$(dirname "$pkg")
    [ "$(basename "$dir")" = tests ] || cp -R "$dir" "$out/"
  done
}

for app in authorization meals app_api; do
  out="build/$app"
  rm -rf "$out"
  mkdir -p "$out"
  # requirements.txt の先頭にはコマンドが書かれ、アセットのハッシュに入る。同じリポジトリの依存がない認可API は今までと同じコマンドにする
  local_deps=''
  [ "$app" = authorization ] || local_deps='--no-emit-local'
  (cd "$services/$app" && uv export --frozen --no-dev --no-hashes $local_deps --quiet -o "../../cdk/$out/requirements.txt")
  uv pip install --quiet -r "$out/requirements.txt" --target "$out" \
    --python-platform aarch64-manylinux2014 --python-version 3.12 --only-binary :all:
  copy_sources "$services/$app" "$out"
  case "$app" in
    meals)
      cp -R "$services/sync/sync" "$out/" ;;
    app_api)
      # 同期の入口に、食事と筋トレを登録する。食事はパッケージではないので、層のフォルダだけをコピーする（main.py は MCP 用）
      cp -R "$services/sync/sync" "$services/training/training" "$out/"
      for layer in application domain infrastructure presentation; do cp -R "$services/meals/$layer" "$out/"; done ;;
  esac
  # PC でテストを動かしたときのキャッシュは載せない（中身が同じでも、アセットのハッシュが変わるため）
  find "$out" -name __pycache__ -type d -prune -exec rm -rf {} +
  # Lambda Web Adapter がこのスクリプトでアプリを起動し、HTTP のリクエストを渡す。
  # 認可API は Flask（WSGI）なので gunicorn、食事記録は ASGI なので uvicorn で動かす。
  # app_api は Web Adapter を通さず、Lambda が main.handler を直接呼ぶ
  case "$app" in
    authorization) server="gunicorn --bind 0.0.0.0:8080 --no-control-socket 'main:create_app()'" ;;  # Lambda ではファイルを書けないので、制御用のソケットは作らない
    meals) server='uvicorn main:app --host 0.0.0.0 --port 8080' ;;
    *) server='' ;;
  esac
  if [ -n "$server" ]; then
    printf '#!/bin/sh\nexec python -m %s\n' "$server" > "$out/run.sh"
    chmod +x "$out/run.sh"
  fi
  echo "$out を作りました"
done
