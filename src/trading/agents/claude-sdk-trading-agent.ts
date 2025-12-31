/**
 * Claude Agent SDK Trading Agent
 *
 * Combines patterns from:
 * - Claude Agent SDK: Hooks, streaming, subagent definitions, session management
 * - OpenHands SDK: Action/Observation pattern, ToolExecutor, agent delegation
 * - MoonDev AI: Liquidation tracking, RBI framework, multi-model support
 *
 * This agent implements a full Action/Observation cycle with hook-based lifecycle
 * management and multi-agent delegation for specialized trading tasks.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradeSignal, TradingAction } from "../types.js";

// ============================================================================
// CLAUDE SDK HOOK SYSTEM
// ============================================================================

export type HookEvent =
	| "PreToolUse"
	| "PostToolUse"
	| "SessionStart"
	| "SessionEnd"
	| "TurnStart"
	| "TurnEnd"
	| "AgentDelegation"
	| "SignalGenerated"
	| "AnalysisComplete";

export interface HookContext {
	sessionId: string;
	turnIndex: number;
	signal?: AbortSignal;
	metadata: Record<string, unknown>;
}

export type HookHandler<T = unknown> = (data: T, context: HookContext) => Promise<T | undefined>;

export interface HookDefinitions {
	PreToolUse: HookHandler<ToolInput>;
	PostToolUse: HookHandler<ToolOutput>;
	SessionStart: HookHandler<SessionState>;
	SessionEnd: HookHandler<SessionState>;
	TurnStart: HookHandler<TurnData>;
	TurnEnd: HookHandler<TurnData>;
	AgentDelegation: HookHandler<DelegationRequest>;
	SignalGenerated: HookHandler<TradeSignal>;
	AnalysisComplete: HookHandler<AnalysisResult>;
}

// ============================================================================
// ACTION/OBSERVATION PATTERN (OpenHands SDK Style)
// ============================================================================

export type ActionType =
	| "analyze_liquidations"
	| "analyze_market"
	| "research_strategy"
	| "backtest_strategy"
	| "execute_trade"
	| "delegate_agent"
	| "get_price_data"
	| "track_whale";

export interface Action<T extends ActionType = ActionType> {
	type: T;
	id: string;
	timestamp: number;
	params: ActionParams[T];
}

export interface ActionParams {
	analyze_liquidations: {
		symbol: string;
		timeframe: "15m" | "1h" | "4h";
		threshold: number;
	};
	analyze_market: {
		symbol: string;
		indicators: string[];
		candles: number;
	};
	research_strategy: {
		source: "youtube" | "pdf" | "text";
		content: string;
		extractRules: boolean;
	};
	backtest_strategy: {
		strategyCode: string;
		symbol: string;
		startDate: string;
		endDate: string;
	};
	execute_trade: {
		symbol: string;
		action: TradingAction;
		size: number;
		stopLoss?: number;
		takeProfit?: number;
	};
	delegate_agent: {
		agentName: string;
		task: string;
		context: Record<string, unknown>;
	};
	get_price_data: {
		symbol: string;
		interval: string;
		limit: number;
	};
	track_whale: {
		symbol: string;
		minUsdValue: number;
	};
}

export interface Observation<T extends ActionType = ActionType> {
	actionId: string;
	actionType: T;
	success: boolean;
	timestamp: number;
	data: ObservationData[T];
	error?: string;
}

export interface ObservationData {
	analyze_liquidations: LiquidationAnalysis;
	analyze_market: MarketAnalysis;
	research_strategy: StrategyResearch;
	backtest_strategy: BacktestResults;
	execute_trade: TradeExecution;
	delegate_agent: DelegationResult;
	get_price_data: PriceDataResult;
	track_whale: WhaleTrackingResult;
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

export interface LiquidationAnalysis {
	longLiquidations: number;
	shortLiquidations: number;
	longLiquidationChange: number;
	shortLiquidationChange: number;
	ratio: number;
	signal: TradingAction;
	confidence: number;
	reasoning: string;
}

export interface MarketAnalysis {
	symbol: string;
	price: number;
	trend: "bullish" | "bearish" | "neutral";
	indicators: Record<string, number>;
	support: number[];
	resistance: number[];
	recommendation: TradingAction;
	confidence: number;
}

export interface StrategyResearch {
	strategyName: string;
	entryRules: string[];
	exitRules: string[];
	indicators: string[];
	riskManagement: {
		stopLoss: string;
		takeProfit: string;
		positionSize: string;
	};
	sourceType: string;
	extracted: boolean;
}

export interface BacktestResults {
	strategyName: string;
	totalReturn: number;
	sharpeRatio: number;
	maxDrawdown: number;
	winRate: number;
	totalTrades: number;
	profitFactor: number;
	valid: boolean;
	errors: string[];
}

export interface TradeExecution {
	orderId: string;
	symbol: string;
	side: "buy" | "sell";
	size: number;
	price: number;
	filled: boolean;
	timestamp: number;
}

export interface DelegationResult {
	agentName: string;
	taskCompleted: boolean;
	result: unknown;
	executionTime: number;
}

export interface PriceDataResult {
	symbol: string;
	candles: {
		timestamp: number;
		open: number;
		high: number;
		low: number;
		close: number;
		volume: number;
	}[];
	latestPrice: number;
}

export interface WhaleTrackingResult {
	movements: {
		type: "buy" | "sell" | "transfer";
		amount: number;
		usdValue: number;
		address: string;
		timestamp: number;
	}[];
	netFlow: number;
	signal: TradingAction;
}

// ============================================================================
// SESSION AND TOOL TYPES
// ============================================================================

export interface SessionState {
	id: string;
	startTime: number;
	endTime?: number;
	turnCount: number;
	actions: Action[];
	observations: Observation[];
	signals: TradeSignal[];
	delegatedAgents: string[];
	metadata: Record<string, unknown>;
}

export interface TurnData {
	index: number;
	startTime: number;
	endTime?: number;
	action?: Action;
	observation?: Observation;
}

export interface ToolInput {
	toolName: string;
	args: Record<string, unknown>;
	toolUseId: string;
}

export interface ToolOutput {
	toolName: string;
	toolUseId: string;
	result: unknown;
	duration: number;
}

export interface DelegationRequest {
	targetAgent: string;
	task: string;
	parentSessionId: string;
	context: Record<string, unknown>;
}

export interface AnalysisResult {
	type: "liquidation" | "market" | "whale" | "sentiment";
	signal: TradingAction;
	confidence: number;
	data: Record<string, unknown>;
}

// ============================================================================
// TOOL EXECUTOR (OpenHands Pattern)
// ============================================================================

export type ToolExecutor<A extends Action, O extends Observation> = (action: A, context: HookContext) => Promise<O>;

export interface ToolDefinition<T extends ActionType = ActionType> {
	name: T;
	description: string;
	paramSchema: Record<string, unknown>;
	executor: ToolExecutor<Action<T>, Observation<T>>;
}

// ============================================================================
// SUBAGENT DEFINITIONS (Claude SDK Style)
// ============================================================================

export interface SubagentDefinition {
	name: string;
	description: string;
	tools: ActionType[];
	model?: "sonnet" | "opus" | "haiku";
	systemPrompt?: string;
	maxTurns?: number;
}

export const TRADING_SUBAGENTS: Record<string, SubagentDefinition> = {
	liquidation_analyst: {
		name: "liquidation_analyst",
		description: "Analyzes liquidation cascades and identifies entry/exit points",
		tools: ["analyze_liquidations", "get_price_data"],
		model: "sonnet",
		systemPrompt: `You are a liquidation analysis specialist. Analyze liquidation data to identify:
- Large long liquidations often indicate potential bottoms (shorts taking profit)
- Large short liquidations often indicate potential tops (longs taking profit)
- Use ratio analysis between concurrent liquidation types for directional bias`,
		maxTurns: 5,
	},
	rbi_researcher: {
		name: "rbi_researcher",
		description: "Research-Backtest-Implement framework agent",
		tools: ["research_strategy", "backtest_strategy"],
		model: "opus",
		systemPrompt: `You implement the RBI Framework:
1. RESEARCH: Extract trading rules from content (YouTube, PDF, text)
2. BACKTEST: Create backtesting.py code with proper position sizing
3. IMPLEMENT: Generate production-ready trading code
Always use int(round(position_size)) to avoid floating-point errors`,
		maxTurns: 10,
	},
	whale_tracker: {
		name: "whale_tracker",
		description: "Tracks whale movements and smart money flows",
		tools: ["track_whale", "get_price_data", "analyze_market"],
		model: "sonnet",
		systemPrompt: `You track whale activity and smart money:
- Monitor large transactions (>$100k USD)
- Identify accumulation vs distribution patterns
- Correlate whale movements with price action`,
		maxTurns: 5,
	},
	market_analyst: {
		name: "market_analyst",
		description: "Technical and fundamental market analysis",
		tools: ["analyze_market", "get_price_data"],
		model: "haiku",
		systemPrompt: `You provide market analysis:
- Technical indicators (RSI, MACD, Bollinger Bands)
- Support/resistance levels
- Trend identification and momentum analysis`,
		maxTurns: 3,
	},
	trade_executor: {
		name: "trade_executor",
		description: "Executes trades with risk management",
		tools: ["execute_trade", "get_price_data"],
		model: "haiku",
		systemPrompt: `You execute trades safely:
- Always use stop losses
- Position sizing based on account risk
- Never risk more than specified per trade`,
		maxTurns: 2,
	},
};

// ============================================================================
// CLAUDE SDK TRADING AGENT
// ============================================================================

export interface ClaudeSDKConfig extends AgentConfig {
	sessionPersistence: boolean;
	maxTurnsPerSession: number;
	delegationEnabled: boolean;
	hooks?: Partial<HookDefinitions>;
	subagents?: string[];
}

export class ClaudeSDKTradingAgent extends BaseAgent {
	private session: SessionState | null = null;
	private hooks: Partial<HookDefinitions> = {};
	private toolRegistry: Map<ActionType, ToolDefinition> = new Map();
	private subagentRegistry: Map<string, SubagentDefinition> = new Map();
	private currentTurn: TurnData | null = null;
	private sdkConfig: ClaudeSDKConfig;

	constructor(config: ClaudeSDKConfig) {
		super(config);
		this.sdkConfig = config;

		// Register hooks
		if (config.hooks) {
			this.hooks = config.hooks;
		}

		// Register default tools
		this.registerDefaultTools();

		// Register subagents
		const subagentNames = config.subagents || Object.keys(TRADING_SUBAGENTS);
		for (const name of subagentNames) {
			const subagent = TRADING_SUBAGENTS[name];
			if (subagent) {
				this.subagentRegistry.set(name, subagent);
			}
		}

		console.log(
			`[ClaudeSDKTradingAgent] Initialized with ${this.toolRegistry.size} tools, ${this.subagentRegistry.size} subagents`,
		);
	}

	// ========================================================================
	// SESSION MANAGEMENT
	// ========================================================================

	async startSession(metadata: Record<string, unknown> = {}): Promise<string> {
		const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		this.session = {
			id: sessionId,
			startTime: Date.now(),
			turnCount: 0,
			actions: [],
			observations: [],
			signals: [],
			delegatedAgents: [],
			metadata,
		};

		await this.emitHook("SessionStart", this.session);
		console.log(`[ClaudeSDKTradingAgent] Session started: ${sessionId}`);

		return sessionId;
	}

	async endSession(): Promise<SessionState | null> {
		if (!this.session) return null;

		this.session.endTime = Date.now();
		await this.emitHook("SessionEnd", this.session);

		const finalSession = { ...this.session };
		this.session = null;
		this.currentTurn = null;

		console.log(`[ClaudeSDKTradingAgent] Session ended: ${finalSession.id} (${finalSession.turnCount} turns)`);
		return finalSession;
	}

	async resumeSession(previousSession: SessionState): Promise<void> {
		this.session = {
			...previousSession,
			startTime: Date.now(),
			endTime: undefined,
		};
		await this.emitHook("SessionStart", this.session);
		console.log(`[ClaudeSDKTradingAgent] Session resumed: ${this.session.id}`);
	}

	// ========================================================================
	// HOOK SYSTEM
	// ========================================================================

	registerHook<E extends HookEvent>(event: E, handler: HookDefinitions[E]): void {
		this.hooks[event] = handler as HookDefinitions[E];
	}

	private async emitHook<E extends HookEvent>(
		event: E,
		data: Parameters<HookDefinitions[E]>[0],
	): Promise<Parameters<HookDefinitions[E]>[0]> {
		const handler = this.hooks[event];
		if (!handler) return data;

		const context = this.getHookContext();
		try {
			const result = await (handler as HookHandler)(data, context);
			return (result ?? data) as Parameters<HookDefinitions[E]>[0];
		} catch (error) {
			console.error(`[ClaudeSDKTradingAgent] Hook error (${event}):`, error);
			return data;
		}
	}

	private getHookContext(): HookContext {
		return {
			sessionId: this.session?.id || "no_session",
			turnIndex: this.session?.turnCount || 0,
			metadata: this.session?.metadata || {},
		};
	}

	// ========================================================================
	// TOOL REGISTRATION
	// ========================================================================

	registerTool<T extends ActionType>(definition: ToolDefinition<T>): void {
		this.toolRegistry.set(definition.name, definition as unknown as ToolDefinition);
		console.log(`[ClaudeSDKTradingAgent] Registered tool: ${definition.name}`);
	}

	private registerDefaultTools(): void {
		// Liquidation Analysis Tool
		this.registerTool({
			name: "analyze_liquidations",
			description: "Analyze liquidation data to identify trading opportunities",
			paramSchema: {
				symbol: { type: "string", required: true },
				timeframe: { type: "string", enum: ["15m", "1h", "4h"] },
				threshold: { type: "number", default: 0.5 },
			},
			executor: async (action, _context) => {
				const params = action.params as ActionParams["analyze_liquidations"];
				// Simulated liquidation analysis - in production, fetch from API
				const analysis: LiquidationAnalysis = {
					longLiquidations: Math.random() * 10000000,
					shortLiquidations: Math.random() * 10000000,
					longLiquidationChange: (Math.random() - 0.5) * 100,
					shortLiquidationChange: (Math.random() - 0.5) * 100,
					ratio: Math.random() * 2,
					signal: Math.random() > 0.5 ? "BUY" : Math.random() > 0.3 ? "SELL" : "HOLD",
					confidence: Math.random(),
					reasoning: `Analysis for ${params.symbol} on ${params.timeframe} timeframe`,
				};

				return {
					actionId: action.id,
					actionType: "analyze_liquidations",
					success: true,
					timestamp: Date.now(),
					data: analysis,
				};
			},
		});

		// Market Analysis Tool
		this.registerTool({
			name: "analyze_market",
			description: "Perform technical analysis on market data",
			paramSchema: {
				symbol: { type: "string", required: true },
				indicators: { type: "array", items: "string" },
				candles: { type: "number", default: 100 },
			},
			executor: async (action, _context) => {
				const params = action.params as ActionParams["analyze_market"];
				const analysis: MarketAnalysis = {
					symbol: params.symbol,
					price: 100 + Math.random() * 50,
					trend: Math.random() > 0.5 ? "bullish" : Math.random() > 0.3 ? "bearish" : "neutral",
					indicators: params.indicators.reduce(
						(acc, ind) => {
							acc[ind] = Math.random() * 100;
							return acc;
						},
						{} as Record<string, number>,
					),
					support: [95, 90, 85],
					resistance: [110, 115, 120],
					recommendation: Math.random() > 0.5 ? "BUY" : Math.random() > 0.3 ? "SELL" : "HOLD",
					confidence: Math.random(),
				};

				return {
					actionId: action.id,
					actionType: "analyze_market",
					success: true,
					timestamp: Date.now(),
					data: analysis,
				};
			},
		});

		// Price Data Tool
		this.registerTool({
			name: "get_price_data",
			description: "Fetch OHLCV price data",
			paramSchema: {
				symbol: { type: "string", required: true },
				interval: { type: "string", default: "1h" },
				limit: { type: "number", default: 100 },
			},
			executor: async (action, _context) => {
				const params = action.params as ActionParams["get_price_data"];
				const candles = Array.from({ length: params.limit }, (_, i) => {
					const basePrice = 100;
					const volatility = 5;
					return {
						timestamp: Date.now() - (params.limit - i) * 3600000,
						open: basePrice + (Math.random() - 0.5) * volatility,
						high: basePrice + Math.random() * volatility,
						low: basePrice - Math.random() * volatility,
						close: basePrice + (Math.random() - 0.5) * volatility,
						volume: Math.random() * 1000000,
					};
				});

				return {
					actionId: action.id,
					actionType: "get_price_data",
					success: true,
					timestamp: Date.now(),
					data: {
						symbol: params.symbol,
						candles,
						latestPrice: candles[candles.length - 1].close,
					},
				};
			},
		});

		// Whale Tracking Tool
		this.registerTool({
			name: "track_whale",
			description: "Track whale movements and large transactions",
			paramSchema: {
				symbol: { type: "string", required: true },
				minUsdValue: { type: "number", default: 100000 },
			},
			executor: async (action, _context) => {
				const params = action.params as ActionParams["track_whale"];
				const movements = Array.from({ length: 5 }, () => ({
					type: (["buy", "sell", "transfer"] as const)[Math.floor(Math.random() * 3)],
					amount: Math.random() * 1000,
					usdValue: params.minUsdValue + Math.random() * 1000000,
					address: `0x${Math.random().toString(16).slice(2, 42)}`,
					timestamp: Date.now() - Math.random() * 86400000,
				}));

				const netFlow = movements.reduce((acc, m) => {
					if (m.type === "buy") return acc + m.usdValue;
					if (m.type === "sell") return acc - m.usdValue;
					return acc;
				}, 0);

				return {
					actionId: action.id,
					actionType: "track_whale",
					success: true,
					timestamp: Date.now(),
					data: {
						movements,
						netFlow,
						signal: netFlow > 0 ? "BUY" : netFlow < 0 ? "SELL" : "HOLD",
					},
				};
			},
		});

		// Agent Delegation Tool
		this.registerTool({
			name: "delegate_agent",
			description: "Delegate task to a specialized subagent",
			paramSchema: {
				agentName: { type: "string", required: true },
				task: { type: "string", required: true },
				context: { type: "object" },
			},
			executor: async (action, context) => {
				const params = action.params as ActionParams["delegate_agent"];
				const subagent = this.subagentRegistry.get(params.agentName);

				if (!subagent) {
					return {
						actionId: action.id,
						actionType: "delegate_agent",
						success: false,
						timestamp: Date.now(),
						data: {
							agentName: params.agentName,
							taskCompleted: false,
							result: null,
							executionTime: 0,
						},
						error: `Subagent not found: ${params.agentName}`,
					};
				}

				// Emit delegation hook
				await this.emitHook("AgentDelegation", {
					targetAgent: params.agentName,
					task: params.task,
					parentSessionId: context.sessionId,
					context: params.context,
				});

				// Track delegation
				if (this.session) {
					this.session.delegatedAgents.push(params.agentName);
				}

				const startTime = Date.now();

				// Simulated subagent execution
				const result = {
					agentName: params.agentName,
					subagentDescription: subagent.description,
					taskExecuted: params.task,
					availableTools: subagent.tools,
					model: subagent.model,
				};

				return {
					actionId: action.id,
					actionType: "delegate_agent",
					success: true,
					timestamp: Date.now(),
					data: {
						agentName: params.agentName,
						taskCompleted: true,
						result,
						executionTime: Date.now() - startTime,
					},
				};
			},
		});

		// Research Strategy Tool (RBI Pattern)
		this.registerTool({
			name: "research_strategy",
			description: "Research and extract trading strategy from content",
			paramSchema: {
				source: { type: "string", enum: ["youtube", "pdf", "text"] },
				content: { type: "string", required: true },
				extractRules: { type: "boolean", default: true },
			},
			executor: async (action, _context) => {
				const params = action.params as ActionParams["research_strategy"];

				// Generate unique strategy name (MoonDev pattern)
				const adjectives = ["Dynamic", "Quantum", "Velocity", "Phoenix", "Shadow"];
				const nouns = ["Breakout", "Momentum", "Reversal", "Scalper", "Hunter"];
				const strategyName = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;

				return {
					actionId: action.id,
					actionType: "research_strategy",
					success: true,
					timestamp: Date.now(),
					data: {
						strategyName,
						entryRules: [
							"RSI crosses above 30 from below",
							"MACD histogram turns positive",
							"Price above 20 EMA",
						],
						exitRules: ["RSI reaches 70", "MACD histogram turns negative", "Trailing stop hit at 2%"],
						indicators: ["RSI", "MACD", "EMA20", "Volume"],
						riskManagement: {
							stopLoss: "2% below entry",
							takeProfit: "3:1 risk/reward ratio",
							positionSize: "2% of portfolio per trade",
						},
						sourceType: params.source,
						extracted: params.extractRules,
					},
				};
			},
		});

		// Backtest Strategy Tool
		this.registerTool({
			name: "backtest_strategy",
			description: "Backtest a trading strategy with historical data",
			paramSchema: {
				strategyCode: { type: "string", required: true },
				symbol: { type: "string", required: true },
				startDate: { type: "string" },
				endDate: { type: "string" },
			},
			executor: async (action, _context) => {
				const params = action.params as ActionParams["backtest_strategy"];

				// Simulated backtest results
				return {
					actionId: action.id,
					actionType: "backtest_strategy",
					success: true,
					timestamp: Date.now(),
					data: {
						strategyName: `Backtest_${params.symbol}`,
						totalReturn: Math.random() * 200 - 50,
						sharpeRatio: Math.random() * 3,
						maxDrawdown: Math.random() * 30,
						winRate: 0.4 + Math.random() * 0.3,
						totalTrades: Math.floor(Math.random() * 200) + 50,
						profitFactor: 1 + Math.random() * 2,
						valid: Math.random() > 0.2,
						errors: [],
					},
				};
			},
		});

		// Execute Trade Tool
		this.registerTool({
			name: "execute_trade",
			description: "Execute a trade with risk management",
			paramSchema: {
				symbol: { type: "string", required: true },
				action: { type: "string", enum: ["BUY", "SELL", "HOLD", "NOTHING"] },
				size: { type: "number", required: true },
				stopLoss: { type: "number" },
				takeProfit: { type: "number" },
			},
			executor: async (action, _context) => {
				const params = action.params as ActionParams["execute_trade"];

				if (params.action === "HOLD" || params.action === "NOTHING") {
					return {
						actionId: action.id,
						actionType: "execute_trade",
						success: true,
						timestamp: Date.now(),
						data: {
							orderId: "NO_ORDER",
							symbol: params.symbol,
							side: "buy" as const,
							size: 0,
							price: 0,
							filled: false,
							timestamp: Date.now(),
						},
					};
				}

				return {
					actionId: action.id,
					actionType: "execute_trade",
					success: true,
					timestamp: Date.now(),
					data: {
						orderId: `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
						symbol: params.symbol,
						side: params.action === "BUY" ? ("buy" as const) : ("sell" as const),
						size: Math.floor(params.size),
						price: 100 + Math.random() * 10,
						filled: true,
						timestamp: Date.now(),
					},
				};
			},
		});
	}

	// ========================================================================
	// ACTION EXECUTION (OpenHands Pattern)
	// ========================================================================

	async executeAction<T extends ActionType>(actionType: T, params: ActionParams[T]): Promise<Observation<T>> {
		if (!this.session) {
			await this.startSession();
		}

		// Create action
		const action: Action<T> = {
			type: actionType,
			id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
			params,
		};

		// Start turn
		this.currentTurn = {
			index: this.session!.turnCount,
			startTime: Date.now(),
			action,
		};
		this.session!.turnCount++;
		await this.emitHook("TurnStart", this.currentTurn);

		// Pre-tool hook
		const toolInput: ToolInput = {
			toolName: actionType,
			args: params as Record<string, unknown>,
			toolUseId: action.id,
		};
		await this.emitHook("PreToolUse", toolInput);

		// Execute tool
		const tool = this.toolRegistry.get(actionType);
		if (!tool) {
			throw new Error(`Tool not found: ${actionType}`);
		}

		const startTime = Date.now();
		const observation = await tool.executor(action, this.getHookContext());
		const duration = Date.now() - startTime;

		// Post-tool hook
		const toolOutput: ToolOutput = {
			toolName: actionType,
			toolUseId: action.id,
			result: observation.data,
			duration,
		};
		await this.emitHook("PostToolUse", toolOutput);

		// Record action and observation
		this.session!.actions.push(action);
		this.session!.observations.push(observation);

		// End turn
		this.currentTurn.endTime = Date.now();
		this.currentTurn.observation = observation;
		await this.emitHook("TurnEnd", this.currentTurn);

		return observation as Observation<T>;
	}

	// ========================================================================
	// SIGNAL GENERATION
	// ========================================================================

	async generateSignal(
		symbol: string,
		analysisTypes: ("liquidation" | "market" | "whale")[],
	): Promise<TradeSignal | null> {
		const results: AnalysisResult[] = [];

		for (const type of analysisTypes) {
			let observation: Observation;

			switch (type) {
				case "liquidation":
					observation = await this.executeAction("analyze_liquidations", {
						symbol,
						timeframe: "1h",
						threshold: 0.5,
					});
					if (observation.success) {
						const data = observation.data as LiquidationAnalysis;
						results.push({
							type: "liquidation",
							signal: data.signal,
							confidence: data.confidence,
							data: data as unknown as Record<string, unknown>,
						});
					}
					break;

				case "market":
					observation = await this.executeAction("analyze_market", {
						symbol,
						indicators: ["RSI", "MACD", "EMA"],
						candles: 100,
					});
					if (observation.success) {
						const data = observation.data as MarketAnalysis;
						results.push({
							type: "market",
							signal: data.recommendation,
							confidence: data.confidence,
							data: data as unknown as Record<string, unknown>,
						});
					}
					break;

				case "whale":
					observation = await this.executeAction("track_whale", {
						symbol,
						minUsdValue: 100000,
					});
					if (observation.success) {
						const data = observation.data as WhaleTrackingResult;
						results.push({
							type: "whale",
							signal: data.signal,
							confidence: Math.abs(data.netFlow) / 1000000,
							data: data as unknown as Record<string, unknown>,
						});
					}
					break;
			}
		}

		// Emit analysis complete hook
		for (const result of results) {
			await this.emitHook("AnalysisComplete", result);
		}

		if (results.length === 0) return null;

		// Consensus from multiple analyses
		const actionVotes = results.reduce(
			(acc, r) => {
				acc[r.signal] = (acc[r.signal] || 0) + r.confidence;
				return acc;
			},
			{} as Record<TradingAction, number>,
		);

		const bestAction = Object.entries(actionVotes).sort(([, a], [, b]) => b - a)[0];
		const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

		const signal: TradeSignal = {
			symbol,
			action: bestAction[0] as TradingAction,
			confidence: avgConfidence,
			price: 0, // Would be filled from price data
			reason: `Consensus from ${results.length} analyses: ${results.map((r) => r.type).join(", ")}`,
			source: "ClaudeSDKTradingAgent",
			timestamp: Date.now(),
			metadata: {
				analysisResults: results,
				sessionId: this.session?.id,
			},
		};

		// Record signal
		if (this.session) {
			this.session.signals.push(signal);
		}

		// Emit signal hook
		await this.emitHook("SignalGenerated", signal);

		// Emit to signal handlers
		await this.emitSignal(signal);

		return signal;
	}

	// ========================================================================
	// SUBAGENT DELEGATION
	// ========================================================================

	async delegateToSubagent(
		agentName: string,
		task: string,
		context: Record<string, unknown> = {},
	): Promise<DelegationResult> {
		if (!this.sdkConfig.delegationEnabled) {
			throw new Error("Agent delegation is disabled");
		}

		const observation = await this.executeAction("delegate_agent", {
			agentName,
			task,
			context,
		});

		return observation.data;
	}

	getAvailableSubagents(): SubagentDefinition[] {
		return Array.from(this.subagentRegistry.values());
	}

	// ========================================================================
	// RBI FRAMEWORK (MoonDev Pattern)
	// ========================================================================

	async runRBIWorkflow(
		content: string,
		source: "youtube" | "pdf" | "text",
	): Promise<{
		research: StrategyResearch;
		backtest: BacktestResults;
		signal: TradeSignal | null;
	}> {
		// 1. Research phase
		const researchObs = await this.executeAction("research_strategy", {
			source,
			content,
			extractRules: true,
		});
		const research = researchObs.data;

		// 2. Backtest phase
		const backtestObs = await this.executeAction("backtest_strategy", {
			strategyCode: JSON.stringify(research),
			symbol: "BTC",
			startDate: "2024-01-01",
			endDate: "2024-12-01",
		});
		const backtest = backtestObs.data;

		// 3. Generate signal if backtest valid
		let signal: TradeSignal | null = null;
		if (backtest.valid && backtest.sharpeRatio > 1) {
			signal = await this.generateSignal("BTC", ["market"]);
		}

		return { research, backtest, signal };
	}

	// ========================================================================
	// MAIN RUN LOOP
	// ========================================================================

	protected async run(): Promise<void> {
		await this.startSession({ runType: "scheduled" });

		try {
			for (const symbol of this.config.symbols) {
				const signal = await this.generateSignal(symbol, ["liquidation", "market", "whale"]);

				if (signal && signal.confidence > this.config.thresholds.minConfidence) {
					console.log(
						`[ClaudeSDKTradingAgent] High-confidence signal for ${symbol}: ${signal.action} (${(signal.confidence * 100).toFixed(1)}%)`,
					);
				}
			}
		} finally {
			await this.endSession();
		}
	}

	// ========================================================================
	// STATS AND INTROSPECTION
	// ========================================================================

	getSessionStats(): {
		sessionId: string | null;
		turnCount: number;
		actionsExecuted: number;
		signalsGenerated: number;
		delegatedAgents: string[];
	} {
		return {
			sessionId: this.session?.id || null,
			turnCount: this.session?.turnCount || 0,
			actionsExecuted: this.session?.actions.length || 0,
			signalsGenerated: this.session?.signals.length || 0,
			delegatedAgents: this.session?.delegatedAgents || [],
		};
	}

	getRegisteredTools(): string[] {
		return Array.from(this.toolRegistry.keys());
	}
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createClaudeSDKTradingAgent(options: Partial<ClaudeSDKConfig> = {}): ClaudeSDKTradingAgent {
	const config: ClaudeSDKConfig = {
		name: options.name || "ClaudeSDKTradingAgent",
		enabled: options.enabled ?? true,
		interval: options.interval || 60000,
		symbols: options.symbols || ["BTC", "ETH", "SOL"],
		thresholds: options.thresholds || { minConfidence: 0.7 },
		sessionPersistence: options.sessionPersistence ?? true,
		maxTurnsPerSession: options.maxTurnsPerSession || 50,
		delegationEnabled: options.delegationEnabled ?? true,
		hooks: options.hooks,
		subagents: options.subagents,
	};

	return new ClaudeSDKTradingAgent(config);
}

export function createTradingAgentWithHooks(
	hooks: Partial<HookDefinitions>,
	symbols: string[] = ["BTC", "ETH", "SOL"],
): ClaudeSDKTradingAgent {
	return createClaudeSDKTradingAgent({
		hooks,
		symbols,
	});
}

export default ClaudeSDKTradingAgent;
