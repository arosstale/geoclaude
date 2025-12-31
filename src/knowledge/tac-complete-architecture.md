# TAC Complete Architecture: The Irreplaceable Engineer Stack

Sources: IndyDevDan TAC-12, VRSEN AI, Anthropic Engineering, Mario Zechner

## The Three GOATs

| Expert | Domain | Key Contribution |
|--------|--------|------------------|
| Simon Willison | LLM tooling pioneer | Datasette, llm CLI, sqlite-utils |
| Dan (IndyDevDan) | Agentic coding patterns | TAC-12, 6 Agentic Properties |
| Daniel Miessler | AI augmentation | Fabric patterns (242+) |

## The 6 Agentic Properties (IndyDevDan)

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENTIC AGENT SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│  BASE LEVEL (What agents DO)                                    │
│  ├── ALIGNMENT    → Domain experts (expertise/*.md)             │
│  ├── AUTONOMY     → YOLO mode, minimal oversight                │
│  └── DURABILITY   → Checkpoints, crash recovery                 │
├─────────────────────────────────────────────────────────────────┤
│  META LEVEL (How agents EVOLVE)                                 │
│  ├── SELF-IMPROVEMENT  → Act-Learn-Reuse cycle                  │
│  ├── SELF-REPLICATION  → Spawn specialized agents               │
│  └── SELF-ORGANIZATION → Metrics-based optimization             │
└─────────────────────────────────────────────────────────────────┘
```

## The Compute Advantage Formula

```
Compute Advantage = (Compute Scaling × Autonomy) / (Time + Effort + Cost)
```

## Act-Learn-Reuse Cycle

```
┌─────────────────────────────────────────┐
│  TURN START                             │
│  └── expert-hook.ts loads expertise     │
│      "You previously learned..."        │
│                                         │
│  TASK EXECUTION                         │
│  └── Agent applies knowledge            │
│                                         │
│  TURN END                               │
│  └── Extract new insights               │
│      Append to expertise/*.md           │
└─────────────────────────────────────────┘
```

**Timeline:**
- Session 1: Agent struggles, figures it out, learns
- Session 10: Agent is domain expert with 50+ learnings
- Session 100: Agent teaches other agents via swarm

## Expertise Domains

| Domain | Purpose | Examples |
|--------|---------|----------|
| security.md | Auth patterns | JWT, bcrypt, sessions |
| trading.md | Market signals | Risk, orders, indicators |
| database.md | Query optimization | Indexes, pooling, migrations |
| billing.md | Payment processing | Stripe, invoices, refunds |
| api_integration.md | External APIs | Rate limits, auth, retries |
| performance.md | Optimization | Caching, profiling, lazy loading |

## Progressive Tool Discovery

```
┌─────────────────────────────────────────────────────────────────┐
│  SMITHERY MCP REGISTRY                                          │
│  ├── 927 MCP servers                                            │
│  ├── 13,062 total tools                                         │
│  └── data/smithery-mcp-servers.json (12MB)                      │
├─────────────────────────────────────────────────────────────────┤
│  DISCOVERY FLOW                                                 │
│  1. Agent receives task                                         │
│  2. search_tools("salesforce email") → relevant MCPs            │
│  3. Load only needed tool definitions                           │
│  4. Write code combining tools                                  │
│  5. Execute in sandbox                                          │
│  6. Save as skill for reuse                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Token Economics

| Scenario | Without Skills | With Skills | Savings |
|----------|----------------|-------------|---------|
| First run | 76,000 tokens | 76,000 tokens | - |
| Second run | 76,000 tokens | 8,000 tokens | 89% |
| 10th run | 760,000 tokens | 80,000 tokens | 89% |
| 100 agents × 10 tasks | 76M tokens | 8.6M tokens | 89% |

## Mario Zechner Philosophy Integration

```
┌─────────────────────────────────────────────────────────────────┐
│  APPARENT CONTRADICTION RESOLVED                                │
│                                                                 │
│  Mario says: "4 tools only"                                     │
│  Your bot:   89+ MCP tools                                      │
│                                                                 │
│  [PERF] Using 6/126 tools for message                          │
│                                                                 │
│  The bot FILTERS. Only relevant tools enter context.            │
│  Progressive disclosure in action.                              │
│                                                                 │
│  Mario's SPIRIT preserved:                                      │
│  ├── Minimal context pollution                                  │
│  ├── Tools loaded on-demand                                     │
│  ├── Bash as universal escape hatch                             │
│  └── Full observability                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Skills Architecture (VRSEN AI + Anthropic)

```
.claude/skills/<skill-name>/
├── SKILL.md           # Triggers, workflow, cookbook
├── cookbook/          # Conditional tool selection
├── prompts/           # Template prompts
└── tools/             # Scripts (Python/JS)
```

**Pattern:**
```
explore → execute → save as skill → reuse
         (costly)                  (cheap)
```

## Complete Integration Architecture

```
Layer 1: MCP Discovery (927+ services)
    ↓
Layer 2: Tool Factory (callable interface)
    ↓
Layer 3: Code Executor (agent-written code)
    ↓
Layer 4: Learning System (expertise/*.md)
    ↓
Layer 5: Skills Library (reusable workflows)
    ↓
Layer 6: Orchestrator (intelligent routing)
    ↓
Layer 7: Multi-Agent Network (swarm coordination)
```

## 3 Defensive Layers

```
LAYER 1: SESSION LOADING
└── Validates content on load from session.jsonl

LAYER 2: TOOL WRAPPERS (safeTool)
└── Normalizes tool results before processing

LAYER 3: MESSAGE TRANSFORMER
└── Final filter before API call
```

## The Compound Effect

```
Week 1:   Agent = Generic assistant
Week 4:   Agent = Knows your patterns
Week 12:  Agent = Domain expert
Week 52:  Agent = Irreplaceable team member

expertise/*.md grows like a second brain
Every mistake becomes future prevention
Every success becomes reusable pattern
```

## Quick Reference

```bash
# View expertise
cat src/agents/expertise/security.md

# Run with Act-Learn-Reuse
node agents/learning-agent-standalone.js alr "Implement JWT auth"

# Check MCP servers
jq 'length' data/smithery-mcp-servers.json  # 927

# Search for specific MCPs
jq '.[] | select(.server_name | contains("Slack"))' data/smithery-mcp-servers.json
```

## Key Files

| File | Purpose |
|------|---------|
| `data/smithery-mcp-servers.json` | 927 MCP servers (12MB) |
| `src/agents/expertise/*.md` | Accumulated domain knowledge |
| `src/agents/hooks/expert-hook.ts` | ACT phase - load expertise |
| `src/agents/hooks/learning-hook.ts` | LEARN phase - extract insights |
| `src/knowledge/skills-architecture-insights.md` | Skills reference |
| `src/knowledge/mario-zechner-insights.md` | Pi philosophy |
