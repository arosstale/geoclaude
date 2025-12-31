/**
 * Trading Module Exports
 * Nano Trading Agents inspired by Moon Dev's architecture
 */

// Claude SDK Trading Agent (hooks, streaming, session management)
export {
	type Action as ClaudeAction,
	type ActionParams,
	type ActionType as ClaudeActionType,
	type AnalysisResult,
	type BacktestResults,
	type ClaudeSDKConfig,
	ClaudeSDKTradingAgent,
	createClaudeSDKTradingAgent,
	createTradingAgentWithHooks,
	type DelegationRequest,
	type DelegationResult,
	type HookContext,
	type HookDefinitions,
	type HookEvent,
	type LiquidationAnalysis,
	type MarketAnalysis,
	type Observation as ClaudeObservation,
	type ObservationData,
	type PriceDataResult,
	type SessionState,
	type StrategyResearch,
	type SubagentDefinition,
	type ToolDefinition as ClaudeToolDefinition,
	type ToolExecutor as ClaudeToolExecutor,
	type ToolInput,
	type ToolOutput,
	TRADING_SUBAGENTS,
	type TradeExecution,
	type TurnData,
	type WhaleTrackingResult,
} from "./agents/claude-sdk-trading-agent.js";
// CodeAct Trading Agent (OpenHands-style action/observation pattern)
export {
	type Action,
	type ActionType,
	type AnalysisResultObservation,
	type AnalyzeMarketAction,
	type CmdOutputObservation,
	type CmdRunAction,
	type CodeActState,
	type CodeActStateType,
	CodeActTradingAgent,
	type DelegateAction,
	type IPythonRunAction,
	type LimitOrderAction,
	type MarketDataObservation,
	type MarketOrderAction,
	type Observation,
	type ObservationType,
	type OrderFillObservation,
	type SubTask,
} from "./agents/codeact-trading-agent.js";
export {
	CopyTraderAgent,
	type CopyTraderConfig,
	type TrackedWallet,
	type WalletTrade,
} from "./agents/copy-trader-agent.js";
// Hyperliquid DEX Agent (whale tracking, liquidation arbitrage)
export {
	HyperliquidAgent,
	type HyperliquidOrder,
	type HyperliquidPosition,
	type LiquidationData,
	type MarketData,
	type WhalePosition,
} from "./agents/hyperliquid-agent.js";
// Moon Dev Inspired Agents
export {
	IlyaSutskeverAgent,
	JimSimonsAgent,
	JohnCarmackAgent,
	MarketIntelAgent,
	MoonDevAgents,
	RayDalioAgent,
	RiskAssessmentAgent,
} from "./agents/moondev-agents.js";
// OpenHands SDK-Style Agent (conversation, tools, delegation)
export {
	type AgentContext,
	type AgentFactory,
	type ConversationState,
	createAgentFromSDKRegistry,
	createOpenHandsSDKAgent,
	getAllSDKTools,
	getSDKAgent,
	getSDKTool,
	type LLMConfig,
	type Message,
	type MessageRole,
	OpenHandsSDKAgent,
	type OpenHandsSDKConfig,
	type RegisteredTool,
	registerSDKAgent,
	registerSDKTool,
	SDKAgent,
	SDKConversation,
	type SDKLearningInsight,
	SDKLearningMemory,
	type SDKStrategyModification,
	type SDKTask,
	type Skill,
	type ToolDefinition,
	type ToolExecutor,
	type ToolMessage,
	type ToolParameter,
} from "./agents/openhands-sdk-agent.js";
// OpenHands Trading Agent (autonomous code execution)
export {
	type LearningInsight,
	type OpenHandsTask,
	OpenHandsTradingAgent,
	type OpenHandsTradingConfig,
	type StrategyModification,
} from "./agents/openhands-trading-agent.js";
// Core Agents
export { PriceAgent } from "./agents/price-agent.js";
// RBI Framework Agent (Research-Backtest-Implement methodology)
export {
	type BacktestResult,
	RBIFrameworkAgent,
	type ResearchItem,
	type StrategyRule,
	type TradingStrategy,
} from "./agents/rbi-framework-agent.js";
export { SentimentAgent } from "./agents/sentiment-agent.js";
// Sentiment Analysis
export {
	type FearGreedData,
	type NewsItem,
	SentimentAnalysisAgent,
	type SentimentAnalysisConfig,
	type SentimentScore,
	type SocialMetrics,
} from "./agents/sentiment-analysis-agent.js";
// Advanced Agents (MoonDev-style)
export { SwarmAgent, type SwarmModel, type SwarmResult, type SwarmVote } from "./agents/swarm-agent.js";
export { WhaleAgent } from "./agents/whale-agent.js";
// API Integrations
export {
	type AggregatedMarketData,
	calculateATR,
	calculateBollingerBands,
	calculateEMA,
	calculateMACD,
	calculateRSI,
	calculateSMA,
	calculateTechnicalIndicators,
	fetchAggregatedMarketData,
	fetchCoinGeckoOHLCV,
	fetchCoinGeckoPrice,
	fetchDexScreenerToken,
	fetchHyperliquidLiquidations,
	fetchWhaleTransactions,
	generateSignalFromMarketData,
	type LiquidationDataAPI,
	type OHLCVData,
	type PriceDataAPI,
	type TechnicalIndicators,
	type WhaleTransactionAPI,
} from "./api-integrations.js";
// Base agent
export { BaseAgent, type SignalHandler } from "./base-agent.js";
// Consensus
export { ConsensusEngine } from "./consensus.js";
// Cost Tracking
export {
	type AgentCost,
	AgentCostTracker,
	type CostAlert,
	type CostBudget,
	type CostSummary,
	getAgentCostTracker,
	type ModelPricing,
	type PoolCostSummary,
} from "./cost-tracker.js";
// Learning Service
export { type PendingSignal, type SessionSummary, type TradingOutcome, tradingLearning } from "./learning-service.js";
// Orchestrator
export { createAdvancedOrchestrator, getTradingOrchestrator, TradingOrchestrator } from "./orchestrator.js";
// Paper Trading
export {
	getPaperTrading,
	type PaperOrder,
	type PaperPortfolio,
	type PaperPosition,
	type PaperTrade,
	type PaperTradingConfig,
	PaperTradingService,
	resetPaperTrading,
} from "./paper-trading.js";
// Trading Benchmark (TradingAgents / INVESTORBENCH / LiveTradeBench)
export {
	type AdaptabilityMetrics,
	type BenchmarkConfig,
	type BenchmarkResult,
	type EconomicMetrics,
	type FinancialMetrics,
	getBenchmark,
	getTradingBenchmark,
	type PortfolioSnapshot,
	type TradeRecord,
	TradingBenchmark,
} from "./trading-benchmark.js";
// Types
export * from "./types.js";
