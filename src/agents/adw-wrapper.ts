/**
 * ADW - AI Developer Workflow Wrapper
 *
 * Codebase Singularity Class 3.2 - Deterministic Workflow Foundation
 * "Deterministic code + non-deterministic agents"
 *
 * This wrapper provides:
 * - Deterministic workflow orchestration
 * - Quality gates between agent steps
 * - Automatic validation and rollback
 * - Progress tracking and resumability
 * - Event-driven coordination
 *
 * Based on: Tactical Agentic Coding framework
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { type DelegationResult, getOrchestrator } from "./orchestrator.js";

// =============================================================================
// Types
// =============================================================================

/** Quality gate definition */
export interface QualityGate {
	name: string;
	description: string;
	validator: (input: unknown, output: unknown) => Promise<GateResult>;
	required: boolean;
	retryOnFail: boolean;
	maxRetries: number;
}

/** Quality gate result */
export interface GateResult {
	passed: boolean;
	score: number; // 0-100
	issues: string[];
	suggestions: string[];
}

/** ADW step definition */
export interface ADWStep {
	id: string;
	name: string;
	description: string;
	agentRole: "architect" | "builder" | "tester" | "reviewer" | "expert";
	prompt: string | ((context: ADWContext) => string);
	inputTransform?: (context: ADWContext) => Record<string, unknown>;
	outputTransform?: (output: unknown) => unknown;
	qualityGates: QualityGate[];
	timeout: number;
	optional: boolean;
	dependsOn: string[];
}

/** ADW workflow definition */
export interface ADWWorkflow {
	id: string;
	name: string;
	description: string;
	steps: ADWStep[];
	globalGates: QualityGate[];
	onError: "abort" | "skip" | "retry" | "rollback";
	maxGlobalRetries: number;
}

/** Execution context passed between steps */
export interface ADWContext {
	workflowId: string;
	executionId: string;
	startedAt: Date;
	currentStep: string;
	stepOutputs: Map<string, unknown>;
	metadata: Record<string, unknown>;
	variables: Record<string, unknown>;
}

/** Step execution result */
export interface ADWStepResult {
	stepId: string;
	status: "success" | "failed" | "skipped" | "gated";
	output: unknown;
	gateResults: Map<string, GateResult>;
	latencyMs: number;
	retries: number;
	error?: string;
}

/** Workflow execution result */
export interface ADWExecutionResult {
	workflowId: string;
	executionId: string;
	status: "completed" | "failed" | "aborted" | "rolledBack";
	stepResults: Map<string, ADWStepResult>;
	totalLatencyMs: number;
	completedSteps: number;
	failedSteps: number;
	skippedSteps: number;
	finalOutput: unknown;
	error?: string;
}

/** ADW event types */
export type ADWEvent =
	| "workflow:started"
	| "workflow:completed"
	| "workflow:failed"
	| "step:started"
	| "step:completed"
	| "step:failed"
	| "step:retrying"
	| "gate:checking"
	| "gate:passed"
	| "gate:failed"
	| "rollback:started"
	| "rollback:completed";

// =============================================================================
// Pre-built Quality Gates
// =============================================================================

/** Code compiles/type-checks */
export const CODE_COMPILES_GATE: QualityGate = {
	name: "code_compiles",
	description: "Verify code compiles without errors",
	required: true,
	retryOnFail: true,
	maxRetries: 2,
	validator: async (_input, output) => {
		const code = String(output);
		const issues: string[] = [];

		// Basic syntax checks
		if (code.includes("undefined is not")) issues.push("Undefined reference detected");
		if (code.includes("Cannot find module")) issues.push("Missing module import");
		if (code.includes("SyntaxError")) issues.push("Syntax error in output");

		return {
			passed: issues.length === 0,
			score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20),
			issues,
			suggestions: issues.length > 0 ? ["Review and fix the syntax errors"] : [],
		};
	},
};

