# Agent Skills Integration Examples

Quick reference for integrating the skills loader with Discord bot agents.

## Lightweight Agent Integration

Inject skills into system prompt for enhanced context:

```typescript
import { runLearningAgent } from "../lightweight-agent.js";
import { getSkillsLoader } from "./index.js";

async function runAgentWithSkills(userPrompt: string, mode: string = "general") {
  // Load all skills or filter to relevant ones
  const loader = getSkillsLoader();
  const skills = loader.filter([mode]); // e.g., filter(["trading"])

  // Format skills as XML for prompt
  const skillsContext = loader.formatForPrompt();

  // Inject into system prompt or user prompt
  const enhancedPrompt = `${skillsContext}

User request: ${userPrompt}

When the task matches a skill description, use the read tool to load that skill's file for detailed instructions.`;

  // Run agent
  const result = await runLearningAgent({
    prompt: enhancedPrompt,
    mode,
    enableLearning: true,
  });

  return result;
}

// Usage
const result = await runAgentWithSkills(
  "Analyze BTC price and give me a trading signal",
  "trading"
);
```

## OpenHands Agent Integration

Reference skill files in OpenHands tasks:

```typescript
import { runOpenHandsAgent } from "../openhands-agent.js";
import { getSkillsLoader } from "./index.js";

async function runOpenHandsWithSkill(skillName: string, task: string) {
  const loader = getSkillsLoader();
  const skills = loader.filter([skillName]);

  if (skills.length === 0) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const skill = skills[0];

  // Reference skill file in task
  const enhancedTask = `
Read the skill file: ${skill.path}

Follow the instructions in that skill to complete this task:
${task}

Skill description: ${skill.description}
${skill.allowedTools ? `Allowed tools: ${skill.allowedTools.join(", ")}` : ""}
`;

  return await runOpenHandsAgent({
    task: enhancedTask,
    mode: "developer",
  });
}

// Usage
await runOpenHandsWithSkill(
  "trading",
  "Analyze recent BTC price movements and generate a trading signal"
);
```

## Discord Slash Command

Add a `/skills` command to the bot:

```typescript
import { SlashCommandBuilder } from "discord.js";
import { getSkillsLoader } from "./agents/skills/index.js";

// In main.ts slash command definitions
const skillsCommand = new SlashCommandBuilder()
  .setName("skills")
  .setDescription("Manage agent skills")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all loaded skills")
  )
  .addSubcommand((sub) =>
    sub
      .setName("view")
      .setDescription("View a specific skill")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Skill name").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("reload").setDescription("Reload skills from disk")
  );

// Handler
if (interaction.commandName === "skills") {
  const subcommand = interaction.options.getSubcommand();
  const loader = getSkillsLoader();

  if (subcommand === "list") {
    const { skills } = loader.load();
    const list = skills
      .map((s, i) => `${i + 1}. **${s.name}** (${s.source})\n   ${s.description}`)
      .join("\n\n");

    await interaction.reply({
      content: `**Loaded Skills (${skills.length}):**\n\n${list}`,
      ephemeral: true,
    });
  } else if (subcommand === "view") {
    const name = interaction.options.getString("name", true);
    const skill = loader.getSkills().find((s) => s.name === name);

    if (!skill) {
      await interaction.reply({
        content: `Skill not found: ${name}`,
        ephemeral: true,
      });
      return;
    }

    // Show first 1000 chars of content
    const preview = skill.content.slice(0, 1000);
    await interaction.reply({
      content: `**${skill.name}**\n${skill.description}\n\n\`\`\`markdown\n${preview}\n...\n\`\`\`\n\nPath: \`${skill.path}\``,
      ephemeral: true,
    });
  } else if (subcommand === "reload") {
    const { skills, warnings } = loader.reload();
    await interaction.reply({
      content: `Reloaded ${skills.length} skills${warnings.length > 0 ? ` with ${warnings.length} warnings` : ""}`,
      ephemeral: true,
    });
  }
}
```

## Auto-Skill Detection

Automatically inject skills based on message keywords:

```typescript
import { getSkillsLoader } from "./agents/skills/index.js";

function detectRelevantSkills(message: string): string[] {
  const keywords = {
    trading: ["trading", "market", "price", "signal", "buy", "sell", "technical", "chart"],
    research: ["research", "find", "search", "investigate", "analyze", "compare"],
    github: ["github", "repository", "pr", "pull request", "commit", "code review"],
  };

  const relevantSkills: string[] = [];
  const lowerMessage = message.toLowerCase();

  for (const [skill, kws] of Object.entries(keywords)) {
    if (kws.some((kw) => lowerMessage.includes(kw))) {
      relevantSkills.push(skill);
    }
  }

  return relevantSkills;
}

