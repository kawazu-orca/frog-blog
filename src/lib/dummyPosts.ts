export interface DummyPost {
	slug: string;
	title: string;
	excerpt: string;
	content: string;
}

export const dummyPosts: DummyPost[] = [
	{
		slug: "first-post",
		title: "ダミー記事 1: 数学メモ",
		excerpt: "定義と例を使って、記事カード表示の見た目を確認するためのダミーです。",
		content:
			"これはダミー本文です。定義・定理・例などの装飾をあとで追加する前提で、まずは基本的な投稿ページのルーティングを確認します。",
	},
	{
		slug: "second-post",
		title: "ダミー記事 2: 技術ノート",
		excerpt: "Notion からのデータ連携前に、一覧と詳細ページの構造を先に整備します。",
		content:
			"この記事はダミーです。将来的には Notion API から取得した本文をブロック単位でレンダリングして表示します。",
	},
	{
		slug: "third-post",
		title: "ダミー記事 3: 日常ログ",
		excerpt: "軽い文章のサンプルとして、本文ページでの段落表示を確認できます。",
		content:
			"今日はブログの雛形を整える日。トップページに記事一覧を出して、スラッグごとの詳細ページへ遷移できる状態を作りました。",
	},
];
