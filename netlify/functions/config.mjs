// 画面側に公開してよい設定だけを返す（GoogleのクライアントIDは公開されても問題ない値）
export default async () =>
  new Response(JSON.stringify({ googleClientId: Netlify.env.get('GOOGLE_CLIENT_ID') || '' }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const config = { path: '/api/config' };