/** Tests pass */
export const TESTS_PASS_GATE: QualityGate = {
	name: "tests_pass",
	description: "Verify all tests pass",
	required: true,
	retryOnFail: true,
	maxRetries: 3,
	validator: async (_input, output) => {
		const result = String(output);
		const issues: string[] = [];

		if (result.includes("FAIL") || result.includes("failed")) {
			issues.push("Test failures detected");
		}
		if (result.includes("Error:") && !result.includes("0 errors")) {
			issues.push("Test errors detected");
		}

		return {
			passed: issues.length === 0,
			score: issues.length === 0 ? 100 : 50,
			issues,
			suggestions: issues.length > 0 ? ["Fix failing tests before proceeding"] : [],
		};
	},
};

/** Code review passes */
export const CODE_REVIEW_GATE: QualityGate = {
	name: "code_review",
	description: "Automated code review checks",
	required: false,
	retryOnFail: false,
	maxRetries: 0,
	validator: async (_input, output) => {
		const code = String(output);
		const issues: string[] = [];
		const suggestions: string[] = [];

		// Check for common issues
		if (code.includes("console.log")) {
			issues.push("Debug console.log statements found");
			suggestions.push("Remove or replace with proper logging");
		}
		if (code.includes("TODO") || code.includes("FIXME")) {
			issues.push("TODO/FIXME comments found");
			suggestions.push("Address or document remaining TODOs");
		}
		if (code.includes("any")) {
			issues.push("TypeScript 'any' type used");
			suggestions.push("Consider using more specific types");
		}
		if (code.length > 500 && !code.includes("/**")) {
			issues.push("Missing JSDoc comments for large code block");
			suggestions.push("Add documentation for complex functions");
		}

		const score = Math.max(0, 100 - issues.length * 15);
		return {
			passed: score >= 70,
			score,
			issues,
			suggestions,
		};
	},
};

