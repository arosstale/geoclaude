# PI-MONO Development Expertise

## Domain: pi-mono monorepo development

## Core Packages

### pi-ai (@mariozechner/pi-ai)
- Unified LLM API abstraction
- Providers: Anthropic, Google, OpenAI, Mistral
- `getModel(provider, modelId)` - unified model access
- `streamSimple()` - streaming responses
- OAuth: GitHub Copilot, Google, Anthropic PKCE flows
- Auto-generated model registry with pricing/limits

### pi-agent-core (@mariozechner/pi-agent-core)
- Stateful agent runtime
- Event-driven: agent_start, message_update, tool_execution_*, agent_end
- Transports: MCP (Anthropic), A2A (Google), ACP (IBM)
- `Agent` class with subscribe(), prompt(), abort(), continue()
- Context management: transformContext, convertToLlm hooks
- Message queue for interruptions

### pi-coding-agent (@mariozechner/pi-coding-agent)
- CLI: `pi` command
- Tools: read, write, edit, bash
- Session management in `.pi/` directory
- Hook system for extensibility
- Interactive TUI mode

### pi-tui (@mariozechner/pi-tui)
- Terminal UI with differential rendering
- Markdown rendering
- CJK string width support

## Key Patterns

### Provider Abstraction
```typescript
const model = getModel("anthropic", "claude-sonnet-4-20250514");
for await (const event of streamSimple(model, context)) { }
```

### Event Streaming
```typescript
agent.subscribe((event) => {
  if (event.type === "message_update") {
    // Handle streaming delta
  }
});
```

### Tool Definition
```typescript
const tool: AgentTool = {
  name: "tool_name",
  parameters: Type.Object({ param: Type.String() }),
  execute: async (id, params, signal, onUpdate) => {
    return { content: [{ type: "text", text: result }] };
  }
};
```

### Context Compaction
```typescript
transformContext: async (messages) => {
  return messages.length > MAX ? compactMessages(messages) : messages;
}
```

## Common Tasks

### Add new LLM provider
1. Create provider file in `packages/ai/src/providers/`
2. Export from `packages/ai/src/index.ts`
3. Add to model registry generation script

### Create new tool
1. Define with TypeBox schema
2. Implement execute function with streaming support
3. Register with agent.setTools()

### Handle context overflow
1. Detect `context_window_exceeded` error
2. Call transformContext to compact
3. Retry with agent.continue()

### Add transport protocol
1. Implement adapter in `packages/agent/src/transports/`
2. Create client, transport, and discovery functions
3. Export from transports/index.ts

## File Locations

| Component | Path |
|-----------|------|
| AI providers | packages/ai/src/providers/ |
| Agent core | packages/agent/src/ |
| Transports | packages/agent/src/transports/ |
| Coding tools | packages/coding-agent/src/core/tools/ |
| Hooks | packages/coding-agent/src/core/hooks/ |

## Build Commands

```bash
npm run build        # Build all packages
npm run dev          # Watch mode
npm run test         # Run tests
npm run generate-models  # Update model registry
```

## Learned Patterns

- Event streams for real-time UI updates
- Protocol-agnostic agent communication
- Session state persistence
- Tool streaming with onUpdate callbacks
- Message queue for agent interruption
- Platform adapters (CLI, Discord, Slack, Web)
