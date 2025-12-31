# Claude Code Ecosystem: Complete Resource Guide

Sources: awesome-claude-code, aitmpl.com, PAI (Personal AI Infrastructure)

## Overview

| Resource | Purpose | Link |
|----------|---------|------|
| awesome-claude-code | Curated list of Claude Code resources | github.com/hesreallyhim/awesome-claude-code |
| aitmpl.com | Ready-to-use templates for Claude Code | aitmpl.com/skills |
| PAI | Open-source AI operating system scaffolding | github.com/danielmiessler/Personal_AI_Infrastructure |

---

## awesome-claude-code

**Repository:** github.com/hesreallyhim/awesome-claude-code

Comprehensive curated list organized by category:

### Categories

| Category | Description |
|----------|-------------|
| Agent Skills | Model-controlled configurations (SKILL.md files) |
| Workflows & Knowledge Guides | Step-by-step guides and best practices |
| Tooling | CLI tools, IDE integrations, monitors |
| Status Lines | Terminal status bar customizations |
| Hooks | Event-driven automation scripts |
| Slash Commands | Custom / commands |
| CLAUDE.md Files | Configuration templates |
| Alternative Clients | Non-Anthropic interfaces |
| Official Documentation | Anthropic docs |

### Notable Skills & Resources

| Resource | Description |
|----------|-------------|
| superpowers | Strong bundle of core competencies for SDLC |
| TACHES | Well-balanced skills, agents, commands |
| claude-codepro | Spec-driven workflow, TDD enforcement |

### Subcategories

**Tooling:**
- IDE Integrations
- Usage Monitors
- Orchestrators

**Slash Commands:**
- Version Control & Git
- Code Analysis & Testing
- Context Loading & Priming
- Documentation & Changelogs
- CI & Deployment
- Project & Task Management

**CLAUDE.md Files:**
- Language-Specific
- Domain-Specific
- Project Scaffolding & MCP

---

## aitmpl.com (Claude Code Templates)

**Website:** aitmpl.com/skills

NPM Package: `npx claude-code-templates`

### Template Categories

| Category | Icon |
|----------|------|
| Agents | Robot |
| Commands | Lightning |
| Settings | Gear |
| Hooks | Hook |
| MCPs | Plug |
| Plugins | Puzzle |
| Skills | Star (NEW) |
| Templates | Package |

### Company-Specific Stacks

| Company | Focus |
|---------|-------|
| OpenAI | GPT, DALL-E, Whisper APIs |
| Anthropic | Claude AI integration |
| Stripe | Payment processing |
| Salesforce | CRM & Lightning |
| Shopify | E-commerce APIs |
| Twilio | Communication APIs |
| AWS | Cloud & serverless |
| GitHub | Git automation & Actions |

### CLI Tools

```bash
# Analytics - monitor AI development sessions
npx claude-code-templates@latest --analytics

# Health Check - optimize Claude Code installation
npx claude-code-templates@latest --health-check
```

---

## PAI (Personal AI Infrastructure)

**Repository:** github.com/danielmiessler/Personal_AI_Infrastructure
**Version:** 0.9.1 (December 2025)
**Creator:** Daniel Miessler

### Vision

> "The best AI in the world should be available to everyone"

PAI is open-source scaffolding for building a Personal AI System that:
- Understands your goals and context
- Gets better over time
- Works for YOU, not corporations

### Core Components

| Component | Purpose |
|-----------|---------|
| Skills | Self-contained AI capabilities with routing |
| Agents | Specialized AI personalities for tasks |
| Hooks | Event-driven automation |
| History | Automatic documentation (UOCS) |

### 13 Founding Principles

