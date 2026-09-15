# 次にやる — 「請求書をPDFで送ってください」依頼メール

最終更新: 2026-09-15 / 状態: **実装済み（実送信はまだ。§10 の検証が残っている）**

このファイルは実装の設計書として書いたもの。実装後も、**なぜそうしたか**と
**§10 の検証手順**のために残してある。

**実装で計画から変えたのは2点だけ**（理由は [PROGRESS.md](PROGRESS.md) §0 に記載）:

1. §1-4 の「古いトークンを revoke」に加えて、**保存した新しいトークンで実際に認証できるかを
   その場で検証する**（revoke が新しい grant まで巻き込んだ場合に、次の取り込みまで
   壊れたことに気付けないため）
2. §7 の画面案にあった返信待ちの **「もう一度送る」は作らなかった**
   （§3 の1層目が `REQUEST_SENT` を対象外にしているため、押せないボタンになる。
   催促は「Gmailで開く」から人が直接行う）

---

## 0. 何を作るか

請求書受け取り専用のGmail（`seikyusho@meetingtechnology.co.jp`）に届く請求書のうち、
**楽々明細のようなポータルのURLだけが本文に書かれているもの**は、ログインが要るので自動取得できない。
そこで**取引先に「請求書をPDFで添付して送ってください」と依頼するメールを送る**。

### 前提（実装済み）

リンクの判定までは完成していて、**依頼の対象は既にDBに溜まる**。

- `GmailItem` で `kind = LINK`、`status = LOGIN_REQUIRED`、`url` に対象URL、`linkKind = LOGIN`
- 判定理由は `message_` に日本語で入っている
- `/upload` の取り込み結果に「ログインが必要（依頼待ち）N件」として出る
- `settlementOf` は `LOGIN_REQUIRED` を**未決着**に分類する（請求書がまだ手元に無いため）

### 依頼者が決めたこと

| 項目 | 決定 |
|---|---|
| 送信 | **画面で宛先・件名・本文を確認してから人が送信。** 自動送信はしない |
| 文面 | **設定画面で編集できる**ひな型 |
| 画面の場所 | **取り込みタブの3つ目のサブタブ**（メール経由 / アップロード経由 / **送付依頼**） |

依頼者は以前「添付の一覧は要らない」と却下しているが、**これは性質が違う**ので提案してよい。
あちらは毎月数百行・全自動・人が決めることが無い管理台帳だった。
こちらは**1行ごとに人が必ず判断し、送れば消える作業キュー**で、件数は月に数件。

---

## 1. スコープの追加（最初にやる）

`src/lib/gmail/oauth.ts` の `GMAIL_SCOPES` に `gmail.send` を足す。

```ts
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;
```

### 調べ済みの事実

- **`gmail.send` は Google の分類で Sensitive**（`gmail.readonly` の **Restricted** より一段低い）。
  既に Restricted を使っているので**審査区分は上がらない**。Workspace の Internal アプリなので審査自体が不要
- `access_type=offline` + `prompt=consent` は既に常時付いている（`oauth.ts`）。
  `exchangeCode` は refresh_token が無ければ throw するので、**無言で壊れる経路が無い**

### 既存の接続を壊さないための必須事項

**リフレッシュはスコープを引数に取らないので、既存の接続は readonly のまま有効。
つまり「読めるが送れない」状態になり、送信時に初めて 403 で分かる。** これを事前に検知する。

1. **`validateGrantedScope` の必須スコープは readonly だけにする。**
   送信まで必須にすると、同意画面で送信のチェックを外した人が**取り込みすらできなくなる**。
   取り込みが本体で、依頼メールは付随機能。本体を付随機能の都合で止めない
2. `connection.ts` に `sendCapability()` を足し、**DBの `scope` だけで**送信可否を判定して
   「設定画面の『接続し直す』を1回押してください」と案内する
3. **`GmailConnectionPanel.tsx` の `"読み取りのみ（gmail.readonly）"` は決め打ち文字列。**
   スコープを足すとここが嘘になるので `describeScopes(state.scope)` に置き換える
