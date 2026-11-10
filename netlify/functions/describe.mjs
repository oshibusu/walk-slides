// 外カメラの画像をAIに送り、進行方向の状況を短い日本語で返す
// DeepSeek（OpenAI互換API）を使用
// 環境変数: DEEPSEEK_API_KEY（必須）, APP_PASSCODE（任意）, DEEPSEEK_MODEL（任意・既定 deepseek-flash）

const SYSTEM = [
  'あなたは、スマホを見ながら歩いている人の安全を補助するアシスタントです。',
  '画像は歩行者の進行方向を写した外カメラの映像です。',
  '段差、障害物、人、自転車、車、信号、工事、濡れた路面など、ぶつかったり転んだりする危険を最優先で伝えてください。',
  '位置は「左」「正面」「右」、距離は「すぐ近く」「数メートル先」「遠く」のように添えてください。',
  '回答は音声で読み上げられるので、記号や箇条書きを使わず、日本語で2〜3文に収めてください。',
  '画像から確信が持てないことは断定せず、危険がなければ短く「特に危険は見当たりません」と答えてください。',
].join('');

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POSTのみ受け付けます' });

  const passcode = Netlify.env.get("APP_PASSCODE");
  if (passcode && req.headers.get('x-app-passcode') !== passcode) {
    return json(401, { error: '合言葉が違います。メニューで合言葉を入力してください' });
  }
  const apiKey = Netlify.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) return json(500, { error: 'サーバーにAPIキーが設定されていません' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'リクエストが正しくありません' }); }
  const { image, question, detections } = body || {};
  if (typeof image !== 'string' || image.length < 100 || image.length > 3_000_000) {
    return json(400, { error: '画像データが正しくありません' });
  }
  const q = typeof question === 'string' && question.trim()
    ? question.trim().slice(0, 300)
    : '進行方向の状況と、注意すべき点を教えてください。';
  const hint = Array.isArray(detections) && detections.length
    ? `\n（参考：端末側の簡易AIは次を検出しています：${detections.slice(0, 10).join('、')}）`
    : '';

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Netlify.env.get("DEEPSEEK_MODEL") || 'deepseek-flash',
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'low' } },
              { type: 'text', text: q + hint },
            ],
          },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) return json(502, { error: data?.error?.message || 'AIの呼び出しに失敗しました' });
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    return json(200, { text: text || '回答を取得できませんでした' });
  } catch {
    return json(502, { error: 'AIに接続できませんでした' });
  }
};

export const config = { path: '/api/describe' };
