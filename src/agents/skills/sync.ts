/**
 * Skills Sync Module
 *
 * Import skills from external sources (aitmpl.com, GitHub repos)
 * and export local skills for publishing.
 *
 * Compatible with Claude Code Agent Skills specification.
 * See: https://agentskills.io/specification
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { type AgentSkill, parseSkillFile, type SkillWarning } from "./index.js";

/** GitHub raw content base URL */
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

/** Default skills repository */
const DEFAULT_REPO = "davila7/claude-code-templates";
const DEFAULT_BRANCH = "main";
const SKILLS_PATH = "cli-tool/components/skills";

/** Skill categories from aitmpl.com catalog */
export const SKILL_CATEGORIES = [
	"development",
	"utilities",
	"documentation",
	"testing",
	"devops",
	"security",
	"data",
	"ai",
	"web",
	"mobile",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Remote skill metadata */
export interface RemoteSkill {
	name: string;
	description: string;
	category: string;
	url: string;
	repo: string;
	branch: string;
	path: string;
}

/** Import result */
export interface ImportResult {
	success: boolean;
	skill?: AgentSkill;
	installedPath?: string;
	warnings: SkillWarning[];
	error?: string;
}

/** Export result */
export interface ExportResult {
	success: boolean;
	outputPath?: string;
	files: string[];
	error?: string;
}

/** Catalog result */
export interface CatalogResult {
	skills: RemoteSkill[];
	total: number;
	categories: Record<string, number>;
	error?: string;
}

/**
 * Build GitHub raw URL for a file.
 */
function buildRawUrl(repo: string, branch: string, path: string): string {
	return `${GITHUB_RAW_BASE}/${repo}/${branch}/${path}`;
}

/**
 * Fetch content from a URL.
 */
async function fetchContent(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}
	return response.text();
}

/**
 * Get the default installation directory for skills.
 * Prefers project-local .claude/skills if it exists, otherwise user-level.
 */
export function getDefaultInstallDir(projectDir?: string): string {
	if (projectDir) {
		const projectSkillsDir = join(projectDir, ".claude", "skills");
		if (existsSync(dirname(projectSkillsDir))) {
			return projectSkillsDir;
		}
	}
	return join(homedir(), ".claude", "skills");
}

/**
 * Import a skill from a GitHub repository.
 *
 * @param skillName - Name of the skill (directory name)
 * @param options - Import options
 * @returns Import result
 */
