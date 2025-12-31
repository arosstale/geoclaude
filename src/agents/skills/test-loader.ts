#!/usr/bin/env tsx
/**
 * Quick test for skills loader.
 */

import { getSkillsLoader } from "./loader.js";

const loader = getSkillsLoader({
	enableClaudeUser: false,
	enableClaudeProject: true,
	enablePiUser: false,
	enablePiProject: false,
});

const result = loader.load();

console.log(`Loaded ${result.skills.length} skills:`);
for (const skill of result.skills) {
	console.log(`  - ${skill.name} (${skill.source}): ${skill.description.slice(0, 60)}...`);
	console.log(`    Path: ${skill.path}`);
	if (skill.allowedTools) {
		console.log(`    Allowed tools: ${skill.allowedTools.join(", ")}`);
	}
}

if (result.warnings.length > 0) {
	console.log(`\nWarnings (${result.warnings.length}):`);
	for (const warning of result.warnings) {
		console.log(`  - ${warning.skillPath}: ${warning.message}`);
	}
}

console.log("\nFormatted for prompt:");
console.log(loader.formatForPrompt());

console.log("\nFiltered (trading only):");
const tradingSkills = loader.filter(["trading"]);
console.log(`Found ${tradingSkills.length} trading skills`);
