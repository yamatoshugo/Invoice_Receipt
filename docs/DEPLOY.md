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

## 0. 事前に手元で作っておくもの — 鍵を2つ

**鍵はどこかに申請して発行してもらうものではない。自分のPCで乱数を作るだけ。**
アカウント登録も通信も不要で、作った時点でそれが鍵になる。

| メモする名前 | 用途 | 形式 |
|---|---|---|
| `AUTH_SECRET` | ログインセッション（Cookie）の署名鍵 | base64の44文字 |
| `GMAIL_TOKEN_KEY` | Gmailのリフレッシュトークンを暗号化する鍵 | base64の44文字（**32バイト厳守**） |

`GMAIL_TOKEN_KEY` は **base64にして32バイトちょうど**でないと、アプリが起動時に弾く
（`lib/gmail/crypto.ts`）。下のコマンドはその条件を満たす。

### Windows（PowerShell）

スタートメニューで `powershell` と入力 → **Windows PowerShell** を開き、次の1行を貼って Enter。
管理者権限は不要。

```powershell
$b = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

**`Get-Random` は使わないこと。** 暗号用ではない疑似乱数なので、鍵の材料にしてはいけない。
上のコマンドはWindowsの暗号用乱数(CNG)を使う。

### Git Bash / macOS / Linux

```bash
openssl rand -base64 32
```

### 手順

1. コマンドを実行 → `t7Qw…=` のような **44文字**が表示される
2. メモ帳に `AUTH_SECRET = （貼り付け）` と書いて保存
3. **もう一度同じコマンドを実行**（毎回違う値が出る）
4. メモ帳に `GMAIL_TOKEN_KEY = （貼り付け）` と書き足す

**2つは必ず別の値にする。** `AUTH_SECRET` の入れ替えは「全員ログアウトするだけ」の
安全な日常操作だが、同じ鍵を使い回すと、その操作の副作用で**Gmail連携が無言で壊れる**。

**ローカルの `.env` にある値は流用せず、本番用に新しく作る。**
手元の開発環境と本番で鍵を共有しない（片方が漏れたときの影響範囲を分けるため）。

> **この2つは絶対にチャット・メール・Slackに貼らないこと。**
> 貼った時点で作り直しが必要になる（このプロジェクトでは実際に
> Anthropic APIキーで一度それが起きている）。

---

## 1. Neon（データベース）を作る

請求書・取引先・出力履歴を入れる本番のデータベース。無料プランで始めてよい。

### 1-1. アカウントを作る

1. https://neon.tech を開き、右上の **Sign up**
2. **Continue with GitHub**（Vercelと同じGitHubアカウントにしておくと後が楽）
3. 職種などを聞かれたら適当に答えて進む

### 1-2. プロジェクトを作る

サインアップ直後、そのままプロジェクト作成画面になる（ならなければ **New Project**）。

| 項目 | 入れる値 |
|---|---|
| Project name | `invoice-receipt` |
| Postgres version | **既定のまま**（変更不要） |
| Region | リストに **Tokyo (ap-northeast-1)** があればそれ。無ければ **Singapore (ap-southeast-1)** |

**Create project** を押す。10秒ほどで出来上がる。

> データベース名は `neondb` になるが、**変えなくてよい**。名前は何でも動く。

### 1-3. 接続文字列を2種類そろえる ★ここが要点

作成直後に **Connection string** が表示される（消えてしまったら
プロジェクト画面の **Connect** ボタン、または **Dashboard → Connection Details**）。

```
postgresql://neondb_owner:【パスワード】@ep-xxxx-yyyy-pooler.ap-northeast-1.aws.neon.tech/neondb?sslmode=require
                                                    ~~~~~~~
