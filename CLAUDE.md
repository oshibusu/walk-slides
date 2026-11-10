# 歩きスライド（walk-slides）— AIエージェント向けメモ

歩きながらスマホでスライドを声・口パク・タップでめくり、外カメラで前方の危険を検出して画面と音で知らせるWebアプリ。

## 構成
- `index.html` … アプリ本体（HTML/CSS/JSを1ファイルに。ビルド不要）
  - スライド表示：pdf.js（PDFを表示。Googleスライドは `/api/slides` 経由でPDF化）
  - 危険検出：YOLO11（`models/*.onnx`）を onnxruntime-web で実行。WebGPU → 使えなければ WASM
  - 誤検出対策：確信度しきい値（既定60%）＋ `CONFIRM` フレーム連続で検出したときだけ警告
  - 音声入力：Web Speech API（ja-JP）。コマンドは `handleCommand()`
  - 口パク：MediaPipe Face Landmarker の blendshape（jawOpen=次へ / mouthPucker=前へ）
- `netlify/functions/describe.mjs` … 画像を DeepSeek（OpenAI互換 `/chat/completions`）に送って前方を説明
- `netlify/functions/command.mjs` … 「グラフのスライドに戻って」など自然な発話を DeepSeek で解釈し、スライド操作（JSON）に変換
  - 短い定型コマンド（次／前／5枚目）は端末内で即実行し、スライド関連の言葉を含む発話だけAIへ送る（`handleCommand()` の `SLIDE_WORDS`）
- `netlify/functions/slides.mjs` … 共有Googleスライドを PDF で取得して中継
- `models/yolo11s.onnx`, `models/yolo11n.onnx` … Ultralytics YOLO11 を imgsz=640, opset17 で書き出したもの（出力 [1,84,8400]）

## デプロイ
- Netlify プロジェクト `walk-slides`（https://walk-slides.netlify.app）。main への push で自動デプロイ。
- 環境変数（Netlifyの管理画面で設定。コードやリポジトリに書かない）
  - `DEEPSEEK_API_KEY`（必須）, `DEEPSEEK_MODEL`（任意・既定 deepseek-flash）, `APP_PASSCODE`（任意）
- サイトは Netlify のチームログインで保護されている。

## ルール
- APIキーなどの秘密情報をコミットしない。
- 危険検出はリアルタイム性が最優先。毎フレームのクラウドAPI呼び出しは入れない。
- UIの文言は日本語。スマホ縦持ち／横持ちの両方で崩れないこと。
- カメラ・マイクは https でしか動かない。手元確認は `npx netlify dev`。
- YOLO の重み（Ultralytics）は AGPL-3.0。商用で配布する場合はライセンスに注意。
