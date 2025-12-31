/**
 * Skills Sync Module Tests
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AgentSkill,
	createSkill,
	exportSkill,
	getDefaultInstallDir,
	getInstalledSkills,
	importSkillFromUrl,
} from "./index.js";

describe("Skills Sync Module", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `skills-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("getDefaultInstallDir", () => {
		it("should return user-level skills directory by default", () => {
			const dir = getDefaultInstallDir();
			expect(dir).toContain(".claude");
			expect(dir).toContain("skills");
		});

		it("should prefer project-level if .claude exists", () => {
			const projectDir = join(testDir, "project");
			mkdirSync(join(projectDir, ".claude"), { recursive: true });

			const dir = getDefaultInstallDir(projectDir);
			expect(dir).toBe(join(projectDir, ".claude", "skills"));
		});
	});

	describe("createSkill", () => {
		it("should create a valid SKILL.md file", () => {
			const result = createSkill("test-skill", "A test skill for testing purposes", "# Test\n\nThis is a test.", {
				installDir: testDir,
			});

			expect(result.success).toBe(true);
			expect(result.outputPath).toBe(join(testDir, "test-skill"));
			expect(result.files).toContain(join(testDir, "test-skill", "SKILL.md"));

			const content = readFileSync(join(testDir, "test-skill", "SKILL.md"), "utf-8");
			expect(content).toContain("name: test-skill");
			expect(content).toContain("description: A test skill for testing purposes");
			expect(content).toContain("# Test");
		});

		it("should include optional fields", () => {
			const result = createSkill("licensed-skill", "Skill with license", "Content", {
				installDir: testDir,
				license: "MIT",
				allowedTools: ["Read", "Write", "Bash"],
			});

			expect(result.success).toBe(true);

			const content = readFileSync(join(testDir, "licensed-skill", "SKILL.md"), "utf-8");
			expect(content).toContain("license: MIT");
			expect(content).toContain("allowed-tools: Read, Write, Bash");
		});

		it("should reject invalid names", () => {
			const result = createSkill("Invalid Name!", "Description", "Content", {
				installDir: testDir,
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("lowercase");
		});

		it("should reject names that are too long", () => {
			const longName = "a".repeat(65);
			const result = createSkill(longName, "Description", "Content", {
				installDir: testDir,
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("64 characters");
		});
	});

	describe("exportSkill", () => {
		it("should export skill with proper structure", () => {
			const skill: AgentSkill = {
				name: "exported-skill",
				description: "An exported skill",
				content: "---\nname: exported-skill\ndescription: An exported skill\n---\n\n# Content",
				path: "/some/path/SKILL.md",
				baseDir: "/some/path",
				source: "test",
			};

			const outputDir = join(testDir, "export");
			const result = exportSkill(skill, outputDir);

			expect(result.success).toBe(true);
			expect(result.outputPath).toBe(join(outputDir, "exported-skill"));
			expect(existsSync(join(outputDir, "exported-skill", "SKILL.md"))).toBe(true);
		});

		it("should copy additional directories if they exist", () => {
			// Create source skill with scripts directory
			const sourceDir = join(testDir, "source-skill");
			mkdirSync(join(sourceDir, "scripts"), { recursive: true });
			writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: source-skill\n---\nContent");
			writeFileSync(join(sourceDir, "scripts", "helper.sh"), "#!/bin/bash\necho 'hello'");

			const skill: AgentSkill = {
				name: "source-skill",
				description: "Skill with scripts",
				content: "---\nname: source-skill\n---\nContent",
				path: join(sourceDir, "SKILL.md"),
				baseDir: sourceDir,
				source: "test",
			};

			const outputDir = join(testDir, "export-with-scripts");
			const result = exportSkill(skill, outputDir);

			expect(result.success).toBe(true);
			expect(result.files.length).toBe(2);
			expect(existsSync(join(outputDir, "source-skill", "scripts", "helper.sh"))).toBe(true);
		});
	});

	describe("getInstalledSkills", () => {
		it("should list installed skills", () => {
			// Create some skills
			const skill1Dir = join(testDir, "skill-one");
			const skill2Dir = join(testDir, "skill-two");
			mkdirSync(skill1Dir, { recursive: true });
			mkdirSync(skill2Dir, { recursive: true });
			writeFileSync(join(skill1Dir, "SKILL.md"), "---\nname: skill-one\n---");
			writeFileSync(join(skill2Dir, "SKILL.md"), "---\nname: skill-two\n---");

			// Create a directory without SKILL.md (should be ignored)
			const notASkill = join(testDir, "not-a-skill");
			mkdirSync(notASkill, { recursive: true });

			const result = getInstalledSkills(testDir);

			expect(result.skills).toContain("skill-one");
			expect(result.skills).toContain("skill-two");
			expect(result.skills).not.toContain("not-a-skill");
			expect(result.path).toBe(testDir);
		});

		it("should return empty array for non-existent directory", () => {
			const result = getInstalledSkills(join(testDir, "nonexistent"));

			expect(result.skills).toEqual([]);
		});
	});

	describe("importSkillFromUrl", () => {
		it("should import skill from URL (mocked)", async () => {
			// Mock fetch
			const mockContent = `---
name: imported-skill
description: A skill imported from URL
license: MIT
---

# Imported Skill

This skill was imported from a URL.
`;

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve(mockContent),
			});

			const result = await importSkillFromUrl("https://example.com/skills/imported-skill/SKILL.md", {
				installDir: testDir,
			});

			expect(result.success).toBe(true);
			expect(result.installedPath).toBe(join(testDir, "imported-skill"));
			expect(existsSync(join(testDir, "imported-skill", "SKILL.md"))).toBe(true);

			const content = readFileSync(join(testDir, "imported-skill", "SKILL.md"), "utf-8");
			expect(content).toContain("name: imported-skill");
		});

		it("should handle fetch errors gracefully", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
			});

			const result = await importSkillFromUrl("https://example.com/nonexistent/SKILL.md", {
				installDir: testDir,
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("404");
		});

		it("should not overwrite existing skill without flag", async () => {
			// Create existing skill
			const existingDir = join(testDir, "existing-skill");
			mkdirSync(existingDir, { recursive: true });
			writeFileSync(join(existingDir, "SKILL.md"), "original content");

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve("---\nname: existing-skill\n---\nnew content"),
			});

			const result = await importSkillFromUrl("https://example.com/existing-skill/SKILL.md", {
				skillName: "existing-skill",
				installDir: testDir,
				overwrite: false,
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("already exists");

			// Original content should be preserved
			const content = readFileSync(join(existingDir, "SKILL.md"), "utf-8");
			expect(content).toBe("original content");
		});

		it("should overwrite existing skill with flag", async () => {
			// Create existing skill
			const existingDir = join(testDir, "overwrite-skill");
			mkdirSync(existingDir, { recursive: true });
			writeFileSync(join(existingDir, "SKILL.md"), "original content");

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve("---\nname: overwrite-skill\ndescription: Overwritten\n---\nnew content"),
			});

			const result = await importSkillFromUrl("https://example.com/overwrite-skill/SKILL.md", {
				skillName: "overwrite-skill",
				installDir: testDir,
				overwrite: true,
			});

			expect(result.success).toBe(true);

			// Content should be replaced
			const content = readFileSync(join(existingDir, "SKILL.md"), "utf-8");
			expect(content).toContain("new content");
		});
	});
});
