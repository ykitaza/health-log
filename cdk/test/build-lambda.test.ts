import * as fs from 'fs';
import * as path from 'path';

const script = fs.readFileSync(path.join(__dirname, '..', 'build-lambda.sh'), 'utf8');
const lines = script.split('\n');

describe('build-lambda.sh が作る run.sh', () => {
  test('認可API の gunicorn は --timeout 0（Lambda の凍結・解凍でワーカーを心拍切れで殺さない）', () => {
    const line = lines.find((l) => l.includes('authorization)') && l.includes('gunicorn'));
    expect(line).toBeDefined();
    expect(line).toMatch(/--timeout 0\s/);
  });

  test('gunicorn を使うのは認可API だけ（MCP は uvicorn で、同じ心拍の仕組みはない）', () => {
    expect(lines.filter((l) => l.includes('gunicorn --bind'))).toHaveLength(1);
    expect(script).toContain("mcp) server='uvicorn main:app");
  });

  test('ことばの MCP は uvicorn で mcp_main:app を動かす（アプリ用の同期は app_api.handler を直接呼ぶ）', () => {
    expect(script).toContain("words) server='uvicorn mcp_main:app");
    expect(script).toMatch(/for app in authorization mcp app_api words; do/);
  });

  test('KARADA とことばの MCP に、共有のコネクタの部品（mcp_connector）を載せる', () => {
    expect(script).toContain('mcp | words) cp -R "$services/mcp_connector/mcp_connector" "$out/"');
  });
});
