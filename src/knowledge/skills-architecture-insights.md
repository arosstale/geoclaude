# Skills Architecture: The Next Evolution of Agent Tooling

Sources: Anthropic Engineering Blog, VRSEN AI, IndyDevDan, Mario Zechner

## Core Insight

**Skills are reusable on-demand workflows that make agents compound instead of starting from scratch every time.**

| Concept | Traditional | With Skills |
|---------|-------------|-------------|
| Token usage | 76k-150k tokens | 2k-8k tokens |
| Tool discovery | All upfront | Progressive/on-demand |
| Workflows | Reinvent each run | Saved and reused |
| Data handling | All through context | Filtered in sandbox |

## What Skills ARE

- Reusable on-demand scripts + instructions for specific workflows
- Folders containing SKILL.md + supporting code/templates
- The glue that chains tools together into reliable workflows
- Building blocks that compound over time

## What Skills are NOT

- NOT replacements for MCPs (MCPs still useful for external system access)
- NOT replacements for function calling (simple single-action tasks)
- NOT just prompts (skills become powerful with CODE)

## When to Use Skills

| Use Skills | Use Direct Tools |
|------------|------------------|
| Sequence of steps | Single action |
| Edge cases & iteration | Known schema, known output |
| Data transformations | Simple CRUD operations |
| Artifact generation (docs, decks) | Fetching/submitting records |
| Complex workflows | Predictable, debuggable ops |

## SKILL.md Pattern

```markdown
---
name: Skill Name
description: Trigger phrases and purpose
---

# Purpose
What this skill does

## Variables
FEATURE_FLAG: true/false

## Instructions
Step-by-step how to use

## Workflow
1. Step one
2. Step two

## Cookbook
### Scenario A
- IF: condition
- THEN: action
- EXAMPLES: trigger phrases
```

## Directory Structure

```
.claude/skills/<skill-name>/
├── SKILL.md           # Triggers, instructions, workflow
├── cookbook/          # Conditional tool selection
│   ├── tool-a.md
│   └── tool-b.md
├── prompts/           # Template prompts
│   └── summary.md
└── tools/             # Scripts
    └── main.py
```

## Code Execution with MCP (Anthropic Pattern)

Instead of loading all tool definitions upfront:

```typescript
// Traditional: 150k tokens for tool definitions
TOOL CALL: gdrive.getDocument(...)
TOOL CALL: salesforce.updateRecord(...)

// With code execution: 2k tokens
const doc = await gdrive.getDocument({...});
await salesforce.updateRecord({data: doc.content});
```

**Benefits:**
1. Progressive disclosure - load tools on-demand
2. Context-efficient - filter data in sandbox
3. Privacy-preserving - intermediate results stay in execution
4. State persistence - save to filesystem
5. Skill creation - save working code for reuse

## Safety Rules

1. **Lock skills directory** - agents cannot modify trusted skills
2. **Sandbox execution** - resource limits, monitoring
3. **Review before trust** - version skills in repo
4. **Human-in-the-loop** - checkpoints for sensitive ops

## Integration with Pi Coding Agent

Mario Zechner's philosophy aligns perfectly:

| Pi Philosophy | Skills Architecture |
|---------------|---------------------|
| Minimal tools (read, write, edit, bash) | Code execution over MCP bloat |
| CLI over MCP for basics | Progressive tool discovery |
| SKILL.md files as loadable instructions | Same SKILL.md pattern |
| State in .md/.json files | Filesystem-based state |
| Human checkpoints | Safety through review |

## Token Economics

| Scenario | Without Skills | With Skills | Reduction |
|----------|----------------|-------------|-----------|
| 2000 MCP tools | 150k tokens | 2k tokens | 98.7% |
| Complex workflow | 76k tokens | 8k tokens | 89.5% |
| Repeated task | Full cost each time | Amortized | 10x+ |

## Key Takeaways

1. **Skills = Workflows** - Not single actions, but chained operations
2. **Code is Key** - Skills without code are just prompts
3. **Compound Over Time** - Each skill is a reusable building block
4. **Safety First** - Lock directories, sandbox execution, review code
5. **Progressive Discovery** - Load tools only when needed
6. **Filter Early** - Process data in sandbox, not context window

## References

- Anthropic: https://www.anthropic.com/engineering/code-execution-with-mcp
- VRSEN Agency Swarm: https://github.com/VRSEN/agency-swarm
- Fork Terminal Skill: https://github.com/disler/fork-repository-skill
- Smithery MCP Servers: https://smithery.ai/
