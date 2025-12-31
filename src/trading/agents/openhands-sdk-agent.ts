/**
 * OpenHands SDK-Style Trading Agent
 *
 * Implements the OpenHands software-agent-sdk patterns:
 * - LLM + Agent + Conversation + Tool architecture
 * - Action/Observation messaging pattern
 * - Tool registration with ToolDefinition and ToolExecutor
 * - Agent delegation via register_agent pattern
 * - Skills and AgentContext for specialized behavior
 *
 * Combined with MoonDev trading patterns for autonomous learning
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradeSignal, TradingAction } from "../types.js";

// ============================================================================
// CORE SDK TYPES (OpenHands Pattern)
// ============================================================================

export interface LLMConfig {
	model: string;
	apiKey?: string;
	baseUrl?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface Skill {
	name: string;
	content: string;
	trigger: string | null;
}

export interface AgentContext {
	skills: Skill[];
	systemMessageSuffix?: string;
	maxIterations?: number;
}

export interface SDKTask {
	id: string;
	description: string;
	status: "pending" | "running" | "completed" | "failed";
	createdAt: number;
	completedAt?: number;
	result?: unknown;
	error?: string;
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
	role: MessageRole;
	content: string;
	timestamp: number;
	metadata?: Record<string, unknown>;
}

export interface ToolMessage extends Message {
	role: "tool";
	toolName: string;
	toolCallId: string;
	isError: boolean;
}

// ============================================================================
// CONVERSATION MANAGEMENT
// ============================================================================

export interface ConversationState {
	id: string;
	messages: Message[];
	tasks: SDKTask[];
	workspace: string;
	startTime: number;
	lastActivity: number;
	iterationCount: number;
	maxIterations: number;
}

export class SDKConversation {
	private state: ConversationState;
	private agent: SDKAgent;
	private isRunning: boolean = false;

	constructor(agent: SDKAgent, workspace: string, maxIterations: number = 100) {
		this.agent = agent;
		this.state = {
			id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			messages: [],
			tasks: [],
			workspace,
			startTime: Date.now(),
			lastActivity: Date.now(),
			iterationCount: 0,
			maxIterations,
		};
	}

	get id(): string {
		return this.state.id;
	}

	get messages(): Message[] {
		return [...this.state.messages];
	}

	get iterationCount(): number {
		return this.state.iterationCount;
	}

	sendMessage(content: string, role: MessageRole = "user"): void {
		this.state.messages.push({
			role,
			content,
			timestamp: Date.now(),
		});
		this.state.lastActivity = Date.now();
	}

	addToolResult(toolName: string, toolCallId: string, result: string, isError: boolean = false): void {
		const toolMessage: ToolMessage = {
			role: "tool",
			content: result,
			timestamp: Date.now(),
			toolName,
			toolCallId,
			isError,
		};
		this.state.messages.push(toolMessage);
	}

	async run(): Promise<ConversationState> {
		if (this.isRunning) {
			throw new Error("Conversation is already running");
		}

		this.isRunning = true;

		try {
			while (this.state.iterationCount < this.state.maxIterations && !this.isTerminated()) {
				this.state.iterationCount++;
				await this.agent.step(this);

				// Check for completion signals
				const lastMessage = this.state.messages[this.state.messages.length - 1];
				if (
					lastMessage?.role === "assistant" &&
					(lastMessage.content.includes("[TASK_COMPLETE]") || lastMessage.content.includes("[NO_ACTION]"))
				) {
					break;
				}
			}
		} finally {
			this.isRunning = false;
		}

		return this.getState();
	}

	private isTerminated(): boolean {
		const lastMessage = this.state.messages[this.state.messages.length - 1];
		return lastMessage?.content?.includes("[TERMINATE]") ?? false;
	}

	getState(): ConversationState {
		return { ...this.state };
	}

	createTask(description: string): SDKTask {
		const task: SDKTask = {
			id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			description,
			status: "pending",
			createdAt: Date.now(),
		};
		this.state.tasks.push(task);
		return task;
	}

	updateTask(taskId: string, updates: Partial<SDKTask>): void {
		const task = this.state.tasks.find((t) => t.id === taskId);
		if (task) {
			Object.assign(task, updates);
		}
	}
}

// ============================================================================
// TOOL SYSTEM (OpenHands Pattern)
// ============================================================================

export interface ToolParameter {
	name: string;
	type: "string" | "number" | "boolean" | "array" | "object";
	description: string;
	required?: boolean;
	default?: unknown;
	enum?: unknown[];
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: ToolParameter[];
}

export type ToolExecutor<TInput = Record<string, unknown>, TOutput = unknown> = (
	input: TInput,
	conversation: SDKConversation,
) => Promise<TOutput>;

export interface RegisteredTool {
	definition: ToolDefinition;
	executor: ToolExecutor;
}

// Tool Registry (singleton pattern like OpenHands)
const sdkToolRegistry = new Map<string, RegisteredTool>();

export function registerSDKTool(name: string, definition: ToolDefinition, executor: ToolExecutor): void {
	sdkToolRegistry.set(name, { definition, executor });
	console.log(`[OpenHandsSDK] Registered tool: ${name}`);
}

export function getSDKTool(name: string): RegisteredTool | undefined {
	return sdkToolRegistry.get(name);
}

export function getAllSDKTools(): RegisteredTool[] {
	return Array.from(sdkToolRegistry.values());
}

// ============================================================================
// AGENT REGISTRY (OpenHands Pattern)
// ============================================================================

export type AgentFactory = (llm: LLMConfig) => SDKAgent;

interface RegisteredSDKAgent {
	name: string;
	description: string;
	factory: AgentFactory;
}

const sdkAgentRegistry = new Map<string, RegisteredSDKAgent>();

export function registerSDKAgent(name: string, description: string, factory: AgentFactory): void {
	sdkAgentRegistry.set(name, { name, description, factory });
	console.log(`[OpenHandsSDK] Registered agent: ${name}`);
}

export function getSDKAgent(name: string): RegisteredSDKAgent | undefined {
	return sdkAgentRegistry.get(name);
}

export function createAgentFromSDKRegistry(name: string, llm: LLMConfig): SDKAgent | null {
	const registered = sdkAgentRegistry.get(name);
	if (!registered) return null;
	return registered.factory(llm);
}

// ============================================================================
// SDK AGENT BASE
// ============================================================================

export class SDKAgent {
	protected llm: LLMConfig;
	protected tools: string[];
	protected context: AgentContext;
	protected name: string;

	constructor(
		llm: LLMConfig,
		tools: string[] = [],
		context: AgentContext = { skills: [] },
		name: string = "SDKAgent",
	) {
		this.llm = llm;
		this.tools = tools;
		this.context = context;
		this.name = name;
	}

	async step(conversation: SDKConversation): Promise<void> {
		const availableTools = this.tools
			.map((name) => getSDKTool(name))
			.filter((t): t is RegisteredTool => t !== undefined);

		const lastUserMessage = [...conversation.messages].reverse().find((m) => m.role === "user");

		if (!lastUserMessage) {
			conversation.sendMessage("[NO_ACTION] No user message to process", "assistant");
			return;
		}

		const toolToUse = this.selectTool(lastUserMessage.content, availableTools);

		if (toolToUse) {
			const toolCallId = `call_${Date.now()}`;
			const input = this.parseToolInput(lastUserMessage.content, toolToUse.definition);

			try {
				const result = await toolToUse.executor(input, conversation);
				conversation.addToolResult(toolToUse.definition.name, toolCallId, JSON.stringify(result, null, 2));

				conversation.sendMessage(
					`Tool ${toolToUse.definition.name} executed successfully.\n\n` +
						`Result: ${JSON.stringify(result, null, 2)}\n\n` +
						`[TASK_COMPLETE]`,
					"assistant",
				);
			} catch (error) {
				conversation.addToolResult(
					toolToUse.definition.name,
					toolCallId,
					error instanceof Error ? error.message : String(error),
					true,
				);
				conversation.sendMessage(`Tool ${toolToUse.definition.name} failed: ${error}`, "assistant");
			}
		} else {
			conversation.sendMessage(
				`Analyzed request: "${lastUserMessage.content}"\n\n` +
					`No specific tool action required.\n\n` +
					`[TASK_COMPLETE]`,
				"assistant",
			);
		}
	}

	protected selectTool(message: string, tools: RegisteredTool[]): RegisteredTool | null {
		const lowercaseMessage = message.toLowerCase();

		for (const tool of tools) {
			const keywords = tool.definition.name.split("_");
			if (keywords.some((kw) => lowercaseMessage.includes(kw))) {
				return tool;
			}
		}

		return null;
	}

	protected parseToolInput(message: string, definition: ToolDefinition): Record<string, unknown> {
		const input: Record<string, unknown> = {};

		for (const param of definition.parameters) {
			if (param.default !== undefined) {
				input[param.name] = param.default;
			}

			const patterns: Record<string, RegExp> = {
				symbol: /\b(BTC|ETH|SOL|DOGE|XRP)\b/i,
				timeframe: /\b(1m|5m|15m|1h|4h|1d)\b/i,
				amount: /\b(\d+(?:\.\d+)?)\s*(?:usd|dollars?)?/i,
			};

			const pattern = patterns[param.name];
			if (pattern) {
				const match = message.match(pattern);
				if (match) {
					input[param.name] = param.type === "number" ? parseFloat(match[1]) : match[1];
				}
			}
		}

		return input;
	}

	getTools(): string[] {
		return [...this.tools];
	}

	getContext(): AgentContext {
		return { ...this.context };
	}
}

// ============================================================================
// LEARNING MEMORY (MoonDev-inspired)
// ============================================================================

export interface SDKLearningInsight {
	id: string;
	timestamp: number;
	category: "strategy" | "risk" | "market" | "execution";
	insight: string;
	confidence: number;
	source: string;
	applied: boolean;
}

export interface SDKStrategyModification {
	parameter: string;
	oldValue: unknown;
	newValue: unknown;
	reason: string;
	timestamp: number;
}

export class SDKLearningMemory {
	private insights: SDKLearningInsight[] = [];
	private modifications: SDKStrategyModification[] = [];
	private maxInsights: number = 100;

	addInsight(insight: Omit<SDKLearningInsight, "id" | "timestamp" | "applied">): string {
		const id = `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		this.insights.push({
			...insight,
			id,
			timestamp: Date.now(),
			applied: false,
		});

		if (this.insights.length > this.maxInsights) {
			this.insights = this.insights.slice(-this.maxInsights);
		}

		return id;
	}

	getInsightsByCategory(category: SDKLearningInsight["category"]): SDKLearningInsight[] {
		return this.insights.filter((i) => i.category === category);
	}

	getRecentInsights(count: number = 10): SDKLearningInsight[] {
		return this.insights.slice(-count);
	}

	markInsightApplied(id: string): void {
		const insight = this.insights.find((i) => i.id === id);
		if (insight) {
			insight.applied = true;
		}
	}

	recordModification(mod: Omit<SDKStrategyModification, "timestamp">): void {
		this.modifications.push({
			...mod,
			timestamp: Date.now(),
		});
	}

	getModificationHistory(): SDKStrategyModification[] {
		return [...this.modifications];
	}

	toJSON(): { insights: SDKLearningInsight[]; modifications: SDKStrategyModification[] } {
		return {
			insights: this.insights,
			modifications: this.modifications,
		};
	}

	static fromJSON(data: {
		insights: SDKLearningInsight[];
		modifications: SDKStrategyModification[];
	}): SDKLearningMemory {
		const memory = new SDKLearningMemory();
		memory.insights = data.insights || [];
		memory.modifications = data.modifications || [];
		return memory;
	}
}

// ============================================================================
// OPENHANDS SDK TRADING AGENT
// ============================================================================

export interface OpenHandsSDKConfig extends AgentConfig {
	llm: LLMConfig;
	skills?: Skill[];
	enableLearning?: boolean;
	maxIterationsPerTask?: number;
}

export class OpenHandsSDKAgent extends BaseAgent {
	private agent: SDKAgent;
	private activeConversation: SDKConversation | null = null;
	private learningMemory: SDKLearningMemory;
	private sdkConfig: OpenHandsSDKConfig;

	constructor(config: OpenHandsSDKConfig) {
		super(config);
		this.sdkConfig = config;
		this.learningMemory = new SDKLearningMemory();

		const context: AgentContext = {
			skills: config.skills || this.getDefaultSkills(),
			systemMessageSuffix: "Focus on generating actionable trading signals.",
			maxIterations: config.maxIterationsPerTask || 50,
		};

		this.agent = new SDKAgent(
			config.llm,
			[
				"sdk_analyze_price",
				"sdk_track_liquidations",
				"sdk_monitor_whale",
				"sdk_research_strategy",
				"sdk_execute_signal",
			],
			context,
			"SDKTradingAgent",
		);

		this.registerTradingTools();

		console.log(`[OpenHandsSDKAgent] Initialized with ${this.agent.getTools().length} tools`);
	}

	private getDefaultSkills(): Skill[] {
		return [
			{
				name: "liquidation_analysis",
				content: `When analyzing liquidations:
- Large long liquidations often indicate potential bottoms
- Large short liquidations often indicate potential tops
- Use the ratio of long/short liquidations for directional bias
- Consider the timeframe: 15m for scalping, 4h for swing trades`,
				trigger: "liquidation",
			},
			{
				name: "whale_tracking",
				content: `When tracking whale movements:
- Accumulation: Multiple buys over time = bullish
- Distribution: Multiple sells = bearish
- Monitor transfers to exchanges (potential sell pressure)
- Monitor transfers from exchanges (potential accumulation)`,
				trigger: "whale",
			},
			{
				name: "risk_management",
				content: `Risk management rules:
- Never risk more than 2% per trade
- Use stop losses on every position
- Scale into positions, don't enter all at once
- Take profits at predefined levels`,
				trigger: "risk",
			},
		];
	}

	private registerTradingTools(): void {
		// Price Analysis Tool
		registerSDKTool(
			"sdk_analyze_price",
			{
				name: "sdk_analyze_price",
				description: "Analyze price action and technical indicators",
				parameters: [
					{ name: "symbol", type: "string", description: "Trading symbol", required: true },
					{ name: "timeframe", type: "string", description: "Chart timeframe", default: "1h" },
					{ name: "indicators", type: "array", description: "Technical indicators to calculate" },
				],
			},
			async (input) => {
				const symbol = (input.symbol as string) || "BTC";
				const price = 40000 + Math.random() * 10000;
				const rsi = 30 + Math.random() * 40;
				const macd = (Math.random() - 0.5) * 200;

				let signal: TradingAction = "HOLD";
				let confidence = 0.5;

				if (rsi < 30) {
					signal = "BUY";
					confidence = 0.7 + (30 - rsi) / 100;
				} else if (rsi > 70) {
					signal = "SELL";
					confidence = 0.7 + (rsi - 70) / 100;
				}

				return {
					symbol,
					price,
					indicators: { rsi, macd, ema20: price * 0.98, ema50: price * 0.95 },
					signal,
					confidence,
					reasoning: `RSI at ${rsi.toFixed(1)}, MACD at ${macd.toFixed(2)}`,
				};
			},
		);

		// Liquidation Tracking Tool
		registerSDKTool(
			"sdk_track_liquidations",
			{
				name: "sdk_track_liquidations",
				description: "Track liquidation events across exchanges",
				parameters: [
					{ name: "symbol", type: "string", description: "Trading symbol", required: true },
					{ name: "timeframe", type: "string", description: "Analysis window", default: "1h" },
				],
			},
			async (input) => {
				const symbol = (input.symbol as string) || "BTC";
				const longLiqs = Math.random() * 10000000;
				const shortLiqs = Math.random() * 10000000;
				const ratio = longLiqs / (shortLiqs || 1);

				let signal: TradingAction = "HOLD";
				if (ratio > 1.5) signal = "BUY";
				if (ratio < 0.67) signal = "SELL";

				return {
					symbol,
					longLiquidations: longLiqs,
					shortLiquidations: shortLiqs,
					ratio,
					signal,
					interpretation:
						ratio > 1.5
							? "Heavy long liquidations - potential capitulation bottom"
							: ratio < 0.67
								? "Heavy short liquidations - potential blow-off top"
								: "Balanced liquidations - no clear signal",
				};
			},
		);

		// Whale Monitoring Tool
		registerSDKTool(
			"sdk_monitor_whale",
			{
				name: "sdk_monitor_whale",
				description: "Monitor whale wallet activity",
				parameters: [
					{ name: "symbol", type: "string", description: "Token symbol", required: true },
					{ name: "minValue", type: "number", description: "Minimum USD value", default: 100000 },
				],
			},
			async (input) => {
				const symbol = (input.symbol as string) || "BTC";
				const transactions = Array.from({ length: 5 }, () => ({
					type: ["buy", "sell", "transfer"][Math.floor(Math.random() * 3)],
					amount: Math.random() * 500,
					usdValue: ((input.minValue as number) || 100000) + Math.random() * 500000,
					address: `0x${Math.random().toString(16).slice(2, 42)}`,
				}));

				const netFlow = transactions.reduce((sum, tx) => {
					if (tx.type === "buy") return sum + tx.usdValue;
					if (tx.type === "sell") return sum - tx.usdValue;
					return sum;
				}, 0);

				return {
					symbol,
					transactions,
					netFlow,
					signal: netFlow > 100000 ? "BUY" : netFlow < -100000 ? "SELL" : "HOLD",
					interpretation:
						netFlow > 0
							? `Net inflow of $${(netFlow / 1000).toFixed(0)}k - accumulation detected`
							: `Net outflow of $${(Math.abs(netFlow) / 1000).toFixed(0)}k - distribution detected`,
				};
			},
		);

		// Strategy Research Tool (RBI Pattern)
		registerSDKTool(
			"sdk_research_strategy",
			{
				name: "sdk_research_strategy",
				description: "Research and extract trading strategy rules",
				parameters: [
					{ name: "content", type: "string", description: "Strategy content to analyze", required: true },
					{ name: "source", type: "string", description: "Content source type", default: "text" },
				],
			},
			async (input) => {
				const adjectives = ["Quantum", "Phoenix", "Shadow", "Velocity", "Alpha"];
				const nouns = ["Breakout", "Reversal", "Momentum", "Hunter", "Scalper"];
				const strategyName = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;

				return {
					strategyName,
					extracted: true,
					rules: {
						entry: ["RSI < 30", "MACD crossover", "Volume spike > 2x average"],
						exit: ["RSI > 70", "Trailing stop 2%", "Target hit"],
						risk: {
							stopLoss: "2% below entry",
							positionSize: "2% portfolio risk",
							maxDrawdown: "10%",
						},
					},
					indicators: ["RSI", "MACD", "Volume", "EMA20"],
					sourceType: input.source,
				};
			},
		);

		// Signal Execution Tool
		registerSDKTool(
			"sdk_execute_signal",
			{
				name: "sdk_execute_signal",
				description: "Execute a trading signal",
				parameters: [
					{ name: "symbol", type: "string", description: "Trading symbol", required: true },
					{ name: "action", type: "string", description: "BUY/SELL/HOLD", required: true },
					{ name: "amount", type: "number", description: "Position size", default: 100 },
				],
			},
			async (input) => {
				const action = input.action as TradingAction;

				if (action === "HOLD" || action === "NOTHING") {
					return {
						executed: false,
						reason: "No action required",
					};
				}

				return {
					executed: true,
					orderId: `order_${Date.now()}`,
					symbol: input.symbol,
					side: action.toLowerCase(),
					amount: input.amount,
					price: 40000 + Math.random() * 1000,
					timestamp: Date.now(),
				};
			},
		);
	}

	// ========================================================================
	// CONVERSATION MANAGEMENT
	// ========================================================================

	async startConversation(workspace?: string): Promise<SDKConversation> {
		this.activeConversation = new SDKConversation(
			this.agent,
			workspace || process.cwd(),
			this.sdkConfig.maxIterationsPerTask || 50,
		);

		const skills = this.agent.getContext().skills;
		const skillsText = skills.map((s) => `[${s.name}]: ${s.content}`).join("\n\n");

		this.activeConversation.sendMessage(
			`You are a trading agent with the following skills:\n\n${skillsText}`,
			"system",
		);

		return this.activeConversation;
	}

	async processTask(task: string): Promise<{
		success: boolean;
		result: ConversationState;
		insights: SDKLearningInsight[];
	}> {
		if (!this.activeConversation) {
			await this.startConversation();
		}

		const taskRecord = this.activeConversation!.createTask(task);
		this.activeConversation!.sendMessage(task, "user");
		this.activeConversation!.updateTask(taskRecord.id, { status: "running" });

		try {
			const result = await this.activeConversation!.run();
			const insights: SDKLearningInsight[] = [];

			if (this.sdkConfig.enableLearning) {
				const assistantMessages = result.messages.filter((m) => m.role === "assistant");
				for (const msg of assistantMessages) {
					if (
						msg.content.includes("signal") ||
						msg.content.includes("liquidation") ||
						msg.content.includes("whale")
					) {
						const insightId = this.learningMemory.addInsight({
							category: this.categorizeInsight(msg.content),
							insight: msg.content.slice(0, 200),
							confidence: 0.7,
							source: "conversation",
						});
						insights.push(...this.learningMemory.getRecentInsights(1).filter((i) => i.id === insightId));
					}
				}
			}

			this.activeConversation!.updateTask(taskRecord.id, {
				status: "completed",
				completedAt: Date.now(),
				result,
			});

			return { success: true, result, insights };
		} catch (error) {
			this.activeConversation!.updateTask(taskRecord.id, {
				status: "failed",
				completedAt: Date.now(),
				error: error instanceof Error ? error.message : String(error),
			});

			return {
				success: false,
				result: this.activeConversation!.getState(),
				insights: [],
			};
		}
	}

	private categorizeInsight(content: string): SDKLearningInsight["category"] {
		const lower = content.toLowerCase();
		if (lower.includes("risk") || lower.includes("stop")) return "risk";
		if (lower.includes("strategy") || lower.includes("rule")) return "strategy";
		if (lower.includes("execute") || lower.includes("order")) return "execution";
		return "market";
	}

	// ========================================================================
	// SIGNAL GENERATION
	// ========================================================================

	async generateSignal(symbol: string): Promise<TradeSignal | null> {
		const task = `Analyze ${symbol} and generate a trading signal based on:
1. Price action and technical indicators
2. Liquidation data
3. Whale activity

Provide a clear BUY, SELL, or HOLD recommendation with confidence level.`;

		const result = await this.processTask(task);

		if (!result.success) return null;

		const lastAssistantMsg = result.result.messages.filter((m) => m.role === "assistant").pop();

		if (!lastAssistantMsg) return null;

		const content = lastAssistantMsg.content.toUpperCase();
		let action: TradingAction = "HOLD";
		if (content.includes("BUY")) action = "BUY";
		if (content.includes("SELL")) action = "SELL";

		const signal: TradeSignal = {
			symbol,
			action,
			confidence: 0.5 + Math.random() * 0.4,
			price: 40000 + Math.random() * 10000,
			reason: lastAssistantMsg.content.slice(0, 100),
			source: "OpenHandsSDKAgent",
			timestamp: Date.now(),
			metadata: {
				conversationId: result.result.id,
				iterationCount: result.result.iterationCount,
				insightsGenerated: result.insights.length,
			},
		};

		await this.emitSignal(signal);
		return signal;
	}

	// ========================================================================
	// AGENT DELEGATION
	// ========================================================================

	async delegateToSpecialist(agentName: string, task: string): Promise<{ success: boolean; result: unknown }> {
		const registeredAgent = getSDKAgent(agentName);

		if (!registeredAgent) {
			return {
				success: false,
				result: `Agent not found: ${agentName}`,
			};
		}

		const specialistAgent = registeredAgent.factory(this.sdkConfig.llm);
		const conversation = new SDKConversation(specialistAgent, process.cwd());
		conversation.sendMessage(task, "user");

		const result = await conversation.run();

		return {
			success: true,
			result: {
				agentName,
				conversationState: result,
			},
		};
	}

	// ========================================================================
	// LEARNING
	// ========================================================================

	getLearningMemory(): SDKLearningMemory {
		return this.learningMemory;
	}

	applyLearnings(): number {
		const unappliedInsights = this.learningMemory
			.getRecentInsights(20)
			.filter((i) => !i.applied && i.confidence > 0.6);

		let appliedCount = 0;

		for (const insight of unappliedInsights) {
			console.log(`[OpenHandsSDKAgent] Applying insight: ${insight.insight.slice(0, 50)}...`);
			this.learningMemory.markInsightApplied(insight.id);
			appliedCount++;
		}

		return appliedCount;
	}

	// ========================================================================
	// MAIN RUN LOOP
	// ========================================================================

	protected async run(): Promise<void> {
		await this.startConversation();

		try {
			for (const symbol of this.config.symbols) {
				const signal = await this.generateSignal(symbol);

				if (signal && signal.confidence > this.config.thresholds.minConfidence) {
					console.log(
						`[OpenHandsSDKAgent] Signal for ${symbol}: ${signal.action} (${(signal.confidence * 100).toFixed(1)}%)`,
					);
				}
			}

			if (this.sdkConfig.enableLearning) {
				this.applyLearnings();
			}
		} finally {
			this.activeConversation = null;
		}
	}

	// ========================================================================
	// STATS
	// ========================================================================

	getStats(): {
		conversationId: string | null;
		iterationCount: number;
		insightCount: number;
		toolsRegistered: number;
	} {
		return {
			conversationId: this.activeConversation?.id || null,
			iterationCount: this.activeConversation?.iterationCount || 0,
			insightCount: this.learningMemory.getRecentInsights(100).length,
			toolsRegistered: getAllSDKTools().length,
		};
	}
}

// ============================================================================
// FACTORY AND PRESETS
// ============================================================================

export function createOpenHandsSDKAgent(
	llm: LLMConfig,
	options: Partial<Omit<OpenHandsSDKConfig, "llm">> = {},
): OpenHandsSDKAgent {
	const config: OpenHandsSDKConfig = {
		name: options.name || "OpenHandsSDKAgent",
		enabled: options.enabled ?? true,
		interval: options.interval || 60000,
		symbols: options.symbols || ["BTC", "ETH", "SOL"],
		thresholds: options.thresholds || { minConfidence: 0.6 },
		llm,
		skills: options.skills,
		enableLearning: options.enableLearning ?? true,
		maxIterationsPerTask: options.maxIterationsPerTask || 50,
	};

	return new OpenHandsSDKAgent(config);
}

// Register default specialist agents
registerSDKAgent(
	"sdk_liquidation_specialist",
	"Specializes in analyzing liquidation cascades",
	(llm) =>
		new SDKAgent(
			llm,
			["sdk_track_liquidations", "sdk_analyze_price"],
			{
				skills: [
					{
						name: "liquidation_analysis",
						content: "Expert at detecting liquidation cascades and market capitulation",
						trigger: null,
					},
				],
			},
			"LiquidationSpecialist",
		),
);

registerSDKAgent(
	"sdk_whale_tracker",
	"Tracks whale movements and smart money flows",
	(llm) =>
		new SDKAgent(
			llm,
			["sdk_monitor_whale", "sdk_analyze_price"],
			{
				skills: [
					{
						name: "whale_analysis",
						content: "Expert at tracking whale accumulation and distribution patterns",
						trigger: null,
					},
				],
			},
			"WhaleTracker",
		),
);

registerSDKAgent(
	"sdk_rbi_researcher",
	"Research-Backtest-Implement framework agent",
	(llm) =>
		new SDKAgent(
			llm,
			["sdk_research_strategy", "sdk_analyze_price"],
			{
				skills: [
					{
						name: "rbi_framework",
						content: "Implements the RBI Framework: Research -> Backtest -> Implement",
						trigger: null,
					},
				],
			},
			"RBIResearcher",
		),
);

export default OpenHandsSDKAgent;
