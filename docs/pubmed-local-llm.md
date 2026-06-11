# PubMed AI要約のローカルLLM運用

PubMedの日次更新は、OpenAI APIだけでなく、OllamaやLM StudioなどのOpenAI互換Chat Completions APIにも接続できます。

## 使い分け

- GitHub Actionsでそのまま毎朝7:00に動かす場合: `OPENAI_API_KEY` または `AI_API_KEY` をGitHub Secretsに保存して使います。
- OpenAIのquotaやbillingが止まる場合: 自分のPCやサーバーでOllama/LM Studioを動かし、ローカルLLMで要約します。
- GitHub-hosted runnerから `http://127.0.0.1:11434` は見えません。これはGitHub上の仮想マシン自身のlocalhostなので、自宅PCのOllamaには届きません。

## ローカルOllamaで手動実行

Ollamaを起動して、要約用モデルを用意します。

```powershell
ollama pull qwen2.5:14b
npm run pubmed:update:local:ollama
npm test
npm run build
```

生成結果は `src/pubmedGenerated.ts` に入ります。公開サイトへ反映するには、その変更をGitHubへpushし、Netlifyのdeployが通る必要があります。

## ローカルLLM用の環境変数

`.github/pubmed/update_pubmed_local_ollama.ps1` は、未設定の場合に次の値を使います。

```powershell
$env:AI_ENDPOINT_MODE = "chat"
$env:AI_BASE_URL = "http://127.0.0.1:11434/v1"
$env:AI_MODEL = "qwen2.5:14b"
$env:AI_API_KEY = "local"
```

LM StudioやvLLMなどに切り替える場合は、`AI_BASE_URL` と `AI_MODEL` を変更します。

## 毎朝自動でローカルLLMを使う選択肢

1. GitHub self-hosted runnerを自宅PCまたは常時起動サーバーに入れる。
2. Windowsタスクスケジューラで `npm run pubmed:update:local:ollama` を毎朝実行し、生成後にcommit/pushするジョブを作る。
3. ローカルLLMを安全な認証付きエンドポイントとして外部公開し、GitHub Actionsから `AI_BASE_URL` で呼ぶ。

最も扱いやすいのは1です。2はPCが起動している必要があります。3はセキュリティ設計が必要なので、特別な理由がない限り避けます。

## GitHub Actionsで使う変数

Workflowは以下を読みます。

- `AI_ENDPOINT_MODE`: `responses` または `chat`
- `AI_BASE_URL`: OpenAI互換APIのbase URL
- `AI_MODEL`: 使うモデル名
- `AI_API_KEY`: OpenAI以外の互換APIキーが必要な場合
- `OPENAI_API_KEY`: OpenAI API用
- `OPENAI_BASE_URL`: OpenAI API以外のbase URLをOpenAI名で渡したい場合
- `OPENAI_MODEL`: OpenAI API用モデル名

OpenAIのキーはSecretsに入れます。モデル名やbase URLは漏れても困りにくいので、通常はRepository Variablesで十分です。