```

**ホスト名に `-pooler` が入っているかどうかだけが違う**、2つのURLが要る。

| 用途 | 環境変数 | ホスト名 |
|---|---|---|
| 実行時（アプリからの読み書き） | `DATABASE_URL` | `-pooler` **あり** |
| マイグレーション（テーブル作成） | `DIRECT_URL` | `-pooler` **なし** |

画面に **Pooled connection** のチェックボックス（または Pooled / Direct の切り替え）が
あればそれで両方コピーする。見当たらなければ、**コピーした1本から手で作れる**:

- `-pooler` が入っている → それが `DATABASE_URL`。`-pooler` を**削る**と `DIRECT_URL`
- `-pooler` が入っていない → それが `DIRECT_URL`。`.ap-` の直前に `-pooler` を**足す**と `DATABASE_URL`

2つに分けるのは、**プール(PgBouncer)経由だとテーブル作成のSQLが通らないことがある**ため。
実行時はプール（サーバーレスは関数ごとに接続を張るので、直結だと接続数を使い切る）、
テーブル作成は直結、と使い分ける。

### 1-4. 手元で疎通を確認する（強く推奨）

**Vercelでビルドする前に、URLが正しいことをここで確かめておく。**
ここを飛ばすと、URLの打ち間違いが「Vercelのビルド失敗」という分かりにくい形で出る。

Git Bash（またはVS Codeのターミナル）で、プロジェクトのフォルダに移動して実行する:

```bash
DATABASE_URL="【Pooledのほう】" DIRECT_URL="【Directのほう】" npx prisma migrate status
```

期待する出力:

```
5 migrations found in prisma/migrations
Following migrations have not yet been applied: ...
```

「まだ適用されていない」と出れば**成功**（テーブルはVercelのビルド時に作られる）。
ついでに、ここで先にテーブルを作ってしまってもよい:

```bash
DATABASE_URL="【Pooledのほう】" DIRECT_URL="【Directのほう】" npx prisma migrate deploy
```

> **接続文字列にはパスワードが含まれている。** チャットやメールに貼らないこと。
> 万一漏らしたら、Neonの **Roles → Reset password** で作り直せる。

---

## 2. ログイン用の Google OAuth クライアントを作る

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
   - **承認済みのリダイレクト URI**: いまは空のままでよい（手順5で本番URLを登録する）
4. 作成後に表示される **クライアントID** と **クライアントシークレット**を控える

---

## 3. Vercel にプロジェクトを作って1回目のデプロイ

### 3-1. サインアップとPro契約

1. https://vercel.com → **Sign Up** → **Continue with GitHub**
2. 個人アカウント（Hobby）ができるので、**Pro にアップグレード**する
   - 画面右上のアカウント → **Settings → Billing → Upgrade**
   - 料金はメンバー1人あたり月額（画面で最新の金額を確認すること）

**Proが要る理由は2つ。**

- **Hobbyプランは規約上、商用利用が認められていない。** 会社の支払業務で使う以上、
  タイムアウトの話を抜きにしてもProが要る
- **関数の実行時間の上限**が違う。Hobbyは60秒、Proは300秒。
  このアプリは `api/invoices` `api/gmail/scan` `api/gmail/items/[id]/import` の3つで
  `maxDuration = 300` を宣言している。請求書1通の読み取りに10〜40秒、
  Gmailの走査はメール数十通ぶんを1リクエストで回すため、60秒では途中で切られる

### 3-2. リポジトリを取り込む

1. **Add New → Project**
2. GitHubの `yamatoshugo/Invoice_Receipt` の行で **Import**
   - 一覧に出ないときは **Adjust GitHub App Permissions** でこのリポジトリを許可する
3. 設定画面で確認するのは1点だけ
   - **Framework Preset** が `Next.js` になっていること
   - **Build Command / Output Directory / Install Command は触らない**
     （`package.json` の `vercel-build` が自動で使われ、その中で
     `prisma migrate deploy` が走ってNeonにテーブルが作られる）

### 3-3. ★Deployを押す前に、環境変数を入れる

同じ画面の **Environment Variables** を開き、以下を1つずつ追加する。
（**ここで入れておかないと1回目のビルドが失敗する。** `DATABASE_URL` が無いと
マイグレーションが実行できないため）

| 変数名 | 値 |
|---|---|
| `DATABASE_URL` | Neonの **Pooled** 接続文字列 |
| `DIRECT_URL` | Neonの **Direct** 接続文字列 |
| `AUTH_SECRET` | 手順0で作った1つ目 |
| `AUTH_GOOGLE_ID` | 手順2のクライアントID |
| `AUTH_GOOGLE_SECRET` | 手順2のクライアントシークレット |
| `ALLOWED_EMAILS` | ログインを許可するアドレス（カンマ区切り）例: `henry@meetingtechnology.co.jp` |
| `ANTHROPIC_API_KEY` | Anthropicのキー（**本番用に作り直したもの**） |
| `GMAIL_CLIENT_ID` | Gmail取り込み用（ローカルの `.env` と同じ値） |
| `GMAIL_CLIENT_SECRET` | 同上 |
| `GMAIL_TOKEN_KEY` | 手順0で作った2つ目 |
| `APP_BASE_URL` | **いまは仮で `https://example.com`**（手順5で本物に直す） |

> **絶対に入れてはいけない3つ**: `AUTH_DEV_LOGIN` / `STORAGE` / `EXTRACTOR`
> - `AUTH_DEV_LOGIN` … メールアドレスだけで誰でもログインできてしまう
> - `STORAGE` … PDFの保管先がサーバー上の一時領域になり、消える
> - `EXTRACTOR` … **偽の口座情報が振込CSVに載る**。本番では起動時にエラーで止まるようにしてある

