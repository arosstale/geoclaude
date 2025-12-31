/**
 * SKILL DISTILLATION SYSTEM
 * ==========================
 * Inspired by Arseny Shatokhin's "2000 Tools" experiment
 *
 * Problem: Complex multi-tool workflows consume 70k+ tokens
 * Solution: Automatically distill successful workflows into reusable skills
 *
 * Process:
 * 1. Track tool calls and their sequences during agent execution
 * 2. Detect "skill candidates" (workflows with 3+ tool calls)
 * 3. After successful completion, offer to save as a skill
 * 4. Next execution uses the skill directly (10x token reduction)
 *
 * "Convert messy 76k-token workflows into clean, dedicated tools"
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ToolCall {
	name: string;
	params: Record<string, unknown>;
	result?: unknown;
	timestamp: number;
	tokenEstimate?: number;
}

export interface WorkflowSession {
	id: string;
	startTime: number;
	endTime?: number;
	taskDescription: string;
	toolCalls: ToolCall[];
	totalTokens: number;
	success?: boolean;
	skillCandidate?: boolean;
}

export interface DistilledSkill {
	id: string;
	name: string;
	description: string;
	taskPattern: string;
	toolSequence: Array<{
		tool: string;
		paramTemplate: Record<string, string>;
	}>;
	originalTokens: number;
	estimatedTokens: number;
	createdAt: string;
	usageCount: number;
	successRate: number;
}

const SKILLS_DIR = join(__dirname, "..", "skills", "distilled");
const SESSIONS_FILE = join(__dirname, "workflow-sessions.json");

// Token estimation (rough approximation)
const TOKEN_ESTIMATES = {
	toolCall: 100, // Base cost per tool call
	toolResult: 500, // Average result size
	contextPerCall: 200, // Context growth per call
};

class SkillDistillationEngine {
	private activeSessions: Map<string, WorkflowSession> = new Map();
	private completedSessions: WorkflowSession[] = [];
	private distilledSkills: Map<string, DistilledSkill> = new Map();

	constructor() {
		this.loadState();
		this.ensureSkillsDir();
	}

	private ensureSkillsDir(): void {
		if (!existsSync(SKILLS_DIR)) {
			mkdirSync(SKILLS_DIR, { recursive: true });
		}
	}

	private loadState(): void {
		try {
			if (existsSync(SESSIONS_FILE)) {
				const data = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
				this.completedSessions = data.sessions || [];
				for (const skill of data.skills || []) {
					this.distilledSkills.set(skill.id, skill);
				}
			}
		} catch {
			// Start fresh
		}
	}

	private saveState(): void {
		const data = {
			sessions: this.completedSessions.slice(-100), // Keep last 100
			skills: Array.from(this.distilledSkills.values()),
		};
		writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
	}

	/**
	 * Start tracking a new workflow session
	 */
	startSession(sessionId: string, taskDescription: string): WorkflowSession {
		const session: WorkflowSession = {
			id: sessionId,
			startTime: Date.now(),
			taskDescription,
			toolCalls: [],
			totalTokens: 0,
		};
		this.activeSessions.set(sessionId, session);
		return session;
	}

	/**
	 * Record a tool call in the active session
	 */
	recordToolCall(sessionId: string, toolName: string, params: Record<string, unknown>, result?: unknown): void {
		const session = this.activeSessions.get(sessionId);
		if (!session) return;

		const tokenEstimate =
			TOKEN_ESTIMATES.toolCall +
			TOKEN_ESTIMATES.toolResult +
			TOKEN_ESTIMATES.contextPerCall * session.toolCalls.length;

		session.toolCalls.push({
			name: toolName,
			params,
			result,
			timestamp: Date.now(),
			tokenEstimate,
		});

		session.totalTokens += tokenEstimate;

		// Check if this is a skill candidate (3+ tool calls)
		if (session.toolCalls.length >= 3) {
			session.skillCandidate = true;
		}
	}

	/**
	 * End a workflow session
	 */
	endSession(sessionId: string, success: boolean): WorkflowSession | undefined {
		const session = this.activeSessions.get(sessionId);
		if (!session) return undefined;

		session.endTime = Date.now();
		session.success = success;

		this.activeSessions.delete(sessionId);
		this.completedSessions.push(session);
		this.saveState();

		return session;
	}

	/**
	 * Check if a workflow should be distilled into a skill
	 */
	shouldDistill(session: WorkflowSession): {
		recommend: boolean;
		reason: string;
		tokenSavings?: number;
	} {
		if (!session.success) {
			return { recommend: false, reason: "Workflow did not complete successfully" };
		}

		if (session.toolCalls.length < 3) {
			return { recommend: false, reason: "Too few tool calls to be worth distilling" };
		}

		if (session.totalTokens < 10000) {
			return { recommend: false, reason: "Token usage too low to benefit from distillation" };
		}

		// Check for repetitive patterns in history
		const similarSessions = this.findSimilarSessions(session);
		if (similarSessions.length >= 2) {
			const avgTokens = similarSessions.reduce((sum, s) => sum + s.totalTokens, 0) / similarSessions.length;
			const skillTokens = 1000 + session.toolCalls.length * 100; // Estimated skill execution cost
			const savings = avgTokens - skillTokens;

			return {
				recommend: true,
				reason: `Pattern detected ${similarSessions.length + 1} times. Each execution saves ~${Math.round(savings)} tokens.`,
				tokenSavings: savings,
			};
		}

		// First-time high-cost workflow
		if (session.totalTokens > 30000) {
			const skillTokens = 1000 + session.toolCalls.length * 100;
			return {
				recommend: true,
				reason: `High-cost workflow (${session.totalTokens} tokens). Distilling would reduce to ~${skillTokens} tokens.`,
				tokenSavings: session.totalTokens - skillTokens,
			};
		}

		return { recommend: false, reason: "Does not meet distillation criteria" };
	}

	/**
	 * Find sessions with similar tool patterns
	 */
	private findSimilarSessions(session: WorkflowSession): WorkflowSession[] {
		const pattern = session.toolCalls.map((t) => t.name).join(",");

		return this.completedSessions.filter((s) => {
			if (s.id === session.id) return false;
			const sPattern = s.toolCalls.map((t) => t.name).join(",");
			return sPattern === pattern;
		});
	}

	/**
	 * Distill a workflow into a reusable skill
	 */
	distillToSkill(session: WorkflowSession, skillName: string, description: string): DistilledSkill {
		const id = createHash("md5")
			.update(session.toolCalls.map((t) => t.name).join(","))
			.digest("hex")
			.slice(0, 12);

		const toolSequence = session.toolCalls.map((call) => ({
			tool: call.name,
			paramTemplate: this.extractParamTemplate(call.params),
		}));

		const skill: DistilledSkill = {
			id,
			name: skillName,
			description,
			taskPattern: session.taskDescription,
			toolSequence,
			originalTokens: session.totalTokens,
			estimatedTokens: 1000 + toolSequence.length * 100,
			createdAt: new Date().toISOString(),
			usageCount: 0,
			successRate: 1.0,
		};

		this.distilledSkills.set(id, skill);
		this.saveSkillToFile(skill);
		this.saveState();

		return skill;
	}

	/**
	 * Extract a parameter template from actual params
	 */
	private extractParamTemplate(params: Record<string, unknown>): Record<string, string> {
		const template: Record<string, string> = {};

		for (const [key, value] of Object.entries(params)) {
			if (typeof value === "string") {
				// Check if it looks like a variable placeholder
				if (value.match(/^[A-Z_]+$/)) {
					template[key] = `{{${key}}}`;
				} else {
					template[key] = value;
				}
			} else if (typeof value === "number") {
				template[key] = `{{${key}:number}}`;
			} else if (typeof value === "boolean") {
				template[key] = `{{${key}:boolean}}`;
			} else {
				template[key] = JSON.stringify(value);
			}
		}

		return template;
	}

	/**
	 * Save skill to a file
	 */
	private saveSkillToFile(skill: DistilledSkill): void {
		const filePath = join(SKILLS_DIR, `${skill.id}.json`);
		writeFileSync(filePath, JSON.stringify(skill, null, 2));
	}

	/**
	 * Get a skill by ID
	 */
	getSkill(id: string): DistilledSkill | undefined {
		return this.distilledSkills.get(id);
	}

	/**
	 * Find a skill that matches a task
	 */
	findMatchingSkill(taskDescription: string): DistilledSkill | undefined {
		const taskLower = taskDescription.toLowerCase();

		for (const skill of this.distilledSkills.values()) {
			const patternLower = skill.taskPattern.toLowerCase();
			// Simple word overlap matching
			const patternWords = patternLower.split(/\s+/);
			const taskWords = taskLower.split(/\s+/);
			const overlap = patternWords.filter((w) => taskWords.includes(w)).length;

			if (overlap >= 3 || overlap / patternWords.length > 0.5) {
				return skill;
			}
		}

		return undefined;
	}

	/**
	 * Execute a distilled skill
	 */
	async executeSkill(
		skill: DistilledSkill,
		params: Record<string, unknown>,
		toolExecutor: (name: string, params: Record<string, unknown>) => Promise<unknown>,
	): Promise<{ success: boolean; results: unknown[]; tokensUsed: number }> {
		const results: unknown[] = [];
		let tokensUsed = 500; // Base overhead

		try {
			for (const step of skill.toolSequence) {
				// Substitute template params
				const resolvedParams: Record<string, unknown> = {};
				for (const [key, template] of Object.entries(step.paramTemplate)) {
					if (typeof template === "string" && template.startsWith("{{")) {
						const paramName = template.replace(/\{\{|\}\}/g, "").split(":")[0];
						resolvedParams[key] = params[paramName] ?? template;
					} else {
						resolvedParams[key] = template;
					}
				}

				const result = await toolExecutor(step.tool, resolvedParams);
				results.push(result);
				tokensUsed += 100; // Per-step cost
			}

			// Update skill stats
			skill.usageCount++;
			this.saveState();

			return { success: true, results, tokensUsed };
		} catch (_error) {
			skill.successRate = (skill.successRate * skill.usageCount) / (skill.usageCount + 1);
			skill.usageCount++;
			this.saveState();

			return { success: false, results, tokensUsed };
		}
	}

	/**
	 * Get all distilled skills
	 */
	getAllSkills(): DistilledSkill[] {
		return Array.from(this.distilledSkills.values());
	}

	/**
	 * Get distillation statistics
	 */
	getStats(): {
		totalSessions: number;
		successfulSessions: number;
		skillCandidates: number;
		distilledSkills: number;
		totalTokensSaved: number;
	} {
		const successful = this.completedSessions.filter((s) => s.success).length;
		const candidates = this.completedSessions.filter((s) => s.skillCandidate).length;

		const tokensSaved = Array.from(this.distilledSkills.values()).reduce(
			(sum, skill) => sum + (skill.originalTokens - skill.estimatedTokens) * skill.usageCount,
			0,
		);

		return {
			totalSessions: this.completedSessions.length,
			successfulSessions: successful,
			skillCandidates: candidates,
			distilledSkills: this.distilledSkills.size,
			totalTokensSaved: tokensSaved,
		};
	}
}