4. `saveConnection` で**古いトークンを revoke** してから保存する。
   しないと再接続のたびに Google 側に grant が積み上がる（1ユーザー100本の上限があり、
   超えると古いものから無言で失効する）。**新しいトークンを取得し終えた後に revoke すること**

スコープ判定は env に触らない純関数として `src/lib/gmail/scope.ts` に切り出すとテストしやすい
（`oauth.ts` は `gmailOauthConfig()` が env を読んで throw するため）。

---

## 2. 送信の実装

### 2-1. `src/lib/gmail/rfc2822.ts`（純関数）

**件名（RFC 2047 B エンコード）で最もやってはいけないのは「base64にしてから長さで切る」こと。**
base64 の途中で切るとUTF-8のマルチバイト文字が2つのエンコード語にまたがり、復号時に必ず壊れる。

- **切るのは base64 の前、しかもコードポイント境界で。** `[...text]` で回す
  （`text[i]` だとサロゲートペア（𠮷・絵文字）を半分に割る）
- エンコード語1つの上限は75文字。`75 - 10("=?UTF-8?B?") - 2("?=") - 1 = 62` → `floor(62/4)*3 = 45`バイト
- 折り返しは `CRLF + 空白1文字`。RFC2047 により隣接するエンコード語の間の空白は復号時に消える

**本文は UTF-8 + base64。** quoted-printable は使わない（日本語は全バイトが非ASCIIで3倍に膨らみ、
ソフト改行の処理で壊しどころが増える）。base64 なら行長・裸のCR/LF・末尾空白の3つがまとめて消える。
RFC 2045 により76文字で折り返す。

**ヘッダインジェクション**: 件名も差出人表示名も設定画面で人が編集できるので、`\n` を入れられると
任意のヘッダ（`Bcc:` を含む）を注入できる。`sanitizeHeaderValue` で CR/LF を落とす。
**日本語ならbase64に飲まれるが、純ASCIIの件名は素通しになる**のでここで落とさないと穴が開く。
宛先は表示名を付けない（`To: <addr>` のみ。注入面を増やさない）。

**無料で手に入る検証**: 既存の `parts.ts` の `decodeMimeFilename` が RFC 2047 の**復号器**なので、
`decodeMimeFilename(encodeHeaderWord(s)) === s` の往復テストがモック無しで書ける。
さらに `buildRfc2822` の出力全体が純ASCIIであることを検査すれば、エンコード漏れが必ず落ちる。

意図的に付けないもの: `Message-ID`（Gmailが採番する）、`Reply-To`（返信は専用アドレスに戻るのが正しい）、
`Bcc`・添付・HTMLパート。

### 2-2. 返信として送る

**返信にする。** 理由は3つで、3つ目が設計上いちばん効く。

1. 取引先が文脈で読める
2. 迷惑メール判定に有利（既存の会話への返信は強いham信号）
3. **取引先がPDFを添付して返信すると同じ `gmailThreadId` に入る。**
   次回の走査でそれが記録され、**「返信が来たか」を曖昧照合ではなくDBの等値結合で判定できる**

仕組みは2つとも要る（役割が違う）:

| | 効く相手 |
|---|---|
| リクエストbodyの `threadId` | **Gmail側**。送信控えを元スレッドに入れる |
| `In-Reply-To` / `References` ヘッダ | **取引先のメールソフト**。向こうの画面でスレッドになる |

**Gmail は `threadId` を渡しても件名が一致しないとスレッドに入れない。**
既定の件名を `Re: {{元の件名}}` にし、**一致しなくなったら黙って新規メールとして送る**（エラーにしない）。
承認画面にどちらになるかをバッジで出す。

元メールの `Message-ID` は**保存していない**。列を足さず、**送信直前に `getMessage()` して
`message-id` / `references` ヘッダを読む**（送信は月に数件なのでAPI1回の追加は無視できる）。

