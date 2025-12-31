/**
 * Agent Skills specification loader.
 * Ported from pi-mono v0.25.3 coding-agent.
 *
 * Loads SKILL.md files from standard discovery paths:
 * 1. ~/.claude/skills (claude-user)
 * 2. ./.claude/skills (claude-project)
 * 3. ~/.pi/agent/skills (pi-user)
 * 4. ./.pi/skills (pi-project)
 * 5. Custom directories
 *
 * See: https://agentskills.io/specification
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { minimatch } from "minimatch";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import type { AgentSkill, LoadSkillsResult, SkillFrontmatter, SkillsSettings, SkillWarning } from "./types.js";

/** Standard frontmatter fields per Agent Skills spec */
const ALLOWED_FRONTMATTER_FIELDS = new Set([
	"name",
	"description",
	"license",
	"compatibility",
	"metadata",
	"allowed-tools",
]);

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

type SkillFormat = "recursive" | "claude";

/**
 * Strip quotes from YAML value.
 */
function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns frontmatter, body, and all parsed keys.
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string; allKeys: string[] } {
	const frontmatter: SkillFrontmatter = {};
	const allKeys: string[] = [];

	const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	if (!normalizedContent.startsWith("---")) {
		return { frontmatter, body: normalizedContent, allKeys };
	}

	const endIndex = normalizedContent.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalizedContent, allKeys };
	}

	const frontmatterBlock = normalizedContent.slice(4, endIndex);
	const body = normalizedContent.slice(endIndex + 4).trim();

	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
		if (match) {
			const key = match[1];
			const value = stripQuotes(match[2].trim());
			allKeys.push(key);

			if (key === "name") {
				frontmatter.name = value;
			} else if (key === "description") {
				frontmatter.description = value;
			} else if (key === "license") {
				frontmatter.license = value;
			} else if (key === "compatibility") {
				frontmatter.compatibility = value;
			} else if (key === "allowed-tools") {
				// Parse comma-separated list
				frontmatter.allowedTools = value.split(",").map((s) => s.trim());
			} else if (key === "metadata") {
				try {
					frontmatter.metadata = JSON.parse(value) as Record<string, unknown>;
				} catch {
					// If not valid JSON, store as string in generic key
					(frontmatter as Record<string, unknown>)[key] = value;
				}
			} else {
				(frontmatter as Record<string, unknown>)[key] = value;
			}
		}
	}

	return { frontmatter, body, allKeys };
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string, parentDirName: string): string[] {
	const errors: string[] = [];

	if (name !== parentDirName) {
		errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
	}

	if (name.length > MAX_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
	}

	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
	}

	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push(`name must not start or end with a hyphen`);
	}

	if (name.includes("--")) {
		errors.push(`name must not contain consecutive hyphens`);
	}

	return errors;
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: string | undefined): string[] {
	const errors: string[] = [];

	if (!description || description.trim() === "") {
		errors.push(`description is required`);
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
	}

	return errors;
}

/**
 * Check for unknown frontmatter fields.
 */
function validateFrontmatterFields(keys: string[]): string[] {
	const errors: string[] = [];
	for (const key of keys) {
		if (!ALLOWED_FRONTMATTER_FIELDS.has(key)) {
			errors.push(`unknown frontmatter field "${key}"`);
		}
	}
	return errors;
}

/**
 * Load a single SKILL.md file and parse it.
 */
function loadSkillFromFile(filePath: string, source: string): { skill: AgentSkill | null; warnings: SkillWarning[] } {
	const warnings: SkillWarning[] = [];

	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter, body: _body, allKeys } = parseFrontmatter(rawContent);
		const skillDir = dirname(filePath);
		const parentDirName = basename(skillDir);

		// Validate frontmatter fields
		const fieldErrors = validateFrontmatterFields(allKeys);
		for (const error of fieldErrors) {
			warnings.push({ skillPath: filePath, message: error });
		}

		// Validate description
		const descErrors = validateDescription(frontmatter.description);
		for (const error of descErrors) {
			warnings.push({ skillPath: filePath, message: error });
		}

		// Use name from frontmatter, or fall back to parent directory name
		const name = frontmatter.name || parentDirName;

		// Validate name
		const nameErrors = validateName(name, parentDirName);
		for (const error of nameErrors) {
			warnings.push({ skillPath: filePath, message: error });
		}

		// Still load the skill even with warnings (unless description is completely missing)
		if (!frontmatter.description || frontmatter.description.trim() === "") {
			return { skill: null, warnings };
		}

		return {
			skill: {
				name,
				description: frontmatter.description,
				content: rawContent,
				path: filePath,
				baseDir: skillDir,
				source,
				allowedTools: frontmatter.allowedTools,
				metadata: frontmatter.metadata,
			},
			warnings,
		};
	} catch (err) {
		warnings.push({
			skillPath: filePath,
			message: `failed to read file: ${err instanceof Error ? err.message : String(err)}`,
		});
		return { skill: null, warnings };
	}
}

/**
 * Load skills from a directory using specified format.
 */
