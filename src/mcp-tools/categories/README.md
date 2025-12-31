# MCP Tools Categories

This directory contains categorized MCP tools for lazy loading.

## Structure

Each category file exports a `getAll*Tools()` function that returns an array of `AgentTool<any>[]`.

## Categories

- **web-search.ts** - Web search, research, scraping (Exa, DuckDuckGo)
- **github.ts** - GitHub repos, issues, PRs, files, branches
- **memory.ts** - Memory storage, recall, knowledge graph
- **tasks.ts** - Task creation, scheduling, management
- **knowledge.ts** - Codebase analysis, RAG, skills
- **admin.ts** - Agent management, hooks, plugins, commands
- **voice.ts** - TTS, STT, voice channels, audio
- **media.ts** - Image, video, music, 3D generation
- **integrations.ts** - Twitter, YouTube, Telegram, HuggingFace
- **sandbox.ts** - Code execution, Docker, Python
- **utilities.ts** - User prefs, exports, embeds, misc

## Usage

Tools are imported from the main `mcp-tools.ts` file and re-exported in categories.
This allows the original file to remain unchanged while providing lazy loading capabilities.

```typescript
import { getAllWebSearchTools } from "./categories/web-search.js";

const tools = getAllWebSearchTools();
```