1. **Clear Thinking + Prompting is King** - Quality outcomes from quality thinking
2. **Scaffolding > Model** - Architecture matters more than AI model
3. **As Deterministic as Possible** - Same input = Same output
4. **Code Before Prompts** - Write code, use prompts to orchestrate
5. **Spec / Test / Evals First** - Define behavior before implementation
6. **UNIX Philosophy** - Do one thing well, compose tools
7. **ENG / SRE Principles** - Software engineering rigor for AI
8. **CLI as Interface** - Every operation accessible via CLI
9. **Goal -> Code -> CLI -> Prompts -> Agents** - Proper development pipeline
10. **Meta / Self Update System** - System improves itself
11. **Custom Skill Management** - Skills as organizational units
12. **Custom History System** - Automatic work preservation
13. **Custom Agent Personalities** - Specialized agents for tasks

### Technology Stack

| Category | Choice | Note |
|----------|--------|------|
| Runtime | Bun | NOT Node.js |
| Language | TypeScript | NOT Python |
| Package Manager | Bun | NOT npm/yarn/pnpm |
| Format | Markdown | NOT HTML |
| Testing | Vitest | When needed |
| Voice | ElevenLabs | TTS integration |

### Directory Structure

```
~/.claude/
├── Skills/
│   ├── CORE/                 # Central skill (Constitution, SkillSystem)
│   ├── Observability/        # Real-time agent monitoring
│   ├── BrightData/           # Four-tier web scraping
│   ├── Fabric/               # 248 native patterns
│   └── Research/             # Multi-source research
├── hooks/                    # Event automation
├── voice-server/             # ElevenLabs TTS
└── Tools/setup/              # Bootstrap scripts
```

### PAI Features

**Observability Dashboard:**
- WebSocket streaming of agent activity
- Live pulse charts, event timelines
- Multiple themes (Tokyo Night, Nord, Catppuccin)
- Security obfuscation

**Native Fabric Patterns:**
- 248 patterns run directly in Claude's context
- No CLI spawning overhead
- Full conversation history access
- Uses your subscription's model (Opus/Sonnet)

**Platform-Agnostic:**
- Works on macOS, Linux, Windows
- Configurable identity (DA name)
- PAI_DIR for location-agnostic installation

### Quick Start

```bash
# Clone
git clone https://github.com/danielmiessler/PAI.git ~/PAI

# Symlink
ln -s ~/PAI/.claude ~/.claude

# Setup
~/.claude/Tools/setup/bootstrap.sh

# Configure
cp ~/.claude/.env.example ~/.claude/.env

# Start
claude
```

### Update Command

```bash
/paiupdate    # or /pa
```

Intelligent sideloading preserves customizations while updating from upstream.

---

## Integration with Irreplaceable Engineer Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLAUDE CODE ECOSYSTEM                        │
├─────────────────────────────────────────────────────────────────┤
│  DISCOVERY LAYER                                                │
│  ├── awesome-claude-code    → Find resources                    │
│  ├── aitmpl.com             → Get templates                     │
│  └── Smithery Registry      → 927 MCP servers                   │
├─────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE LAYER                                           │
│  ├── PAI                    → Personal AI scaffolding           │
│  ├── Skills                 → Reusable workflows                │
│  └── Hooks                  → Event-driven automation           │
├─────────────────────────────────────────────────────────────────┤
│  PHILOSOPHY LAYER                                               │
│  ├── Simon Willison         → CLI tooling                       │
│  ├── Daniel Miessler        → AI augmentation (Fabric + PAI)    │
│  └── IndyDevDan             → Agentic systems (TAC-12)          │
└─────────────────────────────────────────────────────────────────┘
```

## Key Takeaways

1. **PAI = Daniel Miessler's Implementation** of the Irreplaceable Engineer philosophy
2. **awesome-claude-code = Discovery Hub** for Claude Code extensions
3. **aitmpl.com = Template Marketplace** for quick setup
4. **13 Principles = Foundational Philosophy** for reliable AI infrastructure
5. **Scaffolding > Model** - Architecture matters more than which AI

## Related Resources

- `three-goats-research.md` - Three GOATs comprehensive profiles
- `tac-complete-architecture.md` - TAC integration guide
- `skills-architecture-insights.md` - Skills system deep dive
- `mario-zechner-insights.md` - Pi coding agent philosophy