// In messageCreate handler
const relevantSkillNames = detectRelevantSkills(message.content);
const loader = getSkillsLoader();
const skills = relevantSkillNames.length > 0
  ? loader.filter(relevantSkillNames)
  : [];

if (skills.length > 0) {
  console.log(`Auto-detected skills: ${skills.map((s) => s.name).join(", ")}`);
  const skillsContext = formatSkillsForPrompt(skills);
  // Inject into agent prompt...
}
```

## RAG-Based Skill Selection

Use semantic similarity to auto-select skills:

```typescript
import { getSkillsLoader } from "./agents/skills/index.js";
import { generateEmbedding, cosineSimilarity } from "../embeddings.js";

async function selectSkillsRAG(userQuery: string, topK: number = 3) {
  const loader = getSkillsLoader();
  const skills = loader.getSkills();

  // Embed user query
  const queryEmbedding = await generateEmbedding(userQuery);

  // Embed all skill descriptions (cache these in production)
  const skillEmbeddings = await Promise.all(
    skills.map(async (skill) => ({
      skill,
      embedding: await generateEmbedding(skill.description),
    }))
  );

  // Calculate similarities
  const scored = skillEmbeddings.map(({ skill, embedding }) => ({
    skill,
    score: cosineSimilarity(queryEmbedding, embedding),
  }));

  // Sort by score descending and take top K
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((s) => s.skill);
}

// Usage
const userQuery = "What's the best way to analyze cryptocurrency market trends?";
const relevantSkills = await selectSkillsRAG(userQuery, 2);
console.log(`Selected skills: ${relevantSkills.map((s) => s.name).join(", ")}`);
// Output: Selected skills: trading, research
```

## Skill Usage Logging

Track which skills are actually used by agents:

```typescript
import { getSkillsLoader } from "./agents/skills/index.js";
import { getDatabase } from "./database.js";

// Add to database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS skill_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    success INTEGER NOT NULL
  )
`);

function logSkillUsage(
  skillName: string,
  channelId: string,
  userId: string,
  success: boolean
) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO skill_usage (skill_name, channel_id, user_id, timestamp, success)
    VALUES (?, ?, ?, ?, ?)
  `).run(skillName, channelId, userId, Date.now(), success ? 1 : 0);
}

// After agent execution
if (skills.length > 0) {
  for (const skill of skills) {
    logSkillUsage(skill.name, channelId, userId, result.success);
  }
}

// Analytics query
function getSkillUsageStats() {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      skill_name,
      COUNT(*) as total_uses,
      SUM(success) as successful_uses,
      ROUND(100.0 * SUM(success) / COUNT(*), 2) as success_rate
    FROM skill_usage
    GROUP BY skill_name
    ORDER BY total_uses DESC
  `).all();
}
```

## Integration Checklist

- [ ] Load skills on bot startup
- [ ] Add `/skills` slash command
- [ ] Auto-detect skills from message keywords
- [ ] Inject skills into agent prompts
- [ ] Log skill usage to database
- [ ] Add skill reload on file change (file watcher)
- [ ] Implement RAG-based skill selection
- [ ] Create skill usage analytics dashboard
- [ ] Add skill versioning/compatibility checks
- [ ] Build skill composition (skill A depends on skill B)

## Performance Considerations

1. **Caching:** Loader uses singleton pattern with cached results
2. **Lazy Loading:** Skills loaded on first `load()` call, not import
3. **Embeddings:** Cache skill description embeddings to avoid re-computing
4. **File Watching:** Use `chokidar` to watch skill directories for changes
5. **Filtering:** Apply filters before formatting to reduce prompt size

## Debugging

Enable debug output:

```typescript
const loader = getSkillsLoader();
const { skills, warnings } = loader.load();

console.log(`Loaded ${skills.length} skills`);
for (const skill of skills) {
  console.log(`  - ${skill.name}: ${skill.path}`);
}

if (warnings.length > 0) {
  console.warn(`Skill warnings (${warnings.length}):`);
  for (const warning of warnings) {
    console.warn(`  - ${warning.skillPath}: ${warning.message}`);
  }
}
```

## Troubleshooting

**No skills loaded:**
- Check `.claude/skills/` directory exists
- Verify SKILL.md files have valid YAML frontmatter
- Enable `enableClaudeProject: true` in loader config

**Skills not triggering:**
- Verify skill description includes "USE WHEN" triggers
- Check allowed-tools matches available tools
- Review agent prompt to ensure skills context is injected

**Validation warnings:**
- Skill names must be lowercase (a-z, 0-9, hyphens only)
- Description is required (max 1024 chars)
- Name must match parent directory

**Duplicate skills:**
- First loaded skill wins (collision warning issued)
- Check for duplicate directory names across paths
- Use `ignoredSkills` glob to exclude duplicates
