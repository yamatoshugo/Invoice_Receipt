# デプロイ手順（Vercel）

初回デプロイの手順書。**上から順にやれば動く**ように書いてある。
所要はおよそ1時間（待ち時間があるため）。

> **先に知っておくこと**
> - 必要なアカウントは **Vercel（Pro・有料） / Neon / Vercel Blob** の3つ。
>   どれか1つでも欠けると画面に入れない
> - **ログインにGoogleは使わない。** メールアドレスとパスワードで、アカウントは
>   このシステムのDBに保存される。最初の1人だけ環境変数で作る（手順2-3と手順5-1）
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

## 2. Vercel にプロジェクトを作って1回目のデプロイ

### 2-1. サインアップとプランの選択

1. https://vercel.com → **Sign Up** → **Continue with GitHub**
2. 個人アカウント（Hobby ＝ 無料）ができる

**実行時間の面では、無料プランでも足りる**（2026-09-16 調査）。

かつては「Hobbyは60秒、Proは300秒」だったが、現在は **Hobby も 300秒**（既定かつ上限）。
このアプリが `api/invoices` `api/gmail/scan` `api/gmail/items/[id]/import` の3つで宣言している
`maxDuration = 300` は、無料プランでもそのまま通る。

- 出典: [Functions Limits](https://vercel.com/docs/functions/limitations) /
  [Hobby Plan](https://vercel.com/docs/plans/hobby)
- **★条件: Fluid compute が有効であること**（新規プロジェクトは既定で有効）。
  無効だと古い制限に戻る。**Settings → Functions で目視して確認すること**
- 従量の枠（Active CPU 4時間/月・関数呼び出し100万回/月など）も大きく余る。
  公式が「**AIモデルの呼び出しやDBクエリの待ち時間はActive CPUに算入しない**」と
  明記しており、このアプリで一番長い処理（Claudeの応答待ち 1通8〜14秒）は枠を食わない。
  実際にCPUを使うのはハッシュ計算やJSONの処理だけで、月1分に満たない

**ただし、規約上の問題は残る。**

> the Hobby plan restricts users to **non-commercial, personal use only**
> — [Hobby Plan](https://vercel.com/docs/plans/hobby)

**Hobbyは非商用・個人利用に限られる。** 会社の支払業務で使うのは商用に当たる。
また Hobby は枠を超えると段階的に絞られるのではなく、**30日間その機能が使えなくなる**。
月末の振込直前に止まると影響が大きい。

**技術的には無料で足りるが、業務で使い続けるなら Pro にする**、という判断になる。
Pro にする場合は 画面右上のアカウント → **Settings → Billing → Upgrade**。

### 2-2. リポジトリを取り込む

1. **Add New → Project**
2. GitHubの `yamatoshugo/Invoice_Receipt` の行で **Import**
   - 一覧に出ないときは **Adjust GitHub App Permissions** でこのリポジトリを許可する
3. 設定画面で確認するのは1点だけ
   - **Framework Preset** が `Next.js` になっていること
   - **Build Command / Output Directory / Install Command は触らない**
     （`package.json` の `vercel-build` が自動で使われ、その中で
     `prisma migrate deploy` が走ってNeonにテーブルが作られる）

### 2-3. ★Deployを押す前に、環境変数を入れる

同じ画面の **Environment Variables** を開き、以下を1つずつ追加する。
（**ここで入れておかないと1回目のビルドが失敗する。** `DATABASE_URL` が無いと
マイグレーションが実行できないため）

| 変数名 | 値 |
|---|---|
| `DATABASE_URL` | Neonの **Pooled** 接続文字列 |
| `DIRECT_URL` | Neonの **Direct** 接続文字列 |
| `AUTH_SECRET` | 手順0で作った1つ目 |
| `INITIAL_ADMIN_EMAIL` | 最初にログインする自分のアドレス。例: `henry@meetingtechnology.co.jp` |
| `INITIAL_ADMIN_PASSWORD` | 自分で決める（**12文字以上**）。初回ログイン用 |
| `ANTHROPIC_API_KEY` | Anthropicのキー（**本番用に作り直したもの**） |
| `GMAIL_CLIENT_ID` | Gmail取り込み用（ローカルの `.env` と同じ値） |
| `GMAIL_CLIENT_SECRET` | 同上 |
| `GMAIL_TOKEN_KEY` | 手順0で作った2つ目 |
| `APP_BASE_URL` | **いまは仮で `https://example.com`**（手順4で本物に直す） |

> **★`INITIAL_ADMIN_*` は、Deployを押す前に入れておくこと。**
> デプロイ直後は利用者が0人で誰もログインできず、利用者を追加する画面はログインの先に
> あるため、後から気づいても「環境変数を足して再デプロイ」しか復旧手段がない。

> **絶対に入れてはいけない2つ**: `STORAGE` / `EXTRACTOR`
> - `STORAGE` … PDFの保管先がサーバー上の一時領域になり、消える
> - `EXTRACTOR` … **偽の口座情報が振込CSVに載る**。本番では起動時にエラーで止まるようにしてある

入れ終わったら **Deploy** を押す。

- ビルド中に `prisma migrate deploy` が走り、**Neonにテーブルが自動で作られる**
- 3〜5分で完了する
- ログイン自体はこの時点でできる（Googleを経由しないため）。
  ただしGmail連携だけは、リダイレクトURIを登録する手順4まで使えない

### 2-4. ★「本番URL」を正しく取る

完了画面に出るURLは**そのデプロイ専用のURL**で、デプロイのたびに変わる。
これを登録すると、次のデプロイでログインもGmail連携も壊れる。

**Settings → Domains** を開き、一番上にある**固定のドメイン**を使うこと。

```
✅ https://invoice-receipt.vercel.app          ← これを使う（固定）
❌ https://invoice-receipt-abc123def.vercel.app ← デプロイごとに変わる
```

このURLを控える。以降 `<本番URL>` と書いたらこれのこと。

### 2-5. ★環境変数を Production 限定にする

取り込み画面で入れた環境変数は、既定で **Production / Preview / Development の3つ全部**に
適用されている。このままだと、将来ブランチを切ったときに
**Preview環境が本番DBに接続してマイグレーションを流す**。

**Settings → Environment Variables** で、少なくとも `DATABASE_URL` と `DIRECT_URL` は
**Production だけにチェック**を残す（他の変数も同様にしておくと安全）。

> Previewを使いたくなったら、Neonで**別ブランチのDB**を作ってPreview用に割り当てる。
> **本番DBをPreviewに繋いではいけない。**

---

## 3. Vercel Blob（PDFの保管先）を作る

プロジェクトができたので、PDFの置き場を作って接続する。

1. Vercelのプロジェクト画面 → **Storage** タブ → **Create Database**（または **Create**）→ **Blob**
2. 名前は `invoice-pdfs` など。リージョンはNeonと同じ方面を選ぶ
3. **Connect to Project** で今のプロジェクトに接続する
   - 環境（Production / Preview / Development）を聞かれたら **Production** を選ぶ
4. 接続すると `BLOB_READ_WRITE_TOKEN` が**自動で環境変数に入る**（手入力は不要）

> **★環境変数名は `BLOB_READ_WRITE_TOKEN` のまま変えないこと。**
> 接続時に「Environment Variables Prefix」を聞かれることがあるが、**空のまま**にする。
> 接頭辞を付けると `INVOICE_PDFS_BLOB_READ_WRITE_TOKEN` のような名前になり、
> `@vercel/blob` が既定で見る名前と合わなくなって、アップロードが動かない。

### 接続したあとの確認

- **Settings → Environment Variables** に `BLOB_READ_WRITE_TOKEN` が
  追加されていること（値は伏せ字でよい）
- **この時点ではまだ反映されていない。** 環境変数は再デプロイで初めて効く。
  手順4の最後（4-4）で再デプロイするので、ここでは追加されていることの確認だけでよい

### 補足: このアプリでのBlobの使われ方

| 経路 | 動き |
|---|---|
| ドラッグ&ドロップ | **ブラウザからBlobへ直接**アップロードする。Vercelの関数が受け取れる本文は4.5MBまでなので、サーバー経由にすると大きいPDFで失敗するため |
| Gmail取り込み | サーバーがGmailから受け取った実体をBlobへ置く（こちらは4.5MBの制約を受けない） |

保存は `access: "private"` なので、**URLを知っていても直接は開けない**。
閲覧は必ずログイン済みのプロキシ（`/api/invoices/[id]/file`）を通る。
PDFの上限は20MBで、同名ファイルはランダムな接尾辞を付けて別物として保存する
（上書きで過去の請求書を壊さないため）。

---

## 4. 本番URLを各所に登録して、2回目のデプロイ

URLが決まったので、2か所に登録する。`<本番URL>` は手順2で発行されたもの。

### 4-1. Vercelの環境変数を直す

`APP_BASE_URL` を仮の値から **`<本番URL>`** に変更する（末尾のスラッシュは付けない）。

### 4-2. Gmail取り込み用のGoogle OAuth

GCPで**Gmail取り込み用のプロジェクト**を開き（ログインには使わない。このアプリで
Googleを使うのはここだけ）、**APIとサービス → 認証情報** から対象のクライアントを開く。

**承認済みのリダイレクト URI** に追加（**ローカル用の行は消さない**）:

```
<本番URL>/api/gmail/callback
```

### 4-3. URIの書き方（1文字でも違うと弾かれる）

Googleは**完全一致**で照合する。よくある間違い:

| ❌ | 何が違うか |
|---|---|
| `http://…` | `https` でなければならない |
| `<本番URL>/api/gmail/callback/` | **末尾のスラッシュ**が余計 |
| `<本番URL>/api/gmail/` | `callback` が抜けている |
| `https://invoice-receipt-abc123.vercel.app/...` | デプロイ専用URL。**固定ドメイン**を使う |

> 反映に数分かかることがある。直後に試して失敗しても、少し待ってもう一度試す。

### 4-4. 再デプロイ

Vercel → **Deployments** → 一番上（`main`）の行の「**…**」→ **Redeploy** → 確認ダイアログで実行。
ビルドキャッシュの利用はどちらでもよい。

**環境変数（`APP_BASE_URL` と `BLOB_READ_WRITE_TOKEN`）は、再デプロイして初めて効く。**

### 4-5. 使うURLを固定する

以降、アプリは**必ず固定ドメイン**で開くこと。
デプロイ専用URL（`…-abc123.vercel.app`）で開くと、そのホスト名で認可に行くため
**登録済みのURIと一致せずGmailに接続できない**。ブックマークは固定ドメインで作る。

---

## 5. 本番で動かして確認する

`<本番URL>`（**固定ドメイン**）を開いて、上から順に確認する。
**1つ通るごとに、本番でしか確かめられない配線が1本ずつ潰れていく**ように並べてある。

### 5-1. ログイン ＝ 最初の1人を作る（AUTH_SECRET と DB の確認）

1. `/signin` が開き、**「まだ利用者が1人も登録されていません」**の案内が出ている
   - 出ていなければ利用者がすでにいる。想定外なので `/api/health` とDBを確認する
2. `INITIAL_ADMIN_EMAIL` のアドレスと `INITIAL_ADMIN_PASSWORD` のパスワードでログイン
   → 請求書一覧が開き、右上に自分のアドレスが出れば成功
3. **でたらめなパスワードでは入れないことも1回試す**
4. **設定 → 利用者** で、実際に使う人を追加する
   - パスワードは「自動生成」で作り、**本人には別の手段（口頭・チャット）で渡す**
   - 追加した人が別のブラウザ（シークレットウィンドウ）でログインできることを確認する

> **この時点ではまだ `INITIAL_ADMIN_*` を消さない。** 手順6で消す。

### 5-2. Gmail連携 ＝ GMAIL_TOKEN_KEY と リダイレクトURI の確認

**設定 → Gmail 連携 → 「Gmailを接続する」** → `seikyusho@meetingtechnology.co.jp` で認可。

- **ローカルの接続は引き継がれない。** 接続情報はDBにあり、本番DBは空だから。
  これは想定どおりで、本番で1回だけ繋ぎ直す
- 権限が **「読み取り・送信（gmail.readonly / gmail.send）」** と表示されればOK
- 「読み取りのみ」と出たら、同意画面で送信のチェックを外している。「接続し直す」でやり直す

> ローカルと本番で別々のトークンを持つことになるが、互いに影響しない
> （再接続時に無効化するのは、そのDBに入っていた古いトークンだけ）。

### 5-3. 振込依頼人の設定 ＝ CSV出力の前提

**設定 → 振込依頼人** に銀行の4つの値を入れて保存する。
**まだ入手していなければ、ここは飛ばしてよい**（6-6だけが後回しになる）。

### 5-4. PDFを1通アップロード ＝ Blob・Claude・DB の同時確認

**取り込み → アップロード経由** にPDFをドラッグ&ドロップ。

- 読み取りに10〜40秒かかる。**60秒で切れるようならProになっていない**
- 請求書一覧に出れば、**Vercel Blob・Claude API・Neon の3つが本番で通った**ことになる
- 一覧から明細を開き、**PDFのプレビューが表示されること**も確認する
  （privateブロブを認証付き中継で読めているかの確認）
- **4.5MBを超えるPDFが手元にあれば、それも1通試す。**
  ブラウザから直接アップロードする経路が効いているかは、大きいファイルでしか分からない

### 5-5. メールから取り込み ＝ Gmail API の確認

**取り込み → メール経由** で期間を指定して「取り込む」。

- 本番DBは空なので、走査済みの帯は何も無い状態から始まる
- 取り込みたい月を指定する（例: 先月1日〜今日）
- 「クエリが返したメール」の件数をGmailの検索と突き合わせる

### 5-6. 承認してCSV出力 ＝ 一連の出口の確認

請求書を1件承認 → **CSV出力**（銀行の値を入れてある場合）。
ダウンロードしたCSVをテキストエディタで開き、
先頭行が `1,21,0,…` で始まり、最終行が `9` であることを目視する。

### 5-7. 送付依頼メール（任意）

ログインが要るURL請求書が無ければ試せないが、届いていれば
**取り込み → 送付依頼** から**自分宛に**1通送って、文字化けが無いことを確認する。

---

> **これ以降、実務で使うのは本番だけにする。**
> ローカルと本番は別のDBなので、同じメールを両方で取り込むと請求書が二重に作られる。
> ローカルは開発・検証用と割り切ること。

---

## 6. 運用を始める前に残っていること

### 6-1. 初期パスワードの環境変数を消す

手順5-1で最初の1人を作り、実際に使う人を［設定 ≫ 利用者］に追加し終えたら:

1. Vercel → **Settings → Environment Variables** から
   **`INITIAL_ADMIN_PASSWORD` と `INITIAL_ADMIN_EMAIL` を削除**する
2. **Deployments → Redeploy** で再デプロイ
3. `/api/health` の `warnings` が空になる
4. 消したあとも**ログインはそのまま通る**（アカウントはDBにあるため）

利用者が1人でもいれば、この2つは元々無視される。それでも消すのは、
**初期パスワードがVercelの設定画面に平文で残り続けるのを避ける**ため。

### 6-2. 残りの作業

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
| 「メールアドレスまたはパスワードが違います」から進めない | ①そのアドレスが［設定 ≫ 利用者］に無い（別の人に追加してもらう）②最初の1人なら `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` の値と完全一致しているか（前後の空白・全角に注意） |
| 「まだ利用者が1人も登録されていません」が出る | 正常。`INITIAL_ADMIN_*` の値でログインすればその人が登録される。案内文に「設定してください」と出ていれば環境変数自体が未設定 |
| ログインは通るのに、すぐログイン画面に戻る | ①デプロイ専用URLで開いている（固定ドメインで開き直す）②別の人にアカウントを削除された、またはパスワードを再設定された（**どちらもその場で反映される仕様**）③それでも直らなければ `AUTH_URL` に `<本番URL>` を足して再デプロイ |
| 全員が同時にログアウトされた | `AUTH_SECRET` が変わった。元に戻すか、各自ログインし直す（アカウントは消えていない） |
| `Configuration` というエラー画面が出る | `AUTH_SECRET` が未設定。入れて再デプロイ |
| Gmail接続で `redirect_uri_mismatch` | 手順4-2のURI、または `APP_BASE_URL` が本番URLになっていない |
| 取り込みが10〜60秒で失敗する | 関数の実行時間の上限に当たっている。Settings → Functions で **Fluid compute が有効**か、**Function Max Duration が 300** かを確認（無効だと古い制限に戻る） |
| 画面もメール取り込みも全体的に重い | 関数のリージョンとNeonのリージョンが離れていないか。`/api/health` の `deployment.region` と `database.region` を見比べる（下記） |
| PDFのプレビューが開けない | Blobストアがプロジェクトに接続されていない（`BLOB_READ_WRITE_TOKEN` が無い） |
| `Vercel Blob: No read-write token found` | 下記「Blobのトークンが見つからないとき」 |
| 「読み取りに失敗しました」が全件で出る | `ANTHROPIC_API_KEY` が未設定・失効・残高切れのいずれか |

Preview環境（main以外のブランチをpushすると作られる）は、環境変数を Production 限定に
してあればビルドに失敗する。
**それで正しい。** 使いたい場合は、Neonで**別ブランチのDB**を作ってPreview用に割り当てること。
**本番DBをPreviewに繋いではいけない。**

---

## 設定の食い違いを1画面で確かめる — `/api/health`

原因の切り分けは、**実行中のデプロイから何が見えているか**を見るのが一番速い。
ログインした状態で次を開く。

```
<本番URL>/api/health
```

```json
{
  "deployment": { "env": "production", "commit": "1a97d2b", "branch": "main", "region": "iad1" },
  "database": { "region": "ap-southeast-1" },
  "storage": "vercel-blob",
  "env": { "BLOB_READ_WRITE_TOKEN": false, "...": true },
  "missing": ["BLOB_READ_WRITE_TOKEN"],
  "unexpected": [],
  "warnings": ["INITIAL_ADMIN_PASSWORD が残っています。…"],
  "ok": false
}
```

- `missing` が空、`unexpected` が空、`ok: true` なら設定は揃っている
- **値は返さない**（設定の有無だけ）。それでもログインを必須にしてある
- `deployment.commit` で、見ているのが最新のデプロイかどうかも分かる
- `unexpected` に何か入っていたら、**消すまで本番で使ってはいけない**
  （`STORAGE` / `EXTRACTOR`）
- `warnings` は動作を止めないが放置してはいけないもの。
  いまは初期パスワードの消し忘れだけ（手順6-1）。`ok` は落とさない —
  必須にすると初回ログイン後ずっと `ok: false` になり、本当に困ったとき誰も見なくなる
- **`deployment.region` と `database.region` を見比べる。** 上の例は
  関数が米国東部・DBがシンガポールで、**DBを1回叩くたびに太平洋を往復している**状態

---

## 関数のリージョンを、DBと同じ方面に寄せる

**症状が「なんとなく重い」としか出ないので、気付きにくいわりに効く。**

このアプリは1画面を描くのにDBを9〜11回引き、Gmailの走査はメール1通につき約5回引く。
関数とDBが離れていると、その回数ぶん往復の時間が積み上がる
（米国東部↔シンガポールで1往復230ms前後 → 1画面で2秒以上）。

1. `/api/health` で `deployment.region` と `database.region` を確認する
2. Vercel → プロジェクト → **Settings → Functions → Function Region**
3. Neonと同じ方面を選ぶ

| Neon | 選ぶVercelのリージョン |
|---|---|
| `ap-southeast-1`（シンガポール） | Singapore (`sin1`) |
| `ap-northeast-1`（東京） | Tokyo (`hnd1`) |

4. **Deployments → 一番上 → … → Redeploy**
5. `/api/health` で `deployment.region` が変わったことを確認

- **リージョンの変更は無料プランでもできる**（複数リージョンの指定がPro以上というだけ）
- **Vercel Blob のストアも同じ方面にあるか確認する。** 取り込みはBlobからPDFの実体を
  読み直すので、Blobだけ遠いと数MBの転送で取り返した分を失う
- コードには書かないこと。`preferredRegion` はこのNext.jsでは非推奨になっている

---

## Blobのトークンが見つからないとき

症状: アップロードで `Vercel Blob: No read-write token found`、
`/api/health` で `"BLOB_READ_WRITE_TOKEN": false`。

**Storage連携が自動で追加した環境変数は、手で編集すると外れることがある**
（環境を Production 限定に絞る作業をした直後に起きやすい）。

### 確実な直し方: 手動で追加する

1. Vercel → **Storage** → Blobストアを開き、`vercel_blob_rw_…` で始まる値をコピー
   （前後の引用符は含めない）
2. **本番を配信しているプロジェクト**の **Settings → Environment Variables → Add**
   - Key: `BLOB_READ_WRITE_TOKEN`
   - Value: ①でコピーした値
   - Environment: **Production**
3. **Deployments → 一番上 → … → Redeploy**
4. `/api/health` で `true` になったことを確認してから、アップロードを試す

### あわせて確認すること

- Blobストアの **Connected Projects** が、本番を配信しているプロジェクトになっているか
- **同名のプロジェクトが2つできていないか**（最初のImportに失敗して作り直した場合など）。
  別のプロジェクトに接続していると、いくら再デプロイしても反映されない

> Gmail取り込みも**同じトークン**を使う（`getFileStore().put()`）。
> ドラッグ&ドロップだけが失敗して取り込みは成功する、という状態は本来ありえない。
> 取り込みが成功していたなら、それはトークンが在った時点のもの。
