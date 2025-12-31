# The Four GOATs: Irreplaceable Engineer Stack Research

## Overview

| Expert | Domain | Key Creation | Stars | Philosophy |
|--------|--------|--------------|-------|------------|
| Mario Zechner | Agent Framework | Pi-Mono, Pi-Agent-Core | 775 | 4 tools only, YOLO mode, minimal context |
| Simon Willison | LLM Tooling | Datasette, LLM CLI, sqlite-utils | 10.6k each | CLI > Web, SQLite for everything |
| IndyDevDan | Agentic Coding | TAC (8 Tactics), 12 Leverage Points | 2k+ | Build systems that build systems |
| Daniel Miessler | AI Augmentation | Fabric (37k), SecLists (67.8k), PAI | 100k+ | Human flourishing via AI |

---

## Mario Zechner (@badlogic)

**Background:**
- Austrian developer, 20+ years experience in R&D, startups, gaming, compiler development
- Creator of libGDX game framework (24.6k stars) - 2010
- Author of "Beginning Android Games" (Apress, 2011-2016)
- Former RoboVM engineer (ahead-of-time Java-to-iOS compiler)
- Current: Self-employed software developer, coach, and angel investor

**Key Projects:**
| Project | Stars | Purpose |
|---------|-------|---------|
| [pi-mono](https://github.com/badlogic/pi-mono) | 775 | AI agent toolkit monorepo |
| [pi-skills](https://github.com/badlogic/pi-skills) | - | Skills for pi coding agent |
| [pi-terminal-bench](https://github.com/badlogic/pi-terminal-bench) | - | Terminal-Bench evaluation harness |
| [libGDX](https://github.com/libgdx/libgdx) | 24.6k | Cross-platform game framework |

**Pi-Mono Package Structure:**
| Package | Purpose |
|---------|---------|
| @mariozechner/pi-ai | Unified multi-provider LLM API |
| @mariozechner/pi-agent | Agent runtime with tool invocation |
| @mariozechner/pi-agent-core | Agent loop handling, event streaming |
| @mariozechner/pi-coding-agent | Interactive CLI coding agent |
| @mariozechner/pi-mom | Slack bot integration |
| @mariozechner/pi-tui | Terminal UI with differential rendering |
| @mariozechner/pi-web-ui | Web components for chat interfaces |
| @mariozechner/pi-pods | vLLM management on GPU pods |

**Core Philosophy - 4 Tools Only:**
```
read  → Read file contents with offset/limit
write → Create or overwrite files
edit  → Precise text replacements
bash  → Execute any command

"If I don't need it, it won't be built."
```

**What Mario Rejects vs His Alternative:**
| Rejected | His Alternative |
|----------|-----------------|
| Built-in todos | Task tracking in prompts confuses models |
| Plan mode | Persistent planning via markdown files |
| MCP support | CLI tools with README documentation |
| Background bash | Tmux handles this more elegantly |
| Sub-agents | Spawn multiple agents creates "garbage code" |
| Security theater | YOLO mode default - comprehensive protection impossible |

**Key Insights:**
- System prompt under 1,000 tokens (vs Claude Code's 10,000+)
- Supplemented only by optional project-specific AGENTS.md files
- Achieved competitive Terminal-Bench 2.0 performance despite minimalism
- "Context engineering is paramount"
- "Security measures in coding agents are mostly theater"

**Multi-Provider Support:**
- Anthropic, OpenAI, Google, xAI
- Groq, Cerebras, OpenRouter
- Any OpenAI-compatible endpoint (Ollama, vLLM)
- Context handoff between providers works

**Links:**
- Website: https://mariozechner.at
- GitHub: https://github.com/badlogic
- Twitter: @badlogicgames
- LibGDX: https://libgdx.com

---

## Simon Willison (@simonw)

**Background:**
- Co-created Django web framework (2003-2005) at Lawrence Journal-World
- Former Yahoo! engineer (Fire Eagle), The Guardian software architect (2008)
- Former Eventbrite engineering director
- Co-founded Lanyrd (Y Combinator 2011), acquired by Eventbrite 2013
- Python Software Foundation board member since 2022
- Coined the term "prompt injection" in September 2022
- 912 GitHub repositories, 11.7k followers

**Key Repositories:**
| Tool | Stars | Description |
|------|-------|-------------|
| [datasette](https://github.com/simonw/datasette) | 10.6k | Open source multi-tool for exploring and publishing data |
| [llm](https://github.com/simonw/llm) | 10.6k | CLI tool and Python library for accessing LLMs |
| [files-to-prompt](https://github.com/simonw/files-to-prompt) | 2.6k | Concatenate directory contents into single prompt |
| [shot-scraper](https://github.com/simonw/shot-scraper) | 2.2k | Automated website screenshots via command line |
| [sqlite-utils](https://github.com/simonw/sqlite-utils) | 2k | CLI utility and library for manipulating SQLite |
| [sqlite-migrate](https://github.com/simonw/sqlite-migrate) | - | Simple database migration system for SQLite |

**LLM CLI Recent Releases (2024-2025):**
| Version | Date | Key Feature |
|---------|------|-------------|
| 0.27 | Aug 2025 | GPT-5 family support, tools in templates |
| 0.26 | May 2025 | Tool support - LLMs execute Python functions |
| 0.25 | May 2025 | Video processing - feed videos as JPEG sequences |
| 0.24 | Apr 2025 | Long context via fragments and template plugins |
| 0.23 | Feb 2025 | Structured data extraction using schemas |

**LLM Plugin Ecosystem:**
| Category | Plugins | Description |
|----------|---------|-------------|
| Local Models | llm-ollama, llm-gguf, llm-mlx, llm-llamafile | Run models locally |
| Remote APIs | llm-anthropic, llm-gemini, llm-groq, llm-openrouter | Cloud-hosted models |
| Tools | llm-tools-sqlite, llm-tools-datasette, llm-tools-exa | External tool access |
| Fragments | llm-fragments-github, llm-fragments-pdf, llm-video-frames | Load from sources |
| Embeddings | llm-sentence-transformers, llm-clip, llm-embed-jina | Vector embeddings |

**sqlite-utils Features:**
| Feature | Description |
|---------|-------------|
| Insert/Import | Auto-create tables from JSON, CSV, TSV with schema detection |
| Upsert | INSERT ... ON CONFLICT SET for merge operations |
| Memory Queries | Run SQL against in-memory data from files |
| Full-Text Search | Configure and run FTS queries ordered by relevance |
| Schema Transform | Change column types without manual migration |

**Philosophy:**
- 50-year-old Unix command line is "the perfect environment to play around with cutting edge AI"
- All prompts and responses logged to SQLite for analysis and reproducibility
- Plugin-based architecture enables community extension without core bloat
- "Writing good automated evals for LLM-powered systems is the skill that's most needed"

**2024 Key Insights:**
- GPT-4 monopoly ended: 18 organizations now exceed original GPT-4 capabilities
- Costs dropped 800x: $0.0375/M tokens vs GPT-4's original pricing
- Local execution viable: GPT-4-class models run on consumer MacBooks
- Multimodal (vision, audio, video) became standard

**Links:**
- Blog: https://simonwillison.net
- GitHub: https://github.com/simonw
- LLM Docs: https://llm.datasette.io
- TIL: https://til.simonwillison.net

---

## IndyDevDan (@disler)

**Background:**
- Senior software engineer "betting the next 10 years on AGENTIC software"
- 15+ years shipping production code
- YouTube @indydevdan - ~13.7k subscribers
- GitHub: disler - 2.8k followers
- Creator of Principled AI Coding (PAIC) and Tactical Agentic Coding (TAC)

**Key Repositories:**
| Repository | Stars | Description |
|------------|-------|-------------|
| [claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) | 2,000 | Comprehensive Claude Code hooks with 8 lifecycle events |
| [always-on-ai-assistant](https://github.com/disler/always-on-ai-assistant) | 957 | Always-on AI using Deepseek-V3, RealtimeSTT |
| [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | 864 | Real-time monitoring for Claude Code agents |
| [multi-agent-postgres-data-analytics](https://github.com/disler/multi-agent-postgres-data-analytics) | 863 | Multi-agent data interaction system |
| [poc-realtime-ai-assistant](https://github.com/disler/poc-realtime-ai-assistant) | 716 | "Ada" - AI Assistant on OpenAI Realtime API |
| [just-prompt](https://github.com/disler/just-prompt) | 687 | MCP server - unified interface to major LLMs |
| [single-file-agents](https://github.com/disler/single-file-agents) | - | Single-purpose agents in single Python files |
| [infinite-agentic-loop](https://github.com/disler/infinite-agentic-loop) | - | Infinite loop with parallel Claude orchestration |
| [nano-agent](https://github.com/disler/nano-agent) | - | MCP Server for small-scale engineering agents |
| [big-3-super-agent](https://github.com/disler/big-3-super-agent) | - | Gemini + OpenAI + Claude unified orchestrator |

**Tactical Agentic Coding (TAC) - 8 Tactics:**
| Tactic | Name | Description |
|--------|------|-------------|
| 1 | Hello Agentic Coding | Transition from traditional coding to agents |
| 2 | The 12 Leverage Points | Maximizing agent autonomy |
| 3 | Success is Planned | Strategic planning for agent execution |
| 4 | AFK Agents | Fully autonomous agents (PITER framework) |
| 5 | Close The Loops | Self-correcting systems with feedback |
| 6 | Let Your Agents Focus | Specialized Review/Documentation agents |
| 7 | ZTE (Zero-Touch Engineering) | "Your codebase ships itself" |
| 8 | The Agentic Layer | Meta-tactic unifying methodology |

**The 12 Leverage Points:**
- **Core Four**: Context, Model, Prompt, Tools
- **8 Additional**: Standard out, types, tests, architecture, and others
- Purpose: Maximize not what YOU can do, but what your AGENTS can do for you

**Compute Advantage Equation:**
```
Compute Advantage = (Compute Scaling x Autonomy) / (Time + Effort + Monetary Cost)
```

**Claude Code Hooks (8 Lifecycle Events):**
| Hook | Purpose |
|------|---------|
| UserPromptSubmit | Prompt validation, security filtering, context injection |
| PreToolUse | Block dangerous commands before execution |
| PostToolUse | Validate results after tool completion |
| Notification | Handle Claude alerts with optional TTS |
| Stop | Control when Claude finishes responding |
| SubagentStop | Control subagent task completion |
| PreCompact | Create transcript backups before compaction |
| SessionStart | Initialize sessions, load dev context |

**IndyDevTools Five Principles:**
1. **Right Tool for the Job** - Agents over code over manual input
2. **Everything is a Function** - Independent, composable units
3. **Great Questions Yield Great Answers**
4. **Reusable Building Blocks** - Small, composable, reusable
5. **Prompts as Programming Units**

**Key Phrases:**
- "Build the system that builds the system"
- "Stop coding, start templating"
- "You are the bottleneck, not the models"
- "Max out your compute"

**Links:**
- Website: https://agenticengineer.com
- YouTube: https://youtube.com/@indydevdan
- GitHub: https://github.com/disler
- Twitter: @IndyDevDan

---

## Daniel Miessler (@danielmiessler)

**Background:**
- US Army veteran (Infantry, Airborne, 101st, Spanish Linguist)
- Cybersecurity career: Apple, Robinhood, IOActive, HP
- Co-founded Fortify on Demand (2 → 350+ people)
- Blog since 1999 - 3,031+ essays over 29 years
- Company: Unsupervised Learning newsletter

**Key Repositories:**
| Project | Stars | Description |
|---------|-------|-------------|
| [SecLists](https://github.com/danielmiessler/SecLists) | 67.8k | Security tester's companion - wordlists |
| [Fabric](https://github.com/danielmiessler/Fabric) | 37k | AI augmentation framework with patterns |
| [Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure) | 2.3k | PAI system for upgrading humans |
| [Telos](https://github.com/danielmiessler/Telos) | 987 | Deep context framework for humans |
| [Substrate](https://github.com/danielmiessler/Substrate) | 653 | Human understanding and meaning |
| [Daemon](https://github.com/danielmiessler/Daemon) | 124 | Personal API framework |
| [ExtractWisdom](https://github.com/danielmiessler/ExtractWisdom) | - | Original extract_wisdom prompt project |
| [yt](https://github.com/danielmiessler/yt) | - | YouTube transcript extractor |

**Fabric Pattern System (233+ Patterns):**
| Category | Count | Key Patterns |
|----------|-------|--------------|
| ANALYSIS | 75 | analyze_claims, analyze_debate, analyze_paper, analyze_malware |
| WRITING | 57 | improve_writing, clean_text, write_essay, humanize |
| EXTRACT | 52 | extract_wisdom, extract_ideas, extract_predictions |
| DEVELOPMENT | 42 | create_coding_project, explain_code, review_code |
| SECURITY | 35 | create_sigma_rules, analyze_incident, analyze_threat_report |
| BUSINESS | 27 | check_agreement, analyze_sales_call, prepare_7s_strategy |
| SUMMARIZE | 23 | summarize, create_summary, create_micro_summary |
| LEARNING | 19 | explain_math, create_quiz, create_reading_plan |
| AI | 14 | improve_prompt, rate_ai_response, create_pattern |
| VISUALIZE | 14 | create_mermaid_visualization, create_markmap_visualization |

**Recent Fabric Releases (2024-2025):**
| Version | Date | Feature |
|---------|------|---------|
| v1.4.322 | Nov 2025 | create_conceptmap, wellness patterns, Claude Opus 4.5 |
| v1.4.317 | Sep 2025 | BCP 47 locale normalization (pt-BR, pt-PT) |
| v1.4.231 | Jul 2025 | OAuth for Anthropic Max Subscription |
| v1.4.227 | Jul 2025 | Image generation support |
| v1.4.226 | Jul 2025 | OpenAI web search functionality |

**PAI (Personal AI Infrastructure) v2 Components:**
- **Skills System**: 65+ custom domains with SKILL.md routing
- **Context Management**: Knowledge embedded within Skills
- **History System (UOCS)**: Automatic session/learning capture
- **Hook System**: SessionStart, PreToolUse, PostToolUse, Stop
- **Agent System**: Specialized personalities with ElevenLabs voices
- **Security Layers**: Constitutional defense, pre-execution validation

**13 Founding Principles:**
1. Clear thinking over perfect prompts
2. Scaffolding architecture over raw model intelligence
3. Deterministic systems where possible
4. Code before AI-powered solutions
5. Specification and evaluation-driven development
6. UNIX philosophy (modular, composable tools)
7. Engineering/SRE production principles
8. CLI interfaces for scriptability
9. Hierarchical problem-solving (Goal → Code → CLI → Prompts → Agents)
10. Meta-systems enabling self-improvement
11. Custom Skill management and knowledge encoding
12. Persistent history capturing all learnings
13. Custom agent personalities with distinct voices

**Installation:**
```bash
# One-liner (Unix/macOS)
curl -fsSL https://raw.githubusercontent.com/danielmiessler/fabric/main/scripts/installer/install.sh | bash

# Homebrew
brew install fabric-ai

# From source
go install github.com/danielmiessler/fabric/cmd/fabric@latest

# Setup
fabric --setup && fabric --updatepatterns
```

**Usage:**
```bash
# Basic pattern
fabric -p summarize < article.txt

# YouTube extraction
fabric -y "https://youtube.com/watch?v=..." -p extract_wisdom

# URL analysis
fabric -u https://example.com -p analyze_claims

# Piped workflow
yt --transcript URL | fabric -p extract_wisdom | fabric -p summarize
```

**Philosophy - Human 3.0:**
```
Human 1.0 (Primitive): Survival mode
Human 2.0 (Corporate): Defined by capitalist value
Human 3.0 (Creative): Self-expression + value creation via AI
```

**Key Quote:** "The system, the orchestration, and the scaffolding are far more important than the model's intelligence."

**Links:**
- Website: https://danielmiessler.com
- GitHub: https://github.com/danielmiessler
- Newsletter: https://newsletter.danielmiessler.com
- Human 3.0: https://human3.unsupervised-learning.com

---

## Synthesis: The Irreplaceable Engineer Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE IRREPLACEABLE ENGINEER                   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 0: Agent Foundation (Mario Zechner)                      │
│  ├── 4-tool minimalism (read, write, edit, bash)                │
│  ├── YOLO mode - no permission theater                          │
│  ├── System prompt under 1000 tokens                            │
│  ├── Multi-provider abstraction (pi-ai)                         │
│  └── Competitive Terminal-Bench despite minimalism              │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1: CLI Tooling (Simon Willison)                          │
│  ├── llm CLI for model interaction (10.6k stars)                │
│  ├── 100+ plugins for providers, tools, fragments               │
│  ├── sqlite-utils for data manipulation                         │
│  ├── Datasette for data exploration                             │
│  └── All interactions logged to SQLite                          │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: AI Patterns (Daniel Miessler)                         │
│  ├── 233+ Fabric patterns for specific tasks                    │
│  ├── PAI (Personal AI Infrastructure) scaffolding               │
│  ├── 13 Founding Principles for reliable AI                     │
│  ├── Composable via pipes: yt | fabric -p extract_wisdom        │
│  └── Human 3.0 vision - AI for flourishing                      │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: Agentic Systems (IndyDevDan)                          │
│  ├── 8 TAC Tactics for agentic engineering                      │
│  ├── 12 Leverage Points for agent autonomy                      │
│  ├── Claude Code Hooks (8 lifecycle events)                     │
│  ├── Compute Advantage = (Compute × Autonomy) / (Time+Effort)   │
│  └── Build systems that build systems                           │
└─────────────────────────────────────────────────────────────────┘
```

## Integration Points

| Concept | Mario | Simon | Daniel | Dan |
|---------|-------|-------|--------|-----|
| CLI-first | bash as escape | LLM CLI | Fabric CLI | Claude Code |
| Patterns | README-driven | Templates | 233+ patterns | Skills |
| Storage | MEMORY.md | SQLite logs | PAI History | expertise/*.md |
| Composability | Spawn via bash | Unix pipes | Unix pipes | Agent chains |
| Extensibility | CLI tools | 100+ plugins | Custom patterns | Hooks |
| Philosophy | Minimal context | SQLite everything | Human 3.0 | Compute Advantage |

## Combined Workflow Example

```bash
# 1. Simon's tools for extraction
yt-dlp -x "https://youtube.com/..." | \

# 2. Daniel's patterns for analysis
fabric -p extract_wisdom | \

# 3. Simon's SQLite for storage
sqlite-utils insert wisdom.db insights - | \

# 4. Dan's pattern: accumulate in expertise file
tee -a expertise/content.md | \

# 5. Mario's approach: minimal, effective
llm "Summarize the key insights"
```

## Recommended Learning Path

1. **Foundation**: Mario's Pi-Mono architecture & philosophy
2. **CLI Mastery**: Simon's LLM CLI + sqlite-utils docs
3. **Patterns**: Daniel's Fabric patterns + PAI principles
4. **Principles**: Dan's Principled AI Coding
5. **Advanced**: Dan's Tactical Agentic Coding (8 tactics)
6. **Hooks**: Dan's Claude Code Hooks Mastery

---

## Vercel just-bash: Ultimate Minimalism (December 2025)

Vercel Labs released `just-bash` - a TypeScript bash implementation for AI agents that validates Mario's minimalism philosophy taken to its logical extreme.

### The Experiment
Vercel stripped their internal text-to-SQL agent (d0) from 11+ specialized tools down to **just 2 tools**:
- **ExecuteCommand** (bash)
- **ExecuteSQL** (database queries)

### Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Success Rate | 80% | **100%** | +20% absolute |
| Execution Time | 274.8s | 77.4s | **3.5x faster** |
| Token Usage | ~102k | ~61k | **40% reduction** |
| Steps Required | ~12 | ~7 | **42% fewer** |

### just-bash Features

```typescript
import { Bash, OverlayFs } from "just-bash";

// Sandboxed execution - reads from real fs, writes stay in memory
const overlay = new OverlayFs({ root: "/path/to/project" });
const env = new Bash({ fs: overlay });

await env.exec("grep -r TODO src/ | wc -l");
```

**Supported Commands:**
- File: cat, cp, ln, ls, mkdir, mv, rm, stat, touch, tree
- Text: awk, base64, cut, diff, grep, head, jq, sed, sort, tail, tr, uniq, wc, xargs
- Shell: bash, chmod, date, env, find, pwd, sleep, timeout, which
- Network: curl (with URL filtering), html-to-markdown

### Key Insights

1. **Addition by Subtraction**: "The best agents might be the ones with the fewest tools."
2. **Trust the Model**: Constraints became liabilities with Claude Opus 4.5's capabilities.
3. **50-Year-Old Tools Win**: "Grep is 50 years old and still does exactly what we need."
4. **Context Over Tooling**: Documentation and naming matter more than clever tooling.

### Tool Reduction Spectrum

```
Claude Code (89+ tools) → Mario (4 tools) → Vercel (1 tool)
     Full Featured           Minimalist         just-bash
```

### When to Use just-bash

| Use Case | just-bash | Native Bash |
|----------|-----------|-------------|
| Codebase exploration | ✅ Safe | ⚠️ Risk |
| Data analysis | ✅ Fast | ✅ Works |
| Script development | ✅ Sandboxed | ⚠️ Side effects |
| Production actions | ❌ No side effects | ✅ Required |

**Source**: https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools

---

## Pi Mono + libghostty (December 2025)

**Context**: Mario Zechner considering integrating libghostty into Pi Mono's TUI components.

**libghostty**:
- Mitchell Hashimoto's GPU-accelerated terminal emulation library
- Core behind the fast Ghostty terminal emulator
- C-compatible API, aarch64 Linux support (Raspberry Pi)
- Libraries: libghostty-vt (VT parsing/state)

**Why it matters for Pi Mono**:
| Component | Benefit |
|-----------|---------|
| pi-tui | Faster terminal rendering |
| Coding agent CLI | Better streaming output |
| Agent output | Smoother real-time display |

**Status**: Mario tweeted "Ah shit, I'm going to integrate libghostty, aren't I?" - private branch likely, watch for PR.

---

## AIRIS: Alternative AGI Paradigm

**AIRIS** = Autonomous Intelligent Reinforcement Inferred Symbolism

**Developed by**: ASI Alliance (SingularityNET/Ben Goertzel, Fetch.ai, Ocean Protocol, CUDOS)

### Core Approach (NOT LLM-based)

| Aspect | AIRIS | LLM Agents |
|--------|-------|------------|
| Learning | Causal discovery, zero-shot | Pre-trained on data |
| World Model | Dynamic State Graph | Context window |
| Explainability | Full decision trace | Black-box |
| Compute | Lower requirements | Massive GPUs |
| Adaptation | Real-time rule updates | Fine-tuning |

### How It Works
1. Starts with zero prior knowledge
2. Observes pre-action vs post-action states
3. Infers causal rules: "If X under Y → Z happens"
4. Builds/updates dynamic State Graph (world model)
5. Predicts outcomes, plans goal-directed actions
6. Adapts in real-time when predictions fail

### Minecraft Demo
- Deployed in 2D grid worlds and full 3D Minecraft
- Learns navigation, obstacle avoidance, item collection
- No hard-coded game knowledge
- Late 2025: impressive progress in complex 3D environments

### Relevance to Trading Agents
- Causal reasoning for signal detection (not just pattern matching)
- Self-learning loops (like IndyDevDan's PITER framework)
- Explainable decisions (audit trail for trades)
- Lower compute = more edge deployment options

**Source**: airis-ai.com, ASI Alliance

---

## Meta-Learnings Synthesis

### Tool Reduction Spectrum

```
Claude Code (89+ tools) → IndyDevDan (8 tactics) → Mario (4 tools) → Vercel (1 tool)
     ↓                         ↓                        ↓              ↓
  Maximum              Structured            Minimal          Ultimate
  Capability           Autonomy            Simplicity        Reliability
```

### Key Insights

| Lesson | Source | Implementation |
|--------|--------|----------------|
| Less tools = better reliability | Vercel, Mario | filterToMinimalistTools() |
| Sandbox everything | just-bash OverlayFS | createJustBashTool() |
| Deduplicate at every layer | PID files, message IDs | markMessageProcessed() |
| Causal > correlation | AIRIS | Future: trading signals |
| Explainability matters | AIRIS | Future: decision audit |

### The Compute Advantage Equation (IndyDevDan)

```
Compute Advantage = (Compute Scaling × Autonomy) / (Time + Effort + Cost)
```

### Building Systems That Build Systems

1. **PITER Framework** (IndyDevDan) - AFK agents that work while you sleep
2. **Fabric Patterns** (Miessler) - 242 reusable AI operations
3. **4-Tool Philosophy** (Mario) - Maximum leverage from minimum surface
4. **State Graph** (AIRIS) - Self-updating world model

---

*Last Updated: December 28, 2025*
*Research compiled by PAI system*
