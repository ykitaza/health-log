#!/bin/sh
# CDK でデプロイしたユーザープールから、PC で認可API を動かすための services/authorization/.env を作る。
# クライアントシークレットは画面に出さず、本人だけが読めるファイルに保存する。
# ユーザーは作らない（パスワードでログインできるテスト用のユーザーを、本番のプールに置かないため）。
# 本人のユーザーとパスキーは、docs/design.md の「パスキーを作る手順」で作る。
set -eu
cd "$(dirname "$0")"
# AWS の認証情報は、環境変数（AWS_PROFILE など）で指定しておく
export AWS_REGION=ap-northeast-1

out() {
  aws cloudformation describe-stacks --stack-name CognitoStudy \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
POOL=$(out UserPoolId)
CID=$(out ClientId)
umask 077

{
  echo "COGNITO_ISSUER=$(out CognitoIssuer)"
  echo "COGNITO_CLIENT_ID=$CID"
  echo "COGNITO_CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client --user-pool-id "$POOL" --client-id "$CID" \
    --query UserPoolClient.ClientSecret --output text)"
} > .env
echo ".env を書きました"
