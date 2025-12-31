/**
 * Batch Import Module
 *
 * Import the top high-value skills from aitmpl.com catalog.
 * Prioritizes skill-creator first, then imports essential development skills.
 */

import { type ImportResult, importSkill } from "./sync.js";

/** High-value skills to import (in priority order) */
export const TOP_SKILLS = [
	"skill-creator", // Meta skill - creates other skills
	"commit", // Git commit with conventional format
	"code-review", // Code review with quality checks
	"pr-review", // Pull request review
	"debug", // Debugging assistance
	"refactor", // Code refactoring
	"test-gen", // Test generation
	"docs-gen", // Documentation generation
] as const;

export type TopSkillName = (typeof TOP_SKILLS)[number];

/** Batch import result summary */
export interface BatchImportResult {
	/** Total skills attempted */
	total: number;
	/** Successfully imported count */
	succeeded: number;
	/** Failed imports count */
	failed: number;
	/** Per-skill results */
	results: Record<string, ImportResult>;
	/** Summary of imported skills */
	imported: string[];
	/** Summary of failed skills with reasons */
	failures: Array<{ skill: string; reason: string }>;
}

/**
 * Batch import top skills from aitmpl.com catalog.
 *
 * @param options - Import options
 * @returns Summary of import results
 *
 * @example
 * ```typescript
 * const result = await batchImportTopSkills({
 *   installDir: ".claude/skills",
 *   overwrite: false
 * });
 *
 * console.log(`Imported ${result.succeeded}/${result.total} skills`);
 * result.imported.forEach(name => console.log(`✓ ${name}`));
 * result.failures.forEach(f => console.log(`✗ ${f.skill}: ${f.reason}`));
 * ```
 */
export async function batchImportTopSkills(
	options: {
		/** Installation directory (defaults to ~/.claude/skills) */
		installDir?: string;
		/** Overwrite existing skills */
		overwrite?: boolean;
		/** Repository to import from */
		repo?: string;
		/** Branch to import from */
		branch?: string;
		/** Skip skill-creator if already installed */
		skipSkillCreator?: boolean;
	} = {},
): Promise<BatchImportResult> {
	const results: Record<string, ImportResult> = {};
	const imported: string[] = [];
	const failures: Array<{ skill: string; reason: string }> = [];

	const { installDir, overwrite = false, repo, branch, skipSkillCreator = false } = options;

	// Import skill-creator first (meta skill for creating other skills)
	if (!skipSkillCreator) {
		console.log("Importing skill-creator (meta skill)...");
		const skillCreatorResult = await importSkill("skill-creator", {
			installDir,
			overwrite,
			repo,
			branch,
			category: "development",
		});

		results["skill-creator"] = skillCreatorResult;

		if (skillCreatorResult.success) {
			imported.push("skill-creator");
			console.log(`✓ skill-creator imported to ${skillCreatorResult.installedPath}`);
		} else {
			failures.push({
				skill: "skill-creator",
				reason: skillCreatorResult.error || "Unknown error",
			});
			console.error(`✗ skill-creator failed: ${skillCreatorResult.error}`);
		}
	}

	// Import remaining skills
	const remainingSkills = TOP_SKILLS.filter((s) => s !== "skill-creator");

	for (const skillName of remainingSkills) {
		console.log(`Importing ${skillName}...`);

		try {
			const result = await importSkill(skillName, {
				installDir,
				overwrite,
				repo,
				branch,
				// Let importSkill search across categories
			});

			results[skillName] = result;

			if (result.success) {
				imported.push(skillName);
				console.log(`✓ ${skillName} imported to ${result.installedPath}`);

				// Log warnings if any
				if (result.warnings.length > 0) {
					for (const warning of result.warnings) {
						console.warn(`  ⚠ ${warning.message}`);
					}
				}
			} else {
				failures.push({
					skill: skillName,
					reason: result.error || "Unknown error",
				});
				console.error(`✗ ${skillName} failed: ${result.error}`);
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			failures.push({
				skill: skillName,
				reason: errorMsg,
			});
			results[skillName] = {
				success: false,
				warnings: [],
				error: errorMsg,
			};
			console.error(`✗ ${skillName} exception: ${errorMsg}`);
		}

		// Small delay between requests to avoid rate limiting
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	const succeeded = imported.length;
	const failed = failures.length;
	const total = Object.keys(results).length;

	return {
		total,
		succeeded,
		failed,
		results,
		imported,
		failures,
	};
}

/**
 * Import specific subset of skills.
 *
 * @param skillNames - Array of skill names to import
 * @param options - Import options
 * @returns Import results
 */
export async function batchImportSkills(
	skillNames: string[],
	options: {
		installDir?: string;
		overwrite?: boolean;
		repo?: string;
		branch?: string;
	} = {},
): Promise<BatchImportResult> {
	const results: Record<string, ImportResult> = {};
	const imported: string[] = [];
	const failures: Array<{ skill: string; reason: string }> = [];

	for (const skillName of skillNames) {
		console.log(`Importing ${skillName}...`);

		try {
			const result = await importSkill(skillName, options);
			results[skillName] = result;

			if (result.success) {
				imported.push(skillName);
				console.log(`✓ ${skillName} imported to ${result.installedPath}`);

				if (result.warnings.length > 0) {
					for (const warning of result.warnings) {
						console.warn(`  ⚠ ${warning.message}`);
					}
				}
			} else {
				failures.push({
					skill: skillName,
					reason: result.error || "Unknown error",
				});
				console.error(`✗ ${skillName} failed: ${result.error}`);
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			failures.push({
				skill: skillName,
				reason: errorMsg,
			});
			results[skillName] = {
				success: false,
				warnings: [],
				error: errorMsg,
			};
			console.error(`✗ ${skillName} exception: ${errorMsg}`);
		}

		// Small delay to avoid rate limiting
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	return {
		total: Object.keys(results).length,
		succeeded: imported.length,
		failed: failures.length,
		results,
		imported,
		failures,
	};
}
