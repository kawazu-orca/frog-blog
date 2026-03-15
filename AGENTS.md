# frog-blog

Notion で書いた記事を、装飾（コールアウト・トグル等）をほぼそのまま維持した
ブログサイトとして公開するプロジェクト。
記事のジャンルは数学に限らず、技術・思考・日常など幅広いテーマを扱う。
数学記事では KaTeX による数式表示とコールアウト絵文字による
定義/定理ボックスの自動切替をサポートする。

## 技術スタック

- フレームワーク: Astro (SSG モード)
- 言語: TypeScript (Strict)
- 数式: KaTeX
- CMS: Notion API（記事DB から Status=Published のページを取得）
- デプロイ: Cloudflare Pages（GitHub 連携で自動デプロイ）

## ディレクトリ構成

    src/
      pages/          # ルーティング（index.astro, posts/[slug].astro, tags/[tag].astro）
      layouts/        # 共通レイアウト（BaseLayout.astro）
      components/     # 再利用コンポーネント
      lib/            # Notion API クライアント、ブロック→HTML レンダラー
      styles/         # グローバル CSS、コールアウトボックス CSS
    public/           # 静的ファイル（favicon 等）

## コーディング規約

- TypeScript を使用し、any は禁止
- ESLint + Prettier でフォーマット統一
- コンポーネントは .astro ファイル、ロジックは .ts ファイルに分離
- 環境変数は .env から読み込み、ハードコードしない
- インポートパスは src/ からの相対パスまたはエイリアス @/ を使用

## Notion API 利用方針

- @notionhq/client を使用
- 記事DB から Status=Published のページ一覧を取得
- 個別ページのブロックは再帰的に取得（子ブロック含む）
- APIキーと DB ID は .env に保存（NOTION_API_KEY, NOTION_DATABASE_ID）

## コールアウト絵文字 → CSS クラス マッピング（数学記事用）

コールアウトブロックの icon.emoji に応じて CSS クラスを付与する:

- 📘 → callout-definition（定義）
- ⭐ → callout-theorem（定理）
- 🧩 → callout-lemma（補題）
- 🔁 → callout-corollary（系）
- 💡 → callout-example（例）
- ⚠️ → callout-warning（注意）
- 🧠 → callout-intuition（直感）
- ✅ → callout-summary（まとめ）

上記以外の絵文字はデフォルトのコールアウトスタイルを適用する。

## 注意事項

- .env は .gitignore に含め、絶対にコミットしない
- 画像は Notion の一時 URL ではなく、ビルド時にダウンロードして public/ に保存する
- 数式はインライン（$...$）とブロック（$$...$$）の両方に対応する