入れ終わったら **Deploy** を押す。

- ビルド中に `prisma migrate deploy` が走り、**Neonにテーブルが自動で作られる**
- 3〜5分で完了する
- この時点ではまだログインできない（リダイレクトURIが未登録のため）。**それで正しい**

### 3-4. ★「本番URL」を正しく取る

完了画面に出るURLは**そのデプロイ専用のURL**で、デプロイのたびに変わる。
これを登録すると、次のデプロイでログインもGmail連携も壊れる。

**Settings → Domains** を開き、一番上にある**固定のドメイン**を使うこと。

```
✅ https://invoice-receipt.vercel.app          ← これを使う（固定）
❌ https://invoice-receipt-abc123def.vercel.app ← デプロイごとに変わる
```

このURLを控える。以降 `<本番URL>` と書いたらこれのこと。

### 3-5. ★環境変数を Production 限定にする

取り込み画面で入れた環境変数は、既定で **Production / Preview / Development の3つ全部**に
適用されている。このままだと、将来ブランチを切ったときに
**Preview環境が本番DBに接続してマイグレーションを流す**。

**Settings → Environment Variables** で、少なくとも `DATABASE_URL` と `DIRECT_URL` は
**Production だけにチェック**を残す（他の変数も同様にしておくと安全）。

> Previewを使いたくなったら、Neonで**別ブランチのDB**を作ってPreview用に割り当てる。
> **本番DBをPreviewに繋いではいけない。**

---

## 4. Vercel Blob（PDFの保管先）を作る

プロジェクトができたので、PDFの置き場を作って接続する。

1. Vercelのプロジェクト画面 → **Storage** タブ → **Create Database** → **Blob**
2. 名前は `invoice-pdfs` など。リージョンはNeonと同じ方面を選ぶ
3. **Connect to Project** で今のプロジェクトに接続する
4. 接続すると `BLOB_READ_WRITE_TOKEN` が**自動で環境変数に入る**（手入力は不要）

---

## 5. 本番URLを各所に登録して、2回目のデプロイ

URLが決まったので、3か所に登録する。`<本番URL>` は手順3で発行されたもの。

### 5-1. Vercelの環境変数を直す

`APP_BASE_URL` を仮の値から **`<本番URL>`** に変更する（末尾のスラッシュは付けない）。

### 5-2. ログイン用のGoogle OAuth（手順2のプロジェクト）

**認証情報 → 作成したクライアント → 承認済みのリダイレクト URI** に追加:

```
<本番URL>/api/auth/callback/google
```

### 5-3. Gmail取り込み用のGoogle OAuth（既存のプロジェクト）

同じく**承認済みのリダイレクト URI** に追加（ローカル用の行は消さない）:

```
<本番URL>/api/gmail/callback
```

### 5-4. 再デプロイ

Vercel → **Deployments** → 最新の行の「…」→ **Redeploy**。
環境変数の変更は再デプロイしないと反映されない。

---

## 6. 本番で動かして確認する

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

## 7. 運用を始める前に残っていること

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
| 接続時に `channel_binding` 等のパラメータで怒られる | 接続文字列の末尾から `&channel_binding=require` を削る（`?sslmode=require` は残す） |
| Neonの最初の1回だけ応答が遅い | 無料プランは無操作でDBが休止する（スケールtoゼロ）。次のアクセスで数秒かかるだけで異常ではない |
| ログインで `redirect_uri_mismatch` | 手順5-2のURIが1文字でも違う。`https`・末尾スラッシュ無し・パスまで完全一致か確認 |
| Gmail接続で `redirect_uri_mismatch` | 手順5-3のURI、または `APP_BASE_URL` が本番URLになっていない |
| 取り込みが10秒前後で失敗する | Vercelが無料プランのまま。Proでないと `maxDuration = 300` が効かない |
| PDFのプレビューが開けない | Blobストアがプロジェクトに接続されていない（`BLOB_READ_WRITE_TOKEN` が無い） |
| 「読み取りに失敗しました」が全件で出る | `ANTHROPIC_API_KEY` が未設定・失効・残高切れのいずれか |

Preview環境（main以外のブランチをpushすると作られる）は、環境変数を Production 限定に
してあればビルドに失敗する。
**それで正しい。** 使いたい場合は、Neonで**別ブランチのDB**を作ってPreview用に割り当てること。
**本番DBをPreviewに繋いではいけない。**
