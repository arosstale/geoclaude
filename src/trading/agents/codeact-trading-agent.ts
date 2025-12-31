/**
 * CodeAct Trading Agent
 * Implements OpenHands-style action/observation pattern for autonomous trading
 *
 * Based on OpenHands CodeAct Agent architecture:
 * - Action/Observation loop with state management
 * - Multi-agent delegation
 * - Tool-based execution (CmdRunAction, FileReadAction, etc.)
 * - IPython/Jupyter integration for analysis
 *
 * @see https://github.com/All-Hands-AI/OpenHands/tree/main/openhands/agenthub/codeact_agent
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradeSignal } from "../types.js";

// ============================================================================
// Action Types (from OpenHands)
// ============================================================================

export type ActionType =
	| "cmd_run"
	| "ipython_run"
	| "file_read"
	| "file_write"
	| "browse_url"
	| "add_task"
	| "modify_task"
	| "message"
	| "delegate"
	| "finish"
	| "reject"
	// Trading-specific actions
	| "market_order"
	| "limit_order"
	| "cancel_order"
	| "close_position"
	| "analyze_market"
	| "backtest_strategy";

export interface Action {
	id: string;
	type: ActionType;
	timestamp: number;
	payload: Record<string, unknown>;
	thought?: string; // Agent's reasoning
}

export interface CmdRunAction extends Action {
	type: "cmd_run";
	payload: {
		command: string;
		timeout?: number;
		background?: boolean;
	};
}

export interface IPythonRunAction extends Action {
	type: "ipython_run";
	payload: {
		code: string;
		timeout?: number;
	};
}

export interface MarketOrderAction extends Action {
	type: "market_order";
	payload: {
		symbol: string;
		side: "buy" | "sell";
		size: number;
		reduceOnly?: boolean;
	};
}

export interface LimitOrderAction extends Action {
	type: "limit_order";
	payload: {
		symbol: string;
		side: "buy" | "sell";
		size: number;
		price: number;
		postOnly?: boolean;
		reduceOnly?: boolean;
	};
}

export interface AnalyzeMarketAction extends Action {
	type: "analyze_market";
	payload: {
		symbol: string;
		timeframe: string;
		indicators: string[];
	};
}

export interface DelegateAction extends Action {
	type: "delegate";
	payload: {
		agentType: string;
		task: string;
		context: Record<string, unknown>;
	};
}

// ============================================================================
// Observation Types
// ============================================================================

export type ObservationType =
	| "cmd_output"
	| "ipython_output"
	| "file_content"
	| "browser_content"
	| "error"
	| "success"
	// Trading-specific observations
	| "order_fill"
	| "position_update"
	| "market_data"
	| "analysis_result"
	| "delegate_result";

export interface Observation {
	id: string;
	type: ObservationType;
	timestamp: number;
	actionId: string; // Reference to triggering action
	content: unknown;
	success: boolean;
	error?: string;
}

export interface CmdOutputObservation extends Observation {
	type: "cmd_output";
	content: {
		stdout: string;
		stderr: string;
		exitCode: number;
	};
}

export interface OrderFillObservation extends Observation {
	type: "order_fill";
	content: {
		orderId: string;
		symbol: string;
		side: "buy" | "sell";
		size: number;
		price: number;
		fee: number;
		timestamp: number;
	};
}

export interface MarketDataObservation extends Observation {
	type: "market_data";
	content: {
		symbol: string;
		price: number;
		volume24h: number;
		priceChange24h: number;
		fundingRate?: number;
		openInterest?: number;
	};
}

export interface AnalysisResultObservation extends Observation {
	type: "analysis_result";
	content: {
		symbol: string;
		timeframe: string;
		indicators: Record<string, number>;
		signals: TradeSignal[];
		summary: string;
	};
}

// ============================================================================
// Agent State (from OpenHands)
// ============================================================================

export type CodeActStateType =
	| "loading"
	| "running"
	| "paused"
	| "awaiting_confirmation"
	| "finished"
	| "error"
	| "stuck";

export interface CodeActState {
	id: string;
	status: CodeActStateType;
	// Task tracking
	rootTask: string;
	currentSubtask?: string;
	subtasks: SubTask[];
	// Iteration tracking
	globalIteration: number;
	localIteration: number;
	delegateLevel: number;
	maxIterations: number;
	// History
	actions: Action[];
	observations: Observation[];
	// Metrics
	startTime: number;
	lastUpdateTime: number;
	totalTokens: number;
	// Error tracking
	lastError?: string;
	consecutiveErrors: number;
	// Trading-specific
	openPositions: string[];
	pendingOrders: string[];
	pnl: number;
}

export interface SubTask {
	id: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	parentId?: string;
	delegatedTo?: string;
	result?: unknown;
}

// ============================================================================
// CodeAct Trading Agent
// ============================================================================

interface CodeActConfig extends AgentConfig {
	maxIterations: number;
	maxConsecutiveErrors: number;
	confirmationRequired: boolean;
	delegationEnabled: boolean;
	availableDelegates: string[];
	pythonEnabled: boolean;
}

export class CodeActTradingAgent extends BaseAgent {
	private caState: CodeActState;
	private caConfig: CodeActConfig;
	private actionHandlers: Map<ActionType, (action: Action) => Promise<Observation>>;

	constructor(config: Partial<CodeActConfig> = {}) {
		const fullConfig: CodeActConfig = {
			name: "CodeActTradingAgent",
			enabled: true,
			interval: 30000, // 30 seconds
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {},
			maxIterations: 100,
			maxConsecutiveErrors: 3,
			confirmationRequired: true,
			delegationEnabled: true,
			availableDelegates: ["SentimentAgent", "WhaleAgent", "BacktestAgent"],
			pythonEnabled: true,
			...config,
		};
		super(fullConfig);
		this.caConfig = fullConfig;

		// Initialize state
		this.caState = this.createInitialState();

		// Register action handlers
		this.actionHandlers = new Map();
		this.registerActionHandlers();
	}

	/**
	 * Main agent loop - processes pending tasks
	 */
	protected async run(): Promise<void> {
		// Check if we have an active task
		if (this.caState.status === "running" && this.caState.rootTask) {
			await this.processIteration();
		}
	}

	/**
	 * Process one iteration of the agent loop
	 */
	private async processIteration(): Promise<void> {
		// This would typically:
		// 1. Get the next action from the LLM based on current state
		// 2. Execute the action via step()
		// 3. Process the observation
		// For now, we just log that we're running
		console.log(`[CodeAct] Processing iteration ${this.caState.globalIteration} for task: ${this.caState.rootTask}`);
	}

	// ========================================================================
	// State Management
	// ========================================================================

	private createInitialState(): CodeActState {
		return {
			id: `state-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			status: "loading",
			rootTask: "",
			subtasks: [],
			globalIteration: 0,
			localIteration: 0,
			delegateLevel: 0,
			maxIterations: this.caConfig.maxIterations,
			actions: [],
			observations: [],
			startTime: Date.now(),
			lastUpdateTime: Date.now(),
			totalTokens: 0,
			consecutiveErrors: 0,
			openPositions: [],
			pendingOrders: [],
			pnl: 0,
		};
	}

	/**
	 * Save state for persistence
	 */
	saveState(): string {
		return JSON.stringify(this.caState);
	}

	/**
	 * Restore state from persistence
	 */
	restoreState(serialized: string): void {
		this.caState = JSON.parse(serialized);
	}

	/**
	 * Get current state
	 */
	getState(): CodeActState {
		return { ...this.caState };
	}

	// ========================================================================
	// Action Registration
	// ========================================================================

	private registerActionHandlers(): void {
		// Command execution
		this.actionHandlers.set("cmd_run", this.handleCmdRun.bind(this));

		// IPython execution
		this.actionHandlers.set("ipython_run", this.handleIPythonRun.bind(this));

		// Trading actions
		this.actionHandlers.set("market_order", this.handleMarketOrder.bind(this));
		this.actionHandlers.set("limit_order", this.handleLimitOrder.bind(this));
		this.actionHandlers.set("cancel_order", this.handleCancelOrder.bind(this));
		this.actionHandlers.set("close_position", this.handleClosePosition.bind(this));
		this.actionHandlers.set("analyze_market", this.handleAnalyzeMarket.bind(this));

		// Delegation
		this.actionHandlers.set("delegate", this.handleDelegate.bind(this));

		// Task management
		this.actionHandlers.set("add_task", this.handleAddTask.bind(this));
		this.actionHandlers.set("modify_task", this.handleModifyTask.bind(this));

		// Finish/Reject
		this.actionHandlers.set("finish", this.handleFinish.bind(this));
		this.actionHandlers.set("reject", this.handleReject.bind(this));
	}

	// ========================================================================
	// Action Handlers
	// ========================================================================

	private async handleCmdRun(action: Action): Promise<Observation> {
		const payload = action.payload as CmdRunAction["payload"];

		try {
			// In a real implementation, this would execute the command
			// For now, we simulate it
			console.log(`[CodeAct] Executing command: ${payload.command}`);

			return {
				id: `obs-${Date.now()}`,
				type: "cmd_output",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: {
					stdout: `Executed: ${payload.command}`,
					stderr: "",
					exitCode: 0,
				},
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleIPythonRun(action: Action): Promise<Observation> {
		const payload = action.payload as IPythonRunAction["payload"];

		try {
			// Would integrate with Jupyter kernel
			console.log(`[CodeAct] Running Python code: ${payload.code.substring(0, 100)}...`);

			return {
				id: `obs-${Date.now()}`,
				type: "ipython_output",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: {
					output: "Python execution result",
					displayData: null,
				},
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleMarketOrder(action: Action): Promise<Observation> {
		const payload = action.payload as MarketOrderAction["payload"];

		try {
			console.log(`[CodeAct] Market order: ${payload.side} ${payload.size} ${payload.symbol}`);

			// Would integrate with exchange API
			const mockFillPrice = 50000 + Math.random() * 100;

			return {
				id: `obs-${Date.now()}`,
				type: "order_fill",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: {
					orderId: `order-${Date.now()}`,
					symbol: payload.symbol,
					side: payload.side,
					size: payload.size,
					price: mockFillPrice,
					fee: mockFillPrice * payload.size * 0.0006,
					timestamp: Date.now(),
				},
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleLimitOrder(action: Action): Promise<Observation> {
		const payload = action.payload as LimitOrderAction["payload"];

		try {
			console.log(`[CodeAct] Limit order: ${payload.side} ${payload.size} ${payload.symbol} @ ${payload.price}`);

			// Order placed, not yet filled
			return {
				id: `obs-${Date.now()}`,
				type: "success",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: {
					orderId: `order-${Date.now()}`,
					status: "open",
					message: "Limit order placed successfully",
				},
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleCancelOrder(action: Action): Promise<Observation> {
		const payload = action.payload as { orderId: string };

		try {
			console.log(`[CodeAct] Cancelling order: ${payload.orderId}`);

			return {
				id: `obs-${Date.now()}`,
				type: "success",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: {
					orderId: payload.orderId,
					status: "cancelled",
				},
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleClosePosition(action: Action): Promise<Observation> {
		const payload = action.payload as { symbol: string; percentage?: number };

		try {
			console.log(`[CodeAct] Closing position: ${payload.symbol} (${payload.percentage || 100}%)`);

			return {
				id: `obs-${Date.now()}`,
				type: "position_update",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: {
					symbol: payload.symbol,
					action: "closed",
					closedSize: 1.0,
					pnl: Math.random() * 200 - 100,
				},
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleAnalyzeMarket(action: Action): Promise<Observation> {
		const payload = action.payload as AnalyzeMarketAction["payload"];

		try {
			console.log(`[CodeAct] Analyzing ${payload.symbol} on ${payload.timeframe}`);

			// Would perform actual technical analysis
			const mockAnalysis: AnalysisResultObservation["content"] = {
				symbol: payload.symbol,
				timeframe: payload.timeframe,
				indicators: {
					rsi: 45 + Math.random() * 30,
					macd: Math.random() * 2 - 1,
					ema20: 50000,
					ema50: 49500,
				},
				signals: [],
				summary: `${payload.symbol} showing neutral momentum on ${payload.timeframe}`,
			};

			// Generate signals based on analysis
			if (mockAnalysis.indicators.rsi < 30) {
				mockAnalysis.signals.push({
					symbol: payload.symbol,
					action: "BUY",
					confidence: 0.7,
					price: 50000,
					timestamp: Date.now(),
					source: "CodeActTradingAgent",
					reason: "RSI oversold",
				});
			} else if (mockAnalysis.indicators.rsi > 70) {
				mockAnalysis.signals.push({
					symbol: payload.symbol,
					action: "SELL",
					confidence: 0.7,
					price: 50000,
					timestamp: Date.now(),
					source: "CodeActTradingAgent",
					reason: "RSI overbought",
				});
			}

			return {
				id: `obs-${Date.now()}`,
				type: "analysis_result",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: mockAnalysis,
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleDelegate(action: Action): Promise<Observation> {
		const payload = action.payload as DelegateAction["payload"];

		if (!this.caConfig.delegationEnabled) {
			return {
				id: `obs-${Date.now()}`,
				type: "error",
				timestamp: Date.now(),
				actionId: action.id,
				success: false,
				content: null,
				error: "Delegation is disabled",
			};
		}

		if (!this.caConfig.availableDelegates.includes(payload.agentType)) {
			return {
				id: `obs-${Date.now()}`,
				type: "error",
				timestamp: Date.now(),
				actionId: action.id,
				success: false,
				content: null,
				error: `Unknown delegate: ${payload.agentType}`,
			};
		}

		try {
			console.log(`[CodeAct] Delegating to ${payload.agentType}: ${payload.task}`);

			// Would actually spawn/invoke the delegate agent
			return {
				id: `obs-${Date.now()}`,
				type: "delegate_result",
				timestamp: Date.now(),
				actionId: action.id,
				success: true,
				content: {
					agentType: payload.agentType,
					task: payload.task,
					result: "Delegation completed successfully",
				},
			};
		} catch (error) {
			return this.createErrorObservation(action.id, error);
		}
	}

	private async handleAddTask(action: Action): Promise<Observation> {
		const payload = action.payload as { description: string; parentId?: string };

		const subtask: SubTask = {
			id: `subtask-${Date.now()}`,
			description: payload.description,
			status: "pending",
			parentId: payload.parentId,
		};

		this.caState.subtasks.push(subtask);

		return {
			id: `obs-${Date.now()}`,
			type: "success",
			timestamp: Date.now(),
			actionId: action.id,
			success: true,
			content: { subtaskId: subtask.id },
		};
	}

	private async handleModifyTask(action: Action): Promise<Observation> {
		const payload = action.payload as {
			taskId: string;
			status: SubTask["status"];
			result?: unknown;
		};

		const task = this.caState.subtasks.find((t) => t.id === payload.taskId);
		if (!task) {
			return this.createErrorObservation(action.id, new Error("Task not found"));
		}

		task.status = payload.status;
		if (payload.result) task.result = payload.result;

		return {
			id: `obs-${Date.now()}`,
			type: "success",
			timestamp: Date.now(),
			actionId: action.id,
			success: true,
			content: { task },
		};
	}

	private async handleFinish(action: Action): Promise<Observation> {
		this.caState.status = "finished";
		this.caState.lastUpdateTime = Date.now();

		return {
			id: `obs-${Date.now()}`,
			type: "success",
			timestamp: Date.now(),
			actionId: action.id,
			success: true,
			content: { message: "Agent finished successfully" },
		};
	}

	private async handleReject(action: Action): Promise<Observation> {
		const payload = action.payload as { reason: string };

		this.caState.status = "finished";
		this.caState.lastUpdateTime = Date.now();

		return {
			id: `obs-${Date.now()}`,
			type: "success",
			timestamp: Date.now(),
			actionId: action.id,
			success: true,
			content: { message: `Agent rejected task: ${payload.reason}` },
		};
	}

	private createErrorObservation(actionId: string, error: unknown): Observation {
		return {
			id: `obs-${Date.now()}`,
			type: "error",
			timestamp: Date.now(),
			actionId,
			success: false,
			content: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	// ========================================================================
	// Main Loop
	// ========================================================================

	/**
	 * Execute a single step (action -> observation)
	 */
	async step(action: Action): Promise<Observation> {
		// Update state
		this.caState.globalIteration++;
		this.caState.localIteration++;
		this.caState.lastUpdateTime = Date.now();
		this.caState.actions.push(action);

		// Get handler
		const handler = this.actionHandlers.get(action.type);
		if (!handler) {
			const observation = this.createErrorObservation(action.id, new Error(`Unknown action type: ${action.type}`));
			this.caState.observations.push(observation);
			this.caState.consecutiveErrors++;
			return observation;
		}

		// Execute action
		const observation = await handler(action);
		this.caState.observations.push(observation);

		// Update error tracking
		if (observation.success) {
			this.caState.consecutiveErrors = 0;
		} else {
			this.caState.consecutiveErrors++;
			if (this.caState.consecutiveErrors >= this.caConfig.maxConsecutiveErrors) {
				this.caState.status = "error";
				this.caState.lastError = `Max consecutive errors reached (${this.caConfig.maxConsecutiveErrors})`;
			}
		}

		// Check iteration limit
		if (this.caState.globalIteration >= this.caState.maxIterations) {
			this.caState.status = "stuck";
			this.caState.lastError = "Max iterations reached";
		}

		return observation;
	}

	/**
	 * Run task to completion
	 */
	async runTask(task: string): Promise<CodeActState> {
		this.caState = this.createInitialState();
		this.caState.rootTask = task;
		this.caState.status = "running";

		console.log(`[CodeAct] Starting task: ${task}`);

		// Initial analysis
		const analyzeAction: Action = {
			id: `action-${Date.now()}`,
			type: "analyze_market",
			timestamp: Date.now(),
			payload: {
				symbol: "BTC",
				timeframe: "1h",
				indicators: ["rsi", "macd", "ema"],
			},
			thought: "Starting with market analysis to understand current conditions",
		};

		await this.step(analyzeAction);

		// Continue until finished or error
		while (this.caState.status === "running" && this.caState.globalIteration < this.caState.maxIterations) {
			// In a real implementation, this would use LLM to decide next action
			// For now, we just finish after analysis
			const finishAction: Action = {
				id: `action-${Date.now()}`,
				type: "finish",
				timestamp: Date.now(),
				payload: {},
				thought: "Task completed after initial analysis",
			};

			await this.step(finishAction);
		}

		return this.caState;
	}

	// ========================================================================
	// BaseAgent Implementation
	// ========================================================================

	async analyze(): Promise<TradeSignal[]> {
		// Extract signals from recent analysis observations
		const signals: TradeSignal[] = [];

		for (const obs of this.caState.observations) {
			if (obs.type === "analysis_result" && obs.success) {
				const content = obs.content as AnalysisResultObservation["content"];
				signals.push(...content.signals);
			}
		}

		return signals;
	}

	// ========================================================================
	// Stats & Reporting
	// ========================================================================

	getFormattedStats(): string {
		const state = this.caState;

		return [
			"**CodeAct Trading Agent**",
			"",
			"**State**",
			`Status: ${state.status}`,
			`Iterations: ${state.globalIteration}/${state.maxIterations}`,
			`Actions: ${state.actions.length}`,
			`Observations: ${state.observations.length}`,
			`Errors: ${state.consecutiveErrors}`,
			"",
			"**Task**",
			`Root: ${state.rootTask || "None"}`,
			`Subtasks: ${state.subtasks.length}`,
			`Completed: ${state.subtasks.filter((t) => t.status === "completed").length}`,
			"",
			"**Configuration**",
			`Max Iterations: ${this.caConfig.maxIterations}`,
			`Delegation: ${this.caConfig.delegationEnabled ? "Enabled" : "Disabled"}`,
			`Available Delegates: ${this.caConfig.availableDelegates.join(", ")}`,
		].join("\n");
	}
}