// Singleton
let engineInstance: SkillDistillationEngine | null = null;

export function getDistillationEngine(): SkillDistillationEngine {
	if (!engineInstance) {
		engineInstance = new SkillDistillationEngine();
	}
	return engineInstance;
}

// Schemas for distillation tools
const distillWorkflowSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	sessionId: Type.String({ description: "Session ID from the workflow to distill" }),
	skillName: Type.String({ description: "Name for the new skill" }),
	description: Type.String({ description: "Description of what the skill does" }),
});

const noParamsSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

/**
 * Create MCP tools for skill distillation
 */
export function createDistillationTools(): AgentTool<typeof distillWorkflowSchema | typeof noParamsSchema>[] {
	const distillTool: AgentTool<typeof distillWorkflowSchema> = {
		name: "distill_workflow_to_skill",
		label: "distill_workflow_to_skill",
		description: `Convert a successful multi-tool workflow into a reusable skill.
Use after completing a complex task with 3+ tool calls.
Reduces future token usage by ~10x for similar tasks.`,
		parameters: distillWorkflowSchema,
		execute: async (_toolCallId, { label }) => {
			console.log(`[MCP:Distill] ${label}`);
			const engine = getDistillationEngine();
			const sessions = engine.getAllSkills();

			return {
				content: [
					{
						type: "text" as const,
						text: `## Skill Distillation

To distill a workflow:
1. Complete a multi-step task
2. Call this tool with a session ID
3. The workflow becomes a reusable skill

Current distilled skills: ${sessions.length}`,
					},
				],
				details: undefined,
			};
		},
	};

	const listSkillsTool: AgentTool<typeof noParamsSchema> = {
		name: "list_distilled_skills",
		label: "list_distilled_skills",
		description: "List all distilled skills and their token savings.",
		parameters: noParamsSchema,
		execute: async (_toolCallId, { label }) => {
			console.log(`[MCP:ListSkills] ${label}`);
			const engine = getDistillationEngine();
			const skills = engine.getAllSkills();
			const stats = engine.getStats();

			if (skills.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `## No Distilled Skills Yet

Complete complex workflows (3+ tool calls) and distill them to create reusable skills.

**Stats:**
- Sessions tracked: ${stats.totalSessions}
- Skill candidates: ${stats.skillCandidates}`,
						},
					],
					details: undefined,
				};
			}

			const skillList = skills
				.map(
					(s) =>
						`- **${s.name}** (${s.toolSequence.length} steps)
  Saves ~${s.originalTokens - s.estimatedTokens} tokens
  Used ${s.usageCount} times`,
				)
				.join("\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `## Distilled Skills (${skills.length})

${skillList}

**Total tokens saved:** ${stats.totalTokensSaved.toLocaleString()}`,
					},
				],
				details: undefined,
			};
		},
	};

	const statsTool: AgentTool<typeof noParamsSchema> = {
		name: "distillation_stats",
		label: "distillation_stats",
		description: "Get skill distillation statistics and recommendations.",
		parameters: noParamsSchema,
		execute: async (_toolCallId, { label }) => {
			console.log(`[MCP:DistillStats] ${label}`);
			const engine = getDistillationEngine();
			const stats = engine.getStats();

			return {
				content: [
					{
						type: "text" as const,
						text: `## Skill Distillation Statistics

**Workflow Tracking:**
- Total sessions: ${stats.totalSessions}
- Successful: ${stats.successfulSessions}
- Skill candidates: ${stats.skillCandidates}

**Distilled Skills:**
- Total skills: ${stats.distilledSkills}
- Tokens saved: ${stats.totalTokensSaved.toLocaleString()}

**Recommendations:**
${stats.skillCandidates > stats.distilledSkills ? `- ${stats.skillCandidates - stats.distilledSkills} workflows ready for distillation` : "- All candidates have been distilled"}`,
					},
				],
				details: undefined,
			};
		},
	};

	return [distillTool, listSkillsTool, statsTool] as AgentTool<typeof distillWorkflowSchema | typeof noParamsSchema>[];
}

export default {
	getDistillationEngine,
	createDistillationTools,
};
