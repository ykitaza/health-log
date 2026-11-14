"""ブラウザに出す画面（同意画面、プライバシーポリシー、エラー画面）。外部の CSS や JS は読み込まない。

見た目はアプリ（apps/mobile/theme）と Cognito のマネージドログインのブランディング（cdk/lib/infra-stack.ts）に合わせる。
CSS と JS はページに埋め込み、CSP（CONTENT_SECURITY_POLICY）でその中身のハッシュだけを許す。
"""

import base64
import hashlib
import html

# 同意画面に表示する scope の説明（できるようになること）
SCOPE_DESCRIPTIONS = {
    "meals:read": "食事の記録と目標を読む",
    "meals:write": "食事の記録と目標を書く（追加・修正・削除）",
    "training:read": "筋トレ（種目・重量・回数）と体組成の記録を読む",
    "training:write": "筋トレと体組成の記録を書く（追加・修正・削除）",
}

# 色・余白・角はアプリ（apps/mobile/theme/index.ts）と同じ値。ダークモードだけ（アプリとログイン画面と同じ）。
# 余白は 8px 刻み、画面の左右は 16px、押せるものは 48px 以上。文字は地に対して 4.5:1 以上
STYLE = """
:root {
  color-scheme: dark;
  --space-xs: 4px; --space-s: 8px; --space-m: 12px; --space-l: 16px; --space-xl: 24px; --space-xxl: 32px;
  --bg: #0E1013; --card: #181B20; --input: #22262D; --line: #2C313A; --outline: #6E7580;
  --text: #F3F5F7; --sub: #9AA1AD; --accent: #5BE49B; --on-accent: #08130D;
  --radius-s: 8px; --radius-card: 16px;
  --font: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/24px var(--font); -webkit-text-size-adjust: 100%;
}
main { max-width: 560px; margin-inline: auto; padding: var(--space-l) var(--space-l) var(--space-xxl); }
.brand { display: flex; align-items: center; gap: var(--space-m); min-height: 64px; margin-bottom: var(--space-s); }
.brand svg { width: 40px; height: 40px; border-radius: var(--radius-s); flex: none; }
.logo { margin: 0; font-size: 24px; line-height: 32px; font-weight: 700; }
.brand-sub { margin: 0; font-size: 12px; line-height: 16px; color: var(--sub); }
h1 { margin: var(--space-s) 0 var(--space-l); font-size: 22px; line-height: 28px; font-weight: 700; }
h2 { margin: var(--space-l) 0 var(--space-s); font-size: 14px; line-height: 20px; font-weight: 700; color: var(--accent); }
p, ul { margin: 0 0 var(--space-l); }
ul { padding-left: var(--space-xl); }
li + li { margin-top: var(--space-xs); }
a { color: var(--accent); text-underline-offset: 3px; }
a:focus-visible, button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.card {
  background: var(--card); border-radius: var(--radius-card);
  padding: var(--space-l); margin-bottom: var(--space-l);
}
.card > :last-child { margin-bottom: 0; }
.client-name { margin: 0; font-size: 16px; line-height: 24px; font-weight: 700; overflow-wrap: anywhere; }
.client-host { margin: 0 0 var(--space-m); font: 14px/20px var(--mono); color: var(--sub); overflow-wrap: anywhere; }
.body-m { font-size: 14px; line-height: 20px; }
.card .body-m { margin-bottom: 0; }
.note { font-size: 14px; line-height: 20px; color: var(--sub); }
.switch { display: inline-flex; align-items: center; min-height: 48px; font-size: 14px; font-weight: 700; }
.scopes { list-style: none; padding: 0; margin: 0; }
.scopes li { display: flex; gap: var(--space-m); align-items: flex-start; padding: var(--space-m) 0; margin: 0; }
.scopes li + li { border-top: 1px solid var(--line); }
.scopes li:first-child { padding-top: 0; }
.scopes li:last-child { padding-bottom: 0; }
.scopes svg { width: 20px; height: 20px; flex: none; margin-top: 2px; }
.actions { display: flex; flex-direction: column; gap: var(--space-m); margin-top: var(--space-xl); }
button {
  min-height: 56px; padding: 0 var(--space-xl); border-radius: 999px; width: 100%;
  font: 700 16px/24px var(--font); cursor: pointer;
}
button:disabled { opacity: 0.6; cursor: default; }
.allow { background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); }
.deny { background: transparent; color: var(--accent); border: 1px solid var(--outline); }
a.button {
  display: flex; align-items: center; justify-content: center; min-height: 56px; padding: 0 var(--space-xl);
  border-radius: 999px; font: 700 16px/24px var(--font); text-decoration: none;
}
@media (min-width: 640px) {
  main { padding-top: var(--space-xxl); }
  .actions { flex-direction: row-reverse; }
  .actions button { width: auto; flex: 1; }
}
"""