### 2-3. `GmailClient.sendMessage`

`client.ts` の `call()` を `CallOptions`（`json` / `maxRetryAttempts`）対応に一般化する
（既存の呼び出し3箇所を書き換え）。

**★ 送信は絶対に自動再試行しない。** `call()` は現在429/5xxで最大5回再試行するが、
**502やタイムアウトは「Gmailが受理した後」にも起こる**。再試行すると同じ依頼が取引先に複数回届く。
`sendMessage` は `maxRetryAttempts: 1` を渡す
（401 → トークン再取得 → 1度だけ再送、は残す。401はGmailに届く前の拒否なので送信済みの可能性が無い）。

`gmailErrorMessage` に 403 のスコープ不足の分岐を足す
（`/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i`）。

---

## 3. 二重送信の防止 — 4層

1. **状態の原子的占有**（本命）。既存の `IMPORTING` と同じ形:
   ```ts
   updateMany({ where: { id, kind: "LINK", status: { in: ["LOGIN_REQUIRED", "REQUEST_FAILED"] } },
                data: { status: "REQUEST_SENDING", ... } })
   ```
   `count !== 1` なら「既に送信済みです（日時）」を返す
2. **送信APIを自動再試行しない**（上記2-3）
3. 同一宛先への7日以内の送信を**警告**（ブロックはしない。同じポータル経由で複数の請求が来るのは正当）
4. `REQUEST_FAILED` を「押せば直る状態」にしない。文言で「Gmailの送信済みを確認してから」と誘導

---

## 4. 状態の追加

`prisma/schema.prisma` の `GmailItemStatus` に3つ足す（`LOGIN_REQUIRED` は実装済み）:

```prisma
  /// 依頼メールを送信中。二重送信を防ぐための占有（IMPORTING と同じ役割）
  REQUEST_SENDING
  /// 送付依頼メールを送った。返信待ち
  REQUEST_SENT
  /// 送信でエラーになった。★自動では再送しない
  REQUEST_FAILED
```

**`src/lib/gmail/status.ts` の `STATUS_CLASSIFICATION` に必ず追記すること。**
`Record<GmailItemStatus, ...>` なので書き忘れると `npm run typecheck` が落ち、
表を回すテストで `npm test` も落ちる（そうなるように直してある）。

### 分類

| 状態 | 分類 | 理由 |
|---|---|---|
| `REQUEST_SENDING` | 未決着（`request-sending`） | 送れたか分からない。必ず人の目に触れさせる |
| `REQUEST_SENT` | **返信が来ていれば決着、来ていなければ未決着** | 下記 |
| `REQUEST_FAILED` | 未決着（`request-failed`） | 送信済みか確認してから人が操作する |

**`REQUEST_SENT` を単体で決着にしてはいけない。**
「返信が来れば別のメールとして取り込まれるから決着でよい」は順路だけを見た定義。
決着は逆路で定義する必要がある。単体で決着にすると**依頼を無視された請求書が「済」の札を付けて消える** —
システムが存在する理由（月末の支払漏れ）をシステム自身が隠蔽する形になる。

→ `ItemLike` に `repliedAt: Date | null` を足し、**呼び出し側が計算して渡す**
（既存の「決着はDBに保存せず画面を出すたびに導出する」方針のまま）。
**必須フィールドにする**ので、渡し忘れた画面は型エラーで止まる。

---

## 5. 返信の検出（`src/lib/gmail/reply.ts` — 純関数）

```ts
export function replyArrivedAt(
  threadId: string, sentAt: Date, mailboxAddress: string, messages: ThreadMessageLike[],
): Date | null;
```

条件: 同じ `gmailThreadId` ∧ `internalDate > sentAt`
∧ **`fromAddress !== mailboxAddress`** ∧ **`!labelIds.includes("SENT")`** ∧ `attachmentCount > 0`

### ⚠ 自分の送信控えを返信と数えない（実在する落とし穴）

