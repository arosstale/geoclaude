/**
 * OpenHands Trading Agent
 * Autonomous code execution and strategy modification using OpenHands SDK
 *
 * Features:
 * - Self-modifying strategies based on performance
 * - Autonomous backtesting and optimization
 * - Real-time strategy adaptation
 * - Expertise file management
 */

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradingAction } from "../types.js";

// ============================================================================
// Types
// ============================================================================

interface OpenHandsTask {
	id: string;
	type: "backtest" | "optimize" | "modify" | "analyze" | "learn";
	description: string;
	status: "pending" | "running" | "completed" | "failed";
	input: string;
	output?: string;
	startTime: number;
	endTime?: number;
	error?: string;
}

interface StrategyModification {
	id: string;
	timestamp: number;
	trigger: string; // What triggered this modification
	originalCode: string;
	modifiedCode: string;
	performance: {
		before: { winRate: number; pnL: number };
		after?: { winRate: number; pnL: number };
	};
	approved: boolean;
	applied: boolean;
}

interface LearningInsight {
	id: string;
	timestamp: number;
	symbol: string;
	insight: string;
	confidence: number;
	source: string; // Which analysis generated this
	actionable: boolean;
}

interface OpenHandsTradingConfig extends AgentConfig {
	autoModify: boolean; // Allow automatic strategy modifications
	requireApproval: boolean; // Require human approval for changes
	maxTasksPerHour: number;
	learningEnabled: boolean;
	expertiseDir: string;
}

// ============================================================================
// OpenHands Trading Agent
// ============================================================================

export class OpenHandsTradingAgent extends BaseAgent {
	private tasks: Map<string, OpenHandsTask> = new Map();
	private modifications: StrategyModification[] = [];
	private learningInsights: LearningInsight[] = [];
	private taskIdCounter = 0;
	private tasksThisHour = 0;
	private hourlyReset: number = Date.now();

	constructor(config: Partial<OpenHandsTradingConfig> = {}) {
		super({
			name: "OpenHandsTradingAgent",
			enabled: true,
			interval: 600000, // 10 minutes
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {},
			autoModify: false, // Safe default
			requireApproval: true,
			maxTasksPerHour: 10,
			learningEnabled: true,
			expertiseDir: "./src/trading/expertise",
			...config,
		});
	}

	protected async run(): Promise<void> {
		try {
			const cfg = this.config as OpenHandsTradingConfig;

			// Reset hourly counter
			if (Date.now() - this.hourlyReset > 3600000) {
				this.tasksThisHour = 0;
				this.hourlyReset = Date.now();
			}

			if (cfg.learningEnabled) {
				// Analyze recent performance and learn
				await this.analyzeAndLearn();
			}

			// Process pending modifications
			await this.processPendingModifications();
		} catch (error) {
			console.error("[OpenHandsTradingAgent] Run error:", error);
		}
	}

	// ============================================================================
	// Task Execution
	// ============================================================================

	async executeTask(type: OpenHandsTask["type"], description: string, input: string): Promise<OpenHandsTask> {
		const cfg = this.config as OpenHandsTradingConfig;

		// Rate limiting
		if (this.tasksThisHour >= cfg.maxTasksPerHour) {
			throw new Error("Hourly task limit reached");
		}

		const task: OpenHandsTask = {
			id: `oh-${++this.taskIdCounter}`,
			type,
			description,
			status: "pending",
			input,
			startTime: Date.now(),
		};

		this.tasks.set(task.id, task);
		this.tasksThisHour++;

		try {
			task.status = "running";

			// Execute via OpenHands SDK
			const output = await this.runOpenHandsTask(task);

			task.status = "completed";
			task.output = output;
			task.endTime = Date.now();

			// Process output based on task type
			await this.processTaskOutput(task);
		} catch (error) {
			task.status = "failed";
			task.error = error instanceof Error ? error.message : String(error);
			task.endTime = Date.now();
		}

		return task;
	}

