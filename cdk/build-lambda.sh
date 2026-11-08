#!/bin/sh
# authorization・mcp・app_api を、Lambda（arm64、Python 3.12）に載せる形にまとめて cdk/build/ に置く。
# cdk deploy の前に実行する。Docker は使わず、uv で Lambda 用のパッケージを入れる。
#
# mcp は MCP サーバーの組み立て（services/mcp）で、食事・筋トレ・同期のコードを一緒に載せる（MealsFunction）。
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

for app in authorization mcp app_api; do
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
    mcp | app_api)
      # 食事と筋トレと同期を載せる。食事はパッケージではないので、層のフォルダだけをコピーする
      # 組み立ての場所どうしで共有するもの（services/composition）も載せる
      cp -R "$services/sync/sync" "$services/training/training" "$services/composition/composition" "$out/"
      for layer in application domain infrastructure presentation; do cp -R "$services/meals/$layer" "$out/"; done ;;
  esac
  # PC でテストを動かしたときのキャッシュは載せない（中身が同じでも、アセットのハッシュが変わるため）
  find "$out" -name __pycache__ -type d -prune -exec rm -rf {} +
  # Lambda Web Adapter がこのスクリプトでアプリを起動し、HTTP のリクエストを渡す。
  # 認可API は Flask（WSGI）なので gunicorn、MCP サーバーは ASGI なので uvicorn で動かす。
  # app_api は Web Adapter を通さず、Lambda が main.handler を直接呼ぶ
  case "$app" in
    authorization) server="gunicorn --bind 0.0.0.0:8080 --no-control-socket 'main:create_app()'" ;;  # Lambda ではファイルを書けないので、制御用のソケットは作らない
    mcp) server='uvicorn main:app --host 0.0.0.0 --port 8080' ;;
    *) server='' ;;
  esac
  if [ -n "$server" ]; then
    printf '#!/bin/sh\nexec python -m %s\n' "$server" > "$out/run.sh"
    chmod +x "$out/run.sh"
  fi
  echo "$out を作りました"
done
