// 音声で言われた言葉を DeepSeek に解釈させ、スライド操作のコマンド（JSON）に変換する
// 例：「グラフのスライドに戻って」→ {"action":"goto","page":4}
// 環境変数: DEEPSEEK_API_KEY（必須）, DEEPSEEK_MODEL（任意・既定 deepseek-flash）, APP_PASSCODE（任意）

const ACTIONS = ['next', 'prev', 'goto', 'first', 'last', 'say', 'none'];

const SYSTEM = `あなたはスライド発表アプリの音声コマンド解釈係です。
ユーザーの発話と、各スライドから抜き出したテキストを受け取り、実行すべき操作をJSONで1つだけ返します。

返すJSONの形式：
{"action": "next" | "prev" | "goto" | "first" | "last" | "say" | "none", "page": 数値（gotoのときだけ）, "say": "読み上げる短い日本語"}

ルール：
- 「次」「進めて」→ next。「前」「戻って」→ prev。「3つ戻って」のような相対移動は、現在のページから計算して goto。
- 「グラフのスライド」「まとめのページ」のように内容で指定されたら、スライドのテキストから最も合うページを選んで goto。
- 「このスライド何書いてある？」「次のスライドは？」のような質問には action を say にして、スライドのテキストを元に2文以内で答える。
- スライド操作と関係ない発話（独り言、発表の練習で話している内容など）は必ず none。迷ったら none。
- gotoやnext/prevのときも、say に「4枚目、売上グラフに移動します」のような短い確認を入れる。
- JSON以外は出力しない。`;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POSTのみ受け付けます' });

  const passcode = Netlify.env.get('APP_PASSCODE');
  if (passcode && req.headers.get('x-app-passcode') !== passcode) {
    return json(401, { error: '合言葉が違います。メニューで合言葉を入力してください' });
  }
  const apiKey = Netlify.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) return json(500, { error: 'サーバーにAPIキーが設定されていません' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'リクエストが正しくありません' }); }
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 300) : '';
  const page = Number(body?.page) || 1;
  const total = Number(body?.total) || 0;
  const slides = Array.isArray(body?.slides) ? body.slides.slice(0, 80) : [];
  if (!text) return json(400, { error: '発話が空です' });

  const slideList = slides
    .map((s) => `${Number(s.n)}枚目: ${String(s.text || '').replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n');
  const user = `現在のページ: ${page} / ${total}\n\nスライドのテキスト:\n${slideList || '（スライド未読み込み）'}\n\n発話:「${text}」`;

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Netlify.env.get('DEEPSEEK_MODEL') || 'deepseek-flash',
        max_tokens: 200,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) return json(502, { error: data?.error?.message || 'AIの呼び出しに失敗しました' });

    let cmd;
    try { cmd = JSON.parse(data?.choices?.[0]?.message?.content || '{}'); } catch { cmd = {}; }
    const action = ACTIONS.includes(cmd.action) ? cmd.action : 'none';
    const out = { action };
    if (action === 'goto') {
      const p = Math.round(Number(cmd.page));
      if (!p || p < 1 || (total && p > total)) return json(200, { action: 'none' });
      out.page = p;
    }
    if (typeof cmd.say === 'string' && cmd.say.trim()) out.say = cmd.say.trim().slice(0, 200);
    return json(200, out);
  } catch {
    return json(502, { error: 'AIに接続できませんでした' });
  }
};

export const config = { path: '/api/command' };