export async function importSkill(
	skillName: string,
	options: {
		repo?: string;
		branch?: string;
		category?: string;
		installDir?: string;
		overwrite?: boolean;
	} = {},
): Promise<ImportResult> {
	const { repo = DEFAULT_REPO, branch = DEFAULT_BRANCH, category, installDir, overwrite = false } = options;

	const warnings: SkillWarning[] = [];

	try {
		// Build path to skill
		let skillPath: string;
		if (category) {
			skillPath = `${SKILLS_PATH}/${category}/${skillName}/SKILL.md`;
		} else {
			// Try to find skill in any category
			skillPath = `${SKILLS_PATH}/${skillName}/SKILL.md`;
		}

		const skillUrl = buildRawUrl(repo, branch, skillPath);

		// Fetch SKILL.md content
		let content: string;
		try {
			content = await fetchContent(skillUrl);
		} catch {
			// Try searching in categories
			if (!category) {
				for (const cat of SKILL_CATEGORIES) {
					const catPath = `${SKILLS_PATH}/${cat}/${skillName}/SKILL.md`;
					const catUrl = buildRawUrl(repo, branch, catPath);
					try {
						content = await fetchContent(catUrl);
						break;
					} catch {}
				}
			}
			if (!content!) {
				return {
					success: false,
					warnings,
					error: `Skill "${skillName}" not found in repository`,
				};
			}
		}

		// Determine installation directory
		const targetDir = installDir || getDefaultInstallDir();
		const skillDir = join(targetDir, skillName);

		// Check if skill already exists
		if (existsSync(skillDir) && !overwrite) {
			return {
				success: false,
				warnings,
				error: `Skill "${skillName}" already exists at ${skillDir}. Use overwrite option to replace.`,
			};
		}

		// Create skill directory
		mkdirSync(skillDir, { recursive: true });

		// Write SKILL.md
		const skillFilePath = join(skillDir, "SKILL.md");
		writeFileSync(skillFilePath, content, "utf-8");

		// Parse and validate the installed skill
		const parseResult = parseSkillFile(skillFilePath, "imported");
		warnings.push(...parseResult.warnings);

		if (!parseResult.skill) {
			return {
				success: false,
				warnings,
				error: "Failed to parse imported skill",
			};
		}

		return {
			success: true,
			skill: parseResult.skill,
			installedPath: skillDir,
			warnings,
		};
	} catch (err) {
		return {
			success: false,
			warnings,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Import a skill from a direct URL.
 *
 * @param url - Direct URL to SKILL.md file
 * @param options - Import options
 */
export async function importSkillFromUrl(
	url: string,
	options: {
		skillName?: string;
		installDir?: string;
		overwrite?: boolean;
	} = {},
): Promise<ImportResult> {
	const warnings: SkillWarning[] = [];

	try {
		// Fetch content
		const content = await fetchContent(url);

		// Extract skill name from URL or use provided
		let skillName = options.skillName;
		if (!skillName) {
			// Try to extract from URL path
			const urlPath = new URL(url).pathname;
			const parts = urlPath.split("/").filter(Boolean);
			// Look for directory before SKILL.md
			const skillMdIndex = parts.indexOf("SKILL.md");
			if (skillMdIndex > 0) {
				skillName = parts[skillMdIndex - 1];
			} else {
				skillName = `imported-${Date.now()}`;
			}
		}

		// Determine installation directory
		const targetDir = options.installDir || getDefaultInstallDir();
		const skillDir = join(targetDir, skillName);

		// Check if skill already exists
		if (existsSync(skillDir) && !options.overwrite) {
			return {
				success: false,
				warnings,
				error: `Skill "${skillName}" already exists at ${skillDir}`,
			};
		}

		// Create skill directory
		mkdirSync(skillDir, { recursive: true });

		// Write SKILL.md
		const skillFilePath = join(skillDir, "SKILL.md");
		writeFileSync(skillFilePath, content, "utf-8");

		// Parse and validate
		const parseResult = parseSkillFile(skillFilePath, "imported");
		warnings.push(...parseResult.warnings);

		return {
			success: true,
			skill: parseResult.skill || undefined,
			installedPath: skillDir,
			warnings,
		};
	} catch (err) {
		return {
			success: false,
			warnings,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Export a local skill to a directory with proper structure.
 *
 * @param skill - Skill to export
 * @param outputDir - Output directory
 */
export function exportSkill(skill: AgentSkill, outputDir: string): ExportResult {
	const files: string[] = [];

	try {
		// Create skill directory
		const skillDir = join(outputDir, skill.name);
		mkdirSync(skillDir, { recursive: true });

		// Write SKILL.md
		const skillFilePath = join(skillDir, "SKILL.md");
		writeFileSync(skillFilePath, skill.content, "utf-8");
		files.push(skillFilePath);

		// Copy any additional files from source (scripts, references, assets)
		if (skill.baseDir && existsSync(skill.baseDir)) {
			const additionalDirs = ["scripts", "references", "assets"];
			for (const dir of additionalDirs) {
				const sourceDir = join(skill.baseDir, dir);
				if (existsSync(sourceDir)) {
					const targetSubDir = join(skillDir, dir);
					mkdirSync(targetSubDir, { recursive: true });

					// Copy files
					const entries = readdirSync(sourceDir, { withFileTypes: true });
					for (const entry of entries) {
						if (entry.isFile()) {
							const sourcePath = join(sourceDir, entry.name);
							const targetPath = join(targetSubDir, entry.name);
							const content = readFileSync(sourcePath);
							writeFileSync(targetPath, content);
							files.push(targetPath);
						}
					}
				}
			}
		}

		return {
			success: true,
			outputPath: skillDir,
			files,
		};
	} catch (err) {
		return {
			success: false,
			files,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Create a new skill from scratch.
 *
 * @param name - Skill name (lowercase, hyphens only)
 * @param description - Skill description
 * @param content - Markdown content (instructions)
 * @param options - Additional options
 */
export function createSkill(
	name: string,
	description: string,
	content: string,
	options: {
		license?: string;
		allowedTools?: string[];
		installDir?: string;
	} = {},
): ExportResult {
	const files: string[] = [];

	try {
		// Validate name
		if (!/^[a-z0-9-]+$/.test(name)) {
			return {
				success: false,
				files,
				error: "Name must be lowercase letters, numbers, and hyphens only",
			};
		}

		if (name.length > 64) {
			return {
				success: false,
				files,
				error: "Name must be 64 characters or less",
			};
		}

		// Build frontmatter
		const frontmatterLines = ["---", `name: ${name}`, `description: ${description}`];

		if (options.license) {
			frontmatterLines.push(`license: ${options.license}`);
		}

		if (options.allowedTools && options.allowedTools.length > 0) {
			frontmatterLines.push(`allowed-tools: ${options.allowedTools.join(", ")}`);
		}

		frontmatterLines.push("---", "");

		const fullContent = frontmatterLines.join("\n") + content;

		// Determine installation directory
		const targetDir = options.installDir || getDefaultInstallDir();
		const skillDir = join(targetDir, name);

		// Create directory
		mkdirSync(skillDir, { recursive: true });

		// Write SKILL.md
		const skillFilePath = join(skillDir, "SKILL.md");
		writeFileSync(skillFilePath, fullContent, "utf-8");
		files.push(skillFilePath);

		return {
			success: true,
			outputPath: skillDir,
			files,
		};
	} catch (err) {
		return {
			success: false,
			files,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * List skills from the aitmpl.com catalog (via GitHub).
 *
 * @param options - Filter options
 */
export async function listCatalog(
	options: { category?: string; repo?: string; branch?: string } = {},
): Promise<CatalogResult> {
	const { repo = DEFAULT_REPO, branch = DEFAULT_BRANCH, category } = options;

	const skills: RemoteSkill[] = [];
	const categories: Record<string, number> = {};

	try {
		// Use GitHub API to list directories
		const apiBase = "https://api.github.com/repos";
		const categoriesToScan = category ? [category] : [...SKILL_CATEGORIES];

		for (const cat of categoriesToScan) {
			const apiUrl = `${apiBase}/${repo}/contents/${SKILLS_PATH}/${cat}?ref=${branch}`;

			try {
				const response = await fetch(apiUrl, {
					headers: {
						Accept: "application/vnd.github.v3+json",
						"User-Agent": "pi-discord-bot",
					},
				});

				if (!response.ok) {
					continue;
				}

				const items = (await response.json()) as Array<{ name: string; type: string; path: string }>;

				for (const item of items) {
					if (item.type === "dir" && !item.name.startsWith(".")) {
						// Fetch SKILL.md to get description
						const skillMdUrl = buildRawUrl(repo, branch, `${item.path}/SKILL.md`);
						try {
							const content = await fetchContent(skillMdUrl);
							const descMatch = content.match(/description:\s*(.+)/);
							const description = descMatch ? descMatch[1].trim() : "No description";

							skills.push({
								name: item.name,
								description,
								category: cat,
								url: skillMdUrl,
								repo,
								branch,
								path: item.path,
							});

							categories[cat] = (categories[cat] || 0) + 1;
						} catch {
							// Skip skills without valid SKILL.md
						}
					}
				}
			} catch {
				// Category doesn't exist or API error, skip
			}
		}

		return {
			skills,
			total: skills.length,
			categories,
		};
	} catch (err) {
		return {
			skills: [],
			total: 0,
			categories: {},
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Search skills in the catalog.
 *
 * @param query - Search query (matches name or description)
 * @param options - Search options
 */
export async function searchCatalog(
	query: string,
	options: {
		category?: string;
		limit?: number;
	} = {},
): Promise<CatalogResult> {
	const { category, limit = 20 } = options;

	const catalog = await listCatalog({ category });

	if (catalog.error) {
		return catalog;
	}

	const queryLower = query.toLowerCase();
	const matchedSkills = catalog.skills.filter(
		(skill) => skill.name.toLowerCase().includes(queryLower) || skill.description.toLowerCase().includes(queryLower),
	);

	// Recalculate categories for matched skills
	const categories: Record<string, number> = {};
	for (const skill of matchedSkills) {
		categories[skill.category] = (categories[skill.category] || 0) + 1;
	}

	return {
		skills: matchedSkills.slice(0, limit),
		total: matchedSkills.length,
		categories,
	};
}

/**
 * Batch import multiple skills.
 *
 * @param skillNames - Array of skill names to import
 * @param options - Import options
 */
export async function batchImport(
	skillNames: string[],
	options: {
		repo?: string;
		branch?: string;
		installDir?: string;
		overwrite?: boolean;
	} = {},
): Promise<{ results: Record<string, ImportResult>; succeeded: number; failed: number }> {
	const results: Record<string, ImportResult> = {};
	let succeeded = 0;
	let failed = 0;

	for (const name of skillNames) {
		const result = await importSkill(name, options);
		results[name] = result;
		if (result.success) {
			succeeded++;
		} else {
			failed++;
		}
	}

	return { results, succeeded, failed };
}

/**
 * Get installed skills count and list.
 */
export function getInstalledSkills(installDir?: string): { skills: string[]; path: string } {
	const targetDir = installDir || getDefaultInstallDir();

	if (!existsSync(targetDir)) {
		return { skills: [], path: targetDir };
	}

	try {
		const entries = readdirSync(targetDir, { withFileTypes: true });
		const skills = entries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.filter((entry) => existsSync(join(targetDir, entry.name, "SKILL.md")))
			.map((entry) => entry.name);

		return { skills, path: targetDir };
	} catch {
		return { skills: [], path: targetDir };
	}
}
