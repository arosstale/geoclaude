# CLAUDE.md - Discord Bot

## Build & Development

```bash
npm run dev          # Development (hot reload)
npm run build        # Build TypeScript
npm run type-check   # Type checking only
npm run lint:fix     # Lint and fix
npm run format       # Format code
npx vitest run       # All tests
npm run migrate      # Database migrations
npm start            # Production (requires build)
```

Makefile: `make help` lists all targets.

## Architecture

Full-featured Discord bot with pi-mono agent framework. 89+ MCP tools, bash execution, file operations, voice channels, persistent memory.

### Core Dependencies
- `@mariozechner/pi-agent-core` - Agent runtime
- `@mariozechner/pi-ai` - AI model abstraction
- `discord.js` - Discord API
- `better-sqlite3` - SQLite (WAL mode)

### Key Files
| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point, Discord client, slash commands (2500+ lines) |
| `src/mcp-tools.ts` | 89+ MCP tool implementations |
| `src/database.ts` | SQLite persistence layer |
| `src/scheduler.ts` | Cron-based task scheduling |
| `src/webhook-server.ts` | External alert/signal endpoints |

### Directory Structure
```
src/
├── main.ts, mcp-tools.ts, database.ts
├── trading/          # Multi-agent trading (orchestrator, consensus, agents)
├── voice/            # TTS/STT (vibevoice.ts, whisper-local.ts)
├── agents/           # AI integrations
│   ├── hooks/        # checkpoint, lsp, expert hooks
│   ├── skills/       # SKILL.md loader, aitmpl.com sync
│   ├── expertise/    # Per-domain learning files
│   ├── openhands-*.  # OpenHands SDK integration
│   ├── claude-agent.ts, lightweight-agent.ts
│   ├── research-orchestrator.ts, ctm-agent.ts, dgm-agent.ts
│   └── autonomous-daemon.ts, self-debug.ts
├── music/            # Suno AI integration
└── knowledge/        # RAG knowledge base
```

## Agent Systems

### Slash Commands (Key)
| Command | Description |
|---------|-------------|
| `/openhands run` | Expert-mode software development |
| `/expert run` | Domain expert with learning |
| `/task run` | Two-phase agent workflow |
| `/research start/stop` | 24/7 autonomous research |
| `/daemon start` | Self-improving autonomous daemon |
| `/hooks status` | Hook system health |
| `/selfdebug status` | Autonomous error repair status |

### Agent Experts (Act-Learn-Reuse)
Domains: security, database, trading, billing, api_integration, performance

### Model Providers
1. OpenRouter (default) - Best agentic
2. OpenCode SDK - Free Grok
3. Cerebras - Fastest (2100+ tok/s)
4. Groq - Free tier
5. Z.ai - GLM-4.6 coding
6. Ollama - Local models

## Configuration

**Required:**
- `DISCORD_BOT_TOKEN`
- `OPENROUTER_API_KEY` (recommended)
- `ZAI_API_KEY` (for OpenHands)

**Optional:**
- `GROQ_API_KEY`, `CEREBRAS_API_KEY`
- `GITHUB_TOKEN`, `HF_TOKEN`
- `WEBHOOK_PORT` (default: 3001)
- `ALLOWED_USER_IDS` (comma-separated)

## Database Schema

Tables: users, alerts, command_history, settings, scheduled_tasks, semantic_memories, tool_metrics

Semantic memories use 384-dim embeddings (all-MiniLM-L6-v2).

## Workspace Structure

```
<data_dir>/
├── MEMORY.md           # Global memory
├── knowledge/          # RAG documents
├── skills/             # Loadable skills
├── <channel_id>/       # Per-channel state
│   ├── MEMORY.md, log.jsonl, scratch/
└── bot.db              # SQLite database
```

## Testing

Tests use Vitest. Run: `npx vitest run`
