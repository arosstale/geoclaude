/**
 * Class 3.22: Double-Check Executor
 *
 * Implements Aider's architect/editor pattern for higher quality output.
 * Uses two-model architecture with verification pass.
 *
 * Flow:
 * 1. ARCHITECT: Reasoning model plans the approach
 * 2. EDITOR: Fast model executes the plan
 * 3. VERIFY: Architect reviews and approves/rejects
 * 4. ITERATE: If rejected, refine and retry
 *
 * Benefits:
 * - Separates planning from execution
 * - Verification catches errors before completion
 * - Cost-effective: cheap model for execution, expensive for reasoning
 * - Natural iteration on failures
 *
 * @module double-check-executor
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type ExecutorRole = "architect" | "editor" | "verifier";

export interface ExecutorModel {
	id: string;
	role: ExecutorRole;
	provider: string;
	capabilities: string[];
	costPer1kTokens: number;
}

export interface Plan {
	id: string;
	task: string;
	analysis: string;
	steps: PlanStep[];
	constraints: string[];
	expectedOutcome: string;
	estimatedComplexity: "simple" | "medium" | "complex";
	createdAt: number;
}

export interface PlanStep {
	id: number;
	action: string;
	tool?: string;
	params?: Record<string, unknown>;
	expectedResult: string;
	fallback?: string;
}

export interface ExecutionResult {
	planId: string;
	stepResults: StepResult[];
	finalOutput: string;
	success: boolean;
	duration: number;
	tokensUsed: number;
}

export interface StepResult {
	stepId: number;
	success: boolean;
	output: string;
	error?: string;
	duration: number;
}

export interface VerificationResult {
	approved: boolean;
	confidence: number;
	issues: VerificationIssue[];
	suggestions: string[];
	requiresIteration: boolean;
	refinedTask?: string;
}

export interface VerificationIssue {
	severity: "critical" | "major" | "minor";
	description: string;
	affectedStep?: number;
	fix?: string;
}

export interface DoubleCheckSession {
	id: string;
	task: string;
	iterations: DoubleCheckIteration[];
	status: "planning" | "executing" | "verifying" | "complete" | "failed";
	finalResult?: string;
	startTime: number;
	endTime?: number;
}

export interface DoubleCheckIteration {
	iteration: number;
	plan: Plan;
	execution: ExecutionResult;
	verification: VerificationResult;
	duration: number;
}

export interface DoubleCheckConfig {
	maxIterations: number;
	architectModel: string;
	editorModel: string;
	verifyThreshold: number;
	enablePersistence: boolean;
	dbPath: string;
	timeouts: {
		planning: number;
		execution: number;
		verification: number;
	};
}

export interface DoubleCheckEvents {
	"session:start": { session: DoubleCheckSession };
	"session:complete": { session: DoubleCheckSession; result: string };
	"session:failed": { session: DoubleCheckSession; error: Error };
	"phase:planning": { session: DoubleCheckSession; iteration: number };
	"phase:executing": { session: DoubleCheckSession; plan: Plan };
	"phase:verifying": { session: DoubleCheckSession; execution: ExecutionResult };
	"iteration:complete": { session: DoubleCheckSession; iteration: DoubleCheckIteration };
	"verification:rejected": { session: DoubleCheckSession; issues: VerificationIssue[] };
}

// =============================================================================
// Model Handlers Interface
// =============================================================================

export interface ModelHandlers {
	architect: {
		plan: (task: string, context?: string) => Promise<Plan>;
		verify: (task: string, plan: Plan, execution: ExecutionResult) => Promise<VerificationResult>;
	};
	editor: {
		execute: (plan: Plan, toolExecutor: ToolExecutor) => Promise<ExecutionResult>;
	};
}

export type ToolExecutor = (tool: string, params: Record<string, unknown>) => Promise<unknown>;

// =============================================================================
// Double-Check Executor
// =============================================================================

export class DoubleCheckExecutor extends EventEmitter {
	private db: Database.Database | null = null;
	private config: DoubleCheckConfig;
	private activeSessions: Map<string, DoubleCheckSession> = new Map();

	constructor(config: Partial<DoubleCheckConfig> = {}) {
		super();
		this.config = {
			maxIterations: 3,
			architectModel: "claude-3-5-sonnet",
			editorModel: "claude-3-haiku",
			verifyThreshold: 0.8,
			enablePersistence: true,
			dbPath: "./data/double-check.db",
			timeouts: {
				planning: 60000,
				execution: 120000,
				verification: 30000,
			},
			...config,
		};

		if (this.config.enablePersistence) {
			this.initDatabase();
		}
	}

	private initDatabase(): void {
		this.db = new Database(this.config.dbPath, { fileMustExist: false });
		this.db.pragma("journal_mode = WAL");

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS double_check_sessions (
				id TEXT PRIMARY KEY,
				task TEXT NOT NULL,
				status TEXT NOT NULL,
				iterations_json TEXT,
				final_result TEXT,
				start_time INTEGER NOT NULL,
				end_time INTEGER,
				created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
			);

			CREATE TABLE IF NOT EXISTS double_check_plans (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				iteration INTEGER NOT NULL,
				plan_json TEXT NOT NULL,
				created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
				FOREIGN KEY (session_id) REFERENCES double_check_sessions(id)
			);

			CREATE INDEX IF NOT EXISTS idx_sessions_status ON double_check_sessions(status);
			CREATE INDEX IF NOT EXISTS idx_plans_session ON double_check_plans(session_id);
		`);
	}

	// ---------------------------------------------------------------------------
	// Main Execution Flow
	// ---------------------------------------------------------------------------

	async execute(
		task: string,
		handlers: ModelHandlers,
		toolExecutor: ToolExecutor,
		options?: { context?: string; maxIterations?: number },
	): Promise<{ success: boolean; result: string; session: DoubleCheckSession }> {
		const sessionId = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const maxIterations = options?.maxIterations || this.config.maxIterations;

		const session: DoubleCheckSession = {
			id: sessionId,
			task,
			iterations: [],
			status: "planning",
			startTime: Date.now(),
		};

		this.activeSessions.set(sessionId, session);
		this.emit("session:start", { session });
		this.persistSession(session);

		try {
			let currentTask = task;
			let success = false;
			let finalResult = "";

			for (let i = 0; i < maxIterations; i++) {
				const iterationStart = Date.now();

				// Phase 1: ARCHITECT plans
				session.status = "planning";
				this.emit("phase:planning", { session, iteration: i + 1 });

				const plan = await this.withTimeout(
					handlers.architect.plan(currentTask, options?.context),
					this.config.timeouts.planning,
					"Planning timeout",
				);

				this.persistPlan(sessionId, i + 1, plan);

				// Phase 2: EDITOR executes
				session.status = "executing";
				this.emit("phase:executing", { session, plan });

				const execution = await this.withTimeout(
					handlers.editor.execute(plan, toolExecutor),
					this.config.timeouts.execution,
					"Execution timeout",
				);

				// Phase 3: ARCHITECT verifies
				session.status = "verifying";
				this.emit("phase:verifying", { session, execution });

				const verification = await this.withTimeout(
					handlers.architect.verify(task, plan, execution),
					this.config.timeouts.verification,
					"Verification timeout",
				);

				// Record iteration
				const iteration: DoubleCheckIteration = {
					iteration: i + 1,
					plan,
					execution,
					verification,
					duration: Date.now() - iterationStart,
				};
				session.iterations.push(iteration);
				this.emit("iteration:complete", { session, iteration });

				// Check verification result
				if (verification.approved && verification.confidence >= this.config.verifyThreshold) {
					success = true;
					finalResult = execution.finalOutput;
					break;
				}

				// Handle rejection
				this.emit("verification:rejected", { session, issues: verification.issues });

				if (!verification.requiresIteration) {
					// Can't improve, fail gracefully
					finalResult = execution.finalOutput;
					break;
				}

				// Prepare for next iteration
				currentTask = verification.refinedTask || this.refineTask(task, verification);
			}

			// Finalize session
			session.status = success ? "complete" : "failed";
			session.finalResult = finalResult;
			session.endTime = Date.now();
			this.persistSession(session);

			if (success) {
				this.emit("session:complete", { session, result: finalResult });
			} else {
				this.emit("session:failed", {
					session,
					error: new Error("Max iterations reached without approval"),
				});
			}

			return { success, result: finalResult, session };
		} catch (error) {
			session.status = "failed";
			session.endTime = Date.now();
			this.persistSession(session);
			this.emit("session:failed", { session, error: error as Error });
			throw error;
		} finally {
			this.activeSessions.delete(sessionId);
		}
	}

	// ---------------------------------------------------------------------------
	// Simplified Execute with Default Handlers
	// ---------------------------------------------------------------------------

	async executeWithLLM(
		task: string,
		llm: {
			call: (prompt: string, model?: string) => Promise<string>;
		},
		toolExecutor: ToolExecutor,
		tools: string[],
	): Promise<{ success: boolean; result: string; session: DoubleCheckSession }> {
		const handlers: ModelHandlers = {
			architect: {
				plan: async (taskText, context) => {
					const prompt = this.buildPlanningPrompt(taskText, tools, context);
					const response = await llm.call(prompt, this.config.architectModel);
					return this.parsePlanResponse(response, taskText);
				},
				verify: async (originalTask, plan, execution) => {
					const prompt = this.buildVerificationPrompt(originalTask, plan, execution);
					const response = await llm.call(prompt, this.config.architectModel);
					return this.parseVerificationResponse(response);
				},
			},
			editor: {
				execute: async (plan, executor) => {
					return this.executeSteps(plan, executor);
				},
			},
		};

		return this.execute(task, handlers, toolExecutor);
	}

	// ---------------------------------------------------------------------------
	// Prompt Builders
	// ---------------------------------------------------------------------------

	private buildPlanningPrompt(task: string, tools: string[], context?: string): string {
		return `You are an expert architect. Analyze this task and create a detailed execution plan.

TASK: ${task}

${context ? `CONTEXT:\n${context}\n` : ""}

AVAILABLE TOOLS: ${tools.join(", ")}

Create a plan with the following YAML structure:

\`\`\`yaml
analysis: |
  Your analysis of the task and approach
steps:
  - id: 1
    action: "Description of what to do"
    tool: "tool_name"
    params:
      param1: value1
    expectedResult: "What success looks like"
    fallback: "What to do if this fails"
  - id: 2
    action: "Next step..."
constraints:
  - "Any constraints or requirements"
expectedOutcome: "Final expected result"
complexity: "simple|medium|complex"
\`\`\`

Be specific. Each step should be atomic and verifiable.`;
	}

	private buildVerificationPrompt(task: string, plan: Plan, execution: ExecutionResult): string {
		const stepSummary = execution.stepResults
			.map((s) => `Step ${s.stepId}: ${s.success ? "SUCCESS" : "FAILED"} - ${s.output.slice(0, 100)}`)
			.join("\n");

		return `You are a senior reviewer. Verify if this execution correctly completed the task.

ORIGINAL TASK: ${task}

PLAN ANALYSIS: ${plan.analysis}

EXECUTION RESULTS:
${stepSummary}

FINAL OUTPUT:
${execution.finalOutput}

Evaluate with this YAML structure:

\`\`\`yaml
approved: true|false
confidence: 0.0-1.0
issues:
  - severity: "critical|major|minor"
    description: "Issue description"
    affectedStep: 1
    fix: "How to fix"
suggestions:
  - "Improvement suggestion"
requiresIteration: true|false
refinedTask: "If iteration needed, provide refined task description"
\`\`\`

Be thorough. Only approve if the task is correctly completed.`;
	}

	// ---------------------------------------------------------------------------
	// Response Parsers
	// ---------------------------------------------------------------------------

	private parsePlanResponse(response: string, task: string): Plan {
		const yamlMatch = response.match(/```(?:yaml)?\s*([\s\S]*?)```/);
		const yamlContent = yamlMatch ? yamlMatch[1] : response;

		// Simple YAML parsing
		const plan: Plan = {
			id: `plan_${Date.now()}`,
			task,
			analysis: this.extractYamlField(yamlContent, "analysis") || "No analysis provided",
			steps: this.extractSteps(yamlContent),
			constraints: this.extractYamlList(yamlContent, "constraints"),
			expectedOutcome: this.extractYamlField(yamlContent, "expectedOutcome") || "Task completion",
			estimatedComplexity:
				(this.extractYamlField(yamlContent, "complexity") as Plan["estimatedComplexity"]) || "medium",
			createdAt: Date.now(),
		};

		// Ensure at least one step
		if (plan.steps.length === 0) {
			plan.steps.push({
				id: 1,
				action: "Execute the task directly",
				expectedResult: "Task completed",
			});
		}

		return plan;
	}

	private parseVerificationResponse(response: string): VerificationResult {
		const yamlMatch = response.match(/```(?:yaml)?\s*([\s\S]*?)```/);
		const yamlContent = yamlMatch ? yamlMatch[1] : response;

		const approved = this.extractYamlField(yamlContent, "approved");
		const confidence = this.extractYamlField(yamlContent, "confidence");

		return {
			approved: approved?.toLowerCase() === "true",
			confidence: parseFloat(confidence || "0.5"),
			issues: this.extractIssues(yamlContent),
			suggestions: this.extractYamlList(yamlContent, "suggestions"),
			requiresIteration: this.extractYamlField(yamlContent, "requiresIteration")?.toLowerCase() === "true",
			refinedTask: this.extractYamlField(yamlContent, "refinedTask"),
		};
	}

	private extractYamlField(yaml: string, field: string): string | undefined {
		const regex = new RegExp(`^${field}:\\s*(.+?)$`, "mi");
		const match = yaml.match(regex);
		if (match) {
			return match[1].trim().replace(/^["']|["']$/g, "");
		}

		// Try multiline
		const multilineRegex = new RegExp(`^${field}:\\s*\\|\\s*\\n([\\s\\S]*?)(?=\\n\\w|$)`, "mi");
		const multiMatch = yaml.match(multilineRegex);
		if (multiMatch) {
			return multiMatch[1].trim();
		}

		return undefined;
	}

	private extractYamlList(yaml: string, field: string): string[] {
		const items: string[] = [];
		const regex = new RegExp(`${field}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, "i");
		const match = yaml.match(regex);

		if (match) {
			const listContent = match[1];
			const itemRegex = /-\s+["']?(.+?)["']?$/gm;
			let itemMatch;
			while ((itemMatch = itemRegex.exec(listContent)) !== null) {
				items.push(itemMatch[1].trim());
			}
		}

		return items;
	}

	private extractSteps(yaml: string): PlanStep[] {
		const steps: PlanStep[] = [];
		const stepsMatch = yaml.match(/steps:\s*\n([\s\S]*?)(?=\nconstraints:|$)/i);

		if (stepsMatch) {
			const stepsContent = stepsMatch[1];
			const stepBlocks = stepsContent.split(/\n\s*-\s+id:/);

			for (let i = 1; i < stepBlocks.length; i++) {
				const block = `id:${stepBlocks[i]}`;
				const id = parseInt(this.extractYamlField(block, "id") || String(i), 10);
				const action = this.extractYamlField(block, "action") || "";
				const tool = this.extractYamlField(block, "tool");
				const expectedResult = this.extractYamlField(block, "expectedResult") || "";
				const fallback = this.extractYamlField(block, "fallback");

				steps.push({ id, action, tool, expectedResult, fallback });
			}
		}

		return steps;
	}

	private extractIssues(yaml: string): VerificationIssue[] {
		const issues: VerificationIssue[] = [];
		const issuesMatch = yaml.match(/issues:\s*\n([\s\S]*?)(?=\nsuggestions:|$)/i);

		if (issuesMatch) {
			const issuesContent = issuesMatch[1];
			const issueBlocks = issuesContent.split(/\n\s*-\s+severity:/);

			for (let i = 1; i < issueBlocks.length; i++) {
				const block = `severity:${issueBlocks[i]}`;
				const severity = (this.extractYamlField(block, "severity") as VerificationIssue["severity"]) || "minor";
				const description = this.extractYamlField(block, "description") || "";
				const affectedStep = parseInt(this.extractYamlField(block, "affectedStep") || "0", 10) || undefined;
				const fix = this.extractYamlField(block, "fix");

				issues.push({ severity, description, affectedStep, fix });
			}
		}

		return issues;
	}

	// ---------------------------------------------------------------------------
	// Step Execution
	// ---------------------------------------------------------------------------

	private async executeSteps(plan: Plan, toolExecutor: ToolExecutor): Promise<ExecutionResult> {
		const startTime = Date.now();
		const stepResults: StepResult[] = [];
		let finalOutput = "";
		const tokensUsed = 0;

		for (const step of plan.steps) {
			const stepStart = Date.now();

			try {
				let output: unknown;

				if (step.tool) {
					output = await toolExecutor(step.tool, step.params || {});
				} else {
					output = `Step ${step.id} executed: ${step.action}`;
				}

				const outputStr = typeof output === "string" ? output : JSON.stringify(output);
				stepResults.push({
					stepId: step.id,
					success: true,
					output: outputStr,
					duration: Date.now() - stepStart,
				});

				finalOutput = outputStr; // Last successful output
			} catch (error) {
				const errorStr = error instanceof Error ? error.message : String(error);

				stepResults.push({
					stepId: step.id,
					success: false,
					output: "",
					error: errorStr,
					duration: Date.now() - stepStart,
				});

				// Try fallback
				if (step.fallback) {
					finalOutput = step.fallback;
				}
			}
		}

		return {
			planId: plan.id,
			stepResults,
			finalOutput,
			success: stepResults.every((r) => r.success),
			duration: Date.now() - startTime,
			tokensUsed,
		};
	}

	// ---------------------------------------------------------------------------
	// Utility Methods
	// ---------------------------------------------------------------------------

	private refineTask(originalTask: string, verification: VerificationResult): string {
		const criticalIssues = verification.issues.filter((i) => i.severity === "critical").map((i) => i.description);

		const fixes = verification.issues.filter((i) => i.fix).map((i) => i.fix);

		return `${originalTask}

PREVIOUS ISSUES TO ADDRESS:
${criticalIssues.map((i) => `- ${i}`).join("\n")}

SUGGESTED FIXES:
${fixes.map((f) => `- ${f}`).join("\n")}`;
	}

	private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
		return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
	}

	private persistSession(session: DoubleCheckSession): void {
		if (!this.db) return;

		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO double_check_sessions
			(id, task, status, iterations_json, final_result, start_time, end_time)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			session.id,
			session.task,
			session.status,
			JSON.stringify(session.iterations),
			session.finalResult || null,
			session.startTime,
			session.endTime || null,
		);
	}

	private persistPlan(sessionId: string, iteration: number, plan: Plan): void {
		if (!this.db) return;

		const stmt = this.db.prepare(`
			INSERT INTO double_check_plans (id, session_id, iteration, plan_json)
			VALUES (?, ?, ?, ?)
		`);

		stmt.run(plan.id, sessionId, iteration, JSON.stringify(plan));
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getActiveSessions(): DoubleCheckSession[] {
		return Array.from(this.activeSessions.values());
	}

	getSessionHistory(limit: number = 10): DoubleCheckSession[] {
		if (!this.db) return [];

		const stmt = this.db.prepare(`
			SELECT * FROM double_check_sessions
			ORDER BY start_time DESC LIMIT ?
		`);

		const rows = stmt.all(limit) as any[];
		return rows.map((row) => ({
			id: row.id,
			task: row.task,
			iterations: JSON.parse(row.iterations_json || "[]"),
			status: row.status,
			finalResult: row.final_result,
			startTime: row.start_time,
			endTime: row.end_time,
		}));
	}

	getStats(): {
		total: number;
		completed: number;
		failed: number;
		avgIterations: number;
		avgDuration: number;
	} {
		if (!this.db) {
			return { total: 0, completed: 0, failed: 0, avgIterations: 0, avgDuration: 0 };
		}

		const stmt = this.db.prepare(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as completed,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
				AVG(json_array_length(iterations_json)) as avg_iterations,
				AVG(end_time - start_time) as avg_duration
			FROM double_check_sessions
			WHERE end_time IS NOT NULL
		`);

		const row = stmt.get() as any;
		return {
			total: row.total || 0,
			completed: row.completed || 0,
			failed: row.failed || 0,
			avgIterations: Math.round((row.avg_iterations || 0) * 10) / 10,
			avgDuration: Math.round(row.avg_duration || 0),
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: DoubleCheckExecutor | null = null;

export function getDoubleCheckExecutor(config?: Partial<DoubleCheckConfig>): DoubleCheckExecutor {
	if (!instance) {
		instance = new DoubleCheckExecutor(config);
	}
	return instance;
}

export function resetDoubleCheckExecutor(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
