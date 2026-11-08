import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';

// cdk.json の context（機能フラグ）を渡した App。実際の合成（cdk synth・deploy）と同じテンプレートでテストする
const cdkJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8'));
export const newApp = () => new cdk.App({ context: cdkJson.context });
