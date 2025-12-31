/**
 * Trading Agent Orchestrator
 * Coordinates all trading agents and manages signal flow
 * Inspired by Moon Dev's multi-agent architecture
 *
 * Now includes:
 * - Claude SDK Trading Agent (hooks, session management, subagent delegation)
 * - OpenHands SDK Agent (conversation pattern, tool registry, learning)
 * - StatefulAgent integration (persistent state, checkpoint/restore)
 * - WorkflowChains (multi-step trading pipeline with failure recovery)
 */

import type { Client, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { createPipeline, type PipelineResult } from "../agents/parallel-patterns.js";
import {
	getResearchOrchestrator,
	type ResearchCycleResult,
	type ResearchOrchestrator,
} from "../agents/research-orchestrator.js";
import {
	type CheckpointResult,
	getStatefulAgent,
	type RestoreResult,
	type StatefulAgent,
} from "../agents/stateful-agent.js";
import { type StepExecutor, type Workflow, type WorkflowContext, workflow } from "../agents/workflow-chains.js";
import { getDatabase } from "../database.js";
import {
	getAgentPoolManager,
	type OrchestrationMode,
	type PoolType,
	type Task,
	type TaskResult,
} from "./agent-pools.js";
import {
	type ClaudeSDKTradingAgent,
	createClaudeSDKTradingAgent,
	type HookDefinitions,
} from "./agents/claude-sdk-trading-agent.js";
import { createOpenHandsSDKAgent, type LLMConfig, type OpenHandsSDKAgent } from "./agents/openhands-sdk-agent.js";
import { PriceAgent } from "./agents/price-agent.js";
import { SentimentAgent } from "./agents/sentiment-agent.js";
import { WhaleAgent } from "./agents/whale-agent.js";
import type { AgentCostEvent, BaseAgent } from "./base-agent.js";
import { ConsensusEngine } from "./consensus.js";
import { type AgentCost, getAgentCostTracker } from "./cost-tracker.js";
import type { ConsensusResult, PriceData, SentimentData, TradeSignal } from "./types.js";

/** Market data collected for analysis */
interface MarketDataResult {
	price: PriceData;
	sentiment: SentimentData | null;
	whaleActivity: WhaleActivitySummary;
}

/** Pattern analysis results */
interface PatternResult {
	trends: string[];
	indicators: Record<string, number>;
	confidence: number;
}

/** Risk assessment result */
interface RiskAssessmentResult {
	approved: boolean;
	riskScore: number;
	finalSignal: TradeSignal | null;
	reason: string;
}

/** Whale activity summary - matches WhaleAgent.getActivitySummary() return type */
interface WhaleActivitySummary {
	totalBuyVolume: number;
	totalSellVolume: number;
	netFlow: number;
	movementCount: number;
}

/** Agent stats shape */
interface AgentStats {
	enabled: boolean;
	lastRun?: number;
	signalsGenerated?: number;
	errorCount?: number;
}

/** Checkpoint entry from stateful agent */
interface CheckpointEntry {
	id: string;
	timestamp: number;
	label?: string;
	tags?: string[];
}

interface OrchestratorConfig {
	enabled: boolean;
	signalChannelId?: string;
	alertChannelId?: string;
	useConsensus: boolean;
	minSignalConfidence: number;
	// Advanced agents configuration
	enableClaudeSDKAgent?: boolean;
	enableOpenHandsSDKAgent?: boolean;
	llmConfig?: LLMConfig;
	claudeHooks?: Partial<HookDefinitions>;
	// Stateful agent configuration
	enableStatefulAgents?: boolean;
	enableWorkflows?: boolean;
	cwd?: string;
	dataDir?: string;
	autoCheckpoint?: boolean;
}

export class TradingOrchestrator {
	private config: OrchestratorConfig;
	private client: Client | null = null;
	private agents: Map<string, BaseAgent> = new Map();
	private consensus: ConsensusEngine;
	private signalHistory: TradeSignal[] = [];
	private readonly MAX_HISTORY = 500;

	// Core agent instances
	public priceAgent: PriceAgent;
	public sentimentAgent: SentimentAgent;
	public whaleAgent: WhaleAgent;

	// Advanced SDK agents
	public claudeSDKAgent: ClaudeSDKTradingAgent | null = null;
	public openHandsSDKAgent: OpenHandsSDKAgent | null = null;

	// Stateful agents for persistent state
	private statefulAgents: Map<string, StatefulAgent> = new Map();
	private orchestratorAgent: StatefulAgent | null = null;

	// Trading workflow
	private tradingWorkflow: Workflow | null = null;
	private currentWorkflowSession: string | null = null;

	// Agent pool management and cost tracking
	private poolManager = getAgentPoolManager();
	private costTracker = getAgentCostTracker();

	// Research orchestrator integration
	private researchOrchestrator: ResearchOrchestrator | null = null;
	private researchInsights: ResearchCycleResult[] = [];
	private readonly MAX_RESEARCH_INSIGHTS = 100;

	constructor(config: Partial<OrchestratorConfig> = {}) {
		this.config = {
			enabled: true,
			useConsensus: true,
			minSignalConfidence: 0.6,
			enableClaudeSDKAgent: false,
			enableOpenHandsSDKAgent: false,
			enableStatefulAgents: true,
			enableWorkflows: true,
			cwd: process.cwd(),
			autoCheckpoint: true,
			...config,
		};

		// Initialize core agents
		this.priceAgent = new PriceAgent();
		this.sentimentAgent = new SentimentAgent();
		this.whaleAgent = new WhaleAgent();

		// Register core agents
		this.agents.set("price", this.priceAgent);
		this.agents.set("sentiment", this.sentimentAgent);
		this.agents.set("whale", this.whaleAgent);

		// Assign agents to pools
		this.poolManager.assignToPool(this.priceAgent, "scouts");
		this.poolManager.assignToPool(this.sentimentAgent, "scouts");
		this.poolManager.assignToPool(this.whaleAgent, "scouts");

		// Initialize advanced SDK agents if enabled
		this.initializeAdvancedAgents();

		// Initialize stateful agents
		this.initializeStatefulAgents();

		// Initialize trading workflow
		this.initializeTradingWorkflow();

		// Initialize consensus engine
		this.consensus = new ConsensusEngine();

		// Wire up signal handlers and cost tracking
		this.setupSignalHandlers();
		this.setupCostTracking();
	}

	private initializeAdvancedAgents(): void {
		// Claude SDK Trading Agent (hooks, session management, subagents)
		if (this.config.enableClaudeSDKAgent) {
			this.claudeSDKAgent = createClaudeSDKTradingAgent({
				name: "ClaudeSDKAgent",
				enabled: true,
				interval: 120000, // 2 minutes
				symbols: ["BTC", "ETH", "SOL"],
				thresholds: { minConfidence: this.config.minSignalConfidence },
				sessionPersistence: true,
				maxTurnsPerSession: 50,
				delegationEnabled: true,
				hooks: this.config.claudeHooks,
			});
			this.agents.set("claudeSDK", this.claudeSDKAgent);
			console.log("[Orchestrator] Claude SDK Trading Agent initialized");
		}

		// OpenHands SDK Agent (conversation, tools, learning)
		if (this.config.enableOpenHandsSDKAgent && this.config.llmConfig) {
			this.openHandsSDKAgent = createOpenHandsSDKAgent(this.config.llmConfig, {
				name: "OpenHandsSDKAgent",
				enabled: true,
				interval: 120000, // 2 minutes
				symbols: ["BTC", "ETH", "SOL"],
				thresholds: { minConfidence: this.config.minSignalConfidence },
				enableLearning: true,
				maxIterationsPerTask: 30,
			});
			this.agents.set("openHandsSDK", this.openHandsSDKAgent);
			console.log("[Orchestrator] OpenHands SDK Agent initialized");
		}
	}

	private setupSignalHandlers(): void {
		const handleSignal = async (signal: TradeSignal) => {
			await this.processSignal(signal);
		};

		for (const agent of this.agents.values()) {
			agent.onSignal(handleSignal);
		}
	}

	/**
	 * Set up cost tracking for all agents
	 */
	private setupCostTracking(): void {
		for (const [name, agent] of this.agents) {
			// Listen for cost events from agents
			agent.on("cost", (costEvent: AgentCostEvent) => {
				// Determine pool type for this agent
				let poolType: PoolType = "scouts"; // default
				const pools = this.poolManager.getAllPools();

				for (const [pType, agents] of Object.entries(pools) as [PoolType, BaseAgent[]][]) {
					if (agents.some((a) => a.name === name)) {
						poolType = pType;
						break;
					}
				}

				// Track cost
				this.costTracker.track(name, poolType, {
					inputTokens: costEvent.inputTokens,
					outputTokens: costEvent.outputTokens,
					apiCalls: costEvent.apiCalls,
					totalCost: costEvent.totalCost,
					modelUsed: costEvent.modelUsed,
					taskId: costEvent.taskId,
					metadata: costEvent.metadata,
				});

				// Persist to database
				try {
					const db = getDatabase();
					db.saveAgentCost({
						id: `cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
						agent_id: name,
						pool_type: poolType,
						timestamp: costEvent.timestamp,
						input_tokens: costEvent.inputTokens,
						output_tokens: costEvent.outputTokens,
						api_calls: costEvent.apiCalls,
						total_cost: costEvent.totalCost || 0,
						model_used: costEvent.modelUsed || null,
						task_id: costEvent.taskId || null,
						roi: null,
						metadata: costEvent.metadata ? JSON.stringify(costEvent.metadata) : null,
					});
				} catch (error) {
					console.error("[Orchestrator] Failed to save cost to database:", error);
				}
			});
		}

		// Listen for cost alerts
		this.costTracker.on("alert", (alert) => {
			console.warn(`[Orchestrator] Cost Alert: ${alert.message}`);
			// Could send to Discord channel if configured
		});
	}

	/**
	 * Initialize stateful agents for persistent state management
	 */
	private initializeStatefulAgents(): void {
		if (!this.config.enableStatefulAgents) {
			return;
		}

		// Orchestrator agent - manages overall trading session state
		this.orchestratorAgent = getStatefulAgent({
			id: "trading-orchestrator",
			cwd: this.config.cwd,
			dataDir: this.config.dataDir,
			autoCheckpoint: this.config.autoCheckpoint,
		});

		// Data collector agent
		this.statefulAgents.set(
			"data-collector",
			getStatefulAgent({
				id: "data-collector",
				cwd: this.config.cwd,
				dataDir: this.config.dataDir,
				autoCheckpoint: this.config.autoCheckpoint,
			}),
		);

		// Pattern analyzer agent
		this.statefulAgents.set(
			"pattern-analyzer",
			getStatefulAgent({
				id: "pattern-analyzer",
				cwd: this.config.cwd,
				dataDir: this.config.dataDir,
				autoCheckpoint: this.config.autoCheckpoint,
			}),
		);

		// Signal generator agent
		this.statefulAgents.set(
			"signal-generator",
			getStatefulAgent({
				id: "signal-generator",
				cwd: this.config.cwd,
				dataDir: this.config.dataDir,
				autoCheckpoint: this.config.autoCheckpoint,
			}),
		);

		// Risk assessor agent
		this.statefulAgents.set(
			"risk-assessor",
			getStatefulAgent({
				id: "risk-assessor",
				cwd: this.config.cwd,
				dataDir: this.config.dataDir,
				autoCheckpoint: this.config.autoCheckpoint,
			}),
		);

		console.log("[Orchestrator] Stateful agents initialized");
	}

	/**
	 * Initialize trading workflow with multi-step pipeline
	 */
	private initializeTradingWorkflow(): void {
		if (!this.config.enableWorkflows) {
			return;
		}

		let workflowBuilder = workflow("trading-pipeline")
			.step({
				agent: "data-collector",
				output: "market_data",
				task: "Collect market data (price, volume, indicators)",
				timeout: 30000,
				retries: 2,
			})
			.step({
				agent: "pattern-analyzer",
				input: "market_data",
				output: "patterns",
				task: "Analyze patterns and trends",
				timeout: 45000,
				retries: 1,
			})
			.step({
				agent: "signal-generator",
				input: "patterns",
				output: "signals",
				task: "Generate trading signals",
				timeout: 30000,
				retries: 1,
			})
			.step({
				agent: "risk-assessor",
				input: "signals",
				output: "trade_plan",
				task: "Assess risk and finalize trade plan",
				timeout: 30000,
				retries: 2,
			})
			.cwd(this.config.cwd || process.cwd());

		// Conditionally set dataDir only if provided
		if (this.config.dataDir) {
			workflowBuilder = workflowBuilder.dataDir(this.config.dataDir);
		}

		this.tradingWorkflow = workflowBuilder
			.autoCheckpoint(this.config.autoCheckpoint ?? true)
			.continueOnError(false)
			.timeout(180000) // 3 minutes max
			.build();

		// Set up event handlers
		this.tradingWorkflow.on("start", (wf) => {
			console.log(`[Orchestrator] Trading workflow started: ${wf.id}`);
			this.currentWorkflowSession = wf.id;
		});

		this.tradingWorkflow.on("stepStart", (step, context) => {
			console.log(`[Orchestrator] Step started: ${step.id} (${context.currentStep + 1}/${context.totalSteps})`);
		});

		this.tradingWorkflow.on("stepComplete", (step, result, _context) => {
			console.log(`[Orchestrator] Step completed: ${step.id} - Status: ${result.status}`);
		});

		this.tradingWorkflow.on("stepError", (step, error, _context) => {
			console.error(`[Orchestrator] Step error: ${step.id}`, error);
		});

		this.tradingWorkflow.on("complete", (wf, context) => {
			console.log(`[Orchestrator] Trading workflow completed: ${wf.id}`);
			console.log(`[Orchestrator] Final trade plan:`, context.data.trade_plan);
		});

		this.tradingWorkflow.on("error", (_wf, error) => {
			console.error(`[Orchestrator] Workflow error:`, error);
		});

		this.tradingWorkflow.on("pause", (wf) => {
			console.log(`[Orchestrator] Workflow paused: ${wf.id}`);
		});

		this.tradingWorkflow.on("resume", (wf) => {
			console.log(`[Orchestrator] Workflow resumed: ${wf.id}`);
		});

		this.tradingWorkflow.on("cancel", (wf) => {
			console.log(`[Orchestrator] Workflow cancelled: ${wf.id}`);
		});

		console.log("[Orchestrator] Trading workflow initialized");
	}

	/**
	 * Set Discord client for sending alerts
	 */
	setClient(client: Client): void {
		this.client = client;
	}

	/**
	 * Start all trading agents
	 */
	async start(): Promise<void> {
		if (!this.config.enabled) {
			console.log("[Orchestrator] Trading agents disabled");
			return;
		}

		console.log("[Orchestrator] Starting trading agents...");

		for (const [name, agent] of this.agents) {
			if (agent.isEnabled) {
				await agent.start();
				console.log(`[Orchestrator] Started ${name} agent`);
			}
		}

		console.log("[Orchestrator] All trading agents started");
	}

	/**
	 * Stop all trading agents
	 */
	async stop(): Promise<void> {
		console.log("[Orchestrator] Stopping trading agents...");

		for (const [name, agent] of this.agents) {
			await agent.stop();
			console.log(`[Orchestrator] Stopped ${name} agent`);
		}
	}

	/**
	 * Process incoming signal from any agent
	 */
	private async processSignal(signal: TradeSignal): Promise<void> {
		// Store in history
		this.signalHistory.push(signal);
		while (this.signalHistory.length > this.MAX_HISTORY) {
			this.signalHistory.shift();
		}

		// Filter low confidence signals
		if (signal.confidence < this.config.minSignalConfidence) {
			return;
		}

		// Optionally run through consensus for high-value signals
		if (this.config.useConsensus && signal.action !== "HOLD") {
			const priceData = await this.priceAgent.getPrice(signal.symbol);
			if (priceData) {
				const sentiment = await this.sentimentAgent.getSentiment(signal.symbol);
				const consensusResult = await this.consensus.getConsensus(
					signal.symbol,
					priceData,
					sentiment || undefined,
					`Original signal: ${signal.reason}`,
				);

				// Update signal with consensus
				signal = {
					...signal,
					action: consensusResult.action,
					confidence: consensusResult.confidence,
					reason: `Consensus: ${consensusResult.votes.map((v) => `${v.model}:${v.action}`).join(", ")}`,
					metadata: {
						...signal.metadata,
						consensus: consensusResult,
					},
				};
			}
		}

		// Send to Discord if configured
		await this.sendSignalToDiscord(signal);
	}

	/**
	 * Send signal to Discord channel
	 */
	private async sendSignalToDiscord(signal: TradeSignal): Promise<void> {
		if (!this.client || !this.config.signalChannelId) {
			return;
		}

		try {
			const channel = await this.client.channels.fetch(this.config.signalChannelId);
			if (!channel || !channel.isTextBased()) return;

			const embed = this.createSignalEmbed(signal);
			await (channel as TextChannel).send({ embeds: [embed] });
		} catch (error) {
			console.error("[Orchestrator] Failed to send signal to Discord:", error);
		}
	}

	private createSignalEmbed(signal: TradeSignal): EmbedBuilder {
		const colors: Record<string, number> = {
			BUY: 0x00ff00, // Green
			SELL: 0xff0000, // Red
			HOLD: 0xffff00, // Yellow
			NOTHING: 0x808080, // Gray
		};

		const emojis: Record<string, string> = {
			BUY: "🟢",
			SELL: "🔴",
			HOLD: "🟡",
			NOTHING: "⚪",
		};

		const embed = new EmbedBuilder()
			.setTitle(`${emojis[signal.action]} Trading Signal: ${signal.symbol}`)
			.setColor(colors[signal.action] || 0x808080)
			.addFields(
				{ name: "Action", value: signal.action, inline: true },
				{ name: "Confidence", value: `${(signal.confidence * 100).toFixed(1)}%`, inline: true },
				{ name: "Source", value: signal.source, inline: true },
				{ name: "Reason", value: signal.reason.slice(0, 1024) },
			)
			.setTimestamp(signal.timestamp);

		if (signal.price > 0) {
			embed.addFields({ name: "Price", value: `$${signal.price.toLocaleString()}`, inline: true });
		}

		return embed;
	}

	/**
	 * Get consensus analysis for a symbol
	 */
	async getConsensusAnalysis(symbol: string): Promise<ConsensusResult | null> {
		const priceData = await this.priceAgent.getPrice(symbol);
		if (!priceData) return null;

		const sentiment = await this.sentimentAgent.getSentiment(symbol);
		return this.consensus.getConsensus(symbol, priceData, sentiment || undefined);
	}

	/**
	 * Get quick AI analysis (single model, faster)
	 */
	async getQuickAnalysis(symbol: string): Promise<TradeSignal | null> {
		const priceData = await this.priceAgent.getPrice(symbol);
		if (!priceData) return null;

		const sentiment = await this.sentimentAgent.getSentiment(symbol);
		return this.consensus.quickAnalysis(symbol, priceData, sentiment || undefined);
	}

	/**
	 * Get recent signals
	 */
	getRecentSignals(limit = 20, symbol?: string): TradeSignal[] {
		let signals = [...this.signalHistory].reverse();

		if (symbol) {
			signals = signals.filter((s) => s.symbol === symbol);
		}

		return signals.slice(0, limit);
	}

	/**
	 * Get agent stats
	 */
	getStats(): { enabled: boolean; agents: Record<string, AgentStats>; totalSignals: number } {
		const stats: { enabled: boolean; agents: Record<string, AgentStats>; totalSignals: number } = {
			enabled: this.config.enabled,
			agents: {},
			totalSignals: this.signalHistory.length,
		};

		for (const [name, agent] of this.agents) {
			stats.agents[name] = {
				enabled: agent.isEnabled,
				...agent.stats,
			};
		}

		return stats;
	}

	/**
	 * Get market summary
	 */
	async getMarketSummary(symbols: string[] = ["BTC", "ETH", "SOL"]): Promise<{
		prices: Record<string, PriceData>;
		sentiment: Record<string, SentimentData>;
		whaleActivity: WhaleActivitySummary;
		signals: TradeSignal[];
	}> {
		const prices: Record<string, PriceData> = {};
		const sentiment: Record<string, SentimentData> = {};

		for (const symbol of symbols) {
			const priceData = await this.priceAgent.getPrice(symbol);
			if (priceData) prices[symbol] = priceData;

			const sentimentData = await this.sentimentAgent.getSentiment(symbol);
			if (sentimentData) sentiment[symbol] = sentimentData;
		}

		return {
			prices,
			sentiment,
			whaleActivity: this.whaleAgent.getActivitySummary(),
			signals: this.getRecentSignals(10),
		};
	}

	// ========================================================================
	// PARALLEL FAN-OUT ANALYSIS (GLM-4.7 Dec 2025 Upgrade)
	// ========================================================================

	/**
	 * Run all agents in parallel using fan-out pattern
	 * Significantly faster than sequential execution
	 */
	async runParallelAnalysis(symbol: string): Promise<{
		success: boolean;
		timing: { total: number; agents: Record<string, number> };
		price: PriceData | null;
		sentiment: SentimentData | null;
		whaleActivity: WhaleActivitySummary;
		consensus: ConsensusResult | null;
	}> {
		const startTime = Date.now();
		const agentTiming: Record<string, number> = {};

		console.log(`[Orchestrator] Running parallel analysis for ${symbol}`);

		// Execute all agents in parallel
		const [priceResult, sentimentResult, whaleResult] = await Promise.all([
			(async () => {
				const start = Date.now();
				const data = await this.priceAgent.getPrice(symbol);
				agentTiming.price = Date.now() - start;
				return data;
			})(),
			(async () => {
				const start = Date.now();
				const data = await this.sentimentAgent.getSentiment(symbol);
				agentTiming.sentiment = Date.now() - start;
				return data;
			})(),
			(async () => {
				const start = Date.now();
				const data = this.whaleAgent.getActivitySummary();
				agentTiming.whale = Date.now() - start;
				return data;
			})(),
		]);

		// Synthesize consensus (gather phase)
		const consensusStart = Date.now();
		let consensus: ConsensusResult | null = null;
		if (priceResult) {
			consensus = await this.consensus.getConsensus(symbol, priceResult, sentimentResult || undefined);
		}
		agentTiming.consensus = Date.now() - consensusStart;

		const totalTime = Date.now() - startTime;
		console.log(`[Orchestrator] Parallel analysis complete in ${totalTime}ms`);

		return {
			success: priceResult !== null,
			timing: { total: totalTime, agents: agentTiming },
			price: priceResult,
			sentiment: sentimentResult,
			whaleActivity: whaleResult,
			consensus,
		};
	}

	/**
	 * Run parallel analysis for multiple symbols simultaneously
	 */
	async runMultiSymbolParallel(symbols: string[]): Promise<
		Map<
			string,
			{
				price: PriceData | null;
				sentiment: SentimentData | null;
				consensus: ConsensusResult | null;
			}
		>
	> {
		const results = new Map<
			string,
			{
				price: PriceData | null;
				sentiment: SentimentData | null;
				consensus: ConsensusResult | null;
			}
		>();

		const startTime = Date.now();
		console.log(`[Orchestrator] Running multi-symbol parallel analysis for ${symbols.join(", ")}`);

		// Run all symbol analyses in parallel
		const analyses = await Promise.all(
			symbols.map(async (symbol) => {
				const analysis = await this.runParallelAnalysis(symbol);
				return { symbol, analysis };
			}),
		);

		for (const { symbol, analysis } of analyses) {
			results.set(symbol, {
				price: analysis.price,
				sentiment: analysis.sentiment,
				consensus: analysis.consensus,
			});
		}

		console.log(`[Orchestrator] Multi-symbol analysis complete in ${Date.now() - startTime}ms`);
		return results;
	}

	/**
	 * Run trading pipeline using sequential pattern
	 * Data Collection → Pattern Analysis → Signal Generation → Risk Assessment
	 */
	async runTradingPipeline(symbol: string): Promise<PipelineResult<TradeSignal | null>> {
		const pipeline = createPipeline<TradeSignal | null>();

		// Step 1: Data Collection
		pipeline.addStep({
			id: "collect",
			name: "Data Collection",
			outputKey: "market_data",
			execute: async () => {
				const [price, sentiment] = await Promise.all([
					this.priceAgent.getPrice(symbol),
					this.sentimentAgent.getSentiment(symbol),
				]);
				return { price, sentiment, whale: this.whaleAgent.getActivitySummary() };
			},
		});

		// Step 2: Pattern Analysis
		pipeline.addStep({
			id: "analyze",
			name: "Pattern Analysis",
			outputKey: "patterns",
			execute: async (data: any, _ctx) => {
				if (!data?.price) return null;
				// Use consensus engine for pattern analysis
				const consensus = await this.consensus.getConsensus(symbol, data.price, data.sentiment || undefined);
				return consensus;
			},
		});

		// Step 3: Signal Generation
		pipeline.addStep({
			id: "generate",
			name: "Signal Generation",
			outputKey: "signal",
			execute: async (consensus: ConsensusResult | null) => {
				if (!consensus) return null;
				// Convert consensus to trade signal
				const signal: TradeSignal = {
					symbol,
					action: consensus.action,
					confidence: consensus.confidence,
					price: 0, // Will be populated by price agent data
					reason:
						consensus.votes[0]?.reasoning ||
						`Consensus: ${consensus.action} with ${(consensus.confidence * 100).toFixed(1)}% confidence`,
					timestamp: Date.now(),
					source: "pipeline",
				};
				return signal;
			},
		});

		// Step 4: Risk Assessment
		pipeline.addStep({
			id: "risk",
			name: "Risk Assessment",
			execute: async (signal: TradeSignal | null) => {
				if (!signal || signal.action === "HOLD") return signal;
				// Filter low-confidence signals
				if (signal.confidence < this.config.minSignalConfidence) {
					console.log(
						`[Pipeline] Signal filtered: confidence ${signal.confidence} < ${this.config.minSignalConfidence}`,
					);
					return null;
				}
				return signal;
			},
		});

		return pipeline.execute({});
	}

	// ========================================================================
	// ADVANCED SDK AGENT METHODS
	// ========================================================================

	/**
	 * Run Claude SDK agent analysis with hooks
	 */
	async runClaudeSDKAnalysis(symbol: string): Promise<TradeSignal | null> {
		if (!this.claudeSDKAgent) {
			console.log("[Orchestrator] Claude SDK Agent not enabled");
			return null;
		}

		try {
			return await this.claudeSDKAgent.generateSignal(symbol, ["liquidation", "market", "whale"]);
		} catch (error) {
			console.error("[Orchestrator] Claude SDK analysis error:", error);
			return null;
		}
	}

	/**
	 * Run OpenHands SDK agent with conversation
	 */
	async runOpenHandsSDKTask(task: string): Promise<{
		success: boolean;
		conversationId: string | null;
		insights: number;
	}> {
		if (!this.openHandsSDKAgent) {
			console.log("[Orchestrator] OpenHands SDK Agent not enabled");
			return { success: false, conversationId: null, insights: 0 };
		}

		try {
			const result = await this.openHandsSDKAgent.processTask(task);
			return {
				success: result.success,
				conversationId: result.result.id,
				insights: result.insights.length,
			};
		} catch (error) {
			console.error("[Orchestrator] OpenHands SDK task error:", error);
			return { success: false, conversationId: null, insights: 0 };
		}
	}

	/**
	 * Run RBI workflow through Claude SDK agent
	 */
	async runRBIWorkflow(
		content: string,
		source: "youtube" | "pdf" | "text",
	): Promise<{
		strategyName: string;
		backtestValid: boolean;
		sharpeRatio: number;
		signal: TradeSignal | null;
	} | null> {
		if (!this.claudeSDKAgent) {
			console.log("[Orchestrator] Claude SDK Agent not enabled for RBI workflow");
			return null;
		}

		try {
			const result = await this.claudeSDKAgent.runRBIWorkflow(content, source);
			return {
				strategyName: result.research.strategyName,
				backtestValid: result.backtest.valid,
				sharpeRatio: result.backtest.sharpeRatio,
				signal: result.signal,
			};
		} catch (error) {
			console.error("[Orchestrator] RBI workflow error:", error);
			return null;
		}
	}

	/**
	 * Delegate to a specialist subagent
	 */
	async delegateToSubagent(
		agentType: "claude" | "openhands",
		subagentName: string,
		task: string,
	): Promise<{ success: boolean; result: unknown }> {
		if (agentType === "claude" && this.claudeSDKAgent) {
			const delegationResult = await this.claudeSDKAgent.delegateToSubagent(subagentName, task);
			return { success: delegationResult.taskCompleted, result: delegationResult.result };
		} else if (agentType === "openhands" && this.openHandsSDKAgent) {
			return await this.openHandsSDKAgent.delegateToSpecialist(subagentName, task);
		}

		return { success: false, result: "Agent not available" };
	}

	/**
	 * Get learning insights from OpenHands SDK agent
	 */
	getLearningInsights(count: number = 10): Array<{
		category: string;
		insight: string;
		confidence: number;
		applied: boolean;
	}> {
		if (!this.openHandsSDKAgent) {
			return [];
		}

		return this.openHandsSDKAgent
			.getLearningMemory()
			.getRecentInsights(count)
			.map((i) => ({
				category: i.category,
				insight: i.insight,
				confidence: i.confidence,
				applied: i.applied,
			}));
	}

	/**
	 * Get session stats from Claude SDK agent
	 */
	getClaudeSDKSessionStats(): {
		sessionId: string | null;
		turnCount: number;
		actionsExecuted: number;
		signalsGenerated: number;
		delegatedAgents: string[];
	} | null {
		if (!this.claudeSDKAgent) {
			return null;
		}
		return this.claudeSDKAgent.getSessionStats();
	}

	/**
	 * Get available subagents from Claude SDK agent
	 */
	getAvailableSubagents(): Array<{
		name: string;
		description: string;
		tools: string[];
	}> {
		if (!this.claudeSDKAgent) {
			return [];
		}

		return this.claudeSDKAgent.getAvailableSubagents().map((s) => ({
			name: s.name,
			description: s.description,
			tools: s.tools,
		}));
	}

	/**
	 * Get comprehensive stats including SDK agents
	 */
	getAdvancedStats(): Record<string, unknown> {
		const baseStats = this.getStats();

		return {
			...baseStats,
			claudeSDK: this.claudeSDKAgent
				? {
						enabled: true,
						sessionStats: this.claudeSDKAgent.getSessionStats(),
						registeredTools: this.claudeSDKAgent.getRegisteredTools(),
					}
				: { enabled: false },
			openHandsSDK: this.openHandsSDKAgent
				? {
						enabled: true,
						stats: this.openHandsSDKAgent.getStats(),
						recentInsights: this.getLearningInsights(5),
					}
				: { enabled: false },
			statefulAgents: this.getStatefulAgentStats(),
			workflow: this.getWorkflowStats(),
		};
	}

	// ========================================================================
	// STATEFUL AGENT METHODS
	// ========================================================================

	/**
	 * Get stateful agent statistics
	 */
	getStatefulAgentStats(): Record<string, unknown> {
		if (!this.config.enableStatefulAgents) {
			return { enabled: false };
		}

		const stats: Record<string, unknown> = {
			enabled: true,
			orchestrator: this.orchestratorAgent
				? {
						status: this.orchestratorAgent.status,
						isActive: this.orchestratorAgent.isActive,
						canResume: this.orchestratorAgent.canResume,
						state: this.orchestratorAgent.state,
					}
				: null,
			agents: {},
		};

		const agentsStats = stats.agents as Record<
			string,
			{
				status: string;
				isActive: boolean;
				canResume: boolean;
				progress: number;
			}
		>;
		for (const [id, agent] of this.statefulAgents) {
			agentsStats[id] = {
				status: agent.status,
				isActive: agent.isActive,
				canResume: agent.canResume,
				progress: agent.state.progress,
			};
		}

		return stats;
	}

	/**
	 * Checkpoint orchestrator state
	 */
	async checkpointOrchestrator(label?: string): Promise<CheckpointResult> {
		if (!this.orchestratorAgent) {
			return { success: false, error: "Orchestrator agent not initialized" };
		}

		return this.orchestratorAgent.checkpoint(label);
	}

	/**
	 * Restore orchestrator to checkpoint
	 */
	async restoreOrchestrator(options: {
		checkpointId?: string;
		tagName?: string;
		latest?: boolean;
	}): Promise<RestoreResult> {
		if (!this.orchestratorAgent) {
			return { success: false, error: "Orchestrator agent not initialized" };
		}

		return this.orchestratorAgent.restore(options);
	}

	/**
	 * List orchestrator checkpoints
	 */
	async listOrchestratorCheckpoints(): Promise<CheckpointEntry[]> {
		if (!this.orchestratorAgent) {
			return [];
		}

		return this.orchestratorAgent.listCheckpoints();
	}

	/**
	 * Pause stateful agent
	 */
	async pauseStatefulAgent(agentId: string): Promise<void> {
		const agent = this.statefulAgents.get(agentId);
		if (!agent) {
			throw new Error(`Stateful agent not found: ${agentId}`);
		}

		await agent.pause();
	}

	/**
	 * Resume stateful agent
	 */
	async resumeStatefulAgent(agentId: string): Promise<RestoreResult> {
		const agent = this.statefulAgents.get(agentId);
		if (!agent) {
			throw new Error(`Stateful agent not found: ${agentId}`);
		}

		return agent.resume();
	}

	// ========================================================================
	// WORKFLOW METHODS
	// ========================================================================

	/**
	 * Get workflow statistics
	 */
	getWorkflowStats(): Record<string, unknown> {
		if (!this.config.enableWorkflows || !this.tradingWorkflow) {
			return { enabled: false };
		}

		return {
			enabled: true,
			currentSession: this.currentWorkflowSession,
			status: this.tradingWorkflow.status,
			progress: this.tradingWorkflow.progress,
			isRunning: this.tradingWorkflow.isRunning,
			canResume: this.tradingWorkflow.canResume,
			context: this.tradingWorkflow.context,
		};
	}

	/**
	 * Run trading workflow for a symbol
	 */
	async runTradingWorkflow(symbol: string): Promise<{
		success: boolean;
		context?: WorkflowContext;
		error?: string;
	}> {
		if (!this.tradingWorkflow) {
			return { success: false, error: "Trading workflow not initialized" };
		}

		if (this.tradingWorkflow.isRunning) {
			return { success: false, error: "Workflow already running" };
		}

		// Start orchestrator agent
		if (this.orchestratorAgent) {
			await this.orchestratorAgent.start(`Trading workflow for ${symbol}`);
		}

		// Define step executor
		const executor: StepExecutor = async (step, input, _context) => {
			const agentId = step.agent;
			const agent = this.statefulAgents.get(agentId);

			if (!agent) {
				throw new Error(`Agent not found: ${agentId}`);
			}

			// Start agent
			await agent.start(step.task || `Execute ${step.id}`);

			try {
				let result: unknown;

				// Execute based on agent type - cast input to expected types
				switch (agentId) {
					case "data-collector":
						result = await this.executeDataCollector(symbol);
						break;
					case "pattern-analyzer":
						result = await this.executePatternAnalyzer(symbol, input as MarketDataResult);
						break;
					case "signal-generator":
						result = await this.executeSignalGenerator(symbol, input as PatternResult);
						break;
					case "risk-assessor":
						result = await this.executeRiskAssessor(symbol, input as TradeSignal[]);
						break;
					default:
						throw new Error(`Unknown agent: ${agentId}`);
				}

				// Store result in agent state
				await agent.setData("result", result);
				await agent.setProgress(100);
				await agent.complete(result);

				return result;
			} catch (error) {
				await agent.fail(error instanceof Error ? error : new Error(String(error)));
				throw error;
			}
		};

		try {
			const context = await this.tradingWorkflow.run(executor);

			// Complete orchestrator
			if (this.orchestratorAgent) {
				await this.orchestratorAgent.complete(context.data.trade_plan);
			}

			return { success: true, context };
		} catch (error) {
			// Fail orchestrator
			if (this.orchestratorAgent) {
				await this.orchestratorAgent.fail(error instanceof Error ? error : new Error(String(error)));
			}

			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Pause trading workflow
	 */
	async pauseTradingWorkflow(): Promise<void> {
		if (!this.tradingWorkflow) {
			throw new Error("Trading workflow not initialized");
		}

		await this.tradingWorkflow.pause();

		if (this.orchestratorAgent) {
			await this.orchestratorAgent.pause();
		}
	}

	/**
	 * Resume trading workflow
	 */
	async resumeTradingWorkflow(): Promise<{
		success: boolean;
		context?: WorkflowContext;
		error?: string;
	}> {
		if (!this.tradingWorkflow) {
			return { success: false, error: "Trading workflow not initialized" };
		}

		try {
			// Resume orchestrator
			if (this.orchestratorAgent) {
				await this.orchestratorAgent.resume();
			}

			const context = await this.tradingWorkflow.resume();
			return { success: true, context };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Cancel trading workflow
	 */
	cancelTradingWorkflow(): void {
		if (!this.tradingWorkflow) {
			throw new Error("Trading workflow not initialized");
		}

		this.tradingWorkflow.cancel();
	}

	/**
	 * Restart workflow from specific step
	 */
	async restartWorkflowFrom(stepId: string): Promise<{
		success: boolean;
		context?: WorkflowContext;
		error?: string;
	}> {
		if (!this.tradingWorkflow) {
			return { success: false, error: "Trading workflow not initialized" };
		}

		try {
			const context = await this.tradingWorkflow.restartFrom(stepId);
			return { success: true, context };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	// ========================================================================
	// WORKFLOW STEP EXECUTORS
	// ========================================================================

	/**
	 * Execute data collector step
	 */
	private async executeDataCollector(symbol: string): Promise<MarketDataResult> {
		const price = await this.priceAgent.getPrice(symbol);
		const sentiment = await this.sentimentAgent.getSentiment(symbol);
		const whaleActivity = this.whaleAgent.getActivitySummary() as WhaleActivitySummary;

		if (!price) {
			throw new Error(`Failed to fetch price data for ${symbol}`);
		}

		return { price, sentiment, whaleActivity };
	}

	/**
	 * Execute pattern analyzer step
	 */
	private async executePatternAnalyzer(_symbol: string, marketData: MarketDataResult): Promise<PatternResult> {
		// Simple pattern analysis - in production, use advanced TA library
		const { price } = marketData;

		const trends: string[] = [];
		const indicators: Record<string, number> = {};

		// Analyze price movement
		if (price.change24h > 5) {
			trends.push("strong-uptrend");
		} else if (price.change24h < -5) {
			trends.push("strong-downtrend");
		}

		// Analyze volume (use baseline estimate when no average available)
		const volumeBaseline = price.volume24h * 0.8;
		if (price.volume24h > volumeBaseline * 1.5) {
			trends.push("high-volume");
		}

		// Calculate basic indicators
		indicators.momentum = price.change24h;
		indicators.volumeRatio = price.volume24h / (volumeBaseline || 1);

		const confidence = trends.length > 0 ? 0.7 : 0.3;

		return { trends, indicators, confidence };
	}

	/**
	 * Execute signal generator step
	 */
	private async executeSignalGenerator(symbol: string, patterns: PatternResult): Promise<TradeSignal[]> {
		const signals: TradeSignal[] = [];

		// Generate signals based on patterns
		if (patterns.trends.includes("strong-uptrend") && patterns.trends.includes("high-volume")) {
			signals.push({
				symbol,
				action: "BUY",
				confidence: patterns.confidence,
				price: 0,
				timestamp: Date.now(),
				source: "pattern-analyzer",
				reason: "Strong uptrend with high volume",
			});
		} else if (patterns.trends.includes("strong-downtrend")) {
			signals.push({
				symbol,
				action: "SELL",
				confidence: patterns.confidence,
				price: 0,
				timestamp: Date.now(),
				source: "pattern-analyzer",
				reason: "Strong downtrend detected",
			});
		} else {
			signals.push({
				symbol,
				action: "HOLD",
				confidence: 0.5,
				price: 0,
				timestamp: Date.now(),
				source: "pattern-analyzer",
				reason: "No clear trend",
			});
		}

		return signals;
	}

	/**
	 * Execute risk assessor step
	 */
	private async executeRiskAssessor(_symbol: string, signals: TradeSignal[]): Promise<RiskAssessmentResult> {
		const primarySignal = signals[0];

		// Simple risk assessment
		const riskScore = primarySignal.action === "BUY" || primarySignal.action === "SELL" ? 0.6 : 0.2;

		const approved = primarySignal.confidence >= this.config.minSignalConfidence && riskScore < 0.8;

		return {
			approved,
			riskScore,
			finalSignal: approved ? primarySignal : null,
			reason: approved ? "Risk within acceptable range" : "Risk too high or confidence too low",
		};
	}

	// ========================================================================
	// AGENT POOL METHODS
	// ========================================================================

	/**
	 * Assign agent to a specific pool
	 */
	assignAgentToPool(agentName: string, pool: PoolType): void {
		const agent = this.agents.get(agentName);
		if (!agent) {
			throw new Error(`Agent not found: ${agentName}`);
		}
		this.poolManager.assignToPool(agent, pool);
	}

	/**
	 * Get all agents in a pool
	 */
	getPool(pool: PoolType): BaseAgent[] {
		return this.poolManager.getPool(pool);
	}

	/**
	 * Run task with specific orchestration mode
	 */
	async runPoolTask(mode: OrchestrationMode, task: Task): Promise<TaskResult> {
		return this.poolManager.runMode(mode, task);
	}

	/**
	 * Get pool statistics
	 */
	getPoolStats(pool?: PoolType): unknown {
		if (pool) {
			return this.poolManager.getPoolStats(pool);
		}
		return this.poolManager.getAllPoolStats();
	}

	/**
	 * Get pool distribution
	 */
	getPoolDistribution(): Record<PoolType, number> {
		return this.poolManager.getPoolDistribution();
	}

	// ========================================================================
	// COST TRACKING METHODS
	// ========================================================================

	/**
	 * Get agent costs
	 */
	getAgentCosts(agentId: string, since?: number): AgentCost[] {
		return this.costTracker.getAgentCosts(agentId, since);
	}

	/**
	 * Get pool costs
	 */
	getPoolCosts(poolType: PoolType, since?: number): AgentCost[] {
		return this.costTracker.getPoolCosts(poolType, since);
	}

	/**
	 * Get total cost
	 */
	getTotalCost(since?: number): number {
		return this.costTracker.getTotalCost(since);
	}

	/**
	 * Get agent cost summary
	 */
	getAgentCostSummary(agentId: string, since?: number): unknown {
		return this.costTracker.getAgentCostSummary(agentId, since);
	}

	/**
	 * Get pool cost summary
	 */
	getPoolCostSummary(poolType: PoolType, since?: number): unknown {
		return this.costTracker.getPoolCostSummary(poolType, since);
	}

	/**
	 * Set budget for a pool
	 */
	setPoolBudget(poolType: PoolType, dailyLimit: number, monthlyLimit: number, alertThreshold?: number): void {
		this.costTracker.setBudget(poolType, dailyLimit, monthlyLimit, alertThreshold);
	}

	/**
	 * Get cost alerts
	 */
	getCostAlerts(limit?: number, severity?: "low" | "medium" | "high"): unknown[] {
		return this.costTracker.getAlerts(limit, severity);
	}

	/**
	 * Get top cost agents
	 */
	getTopCostAgents(limit?: number, since?: number): unknown[] {
		return this.costTracker.getTopCostAgents(limit, since);
	}

	/**
	 * Get cost optimization insights
	 */
	getCostOptimizationInsights(): unknown[] {
		return this.costTracker.getOptimizationInsights();
	}

	/**
	 * Export cost data
	 */
	exportCostData(since?: number, format?: "json" | "csv"): string {
		return this.costTracker.exportCosts(since, format);
	}

	// ==========================================================================
	// RESEARCH ORCHESTRATOR INTEGRATION
	// ==========================================================================

	/**
	 * Connect to research orchestrator for automated insights
	 */
	connectResearchOrchestrator(): void {
		this.researchOrchestrator = getResearchOrchestrator();

		// Listen for research cycle completions
		this.researchOrchestrator.on("cycleCompleted", (result: ResearchCycleResult) => {
			this.handleResearchResult(result);
		});

		console.log("[TradingOrchestrator] Connected to Research Orchestrator");
	}

	/**
	 * Disconnect from research orchestrator
	 */
	disconnectResearchOrchestrator(): void {
		if (this.researchOrchestrator) {
			this.researchOrchestrator.removeAllListeners("cycleCompleted");
			this.researchOrchestrator = null;
		}
	}

	/**
	 * Handle incoming research result
	 */
	private handleResearchResult(result: ResearchCycleResult): void {
		// Store insight
		this.researchInsights.push(result);
		while (this.researchInsights.length > this.MAX_RESEARCH_INSIGHTS) {
			this.researchInsights.shift();
		}

		// Only process trading-related research
		if (!result.topicId.includes("trading") && !result.topicId.includes("market")) {
			return;
		}

		// Convert research findings to potential trading signals
		if (result.success && result.findings && result.confidence >= 0.7) {
			this.processResearchFindings(result);
		}
	}

	/**
	 * Process research findings and potentially generate signals
	 */
	private async processResearchFindings(result: ResearchCycleResult): Promise<void> {
		// Extract actionable insights from research
		const findings = result.findings || [];

		for (const finding of findings) {
			// Check for bullish/bearish sentiment in findings
			const lowerFinding = finding.toLowerCase();
			const isBullish =
				lowerFinding.includes("bullish") ||
				lowerFinding.includes("opportunity") ||
				lowerFinding.includes("uptrend") ||
				lowerFinding.includes("buy signal");
			const isBearish =
				lowerFinding.includes("bearish") ||
				lowerFinding.includes("risk") ||
				lowerFinding.includes("downtrend") ||
				lowerFinding.includes("sell signal");

			// Extract symbol if mentioned
			const symbolMatch = finding.match(/\b(BTC|ETH|SOL|DOGE|XRP)\b/i);
			const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : "BTC";

			if (isBullish || isBearish) {
				// Try to get current price for the symbol
				const priceData = await this.priceAgent.getPrice(symbol);
				const currentPrice = priceData?.price || 0;

				const signal: TradeSignal = {
					symbol,
					action: isBullish ? "BUY" : "SELL",
					confidence: result.confidence * 0.8, // Slightly reduce confidence for research-derived signals
					price: currentPrice,
					reason: `Research insight: ${finding.slice(0, 200)}`,
					source: "research-orchestrator",
					timestamp: Date.now(),
					metadata: {
						researchTopicId: result.topicId,
						cycleId: result.cycleId,
						phase: result.phase,
					},
				};

				// Process through normal signal flow
				await this.processSignal(signal);
			}
		}
	}

	/**
	 * Inject manual research insight
	 */
	async injectResearchInsight(insight: string, symbol = "BTC", confidence = 0.75): Promise<TradeSignal | null> {
		const lowerInsight = insight.toLowerCase();
		const isBullish = lowerInsight.includes("bullish") || lowerInsight.includes("buy");
		const isBearish = lowerInsight.includes("bearish") || lowerInsight.includes("sell");

		if (!isBullish && !isBearish) {
			return null;
		}

		// Get current price
		const priceData = await this.priceAgent.getPrice(symbol);
		const currentPrice = priceData?.price || 0;

		const signal: TradeSignal = {
			symbol,
			action: isBullish ? "BUY" : "SELL",
			confidence,
			price: currentPrice,
			reason: `Manual insight: ${insight.slice(0, 200)}`,
			source: "manual-research",
			timestamp: Date.now(),
		};

		await this.processSignal(signal);
		return signal;
	}

	/**
	 * Get recent research insights
	 */
	getResearchInsights(limit = 10): ResearchCycleResult[] {
		return this.researchInsights.slice(-limit);
	}

	/**
	 * Get trading-specific research insights
	 */
	getTradingResearchInsights(limit = 10): ResearchCycleResult[] {
		return this.researchInsights
			.filter((r) => r.topicId.includes("trading") || r.topicId.includes("market"))
			.slice(-limit);
	}

	/**
	 * Check if research orchestrator is connected
	 */
	isResearchConnected(): boolean {
		return this.researchOrchestrator !== null;
	}
}

// Singleton instance
let orchestratorInstance: TradingOrchestrator | null = null;

export function getTradingOrchestrator(config?: Partial<OrchestratorConfig>): TradingOrchestrator {
	if (!orchestratorInstance) {
		orchestratorInstance = new TradingOrchestrator(config);
	}
	return orchestratorInstance;
}

/**
 * Create orchestrator with advanced SDK agents enabled
 */
export function createAdvancedOrchestrator(
	llmConfig: LLMConfig,
	options: {
		signalChannelId?: string;
		enableClaudeSDK?: boolean;
		enableOpenHandsSDK?: boolean;
		claudeHooks?: Partial<HookDefinitions>;
	} = {},
): TradingOrchestrator {
	return new TradingOrchestrator({
		enabled: true,
		signalChannelId: options.signalChannelId,
		useConsensus: true,
		minSignalConfidence: 0.6,
		enableClaudeSDKAgent: options.enableClaudeSDK ?? true,
		enableOpenHandsSDKAgent: options.enableOpenHandsSDK ?? true,
		llmConfig,
		claudeHooks: options.claudeHooks,
	});
}
