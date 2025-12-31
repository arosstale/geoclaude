# PI-MONO Architecture & Patterns

## Overview

PI-MONO is a production-grade TypeScript monorepo for building multi-platform AI agents. Created by Mario Zechner, it demonstrates enterprise patterns for LLM-powered applications.

**Repository:** github.com/badlogic/pi-mono
**Upstream Version:** 0.30.2
**Discord-bot Uses:** 0.27.1
**License:** MIT

---

## Package Hierarchy

```
pi-mono/
├── packages/
│   ├── ai/              # Foundation - Unified LLM API
│   ├── tui/             # Foundation - Terminal UI library
│   ├── agent/           # Core - Stateful agent runtime (pi-agent-core)
│   ├── coding-agent/    # App - CLI coding agent
│   ├── mom/             # App - Slack bot
│   ├── pods/            # App - vLLM GPU deployment
│   ├── web-ui/          # App - Web components
│   └── discord-bot/     # App - Discord integration (this package)
```

### Dependency Flow
```
pi-ai (foundation) ──┬──> pi-agent-core ──> pi-coding-agent ──> apps
pi-tui (foundation) ─┘
```

---

## Package Details

### 1. @mariozechner/pi-ai (Foundation)

**Purpose:** Unified LLM API with automatic model discovery and provider configuration

**Key Features:**
- Provider abstraction (Anthropic, Google, OpenAI, Mistral)
- Auto-generated model registry from upstream sources
- OAuth helpers (GitHub Copilot, Google, Anthropic)
- Streaming with backpressure
- Tool schema validation (TypeBox + Ajv)

**Provider Structure:**
```typescript
providers/
├── anthropic.ts           # Claude models
├── google.ts              # Gemini models
├── google-gemini-cli.ts   # Gemini CLI OAuth
├── openai-completions.ts  # OpenAI completions API
└── openai-responses.ts    # OpenAI responses API
```

**Key Exports:**
```typescript
getModel(provider, modelId)  // Unified model access
streamSimple()               // Streaming responses
// OAuth utilities
authenticateWithAnthropic()
authenticateWithGitHubCopilot()
authenticateWithGoogle()
```

**Dependencies:** @anthropic-ai/sdk, @google/genai, openai, @mistralai/mistralai

---

### 2. @mariozechner/pi-tui (Foundation)

**Purpose:** Terminal User Interface library with differential rendering

**Key Features:**
- Efficient text-based applications
- Differential rendering (only update changed portions)
- Markdown rendering
- String width calculations (CJK support)

**Dependencies:** chalk, marked, string-width

---

### 3. @mariozechner/pi-agent-core (Core)

**Purpose:** Stateful agent with tool execution and event streaming

**Key Features:**
- Event-driven architecture
- Multiple transport protocols (MCP, A2A, ACP)
- Session state management
- Tool execution with streaming
- Context transformation and compaction

**Transport Protocols:**
| Protocol | Standard | Description |
|----------|----------|-------------|
| MCP | Anthropic | Model Context Protocol |
| A2A | Google/Linux Foundation | Agent2Agent Protocol |
| ACP | IBM/Linux Foundation | Agent Communication Protocol |

**Event Flow:**
```
prompt() → agent_start → turn_start → message_start →
message_update (streaming) → message_end →
tool_execution_start/end → turn_end → agent_end
```

**Agent Class:**
```typescript
const agent = new Agent({
  initialState: {
    systemPrompt: string,
    model: Model,
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
    tools: AgentTool[],
    messages: AgentMessage[],
  },
  convertToLlm: (messages) => Message[],      // Filter for LLM
  transformContext: (messages) => messages,    // Prune/compact
  queueMode: "one-at-a-time" | "all",
  streamFn: customStreamFunction,
  getApiKey: (provider) => apiKey,
});

// Methods
agent.prompt("Hello")
agent.continue()
agent.abort()
agent.waitForIdle()
agent.subscribe((event) => {})
```

**Message Types:**
- `user` - User input
- `assistant` - AI response
- `toolResult` - Tool execution result
- Custom types via declaration merging

---

### 4. @mariozechner/pi-coding-agent (App)

**Purpose:** CLI coding agent with read, bash, edit, write tools

**Key Features:**
- Session management
- File operations (read, write, edit)
- Bash command execution
- Hook system for extensibility
- Interactive TUI mode

**CLI:** `pi` command
**Config:** `.pi/` directory

**Dependencies:** pi-agent-core, pi-ai, pi-tui, diff, glob, marked

---

### 5. @mariozechner/pi-mom (App)

**Purpose:** Slack bot delegating to pi coding agent

**Key Features:**
- Slack Socket Mode integration
- Cron scheduling (croner)
- Anthropic sandbox runtime
- Diff-based response updates

**Dependencies:** @slack/socket-mode, @slack/web-api, croner

---

### 6. @mariozechner/pi-web-ui (App)

**Purpose:** Reusable web UI components for AI chat interfaces

**Key Features:**
- Lit/Web Components
- TailwindCSS styling
- PDF/DOCX preview
- Ollama/LMStudio integration

**Dependencies:** mini-lit, pdfjs-dist, docx-preview, xlsx

---

### 7. @mariozechner/pi-pods (App)

**Purpose:** CLI for managing vLLM deployments on GPU pods

**Key Features:**
- GPU pod orchestration
- vLLM deployment automation
- Model configuration management

---

## Architectural Patterns