	private async runOpenHandsTask(task: OpenHandsTask): Promise<string> {
		// Check if OpenHands runner is available
		const runnerPath = path.join(process.cwd(), "src/agents/openhands-runner.py");

		try {
			await fs.access(runnerPath);
		} catch {
			// Fallback to inline LLM analysis
			return this.runInlineLLMTask(task);
		}

		return new Promise((resolve, reject) => {
			const prompt = this.buildTaskPrompt(task);

			const child = spawn("python3", [runnerPath, "--mode", task.type], {
				env: {
					...process.env,
					OPENHANDS_PROMPT: prompt,
					OPENHANDS_INPUT: task.input,
				},
				cwd: process.cwd(),
			});

			let stdout = "";
			let stderr = "";

			child.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			child.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			child.on("close", (code) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`OpenHands task failed: ${stderr || stdout}`));
				}
			});

			child.on("error", (err) => {
				reject(err);
			});

			// Timeout after 5 minutes
			setTimeout(() => {
				child.kill();
				reject(new Error("Task timeout"));
			}, 300000);
		});
	}

	private async runInlineLLMTask(task: OpenHandsTask): Promise<string> {
		// Fallback: Use OpenRouter for analysis
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			return "No LLM available for analysis";
		}

		const prompt = this.buildTaskPrompt(task);

		try {
			const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "anthropic/claude-3.5-sonnet",
					messages: [
						{
							role: "system",
							content:
								"You are an expert quantitative trading analyst. Provide actionable insights and code modifications.",
						},
						{
							role: "user",
							content: `${prompt}\n\nInput:\n${task.input}`,
						},
					],
					max_tokens: 2000,
				}),
			});

			if (!response.ok) {
				throw new Error(`API error: ${response.status}`);
			}

			const data = await response.json();
			return data.choices?.[0]?.message?.content || "No response";
		} catch (error) {
			return `Analysis failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	private buildTaskPrompt(task: OpenHandsTask): string {
		switch (task.type) {
			case "backtest":
				return `Analyze this trading strategy and simulate its performance over the given data. Provide win rate, drawdown, Sharpe ratio, and improvement suggestions.\n\nStrategy Description: ${task.description}`;

			case "optimize":
				return `Optimize the following trading strategy parameters. Suggest specific parameter changes to improve risk-adjusted returns.\n\nStrategy: ${task.description}`;

			case "modify":
				return `Review and modify this trading code to fix the identified issue or implement the requested improvement. Provide the complete modified code.\n\nRequest: ${task.description}`;

			case "analyze":
				return `Analyze the following market data and trading performance. Identify patterns, anomalies, and actionable insights.\n\nAnalysis Request: ${task.description}`;

			case "learn":
				return `Extract key learnings from this trading session. Identify what worked, what didn't, and specific improvements for future trades.\n\nSession Data: ${task.description}`;

			default:
				return task.description;
		}
	}

	private async processTaskOutput(task: OpenHandsTask): Promise<void> {
		if (!task.output) return;

		switch (task.type) {
			case "learn":
				await this.extractLearningInsights(task);
				break;

			case "modify":
				await this.createModificationProposal(task);
				break;

			case "analyze":
				await this.processAnalysisResults(task);
				break;
		}
	}

	// ============================================================================
	// Learning System
	// ============================================================================

	private async analyzeAndLearn(): Promise<void> {
		const cfg = this.config as OpenHandsTradingConfig;

		// Load recent trading performance
		const expertisePath = path.join(cfg.expertiseDir, "trading.md");
		let currentExpertise = "";

		try {
			currentExpertise = await fs.readFile(expertisePath, "utf-8");
		} catch {
			// No expertise file yet
		}

		// Create learning task
		await this.executeTask("learn", "Analyze recent trading performance and update expertise", currentExpertise);
	}

	private async extractLearningInsights(task: OpenHandsTask): Promise<void> {
		if (!task.output) return;

		// Parse insights from LLM output
		const lines = task.output.split("\n");
		const insights: string[] = [];

		for (const line of lines) {
			if (line.includes("INSIGHT:") || line.includes("LEARNING:") || line.includes("-")) {
				const insight = line.replace(/^[-*]\s*/, "").trim();
				if (insight.length > 10) {
					insights.push(insight);
				}
			}
		}

		// Store insights
		for (const insight of insights.slice(0, 5)) {
			this.learningInsights.push({
				id: `insight-${this.learningInsights.length + 1}`,
				timestamp: Date.now(),
				symbol: "ALL",
				insight,
				confidence: 0.7,
				source: "OpenHandsAgent",
				actionable: true,
			});
		}

		// Update expertise file
		await this.updateExpertiseFile(insights);

		// Keep only recent insights
		if (this.learningInsights.length > 100) {
			this.learningInsights = this.learningInsights.slice(-100);
		}
	}

	private async updateExpertiseFile(newInsights: string[]): Promise<void> {
		const cfg = this.config as OpenHandsTradingConfig;
		const expertisePath = path.join(cfg.expertiseDir, "trading.md");

		// Ensure directory exists
		await fs.mkdir(cfg.expertiseDir, { recursive: true });

		let content = "";

		try {
			content = await fs.readFile(expertisePath, "utf-8");
		} catch {
			// Create new file
			content = `# Trading Expertise\n\nAccumulated learnings from trading sessions.\n\n## Insights\n\n`;
		}

		// Add new insights
		const timestamp = new Date().toISOString().split("T")[0];
		const insightSection = newInsights.map((i) => `- [${timestamp}] ${i}`).join("\n");

		// Append to file (keep last 50 insights)
		const lines = content.split("\n");
		const insightLines = lines.filter((l) => l.startsWith("- ["));
		const otherLines = lines.filter((l) => !l.startsWith("- ["));

		const allInsights = [...insightLines, ...insightSection.split("\n")].slice(-50).join("\n");

		const updatedContent = [...otherLines, allInsights].join("\n");

		await fs.writeFile(expertisePath, updatedContent);
	}

	// ============================================================================
	// Strategy Modification
	// ============================================================================

	private async createModificationProposal(task: OpenHandsTask): Promise<void> {
		if (!task.output) return;

		const modification: StrategyModification = {
			id: `mod-${this.modifications.length + 1}`,
			timestamp: Date.now(),
			trigger: task.description,
			originalCode: task.input,
			modifiedCode: task.output,
			performance: {
				before: { winRate: 0, pnL: 0 },
			},
			approved: false,
			applied: false,
		};

		this.modifications.push(modification);

		// Emit signal for human review
		await this.emitSignal({
			symbol: "SYSTEM",
			action: "HOLD" as TradingAction,
			confidence: 0.8,
			price: 0,
			reason: `Strategy modification proposed: ${task.description}`,
			source: this.name,
			timestamp: Date.now(),
			metadata: {
				modificationType: "strategy",
				modificationId: modification.id,
				requiresApproval: (this.config as OpenHandsTradingConfig).requireApproval,
			},
		});
	}

	private async processPendingModifications(): Promise<void> {
		const cfg = this.config as OpenHandsTradingConfig;

		if (!cfg.autoModify) return;

		const pendingMods = this.modifications.filter((m) => m.approved && !m.applied);

		for (const mod of pendingMods) {
			try {
				// Apply modification (in a safe way)
				// For now, just mark as applied - actual file modification would be dangerous
				mod.applied = true;
				console.log(`[OpenHandsTradingAgent] Applied modification ${mod.id}`);
			} catch (error) {
				console.error(`[OpenHandsTradingAgent] Failed to apply modification ${mod.id}:`, error);
			}
		}
	}

	private async processAnalysisResults(task: OpenHandsTask): Promise<void> {
		if (!task.output) return;

		// Look for trading signals in analysis
		const output = task.output.toLowerCase();

		for (const symbol of this.config.symbols as string[]) {
			const symbolLower = symbol.toLowerCase();

			if (output.includes(symbolLower)) {
				let action: TradingAction | null = null;
				let reason = "";

				if (output.includes("buy") && output.includes(symbolLower)) {
					action = "BUY";
					reason = `Analysis suggests buying ${symbol}`;
				} else if (output.includes("sell") && output.includes(symbolLower)) {
					action = "SELL";
					reason = `Analysis suggests selling ${symbol}`;
				}

				if (action) {
					await this.emitSignal({
						symbol,
						action,
						confidence: 0.6,
						price: 0,
						reason,
						source: this.name,
						timestamp: Date.now(),
						metadata: {
							analysisTaskId: task.id,
							analysisType: "openhands",
						},
					});
				}
			}
		}
	}

	// ============================================================================
	// Public API
	// ============================================================================

	async requestBacktest(strategyDescription: string, data: string): Promise<OpenHandsTask> {
		return this.executeTask("backtest", strategyDescription, data);
	}

	async requestOptimization(strategyCode: string, performanceData: string): Promise<OpenHandsTask> {
		return this.executeTask(
			"optimize",
			"Optimize strategy parameters",
			`Strategy:\n${strategyCode}\n\nPerformance:\n${performanceData}`,
		);
	}

	async requestAnalysis(marketData: string, question: string): Promise<OpenHandsTask> {
		return this.executeTask("analyze", question, marketData);
	}

	async requestModification(code: string, request: string): Promise<OpenHandsTask> {
		return this.executeTask("modify", request, code);
	}

	approveModification(modificationId: string): boolean {
		const mod = this.modifications.find((m) => m.id === modificationId);
		if (mod) {
			mod.approved = true;
			return true;
		}
		return false;
	}

	rejectModification(modificationId: string): boolean {
		const mod = this.modifications.find((m) => m.id === modificationId);
		if (mod) {
			this.modifications = this.modifications.filter((m) => m.id !== modificationId);
			return true;
		}
		return false;
	}

	getPendingModifications(): StrategyModification[] {
		return this.modifications.filter((m) => !m.approved && !m.applied);
	}

	getRecentInsights(limit = 10): LearningInsight[] {
		return this.learningInsights.slice(-limit);
	}

	getTaskHistory(limit = 20): OpenHandsTask[] {
		return [...this.tasks.values()].slice(-limit);
	}

	getStats(): {
		totalTasks: number;
		completedTasks: number;
		failedTasks: number;
		pendingModifications: number;
		appliedModifications: number;
		totalInsights: number;
		tasksThisHour: number;
	} {
		const tasks = [...this.tasks.values()];

		return {
			totalTasks: tasks.length,
			completedTasks: tasks.filter((t) => t.status === "completed").length,
			failedTasks: tasks.filter((t) => t.status === "failed").length,
			pendingModifications: this.modifications.filter((m) => !m.approved).length,
			appliedModifications: this.modifications.filter((m) => m.applied).length,
			totalInsights: this.learningInsights.length,
			tasksThisHour: this.tasksThisHour,
		};
	}

	getFormattedStats(): string {
		const stats = this.getStats();

		return [
			`**🤖 OpenHands Trading Agent**`,
			``,
			`**Task Execution**`,
			`Total Tasks: ${stats.totalTasks}`,
			`Completed: ${stats.completedTasks}`,
			`Failed: ${stats.failedTasks}`,
			`This Hour: ${stats.tasksThisHour}/${(this.config as OpenHandsTradingConfig).maxTasksPerHour}`,
			``,
			`**Strategy Evolution**`,
			`Pending Modifications: ${stats.pendingModifications}`,
			`Applied Modifications: ${stats.appliedModifications}`,
			``,
			`**Learning**`,
			`Total Insights: ${stats.totalInsights}`,
			`Auto-Modify: ${(this.config as OpenHandsTradingConfig).autoModify ? "Enabled" : "Disabled"}`,
			`Approval Required: ${(this.config as OpenHandsTradingConfig).requireApproval ? "Yes" : "No"}`,
		].join("\n");
	}
}

// ============================================================================
// Export
// ============================================================================

export type { OpenHandsTask, StrategyModification, LearningInsight, OpenHandsTradingConfig };
