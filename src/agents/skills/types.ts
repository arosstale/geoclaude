/**
 * Agent Skills specification types.
 * See: https://agentskills.io/specification
 */

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	license?: string;
	compatibility?: string;
	metadata?: Record<string, unknown>;
	allowedTools?: string[];
	[key: string]: string | string[] | Record<string, unknown> | undefined;
}

export interface AgentSkill {
	/** Skill name (must match parent directory) */
	name: string;
	/** Brief description (max 1024 chars) */
	description: string;
	/** Full content from SKILL.md including frontmatter */
	content: string;
	/** Absolute path to SKILL.md file */
	path: string;
	/** Base directory containing SKILL.md */
	baseDir: string;
	/** Source identifier (claude-user, pi-project, etc.) */
	source: string;
	/** Optional tool restrictions */
	allowedTools?: string[];
	/** Additional metadata from frontmatter */
	metadata?: Record<string, unknown>;
}

export interface SkillWarning {
	skillPath: string;
	message: string;
}

export interface LoadSkillsResult {
	skills: AgentSkill[];
	warnings: SkillWarning[];
}

/**
 * Configuration for skill loading.
 */
export interface SkillsSettings {
	/** Enable ~/.claude/skills (default: true) */
	enableClaudeUser?: boolean;
	/** Enable ./.claude/skills (default: true) */
	enableClaudeProject?: boolean;
	/** Enable ~/.pi/agent/skills (default: true) */
	enablePiUser?: boolean;
	/** Enable ./.pi/skills (default: true) */
	enablePiProject?: boolean;
	/** Additional custom directories to scan */
	customDirectories?: string[];
	/** Glob patterns to ignore (e.g., ["test-*", "deprecated-*"]) */
	ignoredSkills?: string[];
	/** Glob patterns to include (empty = all) */
	includeSkills?: string[];
}