# 同意画面：送ったあとにボタンを押せなくする（2回押し対策）。押したボタンの値を送るため、無効にするのは送信の後
SCRIPT = """
for (const form of document.querySelectorAll("form[data-once]")) {
  form.addEventListener("submit", () => {
    for (const b of form.querySelectorAll("button")) setTimeout(() => { b.disabled = true; });
  });
}
"""


def _sha256(text: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


# 埋め込んだ CSS と JS だけを許し、ほかは読み込ませない。別のサイトへの埋め込みも断る（frame-ancestors）。
# form-action は付けない（/consent は許可のあと redirect_uri へ 303 で戻すので、ブラウザによっては行き先まで絞られて止まる）
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'none'",
    f"style-src {_sha256(STYLE)}",
    f"script-src {_sha256(SCRIPT)}",
    "img-src 'self' data:",
    "base-uri 'none'",
    "frame-ancestors 'none'",
])

# アプリのアイコン（apps/mobile/assets/icon-src/icon.svg の写し）。飾りなので読み上げない
ICON = """<svg viewBox="0 0 1024 1024" aria-hidden="true" focusable="false"><rect width="1024" height="1024" fill="#0E1013"/>\
<g transform="translate(512 512) translate(-570 -512)"><path d="M330 250 V774 M570 250 L350 515 L570 774" \
fill="none" stroke="#5BE49B" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/>\
<path d="M640 610 H672 L712 512 L762 708 L800 610 H836" fill="none" stroke="#5BE49B" stroke-width="40" \
stroke-linecap="round" stroke-linejoin="round"/></g></svg>"""

CHECK = """<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" \
fill="none" stroke="#5BE49B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>"""


def _page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>{html.escape(title)} - KARADA</title>
<style>{STYLE}</style>
</head>
<body>
<main>
<header class="brand">
{ICON}
<div><p class="logo" aria-label="KARADA">KARADA</p><p class="brand-sub">アカウント連携</p></div>
</header>
{body}
</main>
<script>{SCRIPT}</script>
</body>
</html>"""


def render_consent_page(client_name: str, client_host: str, email: str, scopes: list[str]) -> str:
    # client_name はクライアントが自由に書ける値なので、必ずエスケープする。偽の名前に備えてドメインも並べて出す
    items = "".join(f"<li>{CHECK}<span>{html.escape(SCOPE_DESCRIPTIONS.get(s, s))}</span></li>" for s in scopes)
    meals = any(s.startswith("meals:") for s in scopes)
    photo_note = "食事の写真はこのサービスに送られず、保存もしません。" if meals else ""
    return _page("連携の確認", f"""<h1>連携の確認</h1>
<section class="card">
<p class="client-name">{html.escape(client_name)}</p>
<p class="client-host">{html.escape(client_host)}</p>
<p class="body-m">このアプリが、{html.escape(email)} さんの記録について、次のことをできるようにしたいと求めています。</p>
<a class="switch" href="/switch-account">別のアカウントで入り直す</a>
</section>
<h2>できるようになること</h2>
<section class="card"><ul class="scopes">{items}</ul></section>
<p class="note">心当たりのないアプリなら、許可しないでください。{photo_note}詳しくは<a href="/privacy" target="_blank" rel="noopener">プライバシーポリシー</a>をご覧ください。</p>
<form method="post" action="/consent" class="actions" data-once>
<button name="decision" value="allow" class="allow">許可する</button>
<button name="decision" value="deny" class="deny">やめる</button>
</form>""")


def render_privacy_page() -> str:    return _page("プライバシーポリシー", """<h1>プライバシーポリシー</h1>
<p class="note">制定日：2026年10月12日</p>
<p>食事管理（以下「このサービス」）は、OAuth と MCP の仕組みを学ぶために個人が作った勉強用のアプリです。Claude や ChatGPT などのアプリ（以下「連携アプリ」）から、食事記録と筋トレの記録を扱えるようにします。</p>