function loadSkillsFromDirInternal(dir: string, source: string, format: SkillFormat): LoadSkillsResult {
	const skills: AgentSkill[] = [];
	const warnings: SkillWarning[] = [];

	if (!existsSync(dir)) {
		return { skills, warnings };
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			if (entry.isSymbolicLink()) {
				continue;
			}

			const fullPath = join(dir, entry.name);

			if (format === "recursive") {
				// Recursive format: scan directories, look for SKILL.md files
				if (entry.isDirectory()) {
					const subResult = loadSkillsFromDirInternal(fullPath, source, format);
					skills.push(...subResult.skills);
					warnings.push(...subResult.warnings);
				} else if (entry.isFile() && entry.name === "SKILL.md") {
					const result = loadSkillFromFile(fullPath, source);
					if (result.skill) {
						skills.push(result.skill);
					}
					warnings.push(...result.warnings);
				}
			} else if (format === "claude") {
				// Claude format: only one level deep, each directory must contain SKILL.md
				if (!entry.isDirectory()) {
					continue;
				}

				const skillFile = join(fullPath, "SKILL.md");
				if (!existsSync(skillFile)) {
					continue;
				}

				const result = loadSkillFromFile(skillFile, source);
				if (result.skill) {
					skills.push(result.skill);
				}
				warnings.push(...result.warnings);
			}
		}
	} catch (err) {
		warnings.push({
			skillPath: dir,
			message: `failed to read directory: ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	return { skills, warnings };
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation warnings.
 */
export function loadSkills(options: SkillsSettings = {}): LoadSkillsResult {
	const {
		enableClaudeUser = true,
		enableClaudeProject = true,
		enablePiUser = true,
		enablePiProject = true,
		customDirectories = [],
		ignoredSkills = [],
		includeSkills = [],
	} = options;

	const skillMap = new Map<string, AgentSkill>();
	const allWarnings: SkillWarning[] = [];
	const collisionWarnings: SkillWarning[] = [];

	// Check if skill name matches any of the include patterns
	function matchesIncludePatterns(name: string): boolean {
		if (includeSkills.length === 0) return true; // No filter = include all
		return includeSkills.some((pattern) => minimatch(name, pattern));
	}

	// Check if skill name matches any of the ignore patterns
	function matchesIgnorePatterns(name: string): boolean {
		if (ignoredSkills.length === 0) return false;
		return ignoredSkills.some((pattern) => minimatch(name, pattern));
	}

	function addSkills(result: LoadSkillsResult) {
		allWarnings.push(...result.warnings);
		for (const skill of result.skills) {
			// Apply ignore filter (glob patterns) - takes precedence over include
			if (matchesIgnorePatterns(skill.name)) {
				continue;
			}
			// Apply include filter (glob patterns)
			if (!matchesIncludePatterns(skill.name)) {
				continue;
			}
			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionWarnings.push({
					skillPath: skill.path,
					message: `name collision: "${skill.name}" already loaded from ${existing.path}, skipping this one`,
				});
			} else {
				skillMap.set(skill.name, skill);
			}
		}
	}

	// Discovery paths in order (per pi-mono v0.25.3)
	if (enableClaudeUser) {
		addSkills(loadSkillsFromDirInternal(join(homedir(), ".claude", "skills"), "claude-user", "claude"));
	}
	if (enableClaudeProject) {
		addSkills(loadSkillsFromDirInternal(resolve(process.cwd(), ".claude", "skills"), "claude-project", "claude"));
	}
	if (enablePiUser) {
		addSkills(loadSkillsFromDirInternal(join(homedir(), ".pi", "agent", "skills"), "pi-user", "recursive"));
	}
	if (enablePiProject) {
		addSkills(loadSkillsFromDirInternal(resolve(process.cwd(), ".pi", "skills"), "pi-project", "recursive"));
	}
	for (const customDir of customDirectories) {
		const expandedDir = customDir.replace(/^~(?=$|[\\/])/, homedir());
		addSkills(loadSkillsFromDirInternal(expandedDir, "custom", "recursive"));
	}

	return {
		skills: Array.from(skillMap.values()),
		warnings: [...allWarnings, ...collisionWarnings],
	};
}

/**
 * Parse a single SKILL.md file (for testing or manual loading).
 */
export function parseSkillFile(
	filePath: string,
	source = "manual",
): { skill: AgentSkill | null; warnings: SkillWarning[] } {
	return loadSkillFromFile(filePath, source);
}

/**
 * Filter skills by glob patterns.
 */
export function filterSkills(skills: AgentSkill[], patterns: string[]): AgentSkill[] {
	if (patterns.length === 0) {
		return skills;
	}
	return skills.filter((skill) => patterns.some((pattern) => minimatch(skill.name, pattern)));
}

/**
 * Format skills for inclusion in agent system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 */
export function formatSkillsForPrompt(skills: AgentSkill[]): string {
	if (skills.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"",
		"<available_skills>",
	];

	for (const skill of skills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.path)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");

	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Singleton instance.
 */
let globalLoader: SkillsLoader | null = null;

/**
 * Stateful skills loader with caching.
 */
export class SkillsLoader {
	private cache: LoadSkillsResult | null = null;

	constructor(private options: SkillsSettings = {}) {}

	/**
	 * Load skills (uses cache if available).
	 */
	load(force = false): LoadSkillsResult {
		if (!force && this.cache) {
			return this.cache;
		}
		this.cache = loadSkills(this.options);
		return this.cache;
	}

	/**
	 * Reload skills from disk.
	 */
	reload(): LoadSkillsResult {
		return this.load(true);
	}

	/**
	 * Get loaded skills (returns empty if not loaded yet).
	 */
	getSkills(): AgentSkill[] {
		return this.cache?.skills ?? [];
	}

	/**
	 * Get warnings from last load.
	 */
	getWarnings(): SkillWarning[] {
		return this.cache?.warnings ?? [];
	}

	/**
	 * Format loaded skills for prompt.
	 */
	formatForPrompt(): string {
		return formatSkillsForPrompt(this.getSkills());
	}

	/**
	 * Filter loaded skills by glob patterns.
	 */
	filter(patterns: string[]): AgentSkill[] {
		return filterSkills(this.getSkills(), patterns);
	}
}

/**
 * Get singleton skills loader instance.
 */
export function getSkillsLoader(options?: SkillsSettings): SkillsLoader {
	if (!globalLoader) {
		globalLoader = new SkillsLoader(options);
	}
	return globalLoader;
}