**走査クエリ（`buildGmailQuery`）は `after:/before:` だけで、送信済みを除外していない。**
依頼メールを送ると、次回の走査でそれが `GmailMessage` として記録される。
除外しないと**送った瞬間に「返信が来た」ことになり、返信待ちの検出が丸ごと無意味になる。**

走査クエリは**変えないこと**（走査済み期間の意味が変わり、抜け洩れゼロの不変条件に触る）。
**検出側で `From` と `SENT` ラベルの両方で弾く。**

`attachmentCount > 0` を条件にするのは、`GmailMessage.attachmentCount` が走査時に必ず埋まるので
追加クエリなしで判定できるから。「承知しました」だけの返信を決着にしない
（請求書はまだ手元に無い）。添付なしの返信は別表示にして、人が「待たない」で閉じられるようにする。

### 経過日数の可視化（`replyWait.ts`）

7日で橙、14日で赤。**請求書の支払期日は使えない**（請求書が手元に無いのが問題の本質）ので経過日数で判断する。
サブタブのバッジ / `ScanSummary` の帯 / 依頼一覧の3箇所に出す。

---

## 6. 文面テンプレート

`Setting` に3列（**既定文面はコード側**に置く。`@default` に長い日本語を書くと、
文面を直すたびにマイグレーションが要り、直す前に作られた行が古い文面を持ち続ける）:

```prisma
  requestMailSubject  String?
  requestMailBody     String? @db.Text
  requestMailFromName String?
```

差し込み変数: `{{取引先名}} {{元の件名}} {{受取アドレス}} {{自社名}} {{今日}}`

```ts
export function renderTemplate(template: string, vars: RequestVars): RenderResult;
//   → { text, unknownVars, emptyVars }
```

**危ない箇所**:
- **置換は文字列ではなく関数で行う。** 文字列だと取引先名に含まれる `$&` `$1` が
  パターンとして解釈されて本文が壊れる（取引先名は外部から来る値なので実際に起こりうる）
- `replace` は1パスしか回らない。**差し込んだ値の中の `{{...}}` が再展開されない**のは
  この性質に依存している。ループにしないこと
- **書き間違いはそのまま残す。** 黙って消すと文が不自然になるだけで誰も気づかない

3段階で扱う:

| 場所 | 挙動 |
|---|---|
| `renderTemplate` | そのまま残す。例外も投げない（編集途中の保存を邪魔しない） |
| 設定画面 | サンプル値でのライブプレビュー。未知の変数を赤で列挙。変数を挿入するボタンも置く |
| 承認画面 | 展開後に `{{` が残っていたら**送信ボタンを無効化** |

### 既定文面

```
件名: Re: {{元の件名}}
```

```
{{取引先名}} ご担当者様

いつもお世話になっております。
{{自社名}} 経理担当でございます。

お送りいただきました「{{元の件名}}」につきまして、
請求書がWeb明細サイトでのご提供となっており、
恐れ入りますが弊社にて内容を確認できておりません。

つきましては、お手数をおかけし大変恐縮ですが、
請求書をPDFファイルにてご添付のうえ、本メールへご返信いただけますでしょうか。

ご返信は下記のアドレスにて承っております。
{{受取アドレス}}

お忙しいところ恐れ入りますが、何卒よろしくお願い申し上げます。

{{自社名}}
```

方針: **期限・「至急」を書かない**（相手は既に有効な請求書を送っており、こちらの都合でお願いする側）。
**URLも添付も入れない**（迷惑メール判定とフィッシング疑いを避ける）。
**金額・口座を一切書かない**（誤送信しても漏れるのは取引先名と自社名だけ）。

---

## 7. 画面（`/upload/requests`）

`SubTabs.tsx` に3つ目を足し、**未送信＋返信待ちの件数をバッジで出す**。
見に行かなくてもタブに数字が出続けること自体が「返信待ちが溜まっている」の可視化になる。
`layout.tsx` を async にして件数を数える。

