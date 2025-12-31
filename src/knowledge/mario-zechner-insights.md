# Mario Zechner - Pi Coding Agent Insights

Source: mariozechner.at (December 2025)

## Core Philosophy: Minimal Tools

The pi coding agent uses only 4 core tools:
- **read** - Read file contents
- **write** - Write file contents
- **edit** - Edit existing files
- **bash** - Execute shell commands

Everything else is unnecessary complexity. MCP tools add overhead without proportional value for most coding operations.

## MCP vs CLI Conclusion

| Use MCP For | Use CLI For |
|-------------|-------------|
| Browser automation | File operations |
| Specialized APIs | Shell commands |
| Complex integrations | Simple HTTP requests |

**CLI advantages:**
- Simpler debugging
- No connection management
- More portable
- Fewer failure modes

## Human-in-the-Loop Pattern

Checkpoint hooks pause agent execution for human approval:

1. **before_tool** - Approve before executing tools
2. **after_response** - Review agent responses
3. **on_error** - Human intervention on errors

Benefits:
- Reduces runaway agent behavior
- Prevents costly mistakes
- Enables learning from corrections

## State Management

> "Prompts are code, .json/.md files are state"

- Agent state stored in `MEMORY.md` files
- Skills loaded from `SKILL.md` files (plain markdown)
- No databases needed for most agent state
- Context management via summarization, not RAG

## Provider Abstraction

Pi-ai package supports:
- OpenRouter (recommended for variety)
- Anthropic (direct API)
- Local models (Ollama)
- Groq, Cerebras (speed)

## Key Takeaways for Discord Bot

1. Keep tool surface minimal - resist adding tools
2. Use CLI over MCP for file/bash operations
3. Implement checkpoint hooks for sensitive operations
4. Store conversation state in MEMORY.md per channel
5. Skills as markdown files, loadable at runtime
