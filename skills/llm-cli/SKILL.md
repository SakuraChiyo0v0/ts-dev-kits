# amechan-llm 大模型调用 CLI

让 AI 直接用 `amechan-llm` 命令行调用各种 LLM 提供商。OpenAI 兼容形态,支持 OpenAI/Anthropic/Gemini/DeepSeek/Groq 等 14+ 家。

## 环境检查

```bash
amechan-llm help          # 查看命令
amechan-llm providers     # 列出所有提供商
```

未安装:`npm i -g @amechan/llm`。

## 命令速查

### 聊天(非流式)

```bash
amechan-llm chat --provider openai --model gpt-4o --prompt "你好"
amechan-llm chat --provider deepseek --model deepseek-chat --prompt "写首诗" --system "你是诗人"
amechan-llm chat --provider groq --model llama-3.3-70b-versatile --prompt "hi"
```

### 流式输出

```bash
amechan-llm stream --provider anthropic --model claude-sonnet-4 --prompt "讲个故事"
```

### 原生提供商 vs 注册表

- 原生适配器:`openai`、`anthropic`、`gemini`、`azure`
- 注册表(OpenAI 兼容):`deepseek`、`moonshot`、`zhipu`、`groq`、`together`、`fireworks`、`openrouter`、`perplexity`、`mistral`、`aliyun`、`ollama`、`vllm`、`lmstudio`

## API Key 配置

```bash
# 命令行传(不推荐,会出现在进程列表)
amechan-llm chat --provider openai --model gpt-4o --prompt "hi" --api-key sk-xxx

# 环境变量(推荐)
export OPENAI_API_KEY=sk-xxx
amechan-llm chat --provider openai --model gpt-4o --prompt "hi"
```

环境变量名 = `{PROVIDER大写}_API_KEY`(如 `DEEPSEEK_API_KEY`、`GROQ_API_KEY`)。

## 任务配方

### 快速翻译

```bash
amechan-llm chat --provider openai --model gpt-4o --prompt "把这段翻译成英文: 你好世界" --system "你是专业翻译"
```

### 流式写作

```bash
amechan-llm stream --provider deepseek --model deepseek-chat --prompt "写一篇500字文章"
```

### 本地模型(Ollama)

```bash
amechan-llm chat --provider ollama --model llama3.1 --prompt "hi"   # 本地 Ollama 服务
```

### JSON 输出(便于脚本解析)

```bash
amechan-llm chat --provider openai --model gpt-4o --prompt "hi" --json
```

## 陷阱清单

- **必须提供 API key**:`--api-key` 或环境变量,否则报错。
- **provider 名大小写敏感**:小写(`openai` 不是 `OpenAI`)。
- **模型名要匹配提供商**:如 DeepSeek 用 `deepseek-chat`,Groq 用 `llama-3.3-70b-versatile`。
- **ollama/vllm/lmstudio 是本地服务**,需先启动本地服务。
- **azure 需要 baseUrl 和 deployment**(CLI 暂未完整支持 azure 参数,建议用 SDK)。

## 验证

- chat 成功输出模型回复文本。
- `--json` 输出完整响应对象。
- `stream` 边输出边打印,结束换行。