```
┌ 未送信（2件） ───────────────────────────────┐
│ ▾ 楽々商事株式会社  <noreply@rakuraku.jp>  8月分ご請求      │
│   ⚠ このアドレスは返信を受け付けない可能性があります          │
│   宛先 noreply@rakuraku.jp            [宛先を変更]         │
│   件名 [Re: 8月分ご請求のお知らせ                    ]     │
│        🔗 元のスレッドへの返信として送られます               │
│   本文 [ここで直接編集できる                          ]     │
│   ℹ この宛先には 3日前 にも依頼を送っています                │
│   [この内容で送信]  [依頼しない]                           │
└───────────────────────────────────────────┘
┌ 返信待ち（2件） ─────────────────────────────┐
│ 株式会社ABC  9/1送信（13日経過）🟠 [Gmailで開く][もう一度送る] │
│ 有限会社XYZ  9/10送信 ✅ 返信が届いています（請求書1件を取込済）│
└───────────────────────────────────────────┘
```

### 設計の要点

- **一括送信は作らない。** 各社で宛名も元の件名も違うので「同じ内容を30通」の実体が無く、
  **一括送信はテンプレートの書き間違いが全社に同時に届く唯一の経路**になる。
  アコーディオンで、遷移なしに次々確認できる形にする
- **本文をその場で直せるようにする。** 直せないと担当者は「少しズレた文面をそのまま送る」か
  「この画面を使わず Gmail で直接送る」のどちらかになる。後者だと **`REQUEST_SENT` の記録が残らず、
  返信待ちの可視化が丸ごと死ぬ**。直せることがこの機能が使われ続ける条件
- **送ったものをそのまま `GmailRequestMail` に保存**（ひな型ではなく最終形）。
  ひな型しか残さないと、後からひな型を直した瞬間に「あのとき何を送ったか」が永久に分からなくなる
- **noreply 宛先の警告**。楽々明細系の通知は `noreply@` から来ることが多く、そのまま送っても届かない。
  `/^(no-?reply|donotreply|postmaster|mailer-daemon)/i` で検出。ブロックはせず、
  担当者が正しい窓口を入れられるようにする
- 宛先は既定で読み取り専用。「宛先を変更」を押したときだけ開く

### 送信記録のテーブル

```prisma
model GmailRequestMail {
  id String @id @default(cuid())
  createdAt DateTime @default(now())
  item GmailItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  itemId String
  fromAddress String / toAddress String
  subject String / body String @db.Text
  threadedTo String?            /// 返信として送ったスレッド。null なら新規メール
  sentGmailMessageId String? / sentGmailThreadId String?
  sentAt DateTime? / sentByEmail String
  error String?                 /// 失敗理由。行は残す（送れたか分からない状態の証拠）
  @@index([itemId]) @@index([toAddress])
}
```

`GmailItem` にも `requestSentAt` / `requestToAddress` / `requestAttemptCount` /
`lastRequestAttemptAt` / `requestError` を持たせる（一覧・集計のたびに結合しなくて済むように）。

---

## 8. テスト（すべてモック無しの純関数）

| ファイル | 内容 |
|---|---|
| `rfc2822.test.ts` | **`decodeMimeFilename(encodeHeaderWord(s)) === s` の往復**／長い日本語件名が折り返され各行76オクテット以下／**マルチバイト文字が語の境界で割れない**／**サロゲートペアが割れない**／ASCIIはエンコードしない／**`buildRfc2822` の出力全体が純ASCII**／本文を復号すると元に戻る／件名に `\n` を入れてもヘッダ行数が増えない／`to` に改行入りを渡すと拒否 |
| `scope.test.ts` | readonly だけなら `canSend:false`／順序違い・余分なスコープ混在でも不変／`validateGrantedScope` は readonly 必須・send 任意 |
| `requestTemplate.test.ts` | 全変数が置換／`{{ 取引先名 }}` の空白許容／**未知の変数はそのまま残る**／**差し込んだ値の中の `{{...}}` が再展開されない**／**値に `$&` が含まれても壊れない**／既定件名を展開すると元の件名と一致する |
| `threading.test.ts` | `Re:` の正規化／`canThread` の真偽 |
| `reply.test.ts` | 同スレッドの添付付き返信を検出／**自分の送信控え（From一致／SENTラベル）を返信と数えない**／添付なしは決着にしない／送信前のメールは対象外 |
| `replyWait.test.ts` | 6日 fresh ／7日 overdue ／14日 critical ／境界 |
| `status.test.ts`（追記） | 新3状態が分類表に載る／`REQUEST_SENT` は未返信=未決着・返信あり=決着／内訳の合計が崩れない |

