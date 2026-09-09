# 請求書一括振込システム

請求書PDFをまとめて取り込み、内容を確認・承認したうえで、
**ドコモSMTBネット銀行の総合振込CSV（Shift_JIS）** を出力するツール。

MVPの範囲は「PDFをドラッグ&ドロップ → 自動読み取り → 画面で確認・修正 → 承認 → CSVダウンロード」まで。
Gmailからの自動取り込みと取引先マスタは第2弾。

> **開発を再開するときは [docs/PROGRESS.md](docs/PROGRESS.md) を先に読むこと。**
> 進捗・技術判断の理由・踏んだ罠・次にやることをまとめている。

---

## 使い方（月末の流れ）

1. **設定** — 初回のみ。銀行から取得した振込依頼人コード等を登録する
2. **取り込み** — Gmailで請求書メールの添付PDFをまとめてダウンロードし、画面にドラッグ&ドロップ
3. **請求書一覧** — 1件ずつ開き、PDFと読み取り結果を突き合わせて修正 → 「承認」または「今回は振り込まない」
4. **CSV出力** — 取組日を選び、検証エラーがなければCSVをダウンロード
5. ネットバンキングの ［資金移動 ≫ 振込ファイルによる新規作成］ でアップロード
6. 振込が終わったら出力履歴の「振込済みにする」を押す

---

## ローカルで動かす（デプロイ前の動作確認）

Google Cloud / Vercel Blob / Neon の登録なしで、この4ステップで一通り操作できます。
外部サービスを使う本番の経路はそのまま残してあり、環境変数で切り替えているだけです。

```bash
docker compose up -d          # ローカルPostgres（ホスト側ポート 55432）
cp .env.example .env          # 下記の3行を有効にする
npx prisma migrate dev        # テーブルを作成
npm run dev                   # http://localhost:3000
```

`.env` で有効にする行:

```
DATABASE_URL="postgresql://invoice:invoice@localhost:55432/invoice?schema=public"
AUTH_SECRET="..."             # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ALLOWED_EMAILS="あなたのメールアドレス"
AUTH_DEV_LOGIN="1"            # メールアドレスだけでログインできる簡易ログイン
STORAGE="local"               # PDFを .uploads/ に保存する（Vercel Blob を使わない）
EXTRACTOR="stub"              # PDFを読まずダミーの読み取り結果を返す
```

`/signin` に「開発用ログイン」が出るので、`ALLOWED_EMAILS` に入れたアドレスでログインします。

| 変数 | 役割 | 本番との違い |
|---|---|---|
| `AUTH_DEV_LOGIN` | メールアドレスだけでログイン | **`NODE_ENV=production` では立てても無効**（`src/auth.ts` で二重にガード） |
| `STORAGE=local` | PDFを `.uploads/` に保存 | 本番はブラウザから Vercel Blob へ直接アップロード |
| `EXTRACTOR=stub` | ダミーの読み取り結果 | **本番で指定すると起動時に例外**。偽の口座がCSVに載るのを防ぐため |

`ANTHROPIC_API_KEY` を設定して `EXTRACTOR` の行を消すと、実際の請求書PDFで読み取り精度を確認できます。

投入するPDFが手元に無ければ、`node scripts/make-sample-pdfs.mjs` で `samples/` にサンプルを3通作れます
（中身は読まれないので `EXTRACTOR=stub` のときだけ意味があります）。

`docker compose down -v` でDBを初期化できます。

---

## セットアップ

### 1. 必要な外部サービス

| 環境変数 | 取得先 |
|---|---|
| `DATABASE_URL` | [Neon](https://neon.tech) で Postgres を作成し接続文字列を取得 |
| `AUTH_SECRET` | `openssl rand -base64 32` で生成 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud Console → 認証情報 → OAuth 2.0 クライアントID（種類: ウェブアプリケーション）<br>リダイレクトURI: `http://localhost:3000/api/auth/callback/google` と本番URLの同パス |
| `ALLOWED_EMAILS` | このシステムを使う人のGoogleアカウントをカンマ区切りで列挙 |
| `BLOB_READ_WRITE_TOKEN` | Vercel ダッシュボード → Storage → Blob ストアを作成 |
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com) |

> `ALLOWED_EMAILS` が空の場合、**誰もログインできません**。
> 未設定のまま公開して全員が入れてしまう事故を防ぐための挙動です。

### 2. 起動

```bash
cp .env.example .env    # 値を埋める
npm install
npx prisma migrate dev  # DBにテーブルを作成
npm run dev
```

