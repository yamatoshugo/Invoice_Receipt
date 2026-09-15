# デプロイ手順（Vercel）

初回デプロイの手順書。**上から順にやれば動く**ように書いてある。
所要はおよそ1〜2時間（Googleの画面遷移が多いのと、待ち時間があるため）。

> **先に知っておくこと**
> - 必要なアカウントは **Vercel（Pro・有料） / Neon / Vercel Blob / Google OAuth（ログイン用）** の4つ。
>   どれか1つでも欠けると画面に入れない
> - **本番URLが決まらないと設定できない項目がある**ので、
>   「一度デプロイ → URLが決まる → 設定を足して再デプロイ」という順番になる
> - 銀行の値（振込依頼人コード等）が無くてもデプロイ自体はできる。
>   ただし**CSV出力だけは、その値を入れるまで使えない**

---

## 0. 事前に手元で作っておくもの

あとで貼り付けるので、先に作ってメモ帳に控えておく。

```bash
# 1) セッションの署名鍵
openssl rand -base64 32

# 2) Gmailトークンの暗号化鍵（上とは別の値にする）
openssl rand -base64 32
```

Windowsで `openssl` が無ければ PowerShell で:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

| メモする名前 | 用途 |
|---|---|
| `AUTH_SECRET` | ログインセッションの署名鍵 |
| `GMAIL_TOKEN_KEY` | Gmailのリフレッシュトークンを暗号化する鍵 |

**2つは必ず別の値にする。** `AUTH_SECRET` の入れ替えは「全員ログアウトするだけ」の
安全な操作だが、同じ鍵にするとその副作用で**Gmail連携が無言で壊れる**ため。

---

## 1. Neon（データベース）を作る

1. https://neon.tech にGoogleアカウントでサインアップ
2. **Create project**
   - Project name: `invoice-receipt`
   - Postgres version: 既定のまま
   - Region: **日本から近いもの**（Tokyo があれば Tokyo、無ければ Singapore）
3. 作成後に表示される接続文字列を**2種類**コピーする（Connection Details の画面）
   - **Pooled connection** … ホスト名に `-pooler` が入っているほう → `DATABASE_URL`
   - **Direct connection** … `-pooler` が入っていないほう → `DIRECT_URL`
   - どちらも末尾が `?sslmode=require` になっていること

> 2種類に分けるのは、**プール経由だとマイグレーション（テーブル作成）が通らないことがある**ため。
> 実行時はプール、テーブル作成は直結、と使い分ける。

---

## 2. Vercel（ホスティング）を用意する

1. https://vercel.com にGitHubアカウントでサインアップ
2. **Settings → Billing** から **Pro プラン**にアップグレード
   - **必須**。請求書の読み取りに10〜40秒かかり、無料プランは10秒で強制終了されるため
3. **Add New → Project** → GitHubの `yamatoshugo/Invoice_Receipt` を **Import**
4. 設定画面が出るが、**この時点では「Deploy」を押さない**。先に環境変数を入れる（次の手順）
   - Framework Preset が `Next.js` になっていることだけ確認する
   - Build Command / Output Directory は**触らない**（`vercel-build` が自動で使われる）

---

## 3. Vercel Blob（PDFの保管先）を作る

1. Vercelのプロジェクト画面 → **Storage** タブ → **Create Database** → **Blob**
2. 名前は `invoice-pdfs` など。**Connect to Project** で今のプロジェクトに接続する
3. 接続すると `BLOB_READ_WRITE_TOKEN` が**自動で環境変数に入る**（手で入力しなくてよい）

---

## 4. ログイン用の Google OAuth クライアントを作る

**★Gmail取り込み用とは別のGCPプロジェクトに作ること。**
「内部(Internal)」はクライアント単位ではなく**プロジェクト単位**の設定なので、共有すると
`ALLOWED_EMAILS` に組織外のアドレスを入れた瞬間にログインが壊れる。

1. https://console.cloud.google.com で**新しいプロジェクトを作成**（例: `invoice-receipt-login`）
2. 左メニュー **APIとサービス → OAuth同意画面**
   - User Type: **内部**（Workspace組織なので選べる）
   - アプリ名: `請求書一括振込`／サポートメール: 自分のアドレス
   - スコープは**追加しない**（メールアドレスと氏名だけで足りる）
3. **APIとサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 名前: `invoice-receipt-web`
   - **承認済みのリダイレクト URI**: いまは空のままでよい（手順6で本番URLを登録する）
4. 作成後に表示される **クライアントID** と **クライアントシークレット**を控える

---

## 5. Vercelに環境変数を入れて、1回目のデプロイ

Vercelのプロジェクト → **Settings → Environment Variables** で以下を追加する。
**Environment は `Production` だけにチェックを入れる**（Preview/Development には入れない）。

| 変数名 | 値 |
|---|---|
| `DATABASE_URL` | Neonの **Pooled** 接続文字列 |
| `DIRECT_URL` | Neonの **Direct** 接続文字列 |
| `AUTH_SECRET` | 手順0で作った1つ目 |
| `AUTH_GOOGLE_ID` | 手順4のクライアントID |
| `AUTH_GOOGLE_SECRET` | 手順4のクライアントシークレット |
| `ALLOWED_EMAILS` | ログインを許可するアドレス（カンマ区切り）例: `henry@meetingtechnology.co.jp` |
| `ANTHROPIC_API_KEY` | Anthropicのキー（**本番用に作り直したもの**） |
| `GMAIL_CLIENT_ID` | Gmail取り込み用（ローカルの `.env` と同じ値） |
| `GMAIL_CLIENT_SECRET` | 同上 |
| `GMAIL_TOKEN_KEY` | 手順0で作った2つ目 |
| `APP_BASE_URL` | **いまは仮で `https://example.com`**（手順6で本物に直す） |