/** Security check */
export const SECURITY_GATE: QualityGate = {
	name: "security_check",
	description: "Check for security vulnerabilities",
	required: true,
	retryOnFail: true,
	maxRetries: 1,
	validator: async (_input, output) => {
		const code = String(output);
		const issues: string[] = [];

		// Check for common security issues
		if (code.includes("eval(")) issues.push("Dangerous eval() usage");
		if (code.includes("innerHTML")) issues.push("Potential XSS via innerHTML");
		if (/password\s*=\s*['"]/.test(code)) issues.push("Hardcoded password detected");
		if (/api[_-]?key\s*=\s*['"]/.test(code)) issues.push("Hardcoded API key detected");
		if (code.includes("exec(") && code.includes("shell")) issues.push("Shell injection risk");
		if (code.includes("dangerouslySetInnerHTML")) issues.push("React XSS risk");

		return {
			passed: issues.length === 0,
			score: issues.length === 0 ? 100 : 0,
			issues,
			suggestions: issues.map((i) => `Fix: ${i}`),
		};
	},
};

/** Output format validation */
export const FORMAT_VALID_GATE: QualityGate = {
	name: "format_valid",
	description: "Verify output is in expected format",
	required: true,
	retryOnFail: true,
	maxRetries: 2,
	validator: async (_input, output) => {
		const issues: string[] = [];

		if (output === undefined || output === null) {
			issues.push("Output is null or undefined");
		}
		if (typeof output === "string" && output.trim().length === 0) {
			issues.push("Output is empty");
		}

		return {
			passed: issues.length === 0,
			score: issues.length === 0 ? 100 : 0,
			issues,
			suggestions: [],
		};
	},
};

// =============================================================================
// Pre-built Workflow Templates
// =============================================================================

/** Feature implementation workflow */
export function createFeatureWorkflow(featureName: string, requirements: string): ADWWorkflow {
	return {
		id: `feature-${Date.now()}`,
		name: `Implement: ${featureName}`,
		description: requirements,
		onError: "retry",
		maxGlobalRetries: 2,
		globalGates: [SECURITY_GATE],
		steps: [
			{
				id: "analyze",
				name: "Analyze Requirements",
				description: "Break down requirements into technical tasks",
				agentRole: "architect",
				prompt: (_ctx) =>
					`Analyze and break down this feature into implementation tasks:\n\nFeature: ${featureName}\nRequirements: ${requirements}\n\nProvide a structured task list with dependencies.`,
				qualityGates: [FORMAT_VALID_GATE],
				timeout: 30000,
				optional: false,
				dependsOn: [],
			},
			{
				id: "implement",
				name: "Implement Feature",
				description: "Write the code implementation",
				agentRole: "builder",
				prompt: (ctx) => {
					const analysis = ctx.stepOutputs.get("analyze");
					return `Implement this feature based on the analysis:\n\nAnalysis:\n${analysis}\n\nWrite clean, production-ready code.`;
				},
				qualityGates: [CODE_COMPILES_GATE, CODE_REVIEW_GATE],
				timeout: 60000,
				optional: false,
				dependsOn: ["analyze"],
			},
			{
				id: "test",
				name: "Write Tests",
				description: "Create test coverage",
				agentRole: "tester",
				prompt: (ctx) => {
					const impl = ctx.stepOutputs.get("implement");
					return `Write comprehensive tests for this implementation:\n\n${impl}\n\nInclude unit tests, edge cases, and integration tests.`;
				},
				qualityGates: [CODE_COMPILES_GATE, TESTS_PASS_GATE],
				timeout: 45000,
				optional: false,
				dependsOn: ["implement"],
			},
			{
				id: "review",
				name: "Code Review",
				description: "Review implementation quality",
				agentRole: "reviewer",
				prompt: (ctx) => {
					const impl = ctx.stepOutputs.get("implement");
					const tests = ctx.stepOutputs.get("test");
					return `Review this implementation and tests for quality, security, and best practices:\n\nImplementation:\n${impl}\n\nTests:\n${tests}`;
				},
				qualityGates: [FORMAT_VALID_GATE],
				timeout: 30000,
				optional: true,
				dependsOn: ["implement", "test"],
			},
		],
	};
}

/** Bug fix workflow */
export function createBugFixWorkflow(bugDescription: string, affectedCode: string): ADWWorkflow {
	return {
		id: `bugfix-${Date.now()}`,
		name: `Fix: ${bugDescription.slice(0, 50)}`,
		description: bugDescription,
		onError: "retry",
		maxGlobalRetries: 3,
		globalGates: [SECURITY_GATE],
		steps: [
			{
				id: "diagnose",
				name: "Diagnose Issue",
				description: "Identify root cause",
				agentRole: "expert",
				prompt: `Diagnose this bug:\n\nDescription: ${bugDescription}\n\nAffected Code:\n${affectedCode}\n\nIdentify the root cause and explain the issue.`,
				qualityGates: [FORMAT_VALID_GATE],
				timeout: 30000,
				optional: false,
				dependsOn: [],
			},
			{
				id: "fix",
				name: "Implement Fix",
				description: "Write the bug fix",
				agentRole: "builder",
				prompt: (ctx) => {
					const diagnosis = ctx.stepOutputs.get("diagnose");
					return `Fix this bug based on the diagnosis:\n\nDiagnosis:\n${diagnosis}\n\nOriginal Code:\n${affectedCode}\n\nProvide the corrected code.`;
				},
				qualityGates: [CODE_COMPILES_GATE, SECURITY_GATE],
				timeout: 45000,
				optional: false,
				dependsOn: ["diagnose"],
			},
			{
				id: "verify",
				name: "Verify Fix",
				description: "Test the fix works",
				agentRole: "tester",
				prompt: (ctx) => {
					const fix = ctx.stepOutputs.get("fix");
					return `Write a test that verifies this bug is fixed:\n\nBug: ${bugDescription}\n\nFix:\n${fix}\n\nWrite a regression test.`;
				},
				qualityGates: [TESTS_PASS_GATE],
				timeout: 30000,
				optional: false,
				dependsOn: ["fix"],
			},
		],
	};
}

/** Refactoring workflow */
export function createRefactorWorkflow(targetCode: string, goals: string): ADWWorkflow {
	return {
		id: `refactor-${Date.now()}`,
		name: `Refactor: ${goals.slice(0, 50)}`,
		description: goals,
		onError: "rollback",
		maxGlobalRetries: 2,
		globalGates: [SECURITY_GATE, CODE_REVIEW_GATE],
		steps: [
			{
				id: "plan",
				name: "Plan Refactoring",
				description: "Design refactoring approach",
				agentRole: "architect",
				prompt: `Plan a refactoring for this code:\n\nCode:\n${targetCode}\n\nGoals: ${goals}\n\nOutline the refactoring steps and expected improvements.`,
				qualityGates: [FORMAT_VALID_GATE],
				timeout: 30000,
				optional: false,
				dependsOn: [],
			},
			{
				id: "refactor",
				name: "Execute Refactoring",
				description: "Apply refactoring changes",
				agentRole: "builder",
				prompt: (ctx) => {
					const plan = ctx.stepOutputs.get("plan");
					return `Execute this refactoring plan:\n\nPlan:\n${plan}\n\nOriginal Code:\n${targetCode}\n\nProvide the refactored code.`;
				},
				qualityGates: [CODE_COMPILES_GATE, CODE_REVIEW_GATE],
				timeout: 60000,
				optional: false,
				dependsOn: ["plan"],
			},
			{
				id: "validate",
				name: "Validate Behavior",
				description: "Ensure behavior unchanged",
				agentRole: "tester",
				prompt: (ctx) => {
					const refactored = ctx.stepOutputs.get("refactor");
					return `Write tests to verify the refactored code has the same behavior:\n\nOriginal:\n${targetCode}\n\nRefactored:\n${refactored}\n\nWrite comparison tests.`;
				},
				qualityGates: [TESTS_PASS_GATE],
				timeout: 45000,
				optional: false,
				dependsOn: ["refactor"],
			},
		],
	};
}

// =============================================================================
// ADW Runner Class
// =============================================================================

export class ADWRunner extends EventEmitter {
	private orchestratorDbPath: string;
	private executions = new Map<string, ADWContext>();

	constructor(orchestratorDbPath: string = "orchestrator.db") {
		super();
		this.orchestratorDbPath = orchestratorDbPath;
	}

	/** Execute a workflow */
	async execute(workflow: ADWWorkflow, initialVariables: Record<string, unknown> = {}): Promise<ADWExecutionResult> {
		const executionId = randomUUID();
		const startTime = Date.now();

		const context: ADWContext = {
			workflowId: workflow.id,
			executionId,
			startedAt: new Date(),
			currentStep: "",
			stepOutputs: new Map(),
			metadata: {},
			variables: initialVariables,
		};

		this.executions.set(executionId, context);

		const stepResults = new Map<string, ADWStepResult>();
		let completedSteps = 0;
		let failedSteps = 0;
		let skippedSteps = 0;
		let globalRetries = 0;

		this.emit("workflow:started", { workflowId: workflow.id, executionId });

		try {
			// Build execution order based on dependencies
			const executionOrder = this.buildExecutionOrder(workflow.steps);

			for (const step of executionOrder) {
				context.currentStep = step.id;

				// Check if dependencies are met
				const depsOk = step.dependsOn.every((depId) => {
					const depResult = stepResults.get(depId);
					return depResult && depResult.status === "success";
				});

				if (!depsOk && !step.optional) {
					// Dependencies failed - skip this step
					stepResults.set(step.id, {
						stepId: step.id,
						status: "skipped",
						output: null,
						gateResults: new Map(),
						latencyMs: 0,
						retries: 0,
						error: "Dependencies not met",
					});
					skippedSteps++;
					continue;
				}

				// Execute the step
				const stepResult = await this.executeStep(step, context, workflow.onError);
				stepResults.set(step.id, stepResult);

				if (stepResult.status === "success") {
					context.stepOutputs.set(step.id, stepResult.output);
					completedSteps++;
				} else if (stepResult.status === "failed") {
					failedSteps++;

					// Handle global retry
					if (workflow.onError === "retry" && globalRetries < workflow.maxGlobalRetries) {
						globalRetries++;
						this.emit("workflow:retrying", { executionId, attempt: globalRetries });
						// Reset and retry from failed step
						continue;
					}

					// Handle abort
					if (workflow.onError === "abort" && !step.optional) {
						this.emit("workflow:failed", { executionId, error: stepResult.error });
						return {
							workflowId: workflow.id,
							executionId,
							status: "aborted",
							stepResults,
							totalLatencyMs: Date.now() - startTime,
							completedSteps,
							failedSteps,
							skippedSteps,
							finalOutput: null,
							error: stepResult.error,
						};
					}

					// Handle rollback
					if (workflow.onError === "rollback") {
						this.emit("rollback:started", { executionId });
						// In a real implementation, this would undo changes
						this.emit("rollback:completed", { executionId });
						return {
							workflowId: workflow.id,
							executionId,
							status: "rolledBack",
							stepResults,
							totalLatencyMs: Date.now() - startTime,
							completedSteps,
							failedSteps,
							skippedSteps,
							finalOutput: null,
							error: stepResult.error,
						};
					}
				} else if (stepResult.status === "skipped") {
					skippedSteps++;
				}
			}

			// Run global quality gates on final output
			const lastStep = executionOrder[executionOrder.length - 1];
			const finalOutput = context.stepOutputs.get(lastStep.id);

			for (const gate of workflow.globalGates) {
				this.emit("gate:checking", { executionId, gate: gate.name, scope: "global" });
				const gateResult = await gate.validator(null, finalOutput);

				if (!gateResult.passed && gate.required) {
					this.emit("gate:failed", { executionId, gate: gate.name, result: gateResult });
					return {
						workflowId: workflow.id,
						executionId,
						status: "failed",
						stepResults,
						totalLatencyMs: Date.now() - startTime,
						completedSteps,
						failedSteps,
						skippedSteps,
						finalOutput,
						error: `Global gate failed: ${gate.name}`,
					};
				}
				this.emit("gate:passed", { executionId, gate: gate.name });
			}

			this.emit("workflow:completed", { executionId, finalOutput });

			return {
				workflowId: workflow.id,
				executionId,
				status: "completed",
				stepResults,
				totalLatencyMs: Date.now() - startTime,
				completedSteps,
				failedSteps,
				skippedSteps,
				finalOutput,
			};
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			this.emit("workflow:failed", { executionId, error: errMsg });

			return {
				workflowId: workflow.id,
				executionId,
				status: "failed",
				stepResults,
				totalLatencyMs: Date.now() - startTime,
				completedSteps,
				failedSteps,
				skippedSteps,
				finalOutput: null,
				error: errMsg,
			};
		} finally {
			this.executions.delete(executionId);
		}
	}

	/** Execute a single step */
	private async executeStep(
		step: ADWStep,
		context: ADWContext,
		_onError: ADWWorkflow["onError"],
	): Promise<ADWStepResult> {
		const startTime = Date.now();
		let retries = 0;
		const gateResults = new Map<string, GateResult>();

		this.emit("step:started", { executionId: context.executionId, stepId: step.id });

		// Build the prompt
		const prompt = typeof step.prompt === "function" ? step.prompt(context) : step.prompt;

		// Transform input if needed
		const inputContext = step.inputTransform ? step.inputTransform(context) : context.variables;

		while (retries <= Math.max(...step.qualityGates.map((g) => g.maxRetries), 0)) {
			try {
				// Delegate to orchestrator
				const orch = getOrchestrator(this.orchestratorDbPath);
				const result: DelegationResult = await orch.delegate({
					id: randomUUID(),
					taskType: step.name,
					prompt,
					context: inputContext,
					requiredRole: step.agentRole,
					timeout: step.timeout,
					priority: 5,
				});

				if (result.status !== "success") {
					throw new Error(result.error || "Delegation failed");
				}

				let output = result.output;

				// Transform output if needed
				if (step.outputTransform) {
					output = step.outputTransform(output);
				}

				// Run quality gates
				let allGatesPassed = true;
				for (const gate of step.qualityGates) {
					this.emit("gate:checking", {
						executionId: context.executionId,
						stepId: step.id,
						gate: gate.name,
					});

					const gateResult = await gate.validator(inputContext, output);
					gateResults.set(gate.name, gateResult);

					if (!gateResult.passed) {
						this.emit("gate:failed", {
							executionId: context.executionId,
							stepId: step.id,
							gate: gate.name,
							result: gateResult,
						});

						if (gate.required) {
							allGatesPassed = false;
							if (gate.retryOnFail && retries < gate.maxRetries) {
								retries++;
								this.emit("step:retrying", {
									executionId: context.executionId,
									stepId: step.id,
									attempt: retries,
									reason: `Gate ${gate.name} failed`,
								});
							}
						}
					} else {
						this.emit("gate:passed", {
							executionId: context.executionId,
							stepId: step.id,
							gate: gate.name,
						});
					}
				}

				if (allGatesPassed) {
					this.emit("step:completed", {
						executionId: context.executionId,
						stepId: step.id,
						output,
					});

					return {
						stepId: step.id,
						status: "success",
						output,
						gateResults,
						latencyMs: Date.now() - startTime,
						retries,
					};
				}

				// Gates failed and no more retries
				return {
					stepId: step.id,
					status: "gated",
					output,
					gateResults,
					latencyMs: Date.now() - startTime,
					retries,
					error: "Quality gates failed",
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);

				if (retries < 2) {
					retries++;
					this.emit("step:retrying", {
						executionId: context.executionId,
						stepId: step.id,
						attempt: retries,
						reason: errMsg,
					});
					continue;
				}

				this.emit("step:failed", {
					executionId: context.executionId,
					stepId: step.id,
					error: errMsg,
				});

				return {
					stepId: step.id,
					status: "failed",
					output: null,
					gateResults,
					latencyMs: Date.now() - startTime,
					retries,
					error: errMsg,
				};
			}
		}

		// Should not reach here, but handle gracefully
		return {
			stepId: step.id,
			status: "failed",
			output: null,
			gateResults,
			latencyMs: Date.now() - startTime,
			retries,
			error: "Max retries exceeded",
		};
	}

	/** Build execution order based on dependencies (topological sort) */
	private buildExecutionOrder(steps: ADWStep[]): ADWStep[] {
		const result: ADWStep[] = [];
		const visited = new Set<string>();
		const visiting = new Set<string>();

		const visit = (stepId: string) => {
			if (visited.has(stepId)) return;
			if (visiting.has(stepId)) {
				throw new Error(`Circular dependency detected at step: ${stepId}`);
			}

			visiting.add(stepId);

			const step = steps.find((s) => s.id === stepId);
			if (!step) return;

			for (const depId of step.dependsOn) {
				visit(depId);
			}

			visiting.delete(stepId);
			visited.add(stepId);
			result.push(step);
		};

		for (const step of steps) {
			visit(step.id);
		}

		return result;
	}

	/** Get execution context for an active workflow */
	getContext(executionId: string): ADWContext | undefined {
		return this.executions.get(executionId);
	}

	/** List active executions */
	listActiveExecutions(): string[] {
		return Array.from(this.executions.keys());
	}
}

// =============================================================================
// Singleton Instance
// =============================================================================

let adwRunnerInstance: ADWRunner | null = null;

export function getADWRunner(orchestratorDbPath?: string): ADWRunner {
	if (!adwRunnerInstance) {
		adwRunnerInstance = new ADWRunner(orchestratorDbPath);
	}
	return adwRunnerInstance;
}

export function disposeADWRunner(): void {
	if (adwRunnerInstance) {
		adwRunnerInstance.removeAllListeners();
		adwRunnerInstance = null;
	}
}
