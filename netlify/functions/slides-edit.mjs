// 音声の編集指示を DeepSeek に解釈させ、Google Slides API の batchUpdate リクエストに変換する
// 実際の書き換えはブラウザがユーザー本人のGoogleトークンで行う（トークンはこのサーバーに来ない）
// 環境変数: DEEPSEEK_API_KEY（必須）, DEEPSEEK_MODEL（任意）, APP_PASSCODE（任意）

// 許可する操作（これ以外はサーバーとブラウザの両方で捨てる）
export const ALLOWED = [
  'insertText', 'deleteText', 'replaceAllText', 'createSlide', 'deleteObject', 'duplicateObject',
  'updateSlidesPosition', 'updateTextStyle', 'updateParagraphStyle', 'createShape',
];

const SYSTEM = `あなたは Google スライドを音声で編集するアシスタントです。
ユーザーの指示と、プレゼンの構造（各スライドの objectId、要素の objectId・種類・テキスト）を受け取り、
Google Slides API の presentations.batchUpdate に渡す requests 配列を作ります。

出力は次の形式のJSONだけ：
{"requests": [ ... ], "say": "実行内容を伝える短い日本語（読み上げ用）"}
指示がスライド編集ではない、または対象が特定できないときは {"requests": [], "say": "理由を短く"} を返す。

使ってよい操作：insertText, deleteText, replaceAllText, createSlide, deleteObject, duplicateObject,
updateSlidesPosition, updateTextStyle, updateParagraphStyle, createShape のみ。

ルール：
- objectId は必ず与えられた構造に存在するものを使う。存在しないIDを作らない（新規作成する物を除く）。
- 「3枚目」はスライド一覧の3番目（index=3）。「このスライド」は現在のページ。
- テキストを置き換えるときは deleteText（textRange: {"type":"ALL"}）→ insertText（insertionIndex: 0）の順。
  ただし要素のテキストが空のときは deleteText を入れない（エラーになるため）。
- 「タイトル」は placeholder が TITLE または CENTERED_TITLE の要素、「本文」は BODY または SUBTITLE の要素。
- 新しいスライドは createSlide を使い、slideLayoutReference.predefinedLayout に TITLE_AND_BODY などを指定。
  文字を入れるなら placeholderIdMappings で新しい objectId（"ws_" で始まる英数字10文字以上）を割り当て、
  続けて insertText でその objectId に書き込む。
- 文字の色は updateTextStyle の style.foregroundColor.opaqueColor.rgbColor（0〜1の red/green/blue）と fields を指定。
- 文字の大きさは style.fontSize: {"magnitude": 数値, "unit": "PT"}、太字は style.bold。fields を忘れない。
- スライドの並べ替えは updateSlidesPosition（slideObjectIds と insertionIndex は0始まり）。
- 削除は deleteObject。プレゼン全体を消すような極端な指示は requests を空にして断る。
- say には「3枚目のタイトルを『売上報告』に変えました」のように結果を一言で入れる。
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
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 400) : '';
  const page = Number(body?.page) || 1;
  const deck = body?.deck;
  if (!text) return json(400, { error: '指示が空です' });
  if (!deck || !Array.isArray(deck.slides)) return json(400, { error: 'スライドの構造がありません' });

  const structure = JSON.stringify({
    title: String(deck.title || '').slice(0, 100),
    currentPage: page,
    slides: deck.slides.slice(0, 60).map((s) => ({
      index: Number(s.index),
      objectId: String(s.objectId),
      elements: (Array.isArray(s.elements) ? s.elements : []).slice(0, 25).map((e) => ({
        objectId: String(e.objectId),
        kind: String(e.kind || ''),
        placeholder: e.placeholder ? String(e.placeholder) : undefined,
        text: String(e.text || '').slice(0, 200),
      })),
    })),
  });

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Netlify.env.get('DEEPSEEK_MODEL') || 'deepseek-flash',
        max_tokens: 1500,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `プレゼンの構造:\n${structure}\n\n指示:「${text}」` },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) return json(502, { error: data?.error?.message || 'AIの呼び出しに失敗しました' });

    let plan;
    try { plan = JSON.parse(data?.choices?.[0]?.message?.content || '{}'); } catch { plan = {}; }
    const requests = (Array.isArray(plan.requests) ? plan.requests : [])
      .filter((q) => q && typeof q === 'object' && Object.keys(q).length === 1 && ALLOWED.includes(Object.keys(q)[0]))
      .slice(0, 40);
    const say = typeof plan.say === 'string' ? plan.say.trim().slice(0, 200) : '';
    return json(200, { requests, say });
  } catch {
    return json(502, { error: 'AIに接続できませんでした' });
  }
};

export const config = { path: '/api/slides-edit' };