見込み **約55件追加**。

---

## 9. 作業順序

**2 以外はすべて完了**（2 は依頼者の操作なので、こちらでは実行できない）。

1. ✅ `scope.ts` ＋ `GMAIL_SCOPES` に `gmail.send`／`validateGrantedScope` の必須を readonly に／
   `sendCapability()`／`GmailConnectionPanel` の決め打ち文字列を置換／`saveConnection` で古いトークンを revoke
2. ⬜ **依頼者に設定画面の「接続し直す」を1回押してもらう**（ここまでは既存の接続のまま動く）
3. ✅ Prisma: 状態3つ・`GmailItem` の送信列・`Setting` の3列・`GmailRequestMail`
   → `STATUS_CLASSIFICATION` に追記（**忘れると型エラーで止まる**。実際に止まった）
4. ✅ `rfc2822.ts` / `threading.ts` / `requestTemplate.ts` / `reply.ts` / `replyWait.ts` ＋ テスト
5. ✅ `client.ts` の `call()` 一般化 ＋ `sendMessage`（**再試行なし**）
6. ✅ 設定画面の文面フォーム
7. ✅ `/upload/requests` ＋ `SubTabs` に3つ目 ＋ Server Action
8. ✅ `ScanSummary` に「返信待ち N件（うち14日以上 M件）」の帯
9. ✅ README / `docs/PROGRESS.md` 更新

---

## 10. 検証（2026-09-15 実施。5 以外は確認済み）

1. ✅ 再接続前でも**取り込みが動き続ける**こと（送信だけができない）
2. ✅ 再接続後、依頼画面から**自分宛に**送って、件名・本文が**文字化けしていない**こと
   → **ここで不具合を1件発見**。全角スペース(U+3000)が半角に潰れていた（`\s` が U+3000 に
   マッチするため）。`sanitizeHeaderValue` を `[ \t]+` に修正し、回帰テストを追加
3. ✅ 元のスレッドに入ること（`In-Reply-To` に元メールの `Message-ID`、`threadId` が一致）
4. ✅ 送信後にもう一度押すと「既に送信済みです（日時）」で止まり、控えの行も増えないこと
5. ⬜ PDFを添付して返信 → 次の走査で請求書になり、依頼が決着すること
   （返信が実際に来ないと確かめられない。取引先への最初の依頼のときに目視する）
6. ✅ **送信直後に走査しても「返信が来た」にならないこと**（送信控えを `SENT`＋`From` で除外）
7. ✅ `{{` が残った本文では送信できないこと（画面のボタン無効化＋サーバー側でも拒否）

---

## 11. リスク

| リスク | 対策 |
|---|---|
| 誤送信 | 人の承認が必須／1件ずつ／最終アドレスを大きく表示／`{{` 残留でブロック／本文に金額・口座を書かない |
| 二重送信 | §3 の4層 |
| **noreply 宛先** | 実務上いちばん起きる。警告して宛先の差し替えを促す |
| 取引先の迷惑 | 一括送信なし／催促の自動送信なし／クールダウン警告／プレーンテキスト・URLなし |
| スパム判定 | Workspaceドメインで SPF/DKIM/DMARC は整っている／既存スレッドへの返信は強いham信号／月数通 |
| 送信の失敗 | 自動再試行なし。`REQUEST_FAILED` は未決着として残り、人がGmailの送信済みを確認してから操作 |