> **絶対に入れてはいけない3つ**: `AUTH_DEV_LOGIN` / `STORAGE` / `EXTRACTOR`
> - `AUTH_DEV_LOGIN` … メールアドレスだけで誰でもログインできてしまう
> - `STORAGE` … PDFの保管先がサーバー上の一時領域になり、消える
> - `EXTRACTOR` … **偽の口座情報が振込CSVに載る**。本番では起動時にエラーで止まるようにしてある

入れ終わったら **Deployments → Deploy**（または Import 画面の Deploy）を押す。

- ビルド中に `prisma migrate deploy` が走り、**Neonにテーブルが自動で作られる**
- 3〜5分で完了し、`https://invoice-receipt-xxxx.vercel.app` のようなURLが発行される
- **このURLを控える**（次で使う）

---

## 6. 本番URLを各所に登録して、2回目のデプロイ

URLが決まったので、3か所に登録する。`<本番URL>` は手順5で発行されたもの。

### 6-1. Vercelの環境変数を直す

`APP_BASE_URL` を仮の値から **`<本番URL>`** に変更する（末尾のスラッシュは付けない）。

### 6-2. ログイン用のGoogle OAuth（手順4のプロジェクト）

**認証情報 → 作成したクライアント → 承認済みのリダイレクト URI** に追加:

```
<本番URL>/api/auth/callback/google
```

### 6-3. Gmail取り込み用のGoogle OAuth（既存のプロジェクト）

同じく**承認済みのリダイレクト URI** に追加（ローカル用の行は消さない）:

```
<本番URL>/api/gmail/callback
```

### 6-4. 再デプロイ

Vercel → **Deployments** → 最新の行の「…」→ **Redeploy**。
環境変数の変更は再デプロイしないと反映されない。

---

## 7. 本番で動かして確認する

`<本番URL>` を開いて、上から順に確認する。

1. **ログインできる** — Googleのログイン画面が出て、`ALLOWED_EMAILS` のアドレスで入れる
   - 許可リストに無いアドレスでは入れないことも1回試す
2. **設定 → Gmail連携 → 「Gmailを接続する」** を押し、`seikyusho@meetingtechnology.co.jp` で認可する
   - **ローカルの接続は本番には引き継がれない**（接続情報はDBにあり、本番DBは空のため）
   - 権限が「読み取り・送信（gmail.readonly / gmail.send）」と表示されればOK
3. **設定 → 振込依頼人** に銀行の4つの値を入れて保存（未入手ならここは後回しでよい）
4. **取り込み → アップロード経由** にPDFを1通ドラッグ&ドロップ
   - **これが本番でVercel Blobを使う最初の確認**になる。読み取りに10〜40秒かかる
   - 完了して請求書一覧に出れば、Blob・Claude・DBの3つが本番で通ったことになる
5. **取り込み → メール経由** で期間を指定して取り込む
6. 請求書を1件承認 → **CSV出力**（銀行の値を入れてある場合）

---

## 8. 運用を始める前に残っていること

| 作業 | 誰が |
|---|---|
| **銀行実機でCSVの受付確認**（受付内容確認画面まで／確定せず破棄） | 依頼者 |
| **自社別口座宛に1円×2件の実振込テスト** | 依頼者 |
| Anthropic APIキーのローテーション（まだなら） | 依頼者 |

**この2つのテストが本番稼働前の必須ゲート。**
CSVは仕様書のサンプルとバイト単位で一致させてあるが、それは
「仕様書の解釈が合っている」ことの証明にはならない。実機に通すまで分からない。

---

## 困ったときの見どころ

| 症状 | 原因と対処 |
|---|---|
| ビルドが `Environment variable not found: DATABASE_URL` で落ちる | 環境変数の Environment に `Production` のチェックが入っていない |
| ビルドが `P1001 Can't reach database server` で落ちる | `DIRECT_URL` がプール側（`-pooler` 入り）になっている。直結のほうに直す |
| ログインで `redirect_uri_mismatch` | 手順6-2のURIが1文字でも違う。`https`・末尾スラッシュ無し・パスまで完全一致か確認 |
| Gmail接続で `redirect_uri_mismatch` | 手順6-3のURI、または `APP_BASE_URL` が本番URLになっていない |
| 取り込みが10秒前後で失敗する | Vercelが無料プランのまま。Proでないと `maxDuration = 300` が効かない |
| PDFのプレビューが開けない | Blobストアがプロジェクトに接続されていない（`BLOB_READ_WRITE_TOKEN` が無い） |
| 「読み取りに失敗しました」が全件で出る | `ANTHROPIC_API_KEY` が未設定・失効・残高切れのいずれか |

Preview環境（`git push` のたびに作られる）は、環境変数を入れていないのでビルドに失敗する。
**それで正しい。** 使いたい場合は、Neonで**別ブランチのDB**を作ってPreview用に割り当てること。
**本番DBをPreviewに繋いではいけない。**
