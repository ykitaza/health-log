#!/bin/sh
# authorization・meals を、Lambda（arm64、Python 3.12）に載せる形にまとめて cdk/build/ に置く。
# cdk deploy の前に実行する。Docker は使わず、uv で Lambda 用のパッケージを入れる。
set -eu
cd "$(dirname "$0")"

for app in authorization meals; do
  out="build/$app"
  rm -rf "$out"
  mkdir -p "$out"
  (cd "../services/$app" && uv export --frozen --no-dev --no-hashes --quiet -o "../../cdk/$out/requirements.txt")
  uv pip install --quiet -r "$out/requirements.txt" --target "$out" \
    --python-platform aarch64-manylinux2014 --python-version 3.12 --only-binary :all:
  cp ../services/$app/*.py "$out/"
  # サブパッケージ（oauth/ infrastructure/ presentation/ など）もコピーする。テストは載せない
  for pkg in ../services/$app/*/__init__.py; do
    [ -e "$pkg" ] || continue  # サブパッケージがない場合
    dir=$(dirname "$pkg")
    [ "$(basename "$dir")" = tests ] || cp -R "$dir" "$out/"
  done
  # Lambda Web Adapter がこのスクリプトでアプリを起動し、HTTP のリクエストを渡す。
  # 認可API は Flask（WSGI）なので gunicorn、食事記録は ASGI なので uvicorn で動かす
  if [ "$app" = authorization ]; then
    server="gunicorn --bind 0.0.0.0:8080 --no-control-socket 'main:create_app()'"  # Lambda ではファイルを書けないので、制御用のソケットは作らない
  else
    server='uvicorn main:app --host 0.0.0.0 --port 8080'
  fi
  printf '#!/bin/sh\nexec python -m %s\n' "$server" > "$out/run.sh"
  chmod +x "$out/run.sh"
  echo "$out を作りました"
done
