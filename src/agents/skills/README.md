# Agent Skills Specification Loader

Port of pi-mono v0.25.3 coding-agent skills loader for Agent Skills specification.

See: https://agentskills.io/specification

## Overview

This module provides discovery, loading, validation, and formatting of Agent Skills from standard paths:

1. `~/.claude/skills` (claude-user) - User-level Claude skills
2. `./.claude/skills` (claude-project) - Project-level Claude skills
3. `~/.pi/agent/skills` (pi-user) - User-level Pi skills
4. `./.pi/skills` (pi-project) - Project-level Pi skills
5. Custom directories via config

## Quick Start

```typescript
import { getSkillsLoader } from "./agents/skills/index.js";

// Get singleton loader
const loader = getSkillsLoader({
  enableClaudeProject: true,
  includeSkills: ["trading", "research"],
});

// Load skills
const { skills, warnings } = loader.load();

// Format for agent prompt
const promptAddition = loader.formatForPrompt();

// Filter by pattern
const tradingSkills = loader.filter(["trading*"]);
```

## Skill File Format

Skills are defined in `SKILL.md` files with YAML frontmatter:

```markdown
---
name: trading
description: Expert trading analysis and market signal detection. USE WHEN user mentions trading, market, signals, or price action.
license: MIT
compatibility: pi-agent-*
allowed-tools: web_search, web_scrape, crypto_price
metadata: {"version": "1.0", "author": "majinbu"}
---

# Trading Analysis Skill

You are an expert quantitative trader with deep knowledge of...

[Full skill content with instructions, examples, best practices]
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase skill name matching directory (a-z, 0-9, hyphens) |
| `description` | Yes | Brief description (max 1024 chars) with USE WHEN trigger |
| `license` | No | License identifier (e.g., MIT, Apache-2.0) |
| `compatibility` | No | Compatible agent versions (e.g., pi-agent-*) |
| `allowed-tools` | No | Comma-separated list of permitted tools |
| `metadata` | No | JSON object with additional metadata |

### Naming Rules

- Must match parent directory name
- Lowercase only (a-z, 0-9, hyphens)
- Max 64 characters
- No leading/trailing hyphens
- No consecutive hyphens

## Directory Structure

```
.claude/skills/
├── trading/
│   └── SKILL.md          # Trading analysis skill
├── research/
│   └── SKILL.md          # Web research skill
└── github/
    └── SKILL.md          # GitHub operations skill
```

## API Reference

### `getSkillsLoader(options?)`

Returns singleton `SkillsLoader` instance.

```typescript
const loader = getSkillsLoader({
  enableClaudeUser: false,
  enableClaudeProject: true,
  includeSkills: ["trading", "research"],
  ignoredSkills: ["test-*"],
});
```

### `SkillsLoader` Class

#### Methods

- `load(force?: boolean)` - Load skills (uses cache unless force=true)
- `reload()` - Force reload from disk
- `getSkills()` - Get loaded skills array
- `getWarnings()` - Get validation warnings
- `formatForPrompt()` - Format as XML for agent system prompt
- `filter(patterns: string[])` - Filter by glob patterns

### `loadSkills(options)`

Load skills from all configured paths (non-singleton).

### `parseSkillFile(path, source?)`

Parse a single SKILL.md file.

### `filterSkills(skills, patterns)`

Filter skills array by glob patterns.

### `formatSkillsForPrompt(skills)`

Format skills as XML for agent prompt injection.

## Integration with Agents

### Lightweight Agent

```typescript
import { runLearningAgent } from "./agents/index.js";
import { getSkillsLoader } from "./agents/skills/index.js";

const loader = getSkillsLoader();
const skillsPrompt = loader.formatForPrompt();

const result = await runLearningAgent({
  prompt: `${skillsPrompt}\n\nUser request: Analyze BTC price action`,
  mode: "trading",
});
```

### OpenHands Agent

```typescript
import { runOpenHandsAgent } from "./agents/index.js";
import { getSkillsLoader } from "./agents/skills/index.js";

const tradingSkills = getSkillsLoader().filter(["trading"]);

await runOpenHandsAgent({
  task: `Trading analysis with skills: ${tradingSkills[0].path}`,
  mode: "developer",
});
```

## Example Skills Included

### Trading Skill

- Technical analysis framework (RSI, MACD, patterns)
- On-chain metrics (whale movements, liquidity)
- Signal generation (entry, SL, TP, R:R)
- Risk management (position sizing, black swans)

**Trigger:** trading, market, signals, price action, technical indicators

### Research Skill

- Multi-source information gathering
- Source credibility evaluation (authority, accuracy, currency)
- Synthesis and contradiction resolution
- Quality standards (3+ sources, confidence levels)

**Trigger:** research, find, investigate, compare, analyze

### GitHub Skill

- Repository analysis and code review
- PR creation and management
- Issue tracking and project boards
- Security checklist (secrets, XSS, SQL injection)

**Trigger:** GitHub, repositories, pull requests, code review, Git

## Validation

Skills are validated against the Agent Skills specification:

- Name matches directory (lowercase, max 64 chars)
- Description present (max 1024 chars)
- No unknown frontmatter fields
- Valid YAML syntax
- Proper file structure

Warnings are non-blocking but should be addressed for compliance.

## Testing

Run the test loader:

```bash
npx tsx src/agents/skills/test-loader.ts
```

Expected output:
```
Loaded 3 skills:
  - trading (claude-project): Expert trading analysis...
  - research (claude-project): Comprehensive web research...
  - github (claude-project): GitHub repository operations...
```

## Advanced Usage

### Custom Discovery Paths

```typescript
const loader = getSkillsLoader({
  customDirectories: [
    "/path/to/my/skills",
    "~/company-skills",
  ],
});
```

### Glob Filtering

```typescript
// Include only trading and crypto skills
const skills = loader.filter(["trading*", "crypto*"]);

// Exclude test skills
const loader = getSkillsLoader({
  ignoredSkills: ["test-*", "*-deprecated"],
});
```

### Skill Collision Handling

Skills with duplicate names are skipped (first one wins):

```
Warnings (1):
  - /path/skill2.md: name collision: "trading" already loaded from /path/skill1.md
```

## Roadmap

- [ ] Add `/skills` slash command to Discord bot
- [ ] Skill hot-reload on file change
- [ ] Skill versioning and compatibility checks
- [ ] Skill marketplace integration
- [ ] Auto-skill selection via RAG similarity
- [ ] Skill composition (skill depends on skill)

## Related

- **Agent Experts** (`src/agents/agent-experts.ts`) - Codebase domain experts
- **Skill Manager** (`src/agents/skill-manager.ts`) - Letta/Pi hybrid implementation
- **Act-Learn-Reuse** (`src/agents/expertise-manager.ts`) - Learning system

This loader is the canonical Agent Skills spec implementation. Use Skill Manager for Letta-style bundled skills.