<h2>集める情報</h2>
<ul>
<li>ログインに使うメールアドレスと、利用者を見分ける ID（Amazon Cognito が発行するもの）</li>
<li>連携アプリの名前と URL、許可した操作の種類</li>
<li>食事記録：食べた日・区分・時刻、品目・量・カロリーと栄養素、食事の説明文</li>
<li>目標：方針（増量・減量・維持）、体重、目標体重、1日の目標、食事の傾向、筋トレの日かどうか</li>
<li>体重の記録：日付と体重</li>
<li>筋トレの記録：日付、種目と部位、セットごとの重量・回数・メモ</li>
<li>体組成の記録：日付と測った時刻、体重・体脂肪率、メモ</li>
<li>目標の計算に使う情報：性別、年齢、身長、普段の活動量、筋トレ1回の時間（計算にだけ使い、保存しません）</li>
</ul>

<h2>写真の扱い</h2>
<p>食事の写真は、このサービスには送られず、保存もしません。写真の解析は連携アプリが行い、このサービスには解析の結果（品目・量・栄養素・説明文）だけが届きます。連携アプリでの写真の扱いは、それぞれのアプリのプライバシーポリシーに従います。</p>

<h2>使い道</h2>
<p>集めた情報は、本人に記録と集計（1日の合計、目標との差、週のふり返り）を返すためだけに使います。広告には使わず、第三者に提供しません。</p>

<h2>保存する場所と期間</h2>
<ul>
<li>保存する場所：Amazon Web Services の東京リージョン</li>
<li>食事記録・目標・体重・筋トレ・体組成の記録：本人が消すまで</li>
<li>連携の途中の情報：最大10分（認可コードは60秒）</li>
<li>連携アプリに渡すアクセストークンの有効期間：5分</li>
<li>連携アプリに渡すリフレッシュトークン（ログインし直さずに連携を続けるためのもの）の有効期間：最後に使ってから30日</li>
</ul>

<h2>記録の削除と連携の解除</h2>
<p>食事記録は、連携アプリから1件ずつ消せます。すべての記録をまとめて消す方法は、今は用意していません。連携をやめるときは、連携アプリでログアウトを頼むか、連携アプリの設定からこのサービスを外してください。</p>

<h2>改定</h2>
<p>このポリシーを変えるときは、このページで知らせます。</p>""")


# アプリ（KARADA）の Android のパッケージ名と、独自の URL（apps/mobile/app.json の android.package と scheme）
APP_PACKAGE = "com.ykitaza.torelog"
APP_SCHEME = "torelog"


def render_open_app_page(target: str, title: str) -> str:
    """チャット（ChatGPT・Claude）の返事のリンクから、アプリへ戻るための案内（/open/...）。

    チャットのアプリの中のブラウザは torelog:// を開けないので、https のこのページを経由し、
    押したときに Android へ「KARADA を開いて」と頼む（intent://。人が押したときだけ通ることが多いので、自動では飛ばさない）。
    target は呼ぶ側で決まった値（画面の名前と日付）だけにしたもの。記録は読まない
    """
    href = f"intent://{target}#Intent;scheme={APP_SCHEME};package={APP_PACKAGE};end"
    return _page(title, f"""<h1>KARADA に戻る</h1>
<section class="card"><p class="body-m">{html.escape(title)}を、KARADA のアプリで開きます。</p></section>
<div class="actions"><a class="button allow" href="{html.escape(href)}">KARADA で開く</a></div>
<p class="note">押しても開かないときは、このページを Chrome で開いてから押してください。</p>""")


def render_logged_out_page() -> str:
    return _page("ログアウトしました", """<h1>ログアウトしました</h1>
<section class="card"><p>このブラウザのログインを終了しました。
連携アプリ（Claude・ChatGPT）でもう一度使うと、ログイン画面が表示されます。このページは閉じて構いません。</p></section>""")


def render_error_page(description: str) -> str:
    return _page("エラー", f"""<h1>連携を続けられません</h1>
<section class="card"><p>{html.escape(description)}</p></section>""")