### 3. 銀行から取得しておく値（設定画面で入力）

ネットバンキングの ［資金移動 ≫ 振込データの新規作成］ 画面で確認できる。

- 振込依頼人コード（委託者コード）— 「20」ではじまる10桁
- 振込依頼人名 — 銀行に届け出ている名義
- 仕向支店番号（3桁）／依頼人口座番号（7桁）

---

## Vercelへのデプロイ

- **Vercel Pro が必要。** 読み取りは1件10〜40秒かかるため、
  `/api/invoices` で `maxDuration = 300` を使っている（Hobbyでは足りない）
- 環境変数を Production / Preview 双方に設定する。
  **Preview環境には本番DBを繋がないこと**（テスト操作が本番データを壊すため）
- ビルドコマンドは `npm run build`（`prisma generate` を含む）

---

## 設計上の要点

### 二重振込を防ぐ仕組み

金銭事故に直結するため、機能を削っても以下は落とさない。

| 仕組み | 実装場所 |
|---|---|
| 同一PDFの二重取込を弾く（SHA-256の一意制約） | [route.ts](src/app/api/invoices/route.ts) — ハッシュはクライアント申告を信用せずサーバーが実体から計算する |
| 人が承認するまでCSVに載らない | 取り込み直後は必ず `NEEDS_REVIEW` |
| 出力済みは再出力・編集できない | [actions.ts](src/app/actions.ts) / [export/route.ts](src/app/api/export/route.ts) |
| 1件でも検証エラーがあればCSVを生成しない | [csv.ts](src/lib/zengin/csv.ts) |
| 同一口座・同一金額の重複を警告 | [export.ts](src/lib/export.ts) |

### 全銀フォーマットの半角カナ変換

受取人名は**半角カタカナ・英大文字・数字・一部記号**しか使えない。
誤ると銀行で受付エラーか振込不着になるため、[kana.ts](src/lib/zengin/kana.ts) に切り出して単体テストで固めている。

- 濁点・半濁点は分離され**2文字を消費する**（`ガ` → `ｶ` + `ﾞ`）
- 小書き文字は大書きに（`キャノン` → `ｷﾔﾉﾝ`）
- 法人格は位置で表記が変わる（前株 `ｶ)ｻﾝﾌﾟﾙ` / 後株 `ｻﾝﾌﾟﾙ(ｶ` / 中間 `(ｶ)`）
- **カンマと円記号は意図的に使用不可**にしている
  — カンマはCSVの区切りと衝突し、円記号はShift_JISで `0x5C` と曖昧なため
- 漢字が残るなど変換できない文字があれば `ok: false` を返し、**CSV出力をブロックする**

### CSVフォーマット

[仕様書PDF](https://www.netbk.co.jp/contents/resources/pdf/doc_soufuri_furikomicsv.pdf) に準拠。
Shift_JIS・CRLF・全項目半角。ヘッダー(1) → データ(2)×n → トレーラ(8) → エンド(9)。

仕様書に載っている出力例と**バイト単位で一致する**ゴールデンテストを
[csv.test.ts](src/lib/zengin/csv.test.ts) に置いている。フォーマットを触ったらここが壊れる。

### MVPで対応していないもの

- **Gmail自動取り込み** — 手動でダウンロードしてドラッグ&ドロップする
- **URL型の請求書** — サービス側でログインが必要なため自動取得できない。人がDLして投入する
- **取引先マスタ・口座変更の検知** — 毎回PDFの口座を人が目視確認する運用でカバーする
- **ゆうちょ銀行** — 「記号-番号」は振込用の店番・口座番号への変換が必要。
  読み取り時に検出してメモに残すが、変換はしない。当面は手動振込に回す
- **監査ログ** — 最終更新者のみ記録している

---

## 開発

```bash
npm run dev        # 開発サーバー
npm test           # 単体テスト（半角カナ変換・CSV生成・営業日判定）
npm run typecheck  # 型チェック
npm run build      # 本番ビルド
npm run db:studio  # DBの中身をブラウザで見る
```

### 本番稼働前に必ず通すゲート

1. 生成したCSVをネットバンキングにアップロードし、
   **受付内容確認画面で件数・合計金額・受取人名が正しく表示されるところまで確認**（確定せずに破棄）
2. 自社の別口座宛に **1円×2件で実振込を1回**実行し、着金と受取人名の表示を確認
3. 初月は従来の手作業と並行し、振込リストを目視で突き合わせる
