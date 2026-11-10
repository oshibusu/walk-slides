// 「リンクを知っている全員」に共有されたGoogleスライドをPDFとして取得して返す

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(id)) return json(400, { error: 'GoogleスライドのURLが正しくありません' });
  try {
    const r = await fetch(`https://docs.google.com/presentation/d/${id}/export/pdf`, { redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.includes('pdf')) {
      return json(400, { error: 'スライドを取得できません。Googleスライドの共有設定を「リンクを知っている全員」にしてください' });
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 4_000_000) {
      return json(413, { error: 'スライドが大きすぎて中継できません（約4MBまで）。PDFでダウンロードして、ファイルから読み込んでください' });
    }
    return new Response(buf, { status: 200, headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  } catch {
    return json(502, { error: 'Googleに接続できませんでした' });
  }
};

export const config = { path: '/api/slides' };