### 1. Provider Abstraction Pattern

```typescript
// Single unified API for all providers
const model = getModel("anthropic", "claude-sonnet-4-20250514");
const model = getModel("google", "gemini-2.5-flash");
const model = getModel("openai", "gpt-4o");

// Same streaming interface regardless of provider
for await (const event of streamSimple(model, context, options)) {
  // Handle streaming events
}
```

### 2. Transport Protocol Pattern

```typescript
// Protocol-agnostic agent communication
const mcpTransport = createMCPTransport(config);
const a2aTransport = new A2ATransport(options);
const acpTransport = new ACPTransport(options);

// Discovery
const mcpServer = await discoverMCPServer(url);
const a2aAgent = await discoverA2AAgent(url);
const acpAgent = await discoverACPAgent(url);
```

### 3. Event Stream Pattern

```typescript
agent.subscribe((event) => {
  switch(event.type) {
    case "agent_start":
      // Agent begins processing
      break;
    case "message_start":
      // New message begins
      break;
    case "message_update":
      // Streaming delta (assistant only)
      const delta = event.assistantMessageEvent.delta;
      break;
    case "message_end":
      // Message complete
      break;
    case "tool_execution_start":
      // Tool begins
      break;
    case "tool_execution_update":
      // Tool streams progress
      break;
    case "tool_execution_end":
      // Tool complete with result
      break;
    case "turn_end":
      // Turn complete
      break;
    case "agent_end":
      // Agent complete
      break;
  }
});
```

### 4. Context Management Pattern

```typescript
const agent = new Agent({
  // Transform context before sending to LLM
  transformContext: async (messages, signal) => {
    // Prune old messages
    // Inject external context
    // Compact conversation
    return prunedMessages;
  },

  // Convert app messages to LLM format
  convertToLlm: (messages) => {
    return messages
      .filter(m => ["user", "assistant", "toolResult"].includes(m.role))
      .map(convertAttachments);
  },
});
```

### 5. Tool Definition Pattern

```typescript
import { Type } from "@sinclair/typebox";

const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    // Optional streaming progress
    onUpdate?.({
      content: [{ type: "text", text: "Reading..." }],
      details: {}
    });

    const content = await fs.readFile(params.path, "utf-8");

    return {
      content: [{ type: "text", text: content }],
      details: { path: params.path, size: content.length },
    };
  },
};
```

### 6. Message Queue Pattern

```typescript
// Interrupt agent during tool execution
agent.setQueueMode("one-at-a-time");

// While agent is running tools
agent.queueMessage({
  role: "user",
  content: "Stop! Do this instead.",
  timestamp: Date.now(),
});

// Result:
// 1. Remaining tools skipped with error results
// 2. Queued message injected
// 3. LLM responds to interruption
```

### 7. Platform Adaptation Pattern

Same agent core powers multiple platforms:

```typescript
// CLI (pi-coding-agent)
const cliAgent = new Agent({ streamFn: streamSimple });

// Slack (pi-mom)
const slackAgent = new Agent({ streamFn: streamSimple });
// Adapt events to Slack messages

// Discord (discord-bot)
const discordAgent = new Agent({ streamFn: streamSimple });
// Adapt events to Discord messages

// Web (pi-web-ui)
const webAgent = new Agent({ streamFn: streamProxy });
// Proxy through backend
```

---

## Key Techniques

### Auto-Generated Model Registry
```bash
npm run generate-models  # Fetches model info from providers
```
Creates `models.generated.ts` with pricing, context limits, capabilities.

### OAuth PKCE Flow
```typescript
// GitHub Copilot OAuth
const { accessToken } = await authenticateWithGitHubCopilot();

// Dynamic API key resolution
const agent = new Agent({
  getApiKey: async (provider) => {
    if (provider === "github-copilot") {
      return await refreshCopilotToken();
    }
    return process.env[`${provider.toUpperCase()}_API_KEY`];
  },
});
```

### Session Compaction
```typescript
// When context exceeds limits
const agent = new Agent({
  transformContext: async (messages) => {
    if (estimateTokens(messages) > MAX_TOKENS) {
      return compactOldMessages(messages);
    }
    return messages;
  },
});
```

### Hook System (pi-coding-agent)
```typescript
// Extensible behavior without modifying core
hooks/
├── checkpoint.ts    # Save/restore state
├── lsp.ts          # Language server integration
└── expert.ts       # Domain expertise injection
```

---

## Integration Points for Discord Bot

### 1. Use pi-agent-core directly
```typescript
import { Agent } from "@mariozechner/pi-agent-core";
```

### 2. Use pi-ai for model abstraction
```typescript
import { getModel, streamSimple } from "@mariozechner/pi-ai";
```

### 3. Implement MCP tools
```typescript
import { MCPTransport, createMCPTransport } from "@mariozechner/pi-agent-core";
```

### 4. Handle context overflow
```typescript
// Detect and recover from context_window_exceeded
if (error.includes("context_window_exceeded")) {
  await compactSession();
  // Retry
}
```

---

## Version History

- **0.30.2** - Current stable release
- Supports Node.js >= 20.0.0
- TypeScript 5.7.3+

---

## References

- [pi-mono GitHub](https://github.com/badlogic/pi-mono)
- [MCP Protocol](https://modelcontextprotocol.io)
- [A2A Protocol](https://github.com/google/A2A)
- [ACP Protocol](https://github.com/ibm/acp)
