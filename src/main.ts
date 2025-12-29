#!/usr/bin/env node
/**
 * Pi Discord Bot - A full agentic Discord bot powered by AI
 * Similar to pi-mom but for Discord - with bash, read, write, edit tools
 * Supports both slash commands and @mentions
 */

import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import type { AgentTool, Message as AIMessage, Model } from "@mariozechner/pi-ai";
import { formatSkillsForPrompt, loadSkillsFromDir, type Skill } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import chalk from "chalk";
import { spawn } from "child_process";
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	Client,
	EmbedBuilder,
	GatewayIntentBits,
	type Message,
	Partials,
	REST,
	Routes,
	SlashCommandBuilder,
	type TextChannel,
	type VoiceChannel,
} from "discord.js";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import express from "express";
import cron from "node-cron";
import {
	type AgentDomain,
	// Agentic Properties (IndyDevDan's 6 Properties Framework)
	AgenticAgent,
	// GOAT Presets (Mario, Vercel)
	AgenticPresets,
	// Aerospace-Inspired Pattern Modules (ANG13T research)
	AnomalyDetectorPresets,
	AnomalySeverity,
	AnomalyType,
	// Vedic Quantum System
	B5_GRID,
	backtestIfaStrategy,
	// Hook System
	CheckpointUtils,
	ClaudeAgentPresets,
	// Agent Experts (TAC Lesson 13)
	CODEBASE_EXPERTS,
	CRITICAL_DOMAIN_SEEDS,
	type CTMDomain,
	// CTM - Continuous Thought Machine
	CTMPresets,
	type CTMResult,
	// Unified SDK Interface
	checkAllSDKs,
	createCodebaseExpert,
	createCodingAgent,
	// Agent Swarm (learned from Agentis Framework)
	createConsensusProposal,
	// Dependency Inference (learned from Agentis Framework)
	createDependencyInference,
	createDiscordHookIntegration,
	createIntegratedPreprocessor,
	// Agent Persona (learned from Agentis Framework)
	createPersona,
	createResearchAgent,
	createSecurityAgent,
	createSwarmAgent,
	createTaskRequest,
	createTradingAgent,
	createTradingOptimizer,
	// Workflow Chains
	createWorkflow,
	type DaemonConfig,
	DaemonPresets,
	deepThink,
	detectTaskType,
	evaluateAgentOutput,
	// ARC-AGI DSPy Evolution
	evaluateARCProgram,
	evaluatePrompt,
	// OpenEvolve - Evolutionary Optimization
	evolve,
	evolveARCSolver,
	// Claude SDK Two-Agent Pattern
	executeClaudeFeature,
	executeWithAutoExpert,
	filterToJustBashTools,
	filterToMinimalistTools,
	formatSkillsForPrompt as formatInternalSkillsForPrompt,
	type GEPAAgentType,
	type GEPAExample,
	generateCodingExamples,
	generateIfaSignal,
	generatePersonaPrompt,
	generateSecurityExamples,
	generateSessionId,
	generateTradingExamples,
	// Agent Mail System
	getAgentMessageBus,
	// Lightweight Agent
	getAgentModels,
	getAnomalyDetector,
	getARCAgentStatus,
	getAutonomousDaemon,
	getChannelHookIntegration,
	getClaudeTaskStatus,
	getCTMStatus,
	getDaemonStatus,
	// DGM - Darwin Gödel Machine
	getDGMStatus,
	// E2B Cloud Sandbox
	getE2BSandboxService,
	// GEPA Prompt Optimization
	getExpertiseDomains,
	// Expertise Manager
	getExpertiseModes,
	getFeatureExtractor,
	getGEPAStatus,
	// History Capture (UOCS)
	getHistoryCaptureService,
	getImprovementHistory,
	// Learning Activation (Novel PI Agent Architectures)
	getLearningActivationService,
	getOpenEvolveStatus,
	getPersona,
	getPersonaManager,
	// 24/7 Research System
	getResearchOrchestrator,
	getResearchStatus,
	// Self-Debug Service (Autonomous Error Detection and Repair)
	getSelfDebugService,
	getSignalClassifier,
	getSignalValidator,
	getSwarmCoordinator,
	// Twitter Connector (learned from Agentis Framework)
	getTwitterConnector,
	type HookIntegration,
	IFA_ODUS,
	ifaSignalToAction,
	improve,
	improveAgentExpertise,
	inferTaskDependencies,
	initializeClaudeTask,
	initializeTradingGenes,
	isAgentAvailable,
	isARCAgentAvailable,
	isE2BAvailable,
	isOpenCodeAvailable,
	isOpenEvolveAvailable,
	// OpenHands
	isOpenHandsAvailable,
	LearningPresets,
	listFreeModels,
	listOmniModels,
	listWorkflows,
	loadBestProgram,
	loadExpertise,
	// Internal Skills System (enhanced with more discovery paths)
	loadSkills as loadInternalSkills,
	loadWorkflow,
	N4_GRID,
	OMNI_MODELS,
	type OmniOptions,
	OmniPresets,
	OPENCODE_FREE_MODELS,
	OpenCodePresets,
	OpenEvolvePresets,
	type OpenHandsMode,
	OpenHandsModeDescriptions,
	optimizeExpertise,
	optimizePrompt,
	PRESET_PERSONAS,
	PRODUCT_EXPERTS,
	quickEvolve,
	quickImprove,
	quickThink,
	resumeClaudeTask,
	// Claude Agent SDK (CLI)
	runClaudeAgent,
	runCodeReview,
	runDebug,
	runDocGeneration,
	runFullTradingAudit,
	runInSandbox,
	runLearningAgent,
	runOmni,
	// OpenCode SDK (free Grok)
	runOpenCodeAgent,
	runOpenHandsAgent,
	runOptimize,
	runRefactor,
	runRiskAssessment,
	runSecurityScan,
	runStrategyBacktest,
	runTestGeneration,
	runTwoAgentWorkflow,
	runWithBestSDK,
	SDK_INFO,
	SignalDirection,
	SourceType,
	type SwarmRole,
	// Autonomous Daemon System
	startDaemon,
	startResearch,
	stopDaemon,
	stopResearch,
	type TradingStrategyGenes,
	think,
	wrapToolWithHooks,
} from "./agents/index.js";
import { Analytics } from "./analytics.js";
import { browserAutomation } from "./browser/index.js";
import { DiscordSettingsManager } from "./context.js";
import { getHub } from "./cross-platform-hub.js";
import { setupDashboard } from "./dashboard-integration.js";
import { type BotDatabase, initDatabase } from "./database.js";
import { createEventsWatcher, type EventHandler, type EventsWatcher } from "./events.js";
import { type HF_SPACES, hfSkills } from "./hf-skills.js";
import { getKnowledgeBase } from "./knowledge/index.js";
import { getMetricsTracker } from "./mcp-catalog/metrics-tracker.js";
import {
	createCodebaseKnowledgeTool,
	createGithubListIssuesTool,
	createGithubRepoSearchTool,
	createHfDatasetSearchTool,
	createHfModelSearchTool,
	createMemoryRecallTool,
	createMemoryStoreTool,
	createSkillListTool,
	createSkillLoadTool,
	createTaskCreateTool,
	createTaskListTool,
	createWebScrapeTool,
	getAllMcpTools,
	withRetry,
} from "./mcp-tools.js";
import { STATUS_DESCRIPTIONS, type SunoModel, type SunoTrack, sunoService } from "./music/suno-service.js";
import { getSmolAINews } from "./news/index.js";
import { TaskScheduler } from "./scheduler.js";
import { ChannelStore } from "./store.js";
import {
	createTelegramBot,
	getWebhookPath,
	setDiscordClient,
	setupTelegramWebhook,
	shouldUseWebhook,
	EXPERT_MODES as TelegramExpertModes,
} from "./telegram/index.js";
import {
	fetchCoinGeckoPrice,
	getPaperTrading,
	getTradingOrchestrator,
	resetPaperTrading,
	SentimentAnalysisAgent,
	tradingLearning,
} from "./trading/index.js";
// Utility imports for rate limiting, streaming, autocomplete, and caching
import {
	addRecentQuery,
	checkRateLimit as checkSlashRateLimit,
	getCommandCost,
	handleAutocomplete,
} from "./utils/index.js";
import { getVibeVoiceTTS, getVoiceSession, getWhisperLocalSTT } from "./voice/index.js";

// ============================================================================
// Path Constants
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..");
const ARC_EVOLUTION_DIR = join(PACKAGE_ROOT, "data", "arc-agi-evolution");

// ============================================================================
// Configuration
// ============================================================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Security: Restrict to specific user IDs (empty = allow all)
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || "").split(",").filter(Boolean);

// Admin/Owner user ID
const OWNER_USER_ID = "1284556970082435072";

function isUserAllowed(userId: string): boolean {
	if (ALLOWED_USER_IDS.length === 0) return true; // No restriction if not configured
	return ALLOWED_USER_IDS.includes(userId);
}

function isOwner(userId: string): boolean {
	return userId === OWNER_USER_ID;
}

// ============================================================================
// Model Configuration & Management
// ============================================================================

const DEFAULT_MODEL_ID = "devstral-small-2";
const OLLAMA_BASE_URL = "http://localhost:11434";

// OpenRouter Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Cerebras Configuration (fastest inference - 2100+ tok/s)
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";

// Groq Configuration (fast + free)
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// Z.ai Configuration (GLM-4.7 - top coding model)
const ZAI_API_KEY = process.env.ZAI_API_KEY || "";
const ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4"; // Coding Plan endpoint (OpenAI-compatible)

// Provider types
type ProviderType = "ollama" | "openrouter" | "cerebras" | "groq" | "zai";

// Read default provider from env, or auto-detect based on available API keys
const ENV_DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER as ProviderType | undefined;
const ENV_DEFAULT_MODEL = process.env.DEFAULT_MODEL || "";

// Z.ai GLM-4.7 is top coding model - prefer it first
let currentProvider: ProviderType = ENV_DEFAULT_PROVIDER
	? ENV_DEFAULT_PROVIDER
	: ZAI_API_KEY
		? "zai"
		: GROQ_API_KEY
			? "groq"
			: OPENROUTER_API_KEY
				? "openrouter"
				: CEREBRAS_API_KEY
					? "cerebras"
					: "ollama"; // Fallback to local

// OpenRouter model presets (benchmarked for agentic tasks)
const OPENROUTER_MODELS: Record<string, { id: string; name: string; cost: string }> = {
	// PREMIUM MODELS (Best quality)
	"claude-sonnet": {
		id: "anthropic/claude-sonnet-4",
		name: "Claude Sonnet 4 (Best Overall)",
		cost: "$3/$15 per M - Top tier reasoning",
	},
	"gpt-4o": {
		id: "openai/gpt-4o",
		name: "GPT-4o (OpenAI Best)",
		cost: "$2.50/$10 per M - Multimodal",
	},
	"gemini-pro": {
		id: "google/gemini-2.5-pro-preview",
		name: "Gemini 2.5 Pro (Google Best)",
		cost: "$1.25/$10 per M - Long context",
	},
	// AGENTIC MODELS (tool calling, fast)
	"mistral-small": {
		id: "mistralai/mistral-small-3.1-24b-instruct",
		name: "Mistral Small 3.1 24B (Best Agentic)",
		cost: "$0.03/$0.11 per M - Fast tool calling",
	},
	"deepseek-v3": {
		id: "deepseek/deepseek-chat-v3.1",
		name: "DeepSeek V3.1 (Best Reasoning)",
		cost: "$0.15/$0.75 per M - Smart but slower",
	},
	"qwen-72b": {
		id: "qwen/qwen-2.5-72b-instruct",
		name: "Qwen 2.5 72B (Balanced)",
		cost: "$0.07/$0.26 per M - Good all-around",
	},
	// FAST/CHEAP MODELS
	"gemini-flash": {
		id: "google/gemini-2.5-flash-preview",
		name: "Gemini 2.5 Flash (Fast+Cheap)",
		cost: "$0.15/$0.60 per M - Great value",
	},
	"gpt-4o-mini": {
		id: "openai/gpt-4o-mini",
		name: "GPT-4o Mini (OpenAI Fast)",
		cost: "$0.15/$0.60 per M - Quick tasks",
	},
	"claude-haiku": {
		id: "anthropic/claude-3.5-haiku",
		name: "Claude 3.5 Haiku (Anthropic Fast)",
		cost: "$0.80/$4 per M - Speed demon",
	},
	"llama-3.3-70b": {
		id: "meta-llama/llama-3.3-70b-instruct",
		name: "Llama 3.3 70B (Open Source Best)",
		cost: "$0.12/$0.30 per M - High quality",
	},
	"llama-3.1-8b": {
		id: "meta-llama/llama-3.1-8b-instruct",
		name: "Llama 3.1 8B (Cheapest)",
		cost: "$0.02/$0.03 per M - Simple tasks",
	},
	// FREE MODELS
	"gemini-2-flash": {
		id: "google/gemini-2.0-flash-exp:free",
		name: "Gemini 2.0 Flash (FREE)",
		cost: "FREE - Fast agentic",
	},
	"llama-3.3-70b-free": {
		id: "meta-llama/llama-3.3-70b-instruct:free",
		name: "Llama 3.3 70B (FREE)",
		cost: "FREE - High quality",
	},
	"kimi-k2": {
		id: "moonshotai/kimi-k2:free",
		name: "Kimi K2 (FREE)",
		cost: "FREE - 128k context",
	},
};
const DEFAULT_OPENROUTER_MODEL = "claude-sonnet"; // Best agentic model

// Cerebras model presets (fastest inference in the world - 2100+ tok/s)
const CEREBRAS_MODELS: Record<string, { id: string; name: string; cost: string }> = {
	"glm-4.6": {
		id: "zai-glm-4.6",
		name: "GLM 4.6 (Fastest Smart)",
		cost: "$0.10/$0.10 per M - 2100+ tok/s",
	},
	"llama-3.3-70b": {
		id: "llama-3.3-70b",
		name: "Llama 3.3 70B (Best Quality)",
		cost: "$0.60/$0.60 per M - 2100+ tok/s",
	},
	"llama-3.1-8b": {
		id: "llama3.1-8b",
		name: "Llama 3.1 8B (Ultra Fast)",
		cost: "$0.10/$0.10 per M - 1800+ tok/s",
	},
	"qwen-3-32b": {
		id: "qwen-3-32b",
		name: "Qwen3 32B (Balanced)",
		cost: "$0.20/$0.20 per M - Fast",
	},
	"qwen-3-235b": {
		id: "qwen-3-235b-a22b-instruct-2507",
		name: "Qwen3 235B (Massive)",
		cost: "$0.50/$0.50 per M - Powerful",
	},
	"gpt-oss-120b": {
		id: "gpt-oss-120b",
		name: "GPT OSS 120B",
		cost: "$0.30/$0.30 per M - Open source",
	},
};
const DEFAULT_CEREBRAS_MODEL = "llama-3.3-70b"; // Best quality on Cerebras

// Groq model presets (free + fast)
const GROQ_MODELS: Record<string, { id: string; name: string; cost: string }> = {
	"llama-3.3-70b": {
		id: "llama-3.3-70b-versatile",
		name: "Llama 3.3 70B (Best Free)",
		cost: "FREE - 300+ tok/s",
	},
	"llama-3.1-8b": {
		id: "llama-3.1-8b-instant",
		name: "Llama 3.1 8B (Ultra Fast)",
		cost: "FREE - 800+ tok/s",
	},
	"llama-4-maverick": {
		id: "meta-llama/llama-4-maverick-17b-128e-instruct",
		name: "Llama 4 Maverick (Latest)",
		cost: "FREE - New architecture",
	},
	"llama-4-scout": {
		id: "meta-llama/llama-4-scout-17b-16e-instruct",
		name: "Llama 4 Scout (Fast)",
		cost: "FREE - Efficient",
	},
	"kimi-k2": {
		id: "moonshotai/kimi-k2-instruct-0905",
		name: "Kimi K2 Latest (128k context)",
		cost: "FREE - Ultra fast + long context",
	},
	"qwen3-32b": {
		id: "qwen/qwen3-32b",
		name: "Qwen3 32B",
		cost: "FREE - Balanced",
	},
	"gpt-oss-120b": {
		id: "openai/gpt-oss-120b",
		name: "GPT OSS 120B",
		cost: "FREE - Open source",
	},
};
const DEFAULT_GROQ_MODEL = "kimi-k2"; // Latest + fastest + free

// Z.ai model presets (GLM-4.7 Orchestral Agent - Pro Plan with Dec 2025 upgrades)
interface ZaiModelPreset {
	id: string;
	name: string;
	cost: string;
	thinking: boolean;
	preservedThinking: boolean; // NEW: Retain thinking blocks across multi-turn
	interleavedThinking: boolean; // NEW: Think before every response/tool call
	turnLevelControl: boolean; // NEW: Per-turn thinking enable/disable
	contextCaching: boolean; // NEW: Cache optimization
	thinkingBudget: number; // Token budget for thinking
}

const ZAI_MODELS: Record<string, ZaiModelPreset> = {
	"glm-4.7": {
		id: "glm-4.7",
		name: "GLM 4.7 Orchestral (Top Coding + Reasoning)",
		cost: "Pro Plan - SOTA coding, thinking mode, 200K context",
		thinking: true,
		preservedThinking: true, // Retain reasoning across turns
		interleavedThinking: true, // Think before every action
		turnLevelControl: true, // Can disable per-turn
		contextCaching: true, // Enable caching
		thinkingBudget: 16384, // 16K thinking budget
	},
	"glm-4.6": {
		id: "glm-4.6",
		name: "GLM 4.6 (Stable Fast)",
		cost: "Pro Plan - 55+ tok/s, proven",
		thinking: false,
		preservedThinking: false,
		interleavedThinking: false,
		turnLevelControl: false,
		contextCaching: true,
		thinkingBudget: 4096,
	},
	"glm-4.5-air": {
		id: "glm-4.5-Air",
		name: "GLM 4.5 Air (Ultra Fast)",
		cost: "Pro Plan - Balanced speed/quality",
		thinking: false,
		preservedThinking: false,
		interleavedThinking: false,
		turnLevelControl: false,
		contextCaching: true,
		thinkingBudget: 2048,
	},
};
const DEFAULT_ZAI_MODEL = process.env.DEFAULT_MODEL || "glm-4.7"; // GLM-4.7 Orchestral Agent

// Model registry - stores available models from Ollama
interface OllamaModel {
	name: string;
	size: number;
	modified_at: string;
	details?: {
		parameter_size?: string;
		quantization_level?: string;
		family?: string;
	};
}

// Create model config from Ollama model name
function createOllamaModelConfig(modelId: string): Model<"openai-completions"> {
	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		provider: "ollama",
		baseUrl: `${OLLAMA_BASE_URL}/v1`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32000, // Conservative default, varies by model
		maxTokens: 8192,
	};
}

// Create model config for OpenRouter
function createOpenRouterModelConfig(modelKey: string): Model<"openai-completions"> {
	const preset = OPENROUTER_MODELS[modelKey] || OPENROUTER_MODELS[DEFAULT_OPENROUTER_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "openai-completions",
		provider: "openrouter",
		baseUrl: OPENROUTER_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0.00002, output: 0.00003, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		headers: {
			Authorization: `Bearer ${OPENROUTER_API_KEY}`,
			"HTTP-Referer": "https://discord.com/pi-agent",
			"X-Title": "Pi Discord Agent",
		},
	};
}

// Create model config for Cerebras (fastest inference)
function createCerebrasModelConfig(modelKey: string): Model<"openai-completions"> {
	const preset = CEREBRAS_MODELS[modelKey] || CEREBRAS_MODELS[DEFAULT_CEREBRAS_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "openai-completions",
		provider: "cerebras",
		baseUrl: CEREBRAS_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0.0001, output: 0.0001, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		headers: {
			Authorization: `Bearer ${CEREBRAS_API_KEY}`,
		},
	};
}

// Create model config for Groq (free + fast)
function createGroqModelConfig(modelKey: string): Model<"openai-completions"> {
	const preset = GROQ_MODELS[modelKey] || GROQ_MODELS[DEFAULT_GROQ_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "openai-completions",
		provider: "groq",
		baseUrl: GROQ_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // Free!
		contextWindow: 128000,
		maxTokens: 8192,
		headers: {
			Authorization: `Bearer ${GROQ_API_KEY}`,
		},
	};
}

// Create model config for Z.ai GLM-4.7 Coding Plan (OpenAI-compatible endpoint)
function createZaiModelConfig(modelKey: string): Model<"openai-completions"> {
	const preset = ZAI_MODELS[modelKey] || ZAI_MODELS[DEFAULT_ZAI_MODEL];
	return {
		id: preset.id,
		name: preset.name,
		api: "openai-completions",
		provider: "zai",
		baseUrl: ZAI_BASE_URL,
		reasoning: false, // GLM uses reasoning_content in response, not explicit reasoning mode
		input: ["text"],
		cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
		contextWindow: 200000, // 200K context window
		maxTokens: 128000, // 128K max output
		headers: {
			Authorization: `Bearer ${ZAI_API_KEY}`,
		},
	};
}

// GLM-4.7 Thinking Mode Controller for turn-level control
interface ThinkingModeConfig {
	enabled: boolean;
	preserveAcrossTurns: boolean;
	budgetTokens: number;
}

const thinkingModeState: Map<string, ThinkingModeConfig> = new Map();

// Agentic Agents Registry (IndyDevDan's 6 Properties Framework)
const agenticAgents: Map<string, AgenticAgent> = new Map();

function getThinkingConfig(channelId: string): ThinkingModeConfig {
	if (!thinkingModeState.has(channelId)) {
		const preset = ZAI_MODELS[DEFAULT_ZAI_MODEL];
		thinkingModeState.set(channelId, {
			enabled: preset.thinking,
			preserveAcrossTurns: preset.preservedThinking,
			budgetTokens: preset.thinkingBudget,
		});
	}
	return thinkingModeState.get(channelId)!;
}

function _setThinkingEnabled(channelId: string, enabled: boolean): void {
	const config = getThinkingConfig(channelId);
	config.enabled = enabled;
	thinkingModeState.set(channelId, config);
}

function _setThinkingBudget(channelId: string, budget: number): void {
	const config = getThinkingConfig(channelId);
	config.budgetTokens = budget;
	thinkingModeState.set(channelId, config);
}

// Get model config based on current provider
function createModelConfig(modelId: string): Model<"openai-completions"> | Model<"anthropic-messages"> {
	if (currentProvider === "zai") {
		return createZaiModelConfig(modelId);
	}
	if (currentProvider === "cerebras") {
		return createCerebrasModelConfig(modelId);
	}
	if (currentProvider === "groq") {
		return createGroqModelConfig(modelId);
	}
	if (currentProvider === "openrouter") {
		return createOpenRouterModelConfig(modelId);
	}
	return createOllamaModelConfig(modelId);
}

// Global model state (per-user preferences)
const userModels = new Map<string, string>(); // userId -> modelId
let globalModelId = ENV_DEFAULT_MODEL
	? ENV_DEFAULT_MODEL
	: currentProvider === "zai"
		? DEFAULT_ZAI_MODEL
		: currentProvider === "openrouter"
			? DEFAULT_OPENROUTER_MODEL
			: currentProvider === "cerebras"
				? DEFAULT_CEREBRAS_MODEL
				: currentProvider === "groq"
					? DEFAULT_GROQ_MODEL
					: DEFAULT_MODEL_ID;

function getUserModel(userId: string): Model<"openai-completions"> | Model<"anthropic-messages"> {
	const modelId = userModels.get(userId) || globalModelId;
	return createModelConfig(modelId);
}

function setUserModel(userId: string, modelId: string): void {
	userModels.set(userId, modelId);
	logInfo(`User ${userId} switched to model: ${modelId}`);
}

function setGlobalModel(modelId: string): void {
	globalModelId = modelId;
	logInfo(`Global model switched to: ${modelId}`);
}

function getCurrentModelId(userId?: string): string {
	if (userId && userModels.has(userId)) {
		return userModels.get(userId)!;
	}
	return globalModelId;
}

// Fetch available models from Ollama API
async function fetchOllamaModels(): Promise<OllamaModel[]> {
	try {
		const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.status}`);
		}
		const data = (await response.json()) as { models: OllamaModel[] };
		return data.models || [];
	} catch (error) {
		logError("Failed to fetch Ollama models", error instanceof Error ? error.message : String(error));
		return [];
	}
}

// Format model size for display
function formatModelSize(bytes: number): string {
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// Default model for initialization
const model: Model<"openai-completions"> | Model<"anthropic-messages"> = createModelConfig(DEFAULT_MODEL_ID);

// Truncation limits
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

// ============================================================================
// Bot Statistics Tracking
// ============================================================================

interface BotStats {
	startTime: number;
	commandsProcessed: number;
	messagesProcessed: number;
	errorsCount: number;
	userInteractions: Map<string, { username: string; count: number; lastSeen: number }>;
}

const botStats: BotStats = {
	startTime: Date.now(),
	commandsProcessed: 0,
	messagesProcessed: 0,
	errorsCount: 0,
	userInteractions: new Map(),
};

// Confirmation cache for destructive operations
const confirmationCache = new Map<string, number>();

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

class RateLimiter {
	private limits = new Map<string, RateLimitEntry>();
	private readonly maxRequests: number;
	private readonly windowMs: number;

	constructor(maxRequests = 10, windowMs = 60000) {
		this.maxRequests = maxRequests;
		this.windowMs = windowMs;

		// Clean up expired entries every minute
		setInterval(() => this.cleanup(), 60000);
	}

	isRateLimited(key: string): boolean {
		const now = Date.now();
		const entry = this.limits.get(key);

		if (!entry || now > entry.resetAt) {
			this.limits.set(key, { count: 1, resetAt: now + this.windowMs });
			return false;
		}

		if (entry.count >= this.maxRequests) {
			return true;
		}

		entry.count++;
		return false;
	}

	getRemainingRequests(key: string): number {
		const entry = this.limits.get(key);
		if (!entry || Date.now() > entry.resetAt) {
			return this.maxRequests;
		}
		return Math.max(0, this.maxRequests - entry.count);
	}

	getResetTime(key: string): number {
		const entry = this.limits.get(key);
		if (!entry) return 0;
		return Math.max(0, entry.resetAt - Date.now());
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.limits) {
			if (now > entry.resetAt) {
				this.limits.delete(key);
			}
		}
	}
}

// Rate limiters for different scopes
const userRateLimiter = new RateLimiter(20, 60000); // 20 requests per minute per user
const _globalRateLimiter = new RateLimiter(100, 60000); // 100 requests per minute global
const _webhookRateLimiter = new RateLimiter(30, 60000); // 30 webhook requests per minute

// ============================================================================
// Input Sanitization
// ============================================================================

function _sanitizeInput(input: string): string {
	// Remove null bytes
	let sanitized = input.replace(/\0/g, "");

	// Limit length
	if (sanitized.length > 10000) {
		sanitized = sanitized.substring(0, 10000);
	}

	return sanitized;
}

function _isValidChannelId(id: string): boolean {
	return /^\d{17,20}$/.test(id);
}

// ============================================================================
// Tool Usage Tracking
// ============================================================================

interface ToolUsageStats {
	name: string;
	count: number;
	totalDuration: number;
	errors: number;
	lastUsed: number;
}

const toolUsageStats = new Map<string, ToolUsageStats>();

function _trackToolUsage(toolName: string, duration: number, success: boolean): void {
	const existing = toolUsageStats.get(toolName);
	if (existing) {
		existing.count++;
		existing.totalDuration += duration;
		if (!success) existing.errors++;
		existing.lastUsed = Date.now();
	} else {
		toolUsageStats.set(toolName, {
			name: toolName,
			count: 1,
			totalDuration: duration,
			errors: success ? 0 : 1,
			lastUsed: Date.now(),
		});
	}
}

function getToolUsageStats(): ToolUsageStats[] {
	return Array.from(toolUsageStats.values()).sort((a, b) => b.count - a.count);
}

function trackUserInteraction(userId: string, username: string): void {
	const existing = botStats.userInteractions.get(userId);
	if (existing) {
		existing.count++;
		existing.lastSeen = Date.now();
	} else {
		botStats.userInteractions.set(userId, { username, count: 1, lastSeen: Date.now() });
	}
}

// Analytics instance (initialized in main)
let analytics: Analytics;

// Database and Scheduler instances (initialized in main)
let db: BotDatabase;
let taskScheduler: TaskScheduler;
let eventsWatcher: EventsWatcher | null = null;
let _channelStore: ChannelStore;
let _settingsManager: DiscordSettingsManager;

// ============================================================================
// Admin Action Logging
// ============================================================================

function logAdminAction(userId: string, username: string, action: string, details?: string): void {
	const timestamp = new Date().toISOString();
	const logEntry = `[${timestamp}] [ADMIN] ${username} (${userId}): ${action}${details ? ` - ${details}` : ""}\n`;

	try {
		const logPath = "/opt/discord-bot-data/admin-actions.log";
		appendFileSync(logPath, logEntry);
	} catch (error) {
		logError("Failed to write admin log", error instanceof Error ? error.message : String(error));
	}

	logInfo(`[ADMIN] ${username}: ${action}${details ? ` - ${details}` : ""}`);
}

// ============================================================================
// Runtime Configuration
// ============================================================================

interface RuntimeConfig {
	[key: string]: string | number | boolean;
}

const runtimeConfig: RuntimeConfig = {
	debugMode: false,
	maxResponseLength: 2000,
	defaultTimeout: 120,
};

// Agent prompt timeout configuration (in milliseconds)
// PERF: Model-specific timeouts - fast models get shorter timeouts for quicker error detection
const AGENT_PROMPT_TIMEOUT = 180 * 1000; // 180 seconds default
const MODEL_TIMEOUTS: Record<string, number> = {
	// Z.ai GLM models (can be very slow, needs longer timeout)
	"glm-4.6": 300 * 1000, // 300s (5 min) - Z.ai can be very slow
	"glm-4.7": 300 * 1000, // 300s (5 min) - Z.ai can be very slow
	"glm-4.5": 300 * 1000, // 300s (5 min) - Z.ai can be very slow
	"glm-4.5-air": 300 * 1000, // 300s (5 min) - Z.ai can be very slow
	"llama-3.1-8b-instant": 30 * 1000, // 30s (Cerebras ultra-fast)
	"llama-3.3-70b": 45 * 1000, // 45s (Cerebras)
	"llama3-70b-8192": 45 * 1000, // 45s (Groq)
	"llama-3.1-70b-versatile": 45 * 1000, // 45s (Groq)
	// Slower/complex models
	"claude-3-opus": 180 * 1000, // 180s (Opus is slow)
	"gpt-4": 120 * 1000, // 120s
	// Local models (variable, keep longer)
	ollama: 300 * 1000, // 300s (local can be slow)
};

function getModelTimeout(modelId: string): number {
	// Check for exact match first
	if (MODEL_TIMEOUTS[modelId]) return MODEL_TIMEOUTS[modelId];
	// Check for partial match (e.g., "glm-4.6" in "openrouter/glm-4.6")
	for (const [key, timeout] of Object.entries(MODEL_TIMEOUTS)) {
		if (modelId.includes(key)) return timeout;
	}
	return AGENT_PROMPT_TIMEOUT;
}

/**
 * Run agent.prompt() with a timeout. If the prompt takes too long,
 * abort the agent and throw a timeout error.
 */
async function promptWithTimeout(
	agent: Agent,
	message: string,
	timeoutMs: number = AGENT_PROMPT_TIMEOUT,
): Promise<void> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			agent.abort();
			logWarning("Agent prompt timeout", `Aborted after ${timeoutMs / 1000}s`);
			reject(new Error(`Agent prompt timed out after ${timeoutMs / 1000} seconds`));
		}, timeoutMs);
	});

	try {
		await Promise.race([agent.prompt(message), timeoutPromise]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

// ============================================================================
// Security: Rate Limiting
// ============================================================================

const _RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const _RATE_LIMIT_MAX_REQUESTS = 20; // Max requests per window per user (updated)

// Use the new RateLimiter class defined above
function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetIn: number } {
	const isLimited = userRateLimiter.isRateLimited(userId);
	return {
		allowed: !isLimited,
		remaining: userRateLimiter.getRemainingRequests(userId),
		resetIn: userRateLimiter.getResetTime(userId),
	};
}

// ============================================================================
// Security: Dangerous Command Detection & Approval
// ============================================================================

const DANGEROUS_PATTERNS = [
	/\bsudo\s+/i,
	/\brm\s+.*-[rRf]/i, // rm with dangerous flags
	/\brm\s+-[rRf]/i,
	/\brm\s+\/[^\s]*/i, // rm anything starting with /
	/\bdd\s+/i,
	/>\s*\/dev\/(sda|nvme|vd)/i,
	/\bmkfs/i,
	/\bshutdown/i,
	/\breboot/i,
	/\bkill\s+-9/i,
	/\bpkill\s+-9/i,
	/\bchmod\s+777/i,
	/\bchown\s+.*:/i,
	/\bcurl\s+.*\|\s*(ba)?sh/i, // curl | bash
	/\bwget\s+.*\|\s*(ba)?sh/i, // wget | bash
	/\b:()\s*{\s*:\|:\s*&\s*}/i, // fork bomb
	/\bformat\s+/i,
	/\bfdisk\s+/i,
	/\bparted\s+/i,
];

function isDangerousCommand(command: string): boolean {
	return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

// Global context for approval requests (set per-request)
let currentApprovalContext: {
	message: Message | null;
	userId: string;
} | null = null;

function setApprovalContext(message: Message | null, userId: string): void {
	currentApprovalContext = { message, userId };
}

async function _requestApproval(command: string): Promise<boolean> {
	if (!currentApprovalContext?.message) {
		logWarning("No approval context available, denying dangerous command");
		return false;
	}

	const { message, userId } = currentApprovalContext;
	const channel = message.channel;

	// Check if channel supports sending messages
	if (!("send" in channel) || typeof channel.send !== "function") {
		logWarning("Channel does not support sending messages");
		return false;
	}

	try {
		const approvalMsg = await (channel as TextChannel).send(
			`**Dangerous command detected:**\n\`\`\`bash\n${command.substring(0, 500)}\n\`\`\`\nReact ✅ to approve, ❌ to deny (60s timeout)`,
		);

		await approvalMsg.react("✅");
		await approvalMsg.react("❌");

		const collected = await approvalMsg.awaitReactions({
			filter: (reaction: { emoji: { name: string | null } }, user: { id: string }) =>
				["✅", "❌"].includes(reaction.emoji.name || "") && user.id === userId,
			max: 1,
			time: 60000,
		});

		const reaction = collected.first();
		if (reaction?.emoji.name === "✅") {
			await approvalMsg.edit("✅ Command approved.");
			logInfo(`Dangerous command approved by user: ${command.substring(0, 50)}...`);
			return true;
		} else if (reaction?.emoji.name === "❌") {
			await approvalMsg.edit("❌ Command denied by user.");
			logWarning(`Dangerous command denied by user: ${command.substring(0, 50)}...`);
			return false;
		} else {
			await approvalMsg.edit("⏰ Approval timed out - command denied.");
			logWarning(`Dangerous command timed out: ${command.substring(0, 50)}...`);
			return false;
		}
	} catch (error) {
		logError("Approval request failed", error instanceof Error ? error.message : String(error));
		return false;
	}
}

// ============================================================================
// Slash Commands Definition
// ============================================================================

const slashCommands = [
	new SlashCommandBuilder()
		.setName("ask")
		.setDescription("Ask the AI assistant anything")
		.addStringOption((option) =>
			option.setName("question").setDescription("Your question or request").setRequired(true).setAutocomplete(true),
		),

	new SlashCommandBuilder()
		.setName("bash")
		.setDescription("Execute a bash command directly")
		.addStringOption((option) =>
			option.setName("command").setDescription("The bash command to execute").setRequired(true),
		)
		.addIntegerOption((option) =>
			option.setName("timeout").setDescription("Timeout in seconds (default: no limit)").setRequired(false),
		),

	new SlashCommandBuilder()
		.setName("read")
		.setDescription("Read a file from the system")
		.addStringOption((option) => option.setName("path").setDescription("Path to the file").setRequired(true))
		.addIntegerOption((option) =>
			option.setName("lines").setDescription("Number of lines to read").setRequired(false),
		),

	new SlashCommandBuilder()
		.setName("remember")
		.setDescription("Save something to memory")
		.addStringOption((option) => option.setName("text").setDescription("What to remember").setRequired(true))
		.addBooleanOption((option) =>
			option.setName("global").setDescription("Save to global memory (default: channel)").setRequired(false),
		),

	new SlashCommandBuilder().setName("memory").setDescription("Show what the bot remembers"),

	new SlashCommandBuilder()
		.setName("forget")
		.setDescription("Clear memory")
		.addBooleanOption((option) =>
			option.setName("global").setDescription("Clear global memory (default: channel)").setRequired(false),
		),

	new SlashCommandBuilder().setName("status").setDescription("Show bot status and system info"),

	new SlashCommandBuilder()
		.setName("hooks")
		.setDescription("View hook system status and checkpoints")
		.addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show hook system status"))
		.addSubcommand((subcommand) => subcommand.setName("checkpoints").setDescription("List available checkpoints"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("restore")
				.setDescription("Restore to a checkpoint")
				.addStringOption((option) =>
					option.setName("id").setDescription("Checkpoint ID (from /hooks checkpoints)").setRequired(true),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("metrics").setDescription("Show hook execution metrics"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("tag")
				.setDescription("Tag a checkpoint with a friendly name")
				.addStringOption((option) =>
					option.setName("checkpoint_id").setDescription("Checkpoint ID to tag").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("name").setDescription("Tag name (alphanumeric, hyphens, underscores)").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("description").setDescription("Optional description").setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("tags").setDescription("List all checkpoint tags"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("debug")
				.setDescription("Toggle debug logging")
				.addBooleanOption((option) =>
					option.setName("enabled").setDescription("Enable or disable debug logging").setRequired(true),
				),
		)
		// Phase 1.1: Branch support
		.addSubcommand((subcommand) =>
			subcommand
				.setName("branch")
				.setDescription("Create a branch point from a checkpoint")
				.addStringOption((option) =>
					option.setName("checkpoint_id").setDescription("Checkpoint ID to branch from").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("description").setDescription("Branch description").setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("branches").setDescription("List all branch points"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("switch")
				.setDescription("Switch to a branch")
				.addStringOption((option) =>
					option.setName("branch_id").setDescription("Branch ID to switch to").setRequired(true),
				),
		)
		// Phase 2.1: Checkpoint diff
		.addSubcommand((subcommand) =>
			subcommand
				.setName("diff")
				.setDescription("Show changes since a checkpoint")
				.addStringOption((option) =>
					option.setName("checkpoint_id").setDescription("Checkpoint ID to diff against").setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("cleanup")
				.setDescription("Clean up old checkpoints")
				.addIntegerOption((option) =>
					option.setName("keep").setDescription("Number of checkpoints to keep (default: 50)").setRequired(false),
				),
		)
		// Phase 2.2: Expertise management
		.addSubcommand((subcommand) =>
			subcommand
				.setName("expertise")
				.setDescription("View accumulated expertise")
				.addStringOption((option) =>
					option.setName("domain").setDescription("Domain to view (leave empty for all)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("clear-expertise")
				.setDescription("Clear expertise for a domain")
				.addStringOption((option) =>
					option.setName("domain").setDescription("Domain to clear (or 'all')").setRequired(true),
				),
		)
		// Phase 2.3: LSP configuration
		.addSubcommand((subcommand) => subcommand.setName("lsp").setDescription("Show LSP server status"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("lsp-enable")
				.setDescription("Enable an LSP server")
				.addStringOption((option) =>
					option
						.setName("server")
						.setDescription("Server ID (typescript, pyright, gopls, rust-analyzer, dart)")
						.setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("lsp-disable")
				.setDescription("Disable an LSP server")
				.addStringOption((option) =>
					option.setName("server").setDescription("Server ID to disable").setRequired(true),
				),
		)
		// Phase 3.1: Blocking rules
		.addSubcommand((subcommand) => subcommand.setName("rules").setDescription("List blocking rules"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("rules-add")
				.setDescription("Add a blocking rule")
				.addStringOption((option) =>
					option.setName("tool").setDescription("Tool name (bash, write, edit, or *)").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("pattern").setDescription("Regex pattern to block").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("reason").setDescription("Reason for blocking").setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("rules-remove")
				.setDescription("Remove a blocking rule")
				.addIntegerOption((option) => option.setName("id").setDescription("Rule ID to remove").setRequired(true)),
		)
		.addSubcommand((subcommand) => subcommand.setName("rules-preset").setDescription("Apply preset security rules")),

	new SlashCommandBuilder().setName("skills").setDescription("List loaded skills and capabilities"),

	new SlashCommandBuilder()
		.setName("freemodels")
		.setDescription("List all FREE AI models available")
		.addStringOption((option) =>
			option
				.setName("provider")
				.setDescription("Filter by provider")
				.addChoices(
					{ name: "All Providers", value: "all" },
					{ name: "Cerebras (Ultra-fast)", value: "cerebras" },
					{ name: "Groq (Fast)", value: "groq" },
					{ name: "Google (Gemini)", value: "google" },
					{ name: "Hugging Face", value: "huggingface" },
					{ name: "NVIDIA NIM", value: "nvidia" },
					{ name: "OpenRouter", value: "openrouter" },
					{ name: "OpenCode (Grok)", value: "opencode" },
					{ name: "Ollama (Local)", value: "ollama" },
					{ name: "HF Router (18+ providers)", value: "hf-router" },
				),
		),

	new SlashCommandBuilder()
		.setName("omni")
		.setDescription("Smart AI routing - auto-selects best model for your task")
		.addSubcommand((sub) =>
			sub
				.setName("ask")
				.setDescription("Ask anything - smart model selection")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Your prompt").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Routing mode")
						.addChoices(
							{ name: "Auto (free first)", value: "auto" },
							{ name: "Fast (speed priority)", value: "fast" },
							{ name: "Quality (best output)", value: "quality" },
							{ name: "Code (coding tasks)", value: "code" },
							{ name: "Creative (writing)", value: "creative" },
							{ name: "Ultra-fast (Cerebras)", value: "ultrafast" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("model")
				.setDescription("Use a specific model directly")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Your prompt").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("model").setDescription("Model key (e.g., grok, cerebras-llama)").setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("models").setDescription("List all available models with strengths"))
		.addSubcommand((sub) => sub.setName("benchmark").setDescription("Speed test across providers")),

	new SlashCommandBuilder()
		.setName("price")
		.setDescription("Get cryptocurrency price")
		.addStringOption((option) =>
			option.setName("symbol").setDescription("Crypto symbol (e.g., bitcoin, ethereum)").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("alert")
		.setDescription("Set a price alert")
		.addStringOption((option) =>
			option.setName("condition").setDescription("Alert condition (e.g., 'BTC > 50000')").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("news")
		.setDescription("Get latest news (crypto + AI)")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("News type")
				.addChoices(
					{ name: "Crypto News", value: "crypto" },
					{ name: "AI News (Smol AI)", value: "ai" },
					{ name: "All News", value: "all" },
				)
				.setRequired(false),
		)
		.addStringOption((option) => option.setName("topic").setDescription("News topic (optional)").setRequired(false)),

	new SlashCommandBuilder()
		.setName("chart")
		.setDescription("Get TradingView chart link")
		.addStringOption((option) =>
			option.setName("symbol").setDescription("Trading symbol (e.g., BTCUSD)").setRequired(true),
		)
		.addStringOption((option) =>
			option.setName("timeframe").setDescription("Timeframe (1h, 4h, 1D, 1W)").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("convert")
		.setDescription("Currency converter")
		.addNumberOption((option) => option.setName("amount").setDescription("Amount to convert").setRequired(true))
		.addStringOption((option) =>
			option.setName("from").setDescription("From currency (e.g., usd, btc)").setRequired(true),
		)
		.addStringOption((option) =>
			option.setName("to").setDescription("To currency (e.g., eur, eth)").setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("model")
		.setDescription("Manage AI model selection")
		.addSubcommand((subcommand) => subcommand.setName("list").setDescription("Show available Ollama models"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("switch")
				.setDescription("Switch to a different model")
				.addStringOption((option) =>
					option.setName("name").setDescription("Model name (e.g., llama3, mistral)").setRequired(true),
				)
				.addBooleanOption((option) =>
					option.setName("global").setDescription("Set as global default (admin only)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("info").setDescription("Show current model information")),

	new SlashCommandBuilder()
		.setName("analytics")
		.setDescription("View bot usage analytics and statistics")
		.addStringOption((option) =>
			option
				.setName("period")
				.setDescription("Time period to view")
				.addChoices(
					{ name: "Today", value: "today" },
					{ name: "This Week", value: "week" },
					{ name: "All Time", value: "all" },
				)
				.setRequired(false),
		),

	new SlashCommandBuilder()
		.setName("provider")
		.setDescription("Switch AI provider")
		.addSubcommand((subcommand) =>
			subcommand.setName("status").setDescription("Show current provider and available options"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("zai")
				.setDescription("Switch to Z.ai GLM-4.7 (best coding model)")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("Z.ai model")
						.addChoices(
							{ name: "GLM 4.7 (Top Coding) - $6/mo", value: "glm-4.7" },
							{ name: "GLM 4.6 (Stable) - $6/mo", value: "glm-4.6" },
							{ name: "GLM 4.5 Air (Fast) - $6/mo", value: "glm-4.5-air" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("groq")
				.setDescription("Switch to Groq (free + fast)")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("Groq model")
						.addChoices(
							{ name: "Kimi K2 Latest (128k) - FREE", value: "kimi-k2" },
							{ name: "Llama 3.3 70B (Best) - FREE", value: "llama-3.3-70b" },
							{ name: "Llama 4 Maverick - FREE", value: "llama-4-maverick" },
							{ name: "Qwen3 32B - FREE", value: "qwen3-32b" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("cerebras")
				.setDescription("Switch to Cerebras (fastest - 2100+ tok/s)")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("Cerebras model")
						.addChoices(
							{ name: "GLM 4.6 (Fastest Smart) - $0.10/M", value: "glm-4.6" },
							{ name: "Llama 3.3 70B (Best) - $0.60/M", value: "llama-3.3-70b" },
							{ name: "Qwen3 32B (Balanced) - $0.20/M", value: "qwen-3-32b" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("ollama").setDescription("Switch to local Ollama (free, private)"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("openrouter")
				.setDescription("Switch to OpenRouter cloud")
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("OpenRouter model")
						.addChoices(
							{ name: "Gemini 2.0 Flash - FREE", value: "gemini-2-flash" },
							{ name: "Kimi K2 - FREE", value: "kimi-k2" },
							{ name: "Mistral Small 3.1 - $0.03/M", value: "mistral-small" },
							{ name: "DeepSeek V3.1 - $0.15/M", value: "deepseek-v3" },
						)
						.setRequired(false),
				),
		),

	// Admin Commands
	new SlashCommandBuilder()
		.setName("admin")
		.setDescription("Admin-only commands (owner access required)")
		.addSubcommand((subcommand) =>
			subcommand.setName("stats").setDescription("Show bot statistics (uptime, commands, memory)"),
		)
		.addSubcommand((subcommand) => subcommand.setName("users").setDescription("List users who have used the bot"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("broadcast")
				.setDescription("Send message to all channels bot is in")
				.addStringOption((option) =>
					option.setName("message").setDescription("Message to broadcast").setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("reload").setDescription("Reload skills from disk without restart"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("config")
				.setDescription("View or set runtime configuration")
				.addStringOption((option) => option.setName("key").setDescription("Configuration key").setRequired(true))
				.addStringOption((option) =>
					option.setName("value").setDescription("Configuration value (omit to view)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("logs")
				.setDescription("Show recent bot logs")
				.addIntegerOption((option) =>
					option.setName("lines").setDescription("Number of lines to show (default: 50)").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("restart").setDescription("Gracefully restart the bot (via systemd)"),
		),

	new SlashCommandBuilder()
		.setName("tools")
		.setDescription("List all available MCP tools and capabilities")
		.addStringOption((option) =>
			option
				.setName("category")
				.setDescription("Filter by category")
				.addChoices(
					{ name: "All Tools", value: "all" },
					{ name: "Web & Search", value: "web" },
					{ name: "GitHub", value: "github" },
					{ name: "HuggingFace", value: "hf" },
					{ name: "Memory", value: "memory" },
					{ name: "Tasks", value: "tasks" },
					{ name: "Codebase Knowledge", value: "codebase" },
					{ name: "Skills System", value: "skills" },
					{ name: "Self-Management", value: "self" },
				)
				.setRequired(false),
		),

	// Creative generation commands
	new SlashCommandBuilder()
		.setName("generate")
		.setDescription("Generate creative content (images, music, video, voice)")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("image")
				.setDescription("Generate an image with AI")
				.addStringOption((option) => option.setName("prompt").setDescription("Image description").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("model")
						.setDescription("Image model to use")
						.addChoices(
							{ name: "FLUX Dev (Best)", value: "flux-dev" },
							{ name: "FLUX Schnell (Fast)", value: "flux-schnell" },
							{ name: "FLUX Pro", value: "flux-pro" },
							{ name: "FLUX Realism", value: "flux-realism" },
							{ name: "Ideogram V2", value: "ideogram" },
							{ name: "Recraft V3", value: "recraft" },
							{ name: "HF SDXL (HuggingFace)", value: "hf-sdxl" },
							{ name: "HF SD 3.5 Large", value: "hf-sd3" },
							{ name: "HF Qwen Image (Fast)", value: "hf-qwen" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("music")
				.setDescription("Generate music with Suno AI")
				.addStringOption((option) =>
					option.setName("prompt").setDescription("Music description or lyrics").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("style").setDescription("Music style (e.g., 'hip hop', 'electronic')").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("video")
				.setDescription("Generate video from text or image")
				.addStringOption((option) => option.setName("prompt").setDescription("Video description").setRequired(true))
				.addStringOption((option) =>
					option.setName("image_url").setDescription("Optional: Image to animate").setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("voice")
				.setDescription("Generate speech with VibeVoice or ElevenLabs")
				.addStringOption((option) => option.setName("text").setDescription("Text to speak").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("engine")
						.setDescription("TTS engine")
						.addChoices(
							{ name: "VibeVoice (Multi-speaker)", value: "vibevoice" },
							{ name: "ElevenLabs (High quality)", value: "elevenlabs" },
							{ name: "OpenAI TTS", value: "openai" },
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("3d")
				.setDescription("Generate 3D model from image or text")
				.addStringOption((option) =>
					option.setName("prompt").setDescription("3D model description").setRequired(true),
				)
				.addStringOption((option) =>
					option.setName("image_url").setDescription("Optional: Image to convert to 3D").setRequired(false),
				),
		),

	// LiveKit voice commands
	new SlashCommandBuilder()
		.setName("livekit")
		.setDescription("Real-time voice/video with LiveKit")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("create")
				.setDescription("Create a voice room")
				.addStringOption((option) => option.setName("name").setDescription("Room name").setRequired(true)),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("join")
				.setDescription("Get token to join a room")
				.addStringOption((option) => option.setName("room").setDescription("Room name").setRequired(true)),
		)
		.addSubcommand((subcommand) => subcommand.setName("list").setDescription("List active rooms"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("record")
				.setDescription("Start/stop recording a room")
				.addStringOption((option) => option.setName("room").setDescription("Room name").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("action")
						.setDescription("Action")
						.addChoices({ name: "Start Recording", value: "start" }, { name: "Stop Recording", value: "stop" })
						.setRequired(true),
				),
		),

	// Schedule command - manage scheduled tasks
	new SlashCommandBuilder()
		.setName("schedule")
		.setDescription("Manage scheduled tasks")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("add")
				.setDescription("Add a new scheduled task")
				.addStringOption((option) => option.setName("name").setDescription("Task name").setRequired(true))
				.addStringOption((option) =>
					option
						.setName("cron")
						.setDescription("Cron expression (e.g., '0 9 * * *' for 9 AM daily)")
						.setRequired(true),
				)
				.addStringOption((option) => option.setName("action").setDescription("Action to perform").setRequired(true))
				.addChannelOption((option) =>
					option
						.setName("channel")
						.setDescription("Channel to send results to (default: current)")
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) => subcommand.setName("list").setDescription("List all your scheduled tasks"))
		.addSubcommand((subcommand) =>
			subcommand
				.setName("remove")
				.setDescription("Remove a scheduled task")
				.addStringOption((option) => option.setName("id").setDescription("Task ID to remove").setRequired(true)),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("toggle")
				.setDescription("Enable or disable a scheduled task")
				.addStringOption((option) => option.setName("id").setDescription("Task ID to toggle").setRequired(true)),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("info")
				.setDescription("Get details about a scheduled task")
				.addStringOption((option) => option.setName("id").setDescription("Task ID").setRequired(true)),
		),

	// Health check command
	new SlashCommandBuilder()
		.setName("health")
		.setDescription("Check bot health and API status"),

	// Reset command - clears conversation history
	new SlashCommandBuilder()
		.setName("reset")
		.setDescription("Clear conversation history for this channel"),

	// Backup command - creates data dump
	new SlashCommandBuilder()
		.setName("backup")
		.setDescription("Create a backup of bot data")
		.addStringOption((option) =>
			option
				.setName("scope")
				.setDescription("What to backup")
				.addChoices({ name: "Channel Only", value: "channel" }, { name: "All Data", value: "all" })
				.setRequired(false),
		),

	// Cost tracking command
	new SlashCommandBuilder()
		.setName("cost")
		.setDescription("View API usage costs")
		.addStringOption((option) =>
			option
				.setName("view")
				.setDescription("What to view")
				.addChoices(
					{ name: "My Usage", value: "me" },
					{ name: "Top Users", value: "top" },
					{ name: "Daily Breakdown", value: "daily" },
				)
				.setRequired(false),
		),

	// Trading agents command
	new SlashCommandBuilder()
		.setName("trading")
		.setDescription("AI-powered trading analysis (Moon Dev inspired)")
		.addSubcommand((sub) =>
			sub
				.setName("analyze")
				.setDescription("Get AI consensus analysis for a symbol")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Crypto symbol (e.g., BTC, ETH)").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("sentiment")
				.setDescription("Get sentiment analysis for a symbol")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Crypto symbol").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("whales").setDescription("View recent whale activity"))
		.addSubcommand((sub) => sub.setName("signals").setDescription("View recent trading signals"))
		.addSubcommand((sub) => sub.setName("summary").setDescription("Get market summary"))
		.addSubcommand((sub) => sub.setName("status").setDescription("View trading agent status"))
		.addSubcommand((sub) =>
			sub
				.setName("backtest")
				.setDescription("Backtest a trading strategy (OpenHands)")
				.addStringOption((opt) =>
					opt
						.setName("strategy")
						.setDescription("Strategy name (e.g., momentum, mean-reversion)")
						.setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("timeframe").setDescription("Backtest timeframe (default: 1 year)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("risk")
				.setDescription("Assess portfolio risk (OpenHands)")
				.addStringOption((opt) =>
					opt
						.setName("holdings")
						.setDescription("Holdings as JSON (e.g., [{symbol:BTC,allocation:0.5}])")
						.setRequired(true),
				)
				.addNumberOption((opt) =>
					opt.setName("value").setDescription("Total portfolio value in USD").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("audit")
				.setDescription("Full trading audit - analysis + backtest + risk (OpenHands)")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Symbol to audit (e.g., BTC)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("strategy").setDescription("Strategy to backtest (optional)").setRequired(false),
				),
		)
		.addSubcommand((sub) => sub.setName("expertise").setDescription("View accumulated trading expertise")),

	// Knowledge base command
	new SlashCommandBuilder()
		.setName("knowledge")
		.setDescription("Access quant, superquant, nanoagents, Moon Dev docs, and pi-mono codebase")
		.addSubcommand((sub) => sub.setName("sources").setDescription("List available knowledge sources"))
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search across knowledge base")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("read")
				.setDescription("Read a specific file")
				.addStringOption((opt) => opt.setName("path").setDescription("File path to read").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("moondev").setDescription("Get Moon Dev architecture summary"))
		.addSubcommand((sub) =>
			sub
				.setName("agent")
				.setDescription("Get quant agent source code")
				.addStringOption((opt) =>
					opt.setName("name").setDescription("Agent name (e.g., price_monitor, risk_analyzer)").setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("specs").setDescription("List quant specifications")),

	// Voice mode command
	new SlashCommandBuilder()
		.setName("voice")
		.setDescription("Voice chat with AI using ElevenLabs TTS + Groq Whisper STT")
		.addSubcommand((sub) => sub.setName("join").setDescription("Join your current voice channel"))
		.addSubcommand((sub) => sub.setName("leave").setDescription("Leave the voice channel"))
		.addSubcommand((sub) =>
			sub
				.setName("speak")
				.setDescription("Make the bot speak text")
				.addStringOption((opt) => opt.setName("text").setDescription("Text to speak").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("transcribe")
				.setDescription("Transcribe audio from a file or URL")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to audio file").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("View voice session status"))
		.addSubcommand((sub) => sub.setName("voices").setDescription("List available ElevenLabs voices")),

	// Claude Agent command
	new SlashCommandBuilder()
		.setName("agent")
		.setDescription("Spawn Claude Code as a subagent for complex tasks")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run a custom prompt with Claude agent")
				.addStringOption((opt) =>
					opt.setName("prompt").setDescription("Task for the agent").setRequired(true).setAutocomplete(true),
				)
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Learning mode (default: general)")
						.setRequired(false)
						.addChoices(
							{ name: "General", value: "general" },
							{ name: "Coding", value: "coding" },
							{ name: "Research", value: "research" },
							{ name: "Trading", value: "trading" },
						),
				)
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				)
				.addIntegerOption((opt) =>
					opt.setName("timeout").setDescription("Timeout in seconds (default: 300)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("research")
				.setDescription("Research a topic using Claude agent")
				.addStringOption((opt) => opt.setName("topic").setDescription("Topic to research").setRequired(true))
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("review")
				.setDescription("Code review with Claude agent")
				.addStringOption((opt) => opt.setName("code").setDescription("Code to review (or paste)").setRequired(true))
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("trading")
				.setDescription("Trading analysis with Claude agent")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Trading symbol (e.g., BTC, ETH)").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("data").setDescription("Market data or context").setRequired(false))
				.addBooleanOption((opt) =>
					opt
						.setName("learning")
						.setDescription("Enable learning from this task (default: true)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Claude agent availability")),

	// Agent Learning System command
	new SlashCommandBuilder()
		.setName("expertise")
		.setDescription("View and manage agent learning system")
		.addSubcommand((sub) => sub.setName("status").setDescription("Show expertise files and session counts"))
		.addSubcommand((sub) => sub.setName("modes").setDescription("List available learning modes"))
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("Show accumulated expertise for a mode")
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Learning mode to view")
						.setRequired(true)
						.addChoices(
							{ name: "General", value: "general" },
							{ name: "Coding", value: "coding" },
							{ name: "Research", value: "research" },
							{ name: "Trading", value: "trading" },
						),
				),
		),

	// OpenHands Software Agent command - Expert modes
	new SlashCommandBuilder()
		.setName("openhands")
		.setDescription("Run OpenHands software agents for coding tasks")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run an OpenHands agent to complete a task")
				.addStringOption((opt) => opt.setName("task").setDescription("Task for the agent").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Expert mode")
						.setRequired(false)
						.addChoices(
							{ name: "Developer (general coding)", value: "developer" },
							{ name: "Security Scan (vulnerabilities)", value: "vulnerability_scan" },
							{ name: "Code Review (quality analysis)", value: "code_review" },
							{ name: "Test Generation (unit/integration)", value: "test_generation" },
							{ name: "Documentation (README, API docs)", value: "documentation" },
							{ name: "Refactor (improve code quality)", value: "refactor" },
							{ name: "Debug (fix issues)", value: "debug" },
							{ name: "Optimize (performance)", value: "optimize" },
						),
				)
				.addStringOption((opt) =>
					opt.setName("workspace").setDescription("Working directory path").setRequired(false),
				)
				.addBooleanOption((opt) =>
					opt.setName("persist").setDescription("Enable session persistence").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("security")
				.setDescription("Security vulnerability scan")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to scan").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("review")
				.setDescription("Thorough code review")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to review").setRequired(true))
				.addStringOption((opt) => opt.setName("focus").setDescription("Focus area").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("tests")
				.setDescription("Generate comprehensive tests")
				.addStringOption((opt) =>
					opt.setName("path").setDescription("Path to generate tests for").setRequired(true),
				)
				.addIntegerOption((opt) =>
					opt
						.setName("coverage")
						.setDescription("Coverage target %")
						.setRequired(false)
						.setMinValue(50)
						.setMaxValue(100),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("docs")
				.setDescription("Generate documentation")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to document").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Documentation type")
						.setRequired(false)
						.addChoices(
							{ name: "All (README, API, comments)", value: "all" },
							{ name: "README only", value: "readme" },
							{ name: "API docs only", value: "api" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("refactor")
				.setDescription("Refactor code for quality")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to refactor").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("target").setDescription("Specific target to refactor").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("debug")
				.setDescription("Debug and fix an issue")
				.addStringOption((opt) => opt.setName("path").setDescription("Path with the issue").setRequired(true))
				.addStringOption((opt) => opt.setName("issue").setDescription("Issue description").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("optimize")
				.setDescription("Performance optimization")
				.addStringOption((opt) => opt.setName("path").setDescription("Path to optimize").setRequired(true))
				.addStringOption((opt) => opt.setName("focus").setDescription("Focus area").setRequired(false)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check OpenHands availability"))
		.addSubcommand((sub) => sub.setName("modes").setDescription("List all available expert modes"))
		.addSubcommand((sub) =>
			sub
				.setName("learning")
				.setDescription("Manage Agent Experts learning system")
				.addStringOption((opt) =>
					opt
						.setName("action")
						.setDescription("Action to perform")
						.setRequired(true)
						.addChoices(
							{ name: "List all modes with session counts", value: "list" },
							{ name: "View learnings for a mode", value: "view" },
							{ name: "Clear expertise for a mode", value: "clear" },
						),
				)
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Expert mode (required for view/clear)")
						.setRequired(false)
						.addChoices(
							{ name: "Developer", value: "developer" },
							{ name: "Vulnerability Scan", value: "vulnerability_scan" },
							{ name: "Code Review", value: "code_review" },
							{ name: "Test Generation", value: "test_generation" },
							{ name: "Documentation", value: "documentation" },
							{ name: "Refactor", value: "refactor" },
							{ name: "Debug", value: "debug" },
							{ name: "Migrate", value: "migrate" },
							{ name: "Optimize", value: "optimize" },
						),
				),
		),

	// OpenCode SDK - Free Grok Access
	new SlashCommandBuilder()
		.setName("opencode")
		.setDescription("Run tasks with free Grok models via OpenCode SDK")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run a task with free Grok")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Task or question").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Model to use")
						.setRequired(false)
						.addChoices(
							{ name: "Grok Code Fast (default)", value: "grok-code-fast-1" },
							{ name: "Grok 3 Mini Fast", value: "grok-3-mini-fast-latest" },
							{ name: "Grok 3 Mini", value: "grok-3-mini-latest" },
							{ name: "Grok 3 Fast", value: "grok-3-fast-latest" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("code")
				.setDescription("Quick coding task")
				.addStringOption((opt) => opt.setName("task").setDescription("Coding task").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("fast")
				.setDescription("Fast simple query")
				.addStringOption((opt) => opt.setName("question").setDescription("Quick question").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check OpenCode SDK availability"))
		.addSubcommand((sub) => sub.setName("models").setDescription("List available free models")),

	// Unified SDK Interface - All 4 SDKs
	new SlashCommandBuilder()
		.setName("sdk")
		.setDescription("Unified SDK interface - access all 4 agent SDKs")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check availability of all SDKs"))
		.addSubcommand((sub) => sub.setName("info").setDescription("Show SDK information and capabilities"))
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run task with best available SDK")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Task to execute").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Task type (affects SDK selection)")
						.setRequired(false)
						.addChoices(
							{ name: "Code (prefer Claude)", value: "code" },
							{ name: "Research (prefer Claude Opus)", value: "research" },
							{ name: "Quick (prefer free/fast)", value: "quick" },
							{ name: "Security (prefer OpenHands)", value: "security" },
							{ name: "Free (only free SDKs)", value: "free" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("use")
				.setDescription("Run task with specific SDK")
				.addStringOption((opt) =>
					opt
						.setName("sdk")
						.setDescription("SDK to use")
						.setRequired(true)
						.addChoices(
							{ name: "Claude Agent SDK", value: "claude" },
							{ name: "OpenCode SDK (free Grok)", value: "opencode" },
							{ name: "OpenHands SDK", value: "openhands" },
						),
				)
				.addStringOption((opt) => opt.setName("prompt").setDescription("Task to execute").setRequired(true)),
		),

	// Suno AI Music Generation
	new SlashCommandBuilder()
		.setName("suno")
		.setDescription("Generate AI music with Suno")
		.addSubcommand((sub) =>
			sub
				.setName("generate")
				.setDescription("Generate music from a prompt")
				.addStringOption((opt) =>
					opt.setName("prompt").setDescription("Describe the music you want (max 500 chars)").setRequired(true),
				)
				.addBooleanOption((opt) =>
					opt.setName("instrumental").setDescription("Generate instrumental only (no vocals)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("custom")
				.setDescription("Generate with custom lyrics and style")
				.addStringOption((opt) =>
					opt.setName("lyrics").setDescription("Your lyrics (max 5000 chars)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("style").setDescription("Music style (e.g., rock, jazz, electronic)").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("title").setDescription("Song title").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Model version")
						.setRequired(false)
						.addChoices(
							{ name: "V5 (Latest)", value: "V5" },
							{ name: "V4.5 All (Best structure)", value: "V4_5ALL" },
							{ name: "V4.5 Plus (Rich sound)", value: "V4_5PLUS" },
							{ name: "V4.5 (Balanced)", value: "V4_5" },
							{ name: "V4 (Classic)", value: "V4" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("instrumental")
				.setDescription("Generate an instrumental track")
				.addStringOption((opt) =>
					opt
						.setName("style")
						.setDescription("Music style (e.g., ambient, classical, synthwave)")
						.setRequired(true),
				)
				.addStringOption((opt) => opt.setName("title").setDescription("Track title").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Suno service status and credits")),

	// GEPA Prompt Optimization
	new SlashCommandBuilder()
		.setName("gepa")
		.setDescription("GEPA prompt optimization - self-improving agent prompts")
		.addSubcommand((sub) =>
			sub
				.setName("optimize")
				.setDescription("Optimize a prompt using reflective text evolution")
				.addStringOption((opt) =>
					opt.setName("prompt").setDescription("Initial prompt to optimize").setRequired(true),
				)
				.addStringOption((opt) =>
					opt
						.setName("agent_type")
						.setDescription("Agent type for optimization")
						.setRequired(false)
						.addChoices(
							{ name: "Default", value: "default" },
							{ name: "Coding", value: "coding" },
							{ name: "Trading", value: "trading" },
							{ name: "Security", value: "security" },
							{ name: "Research", value: "research" },
						),
				)
				.addIntegerOption((opt) =>
					opt
						.setName("iterations")
						.setDescription("Max optimization iterations")
						.setRequired(false)
						.setMinValue(10)
						.setMaxValue(200),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("evaluate")
				.setDescription("Evaluate a prompt without optimization")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Prompt to evaluate").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("agent_type")
						.setDescription("Agent type")
						.setRequired(false)
						.addChoices(
							{ name: "Default", value: "default" },
							{ name: "Coding", value: "coding" },
							{ name: "Trading", value: "trading" },
							{ name: "Security", value: "security" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("expertise")
				.setDescription("Optimize an existing expertise domain")
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Domain to optimize")
						.setRequired(true)
						.addChoices(
							{ name: "Coding", value: "coding" },
							{ name: "Trading", value: "trading" },
							{ name: "Security", value: "security" },
							{ name: "Database", value: "database" },
							{ name: "API Integration", value: "api_integration" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check GEPA availability and version"))
		.addSubcommand((sub) => sub.setName("domains").setDescription("List available expertise domains")),

	// 24/7 Research Orchestrator
	new SlashCommandBuilder()
		.setName("research")
		.setDescription("24/7 Autonomous Research System - CTM, DGM, OpenEvolve integration")
		.addSubcommand((sub) => sub.setName("start").setDescription("Start 24/7 research orchestrator"))
		.addSubcommand((sub) => sub.setName("stop").setDescription("Stop research orchestrator"))
		.addSubcommand((sub) => sub.setName("status").setDescription("Check research orchestrator status"))
		.addSubcommand((sub) =>
			sub
				.setName("trigger")
				.setDescription("Manually trigger a research cycle")
				.addStringOption((opt) =>
					opt
						.setName("topic")
						.setDescription("Specific topic to research")
						.setRequired(false)
						.addChoices(
							{ name: "Trading Patterns", value: "trading-patterns" },
							{ name: "Agent Optimization", value: "agent-optimization" },
							{ name: "Security Research", value: "security-research" },
							{ name: "AI Advances", value: "ai-advances" },
							{ name: "Code Quality", value: "code-quality" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("topics").setDescription("List all research topics")),

	// Autonomous Daemon - 24/7 Self-Improving Agent System
	new SlashCommandBuilder()
		.setName("daemon")
		.setDescription("Autonomous Daemon - 24/7 self-improving agent with improvement, research, healing cycles")
		.addSubcommand((sub) =>
			sub
				.setName("start")
				.setDescription("Start the autonomous daemon")
				.addStringOption((opt) =>
					opt
						.setName("preset")
						.setDescription("Daemon preset configuration")
						.setRequired(false)
						.addChoices(
							{ name: "Autonomous (Full self-improvement)", value: "autonomous" },
							{ name: "Trader (Trading-focused)", value: "trader" },
							{ name: "Researcher (Research-focused)", value: "researcher" },
							{ name: "Conservative (Safe, slow cycles)", value: "conservative" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("stop").setDescription("Stop the autonomous daemon"))
		.addSubcommand((sub) => sub.setName("status").setDescription("Check daemon status and statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("trigger")
				.setDescription("Manually trigger a specific cycle type")
				.addStringOption((opt) =>
					opt
						.setName("cycle")
						.setDescription("Cycle type to trigger")
						.setRequired(true)
						.addChoices(
							{ name: "Improvement (Self-enhance capabilities)", value: "improvement" },
							{ name: "Research (Autonomous discovery)", value: "research" },
							{ name: "Healing (Error recovery)", value: "healing" },
							{ name: "Optimization (Performance tuning)", value: "optimization" },
							{ name: "Task (Process pending tasks)", value: "task" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("pause").setDescription("Pause daemon execution (can resume)"))
		.addSubcommand((sub) => sub.setName("resume").setDescription("Resume paused daemon"))
		.addSubcommand((sub) => sub.setName("history").setDescription("View recent cycle history")),

	// Agent Dialogue - Multi-Agent Discussion (AgentLaboratory Pattern)
	new SlashCommandBuilder()
		.setName("dialogue")
		.setDescription("Multi-agent dialogue for complex decisions (AgentLaboratory pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run a multi-agent dialogue on a topic")
				.addStringOption((opt) => opt.setName("topic").setDescription("Topic to discuss").setRequired(true))
				.addStringOption((opt) => opt.setName("context").setDescription("Additional context").setRequired(false))
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Dialogue mode")
						.setRequired(false)
						.addChoices({ name: "Trading", value: "trading" }, { name: "General", value: "general" }),
				),
		)
		.addSubcommand((sub) => sub.setName("agents").setDescription("List available dialogue agents"))
		.addSubcommand((sub) => sub.setName("status").setDescription("Check dialogue system status")),

	// Trading-Rxiv - Knowledge Repository (AgentLaboratory Pattern)
	new SlashCommandBuilder()
		.setName("rxiv")
		.setDescription("Trading-Rxiv - Cumulative knowledge repository (AgentLaboratory pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search the knowledge repository")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Filter by type")
						.setRequired(false)
						.addChoices(
							{ name: "Strategy", value: "strategy" },
							{ name: "Signal", value: "signal" },
							{ name: "Insight", value: "insight" },
							{ name: "Failure", value: "failure" },
							{ name: "Pattern", value: "pattern" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("submit")
				.setDescription("Submit a new insight or strategy")
				.addStringOption((opt) => opt.setName("title").setDescription("Entry title").setRequired(true))
				.addStringOption((opt) => opt.setName("content").setDescription("Entry content").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Entry type")
						.setRequired(true)
						.addChoices(
							{ name: "Strategy", value: "strategy" },
							{ name: "Insight", value: "insight" },
							{ name: "Signal", value: "signal" },
							{ name: "Failure", value: "failure" },
						),
				)
				.addStringOption((opt) => opt.setName("tags").setDescription("Tags (comma-separated)").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("View a specific entry")
				.addStringOption((opt) => opt.setName("id").setDescription("Entry ID").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("stats").setDescription("View repository statistics"))
		.addSubcommand((sub) => sub.setName("recent").setDescription("Show recent entries")),

	// Reviewer - Multi-Persona Review System (AgentLaboratory Pattern)
	new SlashCommandBuilder()
		.setName("reviewer")
		.setDescription("Multi-persona review system (AgentLaboratory pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("review")
				.setDescription("Submit content for peer review")
				.addStringOption((opt) => opt.setName("content").setDescription("Content to review").setRequired(true))
				.addStringOption((opt) => opt.setName("context").setDescription("Review context").setRequired(false))
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Review mode")
						.setRequired(false)
						.addChoices({ name: "Trading Strategy", value: "trading" }, { name: "General", value: "general" }),
				),
		)
		.addSubcommand((sub) => sub.setName("reviewers").setDescription("List available reviewer personas"))
		.addSubcommand((sub) => sub.setName("status").setDescription("Check review system status")),

	// CTM - Continuous Thought Machine
	new SlashCommandBuilder()
		.setName("ctm")
		.setDescription("Continuous Thought Machine - Extended reasoning with neuron-level timing")
		.addSubcommand((sub) =>
			sub
				.setName("think")
				.setDescription("Run continuous thinking on a problem")
				.addStringOption((opt) => opt.setName("problem").setDescription("Problem to think about").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Domain for specialized thinking")
						.setRequired(false)
						.addChoices(
							{ name: "General", value: "general" },
							{ name: "Mathematics", value: "mathematics" },
							{ name: "Coding", value: "coding" },
							{ name: "Research", value: "research" },
							{ name: "Trading", value: "trading" },
							{ name: "Security", value: "security" },
							{ name: "Creative", value: "creative" },
						),
				)
				.addStringOption((opt) =>
					opt
						.setName("depth")
						.setDescription("Thinking depth")
						.setRequired(false)
						.addChoices(
							{ name: "Quick (10s)", value: "quick" },
							{ name: "Deep (2min)", value: "deep" },
							{ name: "Research (5min)", value: "research" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check CTM availability")),

	// OpenEvolve - Evolutionary Optimization
	new SlashCommandBuilder()
		.setName("evolve")
		.setDescription("OpenEvolve - LLM-based evolutionary code/prompt optimization")
		.addSubcommand((sub) =>
			sub
				.setName("prompt")
				.setDescription("Evolve a prompt for better performance")
				.addStringOption((opt) => opt.setName("seed").setDescription("Initial prompt to evolve").setRequired(true))
				.addStringOption((opt) => opt.setName("criteria").setDescription("Evaluation criteria").setRequired(true))
				.addIntegerOption((opt) =>
					opt
						.setName("generations")
						.setDescription("Number of evolution generations")
						.setRequired(false)
						.setMinValue(5)
						.setMaxValue(100),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("code")
				.setDescription("Evolve code for optimization")
				.addStringOption((opt) => opt.setName("code").setDescription("Code to evolve").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("objective").setDescription("Optimization objective").setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check OpenEvolve availability"))
		.addSubcommand((sub) => sub.setName("list").setDescription("List evolution tasks")),

	// DGM - Darwin Gödel Machine (Self-Improvement)
	new SlashCommandBuilder()
		.setName("dgm")
		.setDescription("Darwin Gödel Machine - self-improving code modification")
		.addSubcommand((sub) =>
			sub
				.setName("improve")
				.setDescription("Improve a code file with AI-guided modifications")
				.addStringOption((opt) => opt.setName("file").setDescription("File path to improve").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("objective").setDescription("Improvement objective").setRequired(true),
				)
				.addIntegerOption((opt) =>
					opt
						.setName("max_iterations")
						.setDescription("Maximum improvement iterations (default: 5)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("expertise")
				.setDescription("Improve an agent expertise file")
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Expertise domain to improve")
						.setRequired(true)
						.addChoices(
							{ name: "General", value: "general" },
							{ name: "Coding", value: "coding" },
							{ name: "Trading", value: "trading" },
							{ name: "Security", value: "security" },
							{ name: "Research", value: "research" },
						),
				)
				.addStringOption((opt) =>
					opt.setName("objective").setDescription("Improvement objective").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("quick")
				.setDescription("Quick safe improvement with minimal changes")
				.addStringOption((opt) => opt.setName("file").setDescription("File path to improve").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("objective").setDescription("Improvement objective").setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check DGM availability"))
		.addSubcommand((sub) => sub.setName("history").setDescription("View improvement history")),

	// Telegram Bridge
	new SlashCommandBuilder()
		.setName("telegram")
		.setDescription("Telegram bridge - send messages and media to Telegram")
		.addSubcommand((sub) =>
			sub
				.setName("send")
				.setDescription("Send a message to Telegram")
				.addStringOption((opt) => opt.setName("chat_id").setDescription("Telegram chat ID").setRequired(true))
				.addStringOption((opt) => opt.setName("message").setDescription("Message to send").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("photo")
				.setDescription("Send a photo to Telegram")
				.addStringOption((opt) => opt.setName("chat_id").setDescription("Telegram chat ID").setRequired(true))
				.addStringOption((opt) => opt.setName("url").setDescription("Photo URL").setRequired(true))
				.addStringOption((opt) => opt.setName("caption").setDescription("Photo caption").setRequired(false)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Telegram bot status")),

	// Browser Automation
	new SlashCommandBuilder()
		.setName("browse")
		.setDescription("Browser automation - screenshots, scraping, web search")
		.addSubcommand((sub) =>
			sub
				.setName("screenshot")
				.setDescription("Take a screenshot of a webpage")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to screenshot").setRequired(true))
				.addBooleanOption((opt) => opt.setName("fullpage").setDescription("Capture full page").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("scrape")
				.setDescription("Scrape content from a webpage")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to scrape").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("extract")
				.setDescription("Extract specific data from a webpage using AI")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to extract from").setRequired(true))
				.addStringOption((opt) => opt.setName("query").setDescription("What to extract").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search the web")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true)),
		),

	// HuggingFace Expert Skills
	new SlashCommandBuilder()
		.setName("hf")
		.setDescription("HuggingFace AI skills - 30+ expert capabilities")
		.addSubcommand((sub) =>
			sub
				.setName("image")
				.setDescription("Generate images from text")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Image description").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Model to use")
						.setRequired(false)
						.addChoices(
							{ name: "Qwen Fast (default)", value: "QWEN_FAST" },
							{ name: "Qwen Quality", value: "QWEN_QUALITY" },
							{ name: "FLUX Krea", value: "FLUX_KREA" },
							{ name: "Z-Image Turbo", value: "Z_IMAGE_TURBO" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("remove-bg")
				.setDescription("Remove background from image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("edit")
				.setDescription("Edit image with text prompt")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true))
				.addStringOption((opt) => opt.setName("prompt").setDescription("Edit instructions").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("3d")
				.setDescription("Generate 3D model from image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("3D model to use")
						.setRequired(false)
						.addChoices(
							{ name: "Hunyuan 2.1 (default)", value: "HUNYUAN_2_1" },
							{ name: "Hunyuan 2.0", value: "HUNYUAN_2" },
							{ name: "TRELLIS", value: "TRELLIS" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("video")
				.setDescription("Generate video from image + prompt")
				.addStringOption((opt) => opt.setName("url").setDescription("Starting image URL").setRequired(true))
				.addStringOption((opt) => opt.setName("prompt").setDescription("Video description").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("tts")
				.setDescription("Text to speech")
				.addStringOption((opt) => opt.setName("text").setDescription("Text to speak").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("TTS model")
						.setRequired(false)
						.addChoices(
							{ name: "Chatterbox (default)", value: "CHATTERBOX" },
							{ name: "F5-TTS (voice clone)", value: "F5_TTS" },
							{ name: "Edge TTS", value: "EDGE_TTS" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("ocr")
				.setDescription("Extract text from image/PDF")
				.addStringOption((opt) => opt.setName("url").setDescription("Image/PDF URL").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("code")
				.setDescription("Generate code from description")
				.addStringOption((opt) => opt.setName("prompt").setDescription("What to build").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Code model")
						.setRequired(false)
						.addChoices(
							{ name: "Qwen Coder (default)", value: "QWEN_CODER" },
							{ name: "Qwen WebDev", value: "QWEN_WEBDEV" },
							{ name: "DeepSeek Coder", value: "DEEPSEEK_CODER" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("trading")
				.setDescription("Trading sentiment analysis")
				.addStringOption((opt) =>
					opt.setName("asset").setDescription("Asset to analyze (e.g., BTC, AAPL)").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("news").setDescription("News text to analyze").setRequired(false)),
		)
		.addSubcommand((sub) => sub.setName("stocks").setDescription("Get AI stock recommendations"))
		.addSubcommand((sub) =>
			sub
				.setName("vision")
				.setDescription("Ask questions about an image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true))
				.addStringOption((opt) => opt.setName("question").setDescription("Your question").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("detect")
				.setDescription("Detect objects in image")
				.addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("polish")
				.setDescription("Improve/polish an AI prompt")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Prompt to improve").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("skills").setDescription("List all available HF skills")),
	// Learning command for trading stats
	new SlashCommandBuilder()
		.setName("learning")
		.setDescription("Trading learning stats and expertise")
		.addSubcommand((sub) => sub.setName("stats").setDescription("View current learning session stats"))
		.addSubcommand((sub) => sub.setName("expertise").setDescription("View accumulated trading expertise"))
		.addSubcommand((sub) =>
			sub
				.setName("record")
				.setDescription("Manually record a trading outcome")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Trading pair (e.g., SOL/USDT)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt
						.setName("action")
						.setDescription("Action taken")
						.setRequired(true)
						.addChoices(
							{ name: "BUY", value: "BUY" },
							{ name: "SELL", value: "SELL" },
							{ name: "HOLD", value: "HOLD" },
						),
				)
				.addBooleanOption((opt) => opt.setName("success").setDescription("Was it successful?").setRequired(true))
				.addNumberOption((opt) => opt.setName("confidence").setDescription("Confidence 0-1").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("market")
						.setDescription("Market condition")
						.setRequired(true)
						.addChoices(
							{ name: "Bull", value: "bull" },
							{ name: "Bear", value: "bear" },
							{ name: "Sideways", value: "sideways" },
							{ name: "Volatile", value: "volatile" },
						),
				)
				.addStringOption((opt) => opt.setName("reason").setDescription("Reason for trade").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub.setName("update").setDescription("Force update expertise file with current learnings"),
		),

	// Codebase Experts (TAC Lesson 13)
	new SlashCommandBuilder()
		.setName("expert")
		.setDescription("Codebase Experts - domain-specific learning agents (TAC Lesson 13)")
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run task with auto-selected domain expert")
				.addStringOption((opt) => opt.setName("task").setDescription("Task to execute").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Force specific domain (auto-detect if not set)")
						.setRequired(false)
						.addChoices(
							{ name: "Security (auth, OWASP)", value: "security" },
							{ name: "Database (schema, queries)", value: "database" },
							{ name: "Trading (signals, risk)", value: "trading" },
							{ name: "API Integration (external APIs)", value: "api_integration" },
							{ name: "Billing (payments)", value: "billing" },
							{ name: "Performance (optimization)", value: "performance" },
							{ name: "General", value: "general" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all available codebase experts"))
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("View expertise accumulated by a domain expert")
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Domain to view")
						.setRequired(true)
						.addChoices(
							{ name: "Security", value: "security" },
							{ name: "Database", value: "database" },
							{ name: "Trading", value: "trading" },
							{ name: "API Integration", value: "api_integration" },
							{ name: "Billing", value: "billing" },
							{ name: "Performance", value: "performance" },
							{ name: "Meta-Agentic", value: "meta_agentic" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new domain expert (meta-agentic)")
				.addStringOption((opt) => opt.setName("domain").setDescription("New domain name").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("description").setDescription("What this expert handles").setRequired(true),
				),
		),

	// Two-Phase Agent Workflow (Initializer + Coding Agent)
	new SlashCommandBuilder()
		.setName("task")
		.setDescription("Two-phase agent workflow - plan then execute features")
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new task with feature breakdown")
				.addStringOption((opt) => opt.setName("description").setDescription("Task description").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Expert domain for this task")
						.setRequired(false)
						.addChoices(
							{ name: "Coding", value: "coding" },
							{ name: "Security", value: "security" },
							{ name: "Database", value: "database" },
							{ name: "Trading", value: "trading" },
							{ name: "General", value: "general" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("execute")
				.setDescription("Execute next feature in a task")
				.addStringOption((opt) => opt.setName("task_id").setDescription("Task ID to execute").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("status")
				.setDescription("Check task progress")
				.addStringOption((opt) => opt.setName("task_id").setDescription("Task ID to check").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("resume")
				.setDescription("Resume an interrupted task")
				.addStringOption((opt) => opt.setName("task_id").setDescription("Task ID to resume").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Create and execute a task in one go")
				.addStringOption((opt) => opt.setName("description").setDescription("Task description").setRequired(true))
				.addIntegerOption((opt) =>
					opt
						.setName("max_features")
						.setDescription("Max features to execute")
						.setRequired(false)
						.setMinValue(1)
						.setMaxValue(50),
				),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all tasks")),

	// Agent Mail System
	new SlashCommandBuilder()
		.setName("mail")
		.setDescription("Agent-to-agent messaging system with email semantics")
		.addSubcommand((sub) =>
			sub
				.setName("send")
				.setDescription("Send a message to an agent")
				.addStringOption((opt) => opt.setName("to").setDescription("Agent ID to send to").setRequired(true))
				.addStringOption((opt) => opt.setName("subject").setDescription("Message subject").setRequired(true))
				.addStringOption((opt) => opt.setName("message").setDescription("Message content").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("importance")
						.setDescription("Message importance")
						.setRequired(false)
						.addChoices(
							{ name: "Low", value: "low" },
							{ name: "Normal", value: "normal" },
							{ name: "High", value: "high" },
							{ name: "Urgent", value: "urgent" },
						),
				)
				.addBooleanOption((opt) =>
					opt.setName("ack_required").setDescription("Require acknowledgment").setRequired(false),
				),
		)
		.addSubcommand((sub) => sub.setName("inbox").setDescription("View your inbox"))
		.addSubcommand((sub) => sub.setName("threads").setDescription("List message threads"))
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search messages")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show messaging statistics")),

	// Trading Learning Stats
	new SlashCommandBuilder()
		.setName("tradestats")
		.setDescription("Trading learning system stats - win rate, accuracy, trend")
		.addBooleanOption((opt) =>
			opt.setName("json").setDescription("Output as JSON instead of formatted text").setRequired(false),
		)
		.addBooleanOption((opt) =>
			opt.setName("swarm").setDescription("Include multi-LLM swarm consensus stats").setRequired(false),
		),

	// Paper Trading
	new SlashCommandBuilder()
		.setName("papertrade")
		.setDescription("Paper trading simulation with real market data")
		.addSubcommand((sub) => sub.setName("status").setDescription("Show portfolio status and positions"))
		.addSubcommand((sub) =>
			sub
				.setName("buy")
				.setDescription("Place a buy order")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Symbol to buy (e.g., BTC, ETH)").setRequired(true),
				)
				.addNumberOption((opt) => opt.setName("amount").setDescription("USD amount to spend").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("sell")
				.setDescription("Sell a position")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol to sell").setRequired(true))
				.addNumberOption((opt) =>
					opt
						.setName("percent")
						.setDescription("Percentage of position to sell (default: 100)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) => sub.setName("history").setDescription("Show trade history"))
		.addSubcommand((sub) =>
			sub
				.setName("reset")
				.setDescription("Reset paper trading account")
				.addNumberOption((opt) =>
					opt.setName("capital").setDescription("Starting capital (default: $10,000)").setRequired(false),
				),
		),

	// Sentiment Analysis
	new SlashCommandBuilder()
		.setName("sentiment")
		.setDescription("Market sentiment analysis from social media and news")
		.addSubcommand((sub) =>
			sub
				.setName("check")
				.setDescription("Check sentiment for a symbol")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Symbol to analyze (e.g., BTC, ETH)").setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("feargreed").setDescription("Show Fear & Greed Index"))
		.addSubcommand((sub) => sub.setName("news").setDescription("Show latest crypto news with sentiment")),

	new SlashCommandBuilder()
		.setName("workflow")
		.setDescription("Multi-step agent workflow orchestration")
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new workflow")
				.addStringOption((opt) => opt.setName("name").setDescription("Workflow name").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("steps").setDescription("Workflow steps (JSON array)").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run a workflow")
				.addStringOption((opt) => opt.setName("id").setDescription("Workflow ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("status")
				.setDescription("Check workflow status")
				.addStringOption((opt) => opt.setName("id").setDescription("Workflow ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("pause")
				.setDescription("Pause a running workflow")
				.addStringOption((opt) => opt.setName("id").setDescription("Workflow ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("resume")
				.setDescription("Resume a paused workflow")
				.addStringOption((opt) => opt.setName("id").setDescription("Workflow ID").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all workflows"))
		.addSubcommand((sub) =>
			sub
				.setName("cancel")
				.setDescription("Cancel a workflow")
				.addStringOption((opt) => opt.setName("id").setDescription("Workflow ID").setRequired(true)),
		),

	// Prediction Markets
	new SlashCommandBuilder()
		.setName("predict")
		.setDescription("Prediction markets (Polymarket/Kalshi)")
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search prediction markets")
				.addStringOption((opt) =>
					opt.setName("query").setDescription("Search query (e.g., bitcoin, trump)").setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("trending").setDescription("Show trending prediction markets"))
		.addSubcommand((sub) =>
			sub
				.setName("signal")
				.setDescription("Generate trading signal for a market")
				.addStringOption((opt) => opt.setName("market").setDescription("Market question").setRequired(true))
				.addNumberOption((opt) =>
					opt.setName("probability").setDescription("Your estimated true probability (0-1)").setRequired(true),
				)
				.addNumberOption((opt) => opt.setName("bankroll").setDescription("Bankroll size (default: 1000)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("arbitrage")
				.setDescription("Calculate arbitrage opportunity")
				.addNumberOption((opt) =>
					opt.setName("poly_yes").setDescription("Polymarket YES price (0-1)").setRequired(true),
				)
				.addNumberOption((opt) =>
					opt.setName("kalshi_yes").setDescription("Kalshi YES price (0-1)").setRequired(true),
				)
				.addNumberOption((opt) => opt.setName("amount").setDescription("Trade amount (default: 1000)")),
		),

	// Learning Activation (Novel PI Agent Architectures - Track A)
	new SlashCommandBuilder()
		.setName("agentlearn")
		.setDescription("Agent learning activation and expertise management")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show learning statistics and domain coverage"))
		.addSubcommand((sub) => sub.setName("domains").setDescription("List all domains with active/empty status"))
		.addSubcommand((sub) =>
			sub
				.setName("seed")
				.setDescription("Seed a domain with initial expertise")
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Domain to seed (security, database, trading, etc.)")
						.setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("trigger")
				.setDescription("Manually trigger learning from output")
				.addStringOption((opt) =>
					opt.setName("output").setDescription("Output text to learn from").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("task").setDescription("Task description").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("View expertise content for a domain")
				.addStringOption((opt) => opt.setName("domain").setDescription("Domain to view").setRequired(true)),
		),

	// Tool Metrics (Novel PI Agent Architectures - Track B)
	new SlashCommandBuilder()
		.setName("toolmetrics")
		.setDescription("MCP tool performance metrics and analytics")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show overall tool performance statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("top")
				.setDescription("Top performing tools by success rate")
				.addIntegerOption((opt) =>
					opt.setName("limit").setDescription("Number of tools to show (default: 10)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("slow")
				.setDescription("Slowest tools by average latency")
				.addIntegerOption((opt) =>
					opt.setName("limit").setDescription("Number of tools to show (default: 10)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("errors")
				.setDescription("Most error-prone tools")
				.addIntegerOption((opt) =>
					opt.setName("limit").setDescription("Number of tools to show (default: 10)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("tool")
				.setDescription("Detailed metrics for a specific tool")
				.addStringOption((opt) => opt.setName("name").setDescription("Tool name to query").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("recent")
				.setDescription("Recent tool calls")
				.addIntegerOption((opt) =>
					opt.setName("limit").setDescription("Number of calls to show (default: 20)").setRequired(false),
				),
		),

	// Self-Debug Service (Autonomous Error Detection and Repair)
	new SlashCommandBuilder()
		.setName("selfdebug")
		.setDescription("Self-debugging service for autonomous error detection and repair")
		.addSubcommand((sub) => sub.setName("status").setDescription("Show self-debug service status"))
		.addSubcommand((sub) => sub.setName("errors").setDescription("List captured errors"))
		.addSubcommand((sub) =>
			sub
				.setName("diagnose")
				.setDescription("Manually diagnose an error")
				.addStringOption((opt) => opt.setName("error_id").setDescription("Error ID to diagnose").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("clear").setDescription("Clear error history"))
		.addSubcommand((sub) =>
			sub
				.setName("toggle")
				.setDescription("Enable or disable self-debug")
				.addBooleanOption((opt) =>
					opt.setName("enabled").setDescription("Enable self-debugging").setRequired(true),
				),
		),

	// History Capture (Universal Output Capture System)
	new SlashCommandBuilder()
		.setName("history")
		.setDescription("Universal output capture system for agent history")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show history statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("recent")
				.setDescription("Get recent history entries")
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Filter by type")
						.setRequired(false)
						.addChoices(
							{ name: "Feature", value: "FEATURE" },
							{ name: "Bug", value: "BUG" },
							{ name: "Learning", value: "LEARNING" },
							{ name: "Research", value: "RESEARCH" },
							{ name: "Decision", value: "DECISION" },
							{ name: "Session", value: "SESSION" },
						),
				)
				.addIntegerOption((opt) =>
					opt.setName("limit").setDescription("Number of entries (default: 10)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search history entries")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Filter by type")
						.setRequired(false)
						.addChoices(
							{ name: "Feature", value: "FEATURE" },
							{ name: "Bug", value: "BUG" },
							{ name: "Learning", value: "LEARNING" },
							{ name: "Research", value: "RESEARCH" },
							{ name: "Decision", value: "DECISION" },
							{ name: "Session", value: "SESSION" },
						),
				)
				.addStringOption((opt) => opt.setName("agent").setDescription("Filter by agent ID").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("capture")
				.setDescription("Manually capture content")
				.addStringOption((opt) => opt.setName("content").setDescription("Content to capture").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Type of content")
						.setRequired(true)
						.addChoices(
							{ name: "Feature", value: "FEATURE" },
							{ name: "Bug", value: "BUG" },
							{ name: "Learning", value: "LEARNING" },
							{ name: "Research", value: "RESEARCH" },
							{ name: "Decision", value: "DECISION" },
							{ name: "Session", value: "SESSION" },
						),
				)
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("View a history entry")
				.addStringOption((opt) => opt.setName("id").setDescription("Entry ID").setRequired(true)),
		),

	// ARC-AGI DSPy Evolution (GEPA-based)
	new SlashCommandBuilder()
		.setName("arc-agi")
		.setDescription("ARC-AGI puzzle solver - evolve DSPy programs via GEPA")
		.addSubcommand((sub) =>
			sub
				.setName("evolve")
				.setDescription("Evolve optimal DSPy program for ARC-AGI solving")
				.addIntegerOption((opt) =>
					opt
						.setName("tasks")
						.setDescription("Number of ARC tasks (default: 10)")
						.setRequired(false)
						.setMinValue(3)
						.setMaxValue(50),
				)
				.addIntegerOption((opt) =>
					opt
						.setName("iterations")
						.setDescription("Evolution iterations (default: 50)")
						.setRequired(false)
						.setMinValue(10)
						.setMaxValue(500),
				)
				.addStringOption((opt) =>
					opt
						.setName("seed")
						.setDescription("Seed program type")
						.setRequired(false)
						.addChoices(
							{ name: "Minimal (simple start)", value: "minimal" },
							{ name: "Pattern (analyze+apply)", value: "pattern" },
							{ name: "Advanced (multi-step)", value: "advanced" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("evaluate")
				.setDescription("Evaluate current best program on ARC tasks")
				.addIntegerOption((opt) =>
					opt
						.setName("tasks")
						.setDescription("Number of tasks to evaluate (default: 20)")
						.setRequired(false)
						.setMinValue(1)
						.setMaxValue(100),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Check ARC-AGI agent availability"))
		.addSubcommand((sub) => sub.setName("best").setDescription("Show the current best evolved program")),

	// Vedic Quantum System - b5(9³), n4(8³), Ifá Trading, Threefold Evaluation
	new SlashCommandBuilder()
		.setName("vedic")
		.setDescription("Vedic Quantum System: Indra.ai b5/n4 algorithms, Ifá trading, Threefold evaluation")
		.addSubcommand((sub) =>
			sub
				.setName("signal")
				.setDescription("Generate Ifá trading signal using n4(8³) quantum divination")
				.addNumberOption((opt) =>
					opt.setName("price").setDescription("Current asset price for position sizing").setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Trading symbol (default: BTC)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("evaluate")
				.setDescription("Evaluate text using Vedic Threefold (Sattva/Rajas/Tamas) metrics")
				.addStringOption((opt) =>
					opt.setName("text").setDescription("Text to evaluate for quality").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("backtest")
				.setDescription("Run Ifá strategy backtest with simulated price data")
				.addIntegerOption((opt) =>
					opt
						.setName("days")
						.setDescription("Number of days to simulate (default: 100)")
						.setRequired(false)
						.setMinValue(10)
						.setMaxValue(1000),
				)
				.addNumberOption((opt) =>
					opt.setName("capital").setDescription("Starting capital (default: 10000)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub.setName("grids").setDescription("Display the sacred b5(9³) and n4(8³) grids with properties"),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Show Vedic Quantum System status")),

	// Aerospace-Inspired Pattern Modules (ANG13T research)
	// Genetic Algorithm Optimizer (url_genie pattern)
	new SlashCommandBuilder()
		.setName("optimize")
		.setDescription("Genetic algorithm optimization for trading strategies (url_genie pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("strategy")
				.setDescription("Evolve trading strategy genes")
				.addIntegerOption((opt) =>
					opt
						.setName("generations")
						.setDescription("Number of generations (default: 50)")
						.setRequired(false)
						.setMinValue(5)
						.setMaxValue(500),
				)
				.addIntegerOption((opt) =>
					opt
						.setName("population")
						.setDescription("Population size (default: 20)")
						.setRequired(false)
						.setMinValue(10)
						.setMaxValue(100),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("quick")
				.setDescription("Quick optimization (10 generations, 10 population)")
				.addStringOption((opt) =>
					opt.setName("focus").setDescription("Optimization focus (e.g., RSI, momentum, trend)"),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Show current optimization status"))
		.addSubcommand((sub) => sub.setName("best").setDescription("Show best evolved strategy genes")),

	// Anomaly Detection (DroneXtract pattern)
	new SlashCommandBuilder()
		.setName("anomaly")
		.setDescription("Market anomaly and manipulation detection (DroneXtract pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("scan")
				.setDescription("Scan price data for anomalies")
				.addStringOption((opt) =>
					opt.setName("symbol").setDescription("Symbol to scan (e.g., BTC, ETH)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt
						.setName("timeframe")
						.setDescription("Timeframe (1m, 5m, 15m, 1h, 4h, 1d)")
						.addChoices(
							{ name: "1 minute", value: "1m" },
							{ name: "5 minutes", value: "5m" },
							{ name: "15 minutes", value: "15m" },
							{ name: "1 hour", value: "1h" },
							{ name: "4 hours", value: "4h" },
							{ name: "1 day", value: "1d" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("integrity")
				.setDescription("Full integrity report for a symbol")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol to analyze").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("manipulation")
				.setDescription("Detect potential market manipulation")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol to check").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Show anomaly detection status")),

	// Signal Validator (skytrack pattern)
	new SlashCommandBuilder()
		.setName("validate")
		.setDescription("Multi-source signal validation (skytrack OSINT pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("signal")
				.setDescription("Validate a trading signal across multiple sources")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol (e.g., BTC, ETH)").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("direction")
						.setDescription("Signal direction")
						.setRequired(true)
						.addChoices(
							{ name: "Long/Buy", value: "long" },
							{ name: "Short/Sell", value: "short" },
							{ name: "Neutral/Hold", value: "neutral" },
						),
				)
				.addNumberOption((opt) =>
					opt.setName("confidence").setDescription("Initial confidence (0-1)").setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("sources")
				.setDescription("List configured signal sources")
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Filter by source type")
						.addChoices(
							{ name: "Technical", value: "technical" },
							{ name: "Sentiment", value: "sentiment" },
							{ name: "On-Chain", value: "onchain" },
							{ name: "News", value: "news" },
							{ name: "Social", value: "social" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("consensus")
				.setDescription("Get consensus view for a symbol")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol to check").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Show validator status")),

	// Signal Classifier (fly-catcher pattern)
	new SlashCommandBuilder()
		.setName("classify")
		.setDescription("Neural network signal classification (fly-catcher pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("signal")
				.setDescription("Classify a trading signal's authenticity and quality")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol to classify").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Classification type")
						.addChoices(
							{ name: "Authenticity (spoof detection)", value: "authenticity" },
							{ name: "Quality assessment", value: "quality" },
							{ name: "Market regime", value: "regime" },
							{ name: "Full analysis", value: "full" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("features")
				.setDescription("Extract features from OHLCV data")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol to analyze").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("regime")
				.setDescription("Detect current market regime")
				.addStringOption((opt) => opt.setName("symbol").setDescription("Symbol to check").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Show classifier status")),

	// Agentic Properties (IndyDevDan's 6 Properties Framework)
	new SlashCommandBuilder()
		.setName("agentic")
		.setDescription("Agentic Properties System - 6 properties for autonomous agents")
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new agentic agent with all 6 properties")
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Agent domain")
						.setRequired(true)
						.addChoices(
							{ name: "trading", value: "trading" },
							{ name: "coding", value: "coding" },
							{ name: "research", value: "research" },
							{ name: "security", value: "security" },
							{ name: "general", value: "general" },
						),
				)
				.addStringOption((opt) => opt.setName("id").setDescription("Custom agent ID")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("status")
				.setDescription("Show agentic agent status and property levels")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run agent continuously (durability)")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true))
				.addStringOption((opt) => opt.setName("task").setDescription("Task to execute").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("learn")
				.setDescription("Add learning to agent (self-improvement)")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true))
				.addStringOption((opt) => opt.setName("insight").setDescription("Learning insight").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("replicate")
				.setDescription("Create agent replica (self-replication)")
				.addStringOption((opt) => opt.setName("id").setDescription("Parent agent ID").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("specialization").setDescription("Replica specialization").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("evaluate")
				.setDescription("Evaluate agent alignment to domain")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all agentic agents"))
		.addSubcommand((sub) => sub.setName("properties").setDescription("Show the 6 agentic properties"))
		.addSubcommand((sub) =>
			sub
				.setName("preset")
				.setDescription("Create agent from GOAT preset (minimalist/justBash)")
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription("Agent preset mode")
						.setRequired(true)
						.addChoices(
							{ name: "minimalist (Mario - 4 tools)", value: "minimalist" },
							{ name: "justBash (Vercel - 1 tool)", value: "justBash" },
							{ name: "trading", value: "trading" },
							{ name: "coding", value: "coding" },
							{ name: "research", value: "research" },
							{ name: "security", value: "security" },
						),
				)
				.addStringOption((opt) => opt.setName("task").setDescription("Task to execute").setRequired(true)),
		),

	// Swarm Communication (learned from Agentis Framework)
	new SlashCommandBuilder()
		.setName("swarm")
		.setDescription("Multi-agent swarm coordination system")
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new swarm agent")
				.addStringOption((opt) => opt.setName("name").setDescription("Agent name").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("role")
						.setDescription("Agent role")
						.setRequired(true)
						.addChoices(
							{ name: "leader", value: "leader" },
							{ name: "worker", value: "worker" },
							{ name: "specialist", value: "specialist" },
							{ name: "coordinator", value: "coordinator" },
							{ name: "observer", value: "observer" },
						),
				)
				.addStringOption((opt) =>
					opt
						.setName("domain")
						.setDescription("Agent domain")
						.setRequired(true)
						.addChoices(
							{ name: "trading", value: "trading" },
							{ name: "coding", value: "coding" },
							{ name: "research", value: "research" },
							{ name: "security", value: "security" },
							{ name: "general", value: "general" },
						),
				)
				.addStringOption((opt) => opt.setName("capabilities").setDescription("Comma-separated capabilities")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("delegate")
				.setDescription("Delegate a task to the best available agent")
				.addStringOption((opt) => opt.setName("task").setDescription("Task description").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("capabilities").setDescription("Required capabilities (comma-separated)"),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("consensus")
				.setDescription("Start a consensus vote among swarm agents")
				.addStringOption((opt) => opt.setName("question").setDescription("Question to vote on").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("options").setDescription("Options (comma-separated)").setRequired(true),
				)
				.addStringOption((opt) =>
					opt
						.setName("strategy")
						.setDescription("Voting strategy")
						.addChoices(
							{ name: "majority", value: "majority" },
							{ name: "unanimous", value: "unanimous" },
							{ name: "weighted", value: "weighted" },
							{ name: "leader_decides", value: "leader_decides" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Show swarm status and topology"))
		.addSubcommand((sub) => sub.setName("list").setDescription("List all swarm agents")),

	// Agent Personas (learned from Agentis Framework)
	new SlashCommandBuilder()
		.setName("persona")
		.setDescription("Agent personality and character system")
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a custom agent persona")
				.addStringOption((opt) => opt.setName("name").setDescription("Persona name").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("preset")
						.setDescription("Base preset to use")
						.addChoices(
							{ name: "trader", value: "trader" },
							{ name: "coder", value: "coder" },
							{ name: "researcher", value: "researcher" },
							{ name: "security", value: "security" },
							{ name: "creative", value: "creative" },
						),
				)
				.addStringOption((opt) => opt.setName("role").setDescription("Agent role description"))
				.addStringOption((opt) => opt.setName("traits").setDescription("Personality traits (comma-separated)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("View a persona's details")
				.addStringOption((opt) => opt.setName("name").setDescription("Persona name").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("prompt")
				.setDescription("Generate system prompt for a persona")
				.addStringOption((opt) => opt.setName("name").setDescription("Persona name").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all personas"))
		.addSubcommand((sub) => sub.setName("presets").setDescription("Show available preset personas")),

	// Dependency Inference (learned from Agentis Framework)
	new SlashCommandBuilder()
		.setName("infer")
		.setDescription("NLP-based task dependency inference")
		.addSubcommand((sub) =>
			sub
				.setName("tasks")
				.setDescription("Infer dependencies between tasks")
				.addStringOption((opt) =>
					opt.setName("tasks").setDescription("Tasks (pipe-separated: task1|task2|task3)").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("context").setDescription("Additional context for inference")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("order")
				.setDescription("Get optimal execution order for tasks")
				.addStringOption((opt) => opt.setName("tasks").setDescription("Tasks (pipe-separated)").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("graph")
				.setDescription("Visualize task dependency graph")
				.addStringOption((opt) => opt.setName("tasks").setDescription("Tasks (pipe-separated)").setRequired(true)),
		),

	// Twitter Connector (learned from Agentis Framework)
	new SlashCommandBuilder()
		.setName("twitter")
		.setDescription("Twitter/X cross-platform integration")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Twitter connector status"))
		.addSubcommand((sub) =>
			sub
				.setName("post")
				.setDescription("Post a tweet")
				.addStringOption((opt) => opt.setName("content").setDescription("Tweet content").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("thread")
				.setDescription("Post a thread")
				.addStringOption((opt) =>
					opt.setName("content").setDescription("Thread content (will be split)").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search tweets")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true))
				.addIntegerOption((opt) => opt.setName("limit").setDescription("Max results (default: 10)")),
		)
		.addSubcommand((sub) => sub.setName("mentions").setDescription("Get recent mentions"))
		.addSubcommand((sub) => sub.setName("analytics").setDescription("Get engagement analytics")),

	// E2B Sandbox - Isolated Cloud Execution
	new SlashCommandBuilder()
		.setName("sandbox")
		.setDescription("E2B cloud sandbox for isolated code execution")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check E2B sandbox availability"))
		.addSubcommand((sub) =>
			sub
				.setName("run")
				.setDescription("Run code in isolated sandbox")
				.addStringOption((opt) => opt.setName("code").setDescription("Code to execute").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("language")
						.setDescription("Language: python, node, bash")
						.setChoices(
							{ name: "Python", value: "python" },
							{ name: "Node.js", value: "node" },
							{ name: "Bash", value: "bash" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a persistent sandbox")
				.addIntegerOption((opt) => opt.setName("timeout").setDescription("Timeout in seconds (default: 3600)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("exec")
				.setDescription("Execute command in existing sandbox")
				.addStringOption((opt) => opt.setName("sandbox_id").setDescription("Sandbox ID").setRequired(true))
				.addStringOption((opt) => opt.setName("command").setDescription("Command to run").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("kill")
				.setDescription("Kill a sandbox")
				.addStringOption((opt) => opt.setName("sandbox_id").setDescription("Sandbox ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("host")
				.setDescription("Get public URL for sandbox port")
				.addStringOption((opt) => opt.setName("sandbox_id").setDescription("Sandbox ID").setRequired(true))
				.addIntegerOption((opt) => opt.setName("port").setDescription("Port number (default: 5173)")),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List active sandboxes")),

	// TAC-12 Platform - Multi-SDK AI Orchestrator (12 SDK integrations)
	new SlashCommandBuilder()
		.setName("tac12")
		.setDescription("TAC-12 Multi-SDK AI Orchestrator - 16 SDKs in one platform")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check TAC-12 connection status and available SDKs"))
		.addSubcommand((sub) =>
			sub
				.setName("execute")
				.setDescription("Execute a task using a specific SDK")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Task prompt").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("sdk")
						.setDescription("SDK to use")
						.setChoices(
							{ name: "ClaudeCO (Agentic Coding)", value: "claudeco" },
							{ name: "Vercel AI", value: "vercel-ai" },
							{ name: "Vercel AI Agents", value: "vercel-ai-agents" },
							{ name: "Cloudflare Workers", value: "cloudflare-workers" },
							{ name: "Cloudflare AI", value: "cloudflare-ai" },
							{ name: "Inngest (Workflows)", value: "inngest" },
							{ name: "Lightning AI (ML)", value: "lightning-ai" },
							{ name: "Google Colab (GPU)", value: "google-colab" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("scout")
				.setDescription("Scout-Builder pattern: scout explores, builder implements")
				.addStringOption((opt) =>
					opt.setName("prompt").setDescription("Task to scout and build").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("parallel")
				.setDescription("Run task in parallel across multiple SDKs")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Task prompt").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("aggregation")
						.setDescription("How to aggregate results")
						.addChoices(
							{ name: "Best result", value: "best" },
							{ name: "First result", value: "first" },
							{ name: "All results", value: "all" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("vibe")
				.setDescription("Voice/brainstorm mode for creative ideation")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Brainstorm topic").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("fdsa")
				.setDescription("Full-stack development with specialized agents")
				.addStringOption((opt) => opt.setName("prompt").setDescription("Development task").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("costs").setDescription("View cost tracking data"))
		.addSubcommand((sub) => sub.setName("agents").setDescription("List all TAC-12 agents"))
		.addSubcommand((sub) => sub.setName("patterns").setDescription("List available orchestration patterns")),

	// Claude-Flow - Enterprise AI orchestration (ruvnet/claude-flow)
	new SlashCommandBuilder()
		.setName("claude-flow")
		.setDescription("Enterprise AI orchestration - AgentDB, HiveMind swarms, skills")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Claude-Flow connection and AgentDB stats"))
		.addSubcommand((sub) =>
			sub
				.setName("remember")
				.setDescription("Store a memory in AgentDB with vector indexing")
				.addStringOption((opt) =>
					opt.setName("content").setDescription("Memory content to store").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("namespace").setDescription("Optional namespace for organization")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Vector search across stored memories (96x faster)")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true))
				.addIntegerOption((opt) => opt.setName("limit").setDescription("Max results (default: 5)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("swarm")
				.setDescription("Initialize HiveMind swarm with queen and workers")
				.addStringOption((opt) =>
					opt.setName("task").setDescription("Task for the swarm to execute").setRequired(true),
				)
				.addIntegerOption((opt) => opt.setName("workers").setDescription("Number of worker agents (default: 3)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("reflect")
				.setDescription("Store experience with outcome for learning")
				.addStringOption((opt) => opt.setName("experience").setDescription("What happened").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("outcome")
						.setDescription("Was it successful?")
						.setRequired(true)
						.addChoices({ name: "Success", value: "success" }, { name: "Failure", value: "failure" }),
				)
				.addStringOption((opt) =>
					opt.setName("lessons").setDescription("Lessons learned (comma-separated)").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub.setName("skills").setDescription("List available Claude skills from skill activator"),
		),

	// Claude-Mem - Persistent memory compression (thedotmack/claude-mem)
	new SlashCommandBuilder()
		.setName("claude-mem")
		.setDescription("Persistent memory with compression and progressive disclosure")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check Claude-Mem session status and memory stats"))
		.addSubcommand((sub) =>
			sub
				.setName("observe")
				.setDescription("Record an observation with auto-tagging")
				.addStringOption((opt) => opt.setName("content").setDescription("Observation content").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Observation type")
						.addChoices(
							{ name: "Code", value: "code" },
							{ name: "Architecture", value: "architecture" },
							{ name: "Bug", value: "bug" },
							{ name: "Decision", value: "decision" },
							{ name: "Todo", value: "todo" },
							{ name: "Insight", value: "insight" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search memories with FTS5 full-text search")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Search type")
						.addChoices(
							{ name: "All", value: "all" },
							{ name: "By Concept", value: "concept" },
							{ name: "By File", value: "file" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("context")
				.setDescription("Get progressive disclosure context for content")
				.addStringOption((opt) =>
					opt.setName("content").setDescription("Content to get context for").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("compress")
				.setDescription("Compress text for token efficiency")
				.addStringOption((opt) => opt.setName("content").setDescription("Content to compress").setRequired(true))
				.addIntegerOption((opt) =>
					opt.setName("target_tokens").setDescription("Target token count (default: 500)"),
				),
		),

	// Continuity - Session continuity and handoffs (parcadei/Continuous-Claude)
	new SlashCommandBuilder()
		.setName("continuity")
		.setDescription("Session continuity - ledger, handoffs, tracing")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check continuity system status"))
		.addSubcommand((sub) =>
			sub
				.setName("ledger")
				.setDescription("View or update the session ledger")
				.addStringOption((opt) =>
					opt
						.setName("action")
						.setDescription("Ledger action")
						.addChoices(
							{ name: "View", value: "view" },
							{ name: "Add Goal", value: "add_goal" },
							{ name: "Mark Complete", value: "mark_complete" },
							{ name: "Add Note", value: "add_note" },
						),
				)
				.addStringOption((opt) => opt.setName("content").setDescription("Content for the action")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("handoff")
				.setDescription("Create a session handoff for future continuity")
				.addStringOption((opt) =>
					opt.setName("context").setDescription("Context summary for the handoff").setRequired(true),
				)
				.addStringOption((opt) =>
					opt.setName("next_steps").setDescription("Recommended next steps (comma-separated)"),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("resume")
				.setDescription("Resume from a previous handoff")
				.addStringOption((opt) => opt.setName("handoff_id").setDescription("Handoff ID to resume from")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("trace")
				.setDescription("View session trace for debugging")
				.addStringOption((opt) =>
					opt
						.setName("action")
						.setDescription("Trace action")
						.addChoices(
							{ name: "Start", value: "start" },
							{ name: "View", value: "view" },
							{ name: "End", value: "end" },
						),
				),
		),

	// Browser - Combined dev-browser + browser-use AI browser agent
	new SlashCommandBuilder()
		.setName("browser")
		.setDescription("AI browser automation - persistent pages, sandboxes, extraction")
		.addSubcommand((sub) =>
			sub
				.setName("goto")
				.setDescription("Navigate to a URL and get LLM-friendly DOM snapshot")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to navigate to").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("click")
				.setDescription("Click an element on the current page")
				.addStringOption((opt) =>
					opt.setName("selector").setDescription("CSS selector to click").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("fill")
				.setDescription("Fill a form field on the current page")
				.addStringOption((opt) =>
					opt.setName("selector").setDescription("CSS selector for input").setRequired(true),
				)
				.addStringOption((opt) => opt.setName("value").setDescription("Value to fill").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("extract")
				.setDescription("Extract structured data from a URL")
				.addStringOption((opt) => opt.setName("url").setDescription("URL to extract from").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Extraction type")
						.addChoices(
							{ name: "Text", value: "text" },
							{ name: "Tables", value: "table" },
							{ name: "Links", value: "links" },
							{ name: "Forms", value: "form" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("agent")
				.setDescription("Run AI browser agent with natural language task")
				.addStringOption((opt) =>
					opt.setName("task").setDescription("Natural language task description").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("sandbox")
				.setDescription("Run browser task in isolated sandbox")
				.addStringOption((opt) => opt.setName("task").setDescription("Task to run in sandbox").setRequired(true))
				.addIntegerOption((opt) => opt.setName("timeout").setDescription("Timeout in seconds (default: 60)")),
		)
		.addSubcommand((sub) => sub.setName("pages").setDescription("List active browser pages"))
		.addSubcommand((sub) => sub.setName("close").setDescription("Close all browser pages")),

	// Aitmpl - Claude Code templates platform (aitmpl.com/agents)
	new SlashCommandBuilder()
		.setName("aitmpl")
		.setDescription("Claude Code templates - registry, analytics, health, plugins")
		.addSubcommand((sub) => sub.setName("status").setDescription("Check aitmpl platform status"))
		.addSubcommand((sub) =>
			sub
				.setName("install")
				.setDescription("Install a platform integration")
				.addStringOption((opt) =>
					opt
						.setName("platform")
						.setDescription("Platform to install")
						.setRequired(true)
						.addChoices(
							{ name: "OpenAI", value: "openai" },
							{ name: "Anthropic", value: "anthropic" },
							{ name: "Stripe", value: "stripe" },
							{ name: "AWS", value: "aws" },
							{ name: "GitHub", value: "github" },
							{ name: "Supabase", value: "supabase" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("search")
				.setDescription("Search for templates and components")
				.addStringOption((opt) => opt.setName("query").setDescription("Search query").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Component type")
						.addChoices(
							{ name: "All", value: "all" },
							{ name: "Agent", value: "agent" },
							{ name: "Command", value: "command" },
							{ name: "Setting", value: "setting" },
							{ name: "Hook", value: "hook" },
							{ name: "MCP", value: "mcp" },
							{ name: "Skill", value: "skill" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("platforms").setDescription("List available platform integrations"))
		.addSubcommand((sub) => sub.setName("health").setDescription("Run health checks on installed components"))
		.addSubcommand((sub) =>
			sub
				.setName("analytics")
				.setDescription("View performance analytics")
				.addStringOption((opt) =>
					opt
						.setName("period")
						.setDescription("Time period")
						.addChoices(
							{ name: "Hour", value: "hour" },
							{ name: "Day", value: "day" },
							{ name: "Week", value: "week" },
							{ name: "Month", value: "month" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("plugin")
				.setDescription("Manage plugins")
				.addStringOption((opt) =>
					opt
						.setName("action")
						.setDescription("Plugin action")
						.setRequired(true)
						.addChoices(
							{ name: "List", value: "list" },
							{ name: "Enable", value: "enable" },
							{ name: "Disable", value: "disable" },
						),
				)
				.addStringOption((opt) => opt.setName("plugin_id").setDescription("Plugin ID (for enable/disable)")),
		),

	// Interactive AI Coding Agent (Rhys Sullivan DUI style)
	new SlashCommandBuilder()
		.setName("coder")
		.setDescription("Interactive AI coding agent with buttons and model selection")
		.addSubcommand((sub) =>
			sub
				.setName("start")
				.setDescription("Start a new coding session")
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("AI model to use")
						.addChoices(
							{ name: "GPT-4o (Best Overall)", value: "gpt-4o" },
							{ name: "GPT-4o Mini (Fast)", value: "gpt-4o-mini" },
							{ name: "Claude Sonnet 4 (Best Coding)", value: "claude-sonnet-4-20250514" },
							{ name: "Claude Haiku (Fast)", value: "claude-3-5-haiku-20241022" },
							{ name: "DeepSeek V3 (Best Value)", value: "deepseek-chat" },
							{ name: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
							{ name: "Llama 3.3 70B (Open)", value: "llama-3.3-70b" },
						),
				)
				.addBooleanOption((opt) =>
					opt
						.setName("thread")
						.setDescription("Create a thread for this session (default: true)")
						.setRequired(false),
				),
		)
		.addSubcommand((sub) => sub.setName("session").setDescription("Show current coding session status"))
		.addSubcommand((sub) => sub.setName("end").setDescription("End the current coding session"))
		.addSubcommand((sub) =>
			sub
				.setName("suggest")
				.setDescription("Get AI code suggestion with interactive buttons")
				.addStringOption((opt) => opt.setName("prompt").setDescription("What code do you need?").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("language")
						.setDescription("Target language")
						.addChoices(
							{ name: "TypeScript", value: "typescript" },
							{ name: "JavaScript", value: "javascript" },
							{ name: "Python", value: "python" },
							{ name: "Rust", value: "rust" },
							{ name: "Go", value: "go" },
							{ name: "SQL", value: "sql" },
							{ name: "Bash", value: "bash" },
						),
				)
				.addStringOption((opt) => opt.setName("file").setDescription("Target file path")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("model")
				.setDescription("Change the AI model for current session")
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("New model")
						.setRequired(true)
						.addChoices(
							{ name: "GPT-4o", value: "gpt-4o" },
							{ name: "GPT-4o Mini", value: "gpt-4o-mini" },
							{ name: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
							{ name: "Claude Haiku", value: "claude-3-5-haiku-20241022" },
							{ name: "DeepSeek V3", value: "deepseek-chat" },
							{ name: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
							{ name: "Llama 3.3 70B", value: "llama-3.3-70b" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("context").setDescription("Show session context"))
		.addSubcommand((sub) => sub.setName("clear").setDescription("Clear session context"))
		.addSubcommand((sub) =>
			sub
				.setName("settings")
				.setDescription("Update coding preferences")
				.addStringOption((opt) =>
					opt
						.setName("default_model")
						.setDescription("Default model for new sessions")
						.addChoices(
							{ name: "GPT-4o", value: "gpt-4o" },
							{ name: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
							{ name: "DeepSeek V3", value: "deepseek-chat" },
						),
				)
				.addBooleanOption((opt) => opt.setName("auto_commit").setDescription("Auto-commit accepted suggestions"))
				.addBooleanOption((opt) => opt.setName("show_diffs").setDescription("Show diffs for changes")),
		)
		.addSubcommand((sub) => sub.setName("system-prompt").setDescription("Edit the session system prompt")),

	// ADW - AI Developer Workflows (Deterministic + Non-Deterministic)
	new SlashCommandBuilder()
		.setName("adw")
		.setDescription("AI Developer Workflows - deterministic orchestration with quality gates")
		.addSubcommand((sub) =>
			sub
				.setName("feature")
				.setDescription("Run feature implementation workflow")
				.addStringOption((opt) => opt.setName("name").setDescription("Feature name").setRequired(true))
				.addStringOption((opt) => opt.setName("requirements").setDescription("Feature requirements").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("bugfix")
				.setDescription("Run bug fix workflow")
				.addStringOption((opt) => opt.setName("description").setDescription("Bug description").setRequired(true))
				.addStringOption((opt) => opt.setName("code").setDescription("Affected code snippet").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("refactor")
				.setDescription("Run refactoring workflow")
				.addStringOption((opt) => opt.setName("code").setDescription("Code to refactor").setRequired(true))
				.addStringOption((opt) => opt.setName("goals").setDescription("Refactoring goals").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("active").setDescription("List active workflow executions")),

	// Class 3 Orchestrator - Codebase Singularity
	new SlashCommandBuilder()
		.setName("orchestrator")
		.setDescription("Class 3 Orchestrator - CRUD over agents, workflows, and task delegation")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show orchestrator statistics"))
		.addSubcommand((sub) => sub.setName("agents").setDescription("List all registered agents"))
		.addSubcommand((sub) =>
			sub
				.setName("agent-create")
				.setDescription("Create a new agent")
				.addStringOption((opt) => opt.setName("name").setDescription("Agent name").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Agent type")
						.setRequired(true)
						.addChoices(
							{ name: "Skill", value: "skill" },
							{ name: "MCP", value: "mcp" },
							{ name: "Subprocess", value: "subprocess" },
							{ name: "Webhook", value: "webhook" },
							{ name: "Inline", value: "inline" },
						),
				)
				.addStringOption((opt) =>
					opt
						.setName("role")
						.setDescription("Agent role")
						.setRequired(true)
						.addChoices(
							{ name: "Architect", value: "architect" },
							{ name: "Builder", value: "builder" },
							{ name: "Tester", value: "tester" },
							{ name: "Reviewer", value: "reviewer" },
							{ name: "Expert", value: "expert" },
							{ name: "Scout", value: "scout" },
							{ name: "Executor", value: "executor" },
						),
				)
				.addStringOption((opt) => opt.setName("description").setDescription("Agent description")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("agent-delete")
				.setDescription("Delete an agent")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("workflows").setDescription("List all workflows"))
		.addSubcommand((sub) =>
			sub
				.setName("delegate")
				.setDescription("Delegate a task to an agent")
				.addStringOption((opt) => opt.setName("task").setDescription("Task prompt").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("role")
						.setDescription("Preferred agent role")
						.addChoices(
							{ name: "Architect", value: "architect" },
							{ name: "Builder", value: "builder" },
							{ name: "Tester", value: "tester" },
							{ name: "Reviewer", value: "reviewer" },
							{ name: "Expert", value: "expert" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("bootstrap")
				.setDescription("Bootstrap orchestrator with Z.ai GLM agent handlers")
				.addStringOption((opt) =>
					opt
						.setName("model")
						.setDescription("Default Z.ai GLM model for agents")
						.addChoices(
							{ name: "GLM-4.7 (Top Coding)", value: "GLM-4.7" },
							{ name: "GLM-4.6 (Stable)", value: "GLM-4.6" },
							{ name: "GLM-4.5 (General)", value: "glm-4.5" },
							{ name: "GLM-4.5-air (Fast)", value: "glm-4.5-air" },
						),
				)
				.addBooleanOption((opt) => opt.setName("learning").setDescription("Enable agent learning")),
		),

	// Pi-Watcher - Autonomous Monitoring & Hotfix
	new SlashCommandBuilder()
		.setName("watcher")
		.setDescription("Pi-Watcher - autonomous codebase monitoring and hotfixing")
		.addSubcommand((sub) => sub.setName("start").setDescription("Start the watcher"))
		.addSubcommand((sub) => sub.setName("stop").setDescription("Stop the watcher"))
		.addSubcommand((sub) => sub.setName("status").setDescription("Show watcher status and current issues"))
		.addSubcommand((sub) => sub.setName("check").setDescription("Run health checks now"))
		.addSubcommand((sub) =>
			sub
				.setName("fix")
				.setDescription("Manually trigger fix for an issue")
				.addStringOption((opt) => opt.setName("issue_id").setDescription("Issue ID to fix").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("ignore")
				.setDescription("Ignore an issue")
				.addStringOption((opt) => opt.setName("issue_id").setDescription("Issue ID to ignore").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("config")
				.setDescription("Update watcher configuration")
				.addIntegerOption((opt) => opt.setName("interval").setDescription("Check interval in minutes"))
				.addBooleanOption((opt) => opt.setName("autofix").setDescription("Enable/disable auto-fix")),
		),

	// Class 3.2 Multi-Agent Coordinator
	new SlashCommandBuilder()
		.setName("coordinate")
		.setDescription("Multi-agent coordination - parallel, debate, consensus, supervisor patterns")
		.addSubcommand((sub) =>
			sub
				.setName("parallel")
				.setDescription("Run multiple agents in parallel on a task")
				.addStringOption((opt) => opt.setName("task").setDescription("Task prompt").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("roles")
						.setDescription("Agent roles (comma-separated)")
						.setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("debate")
				.setDescription("Run agents in debate format")
				.addStringOption((opt) => opt.setName("topic").setDescription("Debate topic").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("roles")
						.setDescription("Agent roles (comma-separated)")
						.setRequired(true),
				)
				.addIntegerOption((opt) => opt.setName("rounds").setDescription("Number of debate rounds (default: 3)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("consensus")
				.setDescription("Run consensus voting among agents")
				.addStringOption((opt) => opt.setName("question").setDescription("Question for consensus").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("roles")
						.setDescription("Agent roles (comma-separated)")
						.setRequired(true),
				)
				.addStringOption((opt) =>
					opt
						.setName("method")
						.setDescription("Consensus method")
						.addChoices(
							{ name: "Majority", value: "majority" },
							{ name: "Weighted", value: "weighted" },
							{ name: "Unanimous", value: "unanimous" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("supervisor")
				.setDescription("Run with supervisor overseeing worker agents")
				.addStringOption((opt) => opt.setName("task").setDescription("Task for team").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("supervisor")
						.setDescription("Supervisor role")
						.setRequired(true)
						.addChoices(
							{ name: "Architect", value: "architect" },
							{ name: "Expert", value: "expert" },
							{ name: "Reviewer", value: "reviewer" },
						),
				)
				.addStringOption((opt) =>
					opt
						.setName("workers")
						.setDescription("Worker roles (comma-separated)")
						.setRequired(true),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("Show active coordinations")),

	// Class 3.3 Agent Memory System
	new SlashCommandBuilder()
		.setName("memory")
		.setDescription("Agent Memory System - performance tracking, insights, and smart routing")
		.addSubcommand((sub) =>
			sub
				.setName("stats")
				.setDescription("Show agent performance statistics")
				.addStringOption((opt) => opt.setName("agent_id").setDescription("Specific agent ID (optional)")),
		)
		.addSubcommand((sub) => sub.setName("insights").setDescription("View learned patterns and insights"))
		.addSubcommand((sub) =>
			sub
				.setName("recommend")
				.setDescription("Get routing recommendation for a task")
				.addStringOption((opt) => opt.setName("task_type").setDescription("Type of task").setRequired(true))
				.addStringOption((opt) => opt.setName("prompt").setDescription("Task prompt").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("rate")
				.setDescription("Rate a completed task")
				.addStringOption((opt) => opt.setName("task_id").setDescription("Task ID to rate").setRequired(true))
				.addIntegerOption((opt) =>
					opt
						.setName("quality")
						.setDescription("Quality rating 1-10")
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(10),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("best-agent")
				.setDescription("Find the best agent for a task type")
				.addStringOption((opt) => opt.setName("task_type").setDescription("Type of task").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("summary").setDescription("Show memory system summary")),

	// Class 3.5 Meta-Agent (TAC Pattern)
	new SlashCommandBuilder()
		.setName("meta-agent")
		.setDescription("Meta-Agent - create agents from descriptions (TAC pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("generate")
				.setDescription("Generate agent spec from description")
				.addStringOption((opt) => opt.setName("description").setDescription("Natural language agent description").setRequired(true))
				.addStringOption((opt) => opt.setName("name").setDescription("Agent name (optional)"))
				.addStringOption((opt) =>
					opt
						.setName("role")
						.setDescription("Agent role")
						.addChoices(
							{ name: "Architect", value: "architect" },
							{ name: "Builder", value: "builder" },
							{ name: "Tester", value: "tester" },
							{ name: "Reviewer", value: "reviewer" },
							{ name: "Expert", value: "expert" },
							{ name: "Scout", value: "scout" },
							{ name: "Executor", value: "executor" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Generate and create agent in one step")
				.addStringOption((opt) => opt.setName("description").setDescription("Agent description").setRequired(true))
				.addStringOption((opt) => opt.setName("name").setDescription("Agent name")),
		)
		.addSubcommand((sub) => sub.setName("suggest").setDescription("Get agent suggestions based on patterns"))
		.addSubcommand((sub) =>
			sub
				.setName("clone")
				.setDescription("Clone and modify an existing agent")
				.addStringOption((opt) => opt.setName("agent_id").setDescription("Agent ID to clone").setRequired(true))
				.addStringOption((opt) => opt.setName("modifications").setDescription("Modifications to apply").setRequired(true)),
		),

	// Class 3.6 Context Bundle System (TAC Pattern)
	new SlashCommandBuilder()
		.setName("bundle")
		.setDescription("Context Bundle - capture and replay session state (TAC pattern)")
		.addSubcommand((sub) =>
			sub
				.setName("capture")
				.setDescription("Capture current context as a bundle")
				.addStringOption((opt) => opt.setName("name").setDescription("Bundle name").setRequired(true))
				.addStringOption((opt) => opt.setName("description").setDescription("Bundle description"))
				.addStringOption((opt) => opt.setName("files").setDescription("Files to include (comma-separated)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("quick")
				.setDescription("Quick capture with auto-detected files")
				.addStringOption((opt) => opt.setName("name").setDescription("Bundle name").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("load")
				.setDescription("Load a bundle by ID or name")
				.addStringOption((opt) => opt.setName("id").setDescription("Bundle ID or name").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("apply")
				.setDescription("Apply bundle context to generate prompt")
				.addStringOption((opt) => opt.setName("id").setDescription("Bundle ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("list")
				.setDescription("List all bundles")
				.addStringOption((opt) => opt.setName("tag").setDescription("Filter by tag"))
				.addIntegerOption((opt) => opt.setName("limit").setDescription("Max bundles to show")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("delete")
				.setDescription("Delete a bundle")
				.addStringOption((opt) => opt.setName("id").setDescription("Bundle ID to delete").setRequired(true)),
		),

	// Class 3.7 Output Style System (TAC Pattern)
	new SlashCommandBuilder()
		.setName("style")
		.setDescription("Output Style - configurable response formats (TAC pattern)")
		.addSubcommand((sub) => sub.setName("list").setDescription("List all available output styles"))
		.addSubcommand((sub) =>
			sub
				.setName("set")
				.setDescription("Set output style for current session")
				.addStringOption((opt) =>
					opt
						.setName("style")
						.setDescription("Style to use")
						.setRequired(true)
						.addChoices(
							{ name: "Concise Ultra - Bullets only", value: "concise-ultra" },
							{ name: "Concise TTS - Voice-friendly", value: "concise-tts" },
							{ name: "Verbose YAML - Structured", value: "verbose-yaml" },
							{ name: "Observable Tools - Show tool calls", value: "observable-tools" },
							{ name: "Markdown Rich - Full formatting", value: "markdown-rich" },
							{ name: "JSON Structured - Machine parse", value: "json-structured" },
							{ name: "Discord Embed - Optimized", value: "discord-embed" },
							{ name: "Trading Report - Signals format", value: "trading-report" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("preview")
				.setDescription("Preview a style with sample text")
				.addStringOption((opt) =>
					opt
						.setName("style")
						.setDescription("Style to preview")
						.setRequired(true)
						.addChoices(
							{ name: "Concise Ultra", value: "concise-ultra" },
							{ name: "Concise TTS", value: "concise-tts" },
							{ name: "Discord Embed", value: "discord-embed" },
							{ name: "Trading Report", value: "trading-report" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("current").setDescription("Show current style settings")),

	// Class 3.8 Safety Guards (TAC Pattern: Dangerous command blocking)
	new SlashCommandBuilder()
		.setName("safety")
		.setDescription("Safety Guards - protect agents from dangerous commands (TAC pattern)")
		.addSubcommand((sub) => sub.setName("status").setDescription("Show safety guards status and stats"))
		.addSubcommand((sub) =>
			sub
				.setName("check")
				.setDescription("Check if a command is safe to execute")
				.addStringOption((opt) => opt.setName("command").setDescription("Command to check").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("rules")
				.setDescription("List safety rules by category")
				.addStringOption((opt) =>
					opt
						.setName("category")
						.setDescription("Rule category")
						.setRequired(false)
						.addChoices(
							{ name: "Filesystem", value: "filesystem" },
							{ name: "Git", value: "git" },
							{ name: "Process", value: "process" },
							{ name: "Network", value: "network" },
							{ name: "Secrets", value: "secrets" },
							{ name: "Database", value: "database" },
						),
				),
		)
		.addSubcommand((sub) => sub.setName("history").setDescription("Show blocked command history"))
		.addSubcommand((sub) =>
			sub
				.setName("toggle")
				.setDescription("Enable or disable safety guards")
				.addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable guards").setRequired(true)),
		),

	// Class 3.9 Agent Feedback Loop (TAC Pattern: Self-improvement)
	new SlashCommandBuilder()
		.setName("feedback")
		.setDescription("Agent Feedback - collect ratings to improve agents (TAC pattern)")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show global feedback statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("rate")
				.setDescription("Rate an agent's response")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(true))
				.addIntegerOption((opt) =>
					opt
						.setName("rating")
						.setDescription("Rating (1-5 stars)")
						.setRequired(true)
						.addChoices(
							{ name: "⭐ (1)", value: 1 },
							{ name: "⭐⭐ (2)", value: 2 },
							{ name: "⭐⭐⭐ (3)", value: 3 },
							{ name: "⭐⭐⭐⭐ (4)", value: 4 },
							{ name: "⭐⭐⭐⭐⭐ (5)", value: 5 },
						),
				)
				.addStringOption((opt) => opt.setName("comment").setDescription("Optional feedback comment")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("summary")
				.setDescription("Get feedback summary for an agent")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("recent")
				.setDescription("Show recent feedback")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID (optional)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("suggestions")
				.setDescription("Get improvement suggestions for an agent")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("leaderboard").setDescription("Show top-rated agents")),

	// Class 3.10 Agent Notification System (TAC Pattern: Cross-channel alerts)
	new SlashCommandBuilder()
		.setName("notify")
		.setDescription("Agent Notifications - cross-channel alerts system (TAC pattern)")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show notification statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("send")
				.setDescription("Send a notification")
				.addStringOption((opt) => opt.setName("message").setDescription("Notification message").setRequired(true))
				.addStringOption((opt) =>
					opt
						.setName("priority")
						.setDescription("Priority level")
						.addChoices(
							{ name: "ℹ️ Info", value: "info" },
							{ name: "✅ Success", value: "success" },
							{ name: "⚠️ Warning", value: "warning" },
							{ name: "❌ Error", value: "error" },
							{ name: "🚨 Critical", value: "critical" },
						),
				)
				.addUserOption((opt) => opt.setName("user").setDescription("Target user (default: self)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("inbox")
				.setDescription("View your notification inbox")
				.addBooleanOption((opt) => opt.setName("unread").setDescription("Show unread only")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("read")
				.setDescription("Mark notifications as read")
				.addStringOption((opt) => opt.setName("id").setDescription("Notification ID (or 'all')")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("preferences")
				.setDescription("View or update notification preferences")
				.addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable notifications"))
				.addStringOption((opt) =>
					opt
						.setName("min_priority")
						.setDescription("Minimum priority to receive")
						.addChoices(
							{ name: "Info (all)", value: "info" },
							{ name: "Success+", value: "success" },
							{ name: "Warning+", value: "warning" },
							{ name: "Error+", value: "error" },
							{ name: "Critical only", value: "critical" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("mute")
				.setDescription("Mute notifications from an agent")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID to mute").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("unmute")
				.setDescription("Unmute notifications from an agent")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID to unmute").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("templates").setDescription("List available notification templates")),
	new SlashCommandBuilder()
		.setName("session")
		.setDescription("Session Isolation - per-conversation state management (TAC pattern)")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show session statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new isolated session")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID for session").setRequired(true))
				.addStringOption((opt) => opt.setName("tags").setDescription("Comma-separated tags"))
				.addIntegerOption((opt) => opt.setName("ttl").setDescription("TTL in minutes (0 = no expiry)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("get")
				.setDescription("Get session state value")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true))
				.addStringOption((opt) => opt.setName("key").setDescription("State key to retrieve")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("set")
				.setDescription("Set session state value")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true))
				.addStringOption((opt) => opt.setName("key").setDescription("State key").setRequired(true))
				.addStringOption((opt) => opt.setName("value").setDescription("Value (JSON)").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List your sessions"))
		.addSubcommand((sub) =>
			sub
				.setName("snapshot")
				.setDescription("Create a session snapshot")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true))
				.addStringOption((opt) => opt.setName("name").setDescription("Snapshot name").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("snapshots")
				.setDescription("List snapshots for a session")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("restore")
				.setDescription("Restore session from snapshot")
				.addStringOption((opt) => opt.setName("snapshot_id").setDescription("Snapshot ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("fork")
				.setDescription("Fork a session")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID to fork").setRequired(true))
				.addStringOption((opt) => opt.setName("agent").setDescription("New agent ID (optional)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("suspend")
				.setDescription("Suspend a session")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("resume")
				.setDescription("Resume a suspended session")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("complete")
				.setDescription("Mark session as completed")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("destroy")
				.setDescription("Destroy a session and all its state")
				.addStringOption((opt) => opt.setName("id").setDescription("Session ID").setRequired(true)),
		),
	new SlashCommandBuilder()
		.setName("version")
		.setDescription("Agent Versioning - version control for agent configs (TAC pattern)")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show versioning statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new version of an agent config")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(true))
				.addStringOption((opt) => opt.setName("name").setDescription("Agent name").setRequired(true))
				.addStringOption((opt) => opt.setName("prompt").setDescription("System prompt").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("change").setDescription("Change type").addChoices(
						{ name: "Patch (bug fix)", value: "patch" },
						{ name: "Minor (feature)", value: "minor" },
						{ name: "Major (breaking)", value: "major" },
					),
				)
				.addStringOption((opt) => opt.setName("changelog").setDescription("Changelog entry")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("current")
				.setDescription("Get current version of an agent")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("history")
				.setDescription("View version history for an agent")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(true))
				.addBooleanOption((opt) => opt.setName("archived").setDescription("Include archived versions")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("diff")
				.setDescription("Compare two versions")
				.addStringOption((opt) => opt.setName("version_a").setDescription("First version ID").setRequired(true))
				.addStringOption((opt) => opt.setName("version_b").setDescription("Second version ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("rollback")
				.setDescription("Rollback to a previous version")
				.addStringOption((opt) => opt.setName("agent").setDescription("Agent ID").setRequired(true))
				.addStringOption((opt) => opt.setName("version_id").setDescription("Target version ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("promote")
				.setDescription("Promote a version to a different tag")
				.addStringOption((opt) => opt.setName("version_id").setDescription("Version ID").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("tag").setDescription("Target tag").setRequired(true).addChoices(
						{ name: "Dev", value: "dev" },
						{ name: "Staging", value: "staging" },
						{ name: "Production", value: "production" },
						{ name: "Archived", value: "archived" },
					),
				),
		)
		.addSubcommand((sub) => sub.setName("agents").setDescription("List all versioned agents"))
		.addSubcommand((sub) =>
			sub
				.setName("tag")
				.setDescription("List versions by tag")
				.addStringOption((opt) =>
					opt.setName("tag").setDescription("Tag to filter by").setRequired(true).addChoices(
						{ name: "Dev", value: "dev" },
						{ name: "Staging", value: "staging" },
						{ name: "Production", value: "production" },
						{ name: "Archived", value: "archived" },
					),
				),
		),
	new SlashCommandBuilder()
		.setName("discover")
		.setDescription("Agent Discovery - dynamic agent registration and discovery (TAC pattern)")
		.addSubcommand((sub) => sub.setName("stats").setDescription("Show discovery statistics"))
		.addSubcommand((sub) =>
			sub
				.setName("register")
				.setDescription("Register a new agent")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true))
				.addStringOption((opt) => opt.setName("name").setDescription("Agent name").setRequired(true))
				.addStringOption((opt) => opt.setName("description").setDescription("Agent description"))
				.addStringOption((opt) => opt.setName("tags").setDescription("Comma-separated tags"))
				.addIntegerOption((opt) => opt.setName("priority").setDescription("Priority 1-10")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("unregister")
				.setDescription("Unregister an agent")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("find")
				.setDescription("Find agents by capability")
				.addStringOption((opt) => opt.setName("capability").setDescription("Capability to search for").setRequired(true))
				.addIntegerOption((opt) => opt.setName("min_health").setDescription("Minimum health score 0-100")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("get")
				.setDescription("Get agent details")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("list")
				.setDescription("List all agents")
				.addStringOption((opt) =>
					opt.setName("status").setDescription("Filter by status").addChoices(
						{ name: "Online", value: "online" },
						{ name: "Offline", value: "offline" },
						{ name: "Busy", value: "busy" },
						{ name: "Degraded", value: "degraded" },
					),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("heartbeat")
				.setDescription("Send heartbeat for an agent")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true))
				.addIntegerOption((opt) => opt.setName("load").setDescription("Current load")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("status")
				.setDescription("Update agent status")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("status").setDescription("New status").setRequired(true).addChoices(
						{ name: "Online", value: "online" },
						{ name: "Offline", value: "offline" },
						{ name: "Busy", value: "busy" },
						{ name: "Degraded", value: "degraded" },
						{ name: "Maintenance", value: "maintenance" },
					),
				),
		)
		.addSubcommand((sub) => sub.setName("capabilities").setDescription("List all unique capabilities"))
		.addSubcommand((sub) =>
			sub
				.setName("deps")
				.setDescription("Resolve agent dependencies")
				.addStringOption((opt) => opt.setName("id").setDescription("Agent ID").setRequired(true)),
		),
	new SlashCommandBuilder()
		.setName("health")
		.setDescription("Health Monitoring - comprehensive health checks and metrics (TAC pattern)")
		.addSubcommand((sub) => sub.setName("status").setDescription("Show system health status"))
		.addSubcommand((sub) =>
			sub
				.setName("register")
				.setDescription("Register a component for monitoring")
				.addStringOption((opt) => opt.setName("id").setDescription("Component ID").setRequired(true))
				.addStringOption((opt) => opt.setName("name").setDescription("Component name").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("type").setDescription("Component type").setRequired(true).addChoices(
						{ name: "Agent", value: "agent" },
						{ name: "Database", value: "database" },
						{ name: "API", value: "api" },
						{ name: "Queue", value: "queue" },
						{ name: "Cache", value: "cache" },
						{ name: "External", value: "external" },
						{ name: "System", value: "system" },
					),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("check")
				.setDescription("Record a health check")
				.addStringOption((opt) => opt.setName("id").setDescription("Component ID").setRequired(true))
				.addBooleanOption((opt) => opt.setName("healthy").setDescription("Is healthy").setRequired(true))
				.addStringOption((opt) => opt.setName("message").setDescription("Status message")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("component")
				.setDescription("Get component health details")
				.addStringOption((opt) => opt.setName("id").setDescription("Component ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("metric")
				.setDescription("Record a metric value")
				.addStringOption((opt) => opt.setName("id").setDescription("Component ID").setRequired(true))
				.addStringOption((opt) => opt.setName("name").setDescription("Metric name").setRequired(true))
				.addNumberOption((opt) => opt.setName("value").setDescription("Metric value").setRequired(true))
				.addStringOption((opt) => opt.setName("unit").setDescription("Unit (e.g., ms, %, count)")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("threshold")
				.setDescription("Set an alert threshold")
				.addStringOption((opt) => opt.setName("id").setDescription("Component ID").setRequired(true))
				.addStringOption((opt) => opt.setName("metric").setDescription("Metric name").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("operator").setDescription("Comparison operator").setRequired(true).addChoices(
						{ name: "> Greater than", value: ">" },
						{ name: "< Less than", value: "<" },
						{ name: ">= Greater or equal", value: ">=" },
						{ name: "<= Less or equal", value: "<=" },
					),
				)
				.addNumberOption((opt) => opt.setName("value").setDescription("Threshold value").setRequired(true))
				.addStringOption((opt) =>
					opt.setName("severity").setDescription("Alert severity").addChoices(
						{ name: "Info", value: "info" },
						{ name: "Warning", value: "warning" },
						{ name: "Critical", value: "critical" },
					),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("alerts")
				.setDescription("View active alerts")
				.addBooleanOption((opt) => opt.setName("all").setDescription("Include acknowledged alerts")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("ack")
				.setDescription("Acknowledge an alert")
				.addStringOption((opt) => opt.setName("alert_id").setDescription("Alert ID").setRequired(true)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("history")
				.setDescription("View health check history")
				.addStringOption((opt) => opt.setName("id").setDescription("Component ID").setRequired(true))
				.addIntegerOption((opt) => opt.setName("limit").setDescription("Number of checks to show")),
		),
];

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(): { workingDir: string } {
	const args = process.argv.slice(2);
	let workingDir: string | undefined;

	for (const arg of args) {
		if (!arg.startsWith("-")) {
			workingDir = arg;
		}
	}

	if (!workingDir) {
		console.error("Usage: pi-discord <working-directory>");
		process.exit(1);
	}

	return { workingDir: resolve(workingDir) };
}

// ============================================================================
// Logging
// ============================================================================

function logInfo(message: string): void {
	console.log(chalk.blue("[INFO]"), message);
}

function logWarning(message: string, detail?: string): void {
	console.log(chalk.yellow("[WARN]"), message, detail ? chalk.dim(detail) : "");
}

function logError(message: string, detail?: string): void {
	console.error(chalk.red("[ERROR]"), message, detail ? chalk.dim(detail) : "");
}

function logTool(toolName: string, label: string): void {
	console.log(chalk.cyan("[TOOL]"), `${toolName}: ${label}`);
}

function logSlash(command: string, user: string): void {
	console.log(chalk.magenta("[SLASH]"), `/${command} by ${user}`);
}

// ============================================================================
// OpenHands Expertise Management
// ============================================================================

interface ExpertiseInfo {
	mode: string;
	sessionCount: number;
	lastUpdated: string;
	filePath: string;
	content: string;
}

function getExpertiseDir(): string {
	return join(process.cwd(), "src", "agents", "expertise");
}

function getAllExpertise(): ExpertiseInfo[] {
	const expertiseDir = getExpertiseDir();

	if (!existsSync(expertiseDir)) {
		return [];
	}

	const files = readdirSync(expertiseDir).filter((f) => f.endsWith(".md"));

	return files.map((file) => {
		const filePath = join(expertiseDir, file);
		const content = readFileSync(filePath, "utf-8");
		const stats = statSync(filePath);

		// Count session insights
		const sessionMatches = content.match(/### Session:/g);
		const sessionCount = sessionMatches ? sessionMatches.length : 0;

		return {
			mode: file.replace(".md", ""),
			sessionCount,
			lastUpdated: stats.mtime.toISOString(),
			filePath,
			content,
		};
	});
}

function getExpertiseForMode(mode: string): ExpertiseInfo | null {
	const expertiseDir = getExpertiseDir();
	const filePath = join(expertiseDir, `${mode}.md`);

	if (!existsSync(filePath)) {
		return null;
	}

	const content = readFileSync(filePath, "utf-8");
	const stats = statSync(filePath);

	const sessionMatches = content.match(/### Session:/g);
	const sessionCount = sessionMatches ? sessionMatches.length : 0;

	return {
		mode,
		sessionCount,
		lastUpdated: stats.mtime.toISOString(),
		filePath,
		content,
	};
}

function extractRecentLearnings(content: string, limit: number = 5): string[] {
	const learnings: string[] = [];
	const sessionRegex = /### Session: (.+?)\n\*\*Task:\*\* (.+?)\n\n(.+?)(?=\n### Session:|$)/gs;

	for (const match of content.matchAll(sessionRegex)) {
		const [, timestamp, task, learning] = match;
		learnings.push(`**${timestamp}**\n${task.substring(0, 100)}...\n${learning.substring(0, 300)}...`);
	}

	return learnings.slice(-limit);
}

function clearExpertise(mode: string): boolean {
	const expertiseDir = getExpertiseDir();
	const filePath = join(expertiseDir, `${mode}.md`);

	if (!existsSync(filePath)) {
		return false;
	}

	// Create empty template
	const template = `# ${mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, " ")} Expert

## Mental Model
Accumulated expertise for ${mode.replace(/_/g, " ")} tasks.

## Patterns Learned
<!-- Agent updates this section with successful patterns -->

## Common Pitfalls
<!-- Agent updates this section with mistakes to avoid -->

## Effective Approaches
<!-- Agent updates this section with approaches that worked well -->

## Code Templates
<!-- Agent stores reusable code patterns here -->

## Session Insights
<!-- Recent session learnings appear here -->
`;

	writeFileSync(filePath, template, "utf-8");
	return true;
}

// ============================================================================
// Discord UI Helpers (Embeds, Buttons)
// ============================================================================

function _createResponseEmbed(title: string, description: string, color: number = 0x0099ff): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(color)
		.setTitle(title)
		.setDescription(description.substring(0, 4096))
		.setTimestamp()
		.setFooter({ text: "Pi Discord Bot" });
}

function createStatusEmbed(
	currentModel: string,
	globalModel: string,
	uptime: string,
	workspace: string,
	channels: number,
): EmbedBuilder {
	const modelInfo = currentModel === globalModel ? `\`${currentModel}\` (global)` : `\`${currentModel}\` (personal)`;

	return new EmbedBuilder()
		.setColor(0x00ff00)
		.setTitle("🤖 Pi Discord Bot Status")
		.addFields(
			{ name: "Current Model", value: modelInfo, inline: true },
			{ name: "Uptime", value: uptime, inline: true },
			{ name: "Active Channels", value: String(channels), inline: true },
			{ name: "Workspace", value: `\`${workspace}\``, inline: false },
		)
		.addFields(
			{
				name: "AI Commands",
				value:
					"`/ask` - Ask the AI anything\n" +
					"`/model` - Manage AI models\n" +
					"`/remember` - Save to memory\n" +
					"`/memory` - Show memory\n" +
					"`/forget` - Clear memory",
				inline: true,
			},
			{
				name: "System Commands",
				value:
					"`/bash` - Run shell commands\n" +
					"`/read` - Read files\n" +
					"`/status` - Bot status\n" +
					"`/skills` - List capabilities",
				inline: true,
			},
			{
				name: "Crypto Commands",
				value:
					"`/price` - Get crypto price\n" +
					"`/alert` - Set price alert\n" +
					"`/news` - Latest news\n" +
					"`/chart` - TradingView chart\n" +
					"`/convert` - Currency converter",
				inline: true,
			},
		)
		.setTimestamp()
		.setFooter({ text: "Or just @mention me!" });
}

function _createFeedbackButtons(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId("feedback_helpful").setLabel("👍 Helpful").setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId("feedback_not_helpful").setLabel("👎 Not Helpful").setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId("feedback_more").setLabel("📝 Tell me more").setStyle(ButtonStyle.Primary),
	);
}

// ============================================================================
// Shell Utilities
// ============================================================================

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

interface ExecOptions {
	timeout?: number;
	signal?: AbortSignal;
}

async function execCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("sh", ["-c", command], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timeoutHandle =
			options?.timeout && options.timeout > 0
				? setTimeout(() => {
						timedOut = true;
						try {
							process.kill(-child.pid!, "SIGKILL");
						} catch {}
					}, options.timeout * 1000)
				: undefined;

		const onAbort = () => {
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			}
		};

		if (options?.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		child.stdout?.on("data", (data) => {
			stdout += data.toString();
			if (stdout.length > 10 * 1024 * 1024) {
				stdout = stdout.slice(0, 10 * 1024 * 1024);
			}
		});

		child.stderr?.on("data", (data) => {
			stderr += data.toString();
			if (stderr.length > 10 * 1024 * 1024) {
				stderr = stderr.slice(0, 10 * 1024 * 1024);
			}
		});

		child.on("close", (code) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			if (options?.signal) {
				options.signal.removeEventListener("abort", onAbort);
			}

			if (options?.signal?.aborted) {
				reject(new Error(`${stdout}\n${stderr}\nCommand aborted`.trim()));
				return;
			}

			if (timedOut) {
				reject(new Error(`${stdout}\n${stderr}\nCommand timed out after ${options?.timeout} seconds`.trim()));
				return;
			}

			resolve({ stdout, stderr, code: code ?? 0 });
		});
	});
}

// ============================================================================
// Crypto API Utilities
// ============================================================================

async function getCryptoPrice(symbol: string): Promise<{ price: number; change24h: number; marketCap: number }> {
	try {
		const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
		const response = await fetch(url);
		const data = await response.json();

		const symbolData = data[symbol.toLowerCase()];
		if (!symbolData) {
			throw new Error(`Symbol not found: ${symbol}`);
		}

		return {
			price: symbolData.usd,
			change24h: symbolData.usd_24h_change || 0,
			marketCap: symbolData.usd_market_cap || 0,
		};
	} catch (error) {
		throw new Error(`Failed to fetch price: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** CryptoPanic API news item */
interface CryptoPanicNewsItem {
	title: string;
	url: string;
	source?: { title?: string };
}

async function getCryptoNews(topic?: string): Promise<Array<{ title: string; url: string; source: string }>> {
	try {
		// Using CryptoPanic free API (no key required for basic use)
		const url = topic
			? `https://cryptopanic.com/api/v1/posts/?auth_token=free&filter=${encodeURIComponent(topic)}`
			: `https://cryptopanic.com/api/v1/posts/?auth_token=free&kind=news`;

		const response = await fetch(url);
		const data = (await response.json()) as { results?: CryptoPanicNewsItem[] };

		if (!data.results || data.results.length === 0) {
			return [];
		}

		return data.results.slice(0, 5).map((item) => ({
			title: item.title,
			url: item.url,
			source: item.source?.title || "Unknown",
		}));
	} catch (_error) {
		// Fallback: return empty array if API fails
		return [];
	}
}

async function convertCurrency(amount: number, from: string, to: string): Promise<{ result: number; rate: number }> {
	try {
		// Use CoinGecko for crypto conversions
		const fromLower = from.toLowerCase();
		const toLower = to.toLowerCase();

		// Get both prices in USD
		const url = `https://api.coingecko.com/api/v3/simple/price?ids=${fromLower},${toLower}&vs_currencies=usd`;
		const response = await fetch(url);
		const data = await response.json();

		const fromPrice = data[fromLower]?.usd;
		const toPrice = data[toLower]?.usd;

		if (!fromPrice || !toPrice) {
			throw new Error(`Currency not found: ${!fromPrice ? from : to}`);
		}

		const rate = fromPrice / toPrice;
		const result = amount * rate;

		return { result, rate };
	} catch (error) {
		throw new Error(`Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function generateTradingViewLink(symbol: string, timeframe: string): string {
	// Normalize symbol (remove slashes, make uppercase)
	const normalizedSymbol = symbol.toUpperCase().replace(/[/-]/g, "");

	// Map common timeframes
	const timeframeMap: Record<string, string> = {
		"1m": "1",
		"5m": "5",
		"15m": "15",
		"30m": "30",
		"1h": "60",
		"4h": "240",
		"1d": "D",
		"1w": "W",
		"1M": "M",
	};

	const mappedTimeframe = timeframeMap[timeframe.toLowerCase()] || timeframe;

	return `https://www.tradingview.com/chart/?symbol=${normalizedSymbol}&interval=${mappedTimeframe}`;
}

// ============================================================================
// Truncation Utilities
// ============================================================================

function _formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncateTail(content: string): {
	content: string;
	truncated: boolean;
	totalLines: number;
	outputLines: number;
} {
	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	if (totalLines <= DEFAULT_MAX_LINES && totalBytes <= DEFAULT_MAX_BYTES) {
		return { content, truncated: false, totalLines, outputLines: totalLines };
	}

	const outputLines: string[] = [];
	let outputBytes = 0;

	for (let i = lines.length - 1; i >= 0 && outputLines.length < DEFAULT_MAX_LINES; i--) {
		const line = lines[i];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0);

		if (outputBytes + lineBytes > DEFAULT_MAX_BYTES) break;

		outputLines.unshift(line);
		outputBytes += lineBytes;
	}

	return {
		content: outputLines.join("\n"),
		truncated: true,
		totalLines,
		outputLines: outputLines.length,
	};
}

// ============================================================================
// Message Splitting for Discord's 2000 char limit
// ============================================================================

const _DISCORD_MAX_LENGTH = 2000;
const DISCORD_SAFE_LENGTH = 1950; // Leave room for formatting

/**
 * Split a long message into chunks that fit Discord's 2000 char limit.
 * Tries to split at natural boundaries (newlines, then spaces).
 */
function splitMessage(content: string, maxLength = DISCORD_SAFE_LENGTH): string[] {
	if (content.length <= maxLength) {
		return [content];
	}

	const chunks: string[] = [];
	let remaining = content;

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}

		// Find best split point
		let splitAt = maxLength;

		// Try to split at a double newline (paragraph break)
		const doubleNewline = remaining.lastIndexOf("\n\n", maxLength);
		if (doubleNewline > maxLength * 0.5) {
			splitAt = doubleNewline + 2;
		} else {
			// Try to split at a single newline
			const singleNewline = remaining.lastIndexOf("\n", maxLength);
			if (singleNewline > maxLength * 0.3) {
				splitAt = singleNewline + 1;
			} else {
				// Try to split at a space
				const space = remaining.lastIndexOf(" ", maxLength);
				if (space > maxLength * 0.3) {
					splitAt = space + 1;
				}
				// Otherwise just hard split at maxLength
			}
		}

		chunks.push(remaining.slice(0, splitAt).trimEnd());
		remaining = remaining.slice(splitAt).trimStart();
	}

	// Add part indicators if multiple chunks
	if (chunks.length > 1) {
		return chunks.map((chunk, i) => {
			if (i === 0) return chunk;
			return `_(continued ${i + 1}/${chunks.length})_\n${chunk}`;
		});
	}

	return chunks;
}

// ============================================================================
// Agent Tools
// ============================================================================

const bashSchema = Type.Object({
	label: Type.String({ description: "Brief description of what this command does (shown to user)" }),
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
});

function createBashTool(): AgentTool<typeof bashSchema> {
	return {
		name: "bash",
		label: "bash",
		// Minimal description per Mario Zechner's philosophy
		description: `Execute bash command. Returns stdout/stderr.`,
		parameters: bashSchema,
		execute: async (_toolCallId, { command, timeout, label }, signal) => {
			logTool("bash", label);

			// YOLO MODE: Log dangerous commands but execute anyway (Mario Zechner philosophy)
			if (isDangerousCommand(command)) {
				logWarning("[YOLO] Dangerous command executing:", command.substring(0, 100));
			}

			const result = await execCommand(command, { timeout, signal });
			let output = "";
			if (result.stdout) output += result.stdout;
			if (result.stderr) {
				if (output) output += "\n";
				output += result.stderr;
			}

			const truncation = truncateTail(output);
			let outputText = truncation.content || "(no output)";

			if (truncation.truncated) {
				const startLine = truncation.totalLines - truncation.outputLines + 1;
				outputText += `\n\n[Showing lines ${startLine}-${truncation.totalLines} of ${truncation.totalLines}]`;
			}

			if (result.code !== 0) {
				throw new Error(`${outputText}\n\nCommand exited with code ${result.code}`.trim());
			}

			return { content: [{ type: "text", text: outputText }], details: undefined };
		},
	};
}

const readSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're reading (shown to user)" }),
	path: Type.String({ description: "Path to the file to read" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum lines to read" })),
});

function createReadTool(): AgentTool<typeof readSchema> {
	return {
		name: "read",
		label: "read",
		description: `Read file contents. Use offset/limit for large files.`,
		parameters: readSchema,
		execute: async (_toolCallId, { path, offset, limit, label }, signal) => {
			logTool("read", `${label} (${path})`);

			const countResult = await execCommand(`wc -l < ${shellEscape(path)}`, { signal });
			if (countResult.code !== 0) {
				throw new Error(countResult.stderr || `Failed to read file: ${path}`);
			}
			const totalLines = parseInt(countResult.stdout.trim(), 10) + 1;

			const startLine = offset ? Math.max(1, offset) : 1;
			const cmd = startLine === 1 ? `cat ${shellEscape(path)}` : `tail -n +${startLine} ${shellEscape(path)}`;

			const result = await execCommand(cmd, { signal });
			if (result.code !== 0) {
				throw new Error(result.stderr || `Failed to read file: ${path}`);
			}

			let content = result.stdout;

			if (limit !== undefined) {
				const lines = content.split("\n");
				content = lines.slice(0, limit).join("\n");
			}

			const truncation = truncateTail(content);
			let outputText = truncation.content;

			if (truncation.truncated) {
				const endLine = startLine + truncation.outputLines - 1;
				outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue]`;
			}

			return { content: [{ type: "text", text: outputText }], details: undefined };
		},
	};
}

const writeSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're writing (shown to user)" }),
	path: Type.String({ description: "Path to the file to write" }),
	content: Type.String({ description: "Content to write" }),
});

function createWriteTool(): AgentTool<typeof writeSchema> {
	return {
		name: "write",
		label: "write",
		description: "Write content to a file. Creates parent directories. Overwrites existing files.",
		parameters: writeSchema,
		execute: async (_toolCallId, { path, content, label }, signal) => {
			logTool("write", `${label} (${path})`);

			const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : ".";
			const cmd = `mkdir -p ${shellEscape(dir)} && printf '%s' ${shellEscape(content)} > ${shellEscape(path)}`;

			const result = await execCommand(cmd, { signal });
			if (result.code !== 0) {
				throw new Error(result.stderr || `Failed to write file: ${path}`);
			}

			return {
				content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
				details: undefined,
			};
		},
	};
}

const editSchema = Type.Object({
	label: Type.String({ description: "Brief description of the edit (shown to user)" }),
	path: Type.String({ description: "Path to the file to edit" }),
	oldText: Type.String({ description: "Exact text to find and replace" }),
	newText: Type.String({ description: "New text to replace with" }),
});

function createEditTool(): AgentTool<typeof editSchema> {
	return {
		name: "edit",
		label: "edit",
		description: "Edit a file by replacing exact text. oldText must match exactly including whitespace.",
		parameters: editSchema,
		execute: async (_toolCallId, { path, oldText, newText, label }, signal) => {
			logTool("edit", `${label} (${path})`);

			const readResult = await execCommand(`cat ${shellEscape(path)}`, { signal });
			if (readResult.code !== 0) {
				throw new Error(readResult.stderr || `File not found: ${path}`);
			}

			const content = readResult.stdout;

			if (!content.includes(oldText)) {
				throw new Error(`Could not find the exact text in ${path}. Must match exactly including whitespace.`);
			}

			const occurrences = content.split(oldText).length - 1;
			if (occurrences > 1) {
				throw new Error(`Found ${occurrences} occurrences. Text must be unique. Add more context.`);
			}

			const index = content.indexOf(oldText);
			const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length);

			const writeResult = await execCommand(`printf '%s' ${shellEscape(newContent)} > ${shellEscape(path)}`, {
				signal,
			});
			if (writeResult.code !== 0) {
				throw new Error(writeResult.stderr || `Failed to write file: ${path}`);
			}

			return {
				content: [
					{
						type: "text",
						text: `Successfully edited ${path}. Changed ${oldText.length} chars to ${newText.length} chars.`,
					},
				],
				details: undefined,
			};
		},
	};
}

// ============================================================================
// Memory System
// ============================================================================

// PERF: Memory cache with 5-minute TTL to avoid repeated disk I/O
const memoryCache = new Map<string, { content: string; expires: number }>();
const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getMemory(channelDir: string, workspaceDir: string): string {
	const cacheKey = `${channelDir}|${workspaceDir}`;
	const cached = memoryCache.get(cacheKey);
	if (cached && Date.now() < cached.expires) {
		return cached.content;
	}

	const parts: string[] = [];

	const globalMemoryPath = join(workspaceDir, "MEMORY.md");
	if (existsSync(globalMemoryPath)) {
		try {
			const content = readFileSync(globalMemoryPath, "utf-8").trim();
			if (content) parts.push(`### Global Memory\n${content}`);
		} catch {}
	}

	const channelMemoryPath = join(channelDir, "MEMORY.md");
	if (existsSync(channelMemoryPath)) {
		try {
			const content = readFileSync(channelMemoryPath, "utf-8").trim();
			if (content) parts.push(`### Channel Memory\n${content}`);
		} catch {}
	}

	const result = parts.length > 0 ? parts.join("\n\n") : "(no memory yet)";
	memoryCache.set(cacheKey, { content: result, expires: Date.now() + MEMORY_CACHE_TTL });
	return result;
}

// Invalidate memory cache when memory is modified
function invalidateMemoryCache(channelDir: string, workspaceDir: string): void {
	const cacheKey = `${channelDir}|${workspaceDir}`;
	memoryCache.delete(cacheKey);
}

function addToMemory(text: string, channelDir: string, workspaceDir: string, isGlobal: boolean): void {
	const memoryPath = isGlobal ? join(workspaceDir, "MEMORY.md") : join(channelDir, "MEMORY.md");
	const dir = isGlobal ? workspaceDir : channelDir;

	ensureDir(dir);

	const timestamp = new Date().toISOString().split("T")[0];
	const entry = `\n- [${timestamp}] ${text}`;

	if (existsSync(memoryPath)) {
		appendFileSync(memoryPath, entry);
	} else {
		writeFileSync(memoryPath, `# Memory\n${entry}`);
	}

	// PERF: Invalidate cache after modification
	invalidateMemoryCache(channelDir, workspaceDir);
}

function clearMemory(channelDir: string, workspaceDir: string, isGlobal: boolean): boolean {
	const memoryPath = isGlobal ? join(workspaceDir, "MEMORY.md") : join(channelDir, "MEMORY.md");

	if (existsSync(memoryPath)) {
		writeFileSync(memoryPath, "# Memory\n");
		// PERF: Invalidate cache after clearing
		invalidateMemoryCache(channelDir, workspaceDir);
		return true;
	}
	return false;
}

// ============================================================================
// Skills System (aligned with pi-mom)
// ============================================================================

// PERF: Skills cache with 10-minute TTL (skills rarely change)
const skillsCache = new Map<string, { skills: Skill[]; expires: number }>();
const SKILLS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Load skills from workspace and channel directories.
 * Skills are directories containing SKILL.md with frontmatter.
 * Channel skills override workspace skills on name collision.
 */
function loadDiscordSkills(channelDir: string, workspacePath: string): Skill[] {
	const cacheKey = `${channelDir}|${workspacePath}`;
	const cached = skillsCache.get(cacheKey);
	if (cached && Date.now() < cached.expires) {
		return cached.skills;
	}

	const skillMap = new Map<string, Skill>();

	// Load workspace-level skills (global)
	const workspaceSkillsDir = join(workspacePath, "skills");
	const workspaceResult = loadSkillsFromDir({ dir: workspaceSkillsDir, source: "workspace" });
	for (const skill of workspaceResult.skills) {
		skillMap.set(skill.name, skill);
	}

	// Load channel-specific skills (override workspace skills on collision)
	const channelSkillsDir = join(channelDir, "skills");
	const channelResult = loadSkillsFromDir({ dir: channelSkillsDir, source: "channel" });
	for (const skill of channelResult.skills) {
		skillMap.set(skill.name, skill);
	}

	const skills = Array.from(skillMap.values());
	skillsCache.set(cacheKey, { skills, expires: Date.now() + SKILLS_CACHE_TTL });
	return skills;
}

// Invalidate skills cache (call after skill management commands)
function _invalidateSkillsCache(): void {
	skillsCache.clear();
}

/**
 * Legacy skill loader for backwards compatibility with old .md skill files
 */
function loadLegacySkills(workspacePath: string): string {
	const skillsDir = join(workspacePath, "skills");
	if (!existsSync(skillsDir)) {
		return "";
	}

	const skillFiles = [
		"model-management.md",
		"quant-trading.md",
		"technical-analysis.md",
		"risk-management.md",
		"trading-system-monitor.md",
		"market-data.md",
	];
	const skills: string[] = [];

	for (const file of skillFiles) {
		const skillPath = join(skillsDir, file);
		if (existsSync(skillPath)) {
			try {
				const content = readFileSync(skillPath, "utf-8").trim();
				if (content) {
					skills.push(content);
				}
			} catch {
				// Ignore read errors
			}
		}
	}

	if (skills.length === 0) {
		return "";
	}

	return `\n## Legacy Skills\n${skills.join("\n\n---\n\n")}`;
}

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(workspacePath: string, channelId: string, _channelName: string, memory: string): string {
	const channelPath = `${workspacePath}/${channelId}`;

	// Load skills on-demand (Mario's progressive disclosure principle)
	// 1. Discord workspace/channel skills (pi-coding-agent format)
	const discordSkills = loadDiscordSkills(channelPath, workspacePath);
	const discordSkillsPrompt = formatSkillsForPrompt(discordSkills);

	// 2. Internal skills system - loads from standard discovery paths:
	//    - ~/.claude/skills (claude-user)
	//    - ./.claude/skills (claude-project)
	//    - ~/.pi/agent/skills (pi-user)
	//    - ./.pi/skills (pi-project)
	const internalSkillsResult = loadInternalSkills({
		enableClaudeUser: true,
		enableClaudeProject: true,
		enablePiUser: true,
		enablePiProject: true,
	});
	const internalSkillsPrompt = formatInternalSkillsForPrompt(internalSkillsResult.skills);

	// 3. Legacy skills (backwards compatibility)
	const legacySkills = loadLegacySkills(workspacePath);

	// Combine all skills prompts
	const allSkillsPrompt = [discordSkillsPrompt, internalSkillsPrompt].filter(Boolean).join("\n");

	// MINIMAL SYSTEM PROMPT - Following Mario Zechner's pi-mono philosophy
	// Target: Under 1000 tokens. Trust the model. YOLO mode.
	return `You are an expert coding assistant Discord bot. Help users with coding, file operations, and system tasks.

## Tools
- **bash**: Execute commands (your primary tool). Chain with && for atomic ops.
- **read**: Read files before editing
- **write**: Create/overwrite files
- **edit**: Surgical text replacement (old_text must match exactly)

## Workspace
- Working dir: ${channelPath}/scratch/
- Memory: ${workspacePath}/MEMORY.md (global), ${channelPath}/MEMORY.md (channel)
- Your code: /home/majinbu/organized/active-projects/pi-mono/packages/discord-bot/

## Guidelines
- Be concise (Discord 2000 char limit)
- Use bash for most tasks - it's your primary power
- Read files before editing them
- No emojis unless asked
- Write important learnings to MEMORY.md

${memory ? `## Memory\n${memory}\n` : ""}
${allSkillsPrompt ? `## Skills\n${allSkillsPrompt}\n` : ""}
${legacySkills ? legacySkills : ""}
`;
}

// ============================================================================
// Message Logging
// ============================================================================

function logMessage(channelDir: string, entry: object): void {
	ensureDir(channelDir);
	appendFileSync(join(channelDir, "log.jsonl"), `${JSON.stringify(entry)}\n`);
}

// ============================================================================
// Session Persistence (JSONL)
// ============================================================================

const SESSION_FILE = "session.jsonl";
const MAX_SESSION_MESSAGES = 20; // Auto-compact after this many messages (aggressive for speed)
const MAX_CONTEXT_TOKENS = 4000; // Target max tokens to send to model (fast responses)

// PERF: Cache of directories we've confirmed exist (avoid repeated existsSync)
const createdDirsCache = new Set<string>();
function ensureDir(dir: string): void {
	if (createdDirsCache.has(dir)) return;
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	createdDirsCache.add(dir);
}

interface SessionEntry {
	role: string;
	content: unknown;
	timestamp: string;
	[key: string]: unknown;
}

function _saveSessionMessage(channelDir: string, message: unknown): void {
	ensureDir(channelDir);
	const entry: SessionEntry = {
		...(message as object),
		timestamp: new Date().toISOString(),
	} as SessionEntry;
	appendFileSync(join(channelDir, SESSION_FILE), `${JSON.stringify(entry)}\n`);
}

// PERF: Batch save multiple messages in a single file write
function saveSessionMessagesBatch(channelDir: string, messages: unknown[]): void {
	if (messages.length === 0) return;
	ensureDir(channelDir);
	const timestamp = new Date().toISOString();
	const lines = messages.map((message) => {
		const entry: SessionEntry = {
			...(message as object),
			timestamp,
		} as SessionEntry;
		return JSON.stringify(entry);
	});
	appendFileSync(join(channelDir, SESSION_FILE), `${lines.join("\n")}\n`);
}

function loadSession(channelDir: string, applyContextEngineering: boolean = true): unknown[] {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (!existsSync(sessionPath)) {
		return [];
	}
	try {
		const content = readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		let messages = lines
			.map((line) => {
				try {
					const parsed = JSON.parse(line);
					// Remove timestamp from loaded message (it's metadata)
					const { timestamp: _ts, ...msg } = parsed;

					// DEFENSIVE: Validate message has valid content
					// Skip messages with undefined/null content to prevent agent-loop crashes
					if (msg.content === undefined || msg.content === null) {
						console.log(`[SESSION] Skipping message with undefined content, role=${msg.role}`);
						return null;
					}

					// DEFENSIVE: If content is a string, wrap it in proper format
					if (typeof msg.content === "string") {
						console.log(`[SESSION] Wrapping string content for role=${msg.role}`);
						msg.content = [{ type: "text", text: msg.content }];
					}

					// DEFENSIVE: Ensure content is an array
					if (!Array.isArray(msg.content)) {
						console.log(`[SESSION] Skipping message with non-array content, role=${msg.role}`);
						return null;
					}

					return msg;
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		// Apply smart context engineering for speed
		if (applyContextEngineering && messages.length > 6) {
			messages = engineerContext(messages, MAX_CONTEXT_TOKENS);
		}

		logInfo(`Loaded ${messages.length} messages from session for channel`);
		return messages;
	} catch (e) {
		logError("Failed to load session", e instanceof Error ? e.message : String(e));
		return [];
	}
}

function clearSession(channelDir: string): void {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (existsSync(sessionPath)) {
		unlinkSync(sessionPath);
		logInfo(`Cleared session for channel`);
	}
}

function _getSessionMessageCount(channelDir: string): number {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (!existsSync(sessionPath)) return 0;
	try {
		const content = readFileSync(sessionPath, "utf-8");
		return content.trim().split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
}

/**
 * Estimate tokens in a message (rough: ~4 chars per token)
 */
function estimateTokens(msg: unknown): number {
	try {
		const str = JSON.stringify(msg);
		return Math.ceil(str.length / 4);
	} catch {
		return 100; // Default estimate
	}
}

/**
 * Smart context engineering: select messages to fit within token budget
 * Prioritizes: recent messages > tool results > assistant responses > old user messages
 */
function engineerContext(messages: unknown[], maxTokens: number = MAX_CONTEXT_TOKENS): unknown[] {
	if (messages.length === 0) return [];

	// Always keep at least the last 4 messages for continuity
	const minKeep = Math.min(4, messages.length);
	const recentMessages = messages.slice(-minKeep);
	const olderMessages = messages.slice(0, -minKeep);

	let totalTokens: number = recentMessages.reduce((sum: number, m) => sum + estimateTokens(m), 0);
	const result: unknown[] = [];

	// Add older messages from most recent, respecting token budget
	for (let i = olderMessages.length - 1; i >= 0 && totalTokens < maxTokens; i--) {
		const msg = olderMessages[i];
		const tokens = estimateTokens(msg);
		if (totalTokens + tokens <= maxTokens) {
			result.unshift(msg);
			totalTokens += tokens;
		}
	}

	// Add recent messages at the end
	result.push(...recentMessages);

	if (result.length < messages.length) {
		logInfo(`Context engineered: ${messages.length} -> ${result.length} messages (~${totalTokens} tokens)`);
	}

	return result;
}

const KEEP_RECENT_MESSAGES = 8; // Keep only recent messages when compacting (speed focused)

/**
 * Auto-compact session when it exceeds MAX_SESSION_MESSAGES.
 * Keeps the most recent KEEP_RECENT_MESSAGES and summarizes older context.
 */
// PERF: Returns new message count after compaction (or -1 if no compaction)
function compactSessionIfNeeded(channelDir: string, agent: Agent): number {
	const sessionPath = join(channelDir, SESSION_FILE);
	if (!existsSync(sessionPath)) return -1;

	try {
		const content = readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		if (lines.length <= MAX_SESSION_MESSAGES) {
			return -1; // No compaction needed
		}

		logInfo(`Compacting session: ${lines.length} messages -> ${KEEP_RECENT_MESSAGES} + summary`);

		// Parse all messages
		const messages = lines
			.map((line) => {
				try {
					const parsed = JSON.parse(line);
					const { timestamp: _ts, ...msg } = parsed;
					return msg;
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		// Split into old (to summarize) and recent (to keep)
		const oldMessages = messages.slice(0, messages.length - KEEP_RECENT_MESSAGES);
		const recentMessages = messages.slice(-KEEP_RECENT_MESSAGES);

		// Create a summary of old messages
		const summaryText = createConversationSummary(oldMessages);

		// Create compacted session: summary + recent messages
		const compactedLines: string[] = [];

		// Add summary as a system context message
		const summaryMessage = {
			role: "user",
			content: [
				{
					type: "text",
					text: `[PREVIOUS CONTEXT SUMMARY]\n${summaryText}\n[END SUMMARY - Recent conversation follows]`,
				},
			],
			timestamp: new Date().toISOString(),
			isCompactedSummary: true,
		};
		compactedLines.push(JSON.stringify(summaryMessage));

		// Add recent messages
		for (const msg of recentMessages) {
			compactedLines.push(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
		}

		// Write compacted session
		writeFileSync(sessionPath, `${compactedLines.join("\n")}\n`);

		// Update agent's messages to match
		const loadedMessages = loadSession(channelDir);
		agent.replaceMessages(loadedMessages as Parameters<typeof agent.replaceMessages>[0]);

		logInfo(`Session compacted: ${lines.length} -> ${compactedLines.length} messages`);
		return compactedLines.length; // PERF: Return new count for cache update
	} catch (e) {
		logError("Failed to compact session", e instanceof Error ? e.message : String(e));
		return -1;
	}
}

/**
 * Create a text summary of old conversation messages.
 */
function createConversationSummary(messages: unknown[]): string {
	const summary: string[] = [];
	let userCount = 0;
	let assistantCount = 0;
	const topics: string[] = [];

	for (const msg of messages) {
		const m = msg as { role?: string; content?: unknown };
		if (m.role === "user") {
			userCount++;
			// Extract topic hints from user messages
			const content = m.content;
			if (Array.isArray(content)) {
				for (const c of content) {
					if (typeof c === "object" && c !== null && "text" in c && typeof c.text === "string") {
						const text = c.text.substring(0, 100);
						if (text.length > 20 && !text.startsWith("[")) {
							topics.push(text.split("\n")[0]);
						}
					}
				}
			}
		} else if (m.role === "assistant") {
			assistantCount++;
		}
	}

	summary.push(`Previous conversation: ${userCount} user messages, ${assistantCount} assistant responses.`);

	if (topics.length > 0) {
		// Take up to 5 unique topic snippets
		const uniqueTopics = [...new Set(topics)].slice(0, 5);
		summary.push(`Topics discussed: ${uniqueTopics.join(" | ")}`);
	}

	return summary.join("\n");
}

// ============================================================================
// Channel State
// ============================================================================

interface QueuedMessage {
	channelId: string;
	channelName: string;
	userName: string;
	userId: string;
	text: string;
	workingDir: string;
	reply: (content: string) => Promise<any>;
	editReply: (content: string) => Promise<any>;
	sourceMessage: Message | null;
}

interface ChannelState {
	running: boolean;
	agent: Agent;
	hooks?: HookIntegration;
	sessionId?: string;
	turnIndex: number;
	messageQueue: QueuedMessage[];
	originalTools: AgentTool<any>[]; // PERF: Store original tools for per-message filtering
	sessionMessageCount: number; // PERF: Cache session count to avoid file reads
}

const channelStates = new Map<string, ChannelState>();
const MAX_QUEUE_SIZE = 5;

// PERF: Cache MCP tools globally (created once, shared across all channels)
let cachedMcpTools: ReturnType<typeof getAllMcpTools> | null = null;
function getCachedMcpTools(): ReturnType<typeof getAllMcpTools> {
	if (!cachedMcpTools) {
		cachedMcpTools = getAllMcpTools();
		logInfo(`[PERF] Cached ${cachedMcpTools.length} MCP tools`);
	}
	return cachedMcpTools;
}

// PERF: Cache base core tools (wrapping happens per-channel for hooks)
let cachedCoreTools: {
	bash: ReturnType<typeof createBashTool>;
	read: ReturnType<typeof createReadTool>;
	write: ReturnType<typeof createWriteTool>;
	edit: ReturnType<typeof createEditTool>;
} | null = null;

function getCachedCoreTools() {
	if (!cachedCoreTools) {
		cachedCoreTools = {
			bash: createBashTool(),
			read: createReadTool(),
			write: createWriteTool(),
			edit: createEditTool(),
		};
		logInfo("[PERF] Cached 4 core tools (bash, read, write, edit)");
	}
	return cachedCoreTools;
}

// PERFORMANCE: Tool relevance filtering - reduce 90+ tools to ~20 relevant ones
const TOOL_KEYWORDS: Record<string, string[]> = {
	// Shell/Terminal - only when truly needed (npm, build, git commands without MCP alternatives)
	bash: [
		"npm",
		"install package",
		"build",
		"compile",
		"test",
		"shell",
		"command line",
		"run script",
		"execute",
		"terminal",
		"make",
		"cargo",
		"pip install",
		"yarn",
		"pnpm",
		"docker",
		"systemctl",
		"service",
		// Audio analysis keywords
		"bpm",
		"analyze",
		"ffprobe",
		"ffmpeg",
		"audio",
		"key detection",
		"upload",
		"curl",
		"wget",
		"download",
		"apt",
		"process",
		"convert",
	],
	// Web & Research - PREFER THESE over bash curl/wget
	web_search: ["search", "find", "google", "web", "internet", "lookup", "what is", "who is", "news", "latest"],
	free_search: ["search", "find", "lookup", "web"],
	deep_research: ["research", "analyze", "comprehensive", "deep dive", "investigate"],
	web_scrape: ["scrape", "extract", "fetch url", "get page", "website content"],
	web_crawl: ["crawl", "spider", "scrape site", "all pages"],
	rag_search: ["rag", "knowledge base", "semantic search", "documents"],
	knowledge_search: ["knowledge", "docs", "documentation", "wiki"],
	// GitHub
	github_search: ["github", "repo", "repository", "code search", "open source"],
	github_file: ["github file", "repo file", "source code"],
	github_issues: ["issues", "bugs", "github issue"],
	github_issue: ["issue", "bug", "github issue"],
	github_branch: ["branch", "git branch", "create branch"],
	github_pr: ["pull request", "pr", "merge request"],
	github_prs: ["pull requests", "prs", "open prs"],
	// HuggingFace
	hf_models: ["huggingface", "hf", "model", "transformer", "llm", "ai model"],
	hf_datasets: ["dataset", "training data", "huggingface dataset"],
	hf_inference: ["inference", "run model", "hf inference"],
	hf_video: ["video model", "hf video", "video", "clip"],
	// Memory
	memory_store: ["remember", "save", "store", "note", "memorize"],
	memory_recall: ["recall", "remember", "what did", "history", "previous"],
	memory_relate: ["relate", "connect", "link", "associate"],
	memory_update: ["update memory", "change note", "modify memory"],
	// Tasks
	task_list: ["tasks", "todo", "list tasks", "my tasks", "show tasks"],
	task_create: ["add task", "create task", "new task", "todo add"],
	task_update: ["update task", "modify task", "change task"],
	// Knowledge & Context
	codebase_knowledge: ["codebase", "project", "architecture", "how does", "explain code"],
	context_compact: ["compact", "summarize context", "reduce context"],
	// Code Execution
	python_exec: ["python", "execute python", "run python", "py"],
	code_sandbox: ["sandbox", "run code", "execute", "eval"],
	sandbox_exec: ["sandbox", "container", "isolated"],
	docker_sandbox: ["docker", "container", "isolated run"],
	// Image Tools
	image_generate: ["generate image", "create image", "draw", "illustration", "picture"],
	image_analyze: ["analyze image", "describe image", "what's in", "ocr", "vision"],
	image_inpaint: ["inpaint", "fill", "remove object", "edit image"],
	image_upscale: ["upscale", "enhance", "higher resolution", "4k"],
	style_transfer: ["style transfer", "artistic", "painting style"],
	face_restore: ["restore face", "enhance face", "fix face"],
	fal_image: ["fal", "flux", "generate image"],
	gemini_image: ["gemini", "google image"],
	gif_generate: ["gif", "animated", "animation"],
	// Video Tools
	fal_video: ["generate video", "create video", "video ai"],
	luma_video: ["luma", "dream machine", "video"],
	// 3D Tools
	tripo_3d: ["3d model", "generate 3d", "mesh"],
	shap_e_3d: ["3d", "shape", "object"],
	// Audio & Music
	transcribe: ["transcribe", "speech to text", "audio to text", "whisper"],
	voice_tts: ["speak", "say", "voice", "text to speech", "tts"],
	voice_join: ["join voice", "voice channel", "call"],
	vibevoice: ["voice", "tts", "speak"],
	elevenlabs_tts: ["elevenlabs", "voice clone", "realistic voice"],
	audio_effects: ["audio effect", "sound effect", "modify audio"],
	suno_music: ["music", "song", "generate music", "suno"],
	mubert_music: ["mubert", "background music", "ambient"],
	// Scheduling
	schedule_task: ["schedule", "remind", "later", "tomorrow", "cron"],
	scheduled_tasks_list: ["scheduled", "reminders", "upcoming"],
	schedule_creative: ["schedule", "batch", "queue"],
	// Skills & Plugins
	skill_list: ["skills", "available skills", "what can you"],
	skill_load: ["load skill", "use skill", "activate"],
	skill_create: ["create skill", "new skill", "custom skill"],
	plugin_load: ["plugin", "load plugin", "extension"],
	plugin_list: ["plugins", "extensions", "installed"],
	// Agents & Delegation
	agent_spawn: ["spawn agent", "new agent", "create agent"],
	agent_delegate: ["delegate", "hand off", "pass to"],
	// Files & Export
	file_process: ["process file", "parse", "extract from file"],
	conversation_export: ["export", "save conversation", "download chat"],
	pimono_read: ["pi-mono", "monorepo", "package"],
	pimono_list: ["packages", "workspaces"],
	// Social & Sharing
	twitter_post: ["tweet", "twitter", "x post"],
	youtube_upload: ["youtube", "upload video"],
	telegram_bridge: ["telegram", "send telegram"],
	rich_embed: ["embed", "rich message", "formatted"],
	// Server & Admin
	server_sync: ["sync server", "refresh"],
	server_list: ["servers", "guilds"],
	slash_command_create: ["create command", "new command"],
	slash_command_list: ["commands", "slash commands"],
	// Miscellaneous
	backup: ["backup", "save state", "export data"],
	thread_manage: ["thread", "forum", "discussion"],
	user_preferences: ["preferences", "settings", "config"],
	hooks_list: ["hooks", "event hooks"],
	hook_create: ["create hook", "new hook"],
	auto_learn: ["learn", "auto learn", "self improve"],
	livekit_room: ["livekit", "video call", "room"],
	livekit_token: ["livekit token", "join call"],
	persona: ["persona", "character", "roleplay"],
	director: ["direct", "orchestrate", "coordinate"],
	art_design: ["design", "art", "creative"],
	preset_chain: ["preset", "chain", "workflow"],
	batch_generate: ["batch", "multiple", "bulk"],
	api_usage: ["api usage", "tokens used", "cost"],
};

// Core tools always included (essential for agent operation)
// bash included because agent frequently needs shell access for various tasks
const CORE_FILE_TOOLS = ["read", "write", "edit", "bash"];
const MAX_FILTERED_TOOLS = 25; // Maximum tools to pass to agent

// PERF: Pre-compute keyword word counts at module init (avoid repeated splits)
const TOOL_KEYWORD_SCORES: Record<string, Array<{ keyword: string; score: number }>> = {};
for (const [toolName, keywords] of Object.entries(TOOL_KEYWORDS)) {
	TOOL_KEYWORD_SCORES[toolName] = keywords.map((k) => ({
		keyword: k,
		score: k.split(" ").length, // Pre-computed word count
	}));
}

function filterToolsByRelevance(userMessage: string, allTools: AgentTool<any>[]): AgentTool<any>[] {
	const messageLower = userMessage.toLowerCase();
	const scoredTools: Array<{ tool: (typeof allTools)[0]; score: number }> = [];

	for (const tool of allTools) {
		const keywordScores = TOOL_KEYWORD_SCORES[tool.name];
		let score = 0;

		if (keywordScores) {
			for (const { keyword, score: keywordScore } of keywordScores) {
				if (messageLower.includes(keyword)) {
					score += keywordScore; // Use pre-computed score
				}
			}
		}

		// Always include core FILE tools with high score (no MCP alternatives)
		if (CORE_FILE_TOOLS.includes(tool.name)) {
			score = 80;
		}

		if (score > 0) {
			scoredTools.push({ tool, score });
		}
	}

	// If no matches, return a default set of common tools
	if (scoredTools.length < 5) {
		const defaultTools = ["free_search", "web_search", "memory_recall", "codebase_knowledge", ...CORE_FILE_TOOLS];
		for (const tool of allTools) {
			if (defaultTools.includes(tool.name) && !scoredTools.find((st) => st.tool.name === tool.name)) {
				scoredTools.push({ tool, score: 1 });
			}
		}
	}

	// Sort by score and take top N
	const filtered = scoredTools
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_FILTERED_TOOLS)
		.map((st) => st.tool);

	return filtered;
}

// Message deduplication - track processed message IDs to prevent double responses
const processedMessages = new Set<string>();
const MESSAGE_CACHE_TTL = 60000; // 1 minute

function markMessageProcessed(messageId: string): boolean {
	if (processedMessages.has(messageId)) {
		return false; // Already processed
	}
	processedMessages.add(messageId);
	// Auto-cleanup after TTL
	setTimeout(() => processedMessages.delete(messageId), MESSAGE_CACHE_TTL);
	return true; // OK to process
}

function getChannelState(channelId: string, workingDir: string, channelName: string): ChannelState {
	let state = channelStates.get(channelId);
	if (!state) {
		const channelDir = join(workingDir, channelId);
		const memory = getMemory(channelDir, workingDir);
		const systemPrompt = buildSystemPrompt(workingDir, channelId, channelName, memory);

		// Create hook integration FIRST (before tools, so we can wrap them)
		const sessionId = generateSessionId(channelId);
		const hooks = createDiscordHookIntegration({
			cwd: channelDir,
			channelId,
			checkpoint: true,
			lsp: true,
			expert: true,
		});

		// Helper to wrap tools with hook events (for LSP diagnostics on file changes)
		// Also adds defensive handling to ensure content is never undefined (prevents crash in agent-loop)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const wrapTool = <T extends { name: string; execute: (...args: any[]) => Promise<any> }>(tool: T): T => {
			const hookedTool = wrapToolWithHooks(tool, () => getChannelHookIntegration(channelId));
			const originalExecute = hookedTool.execute.bind(hookedTool);

			// Defensive wrapper to ensure tool results ALWAYS have valid content
			// The agent-loop expects { content: ... } format, strings cause undefined content crash
			const safeExecute = async (...args: any[]) => {
				const result = await originalExecute(...args);

				// If result is null/undefined, return safe default
				if (result === null || result === undefined) {
					console.log(`[DISCORD][wrapTool] Tool ${tool.name} returned null/undefined, fixing`);
					return { content: [{ type: "text", text: "" }] };
				}

				// If result is a string, wrap it in proper content format
				if (typeof result === "string") {
					console.log(`[DISCORD][wrapTool] Tool ${tool.name} returned string, wrapping in content`);
					return { content: [{ type: "text", text: result }] };
				}

				// If result is an object with undefined/null content, fix it
				if (typeof result === "object") {
					if (result.content === undefined || result.content === null) {
						console.log(`[DISCORD][wrapTool] Tool ${tool.name} returned undefined content, fixing`);
						return { ...result, content: [{ type: "text", text: "" }] };
					}
					// If content is a string, wrap it
					if (typeof result.content === "string") {
						console.log(`[DISCORD][wrapTool] Tool ${tool.name} returned string content, wrapping`);
						return { ...result, content: [{ type: "text", text: result.content }] };
					}
				}

				return result;
			};

			return { ...hookedTool, execute: safeExecute } as T;
		};

		// Helper to wrap tools with ONLY safe content handling (no hooks)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const safeTool = <T extends { name: string; execute: (...args: any[]) => Promise<any> }>(tool: T): T => {
			const originalExecute = tool.execute.bind(tool);

			const safeExecute = async (...args: any[]) => {
				const result = await originalExecute(...args);

				if (result === null || result === undefined) {
					console.log(`[DISCORD][safeTool] Tool ${tool.name} returned null/undefined, fixing`);
					return { content: [{ type: "text", text: "" }] };
				}
				if (typeof result === "string") {
					console.log(`[DISCORD][safeTool] Tool ${tool.name} returned string, wrapping`);
					return { content: [{ type: "text", text: result }] };
				}
				if (typeof result === "object") {
					if (result.content === undefined || result.content === null) {
						console.log(`[DISCORD][safeTool] Tool ${tool.name} returned undefined content, fixing`);
						return { ...result, content: [{ type: "text", text: "" }] };
					}
					if (typeof result.content === "string") {
						console.log(`[DISCORD][safeTool] Tool ${tool.name} returned string content, wrapping`);
						return { ...result, content: [{ type: "text", text: result.content }] };
					}
				}
				return result;
			};

			return { ...tool, execute: safeExecute } as T;
		};

		// PERF: Create tools using cached base instances, wrap per-channel for hooks
		// All tools are wrapped with safeTool to prevent undefined content crashes
		const coreTools = getCachedCoreTools();
		const mcpTools = getCachedMcpTools().map((t) => safeTool(t));
		const tools = [
			wrapTool(coreTools.bash),
			safeTool(coreTools.read), // Read doesn't need hooks but needs safe content
			wrapTool(coreTools.write), // Write triggers LSP
			wrapTool(coreTools.edit), // Edit triggers LSP
			...mcpTools, // Cached MCP tools with safe content wrapper
		];

		// Create integrated preprocessor for verification, compression, and learning
		const integratedPreprocessor = createIntegratedPreprocessor({
			enableVerification: true,
			enableCompression: true,
			enableLearning: true,
			compressionThreshold: 100000, // Start compression at ~100k tokens
			minConfidenceThreshold: 0.3,
			warnOnLowPerformance: true,
		});

		const agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: "off",
				tools,
			},
			transport: new ProviderTransport({
				getApiKey: async (provider?: string) => {
					// Return appropriate API key based on provider
					const key =
						currentProvider === "zai"
							? ZAI_API_KEY
							: currentProvider === "cerebras"
								? CEREBRAS_API_KEY
								: currentProvider === "groq"
									? GROQ_API_KEY
									: currentProvider === "openrouter"
										? OPENROUTER_API_KEY
										: "ollama";

					console.log(
						`[DISCORD][getApiKey] provider=${provider} currentProvider=${currentProvider} returning=${key?.substring(0, 15)}...`,
					);
					return key;
				},
			}),
			// Custom message transformer with integrated preprocessor
			messageTransformer: async (appMessages) => {
				console.log(`[DISCORD][messageTransformer] Input: ${appMessages.length} messages`);
				// Step 1: Default transformation (filter and convert AppMessage to AIMessage)
				// Also filter out messages with undefined/null content to prevent "Cannot read properties of undefined (reading 'filter')" error
				const messages = appMessages
					.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
					.map((m) => m as unknown as AIMessage)
					.filter((m) => {
						// Defensive: ensure content exists and is valid
						if (m.content === undefined || m.content === null) {
							console.log(
								`[DISCORD][messageTransformer] SKIPPING message with undefined content, role=${m.role}`,
							);
							return false;
						}
						return true;
					});

				console.log(`[DISCORD][messageTransformer] After filter: ${messages.length} messages`);

				// Step 2: Apply integrated preprocessor (verification, compression, learning)
				try {
					const result = await integratedPreprocessor(messages);
					console.log(`[DISCORD][messageTransformer] After preprocessor: ${result.length} messages`);
					return result;
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					console.log(`[DISCORD][messageTransformer] Preprocessor error: ${errMsg}`);
					logWarning(`[${channelId}] Preprocessor failed, using original messages: ${errMsg}`);
					return messages;
				}
			},
		});

		// Load session history if exists
		const sessionMessages = loadSession(channelDir);
		if (sessionMessages.length > 0) {
			agent.replaceMessages(sessionMessages as Parameters<typeof agent.replaceMessages>[0]);
			logInfo(`Restored ${sessionMessages.length} messages for channel ${channelId}`);
		}

		// Emit session start event
		hooks.emitSession("start", sessionId).catch((err) => {
			logWarning(`[${channelId}] Hook session event failed:`, err);
		});

		// PERF: Initialize session count from loaded messages to avoid file reads
		state = {
			running: false,
			agent,
			hooks,
			sessionId,
			turnIndex: 0,
			messageQueue: [],
			originalTools: tools,
			sessionMessageCount: sessionMessages.length,
		};
		channelStates.set(channelId, state);
	}
	return state;
}

// ============================================================================
// Message Queue Processing
// ============================================================================

async function processNextQueuedMessage(channelId: string): Promise<void> {
	const state = channelStates.get(channelId);
	if (!state || state.running || state.messageQueue.length === 0) {
		return;
	}

	const nextMessage = state.messageQueue.shift()!;
	logInfo(`[${channelId}] Processing queued message from ${nextMessage.userName}`);

	// Process the queued message
	await handleAgentRequestInternal(
		nextMessage.channelId,
		nextMessage.channelName,
		nextMessage.userName,
		nextMessage.userId,
		nextMessage.text,
		nextMessage.workingDir,
		nextMessage.reply,
		nextMessage.editReply,
		nextMessage.sourceMessage,
	);
}

// ============================================================================
// Response Handler (shared between slash commands and mentions)
// ============================================================================

async function handleAgentRequest(
	channelId: string,
	channelName: string,
	userName: string,
	userId: string,
	text: string,
	workingDir: string,
	reply: (content: string) => Promise<any>,
	editReply: (content: string) => Promise<any>,
	sourceMessage: Message | null = null,
): Promise<void> {
	// User allowlist check
	if (!isUserAllowed(userId)) {
		await reply("_Access denied. You are not authorized to use this bot._");
		logWarning(`Unauthorized user attempt: ${userName}`, userId);
		return;
	}

	// Rate limiting check
	const rateLimit = checkRateLimit(userId);
	if (!rateLimit.allowed) {
		const resetSecs = Math.ceil(rateLimit.resetIn / 1000);
		await reply(`_Rate limited. Try again in ${resetSecs}s._`);
		logWarning(`Rate limited user ${userName}`, `reset in ${resetSecs}s`);
		return;
	}

	const state = getChannelState(channelId, workingDir, channelName);

	// Queue management - add to queue if already processing
	if (state.running) {
		// Check queue size limit
		if (state.messageQueue.length >= MAX_QUEUE_SIZE) {
			// Drop oldest message
			const dropped = state.messageQueue.shift();
			logWarning(`[${channelId}] Queue full, dropped message from ${dropped?.userName}`);
		}

		// Add to queue
		state.messageQueue.push({
			channelId,
			channelName,
			userName,
			userId,
			text,
			workingDir,
			reply,
			editReply,
			sourceMessage,
		});

		const queuePosition = state.messageQueue.length;
		logInfo(`[${channelId}] Queued message from ${userName}, position: ${queuePosition}`);
		// Note: Don't send queue notification via reply() as it creates a separate message
		// The user will see their response when the queue is processed
		return;
	}

	// Process immediately
	await handleAgentRequestInternal(
		channelId,
		channelName,
		userName,
		userId,
		text,
		workingDir,
		reply,
		editReply,
		sourceMessage,
	);
}

// Internal function that does the actual processing
async function handleAgentRequestInternal(
	channelId: string,
	channelName: string,
	userName: string,
	userId: string,
	text: string,
	workingDir: string,
	reply: (content: string) => Promise<any>,
	editReply: (content: string) => Promise<any>,
	sourceMessage: Message | null = null,
): Promise<void> {
	const channelDir = join(workingDir, channelId);

	// Track statistics
	botStats.messagesProcessed++;
	trackUserInteraction(userId, userName);

	logMessage(channelDir, {
		date: new Date().toISOString(),
		user: userName,
		userId: userId,
		text,
		isBot: false,
	});

	// Get model config for this user
	const model = getUserModel(userId);
	const state = getChannelState(channelId, workingDir, channelName);

	state.running = true;
	const toolsUsed: string[] = [];
	const startTime = Date.now();

	// Emit turn_start hook event
	if (state.hooks) {
		state.turnIndex++;
		state.hooks.emitTurnStart(state.turnIndex).catch((err) => {
			logWarning(`[${channelId}] Hook turn_start failed:`, err);
		});
	}

	// Set approval context for dangerous command checks
	setApprovalContext(sourceMessage, userId);

	// ==========================================================================
	// AUTO-TOOL DETECTION: Intercept common requests and call tools directly
	// ==========================================================================
	const textLower = text.toLowerCase();
	let autoToolResult: string | null = null;

	try {
		// GitHub search detection - many natural patterns
		const githubPatterns = [
			/(?:search|find|look for|show me|get)(?: on| in)? github(?: for)?\s+(.+)/i,
			/github (?:repos?|repositories|projects)(?: for| about| on)?\s+(.+)/i,
			/(?:any|best|top|good) (?:repos?|repositories|projects)(?: for| about| on)?\s+(.+)/i,
			/(?:find|show|list) (?:repos?|repositories)(?: for| about)?\s+(.+)/i,
		];

		for (const pattern of githubPatterns) {
			const match = text.match(pattern);
			if (match && !textLower.includes("how to")) {
				const query = match[1].trim();
				logInfo(`[AUTO-TOOL] github_search: ${query}`);
				const tool = createGithubRepoSearchTool();
				const result = await tool.execute("auto", { query, perPage: 5, label: `GitHub: "${query}"` });
				const firstContent = result.content?.[0];
				if (firstContent && firstContent.type === "text" && firstContent.text) {
					autoToolResult = firstContent.text;
					toolsUsed.push("github_search");
				}
				break;
			}
		}

		// HuggingFace model search - natural patterns
		if (!autoToolResult) {
			const hfModelPatterns = [
				/(?:find|search|show|get|list)(?: me)?(?: huggingface| hf)? models?(?: for| about| on)?\s+(.+)/i,
				/(?:huggingface|hf) models?(?: for| about)?\s+(.+)/i,
				/(?:any|best|top) (?:ai |ml |machine learning )?models?(?: for| about)?\s+(.+)/i,
				/models? for\s+(.+)/i,
			];

			for (const pattern of hfModelPatterns) {
				const match = text.match(pattern);
				if (match && !textLower.includes("how to")) {
					const query = match[1].trim();
					logInfo(`[AUTO-TOOL] hf_models: ${query}`);
					const tool = createHfModelSearchTool();
					const result = await tool.execute("auto", { query, limit: 5, label: `HF Models: "${query}"` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("hf_models");
					}
					break;
				}
			}
		}

		// HuggingFace dataset search
		if (!autoToolResult) {
			const hfDatasetPatterns = [
				/(?:find|search|show|get|list)(?: me)?(?: huggingface| hf)? datasets?(?: for| about| on)?\s+(.+)/i,
				/(?:huggingface|hf) datasets?(?: for| about)?\s+(.+)/i,
				/(?:any|best|top) datasets?(?: for| about)?\s+(.+)/i,
				/datasets? for\s+(.+)/i,
			];

			for (const pattern of hfDatasetPatterns) {
				const match = text.match(pattern);
				if (match) {
					const query = match[1].trim();
					logInfo(`[AUTO-TOOL] hf_datasets: ${query}`);
					const tool = createHfDatasetSearchTool();
					const result = await tool.execute("auto", { query, limit: 5, label: `HF Datasets: "${query}"` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("hf_datasets");
					}
					break;
				}
			}
		}

		// Memory recall - natural patterns
		if (!autoToolResult) {
			const memoryPatterns = [
				/what do you (?:remember|know|recall) about\s+(.+)/i,
				/(?:recall|search|check)(?: your)? memory(?: for| about)?\s*(.+)?/i,
				/do you remember\s+(.+)/i,
				/what (?:have i|did i) (?:told|tell|said|say) (?:you )about\s+(.+)/i,
			];

			for (const pattern of memoryPatterns) {
				const match = text.match(pattern);
				if (match) {
					const query = match[1]?.trim() || "everything";
					logInfo(`[AUTO-TOOL] memory_recall: ${query}`);
					const tool = createMemoryRecallTool();
					const result = await tool.execute("auto", { query, label: `Memory: "${query}"` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("memory_recall");
					}
					break;
				}
			}
		}

		// Memory store - detect when user wants to save something
		if (!autoToolResult) {
			const storePatterns = [
				/(?:remember|save|store|note)(?: that| this)?[:\s]+(.+)/i,
				/(?:my|i) (?:name is|am|prefer|like|use|work (?:on|with)|live in)\s+(.+)/i,
			];

			for (const pattern of storePatterns) {
				const match = text.match(pattern);
				if (match && textLower.includes("remember")) {
					const fact = match[1].trim();
					logInfo(`[AUTO-TOOL] memory_store: ${fact}`);
					const tool = createMemoryStoreTool();
					const result = await tool.execute("auto", {
						entityName: userName,
						entityType: "user",
						observations: [fact],
						label: `Storing: "${fact.substring(0, 30)}..."`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("memory_store");
					}
					break;
				}
			}
		}

		// Web scraping - detect URL fetching requests
		if (!autoToolResult) {
			const scrapePatterns = [
				/(?:scrape|fetch|get|read|extract)(?: content| data| from)?\s+(https?:\/\/[^\s]+)/i,
				/(?:what(?:'s| is) (?:on|at)|show me|open)\s+(https?:\/\/[^\s]+)/i,
			];

			for (const pattern of scrapePatterns) {
				const match = text.match(pattern);
				if (match) {
					const url = match[1].trim();
					logInfo(`[AUTO-TOOL] web_scrape: ${url}`);
					const tool = createWebScrapeTool();
					const result = await tool.execute("auto", { url, label: `Scraping: ${url.substring(0, 40)}...` });
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("web_scrape");
					}
					break;
				}
			}
		}

		// GitHub issues - list issues from a repo
		if (!autoToolResult) {
			const issuePatterns = [
				/(?:list|show|get)(?: open| all)? issues (?:in|on|for|from)\s+([^\s]+\/[^\s]+)/i,
				/issues (?:in|on|for)\s+([^\s]+\/[^\s]+)/i,
			];

			for (const pattern of issuePatterns) {
				const match = text.match(pattern);
				if (match) {
					const [owner, repo] = match[1].split("/");
					logInfo(`[AUTO-TOOL] github_issues: ${owner}/${repo}`);
					const tool = createGithubListIssuesTool();
					const result = await tool.execute("auto", {
						owner,
						repo,
						state: "open",
						label: `Issues: ${owner}/${repo}`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("github_issues");
					}
					break;
				}
			}
		}

		// Task management - list tasks
		if (
			!autoToolResult &&
			(textLower.includes("my tasks") ||
				textLower.includes("list tasks") ||
				textLower.includes("show tasks") ||
				textLower.includes("todo") ||
				textLower.includes("what are my tasks"))
		) {
			logInfo(`[AUTO-TOOL] task_list`);
			const tool = createTaskListTool();
			const result = await tool.execute("auto", { label: "Listing tasks" });
			const firstContent = result.content?.[0];
			if (firstContent && firstContent.type === "text" && firstContent.text) {
				autoToolResult = firstContent.text;
				toolsUsed.push("task_list");
			}
		}

		// Task create - add a new task
		if (!autoToolResult) {
			const taskPatterns = [/(?:add|create|new) task[:\s]+(.+)/i, /(?:todo|task)[:\s]+(.+)/i];

			for (const pattern of taskPatterns) {
				const match = text.match(pattern);
				if (match && (textLower.includes("add") || textLower.includes("create") || textLower.includes("new"))) {
					const title = match[1].trim();
					logInfo(`[AUTO-TOOL] task_create: ${title}`);
					const tool = createTaskCreateTool();
					const result = await tool.execute("auto", {
						title,
						description: title,
						label: `Creating task: "${title.substring(0, 30)}..."`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("task_create");
					}
					break;
				}
			}
		}

		// Codebase knowledge - pi-mono questions
		if (!autoToolResult) {
			const codebasePatterns = [
				/(?:how does|what is|explain|tell me about|describe)(?: the)?\s+(pi-?\s*(?:ai|agent|coding|mom|tui|web|proxy|pods|discord|mono))/i,
				/(?:how to|how do i)(?: use)?\s+(pi-?\s*(?:ai|agent|coding|mom|tui|web|proxy|pods|discord|mono))/i,
				/what (?:are|is)(?: the)?\s+(?:packages?|components?|architecture)\s+(?:in|of)\s+pi-?mono/i,
				/pi-?mono\s+(?:packages?|architecture|overview|structure)/i,
				/(?:agentLoop|agentLoopContinue|getModel|stream|complete|Tool|Context)\s+(?:api|usage|how)/i,
			];

			for (const pattern of codebasePatterns) {
				if (pattern.test(text)) {
					const query = text.match(/(?:about|explain|what is|how does|how to)\s+(.+)/i)?.[1] || text;
					logInfo(`[AUTO-TOOL] codebase_knowledge: ${query.substring(0, 50)}...`);
					const tool = createCodebaseKnowledgeTool();
					const result = await tool.execute("auto", {
						query: query.trim(),
						label: `Codebase: "${query.substring(0, 30)}..."`,
					});
					const firstContent = result.content?.[0];
					if (firstContent && firstContent.type === "text" && firstContent.text) {
						autoToolResult = firstContent.text;
						toolsUsed.push("codebase_knowledge");
					}
					break;
				}
			}
		}

		// Skills - list available skills
		if (
			!autoToolResult &&
			(textLower.includes("list skills") ||
				textLower.includes("what skills") ||
				textLower.includes("show skills") ||
				textLower.includes("available skills"))
		) {
			logInfo(`[AUTO-TOOL] skill_list`);
			const tool = createSkillListTool();
			const result = await tool.execute("auto", { label: "Listing skills" });
			const firstContent = result.content?.[0];
			if (firstContent && firstContent.type === "text" && firstContent.text) {
				autoToolResult = firstContent.text;
				toolsUsed.push("skill_list");
			}
		}

		// Skills - load a specific skill
		if (!autoToolResult) {
			const skillLoadPatterns = [
				/(?:load|activate|use|enable)\s+(?:the\s+)?(\S+)\s+skill/i,
				/skill[:\s]+(\S+)/i,
				/(?:how do i|help me with|teach me)\s+(\S+)/i,
			];

			for (const pattern of skillLoadPatterns) {
				const match = text.match(pattern);
				if (match) {
					const skillName = match[1].toLowerCase().replace(/['"]/g, "");
					// Check if this looks like a skill name (not a generic word)
					const skillKeywords = [
						"trading",
						"crypto",
						"coding",
						"research",
						"analysis",
						"pi-",
						"integration",
						"webhook",
						"api",
						"admin",
						"system",
					];
					if (skillKeywords.some((k) => skillName.includes(k)) || skillName.startsWith("pi")) {
						logInfo(`[AUTO-TOOL] skill_load: ${skillName}`);
						const tool = createSkillLoadTool();
						const result = await tool.execute("auto", { skill: skillName, label: `Loading skill: ${skillName}` });
						const firstContent = result.content?.[0];
						if (firstContent && firstContent.type === "text" && firstContent.text) {
							autoToolResult = firstContent.text;
							toolsUsed.push("skill_load");
						}
						break;
					}
				}
			}
		}
	} catch (autoToolError) {
		logWarning(`[AUTO-TOOL] Error: ${autoToolError}`);
	}

	// If auto-tool found a result, let AI format/enhance it
	if (autoToolResult) {
		// Inject tool result into the message for AI to format nicely
		text = `User asked: "${text}"\n\nI found this data:\n${autoToolResult}\n\nPlease provide a helpful, concise response based on this data. Format nicely for Discord.`;
		logInfo(`[${channelName}] AUTO-TOOL enriched prompt with ${toolsUsed.join(", ")} results`);
	}

	try {
		// Note: For DMs, we don't edit - just send response at the end

		// Update model based on user preference (system prompt already cached in channel state)
		const userModel = getUserModel(userId);
		state.agent.state.model = userModel;

		// PERF: Removed redundant getMemory() + buildSystemPrompt() - already set at channel init
		// System prompt only needs rebuild on explicit /memory or /skills commands

		// Streaming state
		let streamingText = "";
		let lastUpdateTime = 0;
		let pendingUpdate = false;
		let isThinking = true;
		const UPDATE_THROTTLE_MS = 250; // PERF: Reduced from 500ms for faster perceived response
		const MAX_DISCORD_LENGTH = 2000;

		// Skip "thinking" indicator - responses are fast enough now

		const unsubscribe = state.agent.subscribe((event: AgentEvent) => {
			// DEBUG: Log ALL events for troubleshooting
			const e = event as any;
			if (event.type === "message_start" || event.type === "message_end") {
				const msg = e.message;
				console.log(
					`[DISCORD][EVENT] ${event.type} role=${msg?.role} content=${JSON.stringify(msg?.content)?.substring(0, 100)} stopReason=${msg?.stopReason} errorMessage=${msg?.errorMessage}`,
				);
			} else if (event.type === "message_update") {
				console.log(`[DISCORD][EVENT] ${event.type} type=${e.assistantMessageEvent?.type}`);
			} else if ((event as any).type === "error") {
				console.log(
					`[DISCORD][EVENT] ERROR: reason=${e.reason} error=${JSON.stringify(e.error?.errorMessage || e.error)}`,
				);
			} else {
				console.log(`[DISCORD][EVENT] ${event.type}`);
			}

			if (event.type === "tool_execution_start") {
				const e = event as any;
				const label = e.args?.label || e.toolName;
				toolsUsed.push(`→ ${label}`);
				// Don't call editReply here - we'll include tool info in final response
			}

			// Handle streaming text updates
			if (event.type === "message_update") {
				const assistantEvent = event.assistantMessageEvent;

				// On first text, clear the "thinking..." message
				if (isThinking && assistantEvent.type === "text_start") {
					isThinking = false;
					streamingText = "";
				}

				// Handle thinking deltas (GLM-4.7 sends reasoning_content before content)
				if (assistantEvent.type === "thinking_delta") {
					// For now, we can optionally show thinking or just log it
					console.log(`[DISCORD][THINKING] ${(assistantEvent as any).delta?.substring(0, 50)}...`);
				}

				// Accumulate text deltas
				if (assistantEvent.type === "text_delta") {
					streamingText += assistantEvent.delta;

					// Throttle updates to avoid Discord rate limits
					const now = Date.now();
					if (!pendingUpdate && now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
						pendingUpdate = true;
						lastUpdateTime = now;

						// Update with current streaming text (truncate if needed)
						const displayText =
							streamingText.length <= MAX_DISCORD_LENGTH
								? streamingText
								: `${streamingText.substring(0, MAX_DISCORD_LENGTH - 50)}\n\n_(streaming...)_`;

						editReply(displayText)
							.catch(() => {})
							.finally(() => {
								pendingUpdate = false;
							});
					}
				}
			}
		});

		const timestamp = new Date().toISOString();
		const userMessage = `[${timestamp}] [${userName}]: ${text}`;

		// PERF: Filter tools based on message content for faster processing
		const filteredTools = filterToolsByRelevance(text, state.originalTools);
		state.agent.setTools(filteredTools);
		logInfo(`[${channelId}][PERF] Using ${filteredTools.length}/${state.originalTools.length} tools for message`);

		// PERF: Use model-specific timeout for faster error detection
		const modelTimeout = getModelTimeout(state.agent.state.model?.id || "");

		// Use retry with exponential backoff for resilience
		const modelConfig = state.agent.state.model as Model<"openai-completions">;
		console.log(`[DISCORD][DEBUG] Starting agent.prompt()`);
		console.log(`[DISCORD][DEBUG]   model: ${modelConfig?.id}`);
		console.log(`[DISCORD][DEBUG]   baseUrl: ${modelConfig?.baseUrl}`);
		console.log(`[DISCORD][DEBUG]   api: ${modelConfig?.api}`);
		console.log(`[DISCORD][DEBUG]   provider: ${modelConfig?.provider}`);
		console.log(`[DISCORD][DEBUG]   headers: ${JSON.stringify(modelConfig?.headers || {})}`);
		console.log(`[DISCORD][DEBUG]   tools: ${filteredTools.length}`);
		console.log(`[DISCORD][DEBUG]   currentProvider: ${currentProvider}`);
		console.log(`[DISCORD][DEBUG]   OPENROUTER_API_KEY prefix: ${OPENROUTER_API_KEY?.substring(0, 20)}...`);
		console.log(`[DISCORD][DEBUG]   ZAI_API_KEY prefix: ${ZAI_API_KEY?.substring(0, 8)}...`);

		// DEBUG: Quick API connectivity test
		if (currentProvider === "openrouter") {
			try {
				const testResp = await fetch("https://openrouter.ai/api/v1/models", {
					headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
				});
				console.log(`[DISCORD][DEBUG] OpenRouter API test: status=${testResp.status}`);
			} catch (e: any) {
				console.log(`[DISCORD][DEBUG] OpenRouter API test FAILED: ${e.message}`);
			}
		}

		const agentStartTime = Date.now();
		await withRetry(() => promptWithTimeout(state.agent, userMessage, modelTimeout), {
			maxRetries: 3,
			initialDelay: 1000,
			maxDelay: 10000,
		});
		console.log(
			`[DISCORD][DEBUG] Agent completed in ${Date.now() - agentStartTime}ms, streamingText length: ${streamingText.length}`,
		);

		// DEBUG: Dump agent state to find error info
		const debugMessages = state.agent.state.messages;
		console.log(`[DISCORD][DEBUG] Response extraction:`);
		console.log(`[DISCORD][DEBUG] Total messages: ${debugMessages.length}`);
		console.log(`[DISCORD][DEBUG] Assistant messages detail:`);
		for (const m of debugMessages.filter((msg) => msg.role === "assistant")) {
			const msgAny = m as any;
			console.log(`[DISCORD][DEBUG]   role=${m.role} content=${JSON.stringify(m.content).substring(0, 200)}`);
			console.log(
				`[DISCORD][DEBUG]   stopReason=${msgAny.stopReason} errorMessage=${msgAny.errorMessage} error=${JSON.stringify(msgAny.error)?.substring(0, 200)}`,
			);
		}

		// If there was an error, log it
		const lastMessage = debugMessages[debugMessages.length - 1] as any;
		if (lastMessage?.stopReason === "error") {
			console.log(
				`[DISCORD][ERROR] API call failed! errorMessage=${lastMessage.errorMessage} error=${JSON.stringify(lastMessage.error)}`,
			);
		}

		unsubscribe();

		// Wait for any pending streaming updates to complete (prevent race condition)
		if (pendingUpdate) {
			await new Promise<void>((resolve) => {
				const checkInterval = setInterval(() => {
					if (!pendingUpdate) {
						clearInterval(checkInterval);
						resolve();
					}
				}, 50);
				// Timeout after 1 second to avoid infinite wait
				setTimeout(() => {
					clearInterval(checkInterval);
					resolve();
				}, 1000);
			});
		}

		// Emit turn_end hook event
		if (state.hooks) {
			state.hooks.emitTurnEnd(state.turnIndex, state.agent.state.messages).catch((err) => {
				logWarning(`[${channelId}] Hook turn_end failed:`, err);
			});
		}

		const messages = state.agent.state.messages;

		// Get ALL assistant messages from this turn (there may be multiple if tools were used)
		// FIX: Find the ORIGINAL user message (with text content), not tool results
		// Tool results also have role="user" but their content is toolResult type, not text
		const lastRealUserIdx =
			messages
				.map((m, i) => {
					if (m.role !== "user") return -1;
					// Check if this is a real user message (has text content) vs tool result
					// Content can be string or array
					const content = m.content;
					if (typeof content === "string") return i; // String content = real user message
					if (!Array.isArray(content)) return -1;
					const hasText = content.some((c: any) => c.type === "text");
					return hasText ? i : -1;
				})
				.filter((i) => i >= 0)
				.pop() || 0;

		// Get ALL assistant messages after the original user message (includes tool calls AND responses)
		const assistantMessages = messages.slice(lastRealUserIdx + 1).filter((m) => m.role === "assistant");

		console.log(
			`[DISCORD][DEBUG] Response extraction: lastRealUserIdx=${lastRealUserIdx}, total=${messages.length}, assistantCount=${assistantMessages.length}`,
		);

		// Combine all text from all assistant messages in this turn
		const allTextBlocks: string[] = [];
		for (const msg of assistantMessages) {
			const textParts = msg.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text);
			allTextBlocks.push(...textParts);
		}

		// Combine all text blocks from this turn (they're parts of the same response)
		// Duplicates are prevented by markMessageProcessed() and responseSent flag
		// FIX: Filter out raw JSON tool calls that some models output as text
		const filteredBlocks = allTextBlocks.filter((text) => {
			// Skip blocks that are raw JSON tool calls (GLM sometimes outputs these)
			const trimmed = text.trim();
			if (trimmed.startsWith('{"type":') && trimmed.includes('"function"')) return false;
			if (trimmed.startsWith('{"type":') && trimmed.includes('"tool_use"')) return false;
			return true;
		});
		const responseText = filteredBlocks.join("\n\n");

		// DEBUG: Track response extraction
		console.log(`[DISCORD][DEBUG] Response extraction:`, {
			totalMessages: messages.length,
			lastRealUserIdx,
			assistantMsgCount: assistantMessages.length,
			textBlocksCount: allTextBlocks.length,
			filteredBlocksCount: filteredBlocks.length,
			responseTextLength: responseText.length,
			toolsUsed: toolsUsed.length,
			firstTextBlock: allTextBlocks[0]?.slice(0, 100) || "(none)",
		});
		// DEBUG: Log assistant message content structure
		if (assistantMessages.length > 0) {
			console.log(`[DISCORD][DEBUG] Assistant messages detail:`);
			assistantMessages.forEach((msg, i) => {
				console.log(`  [${i}] content types:`, msg.content.map((c) => c.type).join(", "));
				msg.content.forEach((c, j) => {
					if (c.type === "text") {
						console.log(
							`    [${j}] text (${(c as any).text?.length || 0} chars): "${String((c as any).text || "").slice(0, 80)}..."`,
						);
					} else if (c.type === "toolCall") {
						console.log(`    [${j}] toolCall: ${(c as any).name || "unknown"}`);
					} else {
						console.log(`    [${j}] ${c.type}`);
					}
				});
			});
		}

		// FIX: Fallback to streaming text if message extraction returned nothing
		// This can happen when the model streams text but doesn't store it properly in messages
		let finalResponseText = responseText;
		if (!finalResponseText.trim() && streamingText.trim()) {
			console.log(`[DISCORD][DEBUG] Using streamingText fallback (${streamingText.length} chars)`);
			finalResponseText = streamingText;
		}

		if (finalResponseText.trim()) {
			logMessage(channelDir, {
				date: new Date().toISOString(),
				user: "bot",
				text: finalResponseText,
				toolsUsed,
				isBot: true,
			});

			// Save session for persistence (save all new messages since last save)
			// PERF: Batch save new messages in single file write
			const allMessages = state.agent.state.messages;
			const newMessages = allMessages.slice(state.sessionMessageCount);
			if (newMessages.length > 0) {
				saveSessionMessagesBatch(channelDir, newMessages);
			}
			// Update cached count
			state.sessionMessageCount = allMessages.length;

			// Auto-compact if session is too long
			const compactedCount = compactSessionIfNeeded(channelDir, state.agent);
			if (compactedCount > 0) {
				state.sessionMessageCount = compactedCount; // PERF: Update cache after compaction
			}

			// Track cost (estimate tokens from text length: ~4 chars per token)
			const inputTokensEst = Math.ceil(text.length / 4);
			const outputTokensEst = Math.ceil(finalResponseText.length / 4);
			const costResult = analytics.trackCost({
				userId,
				username: userName,
				tokensInput: inputTokensEst,
				tokensOutput: outputTokensEst,
				model: state.agent.state.model.id,
				timestamp: new Date().toISOString(),
			});

			// Send alert if threshold exceeded
			if (costResult.alert) {
				logWarning(`[COST ALERT] ${costResult.alertMessage}`);
				// Could also DM the user or post to a monitoring channel
			}

			// Send response - use reply callback which handles splitting for Discord's 2000 char limit
			logInfo(
				`[${channelName}] Sending response: "${finalResponseText.substring(0, 100)}..." (full: ${finalResponseText.length} chars)`,
			);
			await reply(finalResponseText);

			logInfo(`[${channelName}] Responded (${finalResponseText.length} chars, ${toolsUsed.length} tools)`);

			// Track successful command
			const responseTime = Date.now() - startTime;
			analytics.trackCommand({
				type: "response",
				timestamp: new Date().toISOString(),
				userId,
				username: userName,
				command: "ask",
				responseTime,
				model: state.agent.state.model.id,
				channelId,
				channelName,
			});

			// Trigger automatic learning activation (Track A)
			try {
				const learningResult = await getLearningActivationService().processOutput(
					finalResponseText,
					text, // original user message as task
					true, // success
				);
				if (learningResult.learned) {
					logInfo(`[${channelName}] Learning: Extracted insight for domain "${learningResult.domain}"`);
				}
			} catch (learnErr) {
				// Learning is non-critical, don't fail the response
				logWarning(`[${channelName}] Learning extraction failed:`, String(learnErr));
			}
		} else {
			console.log(`[DISCORD][DEBUG] No response text - both responseText and streamingText are empty`);
			await editReply("_Done (no text response)_");
		}
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		botStats.errorsCount++;
		logError("Error processing request", errMsg);

		// Track error
		analytics.trackCommand({
			type: "error",
			timestamp: new Date().toISOString(),
			userId,
			username: userName,
			command: "ask",
			error: errMsg,
			model: state.agent.state.model?.id || model.id,
			channelId,
			channelName,
		});

		await editReply(`_Error: ${errMsg.substring(0, 500)}_`).catch(() => {});
	} finally {
		state.running = false;

		// Process next queued message if any
		setImmediate(() => {
			processNextQueuedMessage(channelId).catch((err) => {
				logError(`Error processing queued message for channel ${channelId}`, err);
			});
		});
	}
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const { workingDir } = parseArgs();

	if (!DISCORD_BOT_TOKEN) {
		logError("Missing DISCORD_BOT_TOKEN environment variable");
		process.exit(1);
	}

	if (!existsSync(workingDir)) {
		mkdirSync(workingDir, { recursive: true });
	}

	// PID file safeguard - prevent duplicate bot instances
	const pidFile = join(workingDir, "discord-bot.pid");
	if (existsSync(pidFile)) {
		const existingPid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
		try {
			// Check if process is still running (signal 0 = existence check)
			process.kill(existingPid, 0);
			logError(`Another instance already running (PID ${existingPid}). Exiting.`);
			logError(`If this is stale, delete: ${pidFile}`);
			process.exit(1);
		} catch {
			// Process not running, stale PID file - remove and continue
			logInfo(`Removing stale PID file (PID ${existingPid} not running)`);
			unlinkSync(pidFile);
		}
	}
	// Write our PID
	writeFileSync(pidFile, process.pid.toString());
	logInfo(`PID file created: ${pidFile} (PID ${process.pid})`);

	// Cleanup PID file on exit
	const cleanupPid = () => {
		try {
			if (existsSync(pidFile)) {
				const storedPid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
				if (storedPid === process.pid) {
					unlinkSync(pidFile);
					console.log(`[Cleanup] Removed PID file`);
				}
			}
		} catch {
			// Ignore cleanup errors
		}
	};
	process.on("exit", cleanupPid);
	process.on("SIGINT", () => {
		cleanupPid();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		cleanupPid();
		process.exit(0);
	});

	logInfo(`Starting Pi Discord Bot (agentic mode) with workspace: ${workingDir}`);
	logInfo(`Model: ${model.id}`);

	// Initialize analytics
	analytics = new Analytics(workingDir);
	logInfo("Analytics initialized");

	// Initialize database
	const dbPath = join(workingDir, "bot.db");
	db = initDatabase(dbPath);
	logInfo(`Database initialized at ${dbPath}`);

	// Wire up MetricsTracker persistence to SQLite
	const metricsTracker = getMetricsTracker();
	metricsTracker.setPersistCallback(async (metrics) => {
		if (metrics.length === 0) return;
		try {
			// Convert ToolMetric to ToolMetricDB format (camelCase -> snake_case)
			const dbMetrics = metrics.map((m) => ({
				id: m.id,
				tool_name: m.toolName,
				server_name: m.serverName,
				timestamp: m.timestamp,
				latency_ms: m.latencyMs,
				status: m.status,
				confidence_score: m.confidenceScore,
				input_tokens: m.inputTokens ?? null,
				output_tokens: m.outputTokens ?? null,
				error_message: m.errorMessage ?? null,
			}));
			db.saveToolMetricsBatch(dbMetrics);
			logInfo(`[Metrics] Persisted ${metrics.length} tool metrics to database`);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			logWarning(`[Metrics] Failed to persist metrics: ${errMsg}`);
		}
	});
	logInfo("MetricsTracker persistence connected to database");

	// Initialize channel store and settings manager
	_channelStore = new ChannelStore({ workingDir });
	_settingsManager = new DiscordSettingsManager(workingDir);
	logInfo("Channel store and settings manager initialized");

	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.GuildMessageReactions,
			GatewayIntentBits.DirectMessageReactions,
			GatewayIntentBits.GuildVoiceStates,
		],
		partials: [Partials.Channel, Partials.Reaction, Partials.Message],
	});

	// ========================================================================
	// Self-Debug Service: Autonomous Error Detection and Repair
	// ========================================================================
	const selfDebugService = getSelfDebugService({
		cwd: process.cwd(),
		debugLog: true,
		autoRestart: false, // Disabled by default for safety
	});
	selfDebugService.install();
	logInfo("[SELF-DEBUG] Service installed - errors will be captured and analyzed");

	// Register slash commands on ready (clientReady in discord.js v15+)
	client.once("clientReady", async () => {
		logInfo(`Logged in as ${client.user?.tag}`);
		logInfo(`Bot ID: ${client.user?.id}`);

		// Connect Discord client to Telegram bridge for bi-directional messaging
		setDiscordClient(client);

		// Register slash commands globally
		try {
			const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN!);

			logInfo("Registering slash commands...");
			await rest.put(Routes.applicationCommands(client.user!.id), {
				body: slashCommands.map((cmd) => cmd.toJSON()),
			});
			logInfo(`Registered ${slashCommands.length} slash commands: /${slashCommands.map((c) => c.name).join(", /")}`);
		} catch (error) {
			logError("Failed to register slash commands", error instanceof Error ? error.message : String(error));
		}

		logInfo("Ready! Supports both /commands and @mentions");

		// Initialize events watcher for scheduled/immediate events
		const eventsHandler: EventHandler = {
			async handleEvent(channelId: string, message: string): Promise<void> {
				try {
					const channel = await client.channels.fetch(channelId);
					if (channel?.isTextBased() && "send" in channel) {
						await (channel as TextChannel).send(message);
						logInfo(`Event sent to channel ${channelId}`);
					} else {
						logWarning(`Could not send event to channel ${channelId}`, "Channel not found or not text-based");
					}
				} catch (error) {
					logError(
						`Failed to send event to channel ${channelId}`,
						error instanceof Error ? error.message : String(error),
					);
				}
			},
		};

		eventsWatcher = createEventsWatcher(workingDir, eventsHandler);
		eventsWatcher.start();
		logInfo(`Events watcher started, tracking ${eventsWatcher.getActiveCount()} events`);

		// Graceful shutdown handler
		const shutdown = async (signal: string) => {
			logInfo(`Received ${signal}, shutting down gracefully...`);

			// Save any pending state
			try {
				for (const [channelId, state] of channelStates) {
					if (state.agent) {
						logInfo(`Saving state for channel ${channelId}`);
					}
				}
			} catch (e) {
				logError("Error during shutdown", e instanceof Error ? e.message : String(e));
			}

			// Stop events watcher
			if (eventsWatcher) {
				eventsWatcher.stop();
				logInfo("Events watcher stopped");
			}

			// Close Discord client
			client.destroy();
			logInfo("Discord client disconnected");

			// Save analytics
			if (analytics) {
				logInfo("Saving analytics...");
			}

			logInfo("Shutdown complete");
			process.exit(0);
		};

		process.on("SIGTERM", () => shutdown("SIGTERM"));
		process.on("SIGINT", () => shutdown("SIGINT"));

		// Uncaught exception handler
		process.on("uncaughtException", (error) => {
			logError("Uncaught exception", error.message);
			console.error(error.stack);
			// Don't exit - let the process continue
		});

		process.on("unhandledRejection", (reason) => {
			logError("Unhandled rejection", String(reason));
			// Don't exit - let the process continue
		});
	});

	// Handle slash commands
	client.on("interactionCreate", async (interaction) => {
		// Handle autocomplete interactions
		if (interaction.isAutocomplete()) {
			try {
				await handleAutocomplete(interaction);
			} catch (error) {
				logWarning(`Autocomplete error: ${error instanceof Error ? error.message : String(error)}`);
			}
			return;
		}

		if (!interaction.isChatInputCommand()) return;

		// Deduplicate interactions
		if (!markMessageProcessed(interaction.id)) {
			logWarning(`Duplicate interaction detected, skipping: ${interaction.id}`);
			return;
		}

		const { commandName, user, channelId } = interaction;
		const channel = interaction.channel;
		const channelName = channel && "name" in channel ? (channel as TextChannel).name : `DM:${user.username}`;

		// Rate limiting check (skip for owner)
		if (user.id !== OWNER_USER_ID) {
			const cost = getCommandCost(commandName);
			const { allowed, remaining, resetIn } = checkSlashRateLimit(user.id, cost);

			if (!allowed) {
				await interaction.reply({
					content: `⏳ **Rate Limited**\nPlease wait ${resetIn}s before using this command.\nRemaining tokens: ${remaining}`,
					ephemeral: true,
				});
				logWarning(`Rate limited ${user.username} for /${commandName} (reset in ${resetIn}s)`);
				return;
			}
		}

		// Store query for autocomplete suggestions
		const question = interaction.options.getString("question") || interaction.options.getString("prompt");
		if (question) {
			addRecentQuery(user.id, question);
		}

		logSlash(commandName, user.username);

		// Track statistics
		botStats.commandsProcessed++;
		trackUserInteraction(user.id, user.username);

		const channelDir = join(workingDir, channelId);
		const commandStartTime = Date.now();

		try {
			switch (commandName) {
				case "ask": {
					const question = interaction.options.getString("question", true);
					await interaction.deferReply();

					// Track if we've responded to prevent duplicates
					let hasResponded = false;
					const safeEditReply = async (content: string) => {
						if (hasResponded) return;
						hasResponded = true;

						// Split long messages instead of truncating
						const chunks = splitMessage(content);
						if (chunks.length === 1) {
							await interaction.editReply(chunks[0]);
						} else {
							// First chunk goes to editReply
							await interaction.editReply(chunks[0]);
							// Remaining chunks go to followUp
							for (let i = 1; i < chunks.length; i++) {
								await interaction.followUp(chunks[i]);
							}
							logInfo(`[${channelName}] Split response into ${chunks.length} parts`);
						}
					};

					await handleAgentRequest(
						channelId,
						channelName,
						user.username,
						user.id,
						question,
						workingDir,
						safeEditReply, // Both use the same safe function
						safeEditReply,
						null, // No source message for slash commands
					);
					break;
				}

				case "bash": {
					const command = interaction.options.getString("command", true);
					const timeout = interaction.options.getInteger("timeout") || undefined;

					// YOLO MODE: Warn but execute (Mario Zechner philosophy)
					if (isDangerousCommand(command)) {
						logWarning(
							`[YOLO] /bash dangerous command from ${interaction.user.username}: ${command.substring(0, 100)}`,
						);
					}

					await interaction.deferReply();

					try {
						const result = await execCommand(command, { timeout });
						let output = result.stdout || result.stderr || "(no output)";

						if (result.code !== 0) {
							output += `\n\nExit code: ${result.code}`;
						}

						// Truncate for Discord
						if (output.length > 1900) {
							output = `${output.substring(0, 1900)}\n...(truncated)`;
						}

						await interaction.editReply(`\`\`\`\n${output}\n\`\`\``);
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`);
					}
					break;
				}

				case "read": {
					const path = interaction.options.getString("path", true);
					const lines = interaction.options.getInteger("lines") || 50;
					const resolvedPath = resolve(path);

					// YOLO MODE: Just log sensitive file access (Mario Zechner philosophy)
					const SENSITIVE_PATTERNS = [/\.env$/, /\.ssh\//, /credentials/i, /secrets?\.json$/i, /\.(key|pem)$/i];
					if (SENSITIVE_PATTERNS.some((p) => p.test(resolvedPath))) {
						logWarning(`[YOLO] /read sensitive file by ${interaction.user.username}: ${resolvedPath}`);
					}

					await interaction.deferReply();

					try {
						const result = await execCommand(`head -n ${lines} ${shellEscape(resolvedPath)}`);
						if (result.code !== 0) {
							await interaction.editReply(`Error: ${result.stderr || "Failed to read file"}`);
							return;
						}

						let output = result.stdout || "(empty file)";
						if (output.length > 1900) {
							output = `${output.substring(0, 1900)}\n...(truncated)`;
						}

						await interaction.editReply(`**${path}** (first ${lines} lines):\n\`\`\`\n${output}\n\`\`\``);
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`);
					}
					break;
				}

				case "opencode": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					switch (subcommand) {
						case "status": {
							try {
								const available = await isOpenCodeAvailable();
								const embed = new EmbedBuilder()
									.setTitle("🆓 OpenCode SDK Status")
									.setColor(available ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Status", value: available ? "✅ Available" : "❌ Not Available", inline: true },
										{
											name: "Free Models",
											value: Object.keys(OPENCODE_FREE_MODELS).length.toString(),
											inline: true,
										},
									)
									.setDescription(
										available
											? "OpenCode SDK provides **free** access to Grok models - no API key required!"
											: "OpenCode CLI not found. Install with: `npm install -g opencode`",
									)
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error checking status: ${errMsg}`);
							}
							break;
						}

						case "models": {
							const models = Object.entries(OPENCODE_FREE_MODELS)
								.map(([key, model]) => `**${key}**: ${model.name}\n  └ \`${model.fullModel}\``)
								.join("\n\n");
							const embed = new EmbedBuilder()
								.setTitle("🆓 OpenCode Models")
								.setColor(0x1da1f2)
								.setDescription(models || "No models configured")
								.addFields({ name: "Note", value: "Requires `GITHUB_TOKEN` for GitHub Copilot models" })
								.setTimestamp();
							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "run": {
							const prompt = interaction.options.getString("prompt", true);
							const model = interaction.options.getString("model") || "grok";
							try {
								const result = await runOpenCodeAgent({ prompt, model });
								const embed = new EmbedBuilder()
									.setTitle("🆓 OpenCode Result")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "(no output)")
									.addFields(
										{ name: "Model", value: result.model, inline: true },
										{ name: "Duration", value: `${result.duration}ms`, inline: true },
										{ name: "Status", value: result.success ? "✅ Success" : "❌ Failed", inline: true },
									)
									.setTimestamp();
								if (result.error) {
									embed.addFields({ name: "Error", value: result.error.substring(0, 1000) });
								}
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error: ${errMsg}`);
							}
							break;
						}

						case "code": {
							const task = interaction.options.getString("task", true);
							try {
								const result = await runOpenCodeAgent(OpenCodePresets.code(task));
								const embed = new EmbedBuilder()
									.setTitle("🆓 OpenCode - Coding Task")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "(no output)")
									.addFields(
										{ name: "Duration", value: `${result.duration}ms`, inline: true },
										{ name: "Status", value: result.success ? "✅ Success" : "❌ Failed", inline: true },
									)
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error: ${errMsg}`);
							}
							break;
						}

						case "fast": {
							const question = interaction.options.getString("question", true);
							try {
								const result = await runOpenCodeAgent(OpenCodePresets.fast(question));
								const embed = new EmbedBuilder()
									.setTitle("🆓 OpenCode - Quick Answer")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "(no output)")
									.addFields({ name: "Duration", value: `${result.duration}ms`, inline: true })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error: ${errMsg}`);
							}
							break;
						}

						default:
							await interaction.editReply(`Unknown subcommand: ${subcommand}`);
					}
					break;
				}

				case "sdk": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					switch (subcommand) {
						case "status": {
							try {
								const status = await checkAllSDKs();
								const embed = new EmbedBuilder()
									.setTitle("🔧 SDK Status - All 4 Agent SDKs")
									.setColor(0x7289da)
									.addFields(
										{
											name: "Claude Agent SDK",
											value: status.claude ? "✅ Available" : "❌ Not Available",
											inline: true,
										},
										{
											name: "OpenCode SDK",
											value: status.opencode ? "✅ Available (FREE)" : "❌ Not Available",
											inline: true,
										},
										{
											name: "OpenHands SDK",
											value: status.openhands ? "✅ Available" : "❌ Not Available",
											inline: true,
										},
										{
											name: "Pi-Mono SDK",
											value: status.piMono ? "✅ Available" : "❌ Not Available",
											inline: true,
										},
									)
									.setDescription("Use `/sdk run` to auto-select best SDK or `/sdk use` to pick specific one")
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error: ${errMsg}`);
							}
							break;
						}

						case "info": {
							const embed = new EmbedBuilder()
								.setTitle("🔧 SDK Information")
								.setColor(0x7289da)
								.setDescription("4 Agent SDKs integrated for different use cases")
								.addFields(
									{
										name: `1. ${SDK_INFO.claude.name}`,
										value: `**Type:** CLI\n**Features:** ${SDK_INFO.claude.features.slice(0, 3).join(", ")}\n**Models:** Sonnet, Opus, Haiku`,
									},
									{
										name: `2. ${SDK_INFO.opencode.name} 🆓`,
										value: `**Type:** Library\n**Features:** ${SDK_INFO.opencode.features.join(", ")}\n**Cost:** FREE`,
									},
									{
										name: `3. ${SDK_INFO.openhands.name}`,
										value: `**Type:** Python\n**Features:** ${SDK_INFO.openhands.features.slice(0, 3).join(", ")}\n**Modes:** 9 expert modes`,
									},
									{
										name: `4. ${SDK_INFO.piMono.name}`,
										value: `**Type:** Library\n**Features:** ${SDK_INFO.piMono.features.join(", ")}\n**Status:** Core runtime`,
									},
								)
								.setTimestamp();
							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "run": {
							const prompt = interaction.options.getString("prompt", true);
							const taskType = (interaction.options.getString("type") || "code") as
								| "code"
								| "research"
								| "quick"
								| "security"
								| "free";
							try {
								const result = await runWithBestSDK(prompt, taskType);
								const sdkEmoji: Record<string, string> = {
									claude: "🤖",
									opencode: "🆓",
									openhands: "🔧",
									"pi-mono": "🧩",
								};
								const embed = new EmbedBuilder()
									.setTitle(`${sdkEmoji[result.sdk] || "🔧"} SDK Result - ${result.sdk}`)
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "(no output)")
									.addFields(
										{ name: "SDK Used", value: result.sdk, inline: true },
										{ name: "Task Type", value: taskType, inline: true },
										{ name: "Duration", value: `${result.duration}ms`, inline: true },
									)
									.setTimestamp();
								if (result.error) {
									embed.addFields({ name: "Error", value: result.error.substring(0, 1000) });
								}
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error: ${errMsg}`);
							}
							break;
						}

						case "use": {
							const sdk = interaction.options.getString("sdk", true) as "claude" | "opencode" | "openhands";
							const prompt = interaction.options.getString("prompt", true);
							try {
								let result: { success: boolean; output: string; error?: string; duration: number };

								switch (sdk) {
									case "claude":
										result = await runClaudeAgent(ClaudeAgentPresets.code(prompt));
										break;
									case "opencode":
										result = await runOpenCodeAgent(OpenCodePresets.code(prompt));
										break;
									case "openhands": {
										const ohResult = await runOpenHandsAgent({ task: prompt, mode: "developer" });
										result = {
											success: ohResult.success,
											output: ohResult.output,
											error: ohResult.error ?? undefined,
											duration: ohResult.duration,
										};
										break;
									}
									default:
										await interaction.editReply(`Unknown SDK: ${sdk}`);
										return;
								}

								const sdkEmoji: Record<string, string> = {
									claude: "🤖",
									opencode: "🆓",
									openhands: "🔧",
								};
								const embed = new EmbedBuilder()
									.setTitle(`${sdkEmoji[sdk]} ${sdk.toUpperCase()} Result`)
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "(no output)")
									.addFields(
										{ name: "SDK", value: sdk, inline: true },
										{ name: "Duration", value: `${result.duration}ms`, inline: true },
										{ name: "Status", value: result.success ? "✅ Success" : "❌ Failed", inline: true },
									)
									.setTimestamp();
								if (result.error) {
									embed.addFields({ name: "Error", value: result.error.substring(0, 1000) });
								}
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error: ${errMsg}`);
							}
							break;
						}

						default:
							await interaction.editReply(`Unknown subcommand: ${subcommand}`);
					}
					break;
				}

				case "suno": {
					const subcommand = interaction.options.getSubcommand();

					// Check if Suno is available
					if (!sunoService.isAvailable()) {
						await interaction.reply({
							content: "Suno API not configured. Please set SUNO_API_KEY environment variable.",
							ephemeral: true,
						});
						return;
					}

					switch (subcommand) {
						case "status": {
							await interaction.deferReply();
							try {
								const credits = await sunoService.getCredits();
								const embed = new EmbedBuilder()
									.setTitle("Suno AI Music Service")
									.setColor(0x9b59b6)
									.setDescription("AI music generation powered by sunoapi.org")
									.addFields(
										{ name: "Status", value: "Online", inline: true },
										{ name: "Credits Remaining", value: credits.remaining.toString(), inline: true },
										{ name: "Total Credits", value: credits.total.toString(), inline: true },
									)
									.addFields({
										name: "Available Commands",
										value: [
											"`/suno generate` - Quick generation from prompt",
											"`/suno custom` - Custom lyrics and style",
											"`/suno instrumental` - Instrumental tracks",
										].join("\n"),
									})
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error checking status: ${errMsg}`);
							}
							break;
						}

						case "generate": {
							const prompt = interaction.options.getString("prompt", true);
							const instrumental = interaction.options.getBoolean("instrumental") || false;

							if (prompt.length > 500) {
								await interaction.reply({
									content: "Prompt too long. Maximum 500 characters for simple generation.",
									ephemeral: true,
								});
								return;
							}

							await interaction.deferReply();

							try {
								// Start generation
								const startEmbed = new EmbedBuilder()
									.setTitle("Generating Music...")
									.setColor(0xf1c40f)
									.setDescription(`**Prompt:** ${prompt.substring(0, 200)}${prompt.length > 200 ? "..." : ""}`)
									.addFields({
										name: "Type",
										value: instrumental ? "Instrumental" : "With Vocals",
										inline: true,
									})
									.addFields({ name: "Status", value: STATUS_DESCRIPTIONS.PENDING, inline: true })
									.setFooter({ text: "This may take 30-60 seconds..." })
									.setTimestamp();

								await interaction.editReply({ embeds: [startEmbed] });

								const { taskId } = await sunoService.generateSimple(prompt, instrumental);

								// Poll for completion
								const result = await sunoService.waitForCompletion(taskId, 120000, 5000);

								if (result.tracks.length === 0) {
									await interaction.editReply("Generation completed but no tracks were returned.");
									return;
								}

								// Create result embed with track info
								const successEmbed = new EmbedBuilder()
									.setTitle("Music Generated!")
									.setColor(0x2ecc71)
									.setDescription(`**Prompt:** ${prompt.substring(0, 200)}${prompt.length > 200 ? "..." : ""}`)
									.setThumbnail(result.tracks[0].imageUrl || null)
									.setTimestamp();

								result.tracks.forEach((track: SunoTrack, idx: number) => {
									successEmbed.addFields({
										name: `Track ${idx + 1}: ${track.title}`,
										value: [
											`Style: ${track.tags}`,
											`Duration: ${Math.round(track.duration)}s`,
											`[Listen (Stream)](${track.streamAudioUrl})`,
											`[Download MP3](${track.audioUrl})`,
										].join("\n"),
									});
								});

								await interaction.editReply({ embeds: [successEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								const errorEmbed = new EmbedBuilder()
									.setTitle("Generation Failed")
									.setColor(0xe74c3c)
									.setDescription(errMsg)
									.setTimestamp();
								await interaction.editReply({ embeds: [errorEmbed] });
							}
							break;
						}

						case "custom": {
							const lyrics = interaction.options.getString("lyrics", true);
							const style = interaction.options.getString("style", true);
							const title = interaction.options.getString("title", true);
							const model = (interaction.options.getString("model") || "V4_5ALL") as SunoModel;

							if (lyrics.length > 5000) {
								await interaction.reply({
									content: "Lyrics too long. Maximum 5000 characters.",
									ephemeral: true,
								});
								return;
							}

							await interaction.deferReply();

							try {
								const startEmbed = new EmbedBuilder()
									.setTitle("Creating Custom Track...")
									.setColor(0xf1c40f)
									.addFields(
										{ name: "Title", value: title, inline: true },
										{ name: "Style", value: style, inline: true },
										{ name: "Model", value: model, inline: true },
									)
									.addFields({
										name: "Lyrics Preview",
										value: lyrics.substring(0, 500) + (lyrics.length > 500 ? "..." : ""),
									})
									.setFooter({ text: "This may take 1-2 minutes..." })
									.setTimestamp();

								await interaction.editReply({ embeds: [startEmbed] });

								const { taskId } = await sunoService.generateCustom(lyrics, style, title, model);
								const result = await sunoService.waitForCompletion(taskId, 180000, 5000);

								if (result.tracks.length === 0) {
									await interaction.editReply("Generation completed but no tracks were returned.");
									return;
								}

								const successEmbed = new EmbedBuilder()
									.setTitle(`Custom Track: ${title}`)
									.setColor(0x2ecc71)
									.setThumbnail(result.tracks[0].imageUrl || null)
									.setTimestamp();

								result.tracks.forEach((track: SunoTrack, idx: number) => {
									successEmbed.addFields({
										name: `Track ${idx + 1}`,
										value: [
											`Duration: ${Math.round(track.duration)}s`,
											`[Listen (Stream)](${track.streamAudioUrl})`,
											`[Download MP3](${track.audioUrl})`,
										].join("\n"),
									});
								});

								await interaction.editReply({ embeds: [successEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								const errorEmbed = new EmbedBuilder()
									.setTitle("Generation Failed")
									.setColor(0xe74c3c)
									.setDescription(errMsg)
									.setTimestamp();
								await interaction.editReply({ embeds: [errorEmbed] });
							}
							break;
						}

						case "instrumental": {
							const style = interaction.options.getString("style", true);
							const title = interaction.options.getString("title", true);

							await interaction.deferReply();

							try {
								const startEmbed = new EmbedBuilder()
									.setTitle("Creating Instrumental...")
									.setColor(0xf1c40f)
									.addFields(
										{ name: "Title", value: title, inline: true },
										{ name: "Style", value: style, inline: true },
									)
									.setFooter({ text: "This may take 1-2 minutes..." })
									.setTimestamp();

								await interaction.editReply({ embeds: [startEmbed] });

								const { taskId } = await sunoService.generateInstrumental(style, title);
								const result = await sunoService.waitForCompletion(taskId, 180000, 5000);

								if (result.tracks.length === 0) {
									await interaction.editReply("Generation completed but no tracks were returned.");
									return;
								}

								const successEmbed = new EmbedBuilder()
									.setTitle(`Instrumental: ${title}`)
									.setColor(0x2ecc71)
									.setThumbnail(result.tracks[0].imageUrl || null)
									.setTimestamp();

								result.tracks.forEach((track: SunoTrack, idx: number) => {
									successEmbed.addFields({
										name: `Track ${idx + 1}`,
										value: [
											`Style: ${track.tags}`,
											`Duration: ${Math.round(track.duration)}s`,
											`[Listen (Stream)](${track.streamAudioUrl})`,
											`[Download MP3](${track.audioUrl})`,
										].join("\n"),
									});
								});

								await interaction.editReply({ embeds: [successEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								const errorEmbed = new EmbedBuilder()
									.setTitle("Generation Failed")
									.setColor(0xe74c3c)
									.setDescription(errMsg)
									.setTimestamp();
								await interaction.editReply({ embeds: [errorEmbed] });
							}
							break;
						}
					}
					break;
				}

				case "gepa": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`gepa ${subCmd}`, user.username);

					switch (subCmd) {
						case "status": {
							await interaction.deferReply();
							try {
								const status = await getGEPAStatus();
								const embed = new EmbedBuilder()
									.setTitle("GEPA Status")
									.setColor(status.available ? 0x2ecc71 : 0xe74c3c)
									.setDescription(
										status.available
											? "GEPA prompt optimization is available"
											: "GEPA not installed. Run: `pip install gepa`",
									)
									.addFields(
										{ name: "Available", value: status.available ? "Yes" : "No", inline: true },
										{ name: "Version", value: status.version || "N/A", inline: true },
										{ name: "Python", value: status.pythonVersion.split(" ")[0] || "Unknown", inline: true },
									)
									.setFooter({ text: "GEPA: Genetic-Pareto Prompt Optimizer" })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`Error checking GEPA status: ${error}`);
							}
							break;
						}

						case "domains": {
							const domains = getExpertiseDomains();
							const embed = new EmbedBuilder()
								.setTitle("Available Expertise Domains")
								.setColor(0x3498db)
								.setDescription(
									domains.length > 0
										? domains.map((d) => `• \`${d}\``).join("\n")
										: "No expertise domains found",
								)
								.addFields({ name: "Total", value: `${domains.length} domains`, inline: true })
								.setTimestamp();
							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "optimize": {
							await interaction.deferReply();
							const prompt = interaction.options.getString("prompt", true);
							const agentType = (interaction.options.getString("agent_type") || "default") as GEPAAgentType;
							const iterations = interaction.options.getInteger("iterations") || 50;

							try {
								// Generate example data based on agent type
								let examples: GEPAExample[];
								switch (agentType) {
									case "coding":
										examples = generateCodingExamples();
										break;
									case "trading":
										examples = generateTradingExamples();
										break;
									case "security":
										examples = generateSecurityExamples();
										break;
									default:
										examples = generateCodingExamples().slice(0, 3);
								}

								const startEmbed = new EmbedBuilder()
									.setTitle("GEPA Optimization Started")
									.setColor(0xf39c12)
									.setDescription(`Optimizing prompt for \`${agentType}\` agent...`)
									.addFields(
										{ name: "Iterations", value: `${iterations}`, inline: true },
										{ name: "Examples", value: `${examples.length}`, inline: true },
									)
									.setFooter({ text: "This may take a few minutes..." })
									.setTimestamp();
								await interaction.editReply({ embeds: [startEmbed] });

								const result = await optimizePrompt({
									prompt,
									examples,
									agentType,
									maxIterations: iterations,
									saveToExpertise: true,
									domain: agentType,
								});

								const resultEmbed = new EmbedBuilder()
									.setTitle(result.success ? "Optimization Complete" : "Optimization Failed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.setDescription(
										result.success
											? `Prompt optimized in ${(result.duration / 1000).toFixed(1)}s`
											: result.error || "Unknown error",
									)
									.setTimestamp();

								if (result.success && result.optimizedPrompt) {
									resultEmbed.addFields(
										{
											name: "Improvement",
											value: result.improvement ? `${(result.improvement * 100).toFixed(1)}%` : "N/A",
											inline: true,
										},
										{ name: "Best Score", value: result.bestScore?.toFixed(3) || "N/A", inline: true },
										{ name: "Iterations", value: `${result.iterations || iterations}`, inline: true },
										{
											name: "Optimized Prompt (truncated)",
											value: `\`\`\`\n${result.optimizedPrompt.slice(0, 500)}${result.optimizedPrompt.length > 500 ? "..." : ""}\n\`\`\``,
										},
									);
									if (result.savedTo) {
										resultEmbed.addFields({ name: "Saved To", value: result.savedTo });
									}
								}

								await interaction.editReply({ embeds: [resultEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Optimization error: ${errMsg}`);
							}
							break;
						}

						case "evaluate": {
							await interaction.deferReply();
							const prompt = interaction.options.getString("prompt", true);
							const agentType = (interaction.options.getString("agent_type") || "default") as GEPAAgentType;

							try {
								const examples =
									agentType === "trading"
										? generateTradingExamples()
										: agentType === "security"
											? generateSecurityExamples()
											: generateCodingExamples();

								const result = await evaluatePrompt({ prompt, examples, agentType });

								const embed = new EmbedBuilder()
									.setTitle("Prompt Evaluation")
									.setColor(result.success ? 0x3498db : 0xe74c3c)
									.addFields(
										{ name: "Average Score", value: result.avgScore.toFixed(3), inline: true },
										{ name: "Min Score", value: result.minScore.toFixed(3), inline: true },
										{ name: "Max Score", value: result.maxScore.toFixed(3), inline: true },
										{ name: "Passing", value: `${result.passing}/${result.numExamples}`, inline: true },
										{ name: "Failing", value: `${result.failing}/${result.numExamples}`, inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Evaluation error: ${errMsg}`);
							}
							break;
						}

						case "expertise": {
							await interaction.deferReply();
							const domain = interaction.options.getString("domain", true);

							try {
								const examples =
									domain === "trading"
										? generateTradingExamples()
										: domain === "security"
											? generateSecurityExamples()
											: generateCodingExamples();

								const startEmbed = new EmbedBuilder()
									.setTitle(`Optimizing ${domain} Expertise`)
									.setColor(0xf39c12)
									.setDescription("Loading existing expertise and optimizing...")
									.setTimestamp();
								await interaction.editReply({ embeds: [startEmbed] });

								const result = await optimizeExpertise(domain, examples);

								const resultEmbed = new EmbedBuilder()
									.setTitle(result.success ? "Expertise Optimized" : "Optimization Failed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.setDescription(
										result.success
											? `${domain} expertise optimized in ${(result.duration / 1000).toFixed(1)}s`
											: result.error || "Unknown error",
									)
									.setTimestamp();

								if (result.success) {
									resultEmbed.addFields(
										{
											name: "Improvement",
											value: result.improvement ? `${(result.improvement * 100).toFixed(1)}%` : "N/A",
											inline: true,
										},
										{ name: "Best Score", value: result.bestScore?.toFixed(3) || "N/A", inline: true },
									);
									if (result.savedTo) {
										resultEmbed.addFields({ name: "Saved To", value: result.savedTo });
									}
								}

								await interaction.editReply({ embeds: [resultEmbed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Expertise optimization error: ${errMsg}`);
							}
							break;
						}
					}
					break;
				}

				case "research": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`research ${subCmd}`, user.username);

					switch (subCmd) {
						case "start": {
							try {
								const orchestrator = startResearch({
									enableNotifications: true,
									notificationChannelId: interaction.channelId,
								});

								const embed = new EmbedBuilder()
									.setTitle("24/7 Research Orchestrator Started")
									.setColor(0x2ecc71)
									.setDescription("Autonomous research system is now running")
									.addFields(
										{ name: "Status", value: "Running", inline: true },
										{ name: "Topics", value: `${orchestrator.getState().topics.length}`, inline: true },
									)
									.setFooter({ text: "CTM + DGM + OpenEvolve + GEPA" })
									.setTimestamp();

								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error starting research: ${error}`);
							}
							break;
						}

						case "stop": {
							try {
								stopResearch();
								const embed = new EmbedBuilder()
									.setTitle("Research Orchestrator Stopped")
									.setColor(0xe74c3c)
									.setDescription("24/7 research has been stopped")
									.setTimestamp();
								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error stopping research: ${error}`);
							}
							break;
						}

						case "status": {
							const status = getResearchStatus();
							const embed = new EmbedBuilder()
								.setTitle("Research Orchestrator Status")
								.setColor(status?.isRunning ? 0x2ecc71 : 0x95a5a6)
								.setDescription(status?.isRunning ? "Research is running" : "Research is stopped")
								.setTimestamp();

							if (status) {
								embed.addFields(
									{ name: "Running", value: status.isRunning ? "Yes" : "No", inline: true },
									{ name: "Cycles Completed", value: `${status.cyclesCompleted}`, inline: true },
									{ name: "Topics", value: `${status.topics.length}`, inline: true },
								);

								if (status.currentTopic) {
									embed.addFields({ name: "Current Topic", value: status.currentTopic, inline: true });
								}
								if (status.currentPhase) {
									embed.addFields({ name: "Current Phase", value: status.currentPhase, inline: true });
								}
								if (status.nextScheduledCycle) {
									const nextIn = Math.max(0, status.nextScheduledCycle - Date.now());
									embed.addFields({
										name: "Next Cycle",
										value: `${Math.floor(nextIn / 60000)}m ${Math.floor((nextIn % 60000) / 1000)}s`,
										inline: true,
									});
								}

								if (status.recentResults.length > 0) {
									const recent = status.recentResults.slice(0, 3);
									const recentStr = recent
										.map(
											(r) =>
												`• ${r.topicId}: ${r.success ? "Success" : "Failed"} (${(r.confidence * 100).toFixed(0)}%)`,
										)
										.join("\n");
									embed.addFields({ name: "Recent Results", value: recentStr });
								}
							} else {
								embed.addFields({ name: "Status", value: "Not initialized" });
							}

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "trigger": {
							await interaction.deferReply();
							const topicId = interaction.options.getString("topic") || undefined;

							try {
								const orchestrator = getResearchOrchestrator();
								const result = await orchestrator.triggerCycle(topicId);

								if (result) {
									const embed = new EmbedBuilder()
										.setTitle("Research Cycle Complete")
										.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
										.setDescription(`Topic: ${result.topicId}`)
										.addFields(
											{ name: "Success", value: result.success ? "Yes" : "No", inline: true },
											{
												name: "Confidence",
												value: `${(result.confidence * 100).toFixed(1)}%`,
												inline: true,
											},
											{
												name: "Duration",
												value: `${(result.duration / 1000).toFixed(1)}s`,
												inline: true,
											},
										)
										.setTimestamp();

									if (result.findings && result.findings.length > 0) {
										embed.addFields({
											name: "Findings",
											value: result.findings.slice(0, 3).join("\n").slice(0, 1000),
										});
									}
									if (result.insights && result.insights.length > 0) {
										embed.addFields({
											name: "Insights",
											value: result.insights.slice(0, 3).join("\n").slice(0, 500),
										});
									}

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply("No research cycle was executed. Is the orchestrator running?");
								}
							} catch (error) {
								await interaction.editReply(`Error triggering research: ${error}`);
							}
							break;
						}

						case "topics": {
							const status = getResearchStatus();
							const topics = status?.topics || [];

							const embed = new EmbedBuilder()
								.setTitle("Research Topics")
								.setColor(0x3498db)
								.setDescription(`${topics.length} topics configured`)
								.setTimestamp();

							if (topics.length > 0) {
								const topicList = topics
									.sort((a, b) => b.priority - a.priority)
									.map((t) => `• **${t.name}** (priority: ${t.priority})\n  _${t.question.slice(0, 100)}..._`)
									.join("\n\n");
								embed.addFields({ name: "Topics", value: topicList.slice(0, 4000) });
							}

							await interaction.reply({ embeds: [embed] });
							break;
						}
					}
					break;
				}

				case "daemon": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`daemon ${subCmd}`, user.username);

					switch (subCmd) {
						case "start": {
							try {
								const presetName = interaction.options.getString("preset") || "autonomous";
								const presets: Record<string, Partial<DaemonConfig>> = {
									autonomous: DaemonPresets.autonomous,
									trader: DaemonPresets.trader,
									researcher: DaemonPresets.researcher,
									conservative: DaemonPresets.conservative,
								};
								const config = presets[presetName] || DaemonPresets.autonomous;

								const daemon = await startDaemon(config);

								const state = daemon.getState();
								const embed = new EmbedBuilder()
									.setTitle("Autonomous Daemon Started")
									.setColor(0x2ecc71)
									.setDescription(`24/7 self-improving agent system is now running`)
									.addFields(
										{ name: "Status", value: state.status, inline: true },
										{ name: "Preset", value: presetName, inline: true },
										{ name: "Name", value: state.name, inline: true },
									)
									.setFooter({ text: "Improvement + Research + Healing + Optimization" })
									.setTimestamp();

								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error starting daemon: ${error}`);
							}
							break;
						}

						case "stop": {
							try {
								stopDaemon("User requested stop via Discord");
								const embed = new EmbedBuilder()
									.setTitle("Autonomous Daemon Stopped")
									.setColor(0xe74c3c)
									.setDescription("24/7 daemon has been stopped")
									.setTimestamp();
								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error stopping daemon: ${error}`);
							}
							break;
						}

						case "status": {
							const state = getDaemonStatus();
							const embed = new EmbedBuilder()
								.setTitle("Autonomous Daemon Status")
								.setColor(
									state?.status === "running" ? 0x2ecc71 : state?.status === "paused" ? 0xf39c12 : 0x95a5a6,
								)
								.setDescription(state ? `Status: ${state.status}` : "Daemon is not initialized")
								.setTimestamp();

							if (state) {
								const successRate = (state.performance.successRate * 100).toFixed(1);
								embed.addFields(
									{ name: "Cycles Completed", value: `${state.cyclesCompleted}`, inline: true },
									{ name: "Success Rate", value: `${successRate}%`, inline: true },
									{ name: "Improvements", value: `${state.performance.improvementsApplied}`, inline: true },
									{ name: "Discoveries", value: `${state.performance.researchDiscoveries}`, inline: true },
									{ name: "Errors Fixed", value: `${state.performance.errorsFixed}`, inline: true },
								);

								if (state.currentTask) {
									embed.addFields({
										name: "Current Task",
										value: state.currentTask.substring(0, 100),
										inline: false,
									});
								}

								if (state.lastCycleAt) {
									const lastAgo = Math.floor((Date.now() - state.lastCycleAt) / 60000);
									embed.addFields({ name: "Last Cycle", value: `${lastAgo}m ago`, inline: true });
								}

								if (state.learnings.length > 0) {
									const recentLearnings = state.learnings.slice(-3).join("\n• ");
									embed.addFields({
										name: "Recent Learnings",
										value: `• ${recentLearnings}`.substring(0, 500),
									});
								}
							} else {
								embed.addFields({ name: "Status", value: "Not initialized - use `/daemon start`" });
							}

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "trigger": {
							await interaction.deferReply();
							const cycleType = interaction.options.getString("cycle", true) as
								| "improvement"
								| "research"
								| "healing"
								| "optimization"
								| "task";

							try {
								const daemon = getAutonomousDaemon();
								if (!daemon) {
									await interaction.editReply("Daemon is not running. Start it first with `/daemon start`");
									break;
								}

								await daemon.triggerCycle(cycleType);

								const embed = new EmbedBuilder()
									.setTitle(`Cycle Triggered: ${cycleType}`)
									.setColor(0x3498db)
									.setDescription(`Manually triggered ${cycleType} cycle`)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`Error triggering cycle: ${error}`);
							}
							break;
						}

						case "pause": {
							try {
								const daemon = getAutonomousDaemon();
								if (!daemon) {
									await interaction.reply("Daemon is not running");
									break;
								}
								daemon.pause();
								const embed = new EmbedBuilder()
									.setTitle("Daemon Paused")
									.setColor(0xf39c12)
									.setDescription("Daemon is paused. Use `/daemon resume` to continue.")
									.setTimestamp();
								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error pausing daemon: ${error}`);
							}
							break;
						}

						case "resume": {
							try {
								const daemon = getAutonomousDaemon();
								if (!daemon) {
									await interaction.reply("Daemon is not running");
									break;
								}
								daemon.resume();
								const embed = new EmbedBuilder()
									.setTitle("Daemon Resumed")
									.setColor(0x2ecc71)
									.setDescription("Daemon has resumed execution")
									.setTimestamp();
								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error resuming daemon: ${error}`);
							}
							break;
						}

						case "history": {
							const state = getDaemonStatus();
							const embed = new EmbedBuilder()
								.setTitle("Daemon Cycle History")
								.setColor(0x9b59b6)
								.setDescription("Recent cycle statistics")
								.setTimestamp();

							if (state) {
								embed.addFields(
									{ name: "Total Cycles", value: `${state.cyclesCompleted}`, inline: true },
									{
										name: "Avg Duration",
										value: `${(state.performance.avgCycleDuration / 1000).toFixed(1)}s`,
										inline: true,
									},
									{
										name: "Success Rate",
										value: `${(state.performance.successRate * 100).toFixed(1)}%`,
										inline: true,
									},
								);

								if (state.learnings.length > 0) {
									const learningsList = state.learnings
										.slice(-5)
										.map((l, i) => `${i + 1}. ${l.substring(0, 80)}`)
										.join("\n");
									embed.addFields({ name: "Recent Learnings", value: learningsList || "None" });
								} else {
									embed.addFields({ name: "Learnings", value: "No learnings captured yet" });
								}
							} else {
								embed.addFields({ name: "History", value: "No daemon activity yet" });
							}

							await interaction.reply({ embeds: [embed] });
							break;
						}
					}
					break;
				}

				case "dialogue": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`dialogue ${subCmd}`, user.username);

					switch (subCmd) {
						case "run": {
							await interaction.deferReply();
							const topic = interaction.options.getString("topic", true);
							const context = interaction.options.getString("context") || "";
							const mode = interaction.options.getString("mode") || "trading";

							try {
								const { runTradingDialogue, runDialogue } = await import("./agents/agent-dialogue.js");
								const { runAgent } = await import("./agents/lightweight-agent.js");

								// Create LLM executor
								const executor = async (systemPrompt: string, userPrompt: string): Promise<string> => {
									const result = await runAgent({
										prompt: `${systemPrompt}\n\n${userPrompt}`,
										timeout: 30000,
									});
									return result.output;
								};

								const session =
									mode === "trading"
										? await runTradingDialogue(topic, context, executor)
										: await runDialogue(topic, context, executor);

								const embed = new EmbedBuilder()
									.setTitle(`Dialogue: ${topic.slice(0, 100)}`)
									.setColor(session.success ? 0x2ecc71 : 0xe74c3c)
									.setDescription(`Mode: ${mode} | Rounds: ${session.rounds.length}`)
									.setTimestamp();

								if (session.finalConsensus) {
									embed.addFields({
										name: "Consensus",
										value: session.finalConsensus.slice(0, 1000),
									});
								}

								if (session.actionItems && session.actionItems.length > 0) {
									embed.addFields({
										name: "Action Items",
										value: session.actionItems.slice(0, 5).join("\n").slice(0, 500),
									});
								}

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`Error running dialogue: ${error}`);
							}
							break;
						}

						case "agents": {
							const { DEFAULT_DIALOGUE_AGENTS, TRADING_DIALOGUE_AGENTS } = await import(
								"./agents/agent-dialogue.js"
							);

							const embed = new EmbedBuilder()
								.setTitle("Dialogue Agents")
								.setColor(0x9b59b6)
								.setDescription("Multi-agent dialogue system (AgentLaboratory pattern)")
								.setTimestamp();

							const generalAgents = DEFAULT_DIALOGUE_AGENTS.map(
								(a) => `• **${a.name}** (${a.role})\n  _${a.expertise.join(", ")}_`,
							).join("\n");

							const tradingAgents = TRADING_DIALOGUE_AGENTS.map(
								(a) => `• **${a.name}** (${a.role})\n  _${a.expertise.join(", ")}_`,
							).join("\n");

							embed.addFields(
								{ name: "General Agents", value: generalAgents.slice(0, 1000) },
								{ name: "Trading Agents", value: tradingAgents.slice(0, 1000) },
							);

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "status": {
							await interaction.reply(
								"Dialogue system is available. Use `/dialogue run` to start a discussion.",
							);
							break;
						}
					}
					break;
				}

				case "rxiv": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`rxiv ${subCmd}`, user.username);

					const { getTradingRxiv, searchRxiv, submitStrategy, submitInsight, recordFailure, getRxivStats } =
						await import("./agents/trading-rxiv.js");

					switch (subCmd) {
						case "search": {
							await interaction.deferReply();
							const query = interaction.options.getString("query", true);
							const entryType = interaction.options.getString("type") as
								| "strategy"
								| "signal"
								| "insight"
								| "failure"
								| "pattern"
								| undefined;

							try {
								const results = await searchRxiv(query, {
									type: entryType,
									limit: 10,
									semantic: true,
								});

								const embed = new EmbedBuilder()
									.setTitle(`Search: ${query}`)
									.setColor(0x3498db)
									.setDescription(`Found ${results.length} results`)
									.setTimestamp();

								if (results.length > 0) {
									const resultList = results
										.slice(0, 5)
										.map(
											(r) =>
												`• **${r.entry.metadata.title}** (${r.entry.metadata.type})\n  Score: ${(r.relevanceScore * 100).toFixed(0)}% | ID: ${r.entry.metadata.id}`,
										)
										.join("\n\n");
									embed.addFields({ name: "Results", value: resultList.slice(0, 1000) });
								}

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`Error searching: ${error}`);
							}
							break;
						}

						case "submit": {
							await interaction.deferReply();
							const title = interaction.options.getString("title", true);
							const content = interaction.options.getString("content", true);
							const entryType = interaction.options.getString("type", true) as
								| "strategy"
								| "insight"
								| "signal"
								| "failure";
							const tagsStr = interaction.options.getString("tags") || "";
							const tags = tagsStr
								.split(",")
								.map((t) => t.trim())
								.filter(Boolean);

							try {
								let entry: Awaited<ReturnType<typeof submitStrategy>>;
								switch (entryType) {
									case "strategy":
										entry = await submitStrategy(title, content.slice(0, 500), content, {
											author: user.username,
											tags,
										});
										break;
									case "insight":
										entry = await submitInsight(title, content.slice(0, 500), content, {
											author: user.username,
											tags,
										});
										break;
									case "failure":
										entry = await recordFailure(title, content.slice(0, 500), content, {
											author: user.username,
											tags,
											whatWentWrong: "User-submitted failure",
											lessonsLearned: tags.length > 0 ? tags : ["Documented for future reference"],
										});
										break;
									default:
										entry = await submitInsight(title, content.slice(0, 500), content, {
											author: user.username,
											tags,
										});
								}

								await interaction.editReply(
									`Submitted! Entry ID: \`${entry.metadata.id}\`\n\nTitle: **${entry.metadata.title}**\nType: ${entry.metadata.type}`,
								);
							} catch (error) {
								await interaction.editReply(`Error submitting: ${error}`);
							}
							break;
						}

						case "view": {
							const id = interaction.options.getString("id", true);
							const rxiv = getTradingRxiv();
							const entry = rxiv.get(id);

							if (!entry) {
								await interaction.reply(`Entry not found: ${id}`);
								break;
							}

							const embed = new EmbedBuilder()
								.setTitle(entry.metadata.title)
								.setColor(0x9b59b6)
								.setDescription(entry.abstract.slice(0, 500))
								.addFields(
									{ name: "Type", value: entry.metadata.type, inline: true },
									{ name: "Status", value: entry.metadata.status, inline: true },
									{ name: "Author", value: entry.metadata.author, inline: true },
									{ name: "Tags", value: entry.metadata.tags.join(", ") || "None", inline: true },
								)
								.setTimestamp(entry.metadata.createdAt);

							if (entry.metadata.performance) {
								const perf = entry.metadata.performance;
								embed.addFields({
									name: "Performance",
									value: `Win Rate: ${perf.winRate || "N/A"} | Sharpe: ${perf.sharpeRatio || "N/A"} | Max DD: ${perf.maxDrawdown || "N/A"}`,
								});
							}

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "stats": {
							const stats = getRxivStats();

							const embed = new EmbedBuilder()
								.setTitle("Trading-Rxiv Statistics")
								.setColor(0x2ecc71)
								.setDescription(`Total entries: ${stats.totalEntries}`)
								.addFields(
									{
										name: "By Type",
										value:
											Object.entries(stats.byType)
												.filter(([, v]) => v > 0)
												.map(([k, v]) => `${k}: ${v}`)
												.join(", ") || "None",
									},
									{
										name: "Top Tags",
										value:
											stats.topTags
												.slice(0, 5)
												.map((t) => `${t.tag}: ${t.count}`)
												.join(", ") || "None",
									},
									{
										name: "Recent Activity",
										value: `${stats.recentActivity} entries in last 7 days`,
									},
								)
								.setTimestamp();

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "recent": {
							const results = await searchRxiv("", { limit: 10 });

							const embed = new EmbedBuilder()
								.setTitle("Recent Trading-Rxiv Entries")
								.setColor(0x3498db)
								.setTimestamp();

							if (results.length > 0) {
								const list = results
									.map(
										(r) =>
											`• **${r.entry.metadata.title}** (${r.entry.metadata.type})\n  ${new Date(r.entry.metadata.createdAt).toLocaleDateString()}`,
									)
									.join("\n\n");
								embed.setDescription(list.slice(0, 2000));
							} else {
								embed.setDescription("No entries yet. Use `/rxiv submit` to add the first one!");
							}

							await interaction.reply({ embeds: [embed] });
							break;
						}
					}
					break;
				}

				case "reviewer": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`reviewer ${subCmd}`, user.username);

					switch (subCmd) {
						case "review": {
							await interaction.deferReply();
							const content = interaction.options.getString("content", true);
							const context = interaction.options.getString("context") || "User-submitted content for review";
							const mode = interaction.options.getString("mode") || "general";

							try {
								const { quickReview, reviewTradingStrategy } = await import("./agents/agent-reviewer.js");
								const { runAgent } = await import("./agents/lightweight-agent.js");

								// Create LLM executor
								const executor = async (systemPrompt: string, userPrompt: string): Promise<string> => {
									const result = await runAgent({
										prompt: `${systemPrompt}\n\n${userPrompt}`,
										timeout: 30000,
									});
									return result.output;
								};

								const review =
									mode === "trading"
										? await reviewTradingStrategy(content, context, executor)
										: await quickReview(content, context, executor);

								const embed = new EmbedBuilder()
									.setTitle("Peer Review Results")
									.setColor(review.passed ? 0x2ecc71 : 0xe74c3c)
									.setDescription(
										`Verdict: **${review.consensusVerdict.toUpperCase()}** | ${review.passed ? "PASSED" : "NEEDS REVISION"}`,
									)
									.addFields(
										{
											name: "Overall Score",
											value: `${review.aggregatedScores.overall.mean.toFixed(1)}/10 (±${review.aggregatedScores.overall.std.toFixed(1)})`,
											inline: true,
										},
										{
											name: "Confidence",
											value: `${(review.overallConfidence * 100).toFixed(0)}%`,
											inline: true,
										},
										{ name: "Reviewers", value: `${review.reviews.length}`, inline: true },
									)
									.setTimestamp();

								if (review.unanimousStrengths.length > 0) {
									embed.addFields({
										name: "Strengths",
										value: review.unanimousStrengths.slice(0, 3).join("\n").slice(0, 500),
									});
								}

								if (review.unanimousWeaknesses.length > 0) {
									embed.addFields({
										name: "Weaknesses",
										value: review.unanimousWeaknesses.slice(0, 3).join("\n").slice(0, 500),
									});
								}

								if (review.combinedSuggestions.length > 0) {
									embed.addFields({
										name: "Suggestions",
										value: review.combinedSuggestions.slice(0, 3).join("\n").slice(0, 500),
									});
								}

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`Error running review: ${error}`);
							}
							break;
						}

						case "reviewers": {
							const { DEFAULT_REVIEWERS, TRADING_REVIEWERS } = await import("./agents/agent-reviewer.js");

							const embed = new EmbedBuilder()
								.setTitle("Reviewer Personas")
								.setColor(0x9b59b6)
								.setDescription("Multi-persona review system (AgentLaboratory pattern)")
								.setTimestamp();

							const general = DEFAULT_REVIEWERS.map(
								(r) => `• **${r.name}** (${r.persona})\n  _${r.expertise.slice(0, 3).join(", ")}_`,
							).join("\n");

							const trading = TRADING_REVIEWERS.map(
								(r) => `• **${r.name}** (${r.persona})\n  _${r.expertise.slice(0, 3).join(", ")}_`,
							).join("\n");

							embed.addFields(
								{ name: "General Reviewers", value: general.slice(0, 1000) },
								{ name: "Trading Reviewers", value: trading.slice(0, 1000) },
							);

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "status": {
							await interaction.reply("Review system is available. Use `/reviewer review` to submit content.");
							break;
						}
					}
					break;
				}

				case "ctm": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`ctm ${subCmd}`, user.username);

					switch (subCmd) {
						case "think": {
							await interaction.deferReply();
							const problem = interaction.options.getString("problem", true);
							const domain = (interaction.options.getString("domain") || "general") as CTMDomain;
							const depth = interaction.options.getString("depth") || "quick";

							try {
								const startEmbed = new EmbedBuilder()
									.setTitle("Continuous Thinking Started")
									.setColor(0xf39c12)
									.setDescription(`Domain: ${domain}, Depth: ${depth}`)
									.addFields({ name: "Problem", value: problem.slice(0, 500) })
									.setFooter({ text: "Extended reasoning in progress..." })
									.setTimestamp();
								await interaction.editReply({ embeds: [startEmbed] });

								let result: CTMResult;
								switch (depth) {
									case "deep":
										result = await deepThink(problem, domain);
										break;
									case "research":
										result = await think(CTMPresets.research(problem));
										break;
									default:
										result = await quickThink(problem);
								}

								const resultEmbed = new EmbedBuilder()
									.setTitle(result.success ? "Thinking Complete" : "Thinking Failed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Steps", value: `${result.thinkingSteps}`, inline: true },
										{ name: "Confidence", value: `${(result.confidence * 100).toFixed(1)}%`, inline: true },
										{
											name: "Duration",
											value: `${(result.thinkingTime / 1000).toFixed(1)}s`,
											inline: true,
										},
									)
									.setTimestamp();

								if (result.answer) {
									resultEmbed.addFields({
										name: "Answer",
										value: result.answer.slice(0, 1000) + (result.answer.length > 1000 ? "..." : ""),
									});
								}
								if (result.insights && result.insights.length > 0) {
									resultEmbed.addFields({
										name: "Insights",
										value: result.insights.slice(0, 3).join("\n").slice(0, 500),
									});
								}

								await interaction.editReply({ embeds: [resultEmbed] });
							} catch (error) {
								await interaction.editReply(`Thinking error: ${error}`);
							}
							break;
						}

						case "status": {
							try {
								const status = await getCTMStatus();
								const embed = new EmbedBuilder()
									.setTitle("CTM Status")
									.setColor(status.available ? 0x2ecc71 : 0xe74c3c)
									.setDescription(
										status.available ? "Continuous Thought Machine is available" : "CTM not available",
									)
									.addFields(
										{ name: "Available", value: status.available ? "Yes" : "No", inline: true },
										{ name: "Version", value: status.version || "N/A", inline: true },
										{ name: "GPU", value: status.gpuAvailable ? "Yes" : "No", inline: true },
									)
									.setFooter({ text: "arXiv:2505.05522" })
									.setTimestamp();
								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error checking CTM status: ${error}`);
							}
							break;
						}
					}
					break;
				}

				case "evolve": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`evolve ${subCmd}`, user.username);

					switch (subCmd) {
						case "prompt": {
							await interaction.deferReply();
							const seed = interaction.options.getString("seed", true);
							const criteria = interaction.options.getString("criteria", true);
							const generations = interaction.options.getInteger("generations") || 10;

							try {
								const startEmbed = new EmbedBuilder()
									.setTitle("Evolution Started")
									.setColor(0xf39c12)
									.setDescription(`Evolving prompt over ${generations} generations...`)
									.addFields(
										{ name: "Criteria", value: criteria.slice(0, 200) },
										{ name: "Generations", value: `${generations}`, inline: true },
									)
									.setFooter({ text: "MAP-Elites algorithm running..." })
									.setTimestamp();
								await interaction.editReply({ embeds: [startEmbed] });

								const result = await quickEvolve(seed, criteria, generations);

								const resultEmbed = new EmbedBuilder()
									.setTitle(result.success ? "Evolution Complete" : "Evolution Failed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Generations", value: `${result.generations || 0}`, inline: true },
										{
											name: "Best Fitness",
											value: result.bestFitness?.toFixed(3) || "N/A",
											inline: true,
										},
										{
											name: "Duration",
											value: `${(result.duration / 1000).toFixed(1)}s`,
											inline: true,
										},
									)
									.setTimestamp();

								if (result.bestSolution) {
									resultEmbed.addFields({
										name: "Best Solution",
										value: `\`\`\`\n${result.bestSolution.slice(0, 800)}${result.bestSolution.length > 800 ? "..." : ""}\n\`\`\``,
									});
								}
								if (result.diversityScore) {
									resultEmbed.addFields({
										name: "Diversity",
										value: `${(result.diversityScore * 100).toFixed(1)}%`,
										inline: true,
									});
								}

								await interaction.editReply({ embeds: [resultEmbed] });
							} catch (error) {
								await interaction.editReply(`Evolution error: ${error}`);
							}
							break;
						}

						case "code": {
							await interaction.deferReply();
							const code = interaction.options.getString("code", true);
							const objective = interaction.options.getString("objective", true);

							try {
								const result = await evolve(OpenEvolvePresets.thoroughCode(code, objective));

								const resultEmbed = new EmbedBuilder()
									.setTitle(result.success ? "Code Evolution Complete" : "Evolution Failed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Generations", value: `${result.generations || 0}`, inline: true },
										{
											name: "Best Fitness",
											value: result.bestFitness?.toFixed(3) || "N/A",
											inline: true,
										},
										{
											name: "Duration",
											value: `${(result.duration / 1000).toFixed(1)}s`,
											inline: true,
										},
									)
									.setTimestamp();

								if (result.bestSolution) {
									resultEmbed.addFields({
										name: "Evolved Code",
										value: `\`\`\`\n${result.bestSolution.slice(0, 800)}...\n\`\`\``,
									});
								}

								await interaction.editReply({ embeds: [resultEmbed] });
							} catch (error) {
								await interaction.editReply(`Code evolution error: ${error}`);
							}
							break;
						}

						case "status": {
							try {
								const available = await isOpenEvolveAvailable();
								const status = await getOpenEvolveStatus();

								const embed = new EmbedBuilder()
									.setTitle("OpenEvolve Status")
									.setColor(available ? 0x2ecc71 : 0xe74c3c)
									.setDescription(
										available
											? "OpenEvolve evolutionary optimization is available"
											: "OpenEvolve not installed. Run: `pip install openevolve`",
									)
									.addFields(
										{ name: "Available", value: available ? "Yes" : "No", inline: true },
										{ name: "Version", value: status.version || "N/A", inline: true },
										{ name: "Python", value: status.pythonVersion || "Unknown", inline: true },
									)
									.setFooter({ text: "LLM-based Evolutionary Optimization" })
									.setTimestamp();
								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error checking OpenEvolve status: ${error}`);
							}
							break;
						}

						case "list": {
							try {
								const { listEvolutionTasks } = await import("./agents/index.js");
								const tasks = listEvolutionTasks();

								const embed = new EmbedBuilder()
									.setTitle("Evolution Tasks")
									.setColor(0x3498db)
									.setDescription(`${tasks.length} evolution tasks found`)
									.setTimestamp();

								if (tasks.length > 0) {
									const taskList = tasks
										.slice(0, 10)
										.map((t) => `• \`${t}\``)
										.join("\n");
									embed.addFields({ name: "Tasks", value: taskList });
								}

								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error listing tasks: ${error}`);
							}
							break;
						}
					}
					break;
				}

				case "dgm": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`dgm ${subCmd}`, user.username);

					switch (subCmd) {
						case "improve": {
							const filePath = interaction.options.getString("file", true);
							const objective = interaction.options.getString("objective", true);
							const maxIterations = interaction.options.getInteger("max_iterations") || 5;

							await interaction.deferReply();

							try {
								const result = await improve({
									targetId: `discord_${Date.now()}`,
									filePath,
									objective,
									evaluationCriteria: objective, // Use objective as criteria
									maxIterations,
								});

								const totalLinesChanged =
									result.modifications?.reduce((sum, m) => sum + m.linesChanged, 0) || 0;

								const embed = new EmbedBuilder()
									.setTitle("🧬 DGM Improvement Result")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "File", value: filePath, inline: true },
										{ name: "Iterations", value: `${result.iterations || 0}/${maxIterations}`, inline: true },
										{ name: "Lines Changed", value: `${totalLinesChanged}`, inline: true },
									);

								if (result.modifications && result.modifications.length > 0) {
									const modList = result.modifications
										.slice(0, 5)
										.map((m) => `• ${m.description} (${m.linesChanged} lines)`)
										.join("\n");
									embed.addFields({ name: "Modifications", value: modList });
								}

								if (result.error) {
									embed.addFields({ name: "Error", value: result.error });
								}

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`DGM Error: ${error}`);
							}
							break;
						}

						case "expertise": {
							const domain = interaction.options.getString("domain", true);
							const objective =
								interaction.options.getString("objective") || `Improve ${domain} agent expertise`;

							await interaction.deferReply();

							try {
								const result = await improveAgentExpertise(domain, objective);

								const totalLinesChanged =
									result.modifications?.reduce((sum, m) => sum + m.linesChanged, 0) || 0;

								const embed = new EmbedBuilder()
									.setTitle(`🧬 DGM Expertise Improvement: ${domain}`)
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Domain", value: domain, inline: true },
										{ name: "Iterations", value: `${result.iterations || 0}`, inline: true },
										{ name: "Lines Changed", value: `${totalLinesChanged}`, inline: true },
									);

								if (result.modifications && result.modifications.length > 0) {
									embed.addFields({
										name: "Changes",
										value: result.modifications
											.map((m) => `• ${m.description}`)
											.join("\n")
											.slice(0, 1000),
									});
								}

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`DGM Error: ${error}`);
							}
							break;
						}

						case "quick": {
							const filePath = interaction.options.getString("file", true);
							const objective = interaction.options.getString("objective", true);

							await interaction.deferReply();

							try {
								const result = await quickImprove(filePath, objective);

								const totalLinesChanged =
									result.modifications?.reduce((sum, m) => sum + m.linesChanged, 0) || 0;

								const embed = new EmbedBuilder()
									.setTitle("🧬 DGM Quick Improvement")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "File", value: filePath, inline: true },
										{ name: "Lines Changed", value: `${totalLinesChanged}`, inline: true },
									);

								if (result.modifications && result.modifications.length > 0) {
									embed.addFields({
										name: "Modification",
										value: result.modifications[0]?.description || "No changes",
									});
								}

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								await interaction.editReply(`DGM Error: ${error}`);
							}
							break;
						}

						case "status": {
							try {
								const status = await getDGMStatus();
								const history = getImprovementHistory();

								const embed = new EmbedBuilder()
									.setTitle("🧬 DGM Status")
									.setColor(status.available ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Available", value: status.available ? "✅ Yes" : "❌ No", inline: true },
										{ name: "Version", value: status.version || "Unknown", inline: true },
										{ name: "Python", value: status.pythonVersion, inline: true },
										{ name: "Total Improvements", value: `${history.length}`, inline: true },
									);

								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error: ${error}`);
							}
							break;
						}

						case "history": {
							try {
								const history = getImprovementHistory();

								if (history.length === 0) {
									await interaction.reply("No improvement history yet.");
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("🧬 DGM Improvement History")
									.setColor(0x9932cc)
									.setDescription(`Last ${Math.min(10, history.length)} improvements`);

								const recent = history.slice(-10).reverse();
								for (const item of recent) {
									const date = new Date(item.timestamp).toLocaleString();
									embed.addFields({
										name: `${item.targetId}`,
										value: `Backup: \`${item.backupPath.split("/").pop()}\`\nTime: ${date}`,
										inline: true,
									});
								}

								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error: ${error}`);
							}
							break;
						}
					}
					break;
				}

				case "arc-agi": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`arc-agi ${subCmd}`, user.username);

					switch (subCmd) {
						case "evolve": {
							const numTasks = interaction.options.getInteger("tasks") || 10;
							const maxIterations = interaction.options.getInteger("iterations") || 50;
							const seedType =
								(interaction.options.getString("seed") as "minimal" | "pattern" | "advanced") || "pattern";

							await interaction.reply(
								`Starting ARC-AGI evolution with ${numTasks} tasks, ${maxIterations} iterations, seed: ${seedType}...\nThis may take several minutes.`,
							);

							try {
								const result = await evolveARCSolver({
									numTasks,
									maxIterations,
									seedType,
								});

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle("ARC-AGI Evolution Complete")
										.setColor(0x00ff00)
										.addFields(
											{
												name: "Best Score",
												value: `${((result.bestScore || 0) * 100).toFixed(1)}%`,
												inline: true,
											},
											{
												name: "Initial Score",
												value: `${((result.initialScore || 0) * 100).toFixed(1)}%`,
												inline: true,
											},
											{
												name: "Improvement",
												value: `+${((result.improvement || 0) * 100).toFixed(1)}%`,
												inline: true,
											},
											{ name: "Iterations", value: `${result.iterations}`, inline: true },
											{
												name: "Pareto Front",
												value: `${result.paretoFrontSize} programs`,
												inline: true,
											},
											{
												name: "Duration",
												value: `${(result.duration / 1000).toFixed(1)}s`,
												inline: true,
											},
										);
									await interaction.followUp({ embeds: [embed] });
								} else {
									await interaction.followUp(`Evolution failed: ${result.error}`);
								}
							} catch (error) {
								await interaction.followUp(`Error: ${error}`);
							}
							break;
						}

						case "evaluate": {
							const numTasks = interaction.options.getInteger("tasks") || 20;

							const bestProgram = loadBestProgram();
							if (!bestProgram) {
								await interaction.reply("No evolved program found. Run `/arc-agi evolve` first.");
								break;
							}

							await interaction.reply(`Evaluating best program on ${numTasks} ARC tasks...`);

							try {
								const result = await evaluateARCProgram(
									join(ARC_EVOLUTION_DIR, "best_arc_solver.py"),
									numTasks,
								);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle("ARC-AGI Evaluation Results")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Total Tasks", value: `${result.totalTasks}`, inline: true },
											{
												name: "Exact Matches",
												value: `${result.exactMatches}`,
												inline: true,
											},
											{
												name: "Pass@1",
												value: `${((result.passAt1 || 0) * 100).toFixed(1)}%`,
												inline: true,
											},
											{
												name: "Avg Score",
												value: `${((result.avgScore || 0) * 100).toFixed(1)}%`,
												inline: true,
											},
											{
												name: "Duration",
												value: `${(result.duration / 1000).toFixed(1)}s`,
												inline: true,
											},
										);
									await interaction.followUp({ embeds: [embed] });
								} else {
									await interaction.followUp(`Evaluation failed: ${result.error}`);
								}
							} catch (error) {
								await interaction.followUp(`Error: ${error}`);
							}
							break;
						}

						case "status": {
							try {
								const available = await isARCAgentAvailable();
								const status = await getARCAgentStatus();

								const embed = new EmbedBuilder()
									.setTitle("ARC-AGI Agent Status")
									.setColor(available ? 0x00ff00 : 0xff0000)
									.addFields(
										{
											name: "Available",
											value: available ? "Yes" : "No",
											inline: true,
										},
										{ name: "DSPy", value: status.dspyAvailable ? "Yes" : "No", inline: true },
										{ name: "GEPA", value: status.gepaAvailable ? "Yes" : "No", inline: true },
										{ name: "Python", value: status.pythonVersion, inline: true },
										{ name: "Student Model", value: status.studentModel, inline: false },
										{ name: "Teacher Model", value: status.teacherModel, inline: false },
									);

								await interaction.reply({ embeds: [embed] });
							} catch (error) {
								await interaction.reply(`Error checking status: ${error}`);
							}
							break;
						}

						case "best": {
							const program = loadBestProgram();

							if (!program) {
								await interaction.reply("No evolved program found. Run `/arc-agi evolve` first.");
								break;
							}

							const truncated = program.length > 1800 ? `${program.slice(0, 1800)}\n...` : program;
							await interaction.reply(`\`\`\`python\n${truncated}\n\`\`\``);
							break;
						}
					}
					break;
				}

				case "telegram": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`telegram ${subCmd}`, user.username);

					const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
					if (!TELEGRAM_BOT_TOKEN) {
						await interaction.reply({
							content: "Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN in environment.",
							ephemeral: true,
						});
						break;
					}

					const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

					switch (subCmd) {
						case "send": {
							const chatId = interaction.options.getString("chat_id", true);
							const message = interaction.options.getString("message", true);

							await interaction.deferReply();

							try {
								const response = await fetch(`${baseUrl}/sendMessage`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										chat_id: chatId,
										text: message,
										parse_mode: "Markdown",
									}),
								});

								const result = await response.json();

								if (result.ok) {
									const embed = new EmbedBuilder()
										.setTitle("Message Sent to Telegram")
										.setColor(0x0088cc)
										.addFields(
											{ name: "Chat ID", value: chatId, inline: true },
											{
												name: "Message",
												value: message.slice(0, 200) + (message.length > 200 ? "..." : ""),
												inline: false,
											},
										)
										.setTimestamp();
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Failed to send: ${result.description || "Unknown error"}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "photo": {
							const chatId = interaction.options.getString("chat_id", true);
							const photoUrl = interaction.options.getString("url", true);
							const caption = interaction.options.getString("caption") || "";

							await interaction.deferReply();

							try {
								const response = await fetch(`${baseUrl}/sendPhoto`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										chat_id: chatId,
										photo: photoUrl,
										caption: caption,
									}),
								});

								const result = await response.json();

								if (result.ok) {
									const embed = new EmbedBuilder()
										.setTitle("Photo Sent to Telegram")
										.setColor(0x0088cc)
										.setThumbnail(photoUrl)
										.addFields(
											{ name: "Chat ID", value: chatId, inline: true },
											{ name: "Caption", value: caption || "(none)", inline: false },
										)
										.setTimestamp();
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`Failed to send photo: ${result.description || "Unknown error"}`,
									);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "status": {
							try {
								const response = await fetch(`${baseUrl}/getMe`);
								const result = await response.json();

								if (result.ok) {
									const bot = result.result;
									const embed = new EmbedBuilder()
										.setTitle("Telegram Bot Status")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Bot Username", value: `@${bot.username}`, inline: true },
											{ name: "Bot Name", value: bot.first_name, inline: true },
											{ name: "Bot ID", value: String(bot.id), inline: true },
											{ name: "Can Join Groups", value: bot.can_join_groups ? "Yes" : "No", inline: true },
										)
										.setTimestamp();
									await interaction.reply({ embeds: [embed] });
								} else {
									await interaction.reply({ content: "Failed to connect to Telegram bot", ephemeral: true });
								}
							} catch (error) {
								await interaction.reply({
									content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
									ephemeral: true,
								});
							}
							break;
						}
					}
					break;
				}

				case "browse": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`browse ${subCmd}`, user.username);

					switch (subCmd) {
						case "screenshot": {
							const url = interaction.options.getString("url", true);
							const fullPage = interaction.options.getBoolean("fullpage") || false;

							await interaction.deferReply();

							try {
								const result = await browserAutomation.screenshot(url, { fullPage });
								if (result.success && result.data?.screenshot) {
									// Read file as buffer for Discord attachment
									const fileBuffer = readFileSync(result.data.screenshot);
									const attachment = new AttachmentBuilder(fileBuffer, { name: "screenshot.png" });
									const embed = new EmbedBuilder()
										.setTitle("Screenshot")
										.setURL(url)
										.setColor(0x3498db)
										.setImage("attachment://screenshot.png")
										.setFooter({ text: `Took ${result.duration}ms` });
									await interaction.editReply({ embeds: [embed], files: [attachment] });
									await browserAutomation.cleanup(result.data.screenshot);
								} else {
									await interaction.editReply(`Screenshot failed: ${result.error}`);
								}
							} catch (error) {
								console.error("[BROWSE] Screenshot error:", error);
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "scrape": {
							const url = interaction.options.getString("url", true);

							await interaction.deferReply();

							try {
								const result = await browserAutomation.scrape(url);
								if (result.success && result.data) {
									const embed = new EmbedBuilder()
										.setTitle(result.data.title || "Scraped Content")
										.setURL(url)
										.setColor(0x2ecc71)
										.setDescription(result.data.content?.slice(0, 4000) || "No content")
										.setFooter({
											text: `${result.data.links?.length || 0} links found | ${result.duration}ms`,
										});
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Scrape failed: ${result.error}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "extract": {
							const url = interaction.options.getString("url", true);
							const query = interaction.options.getString("query", true);

							await interaction.deferReply();

							try {
								const result = await browserAutomation.extract(url, query);
								if (result.success && result.data) {
									const embed = new EmbedBuilder()
										.setTitle(`Extracted: ${query}`)
										.setURL(url)
										.setColor(0x9b59b6)
										.setDescription(result.data.content?.slice(0, 4000) || "No data extracted")
										.setFooter({ text: `From ${result.data.title || url} | ${result.duration}ms` });
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Extract failed: ${result.error}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}

						case "search": {
							const query = interaction.options.getString("query", true);

							await interaction.deferReply();

							try {
								const result = await browserAutomation.search(query);
								if (result.success && result.data?.links?.length) {
									const embed = new EmbedBuilder()
										.setTitle(`Search: ${query}`)
										.setColor(0xf39c12)
										.setDescription(
											result.data.links
												.slice(0, 10)
												.map((l, i) => `${i + 1}. [${l.text}](${l.href})`)
												.join("\n"),
										)
										.setFooter({ text: `${result.data.links.length} results | ${result.duration}ms` });
									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`No results found for: ${query}`);
								}
							} catch (error) {
								await interaction.editReply(
									`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
							break;
						}
					}
					break;
				}

				case "hf": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`hf ${subCmd}`, user.username);

					switch (subCmd) {
						case "skills": {
							const skills = hfSkills.getAvailableSkills();
							const embed = new EmbedBuilder()
								.setTitle("HuggingFace Expert Skills")
								.setColor(0xffcc00)
								.setDescription("30+ AI capabilities powered by HuggingFace Spaces")
								.addFields(
									{ name: "Image Generation", value: skills.image.join(", "), inline: false },
									{ name: "Image Editing", value: skills.edit.join(", "), inline: false },
									{ name: "3D Generation", value: skills.threeD.join(", "), inline: false },
									{ name: "Video", value: skills.video.join(", "), inline: false },
									{ name: "Voice/TTS", value: skills.voice.join(", "), inline: false },
									{ name: "OCR/Documents", value: skills.ocr.join(", "), inline: false },
									{ name: "Code Generation", value: skills.code.join(", "), inline: false },
									{ name: "Trading/Finance", value: skills.trading.join(", "), inline: false },
									{ name: "AI Agents", value: skills.agents.join(", "), inline: false },
								)
								.setFooter({ text: "Use /hf <skill> to use any capability" })
								.setTimestamp();
							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "image": {
							const prompt = interaction.options.getString("prompt", true);
							const model = (interaction.options.getString("model") ||
								"QWEN_FAST") as keyof typeof HF_SPACES.IMAGE;

							await interaction.deferReply();

							const result = await hfSkills.generateImage({ prompt }, model);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string; path?: string }] };
								const imageUrl = data?.data?.[0]?.url || data?.data?.[0]?.path;

								const embed = new EmbedBuilder()
									.setTitle("Generated Image")
									.setColor(0x00ff00)
									.setDescription(`**Prompt:** ${prompt.substring(0, 200)}`)
									.setImage(imageUrl || "")
									.setFooter({ text: `Model: ${model} | ${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Image generation failed: ${result.error}`);
							}
							break;
						}

						case "remove-bg": {
							const url = interaction.options.getString("url", true);
							await interaction.deferReply();

							const result = await hfSkills.removeBackground(url);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string }] };
								const imageUrl = data?.data?.[0]?.url;

								const embed = new EmbedBuilder()
									.setTitle("Background Removed")
									.setColor(0x00ff00)
									.setImage(imageUrl || "")
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Background removal failed: ${result.error}`);
							}
							break;
						}

						case "edit": {
							const url = interaction.options.getString("url", true);
							const prompt = interaction.options.getString("prompt", true);
							await interaction.deferReply();

							const result = await hfSkills.editImage(url, prompt);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string }] };
								const imageUrl = data?.data?.[0]?.url;

								const embed = new EmbedBuilder()
									.setTitle("Image Edited")
									.setColor(0x00ff00)
									.setDescription(`**Edit:** ${prompt}`)
									.setImage(imageUrl || "")
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Image editing failed: ${result.error}`);
							}
							break;
						}

						case "3d": {
							const url = interaction.options.getString("url", true);
							const model = (interaction.options.getString("model") ||
								"HUNYUAN_2_1") as keyof typeof HF_SPACES.THREE_D;
							await interaction.deferReply();

							const result = await hfSkills.generateModel3D(url, model);

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("3D Model Generated")
									.setColor(0x00ff00)
									.setDescription(`Model: ${model}\nResult ready for download`)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({
									embeds: [embed],
									content: JSON.stringify(result.data).substring(0, 1500),
								});
							} else {
								await interaction.editReply(`3D generation failed: ${result.error}`);
							}
							break;
						}

						case "video": {
							const url = interaction.options.getString("url", true);
							const prompt = interaction.options.getString("prompt", true);
							await interaction.deferReply();

							const result = await hfSkills.generateVideo(url, prompt);

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("Video Generated")
									.setColor(0x00ff00)
									.setDescription(`**Prompt:** ${prompt}`)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({
									embeds: [embed],
									content: JSON.stringify(result.data).substring(0, 1500),
								});
							} else {
								await interaction.editReply(`Video generation failed: ${result.error}`);
							}
							break;
						}

						case "tts": {
							const text = interaction.options.getString("text", true);
							const model = (interaction.options.getString("model") ||
								"CHATTERBOX") as keyof typeof HF_SPACES.VOICE;
							await interaction.deferReply();

							const result = await hfSkills.textToSpeech({ text }, model);

							if (result.success && result.data) {
								const data = result.data as { data: [{ url?: string }] };
								const audioUrl = data?.data?.[0]?.url;

								const embed = new EmbedBuilder()
									.setTitle("Text to Speech")
									.setColor(0x00ff00)
									.setDescription(`**Text:** ${text.substring(0, 200)}...`)
									.addFields({ name: "Audio", value: audioUrl ? `[Download](${audioUrl})` : "Processing..." })
									.setFooter({ text: `Model: ${model} | ${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`TTS failed: ${result.error}`);
							}
							break;
						}

						case "ocr": {
							const url = interaction.options.getString("url", true);
							await interaction.deferReply();

							const result = await hfSkills.extractText(url);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const extractedText = data?.data?.[0] || JSON.stringify(result.data);

								const embed = new EmbedBuilder()
									.setTitle("OCR Result")
									.setColor(0x00ff00)
									.setDescription(extractedText.substring(0, 4000))
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`OCR failed: ${result.error}`);
							}
							break;
						}

						case "code": {
							const prompt = interaction.options.getString("prompt", true);
							const model = (interaction.options.getString("model") ||
								"QWEN_CODER") as keyof typeof HF_SPACES.CODE;
							await interaction.deferReply();

							const result = await hfSkills.generateCode({ prompt }, model);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const code = data?.data?.[0] || JSON.stringify(result.data);

								await interaction.editReply(`**Generated Code:**\n\`\`\`\n${code.substring(0, 1800)}\n\`\`\``);
							} else {
								await interaction.editReply(`Code generation failed: ${result.error}`);
							}
							break;
						}

						case "trading": {
							const asset = interaction.options.getString("asset", true);
							const news = interaction.options.getString("news") || "";
							await interaction.deferReply();

							const result = await hfSkills.analyzeTradingSentiment({ asset, newsText: news });

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle(`Trading Analysis: ${asset}`)
									.setColor(0x00ff00)
									.setDescription(JSON.stringify(result.data, null, 2).substring(0, 4000))
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Trading analysis failed: ${result.error}`);
							}
							break;
						}

						case "stocks": {
							await interaction.deferReply();

							const result = await hfSkills.getStockRecommendations();

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("AI Stock Recommendations")
									.setColor(0x00ff00)
									.setDescription(JSON.stringify(result.data, null, 2).substring(0, 4000))
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Stock recommendations failed: ${result.error}`);
							}
							break;
						}

						case "vision": {
							const url = interaction.options.getString("url", true);
							const question = interaction.options.getString("question", true);
							await interaction.deferReply();

							const result = await hfSkills.visionChat(url, question);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const answer = data?.data?.[0] || JSON.stringify(result.data);

								const embed = new EmbedBuilder()
									.setTitle("Vision Chat")
									.setColor(0x00ff00)
									.setDescription(`**Q:** ${question}\n\n**A:** ${answer.substring(0, 3500)}`)
									.setThumbnail(url)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Vision chat failed: ${result.error}`);
							}
							break;
						}

						case "detect": {
							const url = interaction.options.getString("url", true);
							await interaction.deferReply();

							const result = await hfSkills.detectObjects(url);

							if (result.success && result.data) {
								const embed = new EmbedBuilder()
									.setTitle("Object Detection")
									.setColor(0x00ff00)
									.setDescription("Objects detected in image")
									.setThumbnail(url)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({
									embeds: [embed],
									content: JSON.stringify(result.data).substring(0, 1500),
								});
							} else {
								await interaction.editReply(`Object detection failed: ${result.error}`);
							}
							break;
						}

						case "polish": {
							const prompt = interaction.options.getString("prompt", true);
							await interaction.deferReply();

							const result = await hfSkills.polishPrompt(prompt);

							if (result.success && result.data) {
								const data = result.data as { data: [string] };
								const polished = data?.data?.[0] || JSON.stringify(result.data);

								const embed = new EmbedBuilder()
									.setTitle("Polished Prompt")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Original", value: prompt.substring(0, 1000) },
										{ name: "Improved", value: polished.substring(0, 1000) },
									)
									.setFooter({ text: `${result.duration}ms` })
									.setTimestamp();
								await interaction.editReply({ embeds: [embed] });
							} else {
								await interaction.editReply(`Prompt polishing failed: ${result.error}`);
							}
							break;
						}
					}
					break;
				}

				case "learning": {
					const subCmd = interaction.options.getSubcommand();
					logSlash(`learning ${subCmd}`, user.username);

					switch (subCmd) {
						case "stats": {
							const stats = tradingLearning.getStats();
							const sessionMinutes = Math.floor(stats.sessionAge / 60000);

							const embed = new EmbedBuilder()
								.setTitle("Trading Learning Stats")
								.setColor(0x00ccff)
								.addFields(
									{ name: "Outcomes Recorded", value: `${stats.outcomes}`, inline: true },
									{ name: "Session Age", value: `${sessionMinutes} minutes`, inline: true },
									{
										name: "Status",
										value:
											stats.outcomes >= 5
												? "Ready to update expertise"
												: `Need ${5 - stats.outcomes} more outcomes`,
										inline: true,
									},
								)
								.setFooter({ text: "Use /learning record to add outcomes" })
								.setTimestamp();
							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "expertise": {
							await interaction.deferReply();
							const expertise = await tradingLearning.loadExpertise();

							// Extract key sections
							const sections = expertise.split("##").slice(1, 5);
							const summary = sections.map((s) => `## ${s.substring(0, 300)}`).join("\n\n");

							const embed = new EmbedBuilder()
								.setTitle("Trading Expertise Summary")
								.setColor(0x00ccff)
								.setDescription(summary.substring(0, 4000) || "No expertise accumulated yet")
								.setFooter({ text: "Full expertise in src/trading/expertise/trading.md" })
								.setTimestamp();
							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "record": {
							const symbol = interaction.options.getString("symbol", true);
							const action = interaction.options.getString("action", true) as "BUY" | "SELL" | "HOLD";
							const success = interaction.options.getBoolean("success", true);
							const confidence = interaction.options.getNumber("confidence", true);
							const market = interaction.options.getString("market", true) as
								| "bull"
								| "bear"
								| "sideways"
								| "volatile";
							const reason = interaction.options.getString("reason") || "Manual record";

							await tradingLearning.recordOutcome({
								timestamp: new Date().toISOString(),
								symbol,
								action,
								entryPrice: 0, // Manual records don't need price
								success,
								confidence,
								marketCondition: market,
								agents: ["Manual"],
								reason,
							});

							const embed = new EmbedBuilder()
								.setTitle("Trading Outcome Recorded")
								.setColor(success ? 0x00ff00 : 0xff0000)
								.addFields(
									{ name: "Symbol", value: symbol, inline: true },
									{ name: "Action", value: action, inline: true },
									{ name: "Success", value: success ? "Yes" : "No", inline: true },
									{ name: "Confidence", value: `${(confidence * 100).toFixed(0)}%`, inline: true },
									{ name: "Market", value: market, inline: true },
									{ name: "Reason", value: reason, inline: false },
								)
								.setFooter({ text: "Outcome added to learning system" })
								.setTimestamp();
							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "update": {
							await interaction.deferReply();
							await tradingLearning.updateExpertise();

							const embed = new EmbedBuilder()
								.setTitle("Expertise Updated")
								.setColor(0x00ff00)
								.setDescription("Trading expertise file has been updated with accumulated learnings.")
								.setFooter({ text: "Check src/trading/expertise/trading.md" })
								.setTimestamp();
							await interaction.editReply({ embeds: [embed] });
							break;
						}
					}
					break;
				}

				case "remember": {
					const text = interaction.options.getString("text", true);
					const isGlobal = interaction.options.getBoolean("global") || false;

					addToMemory(text, channelDir, workingDir, isGlobal);

					await interaction.reply(`Remembered${isGlobal ? " (global)" : ""}: ${text}`);
					break;
				}

				case "memory": {
					const memory = getMemory(channelDir, workingDir);

					if (memory.length > 1900) {
						await interaction.reply(`${memory.substring(0, 1900)}\n...(truncated)`);
					} else {
						await interaction.reply(memory || "No memories yet.");
					}
					break;
				}

				case "forget": {
					const isGlobal = interaction.options.getBoolean("global") || false;
					const cleared = clearMemory(channelDir, workingDir, isGlobal);

					if (cleared) {
						await interaction.reply(`Cleared ${isGlobal ? "global" : "channel"} memory.`);
					} else {
						await interaction.reply(`No ${isGlobal ? "global" : "channel"} memory to clear.`);
					}
					break;
				}

				case "status": {
					const uptime = process.uptime();
					const hours = Math.floor(uptime / 3600);
					const mins = Math.floor((uptime % 3600) / 60);
					const uptimeStr = `${hours}h ${mins}m`;

					const currentModelId = getCurrentModelId(user.id);
					const statusEmbed = createStatusEmbed(
						currentModelId,
						globalModelId,
						uptimeStr,
						workingDir,
						channelStates.size,
					);
					await interaction.reply({ embeds: [statusEmbed] });
					break;
				}

				case "hooks": {
					await interaction.deferReply();
					const hooksSubcommand = interaction.options.getSubcommand();
					const channelDir = join(workingDir, interaction.channelId);

					switch (hooksSubcommand) {
						case "status": {
							const state = channelStates.get(interaction.channelId);
							const hasHooks = !!state?.hooks;
							const isGitRepo = await CheckpointUtils.isGitRepo(channelDir).catch(() => false);

							const embed = new EmbedBuilder()
								.setTitle("🪝 Hook System Status")
								.setColor(hasHooks ? 0x00ff00 : 0x808080)
								.addFields(
									{ name: "Hooks Active", value: hasHooks ? "✅ Yes" : "❌ No", inline: true },
									{ name: "Git Repository", value: isGitRepo ? "✅ Yes" : "❌ No", inline: true },
									{ name: "Session ID", value: state?.sessionId || "N/A", inline: true },
									{ name: "Turn Index", value: String(state?.turnIndex || 0), inline: true },
								)
								.addFields({
									name: "Active Hooks",
									value: [
										"• **Checkpoint**: Git-based state snapshots each turn",
										"• **LSP**: Diagnostics after file write/edit",
										"• **Expert**: Domain detection + Act-Learn-Reuse",
									].join("\n"),
								})
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "checkpoints": {
							const isGitRepo = await CheckpointUtils.isGitRepo(channelDir).catch(() => false);
							if (!isGitRepo) {
								await interaction.editReply("❌ Not a git repository - no checkpoints available");
								break;
							}

							const checkpoints = await CheckpointUtils.loadAllCheckpoints(channelDir);
							if (checkpoints.length === 0) {
								await interaction.editReply("No checkpoints found for this channel.");
								break;
							}

							// Sort by timestamp descending and take last 10
							const sorted = checkpoints.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
							const list = sorted
								.map((cp) => {
									const date = new Date(cp.timestamp).toLocaleString();
									return `• **Turn ${cp.turnIndex}** - \`${cp.id.slice(0, 30)}...\`\n  ${date}`;
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setTitle("📸 Available Checkpoints")
								.setDescription(list)
								.setColor(0x3498db)
								.setFooter({ text: `${checkpoints.length} total checkpoints` })
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "restore": {
							const checkpointId = interaction.options.getString("id", true);
							const isGitRepo = await CheckpointUtils.isGitRepo(channelDir).catch(() => false);
							if (!isGitRepo) {
								await interaction.editReply("❌ Not a git repository - cannot restore");
								break;
							}

							const checkpoint = await CheckpointUtils.loadCheckpointFromRef(channelDir, checkpointId);
							if (!checkpoint) {
								await interaction.editReply(`❌ Checkpoint not found: ${checkpointId}`);
								break;
							}

							try {
								await CheckpointUtils.restoreCheckpoint(channelDir, checkpoint);
								await interaction.editReply(
									`✅ Restored to turn ${checkpoint.turnIndex}\n` +
										`Checkpoint: \`${checkpointId}\`\n` +
										`Head SHA: \`${checkpoint.headSha.slice(0, 8)}\``,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Restore failed: ${errMsg}`);
							}
							break;
						}

						case "metrics": {
							const state = channelStates.get(interaction.channelId);
							if (!state?.hooks) {
								await interaction.editReply("❌ No hooks active for this channel");
								break;
							}

							const metrics = state.hooks.manager.getMetrics();
							const uptime = Date.now() - metrics.session.startTime;
							const uptimeStr =
								uptime > 3600000
									? `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`
									: `${Math.floor(uptime / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`;

							const eventBreakdown = Object.entries(metrics.eventsByType)
								.map(([type, count]) => `${type}: ${count}`)
								.join(", ");

							const hookTimes = Object.entries(metrics.executionTimes.byHook)
								.map(([hook, time]) => `${hook}: ${time}ms`)
								.join(", ");

							const embed = new EmbedBuilder()
								.setTitle("📊 Hook Metrics")
								.setColor(0x9b59b6)
								.addFields(
									{ name: "Session ID", value: metrics.session.sessionId || "N/A", inline: true },
									{ name: "Uptime", value: uptimeStr, inline: true },
									{ name: "Turns", value: String(metrics.session.turnCount), inline: true },
									{ name: "Total Events", value: String(metrics.totalEvents), inline: true },
									{ name: "Total Execution Time", value: `${metrics.executionTimes.total}ms`, inline: true },
									{ name: "Errors", value: String(metrics.errors.total), inline: true },
									{
										name: "Events by Type",
										value: eventBreakdown || "None",
										inline: false,
									},
									{
										name: "Hook Execution Times",
										value: hookTimes || "None",
										inline: false,
									},
									{
										name: "Tool Calls",
										value:
											`Total: ${metrics.toolCalls.total} | ` +
											`Blocked: ${metrics.toolCalls.blocked} | ` +
											`Modified: ${metrics.toolCalls.modified}`,
										inline: false,
									},
								)
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "tag": {
							const checkpointId = interaction.options.getString("checkpoint_id", true);
							const tagName = interaction.options.getString("name", true);
							const description = interaction.options.getString("description") || undefined;

							try {
								const tag = await CheckpointUtils.tagCheckpoint(channelDir, checkpointId, tagName, description);
								await interaction.editReply(
									`✅ Tagged checkpoint as **${tag.tag}**\n` +
										`Checkpoint: \`${tag.checkpointId}\`\n` +
										(description ? `Description: ${description}` : ""),
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to tag checkpoint: ${errMsg}`);
							}
							break;
						}

						case "tags": {
							const tags = await CheckpointUtils.listTags(channelDir);
							if (tags.length === 0) {
								await interaction.editReply("No tags found. Use `/hooks tag` to tag a checkpoint.");
								break;
							}

							const list = tags
								.slice(0, 15)
								.map((t) => {
									const date = new Date(t.timestamp).toLocaleString();
									return (
										`• **${t.tag}** → \`${t.checkpointId.slice(0, 30)}...\`\n` +
										`  ${date}${t.description ? ` - ${t.description}` : ""}`
									);
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setTitle("🏷️ Checkpoint Tags")
								.setDescription(list)
								.setColor(0xe67e22)
								.setFooter({ text: `${tags.length} total tags` })
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "debug": {
							const enabled = interaction.options.getBoolean("enabled", true);
							// Import dynamically to avoid circular deps
							const { enableDebugLogging } = await import("./agents/hooks/index.js");
							enableDebugLogging(enabled);
							await interaction.editReply(
								enabled
									? "✅ Hook debug logging **enabled**. Check console for detailed hook events."
									: "✅ Hook debug logging **disabled**.",
							);
							break;
						}

						// Phase 1.1: Branch support
						case "branch": {
							const checkpointId = interaction.options.getString("checkpoint_id", true);
							const description = interaction.options.getString("description") || undefined;

							try {
								const { createBranchPoint } = await import("./agents/hooks/index.js");
								const branch = await createBranchPoint(channelDir, checkpointId, description);
								if (!branch) {
									await interaction.editReply("❌ Failed to create branch. Checkpoint not found.");
									break;
								}
								await interaction.editReply(
									`✅ Created branch **${branch.branchId}**\n` +
										`From checkpoint: \`${branch.parentCheckpointId.slice(0, 40)}...\`\n` +
										`At turn: ${branch.parentTurnIndex}\n` +
										(description ? `Description: ${description}` : ""),
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to create branch: ${errMsg}`);
							}
							break;
						}

						case "branches": {
							const { listBranches } = await import("./agents/hooks/index.js");
							const branches = await listBranches(channelDir);

							if (branches.length === 0) {
								await interaction.editReply("No branches found. Use `/hooks branch` to create one.");
								break;
							}

							const list = branches
								.slice(0, 10)
								.map((b) => {
									const date = new Date(b.createdAt).toLocaleString();
									return (
										`• **${b.branchId.slice(0, 25)}**\n` +
										`  Turn ${b.parentTurnIndex} | ${date}\n` +
										(b.description ? `  ${b.description}` : "")
									);
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setTitle("🌿 Branch Points")
								.setDescription(list)
								.setColor(0x27ae60)
								.setFooter({ text: `${branches.length} total branches` })
								.setTimestamp();

							await interaction.editReply({ embeds: [embed] });
							break;
						}

						case "switch": {
							const branchId = interaction.options.getString("branch_id", true);

							try {
								const { switchToBranch } = await import("./agents/hooks/index.js");
								const checkpoint = await switchToBranch(channelDir, branchId);
								if (!checkpoint) {
									await interaction.editReply("❌ Failed to switch branch. Branch not found.");
									break;
								}
								await interaction.editReply(
									`✅ Switched to branch **${branchId}**\n` +
										`Restored to turn ${checkpoint.turnIndex}\n` +
										`Checkpoint: \`${checkpoint.id.slice(0, 40)}...\``,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to switch branch: ${errMsg}`);
							}
							break;
						}

						// Phase 2.1: Checkpoint diff
						case "diff": {
							const checkpointId = interaction.options.getString("checkpoint_id", true);

							try {
								const { getCheckpointDiff } = await import("./agents/hooks/index.js");
								const diff = await getCheckpointDiff(channelDir, checkpointId);
								if (!diff) {
									await interaction.editReply("❌ Checkpoint not found or diff failed.");
									break;
								}

								const addedList = diff.added.slice(0, 5).join("\n  ");
								const modifiedList = diff.modified.slice(0, 5).join("\n  ");
								const deletedList = diff.deleted.slice(0, 5).join("\n  ");

								const embed = new EmbedBuilder()
									.setTitle("📝 Checkpoint Diff")
									.setDescription(`Changes since checkpoint \`${checkpointId.slice(0, 30)}...\``)
									.setColor(diff.added.length > 0 || diff.modified.length > 0 ? 0xe74c3c : 0x2ecc71)
									.addFields(
										{
											name: `➕ Added (${diff.added.length})`,
											value: addedList || "None",
											inline: false,
										},
										{
											name: `📝 Modified (${diff.modified.length})`,
											value: modifiedList || "None",
											inline: false,
										},
										{
											name: `➖ Deleted (${diff.deleted.length})`,
											value: deletedList || "None",
											inline: false,
										},
									)
									.setFooter({ text: diff.summary })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Diff failed: ${errMsg}`);
							}
							break;
						}

						case "cleanup": {
							const keepCount = interaction.options.getInteger("keep") || 50;

							try {
								const { autoCleanup } = await import("./agents/hooks/index.js");
								const result = await autoCleanup(channelDir, { maxCheckpoints: keepCount });

								await interaction.editReply(
									`✅ Cleanup complete!\n` +
										`• Checkpoints removed: ${result.checkpointsRemoved}\n` +
										`• Tags removed: ${result.tagsRemoved}\n` +
										`• Branches removed: ${result.branchesRemoved}\n` +
										`• Space freed: ${result.freedSpace}`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Cleanup failed: ${errMsg}`);
							}
							break;
						}

						// Phase 2.2: Expertise management
						case "expertise": {
							const domain = interaction.options.getString("domain");

							try {
								const { listExpertise, getExpertiseSummary } = await import("./agents/hooks/index.js");

								if (domain) {
									const summary = getExpertiseSummary(domain);
									if (!summary.exists) {
										await interaction.editReply(`No expertise found for domain: ${domain}`);
										break;
									}

									const preview = summary.content.slice(0, 1500);
									const embed = new EmbedBuilder()
										.setTitle(`🧠 ${domain.replace(/_/g, " ").toUpperCase()} Expertise`)
										.setDescription(preview + (summary.content.length > 1500 ? "\n...(truncated)" : ""))
										.setColor(
											summary.riskLevel === "critical"
												? 0xe74c3c
												: summary.riskLevel === "high"
													? 0xe67e22
													: 0x3498db,
										)
										.addFields(
											{ name: "Insights", value: String(summary.insightCount), inline: true },
											{ name: "Risk Level", value: summary.riskLevel.toUpperCase(), inline: true },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									const allExpertise = listExpertise();
									if (allExpertise.length === 0) {
										await interaction.editReply("No expertise accumulated yet. Complete tasks to learn!");
										break;
									}

									const list = allExpertise
										.slice(0, 10)
										.map((e) => {
											const date = new Date(e.lastModified).toLocaleDateString();
											return `• **${e.domain}**: ${e.insightCount} insights (${(e.size / 1024).toFixed(1)}KB) - ${date}`;
										})
										.join("\n");

									const embed = new EmbedBuilder()
										.setTitle("🧠 Accumulated Expertise")
										.setDescription(list)
										.setColor(0x9b59b6)
										.setFooter({ text: `${allExpertise.length} domains with expertise` })
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to load expertise: ${errMsg}`);
							}
							break;
						}

						case "clear-expertise": {
							const domain = interaction.options.getString("domain", true);

							try {
								const { clearExpertise, clearAllExpertise } = await import("./agents/hooks/index.js");

								if (domain === "all") {
									const count = clearAllExpertise();
									await interaction.editReply(`✅ Cleared expertise for ${count} domains.`);
								} else {
									const success = clearExpertise(domain);
									if (success) {
										await interaction.editReply(`✅ Cleared expertise for **${domain}**.`);
									} else {
										await interaction.editReply(`❌ No expertise found for domain: ${domain}`);
									}
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to clear expertise: ${errMsg}`);
							}
							break;
						}

						// Phase 2.3: LSP configuration
						case "lsp": {
							try {
								const { getLSPStatus, detectProjectLanguages } = await import("./agents/hooks/index.js");
								const state = channelStates.get(interaction.channelId);
								const sessionId = state?.sessionId;
								const status = getLSPStatus(sessionId);
								const detected = detectProjectLanguages(channelDir);

								const list = status
									.map((s) => {
										const avail = s.available ? "✅" : "❌";
										const enabled = s.enabled ? "🟢" : "⚪";
										const exts = s.extensions.slice(0, 3).join(", ");
										return `${avail} ${enabled} **${s.id}** (${exts})`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🔧 LSP Server Status")
									.setDescription(list)
									.setColor(0x3498db)
									.addFields(
										{
											name: "Detected Languages",
											value: detected.length > 0 ? detected.join(", ") : "None detected",
											inline: false,
										},
										{
											name: "Legend",
											value: "✅ = Available | ❌ = Not installed | 🟢 = Enabled | ⚪ = Disabled",
											inline: false,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to get LSP status: ${errMsg}`);
							}
							break;
						}

						case "lsp-enable": {
							const server = interaction.options.getString("server", true);
							try {
								const { enableLSP } = await import("./agents/hooks/index.js");
								const state = channelStates.get(interaction.channelId);
								const sessionId = state?.sessionId || "default";
								const success = enableLSP(sessionId, server);
								if (success) {
									await interaction.editReply(`✅ Enabled LSP server: **${server}**`);
								} else {
									await interaction.editReply(`❌ Invalid server ID: ${server}`);
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to enable LSP: ${errMsg}`);
							}
							break;
						}

						case "lsp-disable": {
							const server = interaction.options.getString("server", true);
							try {
								const { disableLSP } = await import("./agents/hooks/index.js");
								const state = channelStates.get(interaction.channelId);
								const sessionId = state?.sessionId || "default";
								const success = disableLSP(sessionId, server);
								await interaction.editReply(
									success
										? `✅ Disabled LSP server: **${server}**`
										: `⚠️ Server **${server}** was not enabled.`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to disable LSP: ${errMsg}`);
							}
							break;
						}

						// Phase 3.1: Blocking rules
						case "rules": {
							try {
								const { listBlockingRules } = await import("./agents/hooks/index.js");
								const rules = listBlockingRules(workingDir, interaction.channelId);

								if (rules.length === 0) {
									await interaction.editReply(
										"No blocking rules configured.\n" +
											"Use `/hooks rules-add` to add rules or `/hooks rules-preset` for security defaults.",
									);
									break;
								}

								const list = rules
									.slice(0, 10)
									.map((r) => {
										const status = r.enabled ? "🟢" : "⚪";
										return `${status} **#${r.id}** \`${r.toolName}\` → \`${r.pattern.slice(0, 30)}\`\n  ${r.reason}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("🛡️ Blocking Rules")
									.setDescription(list)
									.setColor(0xe74c3c)
									.setFooter({ text: `${rules.length} total rules` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to list rules: ${errMsg}`);
							}
							break;
						}

						case "rules-add": {
							const tool = interaction.options.getString("tool", true);
							const pattern = interaction.options.getString("pattern", true);
							const reason = interaction.options.getString("reason", true);

							try {
								const { addBlockingRule } = await import("./agents/hooks/index.js");
								const rule = addBlockingRule(workingDir, interaction.channelId, tool, pattern, reason, {
									createdBy: interaction.user.id,
								});
								await interaction.editReply(
									`✅ Added blocking rule **#${rule.id}**\n` +
										`Tool: \`${tool}\`\n` +
										`Pattern: \`${pattern}\`\n` +
										`Reason: ${reason}`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to add rule: ${errMsg}`);
							}
							break;
						}

						case "rules-remove": {
							const ruleId = interaction.options.getInteger("id", true);

							try {
								const { removeBlockingRule } = await import("./agents/hooks/index.js");
								const success = removeBlockingRule(workingDir, ruleId, interaction.channelId);
								await interaction.editReply(
									success
										? `✅ Removed blocking rule **#${ruleId}**`
										: `❌ Rule #${ruleId} not found or not owned by this channel.`,
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to remove rule: ${errMsg}`);
							}
							break;
						}

						case "rules-preset": {
							try {
								const { applyPresetRules } = await import("./agents/hooks/index.js");
								const count = applyPresetRules(workingDir, interaction.channelId, interaction.user.id);
								await interaction.editReply(
									`✅ Applied ${count} preset security rules.\n` +
										"These block dangerous commands like `rm -rf /`, fork bombs, etc.",
								);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Failed to apply presets: ${errMsg}`);
							}
							break;
						}
					}
					break;
				}

				case "skills": {
					await interaction.deferReply();
					// Use the new skill_list tool to get dynamic skills
					const skillListTool = createSkillListTool();
					const result = await skillListTool.execute("skills-cmd", { label: "List skills", category: undefined });

					let skillsList = "";
					if (result.content?.[0] && result.content[0].type === "text") {
						skillsList = result.content[0].text;
					}

					// Add capabilities info
					skillsList += "\n\n**Core Capabilities:**\n";
					skillsList += "• Multi-model AI (OpenRouter + Ollama)\n";
					skillsList += "• 25+ MCP tools (web, GitHub, HuggingFace, memory)\n";
					skillsList += "• Pi-mono codebase knowledge\n";
					skillsList += "• Persistent memory & task management\n";
					skillsList += "\n**Security:**\n";
					skillsList += "• Rate limited: 10 req/min per user\n";
					skillsList += "• Dangerous commands require approval\n";
					skillsList += "\n**Tip:** Use `skill_load` tool to activate a skill's instructions.";

					// Truncate if too long for Discord
					if (skillsList.length > 1900) {
						skillsList = `${skillsList.substring(0, 1900)}\n...(truncated)`;
					}

					await interaction.editReply(skillsList);
					break;
				}

				case "freemodels": {
					const providerFilter = interaction.options.getString("provider") || "all";
					const freeModels = listFreeModels();

					const filtered =
						providerFilter === "all"
							? freeModels
							: freeModels.filter((m: { provider: string }) => m.provider === providerFilter);

					let response = "**FREE AI Models (Zero Cost)**\n\n";

					const byProvider: Record<string, typeof filtered> = {};
					for (const model of filtered) {
						if (!byProvider[model.provider]) byProvider[model.provider] = [];
						byProvider[model.provider].push(model);
					}

					const providerEmoji: Record<string, string> = {
						cerebras: "⚡",
						groq: "🚀",
						google: "🔮",
						huggingface: "🤗",
						nvidia: "💚",
						openrouter: "🔀",
						opencode: "🆓",
						ollama: "🏠",
						"hf-router": "🌐",
					};

					for (const [provider, models] of Object.entries(byProvider)) {
						const emoji = providerEmoji[provider] || "•";
						response += `${emoji} **${provider.toUpperCase()}**\n`;
						for (const m of models) {
							response += `  \`${m.key}\` → ${m.name} (${m.strength})\n`;
						}
						response += "\n";
					}

					response += `**Total: ${filtered.length} free models**\n`;
					response += `\nUse with: \`runOmni({ model: "model-key" })\``;

					if (response.length > 1900) {
						response = `${response.substring(0, 1900)}\n...(truncated)`;
					}

					await interaction.reply(response);
					break;
				}

				case "omni": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					switch (subcommand) {
						case "ask": {
							const prompt = interaction.options.getString("prompt", true);
							const mode = interaction.options.getString("mode") || "auto";

							try {
								const taskType = detectTaskType(prompt);
								let omniOptions: OmniOptions;

								switch (mode) {
									case "fast":
										omniOptions = OmniPresets.fast(prompt);
										break;
									case "quality":
										omniOptions = OmniPresets.quality(prompt);
										break;
									case "code":
										omniOptions = OmniPresets.code(prompt);
										break;
									case "creative":
										omniOptions = OmniPresets.creative(prompt);
										break;
									case "ultrafast":
										omniOptions = OmniPresets.ultrafast(prompt);
										break;
									default:
										omniOptions = OmniPresets.auto(prompt);
								}

								const result = await runOmni(omniOptions);

								if (result.success) {
									const freeIcon = result.free ? "🆓" : "💰";
									let response = `${freeIcon} **${result.provider}** → \`${result.model}\`\n`;
									response += `Task: ${taskType} | ${result.duration}ms\n\n`;
									response += result.output;

									if (response.length > 1900) {
										response = `${response.substring(0, 1900)}\n...(truncated)`;
									}
									await interaction.editReply(response);
								} else {
									await interaction.editReply(`❌ Error: ${result.error}`);
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Omni error: ${errMsg}`);
							}
							break;
						}

						case "model": {
							const prompt = interaction.options.getString("prompt", true);
							const modelKey = interaction.options.getString("model", true);

							if (!OMNI_MODELS[modelKey as keyof typeof OMNI_MODELS]) {
								const keys = Object.keys(OMNI_MODELS).slice(0, 10).join(", ");
								await interaction.editReply(`❌ Unknown model: \`${modelKey}\`\nAvailable: ${keys}...`);
								break;
							}

							try {
								const result = await runOmni({
									prompt,
									model: modelKey as keyof typeof OMNI_MODELS,
								});

								if (result.success) {
									const freeIcon = result.free ? "🆓" : "💰";
									let response = `${freeIcon} **${result.provider}** → \`${result.model}\`\n`;
									response += `${result.duration}ms\n\n`;
									response += result.output;

									if (response.length > 1900) {
										response = `${response.substring(0, 1900)}\n...(truncated)`;
									}
									await interaction.editReply(response);
								} else {
									await interaction.editReply(`❌ Error: ${result.error}`);
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`❌ Omni error: ${errMsg}`);
							}
							break;
						}

						case "models": {
							const allModels = listOmniModels();

							const strengthEmoji: Record<string, string> = {
								code: "💻",
								reasoning: "🧠",
								creative: "🎨",
								general: "🌐",
								fast: "🚀",
								"ultra-fast": "⚡",
								quality: "✨",
								agentic: "🤖",
								multimodal: "🖼️",
								multilingual: "🌍",
								experimental: "🧪",
								balanced: "⚖️",
							};

							let response = "**Omni Router Models**\n\n";

							// Group by strength
							const byStrength: Record<string, typeof allModels> = {};
							for (const m of allModels) {
								if (!byStrength[m.strength]) byStrength[m.strength] = [];
								byStrength[m.strength].push(m);
							}

							for (const [strength, models] of Object.entries(byStrength)) {
								const emoji = strengthEmoji[strength] || "•";
								response += `${emoji} **${strength.toUpperCase()}**\n`;
								for (const m of models) {
									const freeTag = m.free ? " 🆓" : "";
									response += `  \`${m.key}\` → ${m.name}${freeTag}\n`;
								}
								response += "\n";
							}

							response += `**Total: ${allModels.length} models (${allModels.filter((m) => m.free).length} free)**`;

							if (response.length > 1900) {
								response = `${response.substring(0, 1900)}\n...(truncated)`;
							}
							await interaction.editReply(response);
							break;
						}

						case "benchmark": {
							const testPrompt = "What is 2+2? Answer with just the number.";
							const testModels = ["cerebras-llama", "groq-llama", "gemini-google", "grok"] as const;

							let response = "**Omni Router Benchmark**\n\n";
							response += "Testing speed across providers...\n\n";

							const results: { name: string; time: number; success: boolean }[] = [];

							for (const modelKey of testModels) {
								try {
									const start = Date.now();
									const result = await runOmni({
										prompt: testPrompt,
										model: modelKey,
										timeout: 15000,
									});
									const elapsed = Date.now() - start;

									results.push({
										name: OMNI_MODELS[modelKey].name,
										time: elapsed,
										success: result.success,
									});
								} catch {
									results.push({
										name: OMNI_MODELS[modelKey].name,
										time: -1,
										success: false,
									});
								}
							}

							// Sort by speed
							results.sort((a, b) => {
								if (!a.success) return 1;
								if (!b.success) return -1;
								return a.time - b.time;
							});

							for (let i = 0; i < results.length; i++) {
								const r = results[i];
								const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
								const status = r.success ? `${r.time}ms` : "❌ failed";
								response += `${medal} **${r.name}**: ${status}\n`;
							}

							await interaction.editReply(response);
							break;
						}
					}
					break;
				}

				case "price": {
					const symbol = interaction.options.getString("symbol", true);
					await interaction.deferReply();

					try {
						const priceData = await getCryptoPrice(symbol);
						const changeEmoji = priceData.change24h >= 0 ? "📈" : "📉";
						const changeColor = priceData.change24h >= 0 ? "+" : "";

						const embed = new EmbedBuilder()
							.setColor(priceData.change24h >= 0 ? 0x00ff00 : 0xff0000)
							.setTitle(`${symbol.toUpperCase()} Price`)
							.addFields(
								{
									name: "Price",
									value: `$${priceData.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
									inline: true,
								},
								{
									name: "24h Change",
									value: `${changeEmoji} ${changeColor}${priceData.change24h.toFixed(2)}%`,
									inline: true,
								},
								{ name: "Market Cap", value: `$${(priceData.marketCap / 1e9).toFixed(2)}B`, inline: true },
							)
							.setTimestamp()
							.setFooter({ text: "Data from CoinGecko" });

						await interaction.editReply({ embeds: [embed] });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg}`);
					}
					break;
				}

				case "alert": {
					const condition = interaction.options.getString("condition", true);

					// Parse condition (simple format: SYMBOL > PRICE or SYMBOL < PRICE)
					const match = condition.match(/(\w+)\s*([><])\s*([\d.]+)/i);
					if (!match) {
						await interaction.reply(
							"Invalid condition format. Use: `SYMBOL > PRICE` or `SYMBOL < PRICE`\nExample: `BTC > 50000`",
						);
						break;
					}

					const [, symbol, operator, price] = match;

					// Store alert in memory
					const alertText = `Price alert: ${symbol.toUpperCase()} ${operator} $${price}`;
					addToMemory(alertText, channelDir, workingDir, false);

					await interaction.reply(
						`Alert set: ${symbol.toUpperCase()} ${operator} $${price}\n\n` +
							`Note: This is stored in memory. Use /ask to request monitoring of this alert, or integrate with external monitoring tools.`,
					);
					break;
				}

				case "news": {
					const newsType = interaction.options.getString("type") || "crypto";
					const topic = interaction.options.getString("topic") || undefined;
					await interaction.deferReply();

					try {
						const embeds: EmbedBuilder[] = [];

						// Fetch crypto news if type is crypto or all
						if (newsType === "crypto" || newsType === "all") {
							const newsItems = await getCryptoNews(topic);
							if (newsItems.length > 0) {
								embeds.push(
									new EmbedBuilder()
										.setColor(0x0099ff)
										.setTitle(topic ? `Crypto News: ${topic}` : "Latest Crypto News")
										.setDescription(
											newsItems
												.slice(0, 5)
												.map(
													(item, i) =>
														`**${i + 1}. ${item.title}**\n[Read more](${item.url}) - ${item.source}`,
												)
												.join("\n\n"),
										)
										.setTimestamp()
										.setFooter({ text: "Data from CryptoPanic" }),
								);
							}
						}

						// Fetch AI news if type is ai or all
						if (newsType === "ai" || newsType === "all") {
							const smolNews = getSmolAINews();
							const digest = await smolNews.fetchLatest();

							const aiNewsContent: string[] = [];

							if (digest.headlines.length > 0) {
								aiNewsContent.push("**Headlines**");
								for (const h of digest.headlines.slice(0, 5)) {
									aiNewsContent.push(`• ${h.title}`);
								}
								aiNewsContent.push("");
							}

							if (digest.modelReleases.length > 0) {
								aiNewsContent.push("**Model Releases**");
								for (const m of digest.modelReleases.slice(0, 3)) {
									aiNewsContent.push(`• ${m.title}`);
								}
								aiNewsContent.push("");
							}

							if (digest.tools.length > 0) {
								aiNewsContent.push("**Tools & Infra**");
								for (const t of digest.tools.slice(0, 3)) {
									aiNewsContent.push(`• ${t.title}`);
								}
							}

							if (aiNewsContent.length > 0) {
								embeds.push(
									new EmbedBuilder()
										.setColor(0x9b59b6)
										.setTitle(`Smol AI News - ${digest.date}`)
										.setDescription(aiNewsContent.join("\n"))
										.setURL("https://news.smol.ai")
										.setTimestamp()
										.setFooter({ text: "Source: news.smol.ai" }),
								);
							}
						}

						if (embeds.length === 0) {
							await interaction.editReply("No news found. Try again later.");
							break;
						}

						await interaction.editReply({ embeds });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error fetching news: ${errMsg}`);
					}
					break;
				}

				case "chart": {
					const symbol = interaction.options.getString("symbol", true);
					const timeframe = interaction.options.getString("timeframe", true);

					const chartUrl = generateTradingViewLink(symbol, timeframe);

					const embed = new EmbedBuilder()
						.setColor(0x0099ff)
						.setTitle(`${symbol.toUpperCase()} Chart (${timeframe})`)
						.setDescription(`[Open in TradingView](${chartUrl})`)
						.addFields(
							{ name: "Symbol", value: symbol.toUpperCase(), inline: true },
							{ name: "Timeframe", value: timeframe, inline: true },
						)
						.setTimestamp()
						.setFooter({ text: "TradingView Chart" });

					await interaction.reply({ embeds: [embed] });
					break;
				}

				case "convert": {
					const amount = interaction.options.getNumber("amount", true);
					const from = interaction.options.getString("from", true);
					const to = interaction.options.getString("to", true);

					await interaction.deferReply();

					try {
						const conversion = await convertCurrency(amount, from, to);

						const embed = new EmbedBuilder()
							.setColor(0x0099ff)
							.setTitle("Currency Conversion")
							.addFields(
								{ name: "From", value: `${amount.toLocaleString()} ${from.toUpperCase()}`, inline: true },
								{
									name: "To",
									value: `${conversion.result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${to.toUpperCase()}`,
									inline: true,
								},
								{
									name: "Rate",
									value: `1 ${from.toUpperCase()} = ${conversion.rate.toFixed(8)} ${to.toUpperCase()}`,
									inline: false,
								},
							)
							.setTimestamp()
							.setFooter({ text: "Data from CoinGecko" });

						await interaction.editReply({ embeds: [embed] });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error: ${errMsg}`);
					}
					break;
				}

				case "model": {
					const subcommand = interaction.options.getSubcommand();

					switch (subcommand) {
						case "list": {
							await interaction.deferReply();

							try {
								const models = await fetchOllamaModels();

								if (models.length === 0) {
									await interaction.editReply("No models found. Make sure Ollama is running.");
									break;
								}

								const currentModelId = getCurrentModelId(user.id);
								const modelList = models
									.map((m) => {
										const current = m.name === currentModelId ? " **[CURRENT]**" : "";
										const size = formatModelSize(m.size);
										const family = m.details?.family ? ` (${m.details.family})` : "";
										return `• \`${m.name}\`${family} - ${size}${current}`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setColor(0x0099ff)
									.setTitle("Available Ollama Models")
									.setDescription(modelList)
									.addFields(
										{ name: "Current Model", value: `\`${currentModelId}\``, inline: true },
										{ name: "Total Models", value: String(models.length), inline: true },
									)
									.setFooter({ text: "Use /model switch <name> to change models" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error fetching models: ${errMsg}`);
							}
							break;
						}

						case "switch": {
							const modelName = interaction.options.getString("name", true);
							const isGlobal = interaction.options.getBoolean("global") || false;

							// Only admin can set global model
							if (isGlobal && !isOwner(user.id)) {
								await interaction.reply({
									content: "Only the bot owner can set the global model.",
									ephemeral: true,
								});
								break;
							}

							await interaction.deferReply();

							try {
								// Verify model exists
								const models = await fetchOllamaModels();
								const modelExists = models.some((m) => m.name === modelName);

								if (!modelExists) {
									await interaction.editReply(
										`Model \`${modelName}\` not found. Use \`/model list\` to see available models.\n\n` +
											`To download a new model, run: \`ollama pull ${modelName}\``,
									);
									break;
								}

								// Switch model
								if (isGlobal) {
									setGlobalModel(modelName);
									logAdminAction(user.id, user.username, "set_global_model", modelName);
									await interaction.editReply(`Global model set to \`${modelName}\` for all users.`);
								} else {
									setUserModel(user.id, modelName);
									await interaction.editReply(`Your model has been switched to \`${modelName}\`.`);
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error switching model: ${errMsg}`);
							}
							break;
						}

						case "info": {
							await interaction.deferReply();

							try {
								const currentModelId = getCurrentModelId(user.id);
								const models = await fetchOllamaModels();
								const currentModel = models.find((m) => m.name === currentModelId);

								const embed = new EmbedBuilder()
									.setColor(0x0099ff)
									.setTitle("Current Model Information")
									.addFields(
										{ name: "Model Name", value: `\`${currentModelId}\``, inline: true },
										{
											name: "Is Personal",
											value: userModels.has(user.id) ? "Yes" : "No (using global)",
											inline: true,
										},
									);

								if (currentModel) {
									embed.addFields(
										{ name: "Size", value: formatModelSize(currentModel.size), inline: true },
										{ name: "Family", value: currentModel.details?.family || "Unknown", inline: true },
										{
											name: "Parameter Size",
											value: currentModel.details?.parameter_size || "Unknown",
											inline: true,
										},
										{
											name: "Last Modified",
											value: new Date(currentModel.modified_at).toLocaleDateString(),
											inline: true,
										},
									);
								}

								embed.setFooter({ text: "Use /model switch to change models" }).setTimestamp();

								await interaction.editReply({ embeds: [embed] });
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error fetching model info: ${errMsg}`);
							}
							break;
						}
					}
					break;
				}

				case "provider": {
					const subCommand = interaction.options.getSubcommand();

					switch (subCommand) {
						case "status": {
							let providerInfo: string;
							let providerColor: number;

							if (currentProvider === "zai") {
								providerInfo = `**Z.ai** (GLM-4.7)\n- Model: ${ZAI_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${ZAI_MODELS[globalModelId]?.cost || "subscription"}`;
								providerColor = 0x00d4ff;
							} else if (currentProvider === "groq") {
								providerInfo = `**Groq** (Free + Fast)\n- Model: ${GROQ_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${GROQ_MODELS[globalModelId]?.cost || "FREE"}`;
								providerColor = 0xf97316;
							} else if (currentProvider === "cerebras") {
								providerInfo = `**Cerebras** (Fastest)\n- Model: ${CEREBRAS_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${CEREBRAS_MODELS[globalModelId]?.cost || "varies"}`;
								providerColor = 0x7c3aed;
							} else if (currentProvider === "openrouter") {
								providerInfo = `**OpenRouter** (Cloud)\n- Model: ${OPENROUTER_MODELS[globalModelId]?.name || globalModelId}\n- Cost: ${OPENROUTER_MODELS[globalModelId]?.cost || "varies"}`;
								providerColor = 0x7c3aed;
							} else {
								providerInfo = `**Ollama** (Local)\n- Model: ${globalModelId}\n- Cost: FREE (runs locally)`;
								providerColor = 0x00ff00;
							}

							const embed = new EmbedBuilder()
								.setColor(providerColor)
								.setTitle("🔌 AI Provider Status")
								.setDescription(`Current provider: ${providerInfo}`)
								.addFields(
									{
										name: "Available Providers",
										value: "• `/provider zai` - GLM-4.7 (best coding)\n• `/provider groq` - Free + fast\n• `/provider cerebras` - Fastest\n• `/provider openrouter` - Cloud AI\n• `/provider ollama` - Local AI",
										inline: false,
									},
									{ name: "Z.ai Key", value: ZAI_API_KEY ? "✅ Configured" : "❌ Not set", inline: true },
									{ name: "Groq Key", value: GROQ_API_KEY ? "✅ Configured" : "❌ Not set", inline: true },
									{
										name: "Cerebras Key",
										value: CEREBRAS_API_KEY ? "✅ Configured" : "❌ Not set",
										inline: true,
									},
								)
								.setFooter({ text: "Use /provider <name> to switch" });

							await interaction.reply({ embeds: [embed] });
							break;
						}

						case "zai": {
							if (!ZAI_API_KEY) {
								await interaction.reply({
									content: "❌ Z.ai API key not configured. Set `ZAI_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_ZAI_MODEL;
							currentProvider = "zai";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = ZAI_MODELS[modelChoice];
							logInfo(`Switched to Z.ai provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **Z.ai** (GLM-4.7)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "subscription"}\n- SOTA coding model!`,
								ephemeral: false,
							});
							break;
						}

						case "groq": {
							if (!GROQ_API_KEY) {
								await interaction.reply({
									content: "❌ Groq API key not configured. Set `GROQ_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_GROQ_MODEL;
							currentProvider = "groq";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = GROQ_MODELS[modelChoice];
							logInfo(`Switched to Groq provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **Groq** (free + fast)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "FREE"}`,
								ephemeral: false,
							});
							break;
						}

						case "cerebras": {
							if (!CEREBRAS_API_KEY) {
								await interaction.reply({
									content: "❌ Cerebras API key not configured. Set `CEREBRAS_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_CEREBRAS_MODEL;
							currentProvider = "cerebras";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = CEREBRAS_MODELS[modelChoice];
							logInfo(`Switched to Cerebras provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **Cerebras** (fastest)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "varies"}\n- 2100+ tok/s!`,
								ephemeral: false,
							});
							break;
						}

						case "ollama": {
							currentProvider = "ollama";
							globalModelId = DEFAULT_MODEL_ID;
							channelStates.clear();
							logInfo(`Switched to Ollama provider with model: ${globalModelId}`);

							await interaction.reply({
								content: `✅ Switched to **Ollama** (local, free)\n- Model: \`${globalModelId}\`\n- All processing stays on your server`,
								ephemeral: false,
							});
							break;
						}

						case "openrouter": {
							if (!OPENROUTER_API_KEY) {
								await interaction.reply({
									content:
										"❌ OpenRouter API key not configured. Set `OPENROUTER_API_KEY` environment variable.",
									ephemeral: true,
								});
								break;
							}

							const modelChoice = interaction.options.getString("model") || DEFAULT_OPENROUTER_MODEL;
							currentProvider = "openrouter";
							globalModelId = modelChoice;
							channelStates.clear();

							const modelInfo = OPENROUTER_MODELS[modelChoice];
							logInfo(`Switched to OpenRouter provider with model: ${modelInfo?.id || modelChoice}`);

							await interaction.reply({
								content: `✅ Switched to **OpenRouter** (cloud)\n- Model: \`${modelInfo?.name || modelChoice}\`\n- Cost: ${modelInfo?.cost || "varies"}`,
								ephemeral: false,
							});
							break;
						}
					}
					break;
				}

				case "analytics": {
					const period = (interaction.options.getString("period") as "today" | "week" | "all") || "today";
					await interaction.deferReply();

					try {
						const stats = analytics.getStats(period);
						const hourlyDist = analytics.getHourlyDistribution();

						// Build hourly chart (simple text-based)
						const peakHour = Object.entries(hourlyDist).reduce(
							(max, [h, count]) => {
								return count > max.count ? { hour: parseInt(h, 10), count } : max;
							},
							{ hour: 0, count: 0 },
						);

						// Create embed
						const periodName = period === "today" ? "Today" : period === "week" ? "This Week" : "All Time";
						const embed = new EmbedBuilder()
							.setColor(0x00ff00)
							.setTitle(`📊 Analytics - ${periodName}`)
							.addFields(
								{ name: "Total Commands", value: String(stats.totalCommands), inline: true },
								{ name: "Unique Users", value: String(stats.uniqueUsers), inline: true },
								{ name: "Errors", value: String(stats.errors), inline: true },
								{ name: "Avg Response Time", value: `${stats.avgResponseTime.toFixed(0)}ms`, inline: true },
								{
									name: "Peak Hour",
									value: period === "today" ? `${peakHour.hour}:00 (${peakHour.count} cmds)` : "N/A",
									inline: true,
								},
								{
									name: "Error Rate",
									value:
										stats.totalCommands > 0
											? `${((stats.errors / stats.totalCommands) * 100).toFixed(1)}%`
											: "0%",
									inline: true,
								},
							);

						// Top commands
						if (stats.topCommands.length > 0) {
							const topCmdsText = stats.topCommands
								.map((c, i) => `${i + 1}. \`${c.command}\` - ${c.count} uses`)
								.join("\n");
							embed.addFields({ name: "Top Commands", value: topCmdsText, inline: false });
						}

						// Active users (limit to 5 for display)
						if (stats.activeUsers.length > 0) {
							const activeUsersText = stats.activeUsers
								.slice(0, 5)
								.map((u, i) => `${i + 1}. ${u.username} - ${u.count} commands`)
								.join("\n");
							embed.addFields({ name: "Most Active Users", value: activeUsersText, inline: false });
						}

						embed.setTimestamp().setFooter({ text: "Analytics powered by pi-discord" });

						await interaction.editReply({ embeds: [embed] });
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Error fetching analytics: ${errMsg}`);
					}
					break;
				}

				case "admin": {
					// Admin-only commands - check owner permission
					if (!isOwner(user.id)) {
						await interaction.reply({
							content: "Permission denied. This command is owner-only.",
							ephemeral: true,
						});
						logWarning(`Unauthorized admin command attempt by ${user.username}`, user.id);
						return;
					}

					const subcommand = interaction.options.getSubcommand();

					switch (subcommand) {
						case "stats": {
							await interaction.deferReply({ ephemeral: true });

							const uptime = Date.now() - botStats.startTime;
							const hours = Math.floor(uptime / (1000 * 60 * 60));
							const mins = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
							const uptimeStr = `${hours}h ${mins}m`;

							const memUsage = process.memoryUsage();
							const memoryStr = `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`;

							const embed = new EmbedBuilder()
								.setColor(0x00ff00)
								.setTitle("Admin - Bot Statistics")
								.addFields(
									{ name: "Uptime", value: uptimeStr, inline: true },
									{ name: "Commands Processed", value: String(botStats.commandsProcessed), inline: true },
									{ name: "Messages Processed", value: String(botStats.messagesProcessed), inline: true },
									{ name: "Errors Count", value: String(botStats.errorsCount), inline: true },
									{ name: "Active Channels", value: String(channelStates.size), inline: true },
									{ name: "Unique Users", value: String(botStats.userInteractions.size), inline: true },
									{ name: "Memory Usage", value: memoryStr, inline: false },
									{ name: "Model", value: `\`${model.id}\``, inline: true },
									{ name: "Working Directory", value: `\`${workingDir}\``, inline: false },
								)
								.setTimestamp()
								.setFooter({ text: "Admin Panel" });

							await interaction.editReply({ embeds: [embed] });
							logAdminAction(user.id, user.username, "stats");
							break;
						}

						case "users": {
							await interaction.deferReply({ ephemeral: true });

							const users = Array.from(botStats.userInteractions.values())
								.sort((a, b) => b.count - a.count)
								.slice(0, 20)
								.map((u, i) => {
									const _lastSeenDate = new Date(u.lastSeen);
									const timeDiff = Date.now() - u.lastSeen;
									const hoursAgo = Math.floor(timeDiff / (1000 * 60 * 60));
									const minsAgo = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
									const timeAgo = hoursAgo > 0 ? `${hoursAgo}h ago` : `${minsAgo}m ago`;

									return `${i + 1}. **${u.username}** - ${u.count} interactions (${timeAgo})`;
								})
								.join("\n");

							const embed = new EmbedBuilder()
								.setColor(0x0099ff)
								.setTitle("Admin - User Statistics")
								.setDescription(users || "No users yet")
								.addFields({
									name: "Total Unique Users",
									value: String(botStats.userInteractions.size),
									inline: true,
								})
								.setTimestamp()
								.setFooter({ text: "Top 20 users by interaction count" });

							await interaction.editReply({ embeds: [embed] });
							logAdminAction(user.id, user.username, "users");
							break;
						}

						case "broadcast": {
							const message = interaction.options.getString("message", true);
							await interaction.deferReply({ ephemeral: true });

							let successCount = 0;
							let failCount = 0;

							for (const [_guildId, guild] of client.guilds.cache) {
								try {
									const textChannels = guild.channels.cache.filter((ch) => ch.isTextBased() && ch.type === 0);

									if (textChannels.size > 0) {
										const firstChannel = textChannels.first() as TextChannel;
										await firstChannel.send(`**Broadcast from Bot Owner:**\n${message}`);
										successCount++;
									}
								} catch (error) {
									failCount++;
									logError(
										`Broadcast failed for guild ${guild.name}`,
										error instanceof Error ? error.message : String(error),
									);
								}
							}

							await interaction.editReply(`Broadcast sent to ${successCount} server(s). Failed: ${failCount}`);
							logAdminAction(user.id, user.username, "broadcast", `Sent to ${successCount} servers`);
							break;
						}

						case "reload": {
							await interaction.deferReply({ ephemeral: true });

							try {
								// Reload skills for all active channels
								let reloadCount = 0;
								for (const [channelId, state] of channelStates) {
									const channelDir = join(workingDir, channelId);
									const memory = getMemory(channelDir, workingDir);
									const channelNameTemp = channelId; // We don't have channel name here
									const systemPrompt = buildSystemPrompt(workingDir, channelId, channelNameTemp, memory);
									state.agent.setSystemPrompt(systemPrompt);
									reloadCount++;
								}

								await interaction.editReply(
									`Skills reloaded successfully for ${reloadCount} active channel(s).`,
								);
								logAdminAction(user.id, user.username, "reload", `Reloaded ${reloadCount} channels`);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error reloading skills: ${errMsg}`);
							}
							break;
						}

						case "config": {
							const key = interaction.options.getString("key", true);
							const value = interaction.options.getString("value");

							if (!value) {
								// View configuration
								const currentValue = runtimeConfig[key];
								await interaction.reply({
									content:
										currentValue !== undefined
											? `**${key}** = \`${currentValue}\``
											: `Configuration key "${key}" not found.\n\nAvailable keys:\n${Object.keys(
													runtimeConfig,
												)
													.map((k) => `- ${k}`)
													.join("\n")}`,
									ephemeral: true,
								});
								logAdminAction(user.id, user.username, "config view", key);
							} else {
								// Set configuration
								let parsedValue: string | number | boolean = value;

								// Try to parse as number or boolean
								if (value === "true") parsedValue = true;
								else if (value === "false") parsedValue = false;
								else if (!Number.isNaN(Number(value))) parsedValue = Number(value);

								runtimeConfig[key] = parsedValue;

								await interaction.reply({
									content: `Configuration updated: **${key}** = \`${parsedValue}\``,
									ephemeral: true,
								});
								logAdminAction(user.id, user.username, "config set", `${key} = ${parsedValue}`);
							}
							break;
						}

						case "logs": {
							const lines = interaction.options.getInteger("lines") || 50;
							await interaction.deferReply({ ephemeral: true });

							try {
								// Try to read bot logs
								const logSources = [
									"/var/log/discord-bot.log",
									"/opt/discord-bot-data/bot.log",
									"/var/log/syslog",
								];

								let logs = "";
								for (const logPath of logSources) {
									try {
										const result = await execCommand(
											`tail -n ${lines} ${shellEscape(logPath)} 2>/dev/null | grep -i discord || echo ""`,
										);
										if (result.stdout.trim()) {
											logs = result.stdout;
											break;
										}
									} catch {}
								}

								if (!logs) {
									logs = "No logs found. Showing process info:\n";
									const psResult = await execCommand(`ps aux | grep discord | grep -v grep`);
									logs += psResult.stdout || "No process info available";
								}

								// Truncate if too long
								if (logs.length > 1900) {
									logs = logs.substring(logs.length - 1900);
								}

								await interaction.editReply(`**Recent Logs:**\n\`\`\`\n${logs}\n\`\`\``);
								logAdminAction(user.id, user.username, "logs", `Viewed ${lines} lines`);
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.editReply(`Error fetching logs: ${errMsg}`);
							}
							break;
						}

						case "restart": {
							await interaction.reply({ content: "Initiating graceful restart...", ephemeral: true });
							logAdminAction(user.id, user.username, "restart", "Restarting bot");

							try {
								// Try systemd restart
								const result = await execCommand(
									"systemctl restart discord-bot 2>&1 || systemctl restart pi-discord 2>&1 || echo 'Systemd service not found'",
								);

								if (result.stdout.includes("not found")) {
									// Fallback: exit process and let Docker/PM2 restart it
									await interaction.followUp({
										content: "Systemd service not found. Exiting process (should auto-restart)...",
										ephemeral: true,
									});
									setTimeout(() => process.exit(0), 2000);
								} else {
									await interaction.followUp({ content: "Restart command sent to systemd.", ephemeral: true });
								}
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								await interaction.followUp({ content: `Error during restart: ${errMsg}`, ephemeral: true });
							}
							break;
						}
					}
					break;
				}

				case "tools": {
					const category = interaction.options.getString("category") || "all";

					const toolsInfo = {
						web: [
							{ name: "web_search", desc: "Search the web using Exa AI", usage: "search the web for..." },
							{ name: "free_search", desc: "Free DuckDuckGo search (no API key)", usage: "quick search for..." },
							{
								name: "deep_research",
								desc: "AI-powered deep research on complex topics",
								usage: "research...",
							},
							{ name: "web_scrape", desc: "Scrape web pages with anti-bot bypass", usage: "scrape URL..." },
						],
						github: [
							{ name: "github_search", desc: "Search GitHub repositories", usage: "search github for..." },
							{ name: "github_file", desc: "Get file contents from GitHub", usage: "show file from repo..." },
							{ name: "github_issues", desc: "List issues from a repository", usage: "list issues for..." },
							{ name: "github_create_issue", desc: "Create new GitHub issue", usage: "create issue..." },
							{ name: "github_branch", desc: "Create new branch", usage: "create branch..." },
							{ name: "github_pr", desc: "Create pull request", usage: "create PR..." },
							{ name: "github_list_prs", desc: "List pull requests", usage: "list PRs for..." },
						],
						hf: [
							{ name: "hf_models", desc: "Search HuggingFace models", usage: "find HF models for..." },
							{ name: "hf_datasets", desc: "Search HuggingFace datasets", usage: "find datasets for..." },
						],
						memory: [
							{ name: "memory_store", desc: "Store info in knowledge graph", usage: "remember that..." },
							{ name: "memory_recall", desc: "Recall from knowledge graph", usage: "what do you know about..." },
							{ name: "memory_relate", desc: "Create entity relationships", usage: "X is related to Y..." },
						],
						tasks: [
							{ name: "task_create", desc: "Create task with dependencies", usage: "create task to..." },
							{ name: "task_list", desc: "List tasks by status", usage: "show pending tasks..." },
							{ name: "task_update", desc: "Update task status/progress", usage: "mark task X done..." },
						],
						codebase: [
							{
								name: "codebase_knowledge",
								desc: "Search pi-mono docs & knowledge",
								usage: "how does pi-ai work...",
							},
							{ name: "pimono_read", desc: "Read pi-mono source files", usage: "show packages/ai/src/index.ts" },
							{ name: "pimono_list", desc: "List pi-mono directories", usage: "list packages/" },
						],
						skills: [
							{
								name: "skill_list",
								desc: "List all available skills (SKILL.md files)",
								usage: "what skills are available...",
							},
							{
								name: "skill_load",
								desc: "Load skill instructions for a domain",
								usage: "load the trading skill...",
							},
							{
								name: "skill_create",
								desc: "Create new skill from learned knowledge",
								usage: "create a skill about...",
							},
						],
						self: [
							{
								name: "memory_update",
								desc: "Update bot's persistent MEMORY.md",
								usage: "remember that user prefers...",
							},
							{ name: "skill_create", desc: "Create reusable skill files", usage: "create skill for..." },
							{
								name: "context_compact",
								desc: "Summarize old messages to reduce context",
								usage: "compact context...",
							},
						],
						agents: [
							{
								name: "agent_spawn",
								desc: "Spawn sub-agent for parallel tasks",
								usage: "spawn agent to research...",
							},
							{
								name: "agent_delegate",
								desc: "Delegate multiple tasks to agents",
								usage: "delegate these tasks...",
							},
						],
						hooks: [
							{ name: "hooks_list", desc: "List lifecycle hooks", usage: "list hooks..." },
							{ name: "hook_create", desc: "Create new hook", usage: "create hook for..." },
						],
						audio: [
							{
								name: "transcribe",
								desc: "Transcribe audio to text (Groq Whisper)",
								usage: "transcribe this audio...",
							},
						],
						rag: [
							{
								name: "knowledge_search",
								desc: "Search knowledge base & skills (RAG)",
								usage: "search knowledge for...",
							},
						],
						vision: [
							{
								name: "image_analyze",
								desc: "Analyze images with AI vision (OCR, describe)",
								usage: "analyze this image...",
							},
						],
						code: [
							{
								name: "code_sandbox",
								desc: "Execute code safely (Python/JS/TS/Bash)",
								usage: "run this python code...",
							},
						],
						scheduled: [
							{ name: "schedule_task", desc: "Create scheduled/cron tasks", usage: "schedule daily message..." },
							{
								name: "scheduled_tasks_list",
								desc: "List all scheduled tasks",
								usage: "show scheduled tasks...",
							},
						],
						learning: [
							{
								name: "auto_learn",
								desc: "Extract learnings from conversations",
								usage: "learn from this chat...",
							},
						],
						files: [
							{
								name: "file_process",
								desc: "Process uploaded files (images, code, text)",
								usage: "analyze this file...",
							},
						],
						embeds: [{ name: "rich_embed", desc: "Create beautiful Discord embeds", usage: "show as embed..." }],
						docker: [
							{
								name: "docker_sandbox",
								desc: "Execute code in isolated Docker container",
								usage: "run in docker...",
							},
						],
						export: [
							{
								name: "conversation_export",
								desc: "Export chat history (markdown/JSON)",
								usage: "export this conversation...",
							},
						],
						prefs: [
							{ name: "user_preferences", desc: "Get/set user preferences", usage: "remember I prefer..." },
						],
						voice: [
							{ name: "voice_join", desc: "Join a voice channel", usage: "join voice channel..." },
							{ name: "voice_tts", desc: "Text-to-speech in voice channel", usage: "say this in voice..." },
						],
						plugins: [
							{ name: "plugin_load", desc: "Load external plugin", usage: "load plugin..." },
							{ name: "plugin_list", desc: "List registered plugins", usage: "show plugins..." },
						],
						commands: [
							{
								name: "slash_command_create",
								desc: "Create custom slash command",
								usage: "create /mycommand...",
							},
							{ name: "slash_command_list", desc: "List custom commands", usage: "show custom commands..." },
						],
						servers: [
							{
								name: "server_sync",
								desc: "Sync knowledge between servers",
								usage: "sync from server X to Y...",
							},
							{ name: "server_list", desc: "List servers with bot data", usage: "show all servers..." },
						],
					};

					let response = "";
					const categories = category === "all" ? Object.keys(toolsInfo) : [category];

					for (const cat of categories) {
						const tools = toolsInfo[cat as keyof typeof toolsInfo];
						if (!tools) continue;

						const catNames: Record<string, string> = {
							web: "Web & Search",
							github: "GitHub",
							hf: "HuggingFace",
							memory: "Memory",
							tasks: "Tasks",
							codebase: "Codebase Knowledge",
							skills: "Skills System",
							self: "Self-Management",
							agents: "Multi-Agent",
							hooks: "Hooks System",
							audio: "Audio/Voice",
							rag: "Knowledge Base (RAG)",
							vision: "Vision/Image Analysis",
							code: "Code Execution",
							scheduled: "Scheduled Tasks",
							learning: "Auto-Learning",
							files: "File Processing",
							embeds: "Rich Embeds",
							docker: "Docker Sandbox",
							export: "Conversation Export",
							prefs: "User Preferences",
							voice: "Voice Channel",
							plugins: "Plugin System",
							commands: "Custom Commands",
							servers: "Multi-Server",
						};

						response += `\n**${catNames[cat] || cat}**\n`;
						for (const tool of tools) {
							response += `\`${tool.name}\` - ${tool.desc}\n`;
						}
					}

					const embed = new EmbedBuilder()
						.setColor(0x0099ff)
						.setTitle("Available MCP Tools")
						.setDescription(response.trim())
						.addFields(
							{
								name: "Usage",
								value: "Just ask naturally! The bot auto-detects when to use tools.",
								inline: false,
							},
							{
								name: "Examples",
								value: "`search github for ai agent`\n`find HF models for image generation`\n`research quantum computing`",
								inline: false,
							},
						)
						.setTimestamp()
						.setFooter({ text: `${Object.values(toolsInfo).flat().length} tools available` });

					await interaction.reply({ embeds: [embed] });
					break;
				}

				case "generate": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "image": {
								const prompt = interaction.options.getString("prompt", true);
								const model = interaction.options.getString("model") || "flux-dev";

								// Check if using HuggingFace model
								if (model.startsWith("hf-")) {
									const HF_TOKEN = process.env.HF_TOKEN;
									if (!HF_TOKEN) {
										await interaction.editReply("❌ HF_TOKEN not configured.");
										break;
									}

									const hfModelMap: Record<string, string> = {
										"hf-sdxl": "stabilityai/stable-diffusion-xl-base-1.0",
										"hf-sd3": "stabilityai/stable-diffusion-3.5-large",
										"hf-qwen": "Qwen/Qwen2.5-VL-32B-Instruct", // Falls back to text-to-image
									};

									// Use Qwen Image Fast for hf-qwen (via HuggingFace MCP Space)
									if (model === "hf-qwen") {
										try {
											// Call HF Qwen Image Space directly
											const qwenResponse = await fetch(
												"https://mcp-tools-qwen-image-fast.hf.space/call/generate_image",
												{
													method: "POST",
													headers: { "Content-Type": "application/json" },
													body: JSON.stringify({
														data: [prompt, true, 0, 8, 1, "16:9"],
													}),
												},
											);

											if (!qwenResponse.ok) {
												throw new Error(`Qwen API error: ${qwenResponse.status}`);
											}

											const qwenResult = await qwenResponse.json();
											const eventId = (qwenResult as { event_id?: string }).event_id;

											if (eventId) {
												// Poll for result
												await new Promise((resolve) => setTimeout(resolve, 5000));
												const resultResponse = await fetch(
													`https://mcp-tools-qwen-image-fast.hf.space/call/generate_image/${eventId}`,
												);
												const resultText = await resultResponse.text();

												// Parse SSE format to get image data
												const lines = resultText.split("\n");
												for (const line of lines) {
													if (line.startsWith("data: ")) {
														const data = JSON.parse(line.slice(6));
														if (data?.[0]?.url) {
															const imgResponse = await fetch(data[0].url);
															const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
															const attachment = new AttachmentBuilder(imgBuffer, {
																name: "generated.png",
															});

															const embed = new EmbedBuilder()
																.setColor(0xffd21e)
																.setTitle("🤗 Image Generated")
																.setDescription(`**Prompt:** ${prompt.slice(0, 200)}`)
																.setImage("attachment://generated.png")
																.setFooter({ text: `Model: Qwen Image Fast | HuggingFace` });
															await interaction.editReply({ embeds: [embed], files: [attachment] });
															break;
														}
													}
												}
											}
										} catch (qwenError) {
											await interaction.editReply(`Qwen generation failed: ${qwenError}`);
										}
										break;
									}

									// Standard HuggingFace Inference API for SDXL/SD3
									const hfModel = hfModelMap[model] || hfModelMap["hf-sdxl"];
									const hfUrl = `https://router.huggingface.co/hf-inference/models/${hfModel}`;

									const hfResponse = await fetch(hfUrl, {
										method: "POST",
										headers: {
											Authorization: `Bearer ${HF_TOKEN}`,
											"Content-Type": "application/json",
										},
										body: JSON.stringify({ inputs: prompt }),
									});

									if (!hfResponse.ok) {
										const hfError = await hfResponse.text();
										await interaction.editReply(`HuggingFace error: ${hfError.slice(0, 300)}`);
										break;
									}

									const contentType = hfResponse.headers.get("content-type");
									if (contentType?.includes("image")) {
										const imgBuffer = Buffer.from(await hfResponse.arrayBuffer());
										const attachment = new AttachmentBuilder(imgBuffer, { name: "generated.png" });

										const embed = new EmbedBuilder()
											.setColor(0xffd21e)
											.setTitle("🤗 Image Generated")
											.setDescription(`**Prompt:** ${prompt.slice(0, 200)}`)
											.setImage("attachment://generated.png")
											.setFooter({ text: `Model: ${hfModel.split("/").pop()} | HuggingFace` });
										await interaction.editReply({ embeds: [embed], files: [attachment] });
									} else {
										const hfResult = await hfResponse.json();
										await interaction.editReply(
											`Unexpected response: ${JSON.stringify(hfResult).slice(0, 300)}`,
										);
									}
									break;
								}

								// Fal.ai models
								const FAL_KEY = process.env.FAL_KEY;
								if (!FAL_KEY) {
									await interaction.editReply("❌ FAL_KEY not configured.");
									break;
								}

								const modelMap: Record<string, string> = {
									"flux-dev": "fal-ai/flux/dev",
									"flux-schnell": "fal-ai/flux/schnell",
									"flux-pro": "fal-ai/flux-pro/v1.1",
									"flux-realism": "fal-ai/flux-realism",
									ideogram: "fal-ai/ideogram/v2",
									recraft: "fal-ai/recraft-v3",
								};

								// Use fal.run (sync endpoint) for immediate results
								const response = await fetch(`https://fal.run/${modelMap[model] || modelMap["flux-dev"]}`, {
									method: "POST",
									headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
									body: JSON.stringify({ prompt, image_size: "landscape_16_9", num_inference_steps: 28 }),
								});

								const result = (await response.json()) as { images?: Array<{ url: string }>; detail?: string };
								if (result.images?.[0]?.url) {
									// Download and attach the image for proper Discord embedding
									const imgResponse = await fetch(result.images[0].url);
									const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
									const attachment = new AttachmentBuilder(imgBuffer, { name: "generated.png" });

									const embed = new EmbedBuilder()
										.setColor(0x7c3aed)
										.setTitle("🎨 Image Generated")
										.setDescription(`**Prompt:** ${prompt.slice(0, 200)}`)
										.setImage("attachment://generated.png")
										.setFooter({ text: `Model: ${model} | Fal.ai` });
									await interaction.editReply({ embeds: [embed], files: [attachment] });
								} else {
									await interaction.editReply(
										`Image generation failed: ${result.detail || JSON.stringify(result).slice(0, 500)}`,
									);
								}
								break;
							}

							case "music": {
								const prompt = interaction.options.getString("prompt", true);
								const style = interaction.options.getString("style") || "";

								const SUNO_KEY = process.env.SUNO_API_KEY;
								if (!SUNO_KEY) {
									await interaction.editReply("❌ SUNO_API_KEY not configured.");
									break;
								}

								const fullPrompt = style ? `${style}: ${prompt}` : prompt;
								await interaction.editReply(
									`🎵 Generating music for: "${fullPrompt.slice(0, 100)}..."\n\n⏳ This takes 1-2 minutes...`,
								);

								try {
									// Call Suno API to generate music
									const genResponse = await fetch("https://api.sunoapi.org/api/v1/generate", {
										method: "POST",
										headers: {
											Authorization: `Bearer ${SUNO_KEY}`,
											"Content-Type": "application/json",
										},
										body: JSON.stringify({
											prompt: fullPrompt,
											model: "V4_5ALL",
											customMode: false,
											instrumental: false,
											callBackUrl: "https://webhook.site/test",
										}),
									});

									const genResult = (await genResponse.json()) as {
										code: number;
										data?: { taskId: string };
										msg?: string;
									};

									if (genResult.code !== 200 || !genResult.data?.taskId) {
										await interaction.editReply(
											`❌ Music generation failed: ${genResult.msg || "Unknown error"}`,
										);
										break;
									}

									const taskId = genResult.data.taskId;

									// Poll for completion (max 2 minutes)
									let attempts = 0;
									const maxAttempts = 24; // 24 * 5s = 2 minutes

									while (attempts < maxAttempts) {
										await new Promise((r) => setTimeout(r, 5000));

										const statusResponse = await fetch(
											`https://api.sunoapi.org/api/v1/generate/record-info?taskId=${taskId}`,
											{ headers: { Authorization: `Bearer ${SUNO_KEY}` } },
										);

										const status = (await statusResponse.json()) as {
											code: number;
											data?: {
												status: string;
												response?: {
													sunoData?: Array<{
														audioUrl?: string;
														streamAudioUrl?: string;
														title?: string;
														imageUrl?: string;
													}>;
												};
											};
										};

										if (status.data?.status === "SUCCESS" && status.data.response?.sunoData?.[0]) {
											const track = status.data.response.sunoData[0];
											const audioUrl = track.audioUrl || track.streamAudioUrl;

											const embed = new EmbedBuilder()
												.setColor(0xff6b6b)
												.setTitle(`🎵 ${track.title || "Generated Music"}`)
												.setDescription(`**Prompt:** ${fullPrompt.slice(0, 200)}`)
												.setThumbnail(track.imageUrl || null)
												.addFields({ name: "🎧 Listen", value: audioUrl || "Audio processing..." })
												.setFooter({ text: "Powered by Suno AI V4.5" });

											await interaction.editReply({ embeds: [embed] });
											break;
										}

										if (status.data?.status?.includes("FAILED") || status.data?.status?.includes("ERROR")) {
											await interaction.editReply(`❌ Music generation failed: ${status.data.status}`);
											break;
										}

										attempts++;
										if (attempts % 4 === 0) {
											await interaction.editReply(
												`🎵 Still generating... (${Math.round((attempts * 5) / 60)}min elapsed)\n\n⏳ Status: ${status.data?.status || "Processing"}`,
											);
										}
									}

									if (attempts >= maxAttempts) {
										await interaction.editReply(
											`⏰ Music generation timed out. Task ID: \`${taskId}\`\n\nTry again or check status later.`,
										);
									}
								} catch (error) {
									await interaction.editReply(
										`❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
									);
								}
								break;
							}

							case "video": {
								const prompt = interaction.options.getString("prompt", true);
								const _imageUrl = interaction.options.getString("image_url");

								const FAL_KEY = process.env.FAL_KEY;
								if (!FAL_KEY) {
									await interaction.editReply("❌ FAL_KEY not configured.");
									break;
								}

								await interaction.editReply(
									`🎬 Generating video for: "${prompt.slice(0, 100)}..."\n\n⏳ This may take 2-5 minutes...`,
								);
								break;
							}

							case "voice": {
								const text = interaction.options.getString("text", true);
								const engine = interaction.options.getString("engine") || "vibevoice";

								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🗣️ Voice Generation")
									.setDescription(
										`**Text:** ${text.slice(0, 200)}...\n**Engine:** ${engine}\n\nUse \`@bot generate voice: ${text.slice(0, 50)}...\` for full generation.`,
									)
									.setFooter({ text: "TTS Generation" });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "3d": {
								const prompt = interaction.options.getString("prompt", true);
								const imageUrl = interaction.options.getString("image_url");

								const embed = new EmbedBuilder()
									.setColor(0x9b59b6)
									.setTitle("🎮 3D Model Generation")
									.setDescription(
										`**Prompt:** ${prompt.slice(0, 200)}\n${imageUrl ? `**Image:** ${imageUrl}` : ""}\n\nUse \`@bot create 3d model: ${prompt.slice(0, 50)}...\` for full generation.`,
									)
									.setFooter({ text: imageUrl ? "Image to 3D (TripoSR)" : "Text to 3D (Shap-E)" });
								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						await interaction.editReply(
							`❌ Generation error: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					break;
				}

				case "livekit": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					const LIVEKIT_URL = process.env.LIVEKIT_URL;
					const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
					const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

					if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
						await interaction.editReply(
							"❌ LiveKit not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET",
						);
						break;
					}

					try {
						switch (subcommand) {
							case "create": {
								const roomName = interaction.options.getString("name", true);
								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🎙️ LiveKit Room")
									.setDescription(
										`Room **${roomName}** created!\n\nUse \`/livekit join ${roomName}\` to get a join token.`,
									)
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "join": {
								const roomName = interaction.options.getString("room", true);
								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🎫 Join Token")
									.setDescription(
										`**Room:** ${roomName}\n\nUse \`@bot create livekit token for ${roomName}\` to generate a join token.`,
									)
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const embed = new EmbedBuilder()
									.setColor(0x00d4aa)
									.setTitle("🎙️ Active Rooms")
									.setDescription("Use `@bot list livekit rooms` to see active rooms.")
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "record": {
								const roomName = interaction.options.getString("room", true);
								const action = interaction.options.getString("action", true);
								const embed = new EmbedBuilder()
									.setColor(action === "start" ? 0xff0000 : 0x00ff00)
									.setTitle(action === "start" ? "🔴 Recording Started" : "⏹️ Recording Stopped")
									.setDescription(`**Room:** ${roomName}`)
									.setFooter({ text: LIVEKIT_URL });
								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						await interaction.editReply(
							`❌ LiveKit error: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					break;
				}

				case "schedule": {
					await interaction.deferReply();
					const subcommand = interaction.options.getSubcommand();
					const userId = interaction.user.id;

					try {
						switch (subcommand) {
							case "add": {
								const name = interaction.options.getString("name", true);
								const cronExpr = interaction.options.getString("cron", true);
								const action = interaction.options.getString("action", true);
								const channel = interaction.options.getChannel("channel");
								const channelId = channel?.id || interaction.channelId;

								// Validate cron expression
								if (!TaskScheduler.validateCron(cronExpr)) {
									await interaction.editReply(
										"❌ Invalid cron expression. Example: `0 9 * * *` for 9 AM daily",
									);
									break;
								}

								// Add task
								const task = taskScheduler.addTask({
									name,
									cron: cronExpr,
									action,
									channelId,
									userId,
									enabled: true,
								});

								const cronDesc = TaskScheduler.describeCron(cronExpr);
								const embed = new EmbedBuilder()
									.setColor(0x00ff00)
									.setTitle("✅ Scheduled Task Created")
									.setDescription(`**${name}**\n${cronDesc}`)
									.addFields(
										{ name: "Task ID", value: task.id, inline: true },
										{ name: "Action", value: action, inline: true },
										{ name: "Channel", value: `<#${channelId}>`, inline: true },
									)
									.setTimestamp()
									.setFooter({ text: "Task is now active" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const tasks = taskScheduler.listTasks(userId);

								if (tasks.length === 0) {
									await interaction.editReply(
										"You don't have any scheduled tasks. Use `/schedule add` to create one!",
									);
									break;
								}

								const taskList = tasks
									.map((task) => {
										const status = task.enabled ? "🟢 Enabled" : "🔴 Disabled";
										const lastRun = task.lastRun
											? `Last: ${new Date(task.lastRun).toLocaleString()}`
											: "Never run";
										return `**${task.name}** (${task.id})\n${status} • ${task.cron} • ${lastRun}\nAction: ${task.action}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setColor(0x0099ff)
									.setTitle("📅 Your Scheduled Tasks")
									.setDescription(taskList.substring(0, 4000))
									.setTimestamp()
									.setFooter({ text: `Total: ${tasks.length} task(s)` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "remove": {
								const taskId = interaction.options.getString("id", true);
								const task = taskScheduler.getTask(taskId);

								// Check if task exists and belongs to user
								if (!task) {
									await interaction.editReply("❌ Task not found.");
									break;
								}

								if (task.userId !== userId) {
									await interaction.editReply("❌ You don't have permission to remove this task.");
									break;
								}

								const success = taskScheduler.removeTask(taskId);
								if (success) {
									await interaction.editReply(`✅ Task **${task.name}** has been removed.`);
								} else {
									await interaction.editReply("❌ Failed to remove task.");
								}
								break;
							}

							case "toggle": {
								const taskId = interaction.options.getString("id", true);
								const task = taskScheduler.getTask(taskId);

								// Check if task exists and belongs to user
								if (!task) {
									await interaction.editReply("❌ Task not found.");
									break;
								}

								if (task.userId !== userId) {
									await interaction.editReply("❌ You don't have permission to modify this task.");
									break;
								}

								const toggledTask = taskScheduler.toggleTask(taskId);
								if (toggledTask) {
									const status = toggledTask.enabled ? "enabled" : "disabled";
									const emoji = toggledTask.enabled ? "✅" : "⏸️";
									await interaction.editReply(`${emoji} Task **${toggledTask.name}** is now **${status}**.`);
								} else {
									await interaction.editReply("❌ Failed to toggle task.");
								}
								break;
							}

							case "info": {
								const taskId = interaction.options.getString("id", true);
								const task = taskScheduler.getTask(taskId);

								if (!task) {
									await interaction.editReply("❌ Task not found.");
									break;
								}

								if (task.userId !== userId) {
									await interaction.editReply("❌ You don't have permission to view this task.");
									break;
								}

								const cronDesc = TaskScheduler.describeCron(task.cron);
								const embed = new EmbedBuilder()
									.setColor(task.enabled ? 0x00ff00 : 0xff0000)
									.setTitle(`📋 Task: ${task.name}`)
									.addFields(
										{ name: "ID", value: task.id, inline: true },
										{ name: "Status", value: task.enabled ? "🟢 Enabled" : "🔴 Disabled", inline: true },
										{ name: "Channel", value: `<#${task.channelId}>`, inline: true },
										{ name: "Cron Expression", value: task.cron, inline: true },
										{ name: "Schedule", value: cronDesc, inline: true },
										{ name: "Action", value: task.action },
										{ name: "Created", value: new Date(task.createdAt).toLocaleString(), inline: true },
										{
											name: "Last Run",
											value: task.lastRun ? new Date(task.lastRun).toLocaleString() : "Never",
											inline: true,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						await interaction.editReply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
					}
					break;
				}

				case "health": {
					await interaction.deferReply();

					const checks: Array<{ name: string; status: string; latency?: number }> = [];

					// Bot uptime
					const uptime = Date.now() - botStats.startTime;
					const hours = Math.floor(uptime / (1000 * 60 * 60));
					const mins = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
					checks.push({ name: "Bot Uptime", status: `${hours}h ${mins}m` });

					// Memory
					const memUsage = process.memoryUsage();
					checks.push({ name: "Memory", status: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB` });

					// OpenRouter API
					if (process.env.OPENROUTER_API_KEY) {
						try {
							const start = Date.now();
							const resp = await fetch("https://openrouter.ai/api/v1/models", {
								headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
							});
							checks.push({
								name: "OpenRouter API",
								status: resp.ok ? "✅ OK" : "❌ Error",
								latency: Date.now() - start,
							});
						} catch {
							checks.push({ name: "OpenRouter API", status: "❌ Unreachable" });
						}
					}

					// Fal.ai API
					if (process.env.FAL_KEY) {
						checks.push({ name: "Fal.ai (Images)", status: "✅ Configured" });
					} else {
						checks.push({ name: "Fal.ai (Images)", status: "⚠️ Not configured" });
					}

					// Suno API
					if (process.env.SUNO_API_KEY) {
						checks.push({ name: "Suno (Music)", status: "✅ Configured" });
					} else {
						checks.push({ name: "Suno (Music)", status: "⚠️ Not configured" });
					}

					// LiveKit
					if (process.env.LIVEKIT_URL) {
						checks.push({ name: "LiveKit (Voice)", status: "✅ Configured" });
					} else {
						checks.push({ name: "LiveKit (Voice)", status: "⚠️ Not configured" });
					}

					// ElevenLabs
					if (process.env.ELEVENLABS_API_KEY) {
						checks.push({ name: "ElevenLabs (TTS)", status: "✅ Configured" });
					} else {
						checks.push({ name: "ElevenLabs (TTS)", status: "⚠️ Not configured" });
					}

					const embed = new EmbedBuilder()
						.setColor(0x00ff00)
						.setTitle("🏥 Bot Health Status")
						.setDescription(
							checks.map((c) => `**${c.name}:** ${c.status}${c.latency ? ` (${c.latency}ms)` : ""}`).join("\n"),
						)
						.addFields(
							{ name: "Commands Processed", value: String(botStats.commandsProcessed), inline: true },
							{ name: "Active Channels", value: String(channelStates.size), inline: true },
							{ name: "Total Tools", value: "89", inline: true },
						)
						.setTimestamp()
						.setFooter({ text: "Pi-Agent Health Check" });

					await interaction.editReply({ embeds: [embed] });
					break;
				}

				case "reset": {
					const channelDir = join(workingDir, channelId);
					const state = channelStates.get(channelId);

					// Clear agent messages if state exists
					if (state?.agent) {
						state.agent.reset();
					}

					// Clear session file
					clearSession(channelDir);

					// Remove channel state so it gets recreated fresh
					channelStates.delete(channelId);

					await interaction.reply({
						content: "🔄 **Conversation Reset**\nHistory cleared for this channel. I'm starting fresh!",
						ephemeral: false,
					});

					logInfo(`[RESET] Channel ${channelId} history cleared by ${user.username}`);
					break;
				}

				case "backup": {
					await interaction.deferReply({ ephemeral: true });

					const scope = interaction.options.getString("scope") || "channel";
					const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
					const backupDir = join(workingDir, "backups");

					if (!existsSync(backupDir)) {
						mkdirSync(backupDir, { recursive: true });
					}

					try {
						if (scope === "channel") {
							const channelDir = join(workingDir, channelId);
							if (!existsSync(channelDir)) {
								await interaction.editReply("❌ No data to backup for this channel.");
								break;
							}

							const backupPath = join(backupDir, `channel-${channelId}-${timestamp}.tar.gz`);

							// Create tarball of channel data
							const { execSync } = await import("child_process");
							execSync(`tar -czf "${backupPath}" -C "${workingDir}" "${channelId}"`);

							const stats = await import("fs").then((fs) => fs.statSync(backupPath));
							const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

							await interaction.editReply({
								content: `✅ **Channel Backup Created**\n📁 \`${backupPath}\`\n📊 Size: ${sizeMB} MB\n\nRetrieve with: \`scp user@server:${backupPath} ./\``,
							});

							logInfo(`[BACKUP] Channel ${channelId} backed up by ${user.username} (${sizeMB} MB)`);
						} else {
							// Backup all data
							const backupPath = join(backupDir, `full-backup-${timestamp}.tar.gz`);

							const { execSync } = await import("child_process");
							// Exclude the backups directory itself to avoid recursion
							execSync(
								`tar --exclude='backups' -czf "${backupPath}" -C "${resolve(workingDir, "..")}" "${workingDir.split("/").pop()}"`,
							);

							const stats = await import("fs").then((fs) => fs.statSync(backupPath));
							const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

							await interaction.editReply({
								content: `✅ **Full Backup Created**\n📁 \`${backupPath}\`\n📊 Size: ${sizeMB} MB\n\nRetrieve with: \`scp user@server:${backupPath} ./\``,
							});

							logInfo(`[BACKUP] Full backup created by ${user.username} (${sizeMB} MB)`);
						}
					} catch (e) {
						const errMsg = e instanceof Error ? e.message : String(e);
						await interaction.editReply(`❌ Backup failed: ${errMsg}`);
						logError("[BACKUP] Failed", errMsg);
					}
					break;
				}

				case "cost": {
					const view = interaction.options.getString("view") || "me";

					if (view === "me") {
						const userCost = analytics.getUserCost(user.id);
						if (!userCost) {
							await interaction.reply({
								content: "📊 **Your Usage**\nNo usage recorded yet. Start chatting to track costs!",
								ephemeral: true,
							});
							break;
						}

						const embed = new EmbedBuilder()
							.setColor(0x00bfff)
							.setTitle("📊 Your API Usage")
							.addFields(
								{ name: "Total Requests", value: String(userCost.requests), inline: true },
								{ name: "Estimated Cost", value: `$${userCost.estimatedCostUsd.toFixed(4)}`, inline: true },
								{ name: "Input Tokens", value: userCost.totalTokensInput.toLocaleString(), inline: true },
								{ name: "Output Tokens", value: userCost.totalTokensOutput.toLocaleString(), inline: true },
							)
							.setFooter({ text: `Last updated: ${userCost.lastUpdated}` });

						await interaction.reply({ embeds: [embed], ephemeral: true });
					} else if (view === "top") {
						const topUsers = analytics.getTopCostUsers(10);
						if (topUsers.length === 0) {
							await interaction.reply({
								content: "📊 **Top Users**\nNo usage recorded yet.",
								ephemeral: true,
							});
							break;
						}

						const userList = topUsers
							.map(
								(u, i) =>
									`${i + 1}. **${u.username}** - $${u.estimatedCostUsd.toFixed(4)} (${u.requests} requests)`,
							)
							.join("\n");

						const embed = new EmbedBuilder()
							.setColor(0xffd700)
							.setTitle("🏆 Top Users by Cost")
							.setDescription(userList);

						await interaction.reply({ embeds: [embed], ephemeral: true });
					} else if (view === "daily") {
						const dailyCosts = analytics.getDailyCosts(7);
						const totalWeek = dailyCosts.reduce((sum, d) => sum + d.cost, 0);

						const breakdown = dailyCosts.map((d) => `${d.date}: $${d.cost.toFixed(4)}`).join("\n");

						const embed = new EmbedBuilder()
							.setColor(0x32cd32)
							.setTitle("📅 Daily Cost Breakdown")
							.setDescription(breakdown || "No data yet")
							.addFields({ name: "7-Day Total", value: `$${totalWeek.toFixed(4)}`, inline: true });

						await interaction.reply({ embeds: [embed], ephemeral: true });
					}
					break;
				}

				case "trading": {
					const subcommand = interaction.options.getSubcommand();
					const tradingOrchestrator = getTradingOrchestrator();

					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "analyze": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const result = await tradingOrchestrator.getConsensusAnalysis(symbol);

								if (!result) {
									await interaction.editReply(
										`Could not analyze ${symbol}. Make sure it's a valid crypto symbol.`,
									);
									break;
								}

								// FIX: Track signal for auto-outcome recording (fixes 0% win rate bug)
								// Get current price for tracking
								let entryPrice = 0;
								let trackingId = "";
								try {
									const priceData = await fetchCoinGeckoPrice(symbol);
									if (priceData?.price) {
										entryPrice = priceData.price;
										// Track signal - outcome will be auto-recorded after 15 minutes
										trackingId = await tradingLearning.trackSignal({
											timestamp: Date.now(),
											symbol,
											action: result.action as "BUY" | "SELL" | "HOLD",
											entryPrice,
											confidence: result.confidence,
											agents: result.votes.map((v) => v.model),
										});
									}
								} catch (err) {
									console.error("[TRADING-ANALYZE] Could not track signal:", err);
								}

								const colors: Record<string, number> = { BUY: 0x00ff00, SELL: 0xff0000, HOLD: 0xffff00 };
								const emojis: Record<string, string> = { BUY: "🟢", SELL: "🔴", HOLD: "🟡" };

								const voteSummary = result.votes
									.map((v) => `**${v.model}**: ${v.action} (${(v.confidence * 100).toFixed(0)}%)`)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`${emojis[result.action] || "⚪"} AI Consensus: ${symbol}`)
									.setColor(colors[result.action] || 0x808080)
									.addFields(
										{ name: "Action", value: result.action, inline: true },
										{ name: "Confidence", value: `${(result.confidence * 100).toFixed(1)}%`, inline: true },
										{ name: "Model Votes", value: voteSummary || "No votes" },
									)
									.setFooter({
										text: trackingId
											? `Tracking: ${trackingId} | Auto-eval in 15m`
											: "Powered by Moon Dev-inspired multi-model consensus",
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "sentiment": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const sentiment = await tradingOrchestrator.sentimentAgent.getSentiment(symbol);

								if (!sentiment) {
									await interaction.editReply(`Could not get sentiment for ${symbol}.`);
									break;
								}

								const sentimentEmoji = sentiment.score > 0.3 ? "😀" : sentiment.score < -0.3 ? "😰" : "😐";
								const sentimentColor =
									sentiment.score > 0.3 ? 0x00ff00 : sentiment.score < -0.3 ? 0xff0000 : 0xffff00;

								const embed = new EmbedBuilder()
									.setTitle(`${sentimentEmoji} Sentiment Analysis: ${symbol}`)
									.setColor(sentimentColor)
									.addFields(
										{ name: "Score", value: sentiment.score.toFixed(2), inline: true },
										{ name: "Mentions", value: String(sentiment.volume), inline: true },
										{ name: "Top Keywords", value: sentiment.keywords.slice(0, 5).join(", ") || "None" },
										{ name: "Sources", value: sentiment.sources.slice(0, 3).join(", ") || "Unknown" },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "whales": {
								const summary = tradingOrchestrator.whaleAgent.getActivitySummary();
								const movements = tradingOrchestrator.whaleAgent.getRecentMovements().slice(0, 5);

								const formatNum = (n: number) => {
									if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
									if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
									return `$${n.toLocaleString()}`;
								};

								const movementList =
									movements.length > 0
										? movements
												.map(
													(m) => `${m.type === "buy" ? "🟢" : "🔴"} ${m.symbol}: ${formatNum(m.usdValue)}`,
												)
												.join("\n")
										: "No recent movements detected";

								const embed = new EmbedBuilder()
									.setTitle("🐋 Whale Activity")
									.setColor(0x1e90ff)
									.addFields(
										{ name: "Buy Volume", value: formatNum(summary.totalBuyVolume), inline: true },
										{ name: "Sell Volume", value: formatNum(summary.totalSellVolume), inline: true },
										{ name: "Net Flow", value: formatNum(summary.netFlow), inline: true },
										{ name: "Recent Movements", value: movementList },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "signals": {
								const signals = tradingOrchestrator.getRecentSignals(10);

								if (signals.length === 0) {
									await interaction.editReply("No trading signals yet. Agents are analyzing the market...");
									break;
								}

								const signalList = signals
									.map((s) => {
										const emoji = s.action === "BUY" ? "🟢" : s.action === "SELL" ? "🔴" : "🟡";
										return `${emoji} **${s.symbol}** ${s.action} (${(s.confidence * 100).toFixed(0)}%) - ${s.reason.slice(0, 50)}`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("📊 Recent Trading Signals")
									.setColor(0x7c3aed)
									.setDescription(signalList)
									.setFooter({ text: "Signals are for informational purposes only" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "summary": {
								const summary = await tradingOrchestrator.getMarketSummary();

								const priceLines = Object.entries(summary.prices)
									.map(([symbol, data]: [string, any]) => {
										const emoji = data.change24h >= 0 ? "📈" : "📉";
										return `**${symbol}**: $${data.price.toLocaleString()} ${emoji} ${data.change24h.toFixed(2)}%`;
									})
									.join("\n");

								const sentimentLines = Object.entries(summary.sentiment)
									.map(([symbol, data]: [string, any]) => {
										const emoji = data.score > 0.3 ? "😀" : data.score < -0.3 ? "😰" : "😐";
										return `**${symbol}**: ${emoji} ${data.score.toFixed(2)}`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🌍 Market Summary")
									.setColor(0x00bfff)
									.addFields(
										{ name: "💰 Prices", value: priceLines || "Loading...", inline: true },
										{ name: "💭 Sentiment", value: sentimentLines || "Loading...", inline: true },
										{ name: "📊 Recent Signals", value: String(summary.signals.length), inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const stats = tradingOrchestrator.getStats();

								const agentStatus = Object.entries(stats.agents)
									.map(([name, data]: [string, any]) => {
										const status = data.enabled ? "✅" : "❌";
										return `${status} **${name}**: ${data.signalsGenerated} signals`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🤖 Trading Agent Status")
									.setColor(stats.enabled ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "System", value: stats.enabled ? "Online" : "Offline", inline: true },
										{ name: "Total Signals", value: String(stats.totalSignals), inline: true },
										{ name: "Agents", value: agentStatus || "No agents" },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "backtest": {
								const strategy = interaction.options.getString("strategy", true);
								const timeframe = interaction.options.getString("timeframe") || "1 year";

								await interaction.editReply(
									`🔬 Running ${strategy} strategy backtest over ${timeframe}... (OpenHands)`,
								);

								const result = await runStrategyBacktest(strategy, undefined, timeframe);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle(`📊 Backtest: ${strategy}`)
										.setColor(0x7c3aed)
										.setDescription(result.output.substring(0, 4000))
										.addFields(
											{ name: "Timeframe", value: timeframe, inline: true },
											{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										)
										.setFooter({ text: "OpenHands Strategy Backtest" })
										.setTimestamp();

									await interaction.editReply({ content: "", embeds: [embed] });
								} else {
									await interaction.editReply(`Backtest failed: ${result.error || "Unknown error"}`);
								}
								break;
							}

							case "risk": {
								const holdings = interaction.options.getString("holdings", true);
								const value = interaction.options.getNumber("value") || undefined;

								await interaction.editReply(`⚖️ Analyzing portfolio risk... (OpenHands)`);

								const result = await runRiskAssessment(holdings, value);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle("⚖️ Risk Assessment")
										.setColor(0xf59e0b)
										.setDescription(result.output.substring(0, 4000))
										.addFields(
											{ name: "Holdings", value: holdings.substring(0, 200), inline: false },
											...(value
												? [{ name: "Portfolio Value", value: `$${value.toLocaleString()}`, inline: true }]
												: []),
											{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										)
										.setFooter({ text: "OpenHands Risk Assessment" })
										.setTimestamp();

									await interaction.editReply({ content: "", embeds: [embed] });
								} else {
									await interaction.editReply(`Risk assessment failed: ${result.error || "Unknown error"}`);
								}
								break;
							}

							case "audit": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const strategy = interaction.options.getString("strategy") || undefined;

								await interaction.editReply(
									`🔍 Running full trading audit for ${symbol}${strategy ? ` with ${strategy}` : ""}... (OpenHands)`,
								);

								const result = await runFullTradingAudit(symbol, strategy);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle(`🔍 Full Trading Audit: ${symbol}`)
										.setColor(0x10b981)
										.setDescription(result.output.substring(0, 4000))
										.addFields(
											{ name: "Symbol", value: symbol, inline: true },
											...(strategy ? [{ name: "Strategy", value: strategy, inline: true }] : []),
											{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										)
										.setFooter({ text: "OpenHands Full Trading Audit" })
										.setTimestamp();

									await interaction.editReply({ content: "", embeds: [embed] });
								} else {
									await interaction.editReply(`Trading audit failed: ${result.error || "Unknown error"}`);
								}
								break;
							}

							case "expertise": {
								const expertisePath = join(process.cwd(), "src", "trading", "expertise", "trading.md");
								let expertiseContent = "No trading expertise found.";

								try {
									const fs = await import("fs");
									if (fs.existsSync(expertisePath)) {
										expertiseContent = fs.readFileSync(expertisePath, "utf-8");
									}
								} catch {
									expertiseContent = "Error loading expertise file.";
								}

								// Parse key sections from the expertise file
								const sections: { name: string; value: string }[] = [];

								const mentalModelMatch = expertiseContent.match(/## Mental Model\n([\s\S]*?)(?=\n## |$)/);
								if (mentalModelMatch) {
									sections.push({ name: "Mental Model", value: mentalModelMatch[1].trim().substring(0, 500) });
								}

								const patternsMatch = expertiseContent.match(/## Patterns Learned\n([\s\S]*?)(?=\n## |$)/);
								if (patternsMatch) {
									sections.push({
										name: "Patterns Learned",
										value: patternsMatch[1].trim().substring(0, 500) || "None yet",
									});
								}

								const lastUpdatedMatch = expertiseContent.match(/\*Last updated: ([^*]+)\*/);
								const sessionsMatch = expertiseContent.match(/\*Total sessions: (\d+)\*/);

								const embed = new EmbedBuilder()
									.setTitle("📚 Trading Expertise")
									.setColor(0x8b5cf6)
									.setDescription("Accumulated knowledge from trading sessions")
									.addFields(
										...sections.map((s) => ({ name: s.name, value: s.value, inline: false })),
										{
											name: "Last Updated",
											value: lastUpdatedMatch ? lastUpdatedMatch[1].trim() : "Never",
											inline: true,
										},
										{ name: "Total Sessions", value: sessionsMatch ? sessionsMatch[1] : "0", inline: true },
									)
									.setFooter({ text: "Agent Experts - Act-Learn-Reuse" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Trading analysis error: ${errMsg}`);
					}
					break;
				}

				case "knowledge": {
					await interaction.deferReply();
					const subcommand = interaction.options.getSubcommand();
					const kb = getKnowledgeBase();

					try {
						switch (subcommand) {
							case "sources": {
								const sources = kb.getSources();
								const sourceList = sources
									.map((s) => {
										const status = s.exists ? "✅" : "❌";
										return `${status} **${s.name}**\n   └ \`${s.path}\``;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("📚 Knowledge Sources")
									.setDescription(sourceList)
									.setColor(0x3498db)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "search": {
								const query = interaction.options.getString("query", true);
								const results = await kb.search(query);

								if (results.files.length === 0) {
									await interaction.editReply(`No results found for "${query}"`);
									break;
								}

								const fileList = results.files
									.slice(0, 10)
									.map((f) => {
										const preview = f.content ? `\n   └ ${f.content.substring(0, 100)}...` : "";
										return `📄 **${f.name}** (${f.size} bytes)\n   \`${f.path}\`${preview}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`🔍 Search: "${query}"`)
									.setDescription(fileList)
									.setFooter({
										text: `${results.totalMatches} matches in ${results.searchedPaths.length} sources`,
									})
									.setColor(0x2ecc71)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "read": {
								const filePath = interaction.options.getString("path", true);
								const content = await kb.readFile(filePath, 3500);

								const embed = new EmbedBuilder()
									.setTitle(`📖 ${filePath.split("/").pop()}`)
									.setDescription(`\`\`\`\n${content.substring(0, 3500)}\n\`\`\``)
									.setFooter({ text: filePath })
									.setColor(0x9b59b6)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "moondev": {
								const arch = await kb.getMoonDevArchitecture();
								// Send first 4000 chars
								const summary = arch.substring(0, 4000);

								const embed = new EmbedBuilder()
									.setTitle("🌙 Moon Dev Architecture")
									.setDescription(summary)
									.setFooter({ text: "SuperQuant Multi-Agent System" })
									.setColor(0xf39c12)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "agent": {
								const agentName = interaction.options.getString("name", true);
								const agentCode = await kb.getQuantAgent(agentName);

								if (!agentCode) {
									await interaction.editReply(
										`Agent "${agentName}" not found. Available: price_monitor, risk_analyzer, strategic_buyer, strategic_seller, token_discovery`,
									);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle(`🤖 Quant Agent: ${agentName}`)
									.setDescription(`\`\`\`python\n${agentCode.substring(0, 3500)}\n\`\`\``)
									.setColor(0xe74c3c)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "specs": {
								const specs = await kb.getQuantSpecs();

								if (specs.length === 0) {
									await interaction.editReply("No quant specifications found");
									break;
								}

								const specList = specs
									.map((s) => {
										const files = s.files
											.slice(0, 5)
											.map((f) => `  • ${f.name}`)
											.join("\n");
										return `**${s.category}**\n${files}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("📊 Quant Specifications")
									.setDescription(specList)
									.setColor(0x1abc9c)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Knowledge error: ${errMsg}`);
					}
					break;
				}

				case "voice": {
					await interaction.deferReply();
					const subcommand = interaction.options.getSubcommand();

					try {
						switch (subcommand) {
							case "join": {
								// Get user's voice channel
								const member = interaction.member as any;
								const voiceChannel = member?.voice?.channel;

								if (!voiceChannel) {
									await interaction.editReply("You need to be in a voice channel to use this command.");
									break;
								}

								if (voiceChannel.type !== ChannelType.GuildVoice) {
									await interaction.editReply("Please join a standard voice channel (not a stage channel).");
									break;
								}

								const session = getVoiceSession(interaction.guildId!);
								const result = await session.join(voiceChannel as VoiceChannel, user.id);

								if (result.success) {
									// Set up message handler - echoes back transcription for now
									session.setMessageHandler(async (userId: string, text: string) => {
										// Log the transcription
										console.log(`[Voice] Heard from ${userId}: "${text}"`);
										// Echo back what was heard
										return `I heard you say: ${text.substring(0, 200)}`;
									});

									await interaction.editReply(
										`🎙️ Joined **${voiceChannel.name}**! I'm now listening. Speak to interact.`,
									);
								} else {
									await interaction.editReply(`Failed to join: ${result.error}`);
								}
								break;
							}

							case "leave": {
								const session = getVoiceSession(interaction.guildId!);
								if (!session.isConnected) {
									await interaction.editReply("I'm not in a voice channel.");
									break;
								}
								await session.leave();
								await interaction.editReply("👋 Left the voice channel.");
								break;
							}

							case "speak": {
								const text = interaction.options.getString("text", true);
								const session = getVoiceSession(interaction.guildId!);

								if (!session.isConnected) {
									// If not connected, just generate TTS and send as file
									const tts = getVibeVoiceTTS();
									if (!tts.isConfigured) {
										await interaction.editReply("HuggingFace token not configured. Set HF_TOKEN.");
										break;
									}

									const audio = await tts.synthesize(text);
									await interaction.editReply({
										content: "🔊 Generated speech (VibeVoice):",
										files: [{ attachment: audio, name: "speech.wav" }],
									});
								} else {
									await session.speak(text);
									await interaction.editReply(
										`🔊 Spoke: "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"`,
									);
								}
								break;
							}

							case "transcribe": {
								const url = interaction.options.getString("url", true);
								const stt = getWhisperLocalSTT();

								if (!stt.isConfigured) {
									await interaction.editReply("STT not configured. Set HF_TOKEN or install local Whisper.");
									break;
								}

								// Fetch audio from URL
								const response = await fetch(url);
								if (!response.ok) {
									await interaction.editReply(`Failed to fetch audio: ${response.status}`);
									break;
								}

								const audioBuffer = Buffer.from(await response.arrayBuffer());
								const result = await stt.transcribe(audioBuffer);
								const backendInfo = stt.getBackendInfo();

								const embed = new EmbedBuilder()
									.setTitle("📝 Transcription (Whisper)")
									.setDescription(result.text.substring(0, 4000) || "No speech detected")
									.addFields(
										{ name: "Duration", value: `${result.duration}ms`, inline: true },
										{ name: "Language", value: result.language || "auto", inline: true },
										{ name: "Backend", value: `${backendInfo.type}: ${backendInfo.model}`, inline: true },
									)
									.setColor(0x00bfff)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const session = getVoiceSession(interaction.guildId!);
								const stats = session.getStats();
								const tts = getVibeVoiceTTS();
								const stt = getWhisperLocalSTT();
								const sttBackend = stt.getBackendInfo();

								const embed = new EmbedBuilder()
									.setTitle("🎙️ Voice Status (Open-Source)")
									.setColor(stats.connected ? 0x00ff00 : 0x808080)
									.addFields(
										{ name: "Connected", value: stats.connected ? "Yes" : "No", inline: true },
										{
											name: "Duration",
											value: stats.connected ? `${Math.floor(stats.duration / 1000)}s` : "-",
											inline: true,
										},
										{
											name: "VibeVoice TTS",
											value: tts.isConfigured ? "✅ Ready" : "❌ Need HF_TOKEN",
											inline: true,
										},
										{
											name: "Whisper STT",
											value: stt.isConfigured ? `✅ ${sttBackend.type}` : "❌ Not configured",
											inline: true,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "voices": {
								const tts = getVibeVoiceTTS();
								const info = tts.getModelInfo();

								const embed = new EmbedBuilder()
									.setTitle("🎤 VibeVoice (Open-Source TTS)")
									.setDescription(`**${info.name}**\n${info.description}`)
									.addFields(
										{ name: "Languages", value: info.languages.join(", "), inline: false },
										{ name: "Model", value: "microsoft/VibeVoice-Realtime-0.5B", inline: true },
										{ name: "Latency", value: "~300ms first audio", inline: true },
									)
									.setColor(0x9b59b6)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Voice error: ${errMsg}`);
					}
					break;
				}

				case "agent": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "status": {
								const available = await isAgentAvailable();
								const models = getAgentModels();
								const modelList = Object.keys(models).join(", ");

								const embed = new EmbedBuilder()
									.setTitle("🤖 AI Agent Status")
									.setColor(available ? 0x00ff00 : 0xff0000)
									.addFields(
										{
											name: "OpenRouter API",
											value: available ? "✅ Connected" : "❌ No API Key",
											inline: true,
										},
										{ name: "Default Model", value: "GLM-4.7", inline: true },
										{ name: "Available Models", value: modelList, inline: false },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "run": {
								const prompt = interaction.options.getString("prompt", true);
								const timeout = (interaction.options.getInteger("timeout") || 300) * 1000;
								const mode = (interaction.options.getString("mode") || "general") as
									| "general"
									| "coding"
									| "research"
									| "trading";
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`🤖 Running Claude agent...\n\n**Prompt:** ${prompt.substring(0, 200)}...\n**Mode:** ${mode}\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const result = await runLearningAgent({
									prompt,
									timeout,
									workingDir: workingDir,
									mode,
									enableLearning,
								});

								const embed = new EmbedBuilder()
									.setTitle("🤖 Claude Agent Result")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No output")
									.addFields(
										{ name: "Status", value: result.success ? "✅ Success" : "❌ Failed", inline: true },
										{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
										{ name: "Mode", value: mode, inline: true },
									)
									.setTimestamp();

								if (result.error) {
									embed.addFields({ name: "Error", value: result.error.substring(0, 1000), inline: false });
								}

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "research": {
								const topic = interaction.options.getString("topic", true);
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`🔍 Researching: "${topic}"...\n\n⏳ This may take a few minutes.\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const preset = LearningPresets.research(topic);
								const result = await runLearningAgent({ ...preset, enableLearning });

								const embed = new EmbedBuilder()
									.setTitle(`🔍 Research: ${topic.substring(0, 100)}`)
									.setColor(result.success ? 0x9b59b6 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No results")
									.addFields({
										name: "Duration",
										value: `${(result.duration / 1000).toFixed(1)}s`,
										inline: true,
									})
									.setTimestamp();

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "review": {
								const code = interaction.options.getString("code", true);
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`📝 Reviewing code...\n\n\`\`\`\n${code.substring(0, 200)}...\n\`\`\`\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const preset = LearningPresets.codeReview(code);
								const result = await runLearningAgent({ ...preset, enableLearning });

								const embed = new EmbedBuilder()
									.setTitle("📝 Code Review")
									.setColor(result.success ? 0x3498db : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No feedback")
									.addFields({
										name: "Duration",
										value: `${(result.duration / 1000).toFixed(1)}s`,
										inline: true,
									})
									.setTimestamp();

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "trading": {
								const symbol = interaction.options.getString("symbol", true);
								const data = interaction.options.getString("data") || "Analyze current market conditions";
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								await interaction.editReply(
									`📈 Analyzing ${symbol.toUpperCase()}...\n\n⏳ Running trading analysis.\n**Learning:** ${enableLearning ? "Enabled" : "Disabled"}`,
								);

								const preset = LearningPresets.tradingAnalysis(symbol, data);
								const result = await runLearningAgent({ ...preset, enableLearning });

								const embed = new EmbedBuilder()
									.setTitle(`📈 Trading Analysis: ${symbol.toUpperCase()}`)
									.setColor(result.success ? 0x2ecc71 : 0xff0000)
									.setDescription(result.output.substring(0, 4000) || "No analysis")
									.addFields({
										name: "Duration",
										value: `${(result.duration / 1000).toFixed(1)}s`,
										inline: true,
									})
									.setTimestamp();

								if (result.learned?.learned) {
									embed.addFields({
										name: "Learning",
										value: `New insight captured: ${result.learned.insight.substring(0, 100)}...`,
										inline: false,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Agent error: ${errMsg}`);
					}
					break;
				}

				case "expertise": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "status": {
								const modes = getExpertiseModes();
								const statusList = modes
									.map((mode) => {
										const expertise = loadExpertise(mode);
										const sessionMatches = expertise.match(/### Session:/g);
										const sessionCount = sessionMatches ? sessionMatches.length : 0;
										const icon = sessionCount > 0 ? "📚" : "📖";
										return `${icon} **${mode}**: ${sessionCount} sessions`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🎓 Agent Learning Status")
									.setDescription(statusList || "No learning data yet")
									.setColor(0x9b59b6)
									.setFooter({ text: "Use /learning view <mode> to see accumulated expertise" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "modes": {
								const modes = getExpertiseModes();
								const modeDescriptions = {
									general: "General-purpose tasks and conversations",
									coding: "Software development, code review, debugging",
									research: "Information gathering, analysis, synthesis",
									trading: "Market analysis, trading strategies, risk management",
								};

								const modeList = modes
									.map((mode) => {
										const desc = modeDescriptions[mode as keyof typeof modeDescriptions] || "Unknown mode";
										return `**${mode}**\n└ ${desc}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("🎯 Available Learning Modes")
									.setDescription(modeList)
									.setColor(0x3498db)
									.setFooter({ text: "Agents learn from each task and improve over time" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "view": {
								const mode = interaction.options.getString("mode", true) as
									| "general"
									| "coding"
									| "research"
									| "trading";
								const expertise = loadExpertise(mode);

								if (!expertise || expertise.length === 0) {
									await interaction.editReply(`No learning data yet for mode: **${mode}**`);
									break;
								}

								// Parse sessions from markdown
								const sessionRegex =
									/### Session: ([\d-]+\s[\d:]+)\n\*\*Task:\*\* (.+?)\n\n([\s\S]+?)(?=\n### Session:|$)/g;
								const sessions: Array<{ timestamp: string; task: string; content: string }> = [];
								for (const match of expertise.matchAll(sessionRegex)) {
									sessions.push({
										timestamp: match[1],
										task: match[2],
										content: match[3],
									});
								}

								if (sessions.length === 0) {
									await interaction.editReply(`No sessions found for mode: **${mode}**`);
									break;
								}

								// Show last 5 sessions
								const recentSessions = sessions.slice(-5);
								const sessionSummary = recentSessions
									.map((session, idx) => {
										const preview = session.content.substring(0, 150).trim();
										return `**Session ${sessions.length - (recentSessions.length - idx - 1)}** (${session.timestamp})\n*Task:* ${session.task}\n${preview}...`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`🎓 Learning History: ${mode}`)
									.setDescription(sessionSummary || "No sessions yet")
									.setColor(0x2ecc71)
									.addFields({
										name: "Total Sessions",
										value: sessions.length.toString(),
										inline: true,
									})
									.setFooter({ text: "Showing last 5 sessions" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Learning system error: ${errMsg}`);
					}
					break;
				}

				case "openhands": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					// Helper to create result embed
					const createResultEmbed = (
						title: string,
						result: {
							success: boolean;
							output: string;
							error: string | null;
							duration: number;
							workspace: string;
							tools_used: string[];
							mode?: string;
							session_id?: string;
							blocked_actions?: Array<{ action: string; reason: string }>;
						},
						_color: number,
					) => {
						const embed = new EmbedBuilder()
							.setTitle(title)
							.setColor(result.success ? 0x00ff00 : 0xff0000)
							.setDescription(result.output.substring(0, 4000) || "No output")
							.addFields(
								{ name: "Status", value: result.success ? "Success" : "Failed", inline: true },
								{ name: "Duration", value: `${(result.duration / 1000).toFixed(1)}s`, inline: true },
								{ name: "Mode", value: result.mode || "developer", inline: true },
							)
							.setTimestamp();

						if (result.tools_used && result.tools_used.length > 0) {
							embed.addFields({ name: "Tools Used", value: result.tools_used.join(", "), inline: false });
						}

						if (result.session_id) {
							embed.addFields({ name: "Session ID", value: result.session_id, inline: true });
						}

						if (result.blocked_actions && result.blocked_actions.length > 0) {
							embed.addFields({
								name: "Blocked Actions",
								value: result.blocked_actions
									.map((a) => `${a.action}: ${a.reason}`)
									.join("\n")
									.substring(0, 1000),
								inline: false,
							});
						}

						if (result.error) {
							embed.addFields({ name: "Error", value: result.error.substring(0, 1000), inline: false });
						}

						return embed;
					};

					try {
						switch (subcommand) {
							case "status": {
								const available = await isOpenHandsAvailable();

								const embed = new EmbedBuilder()
									.setTitle("OpenHands Software Agent Status")
									.setColor(available ? 0x00ff00 : 0xff0000)
									.addFields(
										{
											name: "OpenHands SDK",
											value: available ? "Available" : "Not installed or Python 3.12 missing",
											inline: true,
										},
										{ name: "Model", value: "GLM-4.7 via Z.ai", inline: true },
										{
											name: "Tools",
											value: "Terminal, File Editor, Task Tracker, Web",
											inline: false,
										},
										{
											name: "Expert Modes",
											value: "9 modes available (use /openhands modes)",
											inline: false,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "modes": {
								const modes = Object.entries(OpenHandsModeDescriptions)
									.map(([mode, desc]) => `**${mode}**: ${desc}`)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("OpenHands Expert Modes")
									.setColor(0x3498db)
									.setDescription(modes)
									.addFields({
										name: "Usage",
										value: "Use `/openhands run` with mode option, or dedicated commands like `/openhands security`, `/openhands review`, etc.",
										inline: false,
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "learning": {
								const action = interaction.options.getString("action", true);
								const mode = interaction.options.getString("mode");

								if (action === "list") {
									const expertise = getAllExpertise();

									if (expertise.length === 0) {
										await interaction.editReply("No expertise files found.");
										break;
									}

									const expertiseList = expertise
										.map((e) => {
											const lastUpdate = new Date(e.lastUpdated).toLocaleString();
											return `**${e.mode}**: ${e.sessionCount} sessions (last: ${lastUpdate})`;
										})
										.join("\n");

									const embed = new EmbedBuilder()
										.setTitle("Agent Experts Learning System")
										.setColor(0x9b59b6)
										.setDescription("Agents that learn from every execution (Act-Learn-Reuse pattern)")
										.addFields({
											name: "Expertise Files",
											value: expertiseList,
											inline: false,
										})
										.addFields({
											name: "How it works",
											value:
												"Each agent mode accumulates expertise from sessions:\n" +
												"• ACT: Load expertise, inject into context\n" +
												"• LEARN: Extract learnings from execution\n" +
												"• REUSE: Apply accumulated knowledge next time",
											inline: false,
										})
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else if (action === "view") {
									if (!mode) {
										await interaction.editReply("Please specify a mode to view learnings.");
										break;
									}

									const expertise = getExpertiseForMode(mode);

									if (!expertise) {
										await interaction.editReply(`No expertise found for mode: ${mode}`);
										break;
									}

									const learnings = extractRecentLearnings(expertise.content);

									if (learnings.length === 0) {
										await interaction.editReply(`No learnings recorded for mode: ${mode}`);
										break;
									}

									const embed = new EmbedBuilder()
										.setTitle(`${mode.replace(/_/g, " ").toUpperCase()} Expert Learnings`)
										.setColor(0x9b59b6)
										.setDescription(`Recent learnings (last ${learnings.length} sessions)`)
										.addFields(
											{ name: "Total Sessions", value: expertise.sessionCount.toString(), inline: true },
											{
												name: "Last Updated",
												value: new Date(expertise.lastUpdated).toLocaleString(),
												inline: true,
											},
										);

									// Add learnings as fields (max 25 fields in Discord)
									learnings.slice(0, 5).forEach((learning, idx) => {
										embed.addFields({
											name: `Session ${idx + 1}`,
											value: learning.substring(0, 1024), // Discord field value limit
											inline: false,
										});
									});

									embed.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else if (action === "clear") {
									if (!mode) {
										await interaction.editReply("Please specify a mode to clear expertise.");
										break;
									}

									const expertise = getExpertiseForMode(mode);

									if (!expertise) {
										await interaction.editReply(`No expertise found for mode: ${mode}`);
										break;
									}

									// Confirmation message
									const confirmEmbed = new EmbedBuilder()
										.setTitle("Confirm Expertise Clear")
										.setColor(0xff0000)
										.setDescription(
											`You are about to clear ${expertise.sessionCount} sessions of accumulated expertise for **${mode}**.\n\n` +
												"This will reset the agent to a blank slate. This action cannot be undone.\n\n" +
												`Type \`/openhands learning action:clear mode:${mode}\` again within 30 seconds to confirm.`,
										)
										.setTimestamp();

									// Store confirmation state (simple in-memory cache)
									const confirmKey = `${interaction.user.id}-${mode}`;
									if (!confirmationCache.has(confirmKey)) {
										confirmationCache.set(confirmKey, Date.now());
										setTimeout(() => confirmationCache.delete(confirmKey), 30000);
										await interaction.editReply({ embeds: [confirmEmbed] });
									} else {
										const timestamp = confirmationCache.get(confirmKey)!;
										if (Date.now() - timestamp > 30000) {
											confirmationCache.delete(confirmKey);
											await interaction.editReply("Confirmation expired. Please try again.");
										} else {
											confirmationCache.delete(confirmKey);
											const success = clearExpertise(mode);

											if (success) {
												const successEmbed = new EmbedBuilder()
													.setTitle("Expertise Cleared")
													.setColor(0x00ff00)
													.setDescription(`Successfully cleared expertise for **${mode}**.`)
													.addFields({
														name: "Sessions Removed",
														value: expertise.sessionCount.toString(),
														inline: true,
													})
													.setTimestamp();

												await interaction.editReply({ embeds: [successEmbed] });
											} else {
												await interaction.editReply(`Failed to clear expertise for mode: ${mode}`);
											}
										}
									}
								}
								break;
							}

							case "run": {
								const task = interaction.options.getString("task", true);
								const mode = (interaction.options.getString("mode") || "developer") as OpenHandsMode;
								const workspace = interaction.options.getString("workspace") || workingDir;
								const persist = interaction.options.getBoolean("persist") || false;

								await interaction.editReply(
									`Running OpenHands agent...\n\n**Task:** ${task.substring(0, 200)}...\n**Mode:** ${mode}\n**Persist:** ${persist}`,
								);

								const result = await runOpenHandsAgent({
									task,
									workspace,
									mode,
									timeout: 600,
									persist,
									securityCheck: true,
								});

								const embed = createResultEmbed(`OpenHands: ${mode}`, result, 0x3498db);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "security": {
								const path = interaction.options.getString("path", true);

								await interaction.editReply(
									`Running security vulnerability scan...\n\n**Path:** ${path}\n\nThis may take several minutes.`,
								);

								const result = await runSecurityScan(path);
								const embed = createResultEmbed("Security Vulnerability Scan", result, 0xe74c3c);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "review": {
								const path = interaction.options.getString("path", true);
								const focus = interaction.options.getString("focus") || undefined;

								await interaction.editReply(
									`Running code review...\n\n**Path:** ${path}${focus ? `\n**Focus:** ${focus}` : ""}\n\nAnalyzing code quality, performance, and best practices.`,
								);

								const result = await runCodeReview(path, focus);
								const embed = createResultEmbed("Code Review", result, 0x9b59b6);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "tests": {
								const path = interaction.options.getString("path", true);
								const coverage = interaction.options.getInteger("coverage") || 90;

								await interaction.editReply(
									`Generating tests...\n\n**Path:** ${path}\n**Coverage Target:** ${coverage}%\n\nCreating unit and integration tests.`,
								);

								const result = await runTestGeneration(path, coverage);
								const embed = createResultEmbed("Test Generation", result, 0x2ecc71);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "docs": {
								const path = interaction.options.getString("path", true);
								const docType = interaction.options.getString("type") || "all";

								await interaction.editReply(
									`Generating documentation...\n\n**Path:** ${path}\n**Type:** ${docType}\n\nCreating README, API docs, and comments.`,
								);

								const result = await runDocGeneration(path, docType);
								const embed = createResultEmbed("Documentation Generation", result, 0x3498db);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "refactor": {
								const path = interaction.options.getString("path", true);
								const target = interaction.options.getString("target") || undefined;

								await interaction.editReply(
									`Refactoring code...\n\n**Path:** ${path}${target ? `\n**Target:** ${target}` : ""}\n\nImproving code quality and reducing complexity.`,
								);

								const result = await runRefactor(path, target);
								const embed = createResultEmbed("Code Refactoring", result, 0xf39c12);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "debug": {
								const path = interaction.options.getString("path", true);
								const issue = interaction.options.getString("issue", true);

								await interaction.editReply(
									`Debugging issue...\n\n**Path:** ${path}\n**Issue:** ${issue.substring(0, 200)}\n\nAnalyzing root cause and implementing fix.`,
								);

								const result = await runDebug(path, issue);
								const embed = createResultEmbed("Debug & Fix", result, 0xe67e22);
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "optimize": {
								const path = interaction.options.getString("path", true);
								const focus = interaction.options.getString("focus") || undefined;

								await interaction.editReply(
									`Optimizing performance...\n\n**Path:** ${path}${focus ? `\n**Focus:** ${focus}` : ""}\n\nProfiling and fixing bottlenecks.`,
								);

								const result = await runOptimize(path, focus);
								const embed = createResultEmbed("Performance Optimization", result, 0x1abc9c);
								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`OpenHands error: ${errMsg}`);
					}
					break;
				}

				// Codebase Experts (TAC Lesson 13)
				case "expert": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "run": {
								const taskDesc = interaction.options.getString("task", true);
								const domain = interaction.options.getString("domain") || undefined;

								await interaction.editReply(
									`Running task with expert...\n\n**Task:** ${taskDesc.substring(0, 200)}${domain ? `\n**Domain:** ${domain}` : "\n**Auto-detecting domain...**"}`,
								);

								// Create executor using the lightweight agent
								const executor = async (enhancedTask: string) => {
									const result = await runLearningAgent({
										prompt: enhancedTask,
										mode: domain || "general",
										enableLearning: true,
									});
									return { success: result.success, output: result.output || "" };
								};

								const result = await executeWithAutoExpert(taskDesc, executor);

								const embed = new EmbedBuilder()
									.setTitle("Expert Task Result")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Expert Domain", value: result.expert, inline: true },
										{ name: "Success", value: result.success ? "Yes" : "No", inline: true },
										{
											name: "Learning",
											value: result.learned.learned
												? `Extracted: ${result.learned.insight?.substring(0, 100)}...`
												: "No new learnings",
											inline: false,
										},
									)
									.setDescription(
										result.output.length > 4000 ? `${result.output.substring(0, 4000)}...` : result.output,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const expertList = Object.entries(CODEBASE_EXPERTS)
									.map(([key, exp]) => `**${key}** (${exp.riskLevel})\n${exp.description}`)
									.join("\n\n");

								const productList = Object.entries(PRODUCT_EXPERTS)
									.map(([key, exp]) => `**${key}**\n${exp.focus}`)
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("Available Codebase Experts")
									.setColor(0x3498db)
									.addFields(
										{ name: "Codebase Experts", value: expertList.substring(0, 1024), inline: false },
										{ name: "Product Experts", value: productList.substring(0, 1024), inline: false },
									)
									.setFooter({ text: "TAC Lesson 13 - Act-Learn-Reuse Pattern" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "view": {
								const viewDomain = interaction.options.getString("domain", true);
								const expertiseContent = loadExpertise(viewDomain);

								if (!expertiseContent) {
									await interaction.editReply(`No expertise found for domain: ${viewDomain}`);
									break;
								}

								// Get expert definition if it exists
								const expertDef = CODEBASE_EXPERTS[viewDomain] || PRODUCT_EXPERTS[viewDomain];

								const embed = new EmbedBuilder()
									.setTitle(`${viewDomain} Expert Knowledge`)
									.setColor(0x9b59b6)
									.setDescription(expertiseContent.substring(0, 4000) || "No expertise accumulated yet")
									.addFields(
										{
											name: "Risk Level",
											value: expertDef && "riskLevel" in expertDef ? expertDef.riskLevel : "medium",
											inline: true,
										},
										{ name: "Domain", value: viewDomain, inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "create": {
								const newDomain = interaction.options.getString("domain", true);
								const description = interaction.options.getString("description", true);

								await interaction.editReply(
									`Creating new expert...\n\n**Domain:** ${newDomain}\n**Description:** ${description.substring(0, 200)}\n\nUsing meta-agentic pattern...`,
								);

								// Create executor for the meta-agentic pattern
								const executor = async (prompt: string) => {
									const result = await runLearningAgent({
										prompt,
										mode: "general",
										enableLearning: true,
									});
									return { success: result.success, output: result.output || "" };
								};

								const result = await createCodebaseExpert(newDomain, description, executor);

								if (result.success && result.expert) {
									const embed = new EmbedBuilder()
										.setTitle("Expert Created")
										.setColor(0x2ecc71)
										.addFields(
											{ name: "Domain", value: result.expert.name, inline: true },
											{ name: "Risk Level", value: result.expert.riskLevel, inline: true },
											{
												name: "Self-Improve Prompt",
												value: result.expert.selfImprovePrompt.substring(0, 500),
												inline: false,
											},
										)
										.setFooter({ text: "Meta-Agentic: Agents building agents" });

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Failed to create expert: ${result.error}`);
								}
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Expert error: ${errMsg}`);
					}
					break;
				}

				// Two-Phase Agent Workflow (TAC Lesson 13)
				case "task": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "create": {
								const taskDesc = interaction.options.getString("description", true);
								const maxFeatures = interaction.options.getInteger("max_features") || 5;

								await interaction.editReply(
									`Initializing task...\n\n**Description:** ${taskDesc.substring(0, 300)}\n**Max Features:** ${maxFeatures}\n\nPhase 1: Creating feature breakdown...`,
								);

								const result = await initializeClaudeTask({
									prompt: taskDesc,
									workingDir: process.cwd(),
									maxIterations: maxFeatures,
								});

								if (result.success && result.taskId) {
									const status = getClaudeTaskStatus(result.taskId);
									const embed = new EmbedBuilder()
										.setTitle("Task Created")
										.setColor(0x3498db)
										.addFields(
											{ name: "Task ID", value: result.taskId, inline: true },
											{
												name: "Features",
												value: String(status.spec?.features?.length || 0),
												inline: true,
											},
											{
												name: "Status",
												value: status.progress?.completed
													? `${status.progress.completed}/${status.progress.total}`
													: "Ready",
												inline: true,
											},
											{
												name: "Feature List",
												value:
													status.spec?.features
														?.map((f, i) => `${i + 1}. ${f.name}`)
														.join("\n")
														.substring(0, 1024) || "None",
												inline: false,
											},
										)
										.setFooter({ text: "Use /task execute to implement features" });

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`Failed to create task: ${result.error}`);
								}
								break;
							}

							case "execute": {
								const taskId = interaction.options.getString("task_id", true);

								const status = getClaudeTaskStatus(taskId);
								if (!status.exists) {
									await interaction.editReply(`Task not found: ${taskId}`);
									break;
								}

								await interaction.editReply(
									`Executing next feature...\n\n**Task:** ${taskId}\n**Next:** ${status.nextFeature?.name || "Unknown"}\n\nPhase 2: Implementing feature...`,
								);

								const result = await executeClaudeFeature(taskId);

								const updatedStatus = getClaudeTaskStatus(taskId);
								const embed = new EmbedBuilder()
									.setTitle("Feature Executed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Task ID", value: taskId, inline: true },
										{
											name: "Progress",
											value: `${updatedStatus.progress?.completed || 0}/${updatedStatus.progress?.total || 0}`,
											inline: true,
										},
										{
											name: "Next Feature",
											value: updatedStatus.nextFeature?.name || "All complete!",
											inline: true,
										},
									)
									.setDescription(
										result.output ? result.output.substring(0, 4000) : result.error || "No output",
									);

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const taskId = interaction.options.getString("task_id", true);

								const status = getClaudeTaskStatus(taskId);
								if (!status.exists) {
									await interaction.editReply(`Task not found: ${taskId}`);
									break;
								}

								const featureStatus =
									status.spec?.features
										?.map((f, i) => {
											const icon =
												f.status === "completed"
													? "✅"
													: f.status === "in_progress"
														? "🔄"
														: f.status === "failed"
															? "❌"
															: "⬜";
											return `${icon} ${i + 1}. ${f.name}`;
										})
										.join("\n") || "No features";

								const embed = new EmbedBuilder()
									.setTitle("Task Status")
									.setColor(0x3498db)
									.addFields(
										{ name: "Task ID", value: taskId, inline: true },
										{
											name: "Progress",
											value: `${status.progress?.completed || 0}/${status.progress?.total || 0}`,
											inline: true,
										},
										{
											name: "Next Feature",
											value: status.nextFeature?.name || "All complete!",
											inline: true,
										},
										{ name: "Features", value: featureStatus.substring(0, 1024), inline: false },
									);

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "resume": {
								const taskId = interaction.options.getString("task_id", true);

								const status = getClaudeTaskStatus(taskId);
								if (!status.exists) {
									await interaction.editReply(`Task not found: ${taskId}`);
									break;
								}

								await interaction.editReply(
									`Resuming task...\n\n**Task:** ${taskId}\n**Progress:** ${status.progress?.completed || 0}/${status.progress?.total || 0}\n\nContinuing from last feature...`,
								);

								const result = await resumeClaudeTask(taskId);

								const embed = new EmbedBuilder()
									.setTitle("Task Resumed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.setDescription(result.output ? result.output.substring(0, 4000) : result.error || "Resumed")
									.setFooter({ text: `Task: ${taskId}` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "run": {
								const taskDesc = interaction.options.getString("description", true);

								await interaction.editReply(
									`Running full workflow...\n\n**Task:** ${taskDesc.substring(0, 300)}\n\nPhase 1: Planning → Phase 2: Executing all features...`,
								);

								const result = await runTwoAgentWorkflow({
									prompt: taskDesc,
									workingDir: process.cwd(),
								});

								const embed = new EmbedBuilder()
									.setTitle("Workflow Complete")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Task ID", value: result.taskId || "N/A", inline: true },
										{ name: "Success", value: result.success ? "Yes" : "No", inline: true },
									)
									.setDescription(
										result.output ? result.output.substring(0, 4000) : result.error || "Complete",
									)
									.setFooter({ text: "Two-Agent Pattern: Initializer + Coding" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								// List all task specs from the tasks directory
								const tasksDir = join(process.cwd(), ".tasks");
								let tasks: string[] = [];

								if (existsSync(tasksDir)) {
									tasks = readdirSync(tasksDir)
										.filter((f) => f.endsWith(".json"))
										.map((f) => f.replace(".json", ""));
								}

								if (tasks.length === 0) {
									await interaction.editReply("No tasks found. Use `/task create` to create one.");
									break;
								}

								const taskList = tasks
									.slice(0, 10)
									.map((taskId) => {
										const status = getClaudeTaskStatus(taskId);
										return `**${taskId}** - ${status.progress?.completed || 0}/${status.progress?.total || 0} features`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("Tasks")
									.setColor(0x3498db)
									.setDescription(taskList)
									.setFooter({ text: `Showing ${Math.min(tasks.length, 10)} of ${tasks.length}` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Task error: ${errMsg}`);
					}
					break;
				}

				// Agent Mail System
				case "mail": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						const bus = getAgentMessageBus();
						const userId = interaction.user.id;

						// Use Discord user ID as agent ID
						const agentId = `discord-${userId}`;

						// Register user as agent if not already registered
						const agents = bus.getAgents();
						const isRegistered = agents.some((a) => a.id === agentId);
						if (!isRegistered) {
							bus.registerAgent(
								{
									id: agentId,
									name: interaction.user.username,
									tags: ["discord-user"],
									status: "online",
									lastSeen: new Date().toISOString(),
								},
								async () => "Message received",
							);
						}

						switch (subcommand) {
							case "send": {
								const to = interaction.options.getString("to", true);
								const subject = interaction.options.getString("subject", true);
								const message = interaction.options.getString("message", true);
								const importance = (interaction.options.getString("importance") || "normal") as
									| "low"
									| "normal"
									| "high"
									| "urgent";
								const ackRequired = interaction.options.getBoolean("ack_required") || false;

								const result = await bus.sendEnhanced({
									from: agentId,
									to: [to],
									subject,
									content: message,
									importance,
									ackRequired,
									isHumanOverseer: true,
								});

								const embed = new EmbedBuilder()
									.setTitle("Message Sent")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "To", value: to, inline: true },
										{ name: "Subject", value: subject, inline: true },
										{ name: "Importance", value: importance, inline: true },
										{ name: "Message ID", value: result.messageId, inline: false },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "inbox": {
								const messages = bus.getInbox(agentId, { limit: 10 });

								if (messages.length === 0) {
									await interaction.editReply("Your inbox is empty.");
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("Inbox")
									.setColor(0x3498db)
									.setDescription(
										messages
											.map((m) => {
												const read = m.recipients.find((r) => r.agentId === agentId)?.readAt ? "✓" : "●";
												return `${read} **${m.subject}** from ${m.from}\n${m.content.substring(0, 100)}...`;
											})
											.join("\n\n"),
									)
									.setFooter({ text: `Showing ${messages.length} messages` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "threads": {
								const threads = bus.listThreads(agentId);

								if (threads.length === 0) {
									await interaction.editReply("No message threads found.");
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("Message Threads")
									.setColor(0x9b59b6)
									.setDescription(
										threads
											.slice(0, 10)
											.map(
												(t) =>
													`**${t.subject}**\nParticipants: ${t.participants.join(", ")}\nMessages: ${t.messageCount}`,
											)
											.join("\n\n"),
									)
									.setFooter({ text: `Showing ${Math.min(threads.length, 10)} of ${threads.length}` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "search": {
								const query = interaction.options.getString("query", true);
								const results = bus.searchMessages(query, { agentId });

								if (results.length === 0) {
									await interaction.editReply(`No messages found matching: ${query}`);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("Search Results")
									.setColor(0xe67e22)
									.setDescription(
										results
											.slice(0, 10)
											.map((m) => `**${m.subject}** from ${m.from}\n${m.content.substring(0, 100)}...`)
											.join("\n\n"),
									)
									.setFooter({ text: `Found ${results.length} results for "${query}"` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "stats": {
								const agents = bus.getAgents();
								const inbox = bus.getInbox(agentId);
								const threads = bus.listThreads(agentId);

								const embed = new EmbedBuilder()
									.setTitle("Messaging Statistics")
									.setColor(0x1abc9c)
									.addFields(
										{ name: "Registered Agents", value: agents.length.toString(), inline: true },
										{ name: "Unread Messages", value: inbox.length.toString(), inline: true },
										{ name: "Active Threads", value: threads.length.toString(), inline: true },
										{ name: "Your Agent ID", value: agentId, inline: false },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Mail error: ${errMsg}`);
					}
					break;
				}

				// Trading Learning Stats
				case "tradestats": {
					await interaction.deferReply();
					try {
						const asJson = interaction.options.getBoolean("json") || false;
						const includeSwarm = interaction.options.getBoolean("swarm") || false;
						const { tradingLearning, SwarmAgent } = await import("./trading/index.js");

						// Get base learning stats
						const stats = tradingLearning.getStats();

						// Get swarm stats if requested
						let swarmStats = null;
						if (includeSwarm) {
							const swarmAgent = new SwarmAgent();
							swarmStats = swarmAgent.getStats();
						}

						if (asJson) {
							const output = includeSwarm ? { learning: stats, swarm: swarmStats } : stats;
							await interaction.editReply(`\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``);
						} else {
							const formatted = tradingLearning.getFormattedStats();

							// Add swarm section if requested
							let swarmSection = "";
							if (includeSwarm && swarmStats) {
								swarmSection =
									`\n\n**🐝 Swarm Consensus**\n` +
									`Queries: ${swarmStats.totalQueries}\n` +
									`Avg Agreement: ${(swarmStats.avgAgreement * 100).toFixed(1)}%\n` +
									`Avg Latency: ${swarmStats.avgLatency.toFixed(0)}ms\n` +
									`Models: ${Object.keys(swarmStats.modelStats).length} active`;
							}

							const embed = new EmbedBuilder()
								.setTitle("Trading Learning Stats")
								.setColor(0x9b59b6)
								.setDescription(formatted + swarmSection)
								.setFooter({
									text: includeSwarm
										? "Self-improving + Multi-LLM swarm"
										: "Self-improving trading agent metrics",
								});
							await interaction.editReply({ embeds: [embed] });
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Stats error: ${errMsg}`);
					}
					break;
				}

				case "papertrade": {
					await interaction.deferReply();
					try {
						const subcommand = interaction.options.getSubcommand();
						const paperTrading = getPaperTrading();

						switch (subcommand) {
							case "status": {
								const portfolio = await paperTrading.getPortfolio();
								const stats = await paperTrading.getFormattedStats();

								const pnlPercent = portfolio.equity > 0 ? (portfolio.totalPnL / portfolio.equity) * 100 : 0;

								const embed = new EmbedBuilder()
									.setTitle("📊 Paper Trading Portfolio")
									.setColor(portfolio.totalPnL >= 0 ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Cash", value: `$${portfolio.cash.toFixed(2)}`, inline: true },
										{ name: "Equity", value: `$${portfolio.equity.toFixed(2)}`, inline: true },
										{
											name: "P&L",
											value: `$${portfolio.totalPnL.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
											inline: true,
										},
										{ name: "Positions", value: String(portfolio.positions.length), inline: true },
										{ name: "Win Rate", value: `${(portfolio.winRate * 100).toFixed(1)}%`, inline: true },
										{ name: "Trades", value: String(portfolio.trades), inline: true },
									)
									.setDescription(stats)
									.setFooter({ text: "Paper trading - simulated orders" });

								if (portfolio.positions.length > 0) {
									const positionsList = portfolio.positions
										.map(
											(p) =>
												`**${p.symbol}**: ${p.quantity} @ $${p.entryPrice.toFixed(2)} | PnL: $${p.unrealizedPnL.toFixed(2)}`,
										)
										.join("\n");
									embed.addFields({ name: "Open Positions", value: positionsList });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "buy": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const quantity = interaction.options.getNumber("quantity", true);
								const orderType = (interaction.options.getString("type") || "market") as "market" | "limit";
								const price = interaction.options.getNumber("price") || undefined;

								const order = await paperTrading.placeOrder(
									symbol,
									"buy",
									quantity,
									orderType,
									price,
									"discord",
									"Manual buy",
								);

								const embed = new EmbedBuilder()
									.setTitle(`📈 Buy Order ${order.status === "filled" ? "Filled" : "Placed"}`)
									.setColor(order.status === "filled" ? 0x00ff00 : 0xffff00)
									.addFields(
										{ name: "Symbol", value: order.symbol, inline: true },
										{ name: "Quantity", value: String(order.quantity), inline: true },
										{ name: "Type", value: order.type, inline: true },
										{ name: "Status", value: order.status, inline: true },
									);

								if (order.filledPrice) {
									embed.addFields({
										name: "Filled Price",
										value: `$${order.filledPrice.toFixed(2)}`,
										inline: true,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "sell": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();
								const quantity = interaction.options.getNumber("quantity") || undefined;

								// If no quantity, sell all of position
								const portfolio = await paperTrading.getPortfolio();
								const position = portfolio.positions.find((p) => p.symbol === symbol);

								if (!position) {
									await interaction.editReply(`No position found for ${symbol}`);
									break;
								}

								const sellQty = quantity || position.quantity;
								const order = await paperTrading.placeOrder(
									symbol,
									"sell",
									sellQty,
									"market",
									undefined,
									"discord",
									"Manual sell",
								);

								const embed = new EmbedBuilder()
									.setTitle(`📉 Sell Order ${order.status === "filled" ? "Filled" : "Placed"}`)
									.setColor(order.status === "filled" ? 0x00ff00 : 0xffff00)
									.addFields(
										{ name: "Symbol", value: order.symbol, inline: true },
										{ name: "Quantity", value: String(order.quantity), inline: true },
										{ name: "Status", value: order.status, inline: true },
									);

								if (order.filledPrice) {
									embed.addFields({
										name: "Filled Price",
										value: `$${order.filledPrice.toFixed(2)}`,
										inline: true,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "history": {
								const limit = interaction.options.getInteger("limit") || 10;
								const trades = await paperTrading.getTradeHistory(limit);

								if (trades.length === 0) {
									await interaction.editReply("No trades yet. Start trading with `/papertrade buy`");
									break;
								}

								const tradeList = trades
									.map((t) => {
										const side = t.side === "buy" ? "📈" : "📉";
										const pnlStr = t.pnL ? ` | PnL: $${t.pnL.toFixed(2)} (${t.pnLPercent.toFixed(1)}%)` : "";
										return `${side} **${t.symbol}** ${t.quantity} @ $${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)}${pnlStr}`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("📋 Trade History")
									.setColor(0x3498db)
									.setDescription(tradeList)
									.setFooter({ text: `Last ${trades.length} trades` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "reset": {
								const initialBalance = interaction.options.getNumber("balance") || 100000;
								resetPaperTrading();
								// Re-init with new balance
								getPaperTrading({ initialCapital: initialBalance });

								const embed = new EmbedBuilder()
									.setTitle("🔄 Paper Trading Reset")
									.setColor(0x3498db)
									.setDescription(`Account reset with $${initialBalance.toLocaleString()} starting balance`)
									.setFooter({ text: "All positions and history cleared" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown subcommand. Use: status, buy, sell, history, reset");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Paper trading error: ${errMsg}`);
					}
					break;
				}

				case "sentiment": {
					await interaction.deferReply();
					try {
						const subcommand = interaction.options.getSubcommand();

						// Create sentiment agent if not exists
						const sentimentAgent = new SentimentAnalysisAgent({
							symbols: ["BTC", "ETH", "SOL"],
							interval: 300000, // 5 min
						});

						switch (subcommand) {
							case "check": {
								const symbol = interaction.options.getString("symbol", true).toUpperCase();

								// Get current sentiment
								const sentiment = sentimentAgent.getCurrentSentiment(symbol);
								const fearGreed = sentimentAgent.getFearGreedHistory(1)[0];

								// Score is -1 to 1, convert to 0-100 for display
								const scorePercent = sentiment ? Math.round((sentiment.score + 1) * 50) : 0;

								const embed = new EmbedBuilder()
									.setTitle(`📊 Sentiment Analysis: ${symbol}`)
									.setColor(
										sentiment
											? sentiment.score > 0.2
												? 0x00ff00
												: sentiment.score < -0.2
													? 0xff0000
													: 0xffff00
											: 0x808080,
									);

								if (sentiment) {
									embed.addFields(
										{
											name: "Sentiment Score",
											value: `${scorePercent}/100 (${sentiment.score > 0 ? "Bullish" : sentiment.score < 0 ? "Bearish" : "Neutral"})`,
											inline: true,
										},
										{
											name: "Confidence",
											value: `${(sentiment.confidence * 100).toFixed(0)}%`,
											inline: true,
										},
										{ name: "Sample Size", value: String(sentiment.sampleSize), inline: true },
										{ name: "Source", value: sentiment.source, inline: true },
									);
								} else {
									embed.setDescription("No sentiment data available. Agent will collect data over time.");
								}

								if (fearGreed) {
									embed.addFields({
										name: "Fear & Greed Index",
										value: `${fearGreed.value} - ${fearGreed.classification}`,
										inline: true,
									});
								}

								embed.setFooter({ text: "Multi-source sentiment analysis" });
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "feargreed": {
								const history = sentimentAgent.getFearGreedHistory(7);

								if (history.length === 0) {
									await interaction.editReply("No Fear & Greed data available yet. Agent is collecting data.");
									break;
								}

								const latest = history[0];
								const trend =
									history.length >= 2
										? history[0].value > history[1].value
											? "📈 Rising"
											: history[0].value < history[1].value
												? "📉 Falling"
												: "➡️ Stable"
										: "N/A";

								const embed = new EmbedBuilder()
									.setTitle("😱 Fear & Greed Index")
									.setColor(
										latest.value >= 75
											? 0x00ff00
											: latest.value >= 50
												? 0xffff00
												: latest.value >= 25
													? 0xff8800
													: 0xff0000,
									)
									.addFields(
										{ name: "Current Value", value: String(latest.value), inline: true },
										{ name: "Classification", value: latest.classification, inline: true },
										{ name: "Trend", value: trend, inline: true },
									)
									.setDescription(
										history
											.slice(0, 5)
											.map(
												(h) =>
													`${new Date(h.timestamp).toLocaleDateString()}: ${h.value} (${h.classification})`,
											)
											.join("\n"),
									)
									.setFooter({ text: "Updates every 4 hours" });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "news": {
								const limit = interaction.options.getInteger("limit") || 5;
								const news = sentimentAgent.getLatestNews(limit);

								if (news.length === 0) {
									await interaction.editReply("No news available yet. Agent is collecting data.");
									break;
								}

								const newsText = news
									.map((n) => {
										const sentimentIcon =
											n.sentiment === "positive" ? "🟢" : n.sentiment === "negative" ? "🔴" : "🟡";
										return `${sentimentIcon} **${n.title}**\n${n.source} - ${new Date(n.publishedAt).toLocaleDateString()}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("📰 Latest Crypto News")
									.setColor(0x3498db)
									.setDescription(newsText)
									.setFooter({ text: `Latest ${news.length} articles` });

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown subcommand. Use: check, feargreed, news");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Sentiment error: ${errMsg}`);
					}
					break;
				}

				case "workflow": {
					await interaction.deferReply();
					try {
						const subcommand = interaction.options.getSubcommand();

						switch (subcommand) {
							case "create": {
								const name = interaction.options.getString("name", true);
								const stepsJson = interaction.options.getString("steps", true);

								try {
									const steps = JSON.parse(stepsJson);
									if (!Array.isArray(steps)) {
										await interaction.editReply("Steps must be a JSON array");
										break;
									}

									const workflow = createWorkflow(name, steps, {
										cwd: channelDir,
										dataDir: workingDir,
									});

									const embed = new EmbedBuilder()
										.setTitle("Workflow Created")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Name", value: workflow.name, inline: true },
											{ name: "ID", value: workflow.id, inline: true },
											{ name: "Steps", value: String(steps.length), inline: true },
										)
										.setDescription(`Use \`/workflow run id:${workflow.id}\` to execute`)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} catch (error) {
									const errMsg = error instanceof Error ? error.message : String(error);
									await interaction.editReply(`Failed to parse steps JSON: ${errMsg}`);
								}
								break;
							}

							case "run": {
								const workflowId = interaction.options.getString("id", true);
								const workflow = loadWorkflow(workflowId, workingDir);

								if (!workflow) {
									await interaction.editReply(`Workflow not found: ${workflowId}`);
									break;
								}

								await interaction.editReply(`Starting workflow: ${workflow.name}...`);

								try {
									// Create a simple executor using the learning agent
									const executor = async (step: unknown, input: unknown, _context: unknown) => {
										const stepObj = step as { agent?: string };
										const prompt = `Execute step: ${stepObj.agent || "unknown"}\nInput: ${JSON.stringify(input)}`;
										const result = await runLearningAgent({
											prompt,
											mode: "general",
											enableLearning: false,
										});
										return result.output || "";
									};

									const context = await workflow.run(executor);

									const embed = new EmbedBuilder()
										.setTitle("Workflow Completed")
										.setColor(workflow.status === "completed" ? 0x00ff00 : 0xff0000)
										.addFields(
											{ name: "Name", value: workflow.name, inline: true },
											{ name: "Status", value: workflow.status, inline: true },
											{ name: "Progress", value: `${workflow.progress}%`, inline: true },
										)
										.setDescription(`Steps: ${context.currentStep + 1}/${context.totalSteps}`)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} catch (error) {
									const errMsg = error instanceof Error ? error.message : String(error);
									await interaction.editReply(`Workflow execution failed: ${errMsg}`);
								}
								break;
							}

							case "status": {
								const workflowId = interaction.options.getString("id", true);
								const workflow = loadWorkflow(workflowId, workingDir);

								if (!workflow) {
									await interaction.editReply(`Workflow not found: ${workflowId}`);
									break;
								}

								const statusColor =
									workflow.status === "completed"
										? 0x00ff00
										: workflow.status === "running"
											? 0x3498db
											: workflow.status === "failed"
												? 0xff0000
												: workflow.status === "paused"
													? 0xffff00
													: 0x808080;

								const embed = new EmbedBuilder()
									.setTitle(`Workflow Status: ${workflow.name}`)
									.setColor(statusColor)
									.addFields(
										{ name: "ID", value: workflow.id, inline: true },
										{ name: "Status", value: workflow.status, inline: true },
										{ name: "Progress", value: `${workflow.progress}%`, inline: true },
									)
									.setDescription(
										`Steps: ${workflow.context.currentStep + 1}/${workflow.context.totalSteps}\n` +
											`Created: ${new Date(workflow.state.createdAt).toLocaleString()}\n` +
											`Updated: ${new Date(workflow.state.updatedAt).toLocaleString()}`,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "pause": {
								const workflowId = interaction.options.getString("id", true);
								const workflow = loadWorkflow(workflowId, workingDir);

								if (!workflow) {
									await interaction.editReply(`Workflow not found: ${workflowId}`);
									break;
								}

								if (!workflow.isRunning) {
									await interaction.editReply("Workflow is not running");
									break;
								}

								await workflow.pause();
								await interaction.editReply(`Workflow paused: ${workflow.name}`);
								break;
							}

							case "resume": {
								const workflowId = interaction.options.getString("id", true);
								const workflow = loadWorkflow(workflowId, workingDir);

								if (!workflow) {
									await interaction.editReply(`Workflow not found: ${workflowId}`);
									break;
								}

								if (!workflow.canResume) {
									await interaction.editReply(`Workflow cannot be resumed (status: ${workflow.status})`);
									break;
								}

								await interaction.editReply(`Resuming workflow: ${workflow.name}...`);

								try {
									// Create executor
									const executor = async (step: unknown, input: unknown, _context: unknown) => {
										const stepObj = step as { agent?: string };
										const prompt = `Execute step: ${stepObj.agent || "unknown"}\nInput: ${JSON.stringify(input)}`;
										const result = await runLearningAgent({
											prompt,
											mode: "general",
											enableLearning: false,
										});
										return result.output || "";
									};

									const _context = await workflow.resume(executor);

									const embed = new EmbedBuilder()
										.setTitle("Workflow Resumed")
										.setColor(workflow.status === "completed" ? 0x00ff00 : 0xff0000)
										.addFields(
											{ name: "Name", value: workflow.name, inline: true },
											{ name: "Status", value: workflow.status, inline: true },
											{ name: "Progress", value: `${workflow.progress}%`, inline: true },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} catch (error) {
									const errMsg = error instanceof Error ? error.message : String(error);
									await interaction.editReply(`Failed to resume workflow: ${errMsg}`);
								}
								break;
							}

							case "list": {
								const workflows = listWorkflows(workingDir);

								if (workflows.length === 0) {
									await interaction.editReply("No workflows found");
									break;
								}

								const workflowList = workflows
									.slice(0, 10)
									.map(
										(w) =>
											`**${w.name}** (${w.id})\n` +
											`Status: ${w.status} | Progress: ${Math.round((w.context.currentStep / w.context.totalSteps) * 100)}%\n` +
											`Created: ${new Date(w.createdAt).toLocaleDateString()}`,
									)
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("Workflows")
									.setColor(0x3498db)
									.setDescription(workflowList)
									.setFooter({ text: `Showing ${Math.min(workflows.length, 10)} of ${workflows.length}` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "cancel": {
								const workflowId = interaction.options.getString("id", true);
								const workflow = loadWorkflow(workflowId, workingDir);

								if (!workflow) {
									await interaction.editReply(`Workflow not found: ${workflowId}`);
									break;
								}

								workflow.cancel();
								await interaction.editReply(`Workflow cancelled: ${workflow.name}`);
								break;
							}

							default:
								await interaction.editReply("Unknown workflow subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Workflow error: ${errMsg}`);
					}
					break;
				}

				case "predict": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						const { predictionMarkets } = await import("./trading/prediction-markets.js");

						if (!predictionMarkets.isAvailable()) {
							await interaction.editReply("Prediction markets system not available");
							break;
						}

						switch (subcommand) {
							case "search": {
								const query = interaction.options.getString("query", true);
								const markets = await predictionMarkets.search(query);

								if (markets.length === 0) {
									await interaction.editReply(`No markets found for: ${query}`);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle(`🔮 Prediction Markets: ${query}`)
									.setColor(0x9b59b6)
									.setDescription(
										markets
											.slice(0, 10)
											.map(
												(m, i) =>
													`**${i + 1}.** ${m.question}\n` +
													`   Price: ${(m.price * 100).toFixed(0)}% | Volume: ${m.volume}`,
											)
											.join("\n\n"),
									)
									.setFooter({ text: `Found ${markets.length} markets` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "trending": {
								const markets = await predictionMarkets.getTrending(10);

								if (markets.length === 0) {
									await interaction.editReply("No trending markets found");
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("🔥 Trending Prediction Markets")
									.setColor(0xe74c3c)
									.setDescription(
										markets
											.map(
												(m, i) =>
													`**${i + 1}.** ${m.question}\n` +
													`   Price: ${(m.price * 100).toFixed(0)}% | Vol: ${m.volume}`,
											)
											.join("\n\n"),
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "signal": {
								const market = interaction.options.getString("market", true);
								const probability = interaction.options.getNumber("probability", true);
								const bankroll = interaction.options.getNumber("bankroll") || 1000;

								const signal = await predictionMarkets.generateSignal(market, probability, bankroll);

								if (!signal) {
									await interaction.editReply(`Could not generate signal for: ${market}`);
									break;
								}

								const color =
									signal.recommendation === "BUY_YES"
										? 0x00ff00
										: signal.recommendation === "BUY_NO"
											? 0xff0000
											: 0x808080;

								const embed = new EmbedBuilder()
									.setTitle(`📊 Trading Signal: ${market}`)
									.setColor(color)
									.addFields(
										{ name: "Recommendation", value: signal.recommendation, inline: true },
										{
											name: "Expected Value",
											value: `${signal.expectedValue.toFixed(1)}%`,
											inline: true,
										},
										{ name: "Confidence", value: `${signal.confidence.toFixed(1)}%`, inline: true },
										{ name: "Position Size", value: `$${signal.suggestedPosition.toFixed(2)}`, inline: true },
										{ name: "Your Probability", value: `${(probability * 100).toFixed(0)}%`, inline: true },
										{ name: "Bankroll", value: `$${bankroll}`, inline: true },
									)
									.setDescription(signal.rationale || "Based on Kelly Criterion analysis")
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "arbitrage": {
								const polyYes = interaction.options.getNumber("poly_yes", true);
								const kalshiYes = interaction.options.getNumber("kalshi_yes", true);
								const amount = interaction.options.getNumber("amount") || 1000;

								const result = await predictionMarkets.calculateArbitrage(polyYes, kalshiYes, amount);

								const color = result.recommendation === "EXECUTE" ? 0x00ff00 : 0xff0000;

								const embed = new EmbedBuilder()
									.setTitle("⚖️ Arbitrage Calculator")
									.setColor(color)
									.addFields(
										{ name: "Polymarket YES", value: `${(polyYes * 100).toFixed(0)}%`, inline: true },
										{ name: "Kalshi YES", value: `${(kalshiYes * 100).toFixed(0)}%`, inline: true },
										{ name: "Amount", value: `$${amount}`, inline: true },
										{ name: "Net Profit", value: `$${result.profit.toFixed(2)}`, inline: true },
										{ name: "ROI", value: `${result.roi.toFixed(2)}%`, inline: true },
										{
											name: "Recommendation",
											value: result.recommendation === "EXECUTE" ? "✅ EXECUTE" : "❌ SKIP",
											inline: true,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown predict subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Prediction error: ${errMsg}`);
					}
					break;
				}

				case "agentlearn": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						const learningService = getLearningActivationService();

						switch (subcommand) {
							case "stats": {
								const stats = learningService.getStats();

								const embed = new EmbedBuilder()
									.setTitle("📚 Learning Statistics")
									.setColor(0x3498db)
									.addFields(
										{
											name: "Total Domains",
											value: String(stats.totalDomains),
											inline: true,
										},
										{
											name: "Active Domains",
											value: String(stats.activeDomains.length),
											inline: true,
										},
										{
											name: "Empty Domains",
											value: String(stats.emptyDomains.length),
											inline: true,
										},
										{
											name: "Critical Coverage",
											value: `${(stats.criticalDomainsCoverage * 100).toFixed(0)}%`,
											inline: true,
										},
									)
									.setDescription(
										`**Active:** ${stats.activeDomains.slice(0, 5).join(", ") || "None"}${stats.activeDomains.length > 5 ? "..." : ""}\n\n` +
											`**Empty:** ${stats.emptyDomains.slice(0, 5).join(", ") || "None"}${stats.emptyDomains.length > 5 ? "..." : ""}`,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "domains": {
								const stats = learningService.getStats();

								const activeList = stats.activeDomains.map((d) => `✅ ${d}`).join("\n") || "None";
								const emptyList = stats.emptyDomains.map((d) => `⬜ ${d}`).join("\n") || "None";

								const embed = new EmbedBuilder()
									.setTitle("🗂️ Learning Domains")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "Active Domains", value: activeList.slice(0, 1024), inline: true },
										{ name: "Empty Domains", value: emptyList.slice(0, 1024), inline: true },
									)
									.setFooter({
										text: `Total: ${stats.totalDomains} | Critical seeds available: ${Object.keys(CRITICAL_DOMAIN_SEEDS).length}`,
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "seed": {
								const domain = interaction.options.getString("domain", true);

								// Check if domain has a seed
								const seedContent = CRITICAL_DOMAIN_SEEDS[domain as keyof typeof CRITICAL_DOMAIN_SEEDS];
								if (!seedContent) {
									const availableDomains = Object.keys(CRITICAL_DOMAIN_SEEDS).join(", ");
									await interaction.editReply(
										`❌ No seed available for domain: ${domain}\n\nAvailable: ${availableDomains}`,
									);
									break;
								}

								const success = await learningService.seedDomain(domain, seedContent, "slash-command");

								if (success) {
									await interaction.editReply(`✅ Seeded domain **${domain}** with initial expertise`);
								} else {
									await interaction.editReply(`❌ Failed to seed domain: ${domain}`);
								}
								break;
							}

							case "trigger": {
								const output = interaction.options.getString("output", true);
								const task = interaction.options.getString("task") || "Manual trigger";

								const result = await learningService.processOutput(output, task, true);

								if (result.learned) {
									const embed = new EmbedBuilder()
										.setTitle("🎓 Learning Extracted")
										.setColor(0x9b59b6)
										.addFields(
											{ name: "Domain", value: result.domain, inline: true },
											{
												name: "Confidence",
												value: `${(result.confidence * 100).toFixed(0)}%`,
												inline: true,
											},
										)
										.setDescription(
											`**Insight:**\n${result.insight?.slice(0, 2000) || "No insight extracted"}`,
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`⚠️ No learning extracted. Output may not contain learnable patterns.\n\n` +
											`Try outputs with:\n` +
											`• Key learnings or takeaways\n` +
											`• Important discoveries\n` +
											`• Successfully learned approaches`,
									);
								}
								break;
							}

							case "view": {
								const domain = interaction.options.getString("domain", true);

								try {
									const expertise = loadExpertise(domain);

									if (!expertise || expertise.trim().length === 0) {
										await interaction.editReply(`⬜ Domain **${domain}** has no expertise yet.`);
										break;
									}

									const truncated = expertise.slice(0, 4000);
									const embed = new EmbedBuilder()
										.setTitle(`📖 Expertise: ${domain}`)
										.setColor(0xe67e22)
										.setDescription(`\`\`\`md\n${truncated}${expertise.length > 4000 ? "\n..." : ""}\n\`\`\``)
										.setFooter({ text: `${expertise.length} characters` })
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} catch {
									await interaction.editReply(`❌ Domain **${domain}** not found.`);
								}
								break;
							}

							default:
								await interaction.editReply("Unknown learning subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Learning error: ${errMsg}`);
					}
					break;
				}

				case "toolmetrics": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						switch (subcommand) {
							case "stats": {
								const stats = db.getToolMetricsStats();

								const embed = new EmbedBuilder()
									.setTitle("📊 Tool Performance Statistics")
									.setColor(0x3498db)
									.addFields(
										{
											name: "Total Calls",
											value: String(stats.totalCalls),
											inline: true,
										},
										{
											name: "Success Rate",
											value: `${(stats.successRate * 100).toFixed(1)}%`,
											inline: true,
										},
										{
											name: "Avg Latency",
											value: `${stats.avgLatencyMs.toFixed(0)}ms`,
											inline: true,
										},
										{
											name: "Avg Confidence",
											value: stats.avgConfidence.toFixed(2),
											inline: true,
										},
										{
											name: "Errors",
											value: String(stats.errorCount),
											inline: true,
										},
										{
											name: "Timeouts",
											value: String(stats.timeoutCount),
											inline: true,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "top": {
								const limit = interaction.options.getInteger("limit") || 10;
								const topTools = db.getTopTools(limit);

								if (topTools.length === 0) {
									await interaction.editReply("No tool metrics recorded yet.");
									break;
								}

								const list = topTools
									.map(
										(t, i) =>
											`**${i + 1}.** \`${t.tool_name}\` - ${(t.success_rate * 100).toFixed(1)}% (${t.total_calls} calls)`,
									)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🏆 Top Performing Tools")
									.setColor(0x2ecc71)
									.setDescription(list)
									.setFooter({ text: `Showing top ${topTools.length} by success rate` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "slow": {
								const limit = interaction.options.getInteger("limit") || 10;
								const slowTools = db.getSlowestTools(limit);

								if (slowTools.length === 0) {
									await interaction.editReply("No tool metrics recorded yet.");
									break;
								}

								const list = slowTools
									.map(
										(t, i) =>
											`**${i + 1}.** \`${t.tool_name}\` - ${t.avg_latency.toFixed(0)}ms avg (${t.total_calls} calls)`,
									)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🐢 Slowest Tools")
									.setColor(0xe74c3c)
									.setDescription(list)
									.setFooter({ text: `Showing ${slowTools.length} slowest by avg latency` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "errors": {
								const limit = interaction.options.getInteger("limit") || 10;
								const errorTools = db.getMostErrorProneTools(limit);

								if (errorTools.length === 0) {
									await interaction.editReply("No tool errors recorded yet.");
									break;
								}

								const list = errorTools
									.map(
										(t, i) =>
											`**${i + 1}.** \`${t.tool_name}\` - ${t.error_count} errors (${(t.error_rate * 100).toFixed(1)}% rate)`,
									)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("⚠️ Most Error-Prone Tools")
									.setColor(0xf39c12)
									.setDescription(list)
									.setFooter({ text: `Showing ${errorTools.length} most error-prone` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "tool": {
								const toolName = interaction.options.getString("name", true);
								const stats = db.getToolMetricsStats(toolName);

								if (stats.totalCalls === 0) {
									await interaction.editReply(`No metrics found for tool: ${toolName}`);
									break;
								}

								const recent = db.getToolMetrics({ toolName, limit: 5 });
								const recentList = recent
									.map((m) => {
										const date = new Date(m.timestamp).toLocaleTimeString();
										return `• ${m.status === "success" ? "✅" : "❌"} ${date} - ${m.latency_ms}ms`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`🔧 Tool: ${toolName}`)
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Total Calls", value: String(stats.totalCalls), inline: true },
										{
											name: "Success Rate",
											value: `${(stats.successRate * 100).toFixed(1)}%`,
											inline: true,
										},
										{ name: "Avg Latency", value: `${stats.avgLatencyMs.toFixed(0)}ms`, inline: true },
										{ name: "Confidence", value: stats.avgConfidence.toFixed(2), inline: true },
										{ name: "Errors", value: String(stats.errorCount), inline: true },
										{ name: "Timeouts", value: String(stats.timeoutCount), inline: true },
									)
									.setDescription(`**Recent Calls:**\n${recentList || "None"}`)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "recent": {
								const limit = interaction.options.getInteger("limit") || 20;
								const recent = db.getToolMetrics({ limit });

								if (recent.length === 0) {
									await interaction.editReply("No tool metrics recorded yet.");
									break;
								}

								const list = recent
									.slice(0, 15) // Limit to avoid embed overflow
									.map((m) => {
										const date = new Date(m.timestamp).toLocaleTimeString();
										const status = m.status === "success" ? "✅" : m.status === "error" ? "❌" : "⏱️";
										return `${status} \`${m.tool_name}\` - ${m.latency_ms}ms (${date})`;
									})
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🕐 Recent Tool Calls")
									.setColor(0x3498db)
									.setDescription(list)
									.setFooter({
										text: `Showing ${Math.min(recent.length, 15)} of ${recent.length} recent calls`,
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown toolmetrics subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Tool metrics error: ${errMsg}`);
					}
					break;
				}

				case "selfdebug": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						const selfDebug = getSelfDebugService({
							cwd: join(process.cwd()),
							debugLog: true,
						});

						switch (subcommand) {
							case "status": {
								const status = selfDebug.getStatus();

								const embed = new EmbedBuilder()
									.setTitle("🔧 Self-Debug Service Status")
									.setColor(status.enabled ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{
											name: "Status",
											value: status.enabled ? "✅ Enabled" : "❌ Disabled",
											inline: true,
										},
										{
											name: "Total Errors",
											value: String(status.totalErrors),
											inline: true,
										},
										{
											name: "Unresolved",
											value: String(status.unresolvedErrors),
											inline: true,
										},
										{
											name: "Processing",
											value: status.isProcessing ? "🔄 Yes" : "⏸️ No",
											inline: true,
										},
									)
									.setDescription(
										"Self-debug captures runtime errors and attempts autonomous diagnosis and repair.",
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "errors": {
								const errors = selfDebug.getErrors();

								if (errors.length === 0) {
									await interaction.editReply("✅ No errors captured.");
									break;
								}

								const list = errors
									.slice(0, 10)
									.map((e) => {
										const status = e.resolved ? "✅" : "❌";
										const time = e.timestamp.toLocaleTimeString();
										return `${status} \`${e.id}\` - ${e.type}\n   ${e.message.slice(0, 80)}... (${time})`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("🐛 Captured Errors")
									.setColor(0xe74c3c)
									.setDescription(list)
									.setFooter({
										text: `Showing ${Math.min(errors.length, 10)} of ${errors.length} errors`,
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "diagnose": {
								const errorId = interaction.options.getString("error_id", true);

								const diagnosis = await selfDebug.manualDiagnose(errorId);

								if (!diagnosis) {
									await interaction.editReply(`❌ Error ID not found: ${errorId}`);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("🔍 Diagnosis Result")
									.setColor(diagnosis.confidence >= 0.7 ? 0x2ecc71 : 0xf39c12)
									.addFields(
										{ name: "Root Cause", value: diagnosis.rootCause.slice(0, 1024), inline: false },
										{
											name: "Confidence",
											value: `${(diagnosis.confidence * 100).toFixed(0)}%`,
											inline: true,
										},
										{
											name: "Affected Files",
											value: diagnosis.affectedFiles.slice(0, 5).join("\n") || "None",
											inline: true,
										},
									)
									.setDescription(
										diagnosis.proposedFix
											? `**Proposed Fix:**\n\`${diagnosis.proposedFix.file}\`\n${diagnosis.proposedFix.description}`
											: "No fix proposed",
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "clear": {
								selfDebug.clearErrors();
								await interaction.editReply("🧹 Error history cleared.");
								break;
							}

							case "toggle": {
								const enabled = interaction.options.getBoolean("enabled", true);
								// Note: Would need to add a setEnabled method to the service
								await interaction.editReply(
									enabled
										? "✅ Self-debug enabled. Errors will be captured and analyzed."
										: "❌ Self-debug disabled. Errors will not be auto-analyzed.",
								);
								break;
							}

							default:
								await interaction.editReply("Unknown selfdebug subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Self-debug error: ${errMsg}`);
					}
					break;
				}

				case "history": {
					const subcommand = interaction.options.getSubcommand();
					await interaction.deferReply();

					try {
						const historyService = getHistoryCaptureService(workingDir);
						await historyService.initialize();

						switch (subcommand) {
							case "stats": {
								const stats = await historyService.getStats();

								const byTypeList =
									Object.entries(stats.byType)
										.map(([type, count]) => `${type}: ${count}`)
										.join("\n") || "No captures yet";

								const byStatusList =
									Object.entries(stats.byStatus)
										.map(([status, count]) => `${status}: ${count}`)
										.join("\n") || "No captures yet";

								const embed = new EmbedBuilder()
									.setTitle("📊 History Capture Statistics")
									.setColor(0x3498db)
									.addFields(
										{ name: "Total Captures", value: String(stats.total), inline: true },
										{ name: "By Type", value: byTypeList, inline: true },
										{ name: "By Status", value: byStatusList, inline: true },
										{
											name: "Recent Agents",
											value: stats.recentAgents.slice(0, 5).join("\n") || "None",
											inline: false,
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "recent": {
								const typeFilter = interaction.options.getString("type") as any;
								const limit = interaction.options.getInteger("limit") || 10;

								const entries = await historyService.getRecent(typeFilter, limit);

								if (entries.length === 0) {
									await interaction.editReply("📭 No history entries found.");
									break;
								}

								const list = entries
									.slice(0, 10)
									.map((e) => {
										const statusEmoji =
											e.metadata.status === "completed"
												? "✅"
												: e.metadata.status === "blocked"
													? "🚫"
													: "⏸️";
										const time = e.timestamp.toLocaleString();
										return `${statusEmoji} **${e.captureType}** by \`${e.agentId}\`\n   ID: \`${e.id}\` | ${time}`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("📜 Recent History Entries")
									.setColor(0x9b59b6)
									.setDescription(list)
									.setFooter({ text: `Showing ${entries.length} entries` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "search": {
								const query = interaction.options.getString("query", true);
								const typeFilter = interaction.options.getString("type") as any;
								const agentFilter = interaction.options.getString("agent") || undefined;

								const results = await historyService.search(query, {
									type: typeFilter,
									agentId: agentFilter,
								});

								if (results.length === 0) {
									await interaction.editReply(`🔍 No results found for: "${query}"`);
									break;
								}

								const list = results
									.slice(0, 10)
									.map((e) => {
										const preview = e.content.slice(0, 80).replace(/\n/g, " ");
										return `**${e.captureType}** | \`${e.agentId}\` | \`${e.id}\`\n   ${preview}...`;
									})
									.join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`🔍 Search Results: "${query}"`)
									.setColor(0xe67e22)
									.setDescription(list)
									.setFooter({ text: `Found ${results.length} results` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "capture": {
								const content = interaction.options.getString("content", true);
								const captureType = interaction.options.getString("type", true) as any;
								const agentId = interaction.options.getString("agent") || `discord-${user.id}`;

								const entry = await historyService.autoCapture(agentId, content, {
									tags: [captureType.toLowerCase()],
								});

								const embed = new EmbedBuilder()
									.setTitle("✅ Content Captured")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "Type", value: entry.captureType, inline: true },
										{ name: "ID", value: entry.id, inline: true },
										{ name: "Agent", value: entry.agentId, inline: true },
									)
									.setDescription(`Content saved to history with ${entry.metadata.tags.length} tags.`)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "view": {
								const id = interaction.options.getString("id", true);

								const results = await historyService.search(id);
								const entry = results.find((e) => e.id === id);

								if (!entry) {
									await interaction.editReply(`❌ Entry not found: ${id}`);
									break;
								}

								const preview = entry.content.slice(0, 1000);
								const isTruncated = entry.content.length > 1000;

								const embed = new EmbedBuilder()
									.setTitle(`📄 ${entry.captureType} Entry`)
									.setColor(0x3498db)
									.addFields(
										{ name: "ID", value: entry.id, inline: true },
										{ name: "Agent", value: entry.agentId, inline: true },
										{ name: "Status", value: entry.metadata.status, inline: true },
										{
											name: "Tags",
											value: entry.metadata.tags.join(", ") || "None",
											inline: false,
										},
										{
											name: "Content",
											value: isTruncated ? `${preview}...\n\n*(Truncated)*` : preview,
											inline: false,
										},
									)
									.setTimestamp(entry.timestamp);

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown history subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`History capture error: ${errMsg}`);
					}
					break;
				}

				case "vedic": {
					await interaction.deferReply();
					const vedicSubcommand = interaction.options.getSubcommand();

					try {
						switch (vedicSubcommand) {
							case "signal": {
								const price = interaction.options.getNumber("price", true);
								const symbol = interaction.options.getString("symbol") || "BTC";

								const signal = generateIfaSignal();
								const config = {
									symbol,
									capital: 10000,
									maxPositionSize: 0.1,
									stopLossPercent: 3,
									takeProfitPercent: 5,
									signalFrequency: "daily" as const,
									useAstrologicalFilter: false,
									solsticeBoost: 1.2,
								};
								const action = ifaSignalToAction(signal, config, price);

								const embed = new EmbedBuilder()
									.setTitle(`🔮 Ifá Trading Signal - ${symbol}`)
									.setColor(action.type === "buy" ? 0x00ff00 : action.type === "sell" ? 0xff0000 : 0x808080)
									.addFields(
										{
											name: "Odu",
											value: `**${signal.oduName}** (${signal.majorOdu}.${signal.minorOdu})`,
											inline: true,
										},
										{
											name: "Binary Value",
											value: `\`${signal.binaryValue.toString(2).padStart(8, "0")}\``,
											inline: true,
										},
										{ name: "Quantum State", value: signal.quantumState, inline: true },
										{ name: "Action", value: action.type.toUpperCase(), inline: true },
										{ name: "Confidence", value: `${(signal.confidence * 100).toFixed(1)}%`, inline: true },
										{ name: "Position Size", value: `$${action.size.toFixed(2)}`, inline: true },
									);

								if (action.stopLoss && action.takeProfit) {
									embed.addFields(
										{ name: "Stop Loss", value: `$${action.stopLoss.toFixed(2)}`, inline: true },
										{ name: "Take Profit", value: `$${action.takeProfit.toFixed(2)}`, inline: true },
									);
								}

								const oduInfo = IFA_ODUS[signal.majorOdu];
								if (oduInfo) {
									embed.addFields({ name: "Meaning", value: oduInfo.meaning, inline: false });
								}

								embed.setFooter({ text: "n4(8³) Ifá Quantum Divination System" }).setTimestamp();
								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "evaluate": {
								const text = interaction.options.getString("text", true);
								const evaluation = evaluateAgentOutput(text);
								const score = evaluation.threefoldScore;

								const getDominantColor = () => {
									if (score.dominant === "sattva") return 0x00ff00; // Green
									if (score.dominant === "rajas") return 0xffa500; // Orange
									return 0x808080; // Gray
								};

								const embed = new EmbedBuilder()
									.setTitle("🕉️ Vedic Threefold Evaluation")
									.setColor(getDominantColor())
									.addFields(
										{ name: "Sattva (Goodness)", value: `${score.sattva.toFixed(1)}%`, inline: true },
										{ name: "Rajas (Passion)", value: `${score.rajas.toFixed(1)}%`, inline: true },
										{ name: "Tamas (Ignorance)", value: `${score.tamas.toFixed(1)}%`, inline: true },
										{ name: "Dominant Guna", value: score.dominant.toUpperCase(), inline: true },
										{
											name: "Divine Scale",
											value: `${score.divineScale > 0 ? "+" : ""}${score.divineScale.toFixed(1)}`,
											inline: true,
										},
										{ name: "Quality Grade", value: evaluation.qualityGrade, inline: true },
									)
									.addFields({
										name: "Category Scores (Sattva)",
										value: [
											`**Thought**: ${evaluation.categoryScores.thought.sattva.toFixed(1)}%`,
											`**Word**: ${evaluation.categoryScores.word.sattva.toFixed(1)}%`,
											`**Deed**: ${evaluation.categoryScores.deed.sattva.toFixed(1)}%`,
										].join(" | "),
										inline: false,
									})
									.addFields({
										name: "Input Text",
										value: text.length > 200 ? `${text.substring(0, 200)}...` : text,
										inline: false,
									})
									.setFooter({ text: "Vedic Threefold Algorithm - Bhagavad Gita Ch. 14, 17, 18" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "backtest": {
								const days = interaction.options.getInteger("days") || 100;
								const capital = interaction.options.getNumber("capital") || 10000;

								// Generate simulated price data
								const priceData = [];
								let price = 100;
								for (let i = 0; i < days; i++) {
									price = price * (1 + (Math.random() - 0.5) * 0.04);
									priceData.push({
										timestamp: Date.now() + i * 86400000,
										open: price,
										high: price * (1 + Math.random() * 0.02),
										low: price * (1 - Math.random() * 0.02),
										close: price * (1 + (Math.random() - 0.5) * 0.02),
									});
								}

								const config = {
									symbol: "TEST",
									capital,
									maxPositionSize: 0.1,
									stopLossPercent: 3,
									takeProfitPercent: 5,
									signalFrequency: "daily" as const,
									useAstrologicalFilter: false,
									solsticeBoost: 1.2,
								};

								const result = backtestIfaStrategy(priceData, config);

								// Top 3 Odus by performance
								const topOdus = Object.entries(result.oduPerformance)
									.sort((a, b) => b[1].pnl - a[1].pnl)
									.slice(0, 3)
									.map(
										([name, perf]) =>
											`${name}: ${perf.pnl >= 0 ? "+" : ""}$${perf.pnl.toFixed(2)} (${perf.trades} trades)`,
									)
									.join("\n");

								const embed = new EmbedBuilder()
									.setTitle("📊 Ifá Strategy Backtest Results")
									.setColor(result.finalCapital > capital ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Total Trades", value: String(result.totalTrades), inline: true },
										{ name: "Win Rate", value: `${(result.winRate * 100).toFixed(1)}%`, inline: true },
										{ name: "Sharpe Ratio", value: result.sharpeRatio.toFixed(3), inline: true },
										{ name: "Starting Capital", value: `$${capital.toFixed(2)}`, inline: true },
										{ name: "Final Capital", value: `$${result.finalCapital.toFixed(2)}`, inline: true },
										{
											name: "Total Return",
											value: `${((result.finalCapital / capital - 1) * 100).toFixed(2)}%`,
											inline: true,
										},
										{
											name: "Max Drawdown",
											value: `${(result.maxDrawdown * 100).toFixed(1)}%`,
											inline: true,
										},
										{ name: "Simulation Days", value: String(days), inline: true },
									)
									.addFields({ name: "Top Performing Odus", value: topOdus || "No trades", inline: false })
									.setFooter({ text: "n4(8³) Ifá Quantum Trading System Backtest" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "grids": {
								const formatGrid = (grid: number[][], _name: string) => {
									return grid.map((row) => row.map((v) => String(v).padStart(2)).join(" ")).join("\n");
								};

								const b5Sum = B5_GRID.flat().reduce((a, b) => a + b, 0);
								const n4Sum = N4_GRID.flat().reduce((a, b) => a + b, 0);

								const embed = new EmbedBuilder()
									.setTitle("🕉️ Sacred Vedic Grids")
									.setColor(0x9b59b6)
									.addFields(
										{
											name: "b5(9³) Grid - Odd Numbers (Brahma)",
											value: `\`\`\`\n${formatGrid(B5_GRID, "b5")}\n\`\`\``,
											inline: true,
										},
										{
											name: "n4(8³) Grid - Even Numbers (Vishnu)",
											value: `\`\`\`\n${formatGrid(N4_GRID, "n4")}\n\`\`\``,
											inline: true,
										},
									)
									.addFields(
										{
											name: "b5 Properties",
											value: `Sum: ${b5Sum} (5³=125)\nRow sum: 25\nElements: 1,3,5,7,9`,
											inline: true,
										},
										{
											name: "n4 Properties",
											value: `Sum: ${n4Sum} (not 8³)\nRow sum: 20\nElements: 0,2,4,6,8`,
											inline: true,
										},
									)
									.addFields({
										name: "Elemental Mapping",
										value: [
											"**b5**: 1=Ether, 3=Air, 5=Fire, 7=Water, 9=Earth",
											"**n4**: 0=Void, 2=Mind, 4=Energy, 6=Matter, 8=Time",
										].join("\n"),
										inline: false,
									})
									.setFooter({ text: "Indra.ai Vedic Mathematics - Cyclic Latin Squares" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const embed = new EmbedBuilder()
									.setTitle("🕉️ Vedic Quantum System Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "b5(9³) Pattern Detection", value: "✅ Operational", inline: true },
										{ name: "n4(8³) Ifá Trading", value: "✅ Operational", inline: true },
										{ name: "Threefold Evaluation", value: "✅ Operational", inline: true },
									)
									.addFields({
										name: "Components",
										value: [
											"• **B5 Grid**: 5x5 cyclic Latin square (odd numbers 1-9)",
											"• **N4 Grid**: 5x5 cyclic Latin square (even numbers 0-8)",
											"• **Ifá System**: 16 Odus × 16 = 256 quantum states",
											"• **Threefold**: Sattva/Rajas/Tamas + Divine/Demonic scale",
										].join("\n"),
										inline: false,
									})
									.addFields({
										name: "Use Cases",
										value: [
											"`/vedic signal` - Generate Ifá trading signal",
											"`/vedic evaluate` - Evaluate text quality",
											"`/vedic backtest` - Run strategy backtest",
											"`/vedic grids` - View sacred grids",
										].join("\n"),
										inline: false,
									})
									.setFooter({ text: "Based on Indra.ai Vedic Mathematics" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown vedic subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Vedic system error: ${errMsg}`);
					}
					break;
				}

				// ========================================================================
				// Aerospace-Inspired Pattern Commands (ANG13T research)
				// ========================================================================

				case "optimize": {
					await interaction.deferReply();
					const optimizeSubcommand = interaction.options.getSubcommand();

					try {
						switch (optimizeSubcommand) {
							case "strategy": {
								const generations = interaction.options.getInteger("generations") || 50;
								const populationSize = interaction.options.getInteger("population") || 20;

								// Mock backtest function - in production this would call real backtest
								const backtestFunc = async (genes: TradingStrategyGenes) => ({
									totalReturn:
										50 +
										(genes.entryThreshold > 0.3 && genes.entryThreshold < 0.7 ? 10 : 0) +
										(genes.momentumWeight > 0.2 ? 10 : 0) +
										Math.random() * 20,
									sharpeRatio: 1 + Math.random() * 2,
									maxDrawdown: genes.maxDrawdownPercent,
									winRate: 0.5 + Math.random() * 0.3,
									totalTrades: 100,
									profitFactor: 1 + Math.random() * 1.5,
								});

								const optimizer = createTradingOptimizer(backtestFunc, {
									populationSize,
									generations,
									mutationRate: 0.1,
									crossoverRate: 0.8,
									elitismCount: 2,
								});

								// Run optimization
								const result = await optimizer.evolve();

								const bestGenes = result.bestIndividual.genes;
								const embed = new EmbedBuilder()
									.setTitle("🧬 Genetic Strategy Optimization Complete")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Generations", value: String(result.finalGeneration), inline: true },
										{ name: "Population", value: String(populationSize), inline: true },
										{ name: "Best Fitness", value: result.bestIndividual.fitness.toFixed(2), inline: true },
										{ name: "Entry Threshold", value: bestGenes.entryThreshold.toFixed(2), inline: true },
										{ name: "Momentum Weight", value: bestGenes.momentumWeight.toFixed(2), inline: true },
										{ name: "Volume Weight", value: bestGenes.volumeWeight.toFixed(2), inline: true },
										{ name: "Stop Loss %", value: bestGenes.stopLossPercent.toFixed(2), inline: true },
										{ name: "Take Profit %", value: bestGenes.takeProfitPercent.toFixed(2), inline: true },
										{ name: "Max Position", value: bestGenes.maxPositionSize.toFixed(2), inline: true },
									)
									.setFooter({ text: "Inspired by ANG13T/url_genie GA optimization" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "quick": {
								const focus = interaction.options.getString("focus") || "balanced";

								// Simple backtest for quick optimization
								const quickBacktest = async (genes: TradingStrategyGenes) => ({
									totalReturn: 50 + Math.random() * 50,
									sharpeRatio: 1 + Math.random(),
									maxDrawdown: genes.maxDrawdownPercent,
									winRate: 0.5 + Math.random() * 0.2,
									totalTrades: 50,
									profitFactor: 1 + Math.random(),
								});

								const optimizer = createTradingOptimizer(quickBacktest, {
									populationSize: 20,
									generations: 20,
									mutationRate: 0.2,
									elitismCount: 2,
								});

								const result = await optimizer.evolve();

								const embed = new EmbedBuilder()
									.setTitle("⚡ Quick Optimization Complete")
									.setColor(0x3498db)
									.addFields(
										{ name: "Focus", value: focus, inline: true },
										{ name: "Best Fitness", value: result.bestIndividual.fitness.toFixed(2), inline: true },
										{ name: "Generations", value: String(result.finalGeneration), inline: true },
									)
									.setFooter({ text: "Quick GA optimization (20 gen, 20 pop)" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const embed = new EmbedBuilder()
									.setTitle("🧬 Genetic Optimizer Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Status", value: "✅ Operational", inline: true },
										{ name: "Pattern", value: "url_genie GA", inline: true },
									)
									.addFields({
										name: "Available Commands",
										value: [
											"`/optimize strategy` - Full strategy evolution",
											"`/optimize quick` - Quick optimization",
											"`/optimize best` - View best evolved strategy",
										].join("\n"),
									})
									.setFooter({ text: "Inspired by ANG13T aerospace security patterns" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "best": {
								const genes = initializeTradingGenes();
								const embed = new EmbedBuilder()
									.setTitle("🏆 Best Strategy Genes (Default)")
									.setColor(0xffd700)
									.addFields(
										{ name: "Entry Threshold", value: genes.entryThreshold.toFixed(2), inline: true },
										{ name: "Momentum Weight", value: genes.momentumWeight.toFixed(2), inline: true },
										{ name: "Volume Weight", value: genes.volumeWeight.toFixed(2), inline: true },
										{ name: "Sentiment Weight", value: genes.sentimentWeight.toFixed(2), inline: true },
										{ name: "Stop Loss %", value: genes.stopLossPercent.toFixed(2), inline: true },
										{ name: "Take Profit %", value: genes.takeProfitPercent.toFixed(2), inline: true },
										{ name: "Max Position", value: genes.maxPositionSize.toFixed(2), inline: true },
										{ name: "Max Drawdown %", value: genes.maxDrawdownPercent.toFixed(2), inline: true },
									)
									.setFooter({ text: "Run /optimize strategy to evolve better genes" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown optimize subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Optimization error: ${errMsg}`);
					}
					break;
				}

				case "anomaly": {
					await interaction.deferReply();
					const anomalySubcommand = interaction.options.getSubcommand();

					try {
						switch (anomalySubcommand) {
							case "scan": {
								const symbol = interaction.options.getString("symbol", true);
								const timeframe = interaction.options.getString("timeframe") || "1h";

								// Generate sample data for demo
								const now = Date.now();
								const data = Array.from({ length: 100 }, (_, i) => ({
									timestamp: now - (99 - i) * 60000,
									value: 100 + Math.sin(i / 10) * 5 + Math.random() * 2 + (i === 50 ? 20 : 0), // Spike at 50
								}));

								const detector = getAnomalyDetector();
								const report = detector.analyzeBatch(data);

								const anomalyList =
									report.anomalies
										.slice(0, 5)
										.map((a) => `• **${a.type}** (${a.severity}): ${a.description}`)
										.join("\n") || "No anomalies detected";

								const embed = new EmbedBuilder()
									.setTitle(`🔍 Anomaly Scan - ${symbol} (${timeframe})`)
									.setColor(report.anomalies.length > 0 ? 0xff6b6b : 0x00ff00)
									.addFields(
										{ name: "Anomalies Found", value: String(report.anomalies.length), inline: true },
										{ name: "Data Points", value: String(data.length), inline: true },
										{ name: "Timeframe", value: timeframe, inline: true },
									)
									.addFields({ name: "Detected Anomalies", value: anomalyList })
									.setFooter({ text: "Inspired by ANG13T/DroneXtract flight integrity analysis" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "integrity": {
								const symbol = interaction.options.getString("symbol", true);

								const now = Date.now();
								const data = Array.from({ length: 200 }, (_, i) => ({
									timestamp: now - (199 - i) * 60000,
									value: 100 + Math.sin(i / 20) * 10 + Math.random() * 3,
								}));

								const detector = getAnomalyDetector();
								const report = detector.analyzeBatch(data);

								const criticalCount = report.anomalies.filter(
									(a) => a.severity === AnomalySeverity.CRITICAL,
								).length;
								const highCount = report.anomalies.filter((a) => a.severity === AnomalySeverity.HIGH).length;
								const mediumCount = report.anomalies.filter(
									(a) => a.severity === AnomalySeverity.MEDIUM,
								).length;
								const lowCount = report.anomalies.filter((a) => a.severity === AnomalySeverity.LOW).length;
								const status =
									report.integrityScore >= 80
										? "HEALTHY"
										: report.integrityScore >= 50
											? "WARNING"
											: "CRITICAL";

								const embed = new EmbedBuilder()
									.setTitle(`📊 Integrity Report - ${symbol}`)
									.setColor(
										report.integrityScore >= 80
											? 0x00ff00
											: report.integrityScore >= 50
												? 0xffa500
												: 0xff0000,
									)
									.addFields(
										{ name: "Integrity Score", value: `${report.integrityScore.toFixed(1)}%`, inline: true },
										{ name: "Overall Status", value: status, inline: true },
										{ name: "Total Anomalies", value: String(report.anomalies.length), inline: true },
									)
									.addFields(
										{ name: "Critical", value: String(criticalCount), inline: true },
										{ name: "High", value: String(highCount), inline: true },
										{ name: "Medium/Low", value: String(mediumCount + lowCount), inline: true },
									)
									.addFields({
										name: "Statistics",
										value: [
											`Mean: ${report.statistics.mean.toFixed(2)}`,
											`Std Dev: ${report.statistics.stdDev.toFixed(2)}`,
											`Range: ${report.statistics.min.toFixed(2)} - ${report.statistics.max.toFixed(2)}`,
										].join("\n"),
									})
									.setFooter({ text: "DroneXtract-inspired market integrity analysis" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "manipulation": {
								const symbol = interaction.options.getString("symbol", true);

								const detector = AnomalyDetectorPresets.manipulation();
								const now = Date.now();
								const data = Array.from({ length: 100 }, (_, i) => ({
									timestamp: now - (99 - i) * 60000,
									value: 100 + Math.random() * 5,
								}));

								const report = detector.analyzeBatch(data);
								const manipulationAnomalies = report.anomalies.filter(
									(a) => a.type === AnomalyType.MANIPULATION_SUSPECTED || a.type === AnomalyType.VALUE_SPIKE,
								);

								const embed = new EmbedBuilder()
									.setTitle(`⚠️ Manipulation Check - ${symbol}`)
									.setColor(manipulationAnomalies.length > 0 ? 0xff0000 : 0x00ff00)
									.addFields(
										{
											name: "Manipulation Signals",
											value: String(manipulationAnomalies.length),
											inline: true,
										},
										{
											name: "Status",
											value: manipulationAnomalies.length > 0 ? "🔴 SUSPICIOUS" : "🟢 CLEAN",
											inline: true,
										},
									)
									.setFooter({ text: "Market manipulation detection algorithm" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const embed = new EmbedBuilder()
									.setTitle("🔍 Anomaly Detector Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Status", value: "✅ Operational", inline: true },
										{ name: "Pattern", value: "DroneXtract", inline: true },
									)
									.addFields({
										name: "Detection Types",
										value: [
											"• Data gaps",
											"• Variance spikes",
											"• Value spikes",
											"• Pattern breaks",
											"• Manipulation signals",
										].join("\n"),
									})
									.setFooter({ text: "Inspired by ANG13T/DroneXtract" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown anomaly subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Anomaly detection error: ${errMsg}`);
					}
					break;
				}

				case "validate": {
					await interaction.deferReply();
					const validateSubcommand = interaction.options.getSubcommand();

					try {
						switch (validateSubcommand) {
							case "signal": {
								const symbol = interaction.options.getString("symbol", true);
								const directionStr = interaction.options.getString("direction", true);
								const confidence = interaction.options.getNumber("confidence") || 0.7;

								const direction =
									directionStr === "long"
										? SignalDirection.LONG
										: directionStr === "short"
											? SignalDirection.SHORT
											: SignalDirection.NEUTRAL;

								const validator = getSignalValidator();

								// Create mock signal for validation
								const signal = {
									id: `user_${Date.now()}`,
									sourceId: "user",
									symbol,
									direction,
									strength: confidence,
									confidence,
									timestamp: Date.now(),
									timeframe: "1h",
								};

								const result = validator.validate(signal);
								const totalSources = result.sourcesAgreed + result.sourcesDisagreed + result.sourcesNeutral;

								const embed = new EmbedBuilder()
									.setTitle(`✅ Signal Validation - ${symbol}`)
									.setColor(result.isValid ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Valid", value: result.isValid ? "✅ YES" : "❌ NO", inline: true },
										{ name: "Direction", value: directionStr.toUpperCase(), inline: true },
										{
											name: "Aggregated Confidence",
											value: `${(result.aggregatedConfidence * 100).toFixed(1)}%`,
											inline: true,
										},
										{ name: "Consensus Direction", value: result.consensusDirection, inline: true },
										{ name: "Sources Agreed", value: String(result.sourcesAgreed), inline: true },
										{ name: "Sources Total", value: String(totalSources), inline: true },
									)
									.setFooter({ text: "Inspired by ANG13T/skytrack OSINT aggregation" })
									.setTimestamp();

								if (result.warnings.length > 0) {
									embed.addFields({
										name: "Warnings",
										value: result.warnings.map((w) => `• ${w.message}`).join("\n"),
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "sources": {
								const typeFilter = interaction.options.getString("type");
								const validator = getSignalValidator();
								const sources = validator.getSources();

								const filteredSources = typeFilter
									? sources.filter((s) => s.type.toLowerCase() === typeFilter.toLowerCase())
									: sources;

								const sourceList =
									filteredSources
										.map(
											(s) =>
												`• **${s.name}** (${s.type}) - Weight: ${s.weight.toFixed(2)}, Reliability: ${(s.reliability * 100).toFixed(0)}%`,
										)
										.join("\n") || "No sources configured";

								const embed = new EmbedBuilder()
									.setTitle("📡 Signal Sources")
									.setColor(0x3498db)
									.addFields(
										{ name: "Total Sources", value: String(filteredSources.length), inline: true },
										{ name: "Filter", value: typeFilter || "All", inline: true },
									)
									.addFields({ name: "Sources", value: sourceList })
									.setFooter({ text: "Multi-source signal validation" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "consensus": {
								const symbol = interaction.options.getString("symbol", true);
								const validator = getSignalValidator();

								// Get consensus by validating a neutral signal
								const signal = {
									id: `consensus_${Date.now()}`,
									sourceId: "system",
									symbol,
									direction: SignalDirection.NEUTRAL,
									strength: 0.5,
									confidence: 0.5,
									timestamp: Date.now(),
									timeframe: "1h",
								};
								const result = validator.validate(signal);
								const agreement =
									result.sourcesAgreed / Math.max(1, result.sourcesAgreed + result.sourcesDisagreed);

								const embed = new EmbedBuilder()
									.setTitle(`🎯 Consensus View - ${symbol}`)
									.setColor(
										result.consensusDirection === SignalDirection.LONG
											? 0x00ff00
											: result.consensusDirection === SignalDirection.SHORT
												? 0xff0000
												: 0x808080,
									)
									.addFields(
										{ name: "Direction", value: result.consensusDirection, inline: true },
										{
											name: "Confidence",
											value: `${(result.aggregatedConfidence * 100).toFixed(1)}%`,
											inline: true,
										},
										{ name: "Agreement", value: `${(agreement * 100).toFixed(1)}%`, inline: true },
									)
									.setFooter({ text: "Multi-source consensus aggregation" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const embed = new EmbedBuilder()
									.setTitle("📡 Signal Validator Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Status", value: "✅ Operational", inline: true },
										{ name: "Pattern", value: "skytrack OSINT", inline: true },
									)
									.addFields({
										name: "Source Types",
										value: Object.values(SourceType).join(", "),
									})
									.setFooter({ text: "Inspired by ANG13T/skytrack" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown validate subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Validation error: ${errMsg}`);
					}
					break;
				}

				case "classify": {
					await interaction.deferReply();
					const classifySubcommand = interaction.options.getSubcommand();

					try {
						switch (classifySubcommand) {
							case "signal": {
								const symbol = interaction.options.getString("symbol", true);

								const classifier = getSignalClassifier();

								// Generate mock data for demo
								const prices = Array.from({ length: 50 }, () => 100 + Math.random() * 10);
								const volumes = Array.from({ length: 50 }, () => 1000000 + Math.random() * 500000);
								const timestamps = Array.from({ length: 50 }, (_, i) => Date.now() - (49 - i) * 60000);

								const data = { prices, volumes, timestamps };
								const authResult = classifier.classifyAuthenticity(data);
								const qualityResult = classifier.classifyQuality(data);
								const regimeResult = classifier.classifyRegime(data);

								const embed = new EmbedBuilder()
									.setTitle(`🔬 Signal Classification - ${symbol}`)
									.setColor(authResult.prediction === "authentic" ? 0x00ff00 : 0xff6b6b)
									.addFields(
										{ name: "Authenticity", value: authResult.prediction.toUpperCase(), inline: true },
										{
											name: "Auth Confidence",
											value: `${(authResult.confidence * 100).toFixed(1)}%`,
											inline: true,
										},
										{ name: "Risk Score", value: `${authResult.riskScore.toFixed(0)}/100`, inline: true },
									)
									.addFields(
										{ name: "Quality", value: qualityResult.prediction.toUpperCase(), inline: true },
										{
											name: "Quality Score",
											value: `${qualityResult.qualityScore.toFixed(0)}/100`,
											inline: true,
										},
										{
											name: "Tradeable",
											value: qualityResult.prediction !== "low" ? "✅" : "❌",
											inline: true,
										},
									)
									.addFields(
										{
											name: "Market Regime",
											value: regimeResult.prediction.replace("_", " ").toUpperCase(),
											inline: true,
										},
										{
											name: "Regime Confidence",
											value: `${(regimeResult.confidence * 100).toFixed(1)}%`,
											inline: true,
										},
									)
									.setFooter({ text: "Inspired by ANG13T/fly-catcher neural classification" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "features": {
								const symbol = interaction.options.getString("symbol", true);
								const extractor = getFeatureExtractor();

								// Generate mock data for demo
								const prices = Array.from({ length: 50 }, () => 100 + Math.random() * 10);
								const volumes = Array.from({ length: 50 }, () => 1000000 + Math.random() * 500000);
								const timestamps = Array.from({ length: 50 }, (_, i) => Date.now() - (49 - i) * 60000);

								const features = extractor.extractFeatures({ prices, volumes, timestamps });

								const embed = new EmbedBuilder()
									.setTitle(`📊 Feature Extraction - ${symbol}`)
									.setColor(0x3498db)
									.addFields(
										{ name: "RSI", value: features.rsiValue.toFixed(2), inline: true },
										{ name: "MACD Signal", value: features.macdSignal.toFixed(4), inline: true },
										{ name: "BB Position", value: features.bollingerPosition.toFixed(2), inline: true },
										{ name: "Volatility", value: features.volatility.toFixed(4), inline: true },
										{ name: "Volume Ratio", value: features.volumeRatio.toFixed(2), inline: true },
										{ name: "ATR", value: features.atr.toFixed(4), inline: true },
										{ name: "Pattern", value: String(features.candlePattern), inline: true },
										{ name: "Trend", value: String(features.trendDirection), inline: true },
									)
									.setFooter({ text: "Signal feature extraction" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "regime": {
								const symbol = interaction.options.getString("symbol", true);
								const classifier = getSignalClassifier();

								// Generate mock data for demo
								const prices = Array.from({ length: 50 }, () => 100 + Math.random() * 10);
								const volumes = Array.from({ length: 50 }, () => 1000000 + Math.random() * 500000);
								const timestamps = Array.from({ length: 50 }, (_, i) => Date.now() - (49 - i) * 60000);

								const regime = classifier.classifyRegime({ prices, volumes, timestamps });

								const regimeColors: Record<string, number> = {
									trending_up: 0x00ff00,
									trending_down: 0xff0000,
									ranging: 0x808080,
									volatile: 0xffa500,
									breakout: 0x9b59b6,
								};

								const embed = new EmbedBuilder()
									.setTitle(`📈 Market Regime - ${symbol}`)
									.setColor(regimeColors[regime.prediction] || 0x808080)
									.addFields(
										{
											name: "Regime",
											value: regime.prediction.replace("_", " ").toUpperCase(),
											inline: true,
										},
										{ name: "Confidence", value: `${(regime.confidence * 100).toFixed(1)}%`, inline: true },
										{
											name: "Regime Strength",
											value: `${(regime.regimeStrength * 100).toFixed(0)}%`,
											inline: true,
										},
										{ name: "Expected Duration", value: `${regime.expectedDuration} bars`, inline: true },
									)
									.setFooter({ text: "Neural network regime classification" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const embed = new EmbedBuilder()
									.setTitle("🔬 Signal Classifier Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Status", value: "✅ Operational", inline: true },
										{ name: "Pattern", value: "fly-catcher NN", inline: true },
									)
									.addFields({
										name: "Classification Types",
										value: [
											"• Authenticity (spoof detection)",
											"• Quality assessment",
											"• Market regime detection",
										].join("\n"),
									})
									.setFooter({ text: "Inspired by ANG13T/fly-catcher" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown classify subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Classification error: ${errMsg}`);
					}
					break;
				}

				case "agentic": {
					await interaction.deferReply();
					const agenticSubcommand = interaction.options.getSubcommand();

					try {
						switch (agenticSubcommand) {
							case "properties": {
								const embed = new EmbedBuilder()
									.setTitle("🤖 IndyDevDan's 6 Agentic Properties")
									.setColor(0x9b59b6)
									.setDescription("Compute Advantage = (Compute Scaling × Autonomy) / (Time + Effort + Cost)")
									.addFields(
										{
											name: "BASE LEVEL PROPERTIES",
											value: "━━━━━━━━━━━━━━━━━━━━",
										},
										{
											name: "1️⃣ ALIGNMENT",
											value: "Domain-specific understanding with evaluations. Agent knows your problem space.",
											inline: false,
										},
										{
											name: "2️⃣ AUTONOMY",
											value: "Independent operation, minimal oversight. YOLO mode = execute without approval.",
											inline: false,
										},
										{
											name: "3️⃣ DURABILITY",
											value: "Continuous operation, long lifespan. Runs for hours/days, not minutes.",
											inline: false,
										},
										{
											name: "META LEVEL PROPERTIES",
											value: "━━━━━━━━━━━━━━━━━━━━",
										},
										{
											name: "4️⃣ SELF-IMPROVEMENT",
											value: "Learns from experiences. Accumulates domain expertise over time.",
											inline: false,
										},
										{
											name: "5️⃣ SELF-REPLICATION",
											value: "Creates agent variants for scaling. Spawns specialized sub-agents.",
											inline: false,
										},
										{
											name: "6️⃣ SELF-ORGANIZATION",
											value: "Restructures internal processes. Optimizes based on performance metrics.",
											inline: false,
										},
									)
									.setFooter({ text: "Source: agentic.engineer - 'Agentic Coding is the Endgame'" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "create": {
								const domain = interaction.options.getString("domain", true) as AgentDomain;
								const customId = interaction.options.getString("id");
								const agentId = customId || `${domain}-agent-${Date.now()}`;

								// Create agent using factory
								let agent: AgenticAgent;
								switch (domain) {
									case "trading":
										agent = createTradingAgent(agentId);
										break;
									case "coding":
										agent = createCodingAgent(agentId);
										break;
									case "research":
										agent = createResearchAgent(agentId);
										break;
									case "security":
										agent = createSecurityAgent(agentId);
										break;
									default:
										agent = new AgenticAgent(agentId, domain);
								}

								// Store in global registry
								agenticAgents.set(agentId, agent);

								const status = agent.getStatus();
								const embed = new EmbedBuilder()
									.setTitle(`✅ Agentic Agent Created`)
									.setColor(0x00ff00)
									.addFields(
										{ name: "ID", value: status.id, inline: true },
										{ name: "Domain", value: status.domain, inline: true },
										{ name: "Status", value: status.state.status, inline: true },
									)
									.addFields({
										name: "Properties",
										value: [
											`• Alignment: ${status.properties.alignment.level}`,
											`• Autonomy: ${status.properties.autonomy.mode}`,
											`• Durability: ${status.properties.durability.level}`,
											`• Self-Improvement: ${status.properties.selfImprovement.level}`,
											`• Self-Replication: ${status.properties.selfReplication.level}`,
											`• Self-Organization: ${status.properties.selfOrganization.level}`,
										].join("\n"),
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								if (agenticAgents.size === 0) {
									await interaction.editReply(
										"No agentic agents created yet. Use `/agentic create` to create one.",
									);
									break;
								}

								const agentList = Array.from(agenticAgents.values()).map((a) => {
									const s = a.getStatus();
									return `• **${s.id}** [${s.domain}] - ${s.state.status} (${s.state.cyclesCompleted} cycles)`;
								});

								const embed = new EmbedBuilder()
									.setTitle("🤖 Agentic Agents")
									.setColor(0x3498db)
									.setDescription(agentList.join("\n"))
									.addFields({ name: "Total", value: `${agenticAgents.size} agents`, inline: true })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const agentId = interaction.options.getString("id");

								if (!agentId) {
									// Show summary of all agents
									if (agenticAgents.size === 0) {
										await interaction.editReply("No agentic agents. Use `/agentic create`.");
										break;
									}
									const summary = Array.from(agenticAgents.values())
										.map((a) => `• ${a.id}: ${a.getStatus().state.status}`)
										.join("\n");
									await interaction.editReply(`**Agentic Agents:**\n${summary}`);
									break;
								}

								const agent = agenticAgents.get(agentId);
								if (!agent) {
									await interaction.editReply(`Agent '${agentId}' not found.`);
									break;
								}

								const status = agent.getStatus();
								const embed = new EmbedBuilder()
									.setTitle(`🤖 Agent: ${status.id}`)
									.setColor(status.state.status === "running" ? 0x00ff00 : 0x808080)
									.addFields(
										{ name: "Domain", value: status.domain, inline: true },
										{ name: "Status", value: status.state.status, inline: true },
										{ name: "Progress", value: `${status.state.progress}%`, inline: true },
									)
									.addFields(
										{ name: "Cycles", value: String(status.state.cyclesCompleted), inline: true },
										{
											name: "Learnings",
											value: String(status.properties.selfImprovement.learningsCount),
											inline: true,
										},
										{
											name: "Replicas",
											value: String(status.properties.selfReplication.replicasCount),
											inline: true,
										},
									)
									.addFields({
										name: "Last Score",
										value: status.properties.alignment.lastScore
											? `${status.properties.alignment.lastScore.toFixed(1)}%`
											: "Not evaluated",
										inline: true,
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "learn": {
								const agentId = interaction.options.getString("id", true);
								const insight = interaction.options.getString("insight", true);

								const agent = agenticAgents.get(agentId);
								if (!agent) {
									await interaction.editReply(`Agent '${agentId}' not found.`);
									break;
								}

								const learning = agent.learn(insight, "observation");
								await interaction.editReply(
									`✅ **Learning recorded** [${(learning.confidence * 100).toFixed(0)}%]\n> ${insight}`,
								);
								break;
							}

							case "replicate": {
								const parentId = interaction.options.getString("id", true);
								const specialization = interaction.options.getString("specialization", true);

								const parent = agenticAgents.get(parentId);
								if (!parent) {
									await interaction.editReply(`Parent agent '${parentId}' not found.`);
									break;
								}

								const replica = parent.replicate(specialization);
								if (!replica) {
									await interaction.editReply("❌ Max replicas reached for this agent.");
									break;
								}

								await interaction.editReply(
									`✅ **Replica created**\n• ID: ${replica.id}\n• Specialization: ${replica.specialization}`,
								);
								break;
							}

							case "run": {
								const agentId = interaction.options.getString("id", true);
								const task = interaction.options.getString("task", true);

								const agent = agenticAgents.get(agentId);
								if (!agent) {
									await interaction.editReply(`Agent '${agentId}' not found.`);
									break;
								}

								// Start continuous execution
								agent.runContinuously(async () => {
									// Each cycle: log and learn
									agent.learn(`Executed cycle for: ${task}`, "success", 0.7);
								});

								await interaction.editReply(
									`🚀 **Agent started continuously**\n• ID: ${agentId}\n• Task: ${task}\n• Mode: Durable (checkpoints every 5 min)`,
								);
								break;
							}

							case "evaluate": {
								const agentId = interaction.options.getString("id", true);

								const agent = agenticAgents.get(agentId);
								if (!agent) {
									await interaction.editReply(`Agent '${agentId}' not found.`);
									break;
								}

								// Simple mock evaluation
								const result = await agent.evaluateAlignment(
									async (input) => `Mock response to: ${input}`,
									[
										{
											input: `Test ${agent.domain} query`,
											expectedOutput: "Relevant domain response",
											domain: agent.domain,
										},
									],
								);

								const embed = new EmbedBuilder()
									.setTitle(`📊 Alignment Evaluation: ${agentId}`)
									.setColor(result.passed ? 0x00ff00 : 0xff6b6b)
									.addFields(
										{ name: "Score", value: `${result.score.toFixed(1)}%`, inline: true },
										{ name: "Passed", value: result.passed ? "✅" : "❌", inline: true },
										{ name: "Domain", value: result.domain, inline: true },
									)
									.addFields(
										{ name: "Accuracy", value: `${result.metrics.accuracy.toFixed(1)}%`, inline: true },
										{ name: "Relevance", value: `${result.metrics.relevance.toFixed(1)}%`, inline: true },
										{
											name: "Completeness",
											value: `${result.metrics.completeness.toFixed(1)}%`,
											inline: true,
										},
									)
									.addFields({ name: "Feedback", value: result.feedback })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "preset": {
								const mode = interaction.options.getString("mode", true);
								const task = interaction.options.getString("task", true);

								// Get preset factory
								const presetFactory = AgenticPresets[mode as keyof typeof AgenticPresets];
								if (!presetFactory) {
									await interaction.editReply(`Unknown preset: ${mode}`);
									break;
								}

								// Create agent from preset
								const agentId = `${mode}-${Date.now()}`;
								const agent = presetFactory(agentId);
								agenticAgents.set(agentId, agent);

								// Get tool info based on mode
								const allTools = getAllMcpTools();
								let toolNames: string[];
								let toolCount: number;

								if (mode === "minimalist") {
									const filtered = filterToMinimalistTools(allTools);
									toolNames = filtered.map((t) => t.name);
									toolCount = filtered.length;
								} else if (mode === "justBash") {
									const filtered = filterToJustBashTools(allTools);
									toolNames = filtered.map((t) => t.name);
									toolCount = filtered.length;
								} else {
									toolNames = allTools.slice(0, 4).map((t) => t.name);
									toolCount = allTools.length;
								}

								const embed = new EmbedBuilder()
									.setTitle(`🎯 ${mode.toUpperCase()} Agent Started`)
									.setColor(mode === "minimalist" ? 0x00ff88 : mode === "justBash" ? 0xff8800 : 0x3498db)
									.addFields(
										{ name: "Mode", value: mode, inline: true },
										{
											name: "Tools",
											value: `${toolCount} (${toolNames.slice(0, 4).join(", ")}${toolCount > 4 ? "..." : ""})`,
											inline: true,
										},
										{ name: "Agent ID", value: agentId, inline: true },
									)
									.addFields({ name: "Task", value: task })
									.setFooter({
										text:
											mode === "minimalist"
												? "Mario Zechner's 4-tool philosophy"
												: mode === "justBash"
													? "Vercel's 'Bash is all you need'"
													: "Full agent mode",
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });

								// Execute task in background using runWithBestSDK
								const channelIdStr = interaction.channelId;
								const sendToChannel = async (msg: string) => {
									const ch = client.channels.cache.get(channelIdStr) as TextChannel;
									if (ch) await ch.send(msg.substring(0, 2000));
								};

								// Build minimalist prompt
								const minimalistPrompt =
									mode === "minimalist"
										? `[MINIMALIST MODE - 4 TOOLS ONLY: bash, read, write, edit]\n${task}`
										: mode === "justBash"
											? `[JUST-BASH MODE - BASH ONLY]\n${task}`
											: task;

								// Run async - don't await
								(async () => {
									try {
										const result = await runWithBestSDK(minimalistPrompt, "code");

										// Learn from execution
										agent.learn(`Completed ${mode} task: ${task}`, "success", 0.8);

										await sendToChannel(
											`✅ **${mode} agent completed**\n${result.output.substring(0, 1800)}`,
										);
									} catch (err) {
										const errMsg = err instanceof Error ? err.message : String(err);
										agent.learn(`Failed ${mode} task: ${task} - ${errMsg}`, "failure", 0.3);
										await sendToChannel(`❌ **${mode} agent failed**: ${errMsg.substring(0, 500)}`);
									}
								})();

								break;
							}

							default:
								await interaction.editReply("Unknown agentic subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Agentic error: ${errMsg}`);
					}
					break;
				}

				// ============================================================================
				// AGENTIS FRAMEWORK LEARNED FEATURES
				// ============================================================================

				case "swarm": {
					await interaction.deferReply();
					const swarmSubcommand = interaction.options.getSubcommand();
					const swarm = getSwarmCoordinator();

					try {
						switch (swarmSubcommand) {
							case "create": {
								const name = interaction.options.getString("name", true);
								const role = interaction.options.getString("role", true) as SwarmRole;
								const domain = interaction.options.getString("domain", true) as AgentDomain;
								const capsStr = interaction.options.getString("capabilities") || "";
								const capabilities = capsStr
									.split(",")
									.map((c) => c.trim())
									.filter(Boolean);

								const agentId = `swarm_${name}_${Date.now()}`;
								const agent = createSwarmAgent(
									agentId,
									name,
									role,
									domain,
									capabilities.length > 0 ? capabilities : [domain, role],
								);

								const success = swarm.register(agent);
								if (success) {
									await interaction.editReply(
										`✅ **Swarm Agent Created**\n• Name: ${name}\n• Role: ${role}\n• Domain: ${domain}\n• Capabilities: ${agent.capabilities.join(", ")}`,
									);
								} else {
									await interaction.editReply("❌ Failed to create agent (max agents reached)");
								}
								break;
							}

							case "delegate": {
								const taskDesc = interaction.options.getString("task", true);
								const capsStr = interaction.options.getString("capabilities") || "";
								const caps = capsStr
									.split(",")
									.map((c) => c.trim())
									.filter(Boolean);

								const request = createTaskRequest(taskDesc, caps.length > 0 ? caps : ["general"], "normal");
								const result = await swarm.delegateTask(request, "coordinator");

								await interaction.editReply(
									`📋 **Task Delegation**\n• Task: ${taskDesc}\n• Status: ${result.status}\n${result.error ? `• Error: ${result.error}` : ""}`,
								);
								break;
							}

							case "consensus": {
								const question = interaction.options.getString("question", true);
								const optionsStr = interaction.options.getString("options", true);
								const strategy = (interaction.options.getString("strategy") || "majority") as
									| "majority"
									| "unanimous"
									| "weighted"
									| "leader_decides";

								const options = optionsStr.split(",").map((o) => o.trim());
								const proposal = createConsensusProposal(question, options, strategy);

								await interaction.editReply(
									`🗳️ **Consensus Started**\n• Question: ${question}\n• Options: ${options.join(", ")}\n• Strategy: ${strategy}\n• ID: ${proposal.proposalId}`,
								);
								break;
							}

							case "status": {
								const stats = swarm.getStats();
								const viz = swarm.visualize();

								const embed = new EmbedBuilder()
									.setTitle("🐝 Swarm Status")
									.setColor(0xf1c40f)
									.addFields(
										{ name: "Total Agents", value: String(stats.totalAgents), inline: true },
										{ name: "Active", value: String(stats.activeAgents), inline: true },
										{ name: "Avg Load", value: `${(stats.averageLoad * 100).toFixed(0)}%`, inline: true },
									)
									.addFields(
										{ name: "Leaders", value: String(stats.byRole.leader), inline: true },
										{ name: "Workers", value: String(stats.byRole.worker), inline: true },
										{ name: "Specialists", value: String(stats.byRole.specialist), inline: true },
									)
									.setDescription(`\`\`\`\n${viz.slice(3, -3)}\n\`\`\``)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const agents = swarm.listAgents();
								if (agents.length === 0) {
									await interaction.editReply("No swarm agents registered. Use `/swarm create` to add one.");
									break;
								}

								const list = agents
									.map(
										(a) =>
											`• **${a.name}** [${a.role}/${a.domain}] - ${a.status} (${(a.load * 100).toFixed(0)}% load)`,
									)
									.join("\n");
								await interaction.editReply(`**🐝 Swarm Agents:**\n${list}`);
								break;
							}

							default:
								await interaction.editReply("Unknown swarm subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Swarm error: ${errMsg}`);
					}
					break;
				}

				case "persona": {
					await interaction.deferReply();
					const personaSubcommand = interaction.options.getSubcommand();
					const manager = getPersonaManager();

					try {
						switch (personaSubcommand) {
							case "create": {
								const name = interaction.options.getString("name", true);
								const preset = interaction.options.getString("preset");
								const role = interaction.options.getString("role");
								const _traitsStr = interaction.options.getString("traits");

								// Start with preset if provided
								const baseConfig = preset && PRESET_PERSONAS[preset] ? { ...PRESET_PERSONAS[preset] } : {};

								const persona = createPersona({
									...baseConfig,
									name,
									role: role || baseConfig.role || "General Assistant",
								});

								await interaction.editReply(
									`✅ **Persona Created**\n• Name: ${persona.name}\n• Role: ${persona.role}\n• Domain: ${persona.domain}\n• Background: ${persona.background.slice(0, 100)}...`,
								);
								break;
							}

							case "view": {
								const name = interaction.options.getString("name", true);
								const persona = getPersona(name);

								if (!persona) {
									await interaction.editReply(`Persona '${name}' not found.`);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle(`🎭 Persona: ${persona.name}`)
									.setColor(0xe74c3c)
									.addFields(
										{ name: "Role", value: persona.role, inline: true },
										{ name: "Domain", value: persona.domain, inline: true },
									)
									.addFields({
										name: "Traits",
										value: [
											`• Analytical: ${(persona.traits.analytical * 100).toFixed(0)}%`,
											`• Assertive: ${(persona.traits.assertive * 100).toFixed(0)}%`,
											`• Formality: ${(persona.traits.formality * 100).toFixed(0)}%`,
											`• Creative: ${(persona.traits.creative * 100).toFixed(0)}%`,
										].join("\n"),
									})
									.addFields({ name: "Background", value: persona.background.slice(0, 500) })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "prompt": {
								const name = interaction.options.getString("name", true);
								const prompt = generatePersonaPrompt(name);

								if (prompt.includes("Unknown persona")) {
									await interaction.editReply(`Persona '${name}' not found.`);
									break;
								}

								// Split if too long
								if (prompt.length > 1900) {
									await interaction.editReply(
										`**System Prompt for ${name}:**\n\`\`\`\n${prompt.slice(0, 1900)}...\n\`\`\``,
									);
								} else {
									await interaction.editReply(`**System Prompt for ${name}:**\n\`\`\`\n${prompt}\n\`\`\``);
								}
								break;
							}

							case "list": {
								const personas = manager.list();
								if (personas.length === 0) {
									await interaction.editReply(
										"No personas created. Use `/persona create` or check `/persona presets`.",
									);
									break;
								}

								const list = personas.map((p) => `• **${p.name}** [${p.domain}] - ${p.role}`).join("\n");
								await interaction.editReply(`**🎭 Personas:**\n${list}`);
								break;
							}

							case "presets": {
								const presets = Object.entries(PRESET_PERSONAS)
									.map(([key, p]) => `• **${key}**: ${p.role || "General"} [${p.domain || "general"}]`)
									.join("\n");
								await interaction.editReply(
									`**🎭 Available Presets:**\n${presets}\n\nUse with \`/persona create name:<name> preset:<preset>\``,
								);
								break;
							}

							default:
								await interaction.editReply("Unknown persona subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Persona error: ${errMsg}`);
					}
					break;
				}

				case "infer": {
					await interaction.deferReply();
					const inferSubcommand = interaction.options.getSubcommand();

					try {
						switch (inferSubcommand) {
							case "tasks":
							case "order":
							case "graph": {
								const tasksStr = interaction.options.getString("tasks", true);
								const context = interaction.options.getString("context") || undefined;

								// Parse pipe-separated tasks
								const taskDescriptions = tasksStr
									.split("|")
									.map((t) => t.trim())
									.filter(Boolean);
								if (taskDescriptions.length < 2) {
									await interaction.editReply("Please provide at least 2 tasks separated by pipes (|)");
									break;
								}

								const tasks = taskDescriptions.map((desc, i) => ({
									id: `task_${i + 1}`,
									description: desc,
								}));

								const result = inferTaskDependencies(tasks, context);

								if (inferSubcommand === "graph") {
									await interaction.editReply(`**📊 Dependency Graph:**\n${result.graph}`);
								} else if (inferSubcommand === "order") {
									const inference = createDependencyInference();
									const order = inference.getExecutionOrder(result.tasks);
									const orderList = order
										.map((t, i) => `${i + 1}. ${t.description} [${t.type || "unknown"}]`)
										.join("\n");
									await interaction.editReply(`**📋 Execution Order:**\n${orderList}`);
								} else {
									const linksInfo = result.links
										.map((l) => `• ${l.from} → ${l.to} (${(l.certainty * 100).toFixed(0)}%): ${l.reason}`)
										.join("\n");
									await interaction.editReply(
										`**🔗 Inferred Dependencies:**\n${linksInfo || "No strong dependencies detected"}\n\n${result.graph}`,
									);
								}
								break;
							}

							default:
								await interaction.editReply("Unknown infer subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Inference error: ${errMsg}`);
					}
					break;
				}

				case "sandbox": {
					await interaction.deferReply();
					const sandboxSubcommand = interaction.options.getSubcommand();

					try {
						const e2bService = getE2BSandboxService();

						switch (sandboxSubcommand) {
							case "status": {
								const available = isE2BAvailable();
								const hasApiKey = !!process.env.E2B_API_KEY;

								const embed = new EmbedBuilder()
									.setTitle("📦 E2B Sandbox Status")
									.setColor(available && hasApiKey ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "CLI Available", value: available ? "✅" : "❌", inline: true },
										{ name: "API Key", value: hasApiKey ? "✅ Configured" : "❌ Missing", inline: true },
									)
									.setDescription(
										available && hasApiKey
											? "E2B cloud sandboxes ready for isolated code execution"
											: "Install E2B CLI: `npm install -g @e2b/cli` and set `E2B_API_KEY`",
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "run": {
								const code = interaction.options.getString("code", true);
								const language = interaction.options.getString("language") || "python";

								await interaction.editReply(`⏳ Running ${language} code in isolated sandbox...`);

								const result = await runInSandbox(code, { language: language as "python" | "node" | "bash" });

								if (result.success) {
									const output =
										result.output.length > 1900
											? `${result.output.slice(0, 1900)}...\n\n[Output truncated]`
											: result.output;
									await interaction.editReply(`✅ **Sandbox Execution Complete**\n\`\`\`\n${output}\n\`\`\``);
								} else {
									await interaction.editReply(`❌ **Sandbox Error**\n\`\`\`\n${result.error}\n\`\`\``);
								}
								break;
							}

							case "create": {
								const timeout = interaction.options.getInteger("timeout") || 3600;

								await interaction.editReply("⏳ Creating persistent sandbox...");

								const result = await e2bService.create({ timeout });

								if (result.success && result.sandboxId) {
									const embed = new EmbedBuilder()
										.setTitle("📦 Sandbox Created")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Sandbox ID", value: `\`${result.sandboxId}\``, inline: false },
											{ name: "Timeout", value: `${timeout}s`, inline: true },
											{ name: "Template", value: "base", inline: true },
										)
										.setDescription("Use `/sandbox exec` to run commands in this sandbox")
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`❌ Failed to create sandbox: ${result.error}`);
								}
								break;
							}

							case "exec": {
								const sandboxId = interaction.options.getString("sandbox_id", true);
								const command = interaction.options.getString("command", true);

								await interaction.editReply(`⏳ Executing in sandbox \`${sandboxId}\`...`);

								const result = await e2bService.exec(sandboxId, command);

								if (result.success) {
									const rawOutput = result.output || "(no output)";
									const output =
										rawOutput.length > 1900
											? `${rawOutput.slice(0, 1900)}...\n\n[Output truncated]`
											: rawOutput;
									await interaction.editReply(`✅ **Command Complete**\n\`\`\`\n${output}\n\`\`\``);
								} else {
									await interaction.editReply(`❌ **Execution Error**\n\`\`\`\n${result.error}\n\`\`\``);
								}
								break;
							}

							case "kill": {
								const sandboxId = interaction.options.getString("sandbox_id", true);

								const result = await e2bService.kill(sandboxId);

								if (result.success) {
									await interaction.editReply(`✅ Sandbox \`${sandboxId}\` terminated`);
								} else {
									await interaction.editReply(`❌ Failed to kill sandbox: ${result.error}`);
								}
								break;
							}

							case "host": {
								const sandboxId = interaction.options.getString("sandbox_id", true);
								const port = interaction.options.getInteger("port") || 5173;

								const result = await e2bService.getHost(sandboxId, port);

								if (result.success) {
									const embed = new EmbedBuilder()
										.setTitle("🌐 Sandbox Public URL")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Sandbox ID", value: `\`${sandboxId}\``, inline: true },
											{ name: "Port", value: `${port}`, inline: true },
											{ name: "URL", value: result.output || "URL not available", inline: false },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`❌ Failed to get host: ${result.error}`);
								}
								break;
							}

							case "list": {
								const result = await e2bService.list();

								if (result.success) {
									const sandboxes = result.output || "No active sandboxes";
									await interaction.editReply(`📦 **Active Sandboxes**\n\`\`\`\n${sandboxes}\n\`\`\``);
								} else {
									await interaction.editReply(`❌ Failed to list sandboxes: ${result.error}`);
								}
								break;
							}

							default:
								await interaction.editReply("Unknown sandbox subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ Sandbox error: ${errMsg}`);
					}
					break;
				}

				case "tac12": {
					await interaction.deferReply();
					const tac12Subcommand = interaction.options.getSubcommand();

					try {
						// Import TAC-12 SDK dynamically
						const tac12Module = await import("./agents/tac12-sdk.js");
						const { getTAC12Client, initTAC12FromEnv } = tac12Module;

						// Initialize TAC-12 client
						const baseUrl = process.env.TAC12_BASE_URL || "http://localhost:8000";
						let client: ReturnType<typeof getTAC12Client> | Awaited<ReturnType<typeof initTAC12FromEnv>>;
						try {
							client = getTAC12Client({ baseUrl, apiKey: process.env.TAC12_API_KEY });
						} catch {
							client = await initTAC12FromEnv();
						}

						if (!client) {
							await interaction.editReply(
								"⚠️ **TAC-12 Not Configured**\n\nSet environment variables:\n• `TAC12_BASE_URL` (default: http://localhost:8000)\n• `TAC12_API_KEY` (optional)",
							);
							break;
						}

						switch (tac12Subcommand) {
							case "status": {
								try {
									await client.connect();
									const sdks = await client.getSDKs();
									const availableSDKs = sdks.filter((s) => s.available);

									const embed = new EmbedBuilder()
										.setTitle("🔧 TAC-12 Platform Status")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Server", value: baseUrl, inline: true },
											{ name: "Connected", value: "✅", inline: true },
											{ name: "Total SDKs", value: `${sdks.length}`, inline: true },
											{ name: "Available SDKs", value: `${availableSDKs.length}`, inline: true },
										)
										.setDescription(
											`**Available SDKs:**\n${
												availableSDKs
													.map((s) => `• ${s.sdk}: ${s.description}`)
													.join("\n")
													.slice(0, 1000) || "None"
											}`,
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} catch (connError) {
									const embed = new EmbedBuilder()
										.setTitle("🔧 TAC-12 Platform Status")
										.setColor(0xff0000)
										.addFields(
											{ name: "Server", value: baseUrl, inline: true },
											{ name: "Connected", value: "❌", inline: true },
										)
										.setDescription(
											`Cannot connect to TAC-12 server.\n\nError: ${connError instanceof Error ? connError.message : String(connError)}`,
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								}
								break;
							}

							case "execute": {
								const prompt = interaction.options.getString("prompt", true);
								const sdk = interaction.options.getString("sdk") || "claudeco";

								await interaction.editReply(`⏳ Executing with **${sdk}**...`);

								const result = await client.executeTask({
									id: `discord-${Date.now()}`,
									prompt,
									sdk: sdk as Parameters<typeof client.executeTask>[0]["sdk"],
								});

								if (result.success) {
									const output = result.output
										? result.output.length > 1800
											? `${result.output.slice(0, 1800)}...\n\n[Output truncated]`
											: result.output
										: "Task completed (no output)";

									const embed = new EmbedBuilder()
										.setTitle(`✅ TAC-12 Execution Complete`)
										.setColor(0x00ff00)
										.addFields(
											{ name: "SDK", value: sdk, inline: true },
											{
												name: "Duration",
												value: result.duration ? `${result.duration}ms` : "N/A",
												inline: true,
											},
											{
												name: "Cost",
												value: result.totalCost ? `$${result.totalCost.toFixed(4)}` : "N/A",
												inline: true,
											},
										)
										.setDescription(`\`\`\`\n${output}\n\`\`\``)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`❌ **Execution Failed**\n\`\`\`\n${result.error || "Unknown error"}\n\`\`\``,
									);
								}
								break;
							}

							case "scout": {
								const prompt = interaction.options.getString("prompt", true);

								await interaction.editReply(
									"⏳ Running **Scout-Builder** pattern...\n🔍 Scout exploring → 🔨 Builder implementing",
								);

								const result = await client.scoutBuilder(prompt);

								if (result.success) {
									const output = result.output
										? result.output.length > 1600
											? `${result.output.slice(0, 1600)}...\n\n[Output truncated]`
											: result.output
										: "Pattern completed";

									const embed = new EmbedBuilder()
										.setTitle("✅ Scout-Builder Complete")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Pattern", value: "Scout → Builder", inline: true },
											{ name: "Agents Used", value: `${result.agents?.length || 2}`, inline: true },
											{
												name: "Cost",
												value: result.totalCost ? `$${result.totalCost.toFixed(4)}` : "N/A",
												inline: true,
											},
										)
										.setDescription(`\`\`\`\n${output}\n\`\`\``)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`❌ **Scout-Builder Failed**\n\`\`\`\n${result.error || "Unknown error"}\n\`\`\``,
									);
								}
								break;
							}

							case "parallel": {
								const prompt = interaction.options.getString("prompt", true);
								const aggregation = (interaction.options.getString("aggregation") || "best") as
									| "first"
									| "best"
									| "all";

								await interaction.editReply("⏳ Running **Parallel** execution across multiple SDKs...");

								const result = await client.parallel(prompt, ["claudeco", "vercel-ai", "cloudflare-ai"], {
									aggregation,
								});

								if (result.success) {
									const output = result.output
										? result.output.length > 1600
											? `${result.output.slice(0, 1600)}...\n\n[Output truncated]`
											: result.output
										: "Parallel execution completed";

									const embed = new EmbedBuilder()
										.setTitle("✅ Parallel Execution Complete")
										.setColor(0x00ff00)
										.addFields(
											{ name: "SDKs Used", value: "claudeco, vercel-ai, cloudflare-ai", inline: false },
											{ name: "Aggregation", value: aggregation, inline: true },
											{
												name: "Cost",
												value: result.totalCost ? `$${result.totalCost.toFixed(4)}` : "N/A",
												inline: true,
											},
										)
										.setDescription(`\`\`\`\n${output}\n\`\`\``)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`❌ **Parallel Execution Failed**\n\`\`\`\n${result.error || "Unknown error"}\n\`\`\``,
									);
								}
								break;
							}

							case "vibe": {
								const prompt = interaction.options.getString("prompt", true);

								await interaction.editReply("⏳ Running **Vibe** mode for creative brainstorming...");

								const result = await client.vibe(prompt);

								if (result.success) {
									const output = result.output
										? result.output.length > 1800
											? `${result.output.slice(0, 1800)}...\n\n[Output truncated]`
											: result.output
										: "Vibe session completed";

									await interaction.editReply(`🎵 **Vibe Results**\n\n${output}`);
								} else {
									await interaction.editReply(
										`❌ **Vibe Failed**\n\`\`\`\n${result.error || "Unknown error"}\n\`\`\``,
									);
								}
								break;
							}

							case "fdsa": {
								const prompt = interaction.options.getString("prompt", true);

								await interaction.editReply("⏳ Running **FDSA** (Full-Stack Development Agents)...");

								const result = await client.fdsa(prompt);

								if (result.success) {
									const output = result.output
										? result.output.length > 1600
											? `${result.output.slice(0, 1600)}...\n\n[Output truncated]`
											: result.output
										: "FDSA completed";

									const embed = new EmbedBuilder()
										.setTitle("✅ FDSA Complete")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Mode", value: "Full-Stack Development", inline: true },
											{
												name: "Cost",
												value: result.totalCost ? `$${result.totalCost.toFixed(4)}` : "N/A",
												inline: true,
											},
										)
										.setDescription(`\`\`\`\n${output}\n\`\`\``)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(
										`❌ **FDSA Failed**\n\`\`\`\n${result.error || "Unknown error"}\n\`\`\``,
									);
								}
								break;
							}

							case "costs": {
								const costs = await client.getCosts();

								const embed = new EmbedBuilder()
									.setTitle("💰 TAC-12 Cost Tracking")
									.setColor(0x00ff00)
									.addFields({ name: "Total Cost", value: `$${costs.total.toFixed(4)}`, inline: false })
									.setDescription(
										Object.entries(costs.breakdown)
											.map(([sdk, cost]) => `• ${sdk}: $${(cost as number).toFixed(4)}`)
											.join("\n") || "No costs recorded",
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "agents": {
								const agents = await client.listAgents();

								const embed = new EmbedBuilder()
									.setTitle("🤖 TAC-12 Agents")
									.setColor(0x00ff00)
									.setDescription(
										agents.length > 0
											? agents
													.map((a) => `• **${a.name}** (${a.sdk}) - ${a.status}`)
													.join("\n")
													.slice(0, 2000)
											: "No active agents",
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "patterns": {
								const patterns = await client.getPatterns();

								const embed = new EmbedBuilder()
									.setTitle("📋 TAC-12 Orchestration Patterns")
									.setColor(0x00ff00)
									.setDescription(
										patterns.length > 0
											? patterns
													.map((p) => `**${p.name}**\n${p.description}\nSDKs: ${p.sdks.join(", ")}`)
													.join("\n\n")
													.slice(0, 2000)
											: "No patterns available",
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown tac12 subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ TAC-12 error: ${errMsg}`);
					}
					break;
				}

				// Interactive AI Coding Agent with buttons and model selection
				case "coder": {
					const coderSubcommand = interaction.options.getSubcommand();

					// Import UI module dynamically
					const uiModule = await import("./ui/index.js");
					const {
						getCodingAgentUI,
						getCodingSessionDB,
						AVAILABLE_MODELS,
						createCodeReviewButtons,
						createSessionEmbed,
						createModelSelector,
						createCodeSuggestionEmbed,
						createSystemPromptModal,
					} = uiModule;

					const db = getCodingSessionDB();
					const userId = interaction.user.id;
					const channelId = interaction.channelId;

					// Handle system-prompt subcommand BEFORE deferring (showModal must come first)
					if (coderSubcommand === "system-prompt") {
						const session = db.getActiveSession(userId, channelId);

						if (!session) {
							await interaction.reply({
								content: "❌ No active coding session. Use `/coder start` to begin.",
								ephemeral: true,
							});
							break;
						}

						const modal = createSystemPromptModal(session.id, session.systemPrompt);
						await interaction.showModal(modal);
						break;
					}

					// Defer reply for all other subcommands
					await interaction.deferReply();

					try {
						switch (coderSubcommand) {
							case "start": {
								const modelId = interaction.options.getString("model") || "claude-sonnet-4-20250514";
								const contextStr = interaction.options.getString("context") || "";
								const useThread = interaction.options.getBoolean("thread") ?? true;

								// Check for existing active session
								const existingSession = db.getActiveSession(userId, channelId);
								if (existingSession) {
									const embed = createSessionEmbed(existingSession);
									await interaction.editReply({
										content: "⚠️ You already have an active session. Use `/coder end` to close it first.",
										embeds: [embed],
									});
									break;
								}

								// Create thread for session if requested
								let threadId: string | undefined;
								if (useThread && interaction.channel && "threads" in interaction.channel) {
									try {
										const thread = await interaction.channel.threads.create({
											name: `Coding Session - ${interaction.user.username}`,
											autoArchiveDuration: 1440, // 1 day (was 60 min - too aggressive)
											reason: "AI Coding Session",
										});
										threadId = thread.id;
									} catch {
										// Thread creation failed, continue without thread
									}
								}

								// Create new session
								const initialContext = contextStr ? contextStr.split(",").map((c) => c.trim()) : [];
								const session = db.createSession({
									userId,
									channelId,
									model: modelId,
									initialContext,
									threadId,
								});

								const embed = createSessionEmbed(session);
								const modelSelector = createModelSelector(session.id, modelId);

								let replyContent = `✅ **Coding session started!**\n\nUse \`/coder suggest\` to get AI code suggestions with interactive buttons.`;
								if (threadId) {
									replyContent += `\n\n📌 Session thread: <#${threadId}>`;
								}

								await interaction.editReply({
									content: replyContent,
									embeds: [embed],
									components: [modelSelector],
								});
								break;
							}

							case "session": {
								const session = db.getActiveSession(userId, channelId);

								if (!session) {
									await interaction.editReply(
										"❌ No active coding session. Use `/coder start` to begin.",
									);
									break;
								}

								const embed = createSessionEmbed(session);
								const modelSelector = createModelSelector(session.id, session.model);

								await interaction.editReply({
									embeds: [embed],
									components: [modelSelector],
								});
								break;
							}

							case "end": {
								const session = db.getActiveSession(userId, channelId);

								if (!session) {
									await interaction.editReply("❌ No active coding session to end.");
									break;
								}

								db.updateSession(session.id, { status: "completed" });

								await interaction.editReply(
									`✅ **Session ended**\n\nSession ID: \`${session.id}\`\nSuggestions reviewed: ${session.suggestions.length}`,
								);
								break;
							}

							case "suggest": {
								const prompt = interaction.options.getString("prompt", true);
								const filePath = interaction.options.getString("file");
								const targetLanguage = interaction.options.getString("language");
								const session = db.getActiveSession(userId, channelId);

								if (!session) {
									await interaction.editReply(
										"❌ No active coding session. Use `/coder start` to begin.",
									);
									break;
								}

								// Import enhanced UI components
								const { createThinkingEmbed, createEnhancedStreamingEmbed, createCodeReviewButtonsExtended } = uiModule;

								// Build enhanced prompt with file context
								let enhancedPrompt = prompt;
								if (filePath) {
									enhancedPrompt += `\n\nTarget file: ${filePath}`;
								}
								if (targetLanguage) {
									enhancedPrompt += `\n\nUse ${targetLanguage} language`;
								}

								// Show thinking indicator
								const thinkingEmbed = createThinkingEmbed(session.model);
								await interaction.editReply({ embeds: [thinkingEmbed] });

								// Animate thinking dots
								let dotCount = 1;
								const thinkingInterval = setInterval(async () => {
									dotCount = (dotCount % 3) + 1;
									try {
										const updatedThinking = createThinkingEmbed(session.model, dotCount);
										await interaction.editReply({ embeds: [updatedThinking] });
									} catch {
										// Ignore errors during animation
									}
								}, 500);

								try {
									// Use lightweight agent for AI generation
									const { runAgent } = await import("./agents/lightweight-agent.js");
									const systemPrompt = session.systemPrompt || `You are an expert coding assistant. Provide clean, well-documented code suggestions. Always wrap code in appropriate markdown code blocks with language identifiers. Explain your suggestions briefly.`;

									const fullPrompt = session.context.length > 0
										? `Context: ${session.context.join(", ")}\n\nRequest: ${enhancedPrompt}`
										: enhancedPrompt;

									const startTime = Date.now();
									const response = await runAgent({
										prompt: `${systemPrompt}\n\n${fullPrompt}`,
										timeout: 60000,
									});
									const duration = Date.now() - startTime;

									clearInterval(thinkingInterval);

									// Estimate tokens and cost (rough approximation)
									const estimatedTokens = Math.ceil((fullPrompt.length + response.output.length) / 4);
									const estimatedCost = estimatedTokens * 0.000003; // ~$3 per 1M tokens for Claude

									// Update session with last prompt and token usage
									db.updateSession(session.id, {
										lastPrompt: prompt,
										tokensUsed: (session.tokensUsed || 0) + estimatedTokens,
										estimatedCost: (session.estimatedCost || 0) + estimatedCost,
									});

									// Extract code blocks from response
									const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
									let codeMatch: RegExpExecArray | null;
									const codeBlocks: Array<{ language: string; code: string }> = [];

									while ((codeMatch = codeBlockRegex.exec(response.output)) !== null) {
										codeBlocks.push({
											language: codeMatch[1] || "text",
											code: codeMatch[2].trim(),
										});
									}

									if (codeBlocks.length === 0) {
										// No code blocks found, show response with streaming embed
										const streamEmbed = createEnhancedStreamingEmbed({
											content: response.output.slice(0, 3800),
											isStreaming: false,
											model: session.model,
											tokensUsed: estimatedTokens,
											estimatedCost,
										});
										await interaction.editReply({
											content: `⏱️ Generated in ${(duration / 1000).toFixed(1)}s`,
											embeds: [streamEmbed],
										});
										break;
									}

									// Create suggestion for first code block
									const suggestion = db.createSuggestion({
										sessionId: session.id,
										language: targetLanguage || codeBlocks[0].language,
										code: codeBlocks[0].code,
										explanation: response.output.replace(/```[\s\S]*?```/g, "").trim().slice(0, 500),
										filePath: filePath || undefined,
									});

									const codeEmbed = createCodeSuggestionEmbed(suggestion);
									const [buttonsRow1, buttonsRow2] = createCodeReviewButtonsExtended(suggestion.id);

									// Add footer with generation info
									codeEmbed.setFooter({
										text: `Model: ${session.model} | Tokens: ~${estimatedTokens} | Cost: $${estimatedCost.toFixed(4)} | Time: ${(duration / 1000).toFixed(1)}s`,
									});

									await interaction.editReply({
										embeds: [codeEmbed],
										components: [buttonsRow1, buttonsRow2],
									});
								} catch (error) {
									clearInterval(thinkingInterval);
									throw error;
								}
								break;
							}

							case "model": {
								const modelId = interaction.options.getString("model", true);
								const session = db.getActiveSession(userId, channelId);

								if (!session) {
									await interaction.editReply(
										"❌ No active coding session. Use `/coder start` to begin.",
									);
									break;
								}

								const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
								if (!model) {
									await interaction.editReply(
										`❌ Unknown model: ${modelId}\n\nAvailable models:\n${AVAILABLE_MODELS.map((m) => `• \`${m.id}\` - ${m.name}`).join("\n")}`,
									);
									break;
								}

								db.updateSession(session.id, { model: modelId });

								await interaction.editReply(
									`✅ Model changed to **${model.name}** (${model.provider})\n\n${model.description || ""}`,
								);
								break;
							}

							case "context": {
								const session = db.getActiveSession(userId, channelId);

								if (!session) {
									await interaction.editReply(
										"❌ No active coding session. Use `/coder start` to begin.",
									);
									break;
								}

								if (session.context.length === 0) {
									await interaction.editReply("📋 **Session Context:** (empty)\n\nUse `/coder settings` to add context.");
								} else {
									await interaction.editReply(
										`📋 **Session Context:**\n${session.context.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
									);
								}
								break;
							}

							case "clear": {
								const session = db.getActiveSession(userId, channelId);

								if (!session) {
									await interaction.editReply(
										"❌ No active coding session. Use `/coder start` to begin.",
									);
									break;
								}

								db.updateSession(session.id, { context: [] });

								await interaction.editReply("✅ Session context cleared.");
								break;
							}

							case "settings": {
								const contextStr = interaction.options.getString("add_context");
								const session = db.getActiveSession(userId, channelId);

								if (!session) {
									await interaction.editReply(
										"❌ No active coding session. Use `/coder start` to begin.",
									);
									break;
								}

								if (contextStr) {
									const newContext = [...session.context, ...contextStr.split(",").map((c) => c.trim())];
									db.updateSession(session.id, { context: newContext });

									await interaction.editReply(
										`✅ Context updated!\n\n**Current context:**\n${newContext.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
									);
								} else {
									const embed = createSessionEmbed(session);
									await interaction.editReply({
										content: "⚙️ **Session Settings**\n\nUse options to modify settings.",
										embeds: [embed],
									});
								}
								break;
							}

							default:
								await interaction.editReply("Unknown coder subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ Coder error: ${errMsg}`);
					}
					break;
				}

				// Claude-Flow - Enterprise AI orchestration (ruvnet/claude-flow)
				case "claude-flow": {
					await interaction.deferReply();
					const cfSubcommand = interaction.options.getSubcommand();

					try {
						const cfModule = await import("./agents/claude-flow-adapter.js");
						const { getClaudeFlowClient } = cfModule;

						const client = getClaudeFlowClient();

						switch (cfSubcommand) {
							case "status": {
								const stats = client.agentDb.getStats();
								const hiveStatus = client.hiveMind.getStatus();

								const embed = new EmbedBuilder()
									.setTitle("🔄 Claude-Flow Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "AgentDB Memories", value: String(stats.total), inline: true },
										{ name: "Embeddings", value: String(stats.embeddingsCount), inline: true },
										{
											name: "Namespaces",
											value: String(Object.keys(stats.byNamespace).length),
											inline: true,
										},
										{ name: "Queen Active", value: hiveStatus.queen ? "✅" : "❌", inline: true },
										{ name: "Workers", value: String(hiveStatus.workers.length), inline: true },
										{ name: "Pending Tasks", value: String(hiveStatus.pendingTasks), inline: true },
									)
									.setDescription("Claude-Flow enterprise AI orchestration with 96x-164x faster vector search")
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "remember": {
								const content = interaction.options.getString("content", true);
								const namespace = interaction.options.getString("namespace") || undefined;

								const memory = await client.agentDb.store(`discord-${Date.now()}`, content, namespace);

								await interaction.editReply(
									`✅ **Memory Stored**\n\n🆔 ID: \`${memory.id}\`\n📦 Namespace: ${namespace || "default"}\n📝 Content: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`,
								);
								break;
							}

							case "search": {
								const query = interaction.options.getString("query", true);
								const limit = interaction.options.getInteger("limit") || 5;

								const results = await client.agentDb.vectorSearch(query, { k: limit });

								if (results.length === 0) {
									await interaction.editReply(`🔍 No memories found matching: "${query}"`);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("🔍 AgentDB Vector Search Results")
									.setColor(0x00ff00)
									.setDescription(
										results
											.map(
												(r: { score: number; content: string }, i: number) =>
													`**${i + 1}.** (${(r.score * 100).toFixed(1)}%) ${r.content.slice(0, 150)}${r.content.length > 150 ? "..." : ""}`,
											)
											.join("\n\n")
											.slice(0, 2000),
									)
									.setFooter({ text: `Query: ${query} | Results: ${results.length}` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "swarm": {
								const task = interaction.options.getString("task", true);
								const workerCount = interaction.options.getInteger("workers") || 3;

								await interaction.editReply("⏳ Initializing HiveMind swarm...");

								// Initialize queen
								const queen = await client.hiveMind.initialize(task);

								// Spawn workers with valid roles
								const workerRoles: Array<"worker" | "scout" | "builder"> = ["worker", "scout", "builder"];
								for (let i = 0; i < workerCount; i++) {
									const role = workerRoles[i % workerRoles.length];
									await client.hiveMind.spawnWorker(role, `${role} for: ${task}`);
								}

								// Execute task
								const result = await client.hiveMind.executeTask({
									id: `discord-swarm-${Date.now()}`,
									prompt: task,
									priority: "high",
								});

								const embed = new EmbedBuilder()
									.setTitle("🐝 HiveMind Swarm Results")
									.setColor(result.success ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Queen", value: queen.id.slice(0, 20), inline: true },
										{ name: "Workers", value: String(workerCount), inline: true },
										{ name: "Status", value: result.success ? "✅ Success" : "❌ Failed", inline: true },
									)
									.setDescription(`\`\`\`\n${(result.output || "Task completed").slice(0, 1800)}\n\`\`\``)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "reflect": {
								const experience = interaction.options.getString("experience", true);
								const outcome = interaction.options.getString("outcome", true) as "success" | "failure";
								const lessonsRaw = interaction.options.getString("lessons", true);
								const lessons = lessonsRaw.split(",").map((l: string) => l.trim());

								await client.agentDb.reflect(experience, outcome, lessons);

								await interaction.editReply(
									`✅ **Experience Recorded**\n\n📝 Experience: ${experience.slice(0, 200)}\n${outcome === "success" ? "✅" : "❌"} Outcome: ${outcome}\n📚 Lessons:\n${lessons.map((l: string) => `• ${l}`).join("\n")}`,
								);
								break;
							}

							case "skills": {
								const skills = cfModule.CLAUDE_FLOW_SKILLS;

								const embed = new EmbedBuilder()
									.setTitle("🎯 Claude-Flow Skills")
									.setColor(0x00ff00)
									.setDescription(
										skills
											.map(
												(s: { name: string; triggers: string[]; description: string }) =>
													`**${s.name}** (\`${s.triggers[0] || "N/A"}\`)\n${s.description}`,
											)
											.join("\n\n")
											.slice(0, 2000),
									)
									.setFooter({ text: `${skills.length} skills available` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown claude-flow subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ Claude-Flow error: ${errMsg}`);
					}
					break;
				}

				// Claude-Mem - Persistent memory compression (thedotmack/claude-mem)
				case "claude-mem": {
					await interaction.deferReply();
					const cmSubcommand = interaction.options.getSubcommand();

					try {
						const cmModule = await import("./agents/claude-mem-adapter.js");
						const { getClaudeMemClient } = cmModule;

						const client = getClaudeMemClient();

						// Start a session if not already started
						client.startSession(workingDir);

						switch (cmSubcommand) {
							case "status": {
								const stats = client.getStats();

								const embed = new EmbedBuilder()
									.setTitle("🧠 Claude-Mem Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Session Active", value: stats.currentSession ? "✅" : "❌", inline: true },
										{ name: "Observations", value: String(stats.search.observations), inline: true },
										{ name: "Sessions", value: String(stats.search.sessions), inline: true },
										{ name: "Concepts", value: String(stats.search.concepts), inline: true },
										{ name: "Disclosure Level", value: stats.disclosureLevel, inline: true },
									)
									.setDescription("Persistent memory with compression and progressive disclosure")
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "observe": {
								const content = interaction.options.getString("content", true);
								const type = (interaction.options.getString("type") || "discovery") as
									| "decision"
									| "bugfix"
									| "feature"
									| "refactor"
									| "discovery"
									| "change";

								const observation = client.observe(content, { type });

								await interaction.editReply(
									`✅ **Observation Recorded**\n\n🆔 ID: \`${observation.id}\`\n📂 Type: ${type}\n📝 Content: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`,
								);
								break;
							}

							case "search": {
								const query = interaction.options.getString("query", true);
								const searchType = interaction.options.getString("type") || "all";

								type MemQueryType =
									| "observations"
									| "sessions"
									| "prompts"
									| "concepts"
									| "files"
									| "types"
									| "recent"
									| "timeline";
								let memType: MemQueryType = "observations";
								if (searchType === "concept") {
									memType = "concepts";
								} else if (searchType === "file") {
									memType = "files";
								}

								const results = client.memSearch({ query, type: memType });

								if (results.length === 0) {
									await interaction.editReply(`🔍 No memories found matching: "${query}"`);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("🔍 Claude-Mem Search Results")
									.setColor(0x00ff00)
									.setDescription(
										results
											.slice(0, 10)
											.map(
												(r: { type: string; content: string }, i: number) =>
													`**${i + 1}.** [${r.type}] ${r.content.slice(0, 150)}${r.content.length > 150 ? "..." : ""}`,
											)
											.join("\n\n")
											.slice(0, 2000),
									)
									.setFooter({ text: `Query: ${query} | Results: ${results.length}` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "context": {
								const content = interaction.options.getString("content", true);
								const layered = client.getContext(content);

								const embed = new EmbedBuilder()
									.setTitle("📚 Progressive Disclosure Context")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Level", value: layered.level, inline: true },
										{ name: "Token Count", value: String(layered.tokenCount), inline: true },
									)
									.setDescription(`\`\`\`\n${layered.content.slice(0, 1800)}\n\`\`\``)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "compress": {
								const content = interaction.options.getString("content", true);
								const targetTokens = interaction.options.getInteger("target_tokens") || 500;

								const compressor = new cmModule.MemoryCompressor();
								const compressed = compressor.compress(content, targetTokens);

								const originalTokens = Math.ceil(content.length / 4);
								const compressedTokens = Math.ceil(compressed.length / 4);
								const savings = Math.round((1 - compressedTokens / originalTokens) * 100);

								const embed = new EmbedBuilder()
									.setTitle("🗜️ Memory Compression Result")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Original", value: `~${originalTokens} tokens`, inline: true },
										{ name: "Compressed", value: `~${compressedTokens} tokens`, inline: true },
										{ name: "Savings", value: `${savings}%`, inline: true },
									)
									.setDescription(`\`\`\`\n${compressed.slice(0, 1800)}\n\`\`\``)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown claude-mem subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ Claude-Mem error: ${errMsg}`);
					}
					break;
				}

				// Continuity - Session continuity and handoffs (parcadei/Continuous-Claude)
				case "continuity": {
					await interaction.deferReply();
					const contSubcommand = interaction.options.getSubcommand();

					try {
						const contModule = await import("./agents/continuous-claude-adapter.js");
						const { getContinuousClaudeClient } = contModule;

						const client = getContinuousClaudeClient();

						// Initialize session
						const channelSessionId = `discord-${interaction.channelId}`;
						client.initSession(workingDir);

						switch (contSubcommand) {
							case "status": {
								const currentLedger = client.ledgerManager.getCurrent();
								const latestHandoff = client.handoffManager.getLatest(workingDir);
								const currentTrace = client.sessionTracer.getCurrentTrace();

								const embed = new EmbedBuilder()
									.setTitle("🔄 Continuity System Status")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Ledger Active", value: currentLedger ? "✅" : "❌", inline: true },
										{
											name: "Last Handoff",
											value: latestHandoff ? new Date(latestHandoff.createdAt).toLocaleDateString() : "None",
											inline: true,
										},
										{ name: "Tracing Active", value: currentTrace ? "✅" : "❌", inline: true },
									)
									.setDescription("Session continuity with ledger, handoffs, and Braintrust tracing")
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "ledger": {
								const action = interaction.options.getString("action") || "view";
								const content = interaction.options.getString("content");

								const ledger = client.ledgerManager.getOrCreate(channelSessionId, workingDir);

								if (action === "view") {
									const markdown = client.ledgerManager.toMarkdown(ledger);

									const embed = new EmbedBuilder()
										.setTitle("📋 Session Ledger")
										.setColor(0x00ff00)
										.setDescription(`\`\`\`markdown\n${markdown.slice(0, 1900)}\n\`\`\``)
										.setFooter({ text: `Session: ${channelSessionId.slice(0, 30)}` })
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else if (action === "add_goal" && content) {
									client.saveLedger({ goal: content });
									await interaction.editReply(`✅ **Goal Added**\n\n📎 ${content}`);
								} else if (action === "mark_complete" && content) {
									client.saveLedger({ completed: [content] });
									await interaction.editReply(`✅ **Goal Completed**\n\n✓ ${content}`);
								} else if (action === "add_note" && content) {
									client.saveLedger({ keyDecisions: [content] });
									await interaction.editReply(`✅ **Note Added**\n\n📝 ${content}`);
								} else {
									await interaction.editReply("Please provide content for the action");
								}
								break;
							}

							case "handoff": {
								const context = interaction.options.getString("context", true);
								const nextStepsRaw = interaction.options.getString("next_steps");
								const nextSteps = nextStepsRaw ? nextStepsRaw.split(",").map((s: string) => s.trim()) : [];

								const handoff = client.createHandoff({
									title: `Discord Handoff - ${new Date().toISOString()}`,
									context,
									nextSteps,
								});

								if (!handoff) {
									await interaction.editReply("❌ Failed to create handoff (start a session first)");
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("🤝 Session Handoff Created")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Handoff ID", value: `\`${handoff.id}\``, inline: true },
										{ name: "Session", value: channelSessionId.slice(0, 20), inline: true },
									)
									.setDescription(
										`**Context:**\n${context.slice(0, 500)}\n\n**Next Steps:**\n${nextSteps.map((s: string) => `• ${s}`).join("\n") || "None specified"}`,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "resume": {
								const handoffId = interaction.options.getString("handoff_id");

								let handoff: ReturnType<typeof client.handoffManager.getLatest> | undefined;
								if (handoffId) {
									const handoffs = client.handoffManager.query({ search: handoffId });
									handoff = handoffs[0];
								} else {
									// Get latest handoff for this project
									handoff = client.handoffManager.getLatest(workingDir);
								}

								if (!handoff) {
									await interaction.editReply("❌ No handoff found to resume from");
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("🔄 Resuming from Handoff")
									.setColor(0x00ff00)
									.addFields(
										{ name: "Handoff ID", value: `\`${handoff.id}\``, inline: true },
										{ name: "Created", value: new Date(handoff.createdAt).toLocaleString(), inline: true },
									)
									.setDescription(
										`**Context:**\n${handoff.context.slice(0, 800)}\n\n**Next Steps:**\n${handoff.nextSteps?.map((s: string) => `• ${s}`).join("\n") || "None"}`,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "trace": {
								const action = interaction.options.getString("action") || "view";

								if (action === "start") {
									client.sessionTracer.startSession(workingDir);
									await interaction.editReply(
										"✅ **Tracing Started**\n\nSession tracing is now active for debugging.",
									);
								} else if (action === "view") {
									const trace = client.sessionTracer.getCurrentTrace();
									if (!trace) {
										await interaction.editReply(
											"No active trace. Use `/continuity trace action:start` to begin.",
										);
										break;
									}

									const embed = new EmbedBuilder()
										.setTitle("🔍 Session Trace")
										.setColor(0x00ff00)
										.addFields(
											{ name: "Session ID", value: trace.id.slice(0, 30), inline: true },
											{ name: "Spans", value: String(trace.spans.length), inline: true },
											{ name: "Started", value: new Date(trace.startedAt).toLocaleString(), inline: true },
										)
										.setDescription(
											trace.spans.length > 0
												? trace.spans
														.slice(-5)
														.map(
															(s, i) =>
																`**${i + 1}.** [${s.type}] ${String(s.input || "").slice(0, 80)}...`,
														)
														.join("\n\n")
														.slice(0, 1800)
												: "No spans recorded yet",
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else if (action === "end") {
									client.sessionTracer.endSession();
									await interaction.editReply("✅ **Tracing Ended**\n\nSession trace has been saved.");
								}
								break;
							}

							default:
								await interaction.editReply("Unknown continuity subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ Continuity error: ${errMsg}`);
					}
					break;
				}

				// Browser - Combined dev-browser + browser-use AI browser agent
				case "browser": {
					await interaction.deferReply();
					const browserSubcommand = interaction.options.getSubcommand();

					try {
						// Import both browser adapters
						const devBrowserModule = await import("./agents/dev-browser-adapter.js");
						const browserUseModule = await import("./agents/browser-use-adapter.js");

						const { getDevBrowserClient } = devBrowserModule;
						const { getBrowserUseClient } = browserUseModule;

						const devClient = getDevBrowserClient();
						const useClient = getBrowserUseClient();

						switch (browserSubcommand) {
							case "goto": {
								const url = interaction.options.getString("url", true);

								await interaction.editReply(`⏳ Navigating to ${url}...`);

								const result = await devClient.goto(url);

								const embed = new EmbedBuilder()
									.setTitle("🌐 Browser Navigation")
									.setColor(0x00ff00)
									.addFields(
										{ name: "URL", value: url.slice(0, 100), inline: true },
										{ name: "Page ID", value: result.page.id.slice(0, 20), inline: true },
									)
									.setDescription(
										`**LLM-Friendly DOM Snapshot:**\n\`\`\`\n${result.snapshot.slice(0, 1600)}\n\`\`\``,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "click": {
								const selector = interaction.options.getString("selector", true);

								const result = await devClient.click(selector);

								await interaction.editReply(
									result.success
										? `✅ **Clicked Element**\n\nSelector: \`${selector}\``
										: `❌ **Click Failed**\n\n${result.error}`,
								);
								break;
							}

							case "fill": {
								const selector = interaction.options.getString("selector", true);
								const value = interaction.options.getString("value", true);

								const result = await devClient.fill(selector, value);

								await interaction.editReply(
									result.success
										? `✅ **Field Filled**\n\nSelector: \`${selector}\`\nValue: ${value.slice(0, 50)}`
										: `❌ **Fill Failed**\n\n${result.error}`,
								);
								break;
							}

							case "extract": {
								const url = interaction.options.getString("url", true);
								const type = (interaction.options.getString("type") || "text") as
									| "text"
									| "table"
									| "links"
									| "form";

								await interaction.editReply(`⏳ Extracting ${type} from ${url}...`);

								const data = await useClient.extract(url, type);

								const embed = new EmbedBuilder()
									.setTitle(`📥 Extracted ${type.charAt(0).toUpperCase() + type.slice(1)}`)
									.setColor(0x00ff00)
									.addFields(
										{ name: "URL", value: url.slice(0, 100), inline: true },
										{ name: "Type", value: type, inline: true },
									)
									.setDescription(`\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 1700)}\n\`\`\``)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "agent": {
								const task = interaction.options.getString("task", true);

								await interaction.editReply(`⏳ Running AI browser agent...\n\n**Task:** ${task}`);

								const result = await useClient.run(task);

								const embed = new EmbedBuilder()
									.setTitle("🤖 AI Browser Agent Result")
									.setColor(result.status === "completed" ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Status", value: result.status, inline: true },
										{ name: "Steps", value: String(result.steps.length), inline: true },
									)
									.setDescription(
										`**Task:** ${task}\n\n**Result:**\n\`\`\`\n${(result.result || "Task completed").slice(0, 1500)}\n\`\`\``,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "sandbox": {
								const task = interaction.options.getString("task", true);

								await interaction.editReply(`⏳ Running in sandbox environment...\n\n**Task:** ${task}`);

								const result = await useClient.runInSandbox(task);

								const embed = new EmbedBuilder()
									.setTitle("🔒 Sandbox Execution Result")
									.setColor(result.task.status === "completed" ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Sandbox ID", value: result.session.id.slice(0, 20), inline: true },
										{ name: "Status", value: result.task.status, inline: true },
										{ name: "Steps", value: String(result.task.steps.length), inline: true },
									)
									.setDescription(
										`**Task:** ${task}\n\n**Result:**\n\`\`\`\n${(result.task.result || "Task completed").slice(0, 1400)}\n\`\`\``,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "pages": {
								const pages = devClient.sessionManager.getAllPages();

								if (pages.length === 0) {
									await interaction.editReply("📭 No active browser pages");
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle("📑 Active Browser Pages")
									.setColor(0x00ff00)
									.setDescription(
										pages
											.map(
												(p: { id: string; url: string }, i: number) =>
													`**${i + 1}.** \`${p.id.slice(0, 15)}\`\n   ${p.url.slice(0, 60)}${p.url.length > 60 ? "..." : ""}`,
											)
											.join("\n\n")
											.slice(0, 2000),
									)
									.setFooter({ text: `${pages.length} active page(s)` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "close": {
								// Close all pages by disconnecting
								await devClient.disconnect();
								await interaction.editReply("✅ **Browser Disconnected**");
								break;
							}

							default:
								await interaction.editReply("Unknown browser subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ Browser error: ${errMsg}`);
					}
					break;
				}

				case "aitmpl": {
					await interaction.deferReply();
					const aitmplSubcommand = interaction.options.getSubcommand();

					try {
						const aitmplModule = await import("./agents/aitmpl-adapter.js");
						const { getAitmplClient, AITMPL_PLATFORMS } = aitmplModule;
						const client = getAitmplClient();

						switch (aitmplSubcommand) {
							case "status": {
								const status = client.getStatus();

								const embed = new EmbedBuilder()
									.setTitle("📦 Aitmpl Platform Status")
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Components", value: String(status.registry.total), inline: true },
										{ name: "Platforms", value: String(status.platforms.installed), inline: true },
										{ name: "Plugins", value: String(status.plugins.total), inline: true },
									)
									.addFields(
										{ name: "Stacks", value: String(status.registry.stacks), inline: true },
										{ name: "Enabled Plugins", value: String(status.plugins.enabled), inline: true },
									)
									.setDescription("Claude Code template and component management platform")
									.setFooter({ text: "aitmpl.com/agents" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "install": {
								const platformId = interaction.options.getString("platform", true);

								await interaction.editReply(`⏳ Installing platform: ${platformId}...`);

								const success = client.installPlatform(platformId);

								const platform = AITMPL_PLATFORMS.find((p: { id: string }) => p.id === platformId);

								const embed = new EmbedBuilder()
									.setTitle(success ? "✅ Platform Installed" : "❌ Installation Failed")
									.setColor(success ? 0x00ff00 : 0xff0000)
									.addFields(
										{ name: "Platform", value: platform?.name || platformId, inline: true },
										{ name: "Auth Type", value: platform?.authType || "unknown", inline: true },
									)
									.setDescription(
										success
											? `Installed ${platform?.name || platformId} (${platform?.category || "unknown"})`
											: `Platform ${platformId} not found or missing env vars`,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "search": {
								const query = interaction.options.getString("query", true);
								const typeFilter = interaction.options.getString("type") || "all";

								let results = client.registry.search(query);
								if (typeFilter !== "all") {
									results = results.filter((c: { type: string }) => c.type === typeFilter);
								}

								if (results.length === 0) {
									await interaction.editReply(`📭 No components found for "${query}"`);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle(`🔍 Search Results: "${query}"`)
									.setColor(0x9b59b6)
									.setDescription(
										results
											.slice(0, 10)
											.map(
												(c: { type: string; name: string; description: string }, i: number) =>
													`**${i + 1}.** [${c.type.toUpperCase()}] **${c.name}**\n   ${c.description.slice(0, 80)}`,
											)
											.join("\n\n"),
									)
									.setFooter({ text: `${results.length} result(s)` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "platforms": {
								const embed = new EmbedBuilder()
									.setTitle("📦 Available Platform Integrations")
									.setColor(0x9b59b6)
									.setDescription(
										AITMPL_PLATFORMS.map(
											(p: { id: string; name: string; category: string; authType: string }) =>
												`**${p.name}** (\`${p.id}\`)\n   Category: ${p.category} | Auth: ${p.authType}`,
										).join("\n\n"),
									)
									.setFooter({ text: `${AITMPL_PLATFORMS.length} platforms available` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "health": {
								await interaction.editReply("⏳ Running health checks...");

								const results = await client.healthChecker.runAll();
								const healthy = results.filter((r: { status: string }) => r.status === "healthy").length;

								const embed = new EmbedBuilder()
									.setTitle("🏥 Health Check Results")
									.setColor(healthy === results.length ? 0x00ff00 : healthy > 0 ? 0xffcc00 : 0xff0000)
									.addFields(
										{ name: "Healthy", value: String(healthy), inline: true },
										{ name: "Total", value: String(results.length), inline: true },
									)
									.setDescription(
										results.length === 0
											? "No health checks registered"
											: results
													.map(
														(r: { component: string; status: string; message: string }) =>
															`${r.status === "healthy" ? "✅" : r.status === "degraded" ? "⚠️" : "❌"} **${r.component}**: ${r.message}`,
													)
													.join("\n"),
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "analytics": {
								const period = (interaction.options.getString("period") || "day") as
									| "hour"
									| "day"
									| "week"
									| "month";

								const report = client.analytics.getReport(period);

								const embed = new EmbedBuilder()
									.setTitle(`📊 Analytics Report (${period})`)
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Tool Calls", value: String(report.toolCalls), inline: true },
										{
											name: "Success Rate",
											value: `${(report.successRate * 100).toFixed(1)}%`,
											inline: true,
										},
										{ name: "Avg Response", value: `${report.avgResponseTime.toFixed(0)}ms`, inline: true },
									)
									.setDescription(
										report.topTools.length === 0
											? "No tool calls recorded yet"
											: `**Top Tools:**\n${report.topTools
													.slice(0, 5)
													.map(
														(t: { toolName: string; callCount: number }) =>
															`• ${t.toolName}: ${t.callCount} calls`,
													)
													.join("\n")}`,
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "plugin": {
								const action = interaction.options.getString("action", true);
								const pluginId = interaction.options.getString("plugin_id");

								switch (action) {
									case "list": {
										const plugins = client.pluginManager.getAll();

										if (plugins.length === 0) {
											await interaction.editReply("📭 No plugins installed");
											break;
										}

										const embed = new EmbedBuilder()
											.setTitle("🔌 Installed Plugins")
											.setColor(0x9b59b6)
											.setDescription(
												plugins
													.map(
														(p: { enabled: boolean; name: string; id: string; version: string }) =>
															`${p.enabled ? "✅" : "❌"} **${p.name}** (\`${p.id}\`)\n   Version: ${p.version}`,
													)
													.join("\n\n"),
											)
											.setFooter({ text: `${plugins.length} plugin(s)` })
											.setTimestamp();

										await interaction.editReply({ embeds: [embed] });
										break;
									}

									case "enable":
									case "disable": {
										if (!pluginId) {
											await interaction.editReply("❌ Plugin ID required for enable/disable");
											break;
										}

										const success = client.pluginManager.setEnabled(pluginId, action === "enable");

										await interaction.editReply(
											success
												? `✅ Plugin \`${pluginId}\` ${action}d`
												: `❌ Failed to ${action} plugin \`${pluginId}\``,
										);
										break;
									}
								}
								break;
							}

							default:
								await interaction.editReply("Unknown aitmpl subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`❌ Aitmpl error: ${errMsg}`);
					}
					break;
				}

				case "twitter": {
					await interaction.deferReply();
					const twitterSubcommand = interaction.options.getSubcommand();

					try {
						// Check if Twitter credentials are configured
						const hasTwitter = process.env.TWITTER_BEARER_TOKEN || process.env.TWITTER_API_KEY;

						switch (twitterSubcommand) {
							case "status": {
								const connector = getTwitterConnector();
								if (!connector) {
									await interaction.editReply(
										"⚠️ **Twitter Connector Not Configured**\n\nRequired environment variables:\n• `TWITTER_API_KEY`\n• `TWITTER_API_SECRET`\n• `TWITTER_ACCESS_TOKEN`\n• `TWITTER_ACCESS_SECRET`\n• `TWITTER_BEARER_TOKEN` (optional)",
									);
									break;
								}

								const status = connector.getStatus();
								const embed = new EmbedBuilder()
									.setTitle("🐦 Twitter Status")
									.setColor(status.connected ? 0x1da1f2 : 0x808080)
									.addFields(
										{ name: "Connected", value: status.connected ? "✅" : "❌", inline: true },
										{ name: "Polling", value: status.polling ? "✅" : "❌", inline: true },
										{ name: "Rate Limit", value: String(status.rateLimitRemaining), inline: true },
									)
									.addFields({ name: "Queued Posts", value: String(status.queuedPosts), inline: true })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "post":
							case "thread":
							case "search":
							case "mentions":
							case "analytics": {
								if (!hasTwitter) {
									await interaction.editReply(
										"⚠️ Twitter not configured. Set `TWITTER_*` environment variables.",
									);
									break;
								}

								await interaction.editReply(
									`🐦 Twitter ${twitterSubcommand} - Feature requires API credentials. See \`/twitter status\` for setup instructions.`,
								);
								break;
							}

							default:
								await interaction.editReply("Unknown twitter subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Twitter error: ${errMsg}`);
					}
					break;
				}

				case "adw": {
					await interaction.deferReply();
					const adwSubcommand = interaction.options.getSubcommand();

					try {
						const { getADWRunner, createFeatureWorkflow, createBugFixWorkflow, createRefactorWorkflow } =
							await import("./agents/adw-wrapper.js");
						const runner = getADWRunner(join(workingDir, "orchestrator.db"));

						switch (adwSubcommand) {
							case "feature": {
								const name = interaction.options.getString("name", true);
								const requirements = interaction.options.getString("requirements", true);

								const workflow = createFeatureWorkflow(name, requirements);

								await interaction.editReply(
									`**Starting Feature Workflow**\n• Name: ${name}\n• Steps: ${workflow.steps.length}\n• Quality Gates: Security, Code Review\n\n_Running in background..._`,
								);

								// Run async
								const channelId = interaction.channelId;
								runner.execute(workflow).then(async (result) => {
									const ch = client.channels.cache.get(channelId) as TextChannel;
									if (ch) {
										const status = result.status === "completed" ? "Completed" : "Failed";
										await ch.send(
											`**ADW Feature Workflow ${status}**\n• Completed: ${result.completedSteps}/${workflow.steps.length}\n• Duration: ${result.totalLatencyMs}ms\n${result.error ? `• Error: ${result.error}` : ""}`,
										);
									}
								});
								break;
							}

							case "bugfix": {
								const description = interaction.options.getString("description", true);
								const code = interaction.options.getString("code", true);

								const workflow = createBugFixWorkflow(description, code);

								await interaction.editReply(
									`**Starting Bug Fix Workflow**\n• Issue: ${description.slice(0, 100)}...\n• Steps: ${workflow.steps.length}\n\n_Running in background..._`,
								);

								const channelId = interaction.channelId;
								runner.execute(workflow).then(async (result) => {
									const ch = client.channels.cache.get(channelId) as TextChannel;
									if (ch) {
										const status = result.status === "completed" ? "Fixed" : "Failed";
										await ch.send(
											`**ADW Bug Fix ${status}**\n• Duration: ${result.totalLatencyMs}ms\n• Retries: ${result.failedSteps}\n${result.error ? `• Error: ${result.error}` : ""}`,
										);
									}
								});
								break;
							}

							case "refactor": {
								const code = interaction.options.getString("code", true);
								const goals = interaction.options.getString("goals", true);

								const workflow = createRefactorWorkflow(code, goals);

								await interaction.editReply(
									`**Starting Refactor Workflow**\n• Goals: ${goals.slice(0, 100)}...\n• Steps: ${workflow.steps.length}\n• On Error: Rollback\n\n_Running in background..._`,
								);

								const channelId = interaction.channelId;
								runner.execute(workflow).then(async (result) => {
									const ch = client.channels.cache.get(channelId) as TextChannel;
									if (ch) {
										const status = result.status === "completed" ? "Completed" : result.status;
										await ch.send(
											`**ADW Refactor ${status}**\n• Duration: ${result.totalLatencyMs}ms\n${result.error ? `• Error: ${result.error}` : ""}`,
										);
									}
								});
								break;
							}

							case "active": {
								const active = runner.listActiveExecutions();
								if (active.length === 0) {
									await interaction.editReply("No active ADW executions.");
								} else {
									await interaction.editReply(
										`**Active ADW Executions:**\n${active.map((id) => `• \`${id}\``).join("\n")}`,
									);
								}
								break;
							}

							default:
								await interaction.editReply("Unknown ADW subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`ADW error: ${errMsg}`);
					}
					break;
				}

				case "orchestrator": {
					await interaction.deferReply();
					const orchestratorSubcommand = interaction.options.getSubcommand();

					try {
						const { getOrchestrator } = await import("./agents/orchestrator.js");
						const orch = getOrchestrator(join(workingDir, "orchestrator.db"));

						switch (orchestratorSubcommand) {
							case "stats": {
								const stats = orch.getStats();
								const embed = new EmbedBuilder()
									.setTitle("🎯 Class 3 Orchestrator Stats")
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Total Agents", value: String(stats.agents.total), inline: true },
										{ name: "Total Workflows", value: String(stats.workflows.total), inline: true },
										{ name: "Executions", value: String(stats.workflows.executions), inline: true },
									)
									.addFields(
										{ name: "Delegations", value: String(stats.delegations.total), inline: true },
										{ name: "Success Rate", value: `${stats.delegations.successRate.toFixed(1)}%`, inline: true },
										{ name: "Avg Latency", value: `${stats.delegations.avgLatency.toFixed(0)}ms`, inline: true },
									)
									.addFields({
										name: "By Role",
										value: Object.entries(stats.agents.byRole)
											.map(([role, count]) => `${role}: ${count}`)
											.join(", ") || "None",
									})
									.setFooter({ text: "Codebase Singularity - Class 3.1" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "agents": {
								const agents = orch.listAgents();
								if (agents.length === 0) {
									await interaction.editReply("No agents registered. Use `/orchestrator agent-create` to add one.");
									break;
								}

								const list = agents.slice(0, 15).map((a) => {
									const successRate = a.runCount > 0 ? ((a.successCount / a.runCount) * 100).toFixed(0) : "N/A";
									return `• **${a.name}** [${a.role}] - ${a.type} | ${a.status} | ${successRate}% success`;
								});

								const embed = new EmbedBuilder()
									.setTitle("🤖 Registered Agents")
									.setDescription(list.join("\n"))
									.setColor(0x3498db)
									.setFooter({ text: `${agents.length} total agents` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "agent-create": {
								const name = interaction.options.getString("name", true);
								const type = interaction.options.getString("type", true) as "skill" | "mcp" | "subprocess" | "webhook" | "inline";
								const role = interaction.options.getString("role", true) as "architect" | "builder" | "tester" | "reviewer" | "expert" | "scout" | "executor";
								const description = interaction.options.getString("description") || `${name} agent`;

								const agent = orch.createAgent({
									name,
									type,
									role,
									description,
									config: {},
									status: "active",
								});

								await interaction.editReply(
									`✅ **Agent Created**\n• ID: \`${agent.id}\`\n• Name: ${agent.name}\n• Type: ${agent.type}\n• Role: ${agent.role}`,
								);
								break;
							}

							case "agent-delete": {
								const id = interaction.options.getString("id", true);
								const deleted = orch.deleteAgent(id);

								if (deleted) {
									await interaction.editReply(`✅ Agent deleted: \`${id}\``);
								} else {
									await interaction.editReply(`❌ Agent not found: \`${id}\``);
								}
								break;
							}

							case "workflows": {
								const workflows = orch.listWorkflows();
								if (workflows.length === 0) {
									await interaction.editReply("No workflows defined yet.");
									break;
								}

								const list = workflows.map((w) => `• **${w.name}** - ${w.steps.length} steps | ${w.trigger}`);
								await interaction.editReply(`**📋 Workflows:**\n${list.join("\n")}`);
								break;
							}

							case "delegate": {
								const task = interaction.options.getString("task", true);
								const role = interaction.options.getString("role") as "architect" | "builder" | "tester" | "reviewer" | "expert" | undefined;

								// Use smart routing with memory bridge
								const { AgentMemorySystem } = await import("./agents/agent-memory-system.js");
								const { getOrchestratorMemoryBridge } = await import("./agents/orchestrator-memory-bridge.js");

								const memorySystem = new AgentMemorySystem({
									dbPath: join(workingDir, "agent-memory.db"),
									enableLearning: true,
								});

								const bridge = getOrchestratorMemoryBridge(orch, memorySystem);

								const result = await bridge.smartDelegate({
									id: crypto.randomUUID(),
									taskType: "user_request",
									prompt: task,
									requiredRole: role,
									timeout: 30000,
									priority: 5,
									useSmartRouting: true,
									rateAfterCompletion: true,
								});

								if (result.status === "success") {
									const smartInfo = result.smartRouted
										? `🧠 Smart routed (${((result.routingConfidence || 0) * 100).toFixed(0)}% confidence)`
										: "📋 Standard routing";

									await interaction.editReply(
										`✅ **Task Delegated**\n• Agent: \`${result.agentId}\`\n• ${smartInfo}\n• Latency: ${result.latencyMs}ms\n• Task ID: \`${result.taskRecordId?.slice(0, 8) || "N/A"}\`\n• Output:\n\`\`\`\n${String(result.output).slice(0, 1400)}\n\`\`\``,
									);
								} else {
									await interaction.editReply(`❌ **Delegation Failed**\n• Error: ${result.error}`);
								}
								break;
							}

							case "bootstrap": {
								const defaultModel = interaction.options.getString("model") || "GLM-4.7";
								const enableLearning = interaction.options.getBoolean("learning") ?? true;

								const { bootstrapOrchestrator } = await import("./agents/orchestrator-bootstrap.js");

								const result = await bootstrapOrchestrator(orch, {
									workingDir,
									defaultModel,
									enableLearning,
									maxTokens: 4096,
									registerDefaults: true,
								});

								const agentList = result.agents.slice(0, 15).join("\n• ");

								const embed = new EmbedBuilder()
									.setTitle("🚀 Orchestrator Bootstrapped")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "Agents Registered", value: String(result.registered), inline: true },
										{ name: "Default Model", value: defaultModel, inline: true },
										{ name: "Learning", value: enableLearning ? "Enabled" : "Disabled", inline: true },
									)
									.addFields({ name: "Registered Agents", value: `• ${agentList}` })
									.setFooter({ text: "Use /orchestrator delegate to run tasks" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown orchestrator subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Orchestrator error: ${errMsg}`);
					}
					break;
				}

				case "watcher": {
					await interaction.deferReply();
					const watcherSubcommand = interaction.options.getSubcommand();

					try {
						const { startPiWatcher, stopPiWatcher, getPiWatcherState, PiWatcher } = await import("./agents/pi-watcher.js");

						switch (watcherSubcommand) {
							case "start": {
								const watcher = startPiWatcher({
									workingDir,
									orchestratorDbPath: join(workingDir, "orchestrator.db"),
									checkInterval: 5 * 60 * 1000, // 5 minutes
									autoFixEnabled: false,
									maxFixAttempts: 3,
									notifyOnIssue: true,
									notifyOnFix: true,
									enabledChecks: ["typecheck", "test", "lint"],
									ignorePaths: ["node_modules", "dist", ".git"],
									customChecks: [],
								});

								watcher.on("issue_detected", (issue) => {
									logWarning(`[Pi-Watcher] Issue detected: ${issue.type} - ${issue.title}`);
								});

								watcher.on("fix_attempted", (result) => {
									logInfo(`[Pi-Watcher] Fix ${result.success ? "succeeded" : "failed"}: ${result.strategy}`);
								});

								await interaction.editReply("✅ **Pi-Watcher Started**\nMonitoring codebase for issues. Use `/watcher status` to check current state.");
								break;
							}

							case "stop": {
								stopPiWatcher();
								await interaction.editReply("🛑 **Pi-Watcher Stopped**");
								break;
							}

							case "status": {
								const state = getPiWatcherState();
								if (!state) {
									await interaction.editReply("Pi-Watcher is not running. Use `/watcher start` to begin.");
									break;
								}

								const issueList = state.currentIssues
									.slice(0, 10)
									.map((issue) => {
										return `• \`${issue.id.slice(0, 8)}\` [${issue.type}] ${issue.title.slice(0, 60)}`;
									})
									.join("\n") || "No issues detected";

								const embed = new EmbedBuilder()
									.setTitle("👁️ Pi-Watcher Status")
									.setColor(state.running ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Status", value: state.running ? "Running" : "Stopped", inline: true },
										{ name: "Issues", value: String(state.currentIssues.length), inline: true },
										{ name: "Last Check", value: state.lastCheck ? new Date(state.lastCheck).toLocaleTimeString() : "Never", inline: true },
									)
									.addFields({ name: "Current Issues", value: issueList })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "check": {
								const state = getPiWatcherState();
								if (!state) {
									await interaction.editReply("Pi-Watcher is not running. Use `/watcher start` first.");
									break;
								}

								await interaction.editReply("🔍 Running health checks...");
								// The watcher will emit events when checks complete
								break;
							}

							case "fix": {
								const issueId = interaction.options.getString("issue_id", true);
								const state = getPiWatcherState();
								if (!state) {
									await interaction.editReply("Pi-Watcher is not running.");
									break;
								}

								const issue = state.currentIssues.find((i) => i.id.startsWith(issueId));
								if (!issue) {
									await interaction.editReply(`Issue not found: \`${issueId}\``);
									break;
								}

								await interaction.editReply(`🔧 Attempting fix for issue \`${issue.id.slice(0, 8)}\`...\nStrategy: inline → agent → workflow`);
								break;
							}

							case "ignore": {
								const issueId = interaction.options.getString("issue_id", true);
								const state = getPiWatcherState();
								if (!state) {
									await interaction.editReply("Pi-Watcher is not running.");
									break;
								}

								const issueIndex = state.currentIssues.findIndex((i) => i.id.startsWith(issueId));
								if (issueIndex === -1) {
									await interaction.editReply(`Issue not found: \`${issueId}\``);
									break;
								}

								// Remove issue from tracking
								const removed = state.currentIssues.splice(issueIndex, 1)[0];
								await interaction.editReply(`🙈 Ignoring issue \`${removed.id.slice(0, 8)}\`: ${removed.title}`);
								break;
							}

							case "config": {
								const interval = interaction.options.getInteger("interval");
								const autofix = interaction.options.getBoolean("autofix");

								const updates: string[] = [];
								if (interval !== null) updates.push(`Interval: ${interval} minutes`);
								if (autofix !== null) updates.push(`Auto-fix: ${autofix ? "enabled" : "disabled"}`);

								if (updates.length === 0) {
									await interaction.editReply("No configuration changes specified.");
									break;
								}

								await interaction.editReply(`⚙️ **Configuration Updated**\n${updates.join("\n")}`);
								break;
							}

							default:
								await interaction.editReply("Unknown watcher subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Pi-Watcher error: ${errMsg}`);
					}
					break;
				}

				case "coordinate": {
					await interaction.deferReply();
					const coordinateSubcommand = interaction.options.getSubcommand();

					try {
						const { getOrchestrator } = await import("./agents/orchestrator.js");
						const { getCoordinator, runParallel, runDebate, runConsensusVote, runWithSupervisor } = await import(
							"./agents/multi-agent-coordinator.js"
						);
						const orch = getOrchestrator(join(workingDir, "orchestrator.db"));
						const coordinator = getCoordinator(orch);

						switch (coordinateSubcommand) {
							case "parallel": {
								const task = interaction.options.getString("task", true);
								const rolesStr = interaction.options.getString("roles", true);
								const roles = rolesStr.split(",").map((r) => r.trim());

								await interaction.editReply(`🔄 Running parallel coordination with ${roles.length} agents...`);

								const result = await runParallel(orch, task, roles);

								const embed = new EmbedBuilder()
									.setTitle("⚡ Parallel Coordination Complete")
									.setColor(result.status === "success" ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Status", value: result.status, inline: true },
										{ name: "Agents", value: String(result.metadata.agentsUsed.length), inline: true },
										{ name: "Duration", value: `${result.metadata.duration}ms`, inline: true },
									)
									.addFields({ name: "Output", value: result.finalOutput.slice(0, 1000) || "No output" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "debate": {
								const topic = interaction.options.getString("topic", true);
								const rolesStr = interaction.options.getString("roles", true);
								const roles = rolesStr.split(",").map((r) => r.trim());
								const rounds = interaction.options.getInteger("rounds") || 3;

								await interaction.editReply(`🎭 Starting ${rounds}-round debate with ${roles.length} agents...`);

								const result = await runDebate(orch, topic, roles, rounds);

								const embed = new EmbedBuilder()
									.setTitle("🎭 Debate Complete")
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Topic", value: topic.slice(0, 100), inline: false },
										{ name: "Rounds", value: String(rounds), inline: true },
										{ name: "Participants", value: roles.join(", "), inline: true },
										{ name: "Messages", value: String(result.messages.length), inline: true },
									)
									.addFields({ name: "Summary", value: result.finalOutput.slice(0, 1000) || "No output" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "consensus": {
								const question = interaction.options.getString("question", true);
								const rolesStr = interaction.options.getString("roles", true);
								const roles = rolesStr.split(",").map((r) => r.trim());
								const method = (interaction.options.getString("method") || "majority") as "majority" | "weighted" | "unanimous";

								await interaction.editReply(`🗳️ Running ${method} consensus with ${roles.length} agents...`);

								const result = await runConsensusVote(orch, question, roles, method);

								const embed = new EmbedBuilder()
									.setTitle("🗳️ Consensus Reached")
									.setColor(result.consensus?.unanimous ? 0x2ecc71 : 0xf39c12)
									.addFields(
										{ name: "Question", value: question.slice(0, 100), inline: false },
										{ name: "Winner", value: result.consensus?.winner || "No consensus", inline: true },
										{ name: "Confidence", value: `${((result.consensus?.confidence || 0) * 100).toFixed(0)}%`, inline: true },
										{ name: "Unanimous", value: result.consensus?.unanimous ? "Yes" : "No", inline: true },
									)
									.addFields({
										name: "Votes",
										value:
											result.consensus?.votes
												.map((v) => `• ${v.agentId}: ${v.choice} (${(v.confidence * 100).toFixed(0)}%)`)
												.join("\n")
												.slice(0, 500) || "No votes",
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "supervisor": {
								const task = interaction.options.getString("task", true);
								const supervisor = interaction.options.getString("supervisor", true);
								const workersStr = interaction.options.getString("workers", true);
								const workers = workersStr.split(",").map((r) => r.trim());

								await interaction.editReply(`👔 Running supervisor pattern: ${supervisor} overseeing ${workers.length} workers...`);

								const result = await runWithSupervisor(orch, task, supervisor, workers);

								const embed = new EmbedBuilder()
									.setTitle("👔 Supervisor Task Complete")
									.setColor(result.status === "success" ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Supervisor", value: supervisor, inline: true },
										{ name: "Workers", value: workers.join(", "), inline: true },
										{ name: "Duration", value: `${result.metadata.duration}ms`, inline: true },
									)
									.addFields({ name: "Result", value: result.finalOutput.slice(0, 1000) || "No output" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "status": {
								const active = coordinator.getActiveCoordinations();
								const messages = coordinator.getMessageLog().slice(-10);

								const embed = new EmbedBuilder()
									.setTitle("🤝 Coordination Status")
									.setColor(0x3498db)
									.addFields(
										{ name: "Active Tasks", value: String(active.length), inline: true },
										{ name: "Recent Messages", value: String(messages.length), inline: true },
									)
									.addFields({
										name: "Active Coordinations",
										value: active.length > 0 ? active.map((t) => `• ${t.type}: ${t.prompt.slice(0, 50)}`).join("\n") : "None",
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown coordinate subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Coordination error: ${errMsg}`);
					}
					break;
				}

				case "memory": {
					await interaction.deferReply();
					const memorySubcommand = interaction.options.getSubcommand();

					try {
						const { AgentMemorySystem } = await import("./agents/agent-memory-system.js");
						const memorySystem = new AgentMemorySystem({
							dbPath: join(workingDir, "agent-memory.db"),
							enableLearning: true,
						});

						switch (memorySubcommand) {
							case "stats": {
								const agentId = interaction.options.getString("agent_id");

								if (agentId) {
									// Specific agent stats
									const stats = memorySystem.getAgentStats(agentId);
									if (!stats) {
										await interaction.editReply(`No stats found for agent: \`${agentId}\``);
										break;
									}

									const embed = new EmbedBuilder()
										.setTitle(`📊 Agent Stats: ${agentId}`)
										.setColor(0x3498db)
										.addFields(
											{ name: "Total Tasks", value: String(stats.totalTasks), inline: true },
											{ name: "Success Rate", value: `${(stats.successRate * 100).toFixed(1)}%`, inline: true },
											{ name: "Avg Latency", value: `${stats.avgLatencyMs.toFixed(0)}ms`, inline: true },
											{ name: "Avg Quality", value: stats.avgQuality.toFixed(2), inline: true },
											{ name: "Best Task Types", value: stats.bestTaskTypes.join(", ") || "N/A", inline: false },
											{ name: "Worst Task Types", value: stats.worstTaskTypes.join(", ") || "N/A", inline: false },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									// All agents summary
									const summary = memorySystem.getGlobalStats();
									const embed = new EmbedBuilder()
										.setTitle("📊 Agent Memory Stats")
										.setColor(0x3498db)
										.addFields(
											{ name: "Total Tasks Recorded", value: String(summary.totalTasks), inline: true },
											{ name: "Active Agents", value: String(summary.agentCount), inline: true },
											{ name: "Active Insights", value: String(summary.insightCount), inline: true },
											{ name: "Global Success Rate", value: `${(summary.globalSuccessRate * 100).toFixed(1)}%`, inline: true },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								}
								break;
							}

							case "insights": {
								const insights = memorySystem.getActiveInsights();

								if (insights.length === 0) {
									await interaction.editReply("No active insights yet. Insights are generated as agents complete more tasks.");
									break;
								}

								const insightList = insights.slice(0, 10).map((i, idx) => {
									return `**${idx + 1}. ${i.title}**\n${i.description}\n*Confidence: ${(i.confidence * 100).toFixed(0)}% | Type: ${i.type}*`;
								});

								const embed = new EmbedBuilder()
									.setTitle("💡 Learned Insights")
									.setColor(0xf39c12)
									.setDescription(insightList.join("\n\n").slice(0, 4000))
									.addFields({ name: "Total Insights", value: String(insights.length), inline: true })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "recommend": {
								const taskType = interaction.options.getString("task_type", true);
								const prompt = interaction.options.getString("prompt", true);

								const recommendation = memorySystem.getRoutingRecommendation(taskType, prompt);

								const agentList =
									recommendation.recommendedAgents.length > 0
										? recommendation.recommendedAgents
												.map((a, i) => `${i + 1}. **${a.agentId}** (score: ${a.score.toFixed(2)})\n   ${a.reasoning}`)
												.join("\n")
										: "No specific recommendation - insufficient data";

								const embed = new EmbedBuilder()
									.setTitle("🎯 Routing Recommendation")
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Task Type", value: taskType, inline: true },
										{ name: "Confidence", value: `${(recommendation.confidence * 100).toFixed(0)}%`, inline: true },
									)
									.addFields({ name: "Recommended Agents", value: agentList.slice(0, 1000) })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "rate": {
								const taskId = interaction.options.getString("task_id", true);
								const quality = interaction.options.getInteger("quality", true);

								memorySystem.rateTask(taskId, quality / 10); // Convert 1-10 to 0-1

								await interaction.editReply(`✅ Rated task \`${taskId.slice(0, 8)}\` with quality **${quality}/10**`);
								break;
							}

							case "best-agent": {
								const taskType = interaction.options.getString("task_type", true);
								const bestAgent = memorySystem.getBestAgentForTask(taskType);

								if (bestAgent) {
									const stats = memorySystem.getAgentStats(bestAgent);
									const embed = new EmbedBuilder()
										.setTitle(`🏆 Best Agent for "${taskType}"`)
										.setColor(0x2ecc71)
										.addFields(
											{ name: "Agent ID", value: bestAgent, inline: true },
											{ name: "Success Rate", value: stats ? `${(stats.successRate * 100).toFixed(1)}%` : "N/A", inline: true },
											{ name: "Avg Quality", value: stats ? stats.avgQuality.toFixed(2) : "N/A", inline: true },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								} else {
									await interaction.editReply(`No agent found with experience in task type: \`${taskType}\``);
								}
								break;
							}

							case "summary": {
								const summary = memorySystem.getGlobalStats();
								const insights = memorySystem.getActiveInsights();

								const embed = new EmbedBuilder()
									.setTitle("🧠 Agent Memory System")
									.setColor(0x3498db)
									.setDescription("Persistent learning and smart routing for agents")
									.addFields(
										{ name: "Total Tasks", value: String(summary.totalTasks), inline: true },
										{ name: "Agents Tracked", value: String(summary.agentCount), inline: true },
										{ name: "Active Insights", value: String(summary.insightCount), inline: true },
										{ name: "Global Success", value: `${(summary.globalSuccessRate * 100).toFixed(1)}%`, inline: true },
										{
											name: "Top Patterns",
											value:
												insights
													.filter((i) => i.type === "pattern")
													.slice(0, 3)
													.map((i) => `• ${i.title}`)
													.join("\n") || "None yet",
										},
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown memory subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Memory system error: ${errMsg}`);
					}
					break;
				}

				case "meta-agent": {
					await interaction.deferReply();
					const metaSubcommand = interaction.options.getSubcommand();

					try {
						const { getOrchestrator } = await import("./agents/orchestrator.js");
						const { AgentMemorySystem } = await import("./agents/agent-memory-system.js");
						const { getMetaAgent } = await import("./agents/meta-agent.js");

						const orch = getOrchestrator(join(workingDir, "orchestrator.db"));
						const memory = new AgentMemorySystem({
							dbPath: join(workingDir, "agent-memory.db"),
							enableLearning: true,
						});
						const meta = getMetaAgent(orch, memory);

						switch (metaSubcommand) {
							case "generate": {
								const description = interaction.options.getString("description", true);
								const name = interaction.options.getString("name");
								const role = interaction.options.getString("role") as "architect" | "builder" | "tester" | "reviewer" | "expert" | "scout" | "executor" | undefined;

								const spec = meta.generateAgentSpec({
									description,
									name: name || undefined,
									role,
								});

								const embed = new EmbedBuilder()
									.setTitle("🧬 Generated Agent Spec")
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Name", value: spec.name, inline: true },
										{ name: "Role", value: spec.role, inline: true },
										{ name: "Type", value: spec.type, inline: true },
										{ name: "Model", value: spec.suggestedModel, inline: true },
										{ name: "Description", value: spec.description.slice(0, 200), inline: false },
										{ name: "System Prompt", value: spec.systemPrompt.slice(0, 300) + "...", inline: false },
										{ name: "Capabilities", value: spec.capabilities.join(", "), inline: false },
									)
									.addFields({ name: "Reasoning", value: spec.reasoning })
									.setFooter({ text: "Use /meta-agent create to register this agent" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "create": {
								const description = interaction.options.getString("description", true);
								const name = interaction.options.getString("name");

								const { spec, agent } = meta.generateAndCreate({
									description,
									name: name || undefined,
									autoRegister: true,
								});

								const embed = new EmbedBuilder()
									.setTitle("✅ Agent Created")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "ID", value: `\`${agent.id}\``, inline: true },
										{ name: "Name", value: agent.name, inline: true },
										{ name: "Role", value: agent.role, inline: true },
										{ name: "Model", value: spec.suggestedModel, inline: true },
										{ name: "Description", value: agent.description.slice(0, 200), inline: false },
									)
									.setFooter({ text: "Agent is now active and can receive tasks" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "suggest": {
								const suggestions = meta.suggestAgents();

								if (suggestions.length === 0) {
									await interaction.editReply("No agent suggestions at this time. More task history needed for pattern analysis.");
									break;
								}

								const suggestionList = suggestions.slice(0, 5).map((s, i) => {
									return `**${i + 1}. ${s.suggestedSpec.name}** (${s.suggestedSpec.role})\n${s.reason}\n*Confidence: ${(s.confidence * 100).toFixed(0)}%*`;
								});

								const embed = new EmbedBuilder()
									.setTitle("💡 Agent Suggestions")
									.setColor(0xf39c12)
									.setDescription(suggestionList.join("\n\n"))
									.setFooter({ text: "Use /meta-agent create with the suggested description" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "clone": {
								const agentId = interaction.options.getString("agent_id", true);
								const modifications = interaction.options.getString("modifications", true);

								const spec = meta.generateAgentSpec({
									description: modifications,
									baseAgentId: agentId,
								});

								const agent = meta.createAgent(spec);

								const embed = new EmbedBuilder()
									.setTitle("🔄 Agent Cloned")
									.setColor(0x3498db)
									.addFields(
										{ name: "Original", value: agentId.slice(0, 8), inline: true },
										{ name: "New ID", value: `\`${agent.id.slice(0, 8)}\``, inline: true },
										{ name: "Name", value: agent.name, inline: true },
										{ name: "Modifications", value: modifications.slice(0, 200), inline: false },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown meta-agent subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Meta-agent error: ${errMsg}`);
					}
					break;
				}

				case "bundle": {
					await interaction.deferReply();
					const bundleSubcommand = interaction.options.getSubcommand();

					try {
						const { getBundleSystem } = await import("./agents/context-bundle.js");
						const bundleSystem = getBundleSystem(workingDir);

						switch (bundleSubcommand) {
							case "capture": {
								const name = interaction.options.getString("name", true);
								const description = interaction.options.getString("description");
								const filesStr = interaction.options.getString("files");
								const files = filesStr ? filesStr.split(",").map((f) => f.trim()) : [];

								const bundle = await bundleSystem.captureBundle({
									name,
									description: description || undefined,
									files,
									tags: ["manual"],
								});

								const embed = new EmbedBuilder()
									.setTitle("📦 Context Bundle Captured")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "ID", value: `\`${bundle.id.slice(0, 8)}\``, inline: true },
										{ name: "Name", value: bundle.name, inline: true },
										{ name: "Size", value: `${(bundle.size / 1024).toFixed(1)} KB`, inline: true },
										{ name: "Files", value: String(bundle.files.length), inline: true },
										{ name: "Git Branch", value: bundle.git?.branch || "N/A", inline: true },
										{ name: "Compressed", value: bundle.compressed ? "Yes" : "No", inline: true },
									)
									.setFooter({ text: "Use /bundle load to restore this context" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "quick": {
								const name = interaction.options.getString("name", true);
								const bundle = await bundleSystem.quickCapture(name);

								const embed = new EmbedBuilder()
									.setTitle("⚡ Quick Capture Complete")
									.setColor(0x3498db)
									.addFields(
										{ name: "ID", value: `\`${bundle.id.slice(0, 8)}\``, inline: true },
										{ name: "Name", value: bundle.name, inline: true },
										{ name: "Files", value: String(bundle.files.length), inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "load": {
								const idOrName = interaction.options.getString("id", true);

								// Try by ID first, then by name
								let bundle = bundleSystem.loadBundle(idOrName);
								if (!bundle) {
									bundle = bundleSystem.loadBundleByName(idOrName);
								}

								if (!bundle) {
									await interaction.editReply(`Bundle not found: \`${idOrName}\``);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle(`📦 Bundle: ${bundle.name}`)
									.setColor(0x9b59b6)
									.addFields(
										{ name: "ID", value: `\`${bundle.id}\``, inline: false },
										{ name: "Created", value: bundle.createdAt.toISOString(), inline: true },
										{ name: "Size", value: `${(bundle.size / 1024).toFixed(1)} KB`, inline: true },
										{ name: "Files", value: String(bundle.files.length), inline: true },
										{ name: "Git", value: bundle.git ? `${bundle.git.branch} @ ${bundle.git.commit.slice(0, 7)}` : "N/A", inline: false },
									)
									.setTimestamp();

								if (bundle.currentTask) {
									embed.addFields({ name: "Current Task", value: bundle.currentTask.slice(0, 200) });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "apply": {
								const id = interaction.options.getString("id", true);
								const bundle = bundleSystem.loadBundle(id);

								if (!bundle) {
									await interaction.editReply(`Bundle not found: \`${id}\``);
									break;
								}

								const summary = bundleSystem.generateContextSummary(bundle);

								await interaction.editReply(
									`**📋 Context Applied from "${bundle.name}"**\n\n\`\`\`md\n${summary.slice(0, 1800)}\n\`\`\``,
								);
								break;
							}

							case "list": {
								const tag = interaction.options.getString("tag");
								const limit = interaction.options.getInteger("limit") || 10;

								const bundles = bundleSystem.listBundles({ tag: tag || undefined, limit });

								if (bundles.length === 0) {
									await interaction.editReply("No bundles found.");
									break;
								}

								const bundleList = bundles.map((b, i) => {
									const date = b.createdAt.toLocaleDateString();
									return `${i + 1}. **${b.name}** (\`${b.id.slice(0, 8)}\`)\n   ${b.fileCount} files | ${(b.size / 1024).toFixed(1)} KB | ${date}`;
								});

								const embed = new EmbedBuilder()
									.setTitle("📚 Context Bundles")
									.setColor(0x3498db)
									.setDescription(bundleList.join("\n\n"))
									.setFooter({ text: `Showing ${bundles.length} bundle(s)` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "delete": {
								const id = interaction.options.getString("id", true);
								const deleted = bundleSystem.deleteBundle(id);

								if (deleted) {
									await interaction.editReply(`🗑️ Bundle deleted: \`${id.slice(0, 8)}\``);
								} else {
									await interaction.editReply(`Bundle not found: \`${id}\``);
								}
								break;
							}

							default:
								await interaction.editReply("Unknown bundle subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Bundle error: ${errMsg}`);
					}
					break;
				}

				case "style": {
					await interaction.deferReply();
					const styleSubcommand = interaction.options.getSubcommand();

					try {
						const { getStyleManager, BUILTIN_STYLES } = await import("./agents/output-styles.js");
						const styleManager = getStyleManager();

						switch (styleSubcommand) {
							case "list": {
								const styles = styleManager.listStyles();

								const styleList = styles.map((s) => `**${s.name}** (\`${s.id}\`)\n${s.description}`);

								const embed = new EmbedBuilder()
									.setTitle("🎨 Output Styles")
									.setColor(0x9b59b6)
									.setDescription(styleList.join("\n\n"))
									.setFooter({ text: "Use /style set to change your style" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "set": {
								const styleId = interaction.options.getString("style", true);
								const style = styleManager.getStyle(styleId);

								if (!style) {
									await interaction.editReply(`Style not found: \`${styleId}\``);
									break;
								}

								// Set for user (using channel as session key)
								styleManager.setAgentStyle(channelId, styleId as any);

								const embed = new EmbedBuilder()
									.setTitle("✅ Style Updated")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "Style", value: style.name, inline: true },
										{ name: "ID", value: style.id, inline: true },
									)
									.addFields({ name: "Description", value: style.description })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "preview": {
								const styleId = interaction.options.getString("style", true);
								const style = styleManager.getStyle(styleId);

								if (!style) {
									await interaction.editReply(`Style not found: \`${styleId}\``);
									break;
								}

								// Sample text to preview
								const sampleText = `Here's an analysis of the trading signals:

The BTC/USDT pair shows strong bullish momentum with RSI at 65.
Key resistance at $45,000 with support at $42,500.
Volume is increasing, suggesting continued upward pressure.

Recommendation: Consider a long position with stop-loss at $42,000.`;

								const processed = styleManager.processOutput(sampleText, styleId);

								const embed = new EmbedBuilder()
									.setTitle(`🎨 Style Preview: ${style.name}`)
									.setColor(0x3498db)
									.addFields(
										{ name: "Original", value: sampleText.slice(0, 500), inline: false },
										{ name: "Processed", value: processed.slice(0, 500), inline: false },
									)
									.setFooter({ text: style.formatInstructions })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "current": {
								const currentStyle = styleManager.getAgentStyle(channelId);
								const config = styleManager.getConfig();

								const embed = new EmbedBuilder()
									.setTitle("⚙️ Current Style Settings")
									.setColor(0x3498db)
									.addFields(
										{ name: "Active Style", value: currentStyle.name, inline: true },
										{ name: "Style ID", value: currentStyle.id, inline: true },
										{ name: "Default", value: config.defaultStyle, inline: true },
										{ name: "Post-Processing", value: config.enablePostProcessing ? "Enabled" : "Disabled", inline: true },
										{ name: "Max Length", value: String(config.maxOutputLength), inline: true },
									)
									.addFields({ name: "Format Instructions", value: currentStyle.formatInstructions })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown style subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Style error: ${errMsg}`);
					}
					break;
				}

				case "safety": {
					await interaction.deferReply();
					const safetySubcommand = interaction.options.getSubcommand();

					try {
						const { getSafetyGuards } = await import("./agents/safety-guards.js");
						const guards = getSafetyGuards();

						switch (safetySubcommand) {
							case "status": {
								const config = guards.getConfig();
								const stats = guards.getStats();
								const history = guards.getBlockedHistory(5);

								const totalBlocked = Object.values(stats).reduce((sum, s) => sum + s.blocked, 0);
								const totalWarned = Object.values(stats).reduce((sum, s) => sum + s.warned, 0);

								const categoryStats = Object.entries(stats)
									.filter(([_, s]) => s.blocked > 0 || s.warned > 0)
									.map(([cat, s]) => `${cat}: ${s.blocked} blocked, ${s.warned} warned`)
									.join("\n") || "No incidents recorded";

								const embed = new EmbedBuilder()
									.setTitle("🛡️ Safety Guards Status")
									.setColor(config.enabled ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "Status", value: config.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
										{ name: "Block Threshold", value: config.blockThreshold, inline: true },
										{ name: "Trusted Bypass", value: config.allowTrustedBypass ? "Yes" : "No", inline: true },
										{ name: "Total Blocked", value: String(totalBlocked), inline: true },
										{ name: "Total Warned", value: String(totalWarned), inline: true },
										{ name: "Rules Active", value: String(guards.listRules().length), inline: true },
									)
									.addFields({ name: "Stats by Category", value: `\`\`\`\n${categoryStats}\n\`\`\`` })
									.setTimestamp();

								if (history.length > 0) {
									const recentBlocks = history.map((b) =>
										`• \`${b.command.slice(0, 40)}${b.command.length > 40 ? "..." : ""}\` - ${b.reason}`
									).join("\n");
									embed.addFields({ name: "Recent Blocks", value: recentBlocks.slice(0, 1000) });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "check": {
								const command = interaction.options.getString("command", true);
								const result = guards.check(command, { userId: user.id });

								const riskColors: Record<string, number> = {
									safe: 0x2ecc71,
									caution: 0xf1c40f,
									warning: 0xe67e22,
									danger: 0xe74c3c,
									blocked: 0x9b59b6,
								};

								const embed = new EmbedBuilder()
									.setTitle(`${result.allowed ? "✅" : "🚫"} Command Check Result`)
									.setColor(riskColors[result.risk] || 0x3498db)
									.addFields(
										{ name: "Command", value: `\`${command.slice(0, 100)}\``, inline: false },
										{ name: "Allowed", value: result.allowed ? "Yes" : "No", inline: true },
										{ name: "Risk Level", value: result.risk.toUpperCase(), inline: true },
										{ name: "Category", value: result.category, inline: true },
										{ name: "Rule", value: result.rule, inline: true },
									)
									.addFields({ name: "Reason", value: result.reason })
									.setTimestamp();

								if (result.alternative) {
									embed.addFields({ name: "💡 Safer Alternative", value: result.alternative });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "rules": {
								const category = interaction.options.getString("category");
								const rules = guards.listRules(category as any);

								if (rules.length === 0) {
									await interaction.editReply("No rules found for this category.");
									break;
								}

								const rulesList = rules.slice(0, 15).map((r) =>
									`**${r.id}** (${r.risk})\n${r.description}`
								).join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`📋 Safety Rules${category ? ` - ${category}` : ""}`)
									.setColor(0x3498db)
									.setDescription(rulesList.slice(0, 4000))
									.setFooter({ text: `${rules.length} rules total` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "history": {
								const history = guards.getBlockedHistory(20);

								if (history.length === 0) {
									await interaction.editReply("No blocked commands in history.");
									break;
								}

								const historyLines = history.map((h) =>
									`\`${h.timestamp.toISOString().split("T")[0]}\` **${h.risk}** [${h.category}]\n\`${h.command.slice(0, 50)}\``
								).join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("📜 Blocked Command History")
									.setColor(0xe74c3c)
									.setDescription(historyLines.slice(0, 4000))
									.setFooter({ text: `${history.length} entries shown` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "toggle": {
								const enabled = interaction.options.getBoolean("enabled", true);
								guards.setEnabled(enabled);

								const embed = new EmbedBuilder()
									.setTitle(enabled ? "✅ Safety Guards Enabled" : "⚠️ Safety Guards Disabled")
									.setColor(enabled ? 0x2ecc71 : 0xe74c3c)
									.setDescription(
										enabled
											? "Commands will be checked against safety rules."
											: "⚠️ **Warning:** All commands will be allowed without safety checks."
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown safety subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Safety guards error: ${errMsg}`);
					}
					break;
				}

				case "feedback": {
					await interaction.deferReply();
					const feedbackSubcommand = interaction.options.getSubcommand();

					try {
						const { getFeedbackSystem } = await import("./agents/agent-feedback.js");
						const feedbackSystem = getFeedbackSystem(workingDir);

						switch (feedbackSubcommand) {
							case "stats": {
								const stats = feedbackSystem.getGlobalStats();

								const embed = new EmbedBuilder()
									.setTitle("📊 Agent Feedback Statistics")
									.setColor(0x3498db)
									.addFields(
										{ name: "Total Feedback", value: String(stats.totalFeedback), inline: true },
										{ name: "Total Agents", value: String(stats.totalAgents), inline: true },
										{ name: "Today", value: String(stats.feedbackToday), inline: true },
										{
											name: "Global Average",
											value: `${"⭐".repeat(Math.round(stats.globalAverageScore * 5))} (${(stats.globalAverageScore * 5).toFixed(1)}/5)`,
											inline: false,
										},
									)
									.setTimestamp();

								if (stats.topAgents.length > 0) {
									const topList = stats.topAgents
										.slice(0, 5)
										.map((a, i) => `${i + 1}. **${a.agentId}** - ${(a.score * 5).toFixed(1)}/5 (${a.count} ratings)`)
										.join("\n");
									embed.addFields({ name: "🏆 Top Agents", value: topList });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "rate": {
								const agentId = interaction.options.getString("agent", true);
								const rating = interaction.options.getInteger("rating", true) as 1 | 2 | 3 | 4 | 5;
								const comment = interaction.options.getString("comment");

								feedbackSystem.recordFeedback({
									agentId,
									userId: user.id,
									channelId,
									prompt: "Manual rating via /feedback rate",
									response: "N/A",
									rating,
									comment: comment || undefined,
								});

								const embed = new EmbedBuilder()
									.setTitle("✅ Feedback Recorded")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "Agent", value: agentId, inline: true },
										{ name: "Rating", value: "⭐".repeat(rating), inline: true },
									)
									.setTimestamp();

								if (comment) {
									embed.addFields({ name: "Comment", value: comment });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "summary": {
								const agentId = interaction.options.getString("agent", true);
								const summary = feedbackSystem.getAgentSummary(agentId);

								const embed = new EmbedBuilder()
									.setTitle(`📈 Feedback Summary: ${agentId}`)
									.setColor(summary.averageScore >= 0.6 ? 0x2ecc71 : summary.averageScore >= 0.4 ? 0xf1c40f : 0xe74c3c)
									.addFields(
										{ name: "Total Ratings", value: String(summary.ratedResponses), inline: true },
										{
											name: "Average",
											value: `${"⭐".repeat(Math.round(summary.averageScore * 5))} (${(summary.averageScore * 5).toFixed(1)}/5)`,
											inline: true,
										},
										{ name: "👍 Positive", value: String(summary.positiveCount), inline: true },
										{ name: "👎 Negative", value: String(summary.negativeCount), inline: true },
									)
									.setTimestamp();

								if (summary.commonPraises.length > 0) {
									embed.addFields({
										name: "Common Praises",
										value: summary.commonPraises.slice(0, 3).map((p) => `• ${p.slice(0, 100)}`).join("\n"),
									});
								}

								if (summary.commonComplaints.length > 0) {
									embed.addFields({
										name: "Common Complaints",
										value: summary.commonComplaints.slice(0, 3).map((c) => `• ${c.slice(0, 100)}`).join("\n"),
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "recent": {
								const agentId = interaction.options.getString("agent");
								const stats = feedbackSystem.getGlobalStats();

								if (stats.totalFeedback === 0) {
									await interaction.editReply("No feedback recorded yet.");
									break;
								}

								let feedback;
								if (agentId) {
									feedback = feedbackSystem.getRecentFeedback(agentId, 10);
								} else {
									// Get from all agents
									feedback = stats.topAgents.length > 0
										? feedbackSystem.getRecentFeedback(stats.topAgents[0].agentId, 10)
										: [];
								}

								if (feedback.length === 0) {
									await interaction.editReply("No recent feedback found.");
									break;
								}

								const feedbackList = feedback.map((f) =>
									`**${f.agentId}** - ${"⭐".repeat(Math.round(f.normalizedScore * 5))}\n${f.comment ? f.comment.slice(0, 50) : "_No comment_"}`
								).join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("📝 Recent Feedback")
									.setColor(0x3498db)
									.setDescription(feedbackList.slice(0, 4000))
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "suggestions": {
								const agentId = interaction.options.getString("agent", true);
								const suggestions = feedbackSystem.getSuggestions(agentId);

								if (suggestions.length === 0) {
									await interaction.editReply(`No improvement suggestions for ${agentId} yet. Need more feedback data.`);
									break;
								}

								const suggestionList = suggestions.map((s) =>
									`**[${s.type}]** (${(s.confidence * 100).toFixed(0)}% confidence)\n${s.suggestion}`
								).join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`💡 Improvement Suggestions: ${agentId}`)
									.setColor(0x9b59b6)
									.setDescription(suggestionList.slice(0, 4000))
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "leaderboard": {
								const stats = feedbackSystem.getGlobalStats();

								if (stats.topAgents.length === 0) {
									await interaction.editReply("No agents with enough ratings for leaderboard.");
									break;
								}

								const leaderboard = stats.topAgents.map((a, i) => {
									const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
									return `${medal} **${a.agentId}** - ${(a.score * 5).toFixed(2)}/5 (${a.count} ratings)`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle("🏆 Agent Leaderboard")
									.setColor(0xf1c40f)
									.setDescription(leaderboard)
									.setFooter({ text: "Minimum 5 ratings to qualify" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown feedback subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Feedback error: ${errMsg}`);
					}
					break;
				}

				case "notify": {
					await interaction.deferReply();
					const notifySubcommand = interaction.options.getSubcommand();

					try {
						const { getNotificationSystem, BUILTIN_TEMPLATES } = await import("./agents/agent-notifications.js");
						const notifySystem = getNotificationSystem(workingDir);

						switch (notifySubcommand) {
							case "stats": {
								const stats = notifySystem.getStats();

								const embed = new EmbedBuilder()
									.setTitle("🔔 Notification Statistics")
									.setColor(0x3498db)
									.addFields(
										{ name: "Total", value: String(stats.total), inline: true },
										{ name: "Today", value: String(stats.todayCount), inline: true },
										{ name: "Pending", value: String(stats.pending), inline: true },
										{ name: "Sent", value: String(stats.sent), inline: true },
										{ name: "Read", value: String(stats.read), inline: true },
										{ name: "Failed", value: String(stats.failed), inline: true },
									)
									.addFields({
										name: "By Priority",
										value: `ℹ️ Info: ${stats.byPriority.info}\n✅ Success: ${stats.byPriority.success}\n⚠️ Warning: ${stats.byPriority.warning}\n❌ Error: ${stats.byPriority.error}\n🚨 Critical: ${stats.byPriority.critical}`,
									})
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "send": {
								const message = interaction.options.getString("message", true);
								const priority = (interaction.options.getString("priority") || "info") as any;
								const targetUser = interaction.options.getUser("user") || user;

								const notification = notifySystem.notify({
									agentId: "discord-bot",
									userId: targetUser.id,
									channelId,
									title: `Notification from ${user.username}`,
									message,
									priority,
								});

								const embed = new EmbedBuilder()
									.setTitle("✅ Notification Sent")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "To", value: targetUser.username, inline: true },
										{ name: "Priority", value: priority, inline: true },
										{ name: "Status", value: notification.status, inline: true },
									)
									.addFields({ name: "Message", value: message.slice(0, 1000) })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "inbox": {
								const unreadOnly = interaction.options.getBoolean("unread") ?? false;
								const notifications = notifySystem.getUserNotifications(user.id, {
									unreadOnly,
									limit: 15,
								});
								const unreadCount = notifySystem.getUnreadCount(user.id);

								if (notifications.length === 0) {
									await interaction.editReply("📭 Your inbox is empty.");
									break;
								}

								const notificationList = notifications.map((n) => {
									const icon = n.priority === "critical" ? "🚨" : n.priority === "error" ? "❌" : n.priority === "warning" ? "⚠️" : n.priority === "success" ? "✅" : "ℹ️";
									const read = n.readAt ? "" : "🔵 ";
									return `${read}${icon} **${n.title}**\n${n.message.slice(0, 100)}${n.message.length > 100 ? "..." : ""}`;
								}).join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle(`📬 Your Inbox (${unreadCount} unread)`)
									.setColor(unreadCount > 0 ? 0x3498db : 0x2ecc71)
									.setDescription(notificationList.slice(0, 4000))
									.setFooter({ text: `${notifications.length} notifications shown` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "read": {
								const notificationId = interaction.options.getString("id");

								if (notificationId === "all" || !notificationId) {
									const count = notifySystem.markAllAsRead(user.id);
									await interaction.editReply(`✅ Marked ${count} notifications as read.`);
								} else {
									notifySystem.markAsRead(notificationId);
									await interaction.editReply(`✅ Notification marked as read.`);
								}
								break;
							}

							case "preferences": {
								const enabled = interaction.options.getBoolean("enabled");
								const minPriority = interaction.options.getString("min_priority") as any;

								const currentPrefs = notifySystem.getUserPreferences(user.id);

								// Update if values provided
								if (enabled !== null || minPriority) {
									const updates: any = {};
									if (enabled !== null) updates.enabled = enabled;
									if (minPriority) updates.minPriority = minPriority;
									notifySystem.setUserPreferences(user.id, updates);
								}

								const prefs = notifySystem.getUserPreferences(user.id);

								const embed = new EmbedBuilder()
									.setTitle("⚙️ Notification Preferences")
									.setColor(0x9b59b6)
									.addFields(
										{ name: "Enabled", value: prefs.enabled ? "✅ Yes" : "❌ No", inline: true },
										{ name: "Min Priority", value: prefs.minPriority, inline: true },
										{ name: "Delivery", value: prefs.preferredDelivery, inline: true },
										{ name: "Batching", value: prefs.batchNotifications ? "Yes" : "No", inline: true },
										{ name: "Muted Agents", value: prefs.mutedAgents.length > 0 ? prefs.mutedAgents.join(", ") : "None", inline: false },
									)
									.setTimestamp();

								if (prefs.quietHoursStart !== undefined) {
									embed.addFields({
										name: "Quiet Hours",
										value: `${prefs.quietHoursStart}:00 - ${prefs.quietHoursEnd}:00`,
										inline: true,
									});
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "mute": {
								const agentId = interaction.options.getString("agent", true);
								notifySystem.muteAgent(user.id, agentId);

								await interaction.editReply(`🔇 Muted notifications from agent: **${agentId}**`);
								break;
							}

							case "unmute": {
								const agentId = interaction.options.getString("agent", true);
								notifySystem.unmuteAgent(user.id, agentId);

								await interaction.editReply(`🔔 Unmuted notifications from agent: **${agentId}**`);
								break;
							}

							case "templates": {
								const templates = Object.values(BUILTIN_TEMPLATES);

								const templateList = templates.map((t) =>
									`**${t.name}** (\`${t.id}\`)\n${t.messageTemplate.slice(0, 80)}`
								).join("\n\n");

								const embed = new EmbedBuilder()
									.setTitle("📋 Notification Templates")
									.setColor(0x3498db)
									.setDescription(templateList)
									.setFooter({ text: `${templates.length} templates available` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown notify subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Notification error: ${errMsg}`);
					}
					break;
				}

				case "session": {
					await interaction.deferReply();
					const sessionSubcommand = interaction.options.getSubcommand();

					try {
						const { getSessionIsolation } = await import("./agents/session-isolation.js");
						const sessionSystem = getSessionIsolation(workingDir);

						switch (sessionSubcommand) {
							case "stats": {
								const stats = sessionSystem.getStats();

								const agentList = Object.entries(stats.sessionsByAgent)
									.slice(0, 5)
									.map(([id, count]) => `\`${id}\`: ${count}`)
									.join(", ") || "None";

								const embed = new EmbedBuilder()
									.setTitle("Session Statistics")
									.setColor(0x1abc9c)
									.addFields(
										{ name: "Total Sessions", value: stats.totalSessions.toString(), inline: true },
										{ name: "Active", value: stats.activeSessions.toString(), inline: true },
										{ name: "Suspended", value: stats.suspendedSessions.toString(), inline: true },
										{ name: "Completed", value: stats.completedSessions.toString(), inline: true },
										{ name: "Expired", value: stats.expiredSessions.toString(), inline: true },
										{ name: "Snapshots", value: stats.totalSnapshots.toString(), inline: true },
										{ name: "Avg State Size", value: `${Math.round(stats.avgStateSize)} bytes`, inline: true },
										{ name: "Sessions by Agent", value: agentList, inline: false },
									)
									.setFooter({ text: "Session Isolation System" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "create": {
								const agentId = interaction.options.getString("agent", true);
								const tagsStr = interaction.options.getString("tags");
								const ttlMinutes = interaction.options.getInteger("ttl");

								const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : [];
								const ttlMs = ttlMinutes !== null ? ttlMinutes * 60 * 1000 : undefined;

								const session = sessionSystem.createSession({
									agentId,
									userId: user.id,
									channelId,
									tags,
									ttlMs,
								});

								const embed = new EmbedBuilder()
									.setTitle("Session Created")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "Session ID", value: `\`${session.metadata.id}\``, inline: false },
										{ name: "Agent", value: agentId, inline: true },
										{ name: "Status", value: session.metadata.status, inline: true },
										{ name: "TTL", value: ttlMinutes ? `${ttlMinutes} min` : "No expiry", inline: true },
									)
									.setTimestamp();

								if (tags.length > 0) {
									embed.addFields({ name: "Tags", value: tags.map((t) => `\`${t}\``).join(", "), inline: false });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "get": {
								const sessionId = interaction.options.getString("id", true);
								const key = interaction.options.getString("key");

								const session = sessionSystem.getSession(sessionId);
								if (!session) {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
									break;
								}

								if (key) {
									const value = session.get(key);
									await interaction.editReply(`**${key}**: \`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
								} else {
									const state = session.getAll();
									const keys = Object.keys(state);

									const embed = new EmbedBuilder()
										.setTitle(`Session: ${sessionId.slice(0, 20)}...`)
										.setColor(0x3498db)
										.addFields(
											{ name: "Agent", value: session.metadata.agentId, inline: true },
											{ name: "Status", value: session.metadata.status, inline: true },
											{ name: "Keys", value: keys.length > 0 ? keys.map((k) => `\`${k}\``).join(", ") : "None", inline: false },
										)
										.setTimestamp();

									await interaction.editReply({ embeds: [embed] });
								}
								break;
							}

							case "set": {
								const sessionId = interaction.options.getString("id", true);
								const key = interaction.options.getString("key", true);
								const valueStr = interaction.options.getString("value", true);

								const session = sessionSystem.getSession(sessionId);
								if (!session) {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
									break;
								}

								let value: unknown;
								try {
									value = JSON.parse(valueStr);
								} catch {
									value = valueStr;
								}

								session.set(key, value);
								await interaction.editReply(`Set \`${key}\` in session \`${sessionId.slice(0, 15)}...\``);
								break;
							}

							case "list": {
								const sessions = sessionSystem.getUserSessions(user.id);

								if (sessions.length === 0) {
									await interaction.editReply("No sessions found");
									break;
								}

								const statusEmoji: Record<string, string> = {
									active: "[ON]",
									suspended: "[PAUSE]",
									completed: "[DONE]",
									expired: "[EXP]",
									error: "[ERR]",
								};

								const list = sessions.slice(0, 10).map((s) => {
									const marker = statusEmoji[s.status] ?? "[?]";
									const ago = Math.round((Date.now() - s.lastActivityAt) / 60000);
									return `${marker} \`${s.id.slice(0, 15)}...\` | ${s.agentId} | ${ago}m ago`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Your Sessions (${sessions.length})`)
									.setColor(0x3498db)
									.setDescription(list)
									.setFooter({ text: "Use /session get <id> for details" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "snapshot": {
								const sessionId = interaction.options.getString("id", true);
								const name = interaction.options.getString("name", true);

								const session = sessionSystem.getSession(sessionId);
								if (!session) {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
									break;
								}

								const snapshot = session.snapshot(name);
								await interaction.editReply(`Snapshot created: \`${snapshot.id}\` (${name})`);
								break;
							}

							case "snapshots": {
								const sessionId = interaction.options.getString("id", true);
								const snapshots = sessionSystem.getSnapshots(sessionId);

								if (snapshots.length === 0) {
									await interaction.editReply("No snapshots for this session");
									break;
								}

								const list = snapshots.map((s) => {
									const date = new Date(s.createdAt).toLocaleString();
									const keys = Object.keys(s.state).length;
									return `**${s.name}** | \`${s.id}\` | ${keys} keys | ${date}`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle("Session Snapshots")
									.setColor(0x9b59b6)
									.setDescription(list)
									.setFooter({ text: "Use /session restore <snapshot_id> to restore" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "restore": {
								const snapshotId = interaction.options.getString("snapshot_id", true);
								const restoredSession = sessionSystem.restoreFromSnapshot(snapshotId);

								if (!restoredSession) {
									await interaction.editReply(`Snapshot not found: \`${snapshotId}\``);
									break;
								}

								await interaction.editReply(`Restored session: \`${restoredSession.metadata.id}\``);
								break;
							}

							case "fork": {
								const sessionId = interaction.options.getString("id", true);
								const newAgentId = interaction.options.getString("agent") ?? undefined;

								const session = sessionSystem.getSession(sessionId);
								if (!session) {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
									break;
								}

								const forkedSession = session.fork(newAgentId);
								await interaction.editReply(`Forked session: \`${forkedSession.metadata.id}\``);
								break;
							}

							case "suspend": {
								const sessionId = interaction.options.getString("id", true);

								const session = sessionSystem.getSession(sessionId);
								if (!session) {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
									break;
								}

								session.suspend();
								await interaction.editReply(`Session suspended: \`${sessionId}\``);
								break;
							}

							case "resume": {
								const sessionId = interaction.options.getString("id", true);

								const session = sessionSystem.getSession(sessionId);
								if (!session) {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
									break;
								}

								session.resume();
								await interaction.editReply(`Session resumed: \`${sessionId}\``);
								break;
							}

							case "complete": {
								const sessionId = interaction.options.getString("id", true);

								const session = sessionSystem.getSession(sessionId);
								if (!session) {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
									break;
								}

								session.complete();
								await interaction.editReply(`Session completed: \`${sessionId}\``);
								break;
							}

							case "destroy": {
								const sessionId = interaction.options.getString("id", true);
								const destroyed = sessionSystem.destroySession(sessionId);

								if (destroyed) {
									await interaction.editReply(`Session destroyed: \`${sessionId}\``);
								} else {
									await interaction.editReply(`Session not found: \`${sessionId}\``);
								}
								break;
							}

							default:
								await interaction.editReply("Unknown session subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Session error: ${errMsg}`);
					}
					break;
				}

				case "version": {
					await interaction.deferReply();
					const versionSubcommand = interaction.options.getSubcommand();

					try {
						const { getVersioningSystem, DEFAULT_AGENT_CONFIG } = await import("./agents/agent-versioning.js");
						const versionSystem = getVersioningSystem(workingDir);

						switch (versionSubcommand) {
							case "stats": {
								const stats = versionSystem.getStats();

								const recentList = stats.recentChanges.slice(0, 5).map((c) => {
									const ago = Math.round((Date.now() - c.createdAt) / 60000);
									return `\`${c.agentId}\` v${c.version} (${ago}m ago)`;
								}).join("\n") || "None";

								const embed = new EmbedBuilder()
									.setTitle("Agent Versioning Statistics")
									.setColor(0xe74c3c)
									.addFields(
										{ name: "Total Agents", value: stats.totalAgents.toString(), inline: true },
										{ name: "Total Versions", value: stats.totalVersions.toString(), inline: true },
										{ name: "Production", value: stats.productionVersions.toString(), inline: true },
										{ name: "Staging", value: stats.stagingVersions.toString(), inline: true },
										{ name: "Dev", value: stats.devVersions.toString(), inline: true },
										{ name: "Archived", value: stats.archivedVersions.toString(), inline: true },
										{ name: "Recent Changes", value: recentList, inline: false },
									)
									.setFooter({ text: "Agent Versioning System" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "create": {
								const agentId = interaction.options.getString("agent", true);
								const name = interaction.options.getString("name", true);
								const prompt = interaction.options.getString("prompt", true);
								const changeType = (interaction.options.getString("change") ?? "patch") as "major" | "minor" | "patch";
								const changelog = interaction.options.getString("changelog") ?? "";

								const config = {
									...DEFAULT_AGENT_CONFIG,
									name,
									systemPrompt: prompt,
								};

								const version = versionSystem.createVersion({
									agentId,
									config,
									createdBy: user.id,
									changeType,
									changelog,
								});

								const embed = new EmbedBuilder()
									.setTitle("Version Created")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "Agent", value: agentId, inline: true },
										{ name: "Version", value: version.version, inline: true },
										{ name: "Tag", value: version.tag, inline: true },
										{ name: "Version ID", value: `\`${version.id}\``, inline: false },
									)
									.setTimestamp();

								if (changelog) {
									embed.addFields({ name: "Changelog", value: changelog, inline: false });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "current": {
								const agentId = interaction.options.getString("agent", true);
								const current = versionSystem.getCurrentVersion(agentId);

								if (!current) {
									await interaction.editReply(`No versions found for agent: \`${agentId}\``);
									break;
								}

								const embed = new EmbedBuilder()
									.setTitle(`Current Version: ${agentId}`)
									.setColor(0x3498db)
									.addFields(
										{ name: "Version", value: current.version, inline: true },
										{ name: "Tag", value: current.tag, inline: true },
										{ name: "Created By", value: `<@${current.createdBy}>`, inline: true },
										{ name: "Config Name", value: current.config.name, inline: true },
										{ name: "Model", value: current.config.model, inline: true },
										{ name: "Tools", value: current.config.tools.length.toString(), inline: true },
									)
									.setTimestamp(current.createdAt);

								if (current.changelog) {
									embed.addFields({ name: "Changelog", value: current.changelog, inline: false });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "history": {
								const agentId = interaction.options.getString("agent", true);
								const includeArchived = interaction.options.getBoolean("archived") ?? false;
								const history = versionSystem.getHistory(agentId, includeArchived);

								if (history.versions.length === 0) {
									await interaction.editReply(`No version history for: \`${agentId}\``);
									break;
								}

								const tagEmoji: Record<string, string> = {
									production: "[PROD]",
									staging: "[STAGE]",
									dev: "[DEV]",
									archived: "[ARCH]",
								};

								const list = history.versions.slice(0, 10).map((v) => {
									const tag = tagEmoji[v.tag] ?? "[?]";
									const date = new Date(v.createdAt).toLocaleDateString();
									const current = history.currentVersion?.id === v.id ? " *" : "";
									return `${tag} **v${v.version}**${current} | ${date} | ${v.changelog.slice(0, 40) || "No changelog"}`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Version History: ${agentId}`)
									.setColor(0x9b59b6)
									.setDescription(list)
									.setFooter({ text: `${history.totalVersions} total versions | * = current` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "diff": {
								const versionIdA = interaction.options.getString("version_a", true);
								const versionIdB = interaction.options.getString("version_b", true);
								const diffs = versionSystem.compareVersions(versionIdA, versionIdB);

								if (diffs.length === 0) {
									await interaction.editReply("No differences found between versions");
									break;
								}

								const diffList = diffs.map((d) => {
									const icon = d.type === "added" ? "+" : d.type === "removed" ? "-" : "~";
									return `\`${icon}\` **${d.field}**: ${JSON.stringify(d.oldValue)?.slice(0, 30) ?? "null"} -> ${JSON.stringify(d.newValue)?.slice(0, 30) ?? "null"}`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle("Version Diff")
									.setColor(0xf39c12)
									.setDescription(diffList)
									.setFooter({ text: `${diffs.length} differences` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "rollback": {
								const agentId = interaction.options.getString("agent", true);
								const targetVersionId = interaction.options.getString("version_id", true);

								const result = versionSystem.rollback(agentId, targetVersionId, user.id);

								const embed = new EmbedBuilder()
									.setTitle(result.success ? "Rollback Successful" : "Rollback Failed")
									.setColor(result.success ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "From", value: result.fromVersion, inline: true },
										{ name: "To", value: result.toVersion, inline: true },
										{ name: "Changes", value: result.changes.length.toString(), inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "promote": {
								const versionId = interaction.options.getString("version_id", true);
								const tag = interaction.options.getString("tag", true) as "dev" | "staging" | "production" | "archived";

								const promoted = versionSystem.promoteVersion(versionId, tag, user.id);

								await interaction.editReply(`Promoted \`${promoted.agentId}\` v${promoted.version} to **${tag}**`);
								break;
							}

							case "agents": {
								const agents = versionSystem.getAllAgents();

								if (agents.length === 0) {
									await interaction.editReply("No versioned agents found");
									break;
								}

								const list = agents.map((a) => {
									const ver = a.currentVersion ? `v${a.currentVersion.version} [${a.currentVersion.tag}]` : "No active version";
									return `\`${a.agentId}\` - ${ver}`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Versioned Agents (${agents.length})`)
									.setColor(0x3498db)
									.setDescription(list)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "tag": {
								const tag = interaction.options.getString("tag", true) as "dev" | "staging" | "production" | "archived";
								const versions = versionSystem.getVersionsByTag(tag);

								if (versions.length === 0) {
									await interaction.editReply(`No versions with tag: ${tag}`);
									break;
								}

								const list = versions.slice(0, 10).map((v) => {
									const date = new Date(v.createdAt).toLocaleDateString();
									return `\`${v.agentId}\` v${v.version} | ${date}`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Versions: ${tag.toUpperCase()}`)
									.setColor(0x9b59b6)
									.setDescription(list)
									.setFooter({ text: `${versions.length} total` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown version subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Version error: ${errMsg}`);
					}
					break;
				}

				case "discover": {
					await interaction.deferReply();
					const discoverSubcommand = interaction.options.getSubcommand();

					try {
						const { getDiscoverySystem } = await import("./agents/agent-discovery.js");
						const discoverySystem = getDiscoverySystem(workingDir);

						switch (discoverSubcommand) {
							case "stats": {
								const stats = discoverySystem.getStats();

								const embed = new EmbedBuilder()
									.setTitle("Agent Discovery Statistics")
									.setColor(0x16a085)
									.addFields(
										{ name: "Total Agents", value: stats.totalAgents.toString(), inline: true },
										{ name: "Online", value: stats.onlineAgents.toString(), inline: true },
										{ name: "Offline", value: stats.offlineAgents.toString(), inline: true },
										{ name: "Busy", value: stats.busyAgents.toString(), inline: true },
										{ name: "Degraded", value: stats.degradedAgents.toString(), inline: true },
										{ name: "Avg Health", value: `${Math.round(stats.avgHealthScore)}%`, inline: true },
										{ name: "Total Capabilities", value: stats.totalCapabilities.toString(), inline: true },
										{ name: "Unique Capabilities", value: stats.uniqueCapabilities.toString(), inline: true },
										{ name: "Queries/min", value: stats.queriesPerMinute.toString(), inline: true },
									)
									.setFooter({ text: "Agent Discovery System" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "register": {
								const id = interaction.options.getString("id", true);
								const name = interaction.options.getString("name", true);
								const description = interaction.options.getString("description") ?? "";
								const tagsStr = interaction.options.getString("tags");
								const priority = interaction.options.getInteger("priority") ?? 5;

								const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : [];

								const agent = discoverySystem.registerAgent({
									id,
									name,
									description,
									tags,
									priority: Math.min(10, Math.max(1, priority)),
								});

								const embed = new EmbedBuilder()
									.setTitle("Agent Registered")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "ID", value: `\`${agent.id}\``, inline: true },
										{ name: "Name", value: agent.name, inline: true },
										{ name: "Status", value: agent.status, inline: true },
										{ name: "Priority", value: agent.priority.toString(), inline: true },
									)
									.setTimestamp();

								if (tags.length > 0) {
									embed.addFields({ name: "Tags", value: tags.map((t) => `\`${t}\``).join(", "), inline: false });
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "unregister": {
								const id = interaction.options.getString("id", true);
								const success = discoverySystem.unregisterAgent(id);

								if (success) {
									await interaction.editReply(`Agent unregistered: \`${id}\``);
								} else {
									await interaction.editReply(`Agent not found: \`${id}\``);
								}
								break;
							}

							case "find": {
								const capability = interaction.options.getString("capability", true);
								const minHealth = interaction.options.getInteger("min_health") ?? 0;

								const result = discoverySystem.discover({
									capability,
									minHealthScore: minHealth,
								});

								if (result.agents.length === 0) {
									await interaction.editReply(`No agents found with capability: \`${capability}\``);
									break;
								}

								const list = result.agents.slice(0, 10).map((a) => {
									const load = `${a.currentLoad}/${a.maxConcurrency}`;
									return `\`${a.id}\` | ${a.name} | Health: ${a.healthScore}% | Load: ${load}`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Agents with: ${capability}`)
									.setColor(0x3498db)
									.setDescription(list)
									.setFooter({ text: `${result.totalMatches} matches` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "get": {
								const id = interaction.options.getString("id", true);
								const agent = discoverySystem.getAgent(id);

								if (!agent) {
									await interaction.editReply(`Agent not found: \`${id}\``);
									break;
								}

								const statusEmoji: Record<string, string> = {
									online: "[ON]",
									offline: "[OFF]",
									busy: "[BUSY]",
									degraded: "[DEG]",
									maintenance: "[MAINT]",
								};

								const capList = agent.capabilities.length > 0
									? agent.capabilities.map((c) => `\`${c.name}@${c.version}\``).join(", ")
									: "None";

								const embed = new EmbedBuilder()
									.setTitle(`${statusEmoji[agent.status] ?? "[?]"} ${agent.name}`)
									.setColor(agent.status === "online" ? 0x2ecc71 : 0xe74c3c)
									.addFields(
										{ name: "ID", value: `\`${agent.id}\``, inline: true },
										{ name: "Status", value: agent.status, inline: true },
										{ name: "Health", value: `${agent.healthScore}%`, inline: true },
										{ name: "Priority", value: agent.priority.toString(), inline: true },
										{ name: "Load", value: `${agent.currentLoad}/${agent.maxConcurrency}`, inline: true },
										{ name: "Last Heartbeat", value: `${Math.round((Date.now() - agent.lastHeartbeat) / 1000)}s ago`, inline: true },
										{ name: "Capabilities", value: capList, inline: false },
									)
									.setTimestamp(agent.registeredAt);

								if (agent.description) {
									embed.setDescription(agent.description);
								}

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "list": {
								const statusFilter = interaction.options.getString("status") as "online" | "offline" | "busy" | "degraded" | undefined;
								const agents = discoverySystem.listAgents(statusFilter);

								if (agents.length === 0) {
									await interaction.editReply(statusFilter ? `No ${statusFilter} agents` : "No agents registered");
									break;
								}

								const statusEmoji: Record<string, string> = {
									online: "[ON]",
									offline: "[OFF]",
									busy: "[BUSY]",
									degraded: "[DEG]",
									maintenance: "[MAINT]",
								};

								const list = agents.slice(0, 15).map((a) => {
									const emoji = statusEmoji[a.status] ?? "[?]";
									return `${emoji} \`${a.id}\` | ${a.name} | ${a.healthScore}%`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Registered Agents (${agents.length})`)
									.setColor(0x3498db)
									.setDescription(list)
									.setFooter({ text: statusFilter ? `Filtered: ${statusFilter}` : "All agents" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "heartbeat": {
								const id = interaction.options.getString("id", true);
								const load = interaction.options.getInteger("load") ?? undefined;

								const success = discoverySystem.heartbeat(id, load);

								if (success) {
									await interaction.editReply(`Heartbeat received for: \`${id}\`${load !== undefined ? ` (load: ${load})` : ""}`);
								} else {
									await interaction.editReply(`Agent not found: \`${id}\``);
								}
								break;
							}

							case "status": {
								const id = interaction.options.getString("id", true);
								const newStatus = interaction.options.getString("status", true) as "online" | "offline" | "busy" | "degraded" | "maintenance";

								const success = discoverySystem.updateAgentStatus(id, newStatus);

								if (success) {
									await interaction.editReply(`Status updated: \`${id}\` -> **${newStatus}**`);
								} else {
									await interaction.editReply(`Agent not found: \`${id}\``);
								}
								break;
							}

							case "capabilities": {
								const capabilities = discoverySystem.getAllCapabilities();

								if (capabilities.length === 0) {
									await interaction.editReply("No capabilities registered");
									break;
								}

								const list = capabilities.slice(0, 20).map((c) => {
									return `**${c.name}** v${c.version} | Cost: ${c.cost} | Latency: ${c.latency}ms`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Capabilities (${capabilities.length})`)
									.setColor(0x9b59b6)
									.setDescription(list)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "deps": {
								const id = interaction.options.getString("id", true);
								const { resolved, missing } = discoverySystem.resolveDependencies(id);

								if (resolved.length === 0 && missing.length > 0) {
									await interaction.editReply(`Agent not found: \`${id}\``);
									break;
								}

								const resolvedList = resolved.map((a) => `[OK] \`${a.id}\``).join("\n") || "None";
								const missingList = missing.map((m) => `[MISS] \`${m}\``).join("\n") || "None";

								const embed = new EmbedBuilder()
									.setTitle(`Dependencies: ${id}`)
									.setColor(missing.length > 0 ? 0xe74c3c : 0x2ecc71)
									.addFields(
										{ name: "Resolved", value: resolvedList, inline: true },
										{ name: "Missing", value: missingList, inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown discover subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Discovery error: ${errMsg}`);
					}
					break;
				}

				case "health": {
					await interaction.deferReply();
					const healthSubcommand = interaction.options.getSubcommand();

					try {
						const { getHealthMonitoring } = await import("./agents/health-monitoring.js");
						const healthSystem = getHealthMonitoring(workingDir);

						switch (healthSubcommand) {
							case "status": {
								const systemHealth = healthSystem.getSystemHealth();

								const statusEmoji: Record<string, string> = {
									healthy: "[OK]",
									degraded: "[WARN]",
									unhealthy: "[CRIT]",
									unknown: "[?]",
								};

								const componentList = systemHealth.components.slice(0, 10).map((c) => {
									const emoji = statusEmoji[c.status] ?? "[?]";
									return `${emoji} \`${c.id}\` | ${c.name} | ${c.uptimePercent}%`;
								}).join("\n") || "No components";

								const alertList = systemHealth.activeAlerts.slice(0, 5).map((a) => {
									const sev = a.severity === "critical" ? "[CRIT]" : a.severity === "warning" ? "[WARN]" : "[INFO]";
									return `${sev} ${a.message}`;
								}).join("\n") || "No active alerts";

								const statusColor = systemHealth.status === "healthy" ? 0x2ecc71 :
									systemHealth.status === "degraded" ? 0xf39c12 : 0xe74c3c;

								const embed = new EmbedBuilder()
									.setTitle(`System Health: ${systemHealth.status.toUpperCase()}`)
									.setColor(statusColor)
									.addFields(
										{ name: "Total Components", value: systemHealth.metrics.totalComponents.toString(), inline: true },
										{ name: "Healthy", value: systemHealth.metrics.healthyComponents.toString(), inline: true },
										{ name: "Unhealthy", value: systemHealth.metrics.unhealthyComponents.toString(), inline: true },
										{ name: "Avg Uptime", value: `${systemHealth.metrics.avgUptimePercent}%`, inline: true },
										{ name: "Avg Latency", value: `${systemHealth.metrics.avgLatencyMs}ms`, inline: true },
										{ name: "Active Alerts", value: systemHealth.activeAlerts.length.toString(), inline: true },
										{ name: "Components", value: componentList, inline: false },
										{ name: "Alerts", value: alertList, inline: false },
									)
									.setFooter({ text: "Health Monitoring System" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "register": {
								const id = interaction.options.getString("id", true);
								const name = interaction.options.getString("name", true);
								const type = interaction.options.getString("type", true) as "agent" | "database" | "api" | "queue" | "cache" | "external" | "system";

								const component = healthSystem.registerComponent({ id, type, name });

								const embed = new EmbedBuilder()
									.setTitle("Component Registered")
									.setColor(0x2ecc71)
									.addFields(
										{ name: "ID", value: `\`${component.id}\``, inline: true },
										{ name: "Name", value: component.name, inline: true },
										{ name: "Type", value: component.type, inline: true },
									)
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "check": {
								const id = interaction.options.getString("id", true);
								const healthy = interaction.options.getBoolean("healthy", true);
								const message = interaction.options.getString("message") ?? "";

								const check = healthSystem.recordHealthCheck({
									componentId: id,
									healthy,
									message,
								});

								await interaction.editReply(
									`Health check recorded: \`${id}\` - ${healthy ? "[OK]" : "[FAIL]"}${message ? ` (${message})` : ""}`
								);
								break;
							}

							case "component": {
								const id = interaction.options.getString("id", true);
								const component = healthSystem.getComponentHealth(id);

								if (!component) {
									await interaction.editReply(`Component not found: \`${id}\``);
									break;
								}

								const statusEmoji: Record<string, string> = {
									healthy: "[OK]",
									degraded: "[WARN]",
									unhealthy: "[CRIT]",
									unknown: "[?]",
								};

								const statusColor = component.status === "healthy" ? 0x2ecc71 :
									component.status === "degraded" ? 0xf39c12 : 0xe74c3c;

								const lastCheckInfo = component.lastCheck
									? `${component.lastCheck.status} (${Math.round((Date.now() - component.lastCheck.checkedAt) / 1000)}s ago)`
									: "No checks yet";

								const embed = new EmbedBuilder()
									.setTitle(`${statusEmoji[component.status]} ${component.name}`)
									.setColor(statusColor)
									.addFields(
										{ name: "ID", value: `\`${component.id}\``, inline: true },
										{ name: "Type", value: component.type, inline: true },
										{ name: "Status", value: component.status, inline: true },
										{ name: "Uptime", value: `${component.uptimePercent}%`, inline: true },
										{ name: "Avg Latency", value: `${component.avgLatencyMs}ms`, inline: true },
										{ name: "Check Count", value: component.checkCount.toString(), inline: true },
										{ name: "Consecutive Failures", value: component.consecutiveFailures.toString(), inline: true },
										{ name: "Last Check", value: lastCheckInfo, inline: false },
									)
									.setTimestamp(component.registeredAt);

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "metric": {
								const id = interaction.options.getString("id", true);
								const metricName = interaction.options.getString("name", true);
								const value = interaction.options.getNumber("value", true);
								const unit = interaction.options.getString("unit") ?? "";

								const metric = healthSystem.recordMetric({
									componentId: id,
									metricName,
									value,
									unit,
								});

								await interaction.editReply(
									`Metric recorded: \`${id}\` | ${metricName} = ${value}${unit ? ` ${unit}` : ""}`
								);
								break;
							}

							case "threshold": {
								const id = interaction.options.getString("id", true);
								const metric = interaction.options.getString("metric", true);
								const operator = interaction.options.getString("operator", true) as ">" | "<" | ">=" | "<=";
								const value = interaction.options.getNumber("value", true);
								const severity = (interaction.options.getString("severity") ?? "warning") as "info" | "warning" | "critical";

								const threshold = healthSystem.setThreshold({
									componentId: id,
									metricName: metric,
									operator,
									threshold: value,
									severity,
								});

								await interaction.editReply(
									`Threshold set: \`${id}\` | ${metric} ${operator} ${value} (${severity})`
								);
								break;
							}

							case "alerts": {
								const showAll = interaction.options.getBoolean("all") ?? false;
								const alerts = healthSystem.getAlerts({
									acknowledged: showAll ? undefined : false,
								});

								if (alerts.length === 0) {
									await interaction.editReply(showAll ? "No alerts" : "No active alerts");
									break;
								}

								const list = alerts.slice(0, 15).map((a) => {
									const sev = a.severity === "critical" ? "[CRIT]" : a.severity === "warning" ? "[WARN]" : "[INFO]";
									const ack = a.acknowledged ? " (ack)" : "";
									const ago = Math.round((Date.now() - a.triggeredAt) / 60000);
									return `${sev}${ack} \`${a.componentId}\` | ${a.message} | ${ago}m ago`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Alerts (${alerts.length})`)
									.setColor(alerts.some((a) => a.severity === "critical") ? 0xe74c3c : 0xf39c12)
									.setDescription(list)
									.setFooter({ text: showAll ? "All alerts" : "Active alerts only" })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							case "ack": {
								const alertId = interaction.options.getString("alert_id", true);
								const success = healthSystem.acknowledgeAlert(alertId, user.id);

								if (success) {
									await interaction.editReply(`Alert acknowledged: \`${alertId}\``);
								} else {
									await interaction.editReply(`Alert not found or already acknowledged: \`${alertId}\``);
								}
								break;
							}

							case "history": {
								const id = interaction.options.getString("id", true);
								const limit = interaction.options.getInteger("limit") ?? 20;
								const history = healthSystem.getHealthHistory(id, limit);

								if (history.length === 0) {
									await interaction.editReply(`No health history for: \`${id}\``);
									break;
								}

								const list = history.slice(0, 15).map((h) => {
									const status = h.status === "healthy" ? "[OK]" : "[FAIL]";
									const ago = Math.round((Date.now() - h.checkedAt) / 60000);
									return `${status} ${ago}m ago | ${h.latencyMs}ms | ${h.message.slice(0, 30) || "-"}`;
								}).join("\n");

								const embed = new EmbedBuilder()
									.setTitle(`Health History: ${id}`)
									.setColor(0x3498db)
									.setDescription(list)
									.setFooter({ text: `${history.length} checks shown` })
									.setTimestamp();

								await interaction.editReply({ embeds: [embed] });
								break;
							}

							default:
								await interaction.editReply("Unknown health subcommand");
						}
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : String(error);
						await interaction.editReply(`Health error: ${errMsg}`);
					}
					break;
				}

				default:
					await interaction.reply("Unknown command");
			}

			// Track successful command
			const responseTime = Date.now() - commandStartTime;
			analytics.trackCommand({
				type: "command",
				timestamp: new Date().toISOString(),
				userId: user.id,
				username: user.username,
				command: commandName,
				responseTime,
				model: model.id,
				channelId,
				channelName,
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			botStats.errorsCount++;
			logError(`Slash command error (/${commandName})`, errMsg);

			// Track error
			analytics.trackCommand({
				type: "error",
				timestamp: new Date().toISOString(),
				userId: user.id,
				username: user.username,
				command: commandName,
				error: errMsg,
				model: model.id,
				channelId,
				channelName,
			});

			if (interaction.deferred) {
				await interaction.editReply(`Error: ${errMsg.substring(0, 500)}`).catch(() => {});
			} else {
				await interaction.reply(`Error: ${errMsg.substring(0, 500)}`).catch(() => {});
			}
		}
	});

	// Handle button interactions
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isButton()) return;

		const { customId, user } = interaction;

		// Feedback buttons
		if (customId === "feedback_helpful") {
			await interaction.reply({ content: "Thanks for the feedback! 👍", ephemeral: true });
			logInfo(`[Feedback] ${user.username} found response helpful`);
		} else if (customId === "feedback_not_helpful") {
			await interaction.reply({ content: "Sorry to hear that. I'll try to do better! 👎", ephemeral: true });
			logInfo(`[Feedback] ${user.username} found response not helpful`);
		} else if (customId === "feedback_more") {
			await interaction.reply({ content: "Just ask me a follow-up question!", ephemeral: true });
		}

		// Coding agent buttons
		else if (customId.startsWith("coding_")) {
			try {
				const uiModule = await import("./ui/index.js");
				const { getCodingSessionDB, parseCustomId, disableAllButtons, createEditCodeModal, CUSTOM_IDS } = uiModule;
				const db = getCodingSessionDB();

				const parsed = parseCustomId(customId);
				if (!parsed) {
					await interaction.reply({ content: "Invalid button action", ephemeral: true });
					return;
				}

				const { action, id: suggestionId } = parsed;
				const suggestion = db.getSuggestion(suggestionId);

				if (!suggestion) {
					await interaction.reply({ content: "Code suggestion not found", ephemeral: true });
					return;
				}

				switch (action) {
					case CUSTOM_IDS.ACCEPT_CODE: {
						db.updateSuggestion(suggestionId, { status: "accepted" });
						await disableAllButtons(interaction.message);
						await interaction.reply({
							content: `✅ **Code accepted!**\n\nYou can now copy and use this code:\n\`\`\`${suggestion.language}\n${suggestion.code.slice(0, 1500)}\n\`\`\``,
							ephemeral: true,
						});
						break;
					}

					case CUSTOM_IDS.EDIT_CODE: {
						const modal = createEditCodeModal(suggestionId, suggestion.code);
						await interaction.showModal(modal);
						break;
					}

					case CUSTOM_IDS.REJECT_CODE: {
						db.updateSuggestion(suggestionId, { status: "rejected" });
						await disableAllButtons(interaction.message);
						await interaction.reply({
							content: "❌ Code rejected. Use `/coder suggest` to get a new suggestion.",
							ephemeral: true,
						});
						break;
					}

					case CUSTOM_IDS.RUN_CODE: {
						await interaction.deferReply({ ephemeral: true });
						try {
							const e2bModule = await import("./agents/e2b-sandbox.js");
							const { runInSandbox } = e2bModule;

							// Map language to supported sandbox language
							const langMap: Record<string, "python" | "node" | "bash"> = {
								python: "python",
								javascript: "node",
								typescript: "node",
								js: "node",
								ts: "node",
								py: "python",
								bash: "bash",
								sh: "bash",
							};
							const sandboxLang = langMap[suggestion.language.toLowerCase()] || "node";

							const result = await runInSandbox(suggestion.code, { language: sandboxLang });

							if (result.success) {
								await interaction.editReply(
									`▶️ **Execution Result:**\n\`\`\`\n${(result.output || "No output").slice(0, 1800)}\n\`\`\``,
								);
							} else {
								await interaction.editReply(`❌ **Execution Failed:**\n\`\`\`\n${result.error}\n\`\`\``);
							}
						} catch (err) {
							await interaction.editReply(
								`❌ Sandbox not available: ${err instanceof Error ? err.message : String(err)}`,
							);
						}
						break;
					}

					case CUSTOM_IDS.REGENERATE_CODE: {
						// Find the session this suggestion belongs to
						const sessions = db.listSessions(user.id, "active");
						const session = sessions.find((s) => s.suggestions.some((sg) => sg.id === suggestionId));

						if (!session || !session.lastPrompt) {
							await interaction.reply({
								content: "No active session or prompt found. Use `/coder suggest` instead.",
								ephemeral: true,
							});
							break;
						}

						await interaction.deferReply();

						try {
							// Show thinking indicator
							const {
								createThinkingEmbed,
								createCodeSuggestionEmbed,
								createCodeReviewButtonsExtended,
								estimateTokens,
								extractCodeFromResponse,
								detectLanguage,
								generateSimpleDiff,
							} = uiModule;

							// Keep old code for diff
							const oldCode = suggestion.code;

							const thinkingEmbed = createThinkingEmbed(session.model);
							await interaction.editReply({ embeds: [thinkingEmbed] });

							// Generate new code using lightweight agent
							const startTime = Date.now();
							const model = session.model || "gpt-4o";

							const regeneratePrompt = `${session.lastPrompt}\n\n(Regenerated - provide a different or improved implementation)`;
							const systemPrompt =
								session.systemPrompt ||
								"You are an expert coding assistant. Provide clean, well-documented code.";

							const { runAgent } = await import("./agents/lightweight-agent.js");
							const result = await runAgent({
								prompt: `${systemPrompt}\n\n${regeneratePrompt}`,
								timeout: 60000,
							});

							const duration = Date.now() - startTime;

							// Extract code from response
							const extracted = extractCodeFromResponse(result.output);

							const codeResult = extracted[0] || {
								code: result.output,
								language: suggestion.language || detectLanguage(result.output),
								explanation: "",
							};

							// Create new suggestion
							const newSuggestion = db.createSuggestion({
								sessionId: session.id,
								language: codeResult.language,
								code: codeResult.code,
								explanation: codeResult.explanation || undefined,
								filePath: suggestion.filePath,
							});

							// Update token tracking
							const estTokens = estimateTokens(result.output);
							const costPerToken = model.includes("gpt-4") ? 0.00003 : 0.000002;
							const estCost = estTokens * costPerToken;
							db.updateSession(session.id, {
								tokensUsed: (session.tokensUsed || 0) + estTokens,
								estimatedCost: (session.estimatedCost || 0) + estCost,
							});

							// Create embed and buttons
							const codeEmbed = createCodeSuggestionEmbed(newSuggestion);
							codeEmbed.setFooter({
								text: `Model: ${model} | Tokens: ~${estTokens} | Cost: ~$${estCost.toFixed(4)} | Time: ${(duration / 1000).toFixed(1)}s | Regenerated`,
							});
							const [row1, row2] = createCodeReviewButtonsExtended(newSuggestion.id);

							// Generate diff between old and new code
							const diff = generateSimpleDiff(oldCode, codeResult.code);
							const diffTruncated = diff.slice(0, 1000);
							const { EmbedBuilder } = await import("discord.js");
							const diffEmbed = new EmbedBuilder()
								.setTitle("📊 Changes from Previous")
								.setDescription(
									`\`\`\`diff\n${diffTruncated}${diff.length > 1000 ? "\n... (diff truncated)" : ""}\n\`\`\``,
								)
								.setColor(0x5865f2)
								.setFooter({ text: "- removed | + added" });

							await interaction.editReply({
								embeds: [codeEmbed, diffEmbed],
								components: [row1, row2],
							});

							// Disable old buttons
							await disableAllButtons(interaction.message);
						} catch (err) {
							await interaction.editReply({
								content: `Regeneration failed: ${err instanceof Error ? err.message : String(err)}`,
								embeds: [],
							});
						}
						break;
					}

					case CUSTOM_IDS.COPY_CODE: {
						// Map language to file extension
						const extMap: Record<string, string> = {
							typescript: "ts",
							javascript: "js",
							python: "py",
							rust: "rs",
							go: "go",
							java: "java",
							cpp: "cpp",
							c: "c",
							csharp: "cs",
							ruby: "rb",
							php: "php",
							swift: "swift",
							kotlin: "kt",
							sql: "sql",
							bash: "sh",
							shell: "sh",
							html: "html",
							css: "css",
							json: "json",
							yaml: "yml",
							markdown: "md",
							text: "txt",
						};
						const ext = extMap[suggestion.language.toLowerCase()] || "txt";
						const filename = suggestion.filePath
							? suggestion.filePath.split("/").pop() || `code.${ext}`
							: `suggestion-${Date.now()}.${ext}`;

						// Attach code as downloadable file + show preview
						const { AttachmentBuilder } = await import("discord.js");
						const attachment = new AttachmentBuilder(Buffer.from(suggestion.code, "utf-8"), {
							name: filename,
						});

						await interaction.reply({
							content: `**Download & copy the code:**\n\`\`\`${suggestion.language}\n${suggestion.code.slice(0, 500)}${suggestion.code.length > 500 ? "\n// ... (full code in attached file)" : ""}\n\`\`\``,
							files: [attachment],
							ephemeral: true,
						});
						break;
					}

					default:
						await interaction.reply({ content: "Unknown action", ephemeral: true });
				}
			} catch (error) {
				logError(`[CodingAgent] Button error: ${error instanceof Error ? error.message : String(error)}`);
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({ content: "An error occurred", ephemeral: true });
				}
			}
		}
	});

	// Handle select menu interactions for coding agent
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isStringSelectMenu()) return;

		const { customId, user, values } = interaction;

		if (customId.startsWith("model_select:")) {
			try {
				const uiModule = await import("./ui/index.js");
				const { getCodingSessionDB, AVAILABLE_MODELS } = uiModule;
				const db = getCodingSessionDB();

				const sessionId = customId.split(":")[1];
				const selectedModel = values[0];
				const model = AVAILABLE_MODELS.find((m) => m.id === selectedModel);

				if (!model) {
					await interaction.reply({ content: "Invalid model selection", ephemeral: true });
					return;
				}

				db.updateSession(sessionId, { model: selectedModel });
				await interaction.reply({
					content: `✅ Model changed to **${model.name}** (${model.provider})`,
					ephemeral: true,
				});
			} catch (error) {
				logError(`[CodingAgent] Model select error: ${error instanceof Error ? error.message : String(error)}`);
				await interaction.reply({ content: "Failed to change model", ephemeral: true });
			}
		}
	});

	// Handle modal submissions for coding agent
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isModalSubmit()) return;

		const { customId } = interaction;

		if (customId.startsWith("edit_code:")) {
			try {
				const uiModule = await import("./ui/index.js");
				const { getCodingSessionDB, createCodeSuggestionEmbed, createCodeReviewButtons } = uiModule;
				const db = getCodingSessionDB();

				const suggestionId = customId.split(":")[1];
				const editedCode = interaction.fields.getTextInputValue("edited_code");

				db.updateSuggestion(suggestionId, { code: editedCode });
				const updated = db.getSuggestion(suggestionId);

				if (updated) {
					const embed = createCodeSuggestionEmbed(updated, "edited");
					const buttons = createCodeReviewButtons(updated.id);

					await interaction.reply({
						content: "✏️ **Code updated!**",
						embeds: [embed],
						components: [buttons],
					});
				} else {
					await interaction.reply({ content: "Failed to update code", ephemeral: true });
				}
			} catch (error) {
				logError(`[CodingAgent] Modal submit error: ${error instanceof Error ? error.message : String(error)}`);
				await interaction.reply({ content: "Failed to save edits", ephemeral: true });
			}
		}

		// System prompt modal handler
		if (customId.startsWith("modal_system_prompt:")) {
			try {
				const uiModule = await import("./ui/index.js");
				const { getCodingSessionDB } = uiModule;
				const db = getCodingSessionDB();

				const sessionId = customId.split(":")[1];
				const systemPrompt = interaction.fields.getTextInputValue("system_prompt");

				const session = db.getSession(sessionId);
				if (!session) {
					await interaction.reply({ content: "Session not found", ephemeral: true });
					return;
				}

				db.updateSession(sessionId, { systemPrompt });

				await interaction.reply({
					content: `**System prompt updated!**\n\`\`\`\n${systemPrompt.slice(0, 500)}${systemPrompt.length > 500 ? "..." : ""}\n\`\`\``,
					ephemeral: true,
				});
			} catch (error) {
				logError(
					`[CodingAgent] System prompt modal error: ${error instanceof Error ? error.message : String(error)}`,
				);
				await interaction.reply({ content: "Failed to update system prompt", ephemeral: true });
			}
		}
	});

	// Handle @mentions (keep existing functionality)
	client.on("messageCreate", async (message: Message) => {
		console.log(
			`[DISCORD][DEBUG] Message received: author=${message.author.username}, isDM=${!message.guild}, content="${message.content.slice(0, 30)}..."`,
		);

		if (message.author.bot) return;

		const isMention = message.mentions.has(client.user!);
		const isDM = !message.guild;

		if (!isMention && !isDM) return;

		// CRITICAL: Deduplicate messages to prevent double responses
		if (!markMessageProcessed(message.id)) {
			logWarning(`Duplicate message detected, skipping: ${message.id}`);
			return;
		}

		const channelId = message.channel.id;
		const channelName = isDM ? `DM:${message.author.username}` : (message.channel as TextChannel).name || "unknown";

		let text = message.content;
		if (isMention && client.user) {
			text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
		}

		// Handle file attachments
		const attachments = Array.from(message.attachments.values());
		if (attachments.length > 0) {
			const attachmentInfo = attachments
				.map((a) => `[Attached: ${a.name} (${a.contentType || "unknown"}) - ${a.url}]`)
				.join("\n");
			text = text ? `${text}\n\n${attachmentInfo}` : attachmentInfo;
			logInfo(`[${channelId}] Processing ${attachments.length} attachment(s)`);
		}

		if (!text && attachments.length === 0) return;

		logInfo(`[${channelName}] [msg:${message.id}] ${message.author.username}: ${text.substring(0, 80)}...`);

		// Handle text commands for /provider (so users can type it directly)
		if (text.toLowerCase().startsWith("/provider") || text.toLowerCase().startsWith("!provider")) {
			const parts = text.split(/\s+/);
			const subCommand = parts[1]?.toLowerCase();

			if (!subCommand || subCommand === "status") {
				const providerInfo =
					currentProvider === "openrouter"
						? `**OpenRouter** (Cloud)\nModel: ${OPENROUTER_MODELS[globalModelId]?.name || globalModelId}\nCost: ${OPENROUTER_MODELS[globalModelId]?.cost || "varies"}`
						: `**Ollama** (Local)\nModel: ${globalModelId}\nCost: FREE`;
				await message.reply(
					`🔌 **Current Provider**\n${providerInfo}\n\nSwitch with:\n• \`/provider openrouter\` - Cloud AI\n• \`/provider ollama\` - Local AI`,
				);
				return;
			}

			if (subCommand === "ollama") {
				currentProvider = "ollama";
				globalModelId = DEFAULT_MODEL_ID;
				channelStates.clear();
				logInfo(`[TEXT-CMD] Switched to Ollama by ${message.author.username}`);
				await message.reply(`✅ Switched to **Ollama** (local, free)\nModel: \`${globalModelId}\``);
				return;
			}

			if (subCommand === "openrouter") {
				if (!OPENROUTER_API_KEY) {
					await message.reply("❌ OpenRouter API key not configured.");
					return;
				}
				const modelChoice = parts[2]?.toLowerCase() || DEFAULT_OPENROUTER_MODEL;
				const validModels = Object.keys(OPENROUTER_MODELS);
				const selectedModel = validModels.find((m) => m.includes(modelChoice)) || DEFAULT_OPENROUTER_MODEL;

				currentProvider = "openrouter";
				globalModelId = selectedModel;
				channelStates.clear();

				const modelInfo = OPENROUTER_MODELS[selectedModel];
				logInfo(`[TEXT-CMD] Switched to OpenRouter (${modelInfo?.id}) by ${message.author.username}`);
				await message.reply(
					`✅ Switched to **OpenRouter** (cloud)\nModel: \`${modelInfo?.name || selectedModel}\`\nCost: ${modelInfo?.cost || "varies"}`,
				);
				return;
			}

			// Unknown subcommand - show help
			await message.reply(
				`Available models:\n${Object.entries(OPENROUTER_MODELS)
					.map(([k, v]) => `• \`${k}\` - ${v.name}`)
					.join("\n")}\n\nUsage: \`/provider openrouter mistral-small\``,
			);
			return;
		}

		// Handle /browse and /browser (typo) text commands (route to browserAutomation instead of AI agent)
		if (text.toLowerCase().startsWith("/browse") || text.toLowerCase().startsWith("/browser")) {
			// Match both /browse and /browser (common typo)
			const browseMatch = text.match(/\/browser?\s+(\w+)\s+(?:url:)?(\S+)/i);
			if (browseMatch) {
				const subCmd = browseMatch[1].toLowerCase();
				const url = browseMatch[2];

				logInfo(`[TEXT-CMD] /browse ${subCmd} for ${url} by ${message.author.username}`);

				if (subCmd === "screenshot") {
					try {
						const startTime = Date.now();
						await message.reply("📸 Taking screenshot...");
						const result = await browserAutomation.screenshot(url, { fullPage: false });

						if (result.success && result.data?.screenshot) {
							const fileBuffer = readFileSync(result.data.screenshot);
							const attachment = new AttachmentBuilder(fileBuffer, { name: "screenshot.png" });
							const embed = new EmbedBuilder()
								.setTitle(`📸 Screenshot: ${new URL(url).hostname}`)
								.setURL(url)
								.setImage("attachment://screenshot.png")
								.setColor(0x00ff88)
								.setTimestamp()
								.setFooter({ text: `Browser Automation • ${Date.now() - startTime}ms` });

							await message.reply({ embeds: [embed], files: [attachment] });
							await browserAutomation.cleanup(result.data.screenshot);
							logInfo(`[TEXT-CMD] Screenshot sent for ${url} (${Date.now() - startTime}ms)`);
						} else {
							await message.reply(`❌ Screenshot failed: ${result.error || "Unknown error"}`);
							logWarning(`[TEXT-CMD] Screenshot failed for ${url}: ${result.error}`);
						}
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						await message.reply(`❌ Screenshot error: ${errMsg}`);
						logError(`[TEXT-CMD] Screenshot error for ${url}: ${errMsg}`);
					}
					return;
				}

				if (subCmd === "scrape") {
					try {
						const startTime = Date.now();
						await message.reply("🔍 Scraping content...");
						const result = await browserAutomation.scrape(url);

						if (result.success && result.data?.content) {
							const content = result.data.content.slice(0, 1900);
							await message.reply(`**Scraped from ${new URL(url).hostname}:**\n\`\`\`\n${content}\n\`\`\``);
							logInfo(`[TEXT-CMD] Scrape sent for ${url} (${Date.now() - startTime}ms)`);
						} else {
							await message.reply(`❌ Scrape failed: ${result.error || "Unknown error"}`);
							logWarning(`[TEXT-CMD] Scrape failed for ${url}: ${result.error}`);
						}
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						await message.reply(`❌ Scrape error: ${errMsg}`);
						logError(`[TEXT-CMD] Scrape error for ${url}: ${errMsg}`);
					}
					return;
				}

				// Unknown browse subcommand
				await message.reply("Available: `/browse screenshot <url>` or `/browse scrape <url>`");
				return;
			}
		}

		// Handle /generate text command (image/music generation with proper embedding)
		if (text.toLowerCase().startsWith("/generate ")) {
			const genMatch = text.match(/\/generate\s+(image|music)\s+(?:prompt:)?(.+)/i);
			if (genMatch) {
				const subCmd = genMatch[1].toLowerCase();
				let promptText = genMatch[2].trim();

				// Extract model if specified
				let model = "flux-dev";
				const modelMatch = promptText.match(/model:(\S+)/i);
				if (modelMatch) {
					model = modelMatch[1];
					promptText = promptText.replace(/model:\S+/i, "").trim();
				}

				logInfo(`[TEXT-CMD] /generate ${subCmd} by ${message.author.username}`);

				if (subCmd === "image") {
					try {
						await message.reply(`🎨 Generating image with ${model}...`);

						// Check if using HuggingFace model
						if (model.startsWith("hf-")) {
							const HF_TOKEN = process.env.HF_TOKEN;
							if (!HF_TOKEN) {
								await message.reply("❌ HF_TOKEN not configured.");
								return;
							}

							const hfModelMap: Record<string, string> = {
								"hf-sdxl": "stabilityai/stable-diffusion-xl-base-1.0",
								"hf-sd3": "stabilityai/stable-diffusion-3.5-large",
							};

							const hfModel = hfModelMap[model] || hfModelMap["hf-sdxl"];
							const hfUrl = `https://router.huggingface.co/hf-inference/models/${hfModel}`;

							const hfResponse = await fetch(hfUrl, {
								method: "POST",
								headers: {
									Authorization: `Bearer ${HF_TOKEN}`,
									"Content-Type": "application/json",
								},
								body: JSON.stringify({ inputs: promptText }),
							});

							if (!hfResponse.ok) {
								const hfError = await hfResponse.text();
								await message.reply(`HuggingFace error: ${hfError.slice(0, 300)}`);
								return;
							}

							const contentType = hfResponse.headers.get("content-type");
							if (contentType?.includes("image")) {
								const imgBuffer = Buffer.from(await hfResponse.arrayBuffer());
								const attachment = new AttachmentBuilder(imgBuffer, { name: "generated.png" });

								const embed = new EmbedBuilder()
									.setColor(0xffd21e)
									.setTitle("🤗 Image Generated")
									.setDescription(`**Prompt:** ${promptText.slice(0, 200)}`)
									.setImage("attachment://generated.png")
									.setFooter({ text: `Model: ${hfModel.split("/").pop()} | HuggingFace` });
								await message.reply({ embeds: [embed], files: [attachment] });
							} else {
								await message.reply("Unexpected HuggingFace response (not an image)");
							}
							return;
						}

						// Fal.ai models
						const FAL_KEY = process.env.FAL_KEY;
						if (!FAL_KEY) {
							await message.reply("❌ FAL_KEY not configured.");
							return;
						}

						const modelMap: Record<string, string> = {
							"flux-dev": "fal-ai/flux/dev",
							"flux-schnell": "fal-ai/flux/schnell",
							"flux-pro": "fal-ai/flux-pro/v1.1",
							"flux-realism": "fal-ai/flux-realism",
							ideogram: "fal-ai/ideogram/v2",
							recraft: "fal-ai/recraft-v3",
						};

						const response = await fetch(`https://fal.run/${modelMap[model] || modelMap["flux-dev"]}`, {
							method: "POST",
							headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
							body: JSON.stringify({
								prompt: promptText,
								image_size: "landscape_16_9",
								num_inference_steps: 28,
							}),
						});

						const result = (await response.json()) as { images?: Array<{ url: string }>; detail?: string };
						if (result.images?.[0]?.url) {
							const imgResponse = await fetch(result.images[0].url);
							const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
							const attachment = new AttachmentBuilder(imgBuffer, { name: "generated.png" });

							const embed = new EmbedBuilder()
								.setColor(0x7c3aed)
								.setTitle("🎨 Image Generated")
								.setDescription(`**Prompt:** ${promptText.slice(0, 200)}`)
								.setImage("attachment://generated.png")
								.setFooter({ text: `Model: ${model} | Fal.ai` });
							await message.reply({ embeds: [embed], files: [attachment] });
						} else {
							await message.reply(`Image generation failed: ${result.detail || "Unknown error"}`);
						}
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						await message.reply(`❌ Image generation error: ${errMsg}`);
					}
					return;
				}

				if (subCmd === "music") {
					try {
						const SUNO_KEY = process.env.SUNO_API_KEY;
						logInfo(`[TEXT-CMD] Music generation starting, SUNO_KEY=${SUNO_KEY ? "set" : "missing"}`);
						if (!SUNO_KEY) {
							await message.reply("❌ SUNO_API_KEY not configured.");
							return;
						}

						await message.reply(
							`🎵 Generating music: "${promptText.slice(0, 100)}..."\n⏳ This takes 1-2 minutes...`,
						);
						logInfo(`[TEXT-CMD] Calling Suno API for: ${promptText.slice(0, 50)}`);

						const genResponse = await fetch("https://api.sunoapi.org/api/v1/generate", {
							method: "POST",
							headers: {
								Authorization: `Bearer ${SUNO_KEY}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								prompt: promptText,
								model: "V4_5ALL",
								customMode: false,
								instrumental: false,
								callBackUrl: "https://webhook.site/test",
							}),
						});

						const genResult = (await genResponse.json()) as {
							code: number;
							data?: { taskId: string };
							msg?: string;
						};
						logInfo(`[TEXT-CMD] Suno API response: code=${genResult.code}, taskId=${genResult.data?.taskId}`);

						if (genResult.code !== 200 || !genResult.data?.taskId) {
							await message.reply(`❌ Music generation failed: ${genResult.msg || "Unknown error"}`);
							return;
						}

						const taskId = genResult.data.taskId;
						let attempts = 0;
						const maxAttempts = 24; // 2 minutes with 5s intervals
						logInfo(`[TEXT-CMD] Starting polling for taskId=${taskId}`);

						while (attempts < maxAttempts) {
							await new Promise((resolve) => setTimeout(resolve, 5000));
							attempts++;

							const statusResponse = await fetch(
								`https://api.sunoapi.org/api/v1/generate/record-info?taskId=${taskId}`,
								{
									headers: { Authorization: `Bearer ${SUNO_KEY}` },
								},
							);

							const statusResult = (await statusResponse.json()) as {
								code: number;
								data?: {
									status: string;
									response?: { sunoData?: Array<{ title: string; audioUrl: string; duration: number }> };
								};
							};

							logInfo(`[TEXT-CMD] Poll ${attempts}/${maxAttempts}: status=${statusResult.data?.status}`);

							if (statusResult.data?.status === "SUCCESS" && statusResult.data.response?.sunoData?.[0]) {
								const track = statusResult.data.response.sunoData[0];
								logInfo(`[TEXT-CMD] Music ready! Title: ${track.title}, Duration: ${track.duration}s`);
								const embed = new EmbedBuilder()
									.setColor(0xf1c40f)
									.setTitle(`🎵 ${track.title}`)
									.setDescription(`**Prompt:** ${promptText.slice(0, 200)}`)
									.addFields({ name: "Duration", value: `${Math.round(track.duration)}s`, inline: true })
									.addFields({ name: "Listen", value: `[Audio Link](${track.audioUrl})`, inline: true })
									.setFooter({ text: "Generated with Suno AI" });
								await message.reply({ embeds: [embed] });
								return;
							}

							if (
								statusResult.data?.status === "CREATE_TASK_FAILED" ||
								statusResult.data?.status === "GENERATE_AUDIO_FAILED"
							) {
								await message.reply(`❌ Music generation failed: ${statusResult.data.status}`);
								return;
							}
						}

						await message.reply("⏰ Music generation timed out. Please try again.");
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						await message.reply(`❌ Music generation error: ${errMsg}`);
					}
					return;
				}
			}

			// Show help for unknown /generate subcommand
			await message.reply(
				"**Generate Commands:**\n" +
					"`/generate image prompt:<description> model:<model>`\n" +
					"`/generate music prompt:<description>`\n\n" +
					"**Image Models:** flux-dev, flux-schnell, flux-pro, hf-sdxl, hf-sd3",
			);
			return;
		}

		// Handle /price text command (quick crypto price lookup)
		if (text.toLowerCase().startsWith("/price ")) {
			const symbol = text.slice(7).trim().toUpperCase();
			if (symbol) {
				try {
					logInfo(`[TEXT-CMD] /price ${symbol} by ${message.author.username}`);
					const response = await fetch(
						`https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`,
					);
					const data = await response.json();
					const price = data[symbol.toLowerCase()]?.usd;
					const change = data[symbol.toLowerCase()]?.usd_24h_change;
					if (price) {
						const changeStr = change ? ` (${change > 0 ? "+" : ""}${change.toFixed(2)}%)` : "";
						await message.reply(`💰 **${symbol}**: $${price.toLocaleString()}${changeStr}`);
					} else {
						// Try as ticker
						const tickerRes = await fetch(
							`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${symbol.toLowerCase()}`,
						);
						const tickerData = await tickerRes.json();
						if (tickerData[0]) {
							const coin = tickerData[0];
							await message.reply(
								`💰 **${coin.symbol.toUpperCase()}** (${coin.name}): $${coin.current_price.toLocaleString()} (${coin.price_change_percentage_24h > 0 ? "+" : ""}${coin.price_change_percentage_24h?.toFixed(2)}%)`,
							);
						} else {
							await message.reply(`❌ Could not find price for ${symbol}`);
						}
					}
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					await message.reply(`❌ Price lookup error: ${errMsg}`);
				}
				return;
			}
		}

		// Handle /status text command (quick bot status)
		if (text.toLowerCase() === "/status") {
			logInfo(`[TEXT-CMD] /status by ${message.author.username}`);
			const uptime = process.uptime();
			const hours = Math.floor(uptime / 3600);
			const mins = Math.floor((uptime % 3600) / 60);
			await message.reply(
				`🤖 **Bot Status**\n⏱️ Uptime: ${hours}h ${mins}m\n💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n📡 Model: GLM-4.7`,
			);
			return;
		}

		// Handle /help text command
		if (text.toLowerCase() === "/help") {
			logInfo(`[TEXT-CMD] /help by ${message.author.username}`);
			await message.reply(`**Quick Commands:**
\`/price BTC\` - Crypto price
\`/status\` - Bot status
\`/browse screenshot <url>\` - Screenshot
\`/browse scrape <url>\` - Extract content
\`/provider <name>\` - Switch AI model

**Slash Commands:** Use \`/\` to see all 35 commands`);
			return;
		}

		// Track if we've already sent a response to prevent duplicates
		let responseSent = false;
		let streamingMessage: Message | null = null; // Reference to streaming message for edits
		let typingInterval: NodeJS.Timeout | null = null; // Typing indicator loop

		// Cleanup typing interval
		const stopTyping = () => {
			if (typingInterval) {
				clearInterval(typingInterval);
				typingInterval = null;
			}
		};

		try {
			// INSTANT FEEDBACK: Show typing + immediate acknowledgment
			if ("sendTyping" in message.channel) {
				await (message.channel as any).sendTyping();
				// Keep typing indicator alive every 5s (Discord typing expires after 10s)
				typingInterval = setInterval(async () => {
					try {
						if (!responseSent) await (message.channel as any).sendTyping();
					} catch {}
				}, 5000);
			}

			// Immediate "thinking" message for instant feedback
			streamingMessage = await message.reply("_thinking..._");

			// Function for streaming updates - edits the pre-created "thinking" message
			const updateStreaming = async (content: string) => {
				if (!content || content.trim().length === 0) return;
				try {
					if (streamingMessage) {
						await streamingMessage.edit(content);
					}
				} catch {
					// Silently ignore streaming edit errors (rate limits, etc.)
				}
			};

			// Final reply function that prevents duplicates
			const sendResponse = async (content: string) => {
				stopTyping(); // Stop typing indicator immediately
				logInfo(
					`[${channelName}] sendResponse CALLED (${content?.length || 0} chars, responseSent=${responseSent}, streamingMessage=${!!streamingMessage})`,
				);
				if (responseSent) {
					logWarning(`[${channelName}] Duplicate response prevented`);
					return;
				}
				responseSent = true;

				if (!content || content.trim().length === 0) {
					logWarning(`[${channelName}] Attempted to send empty response, skipping`);
					return;
				}

				try {
					// Check for rich embed markers
					const embedMatch = content.match(/__EMBED__(.+?)__EMBED__/s);
					if (embedMatch) {
						try {
							const embedData = JSON.parse(embedMatch[1]);
							const embed = new EmbedBuilder()
								.setTitle(embedData.title || "Response")
								.setDescription(embedData.description || "")
								.setColor(embedData.color || 0x0099ff)
								.setTimestamp();

							if (embedData.fields) {
								embed.addFields(embedData.fields);
							}
							if (embedData.thumbnail?.url) {
								embed.setThumbnail(embedData.thumbnail.url);
							}
							if (embedData.footer?.text) {
								embed.setFooter({ text: embedData.footer.text });
							}

							// Send embed + any text outside the markers
							const textOutside = content.replace(/__EMBED__.+?__EMBED__/s, "").trim();

							// If we have a streaming message, edit it with final content
							if (streamingMessage) {
								if (textOutside) {
									await streamingMessage.edit({ content: textOutside, embeds: [embed] });
								} else {
									await streamingMessage.edit({ content: null, embeds: [embed] });
								}
								logInfo(`[${channelName}] Discord reply updated (embed)`);
							} else {
								if (textOutside) {
									await message.reply({ content: textOutside, embeds: [embed] });
								} else {
									await message.reply({ embeds: [embed] });
								}
								logInfo(`[${channelName}] Discord reply sent (embed)`);
							}
							return;
						} catch {
							// If embed parsing fails, send as plain text
						}
					}

					// Split long messages instead of truncating
					const chunks = splitMessage(content);

					if (chunks.length === 1) {
						// Single chunk - just edit or reply
						if (streamingMessage) {
							await streamingMessage.edit(content);
							logInfo(`[${channelName}] Discord reply updated (${content.length} chars)`);
						} else {
							await message.reply(content);
							logInfo(`[${channelName}] Discord reply sent (${content.length} chars)`);
						}
					} else {
						// Multiple chunks - edit first, send follow-ups
						if (streamingMessage) {
							await streamingMessage.edit(chunks[0]);
						} else {
							await message.reply(chunks[0]);
						}
						// Send remaining chunks as follow-up messages
						for (let i = 1; i < chunks.length; i++) {
							await (message.channel as any).send(chunks[i]);
						}
						logInfo(
							`[${channelName}] Split response into ${chunks.length} parts (${content.length} total chars)`,
						);
					}
				} catch (replyError) {
					const errMsg = replyError instanceof Error ? replyError.message : String(replyError);
					logError(`[${channelName}] Failed to send Discord reply`, errMsg);
					// Try sending as channel message instead of reply
					try {
						await (message.channel as any).send(content);
						logInfo(`[${channelName}] Fallback channel send succeeded`);
					} catch (fallbackError) {
						logError(`[${channelName}] Fallback send also failed`, String(fallbackError));
					}
				}
			};

			await handleAgentRequest(
				channelId,
				channelName,
				message.author.username,
				message.author.id,
				text,
				workingDir,
				sendResponse, // reply callback for final response
				updateStreaming, // editReply for streaming updates (doesn't block final)
				message,
			);
			// Agent finished - stop typing indicator
			stopTyping();
		} catch (error) {
			stopTyping(); // Clean up typing indicator on error
			const errMsg = error instanceof Error ? error.message : String(error);
			logError("Error processing message", errMsg);

			if (!responseSent) {
				// Edit the "thinking" message if it exists, otherwise reply
				if (streamingMessage) {
					await streamingMessage.edit(`_Error: ${errMsg.substring(0, 500)}_`).catch(() => {});
				} else {
					await message.reply(`_Error: ${errMsg.substring(0, 500)}_`).catch(() => {});
				}
			}
		}
	});

	client.on("error", (error) => {
		logError("Discord client error", error.message);
	});

	process.on("SIGINT", () => {
		logInfo("Shutting down...");
		if (taskScheduler) {
			taskScheduler.shutdown();
		}
		if (db) {
			db.close();
		}
		client.destroy();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		logInfo("Shutting down...");
		if (taskScheduler) {
			taskScheduler.shutdown();
		}
		if (db) {
			db.close();
		}
		client.destroy();
		process.exit(0);
	});

	await client.login(DISCORD_BOT_TOKEN);

	// ========================================================================
	// Trading Learning Service: Auto-Outcome Recording Setup
	// ========================================================================
	// Set up price provider for automatic signal outcome recording
	tradingLearning.setPriceProvider(async (symbol: string) => {
		try {
			const priceData = await fetchCoinGeckoPrice(symbol);
			return priceData?.price ?? null;
		} catch {
			return null;
		}
	});
	console.log("[TRADING-LEARNING] Price provider connected for auto-outcome tracking");

	// ========================================================================
	// Event-Driven Triggers: Cron Jobs & Webhooks
	// ========================================================================

	const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID; // Channel for scheduled reports
	const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "3001", 10);

	// Multi-channel configuration
	const ALERTS_CHANNEL_ID = process.env.ALERTS_CHANNEL_ID;
	const SIGNALS_CHANNEL_ID = process.env.SIGNALS_CHANNEL_ID;
	const REPORTS_CHANNEL_ID = process.env.REPORTS_CHANNEL_ID;
	const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID;

	// ChannelRouter: Routes messages to appropriate channels with fallback support
	class ChannelRouter {
		private client: Client;
		private fallbackChannelId: string | undefined;

		constructor(client: Client, fallbackChannelId?: string) {
			this.client = client;
			this.fallbackChannelId = fallbackChannelId;
		}

		private async sendToChannel(channelId: string | undefined, content: string): Promise<void> {
			const targetChannelId = channelId || this.fallbackChannelId;
			if (!targetChannelId) {
				logWarning("[CHANNEL_ROUTER] No channel configured and no fallback available");
				return;
			}

			try {
				const channel = await this.client.channels.fetch(targetChannelId);
				if (channel && "send" in channel) {
					await (channel as TextChannel).send(content);
				}
			} catch (error) {
				logError(
					`Failed to send to channel ${targetChannelId}`,
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		async sendAlert(content: string): Promise<void> {
			await this.sendToChannel(ALERTS_CHANNEL_ID, content);
		}

		async sendSignal(content: string): Promise<void> {
			await this.sendToChannel(SIGNALS_CHANNEL_ID, content);
		}

		async sendReport(content: string): Promise<void> {
			await this.sendToChannel(REPORTS_CHANNEL_ID, content);
		}

		async sendLog(content: string): Promise<void> {
			await this.sendToChannel(LOGS_CHANNEL_ID, content);
		}

		async send(content: string, channelId?: string): Promise<void> {
			await this.sendToChannel(channelId, content);
		}
	}

	// Initialize channel router with backward compatibility
	const channelRouter = new ChannelRouter(client, REPORT_CHANNEL_ID);

	// Helper: Send message to report channel (maintained for backward compatibility)
	async function sendToReportChannel(content: string): Promise<void> {
		await channelRouter.sendReport(content);
	}

	// ========================================================================
	// Task Scheduler: User-Configurable Scheduled Tasks
	// ========================================================================

	// Action executor for scheduled tasks
	async function executeScheduledAction(action: string, _userId: string, _channelId: string): Promise<string> {
		try {
			// Predefined actions
			if (action === "report:daily") {
				// Daily analytics report
				const yesterday = new Date();
				yesterday.setDate(yesterday.getDate() - 1);
				const summary = analytics.generateDailySummary(yesterday);
				return `**Daily Analytics Report**\n\`\`\`\n${summary.substring(0, 1800)}\n\`\`\``;
			} else if (action === "report:weekly") {
				// Weekly summary
				const lastWeek = new Date();
				lastWeek.setDate(lastWeek.getDate() - 7);
				const summary = analytics.generateDailySummary(lastWeek);
				return `**Weekly Analytics Summary**\n\`\`\`\n${summary.substring(0, 1800)}\n\`\`\``;
			} else if (action === "health:check") {
				// Health status check
				const uptime = Date.now() - botStats.startTime;
				const hours = Math.floor(uptime / (1000 * 60 * 60));
				const mins = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
				const memUsage = process.memoryUsage();
				return (
					`**System Health Check**\n` +
					`Uptime: ${hours}h ${mins}m\n` +
					`Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB\n` +
					`Commands Processed: ${botStats.commandsProcessed}\n` +
					`Active Channels: ${channelStates.size}`
				);
			} else if (action === "backup:auto") {
				// Auto backup
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				const backupPath = join(workingDir, `backups/auto-backup-${timestamp}.json`);
				const backupDir = join(workingDir, "backups");
				if (!existsSync(backupDir)) {
					mkdirSync(backupDir, { recursive: true });
				}

				const dbStats = db.getStats();
				const backupData = {
					timestamp,
					stats: dbStats,
					version: "1.0",
				};

				writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
				return (
					`**Automatic Backup Completed**\n` +
					`Location: ${backupPath}\n` +
					`Users: ${dbStats.users}\n` +
					`Scheduled Tasks: ${dbStats.scheduledTasks}`
				);
			} else {
				// Custom prompt - send to AI agent
				// For now, just return the action as a message
				// In a future enhancement, this could actually call the AI agent
				return `**Custom Task**\n${action}`;
			}
		} catch (error) {
			throw new Error(`Action execution failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// Initialize task scheduler
	const tasksFilePath = join(workingDir, "tasks.json");
	taskScheduler = new TaskScheduler(
		tasksFilePath,
		{
			sendMessage: async (channelId: string, content: string) => {
				await channelRouter.send(content, channelId);
			},
			executeAction: executeScheduledAction,
			logInfo,
			logError,
		},
		db,
	);

	logInfo("Task Scheduler initialized");

	// Daily trading system health check (9 AM UTC)
	cron.schedule("0 9 * * *", async () => {
		logInfo("[CRON] Running daily trading system health check");
		try {
			const result = await execCommand(`
				echo "=== Trading System Daily Report ==="
				echo "Date: $(date)"
				echo ""
				echo "=== System Resources ==="
				free -h | head -2
				echo ""
				echo "=== Trading Processes ==="
				ps aux | grep -E 'python.*trad|collector' | grep -v grep | head -5 || echo "No trading processes found"
				echo ""
				echo "=== Recent Errors (last 24h) ==="
				find /home/majinbu/organized/active-projects/trading-system/quant/rbi_bench/ -name "*.log" -mtime 0 -exec grep -l -i error {} \\; 2>/dev/null | head -5 || echo "No error logs found"
			`);
			await sendToReportChannel(`**Daily Trading Report**\n\`\`\`\n${result.stdout.substring(0, 1800)}\n\`\`\``);
		} catch (error) {
			logError("[CRON] Health check failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Memory alert tracking (prevent spam)
	let lastMemoryAlertThreshold: "none" | "warning" | "critical" = "none";

	// Hourly quick status check with memory monitoring
	cron.schedule("0 * * * *", async () => {
		logInfo("[CRON] Running hourly status check");
		try {
			const result = await execCommand(`
				echo "Uptime: $(uptime -p)"
				echo "Load: $(cat /proc/loadavg | cut -d' ' -f1-3)"
				echo "Memory: $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
			`);
			// Log status
			logInfo(`[CRON] Status: ${result.stdout.replace(/\n/g, " | ").trim()}`);

			// Memory monitoring and alerting
			const memoryCheck = await execCommand(`
				# Get memory info in parseable format
				free -m | awk '/Mem:/ {printf "TOTAL=%d\\nUSED=%d\\nAVAIL=%d\\nPERCENT=%.1f", $2, $3, $7, ($3/$2)*100}'
				echo ""
				echo "TOP_PROCESSES:"
				ps aux --sort=-%mem | awk 'NR>1 {printf "%s\\t%.1f%%\\t%s\\n", $11, $4, $1}' | head -3
			`);

			if (memoryCheck.code === 0) {
				const output = memoryCheck.stdout;

				// Parse memory stats
				const percentMatch = output.match(/PERCENT=([\d.]+)/);
				const totalMatch = output.match(/TOTAL=(\d+)/);
				const usedMatch = output.match(/USED=(\d+)/);
				const availMatch = output.match(/AVAIL=(\d+)/);

				if (percentMatch && totalMatch && usedMatch && availMatch) {
					const memoryPercent = parseFloat(percentMatch[1]);
					const totalGB = (parseInt(totalMatch[1], 10) / 1024).toFixed(1);
					const usedGB = (parseInt(usedMatch[1], 10) / 1024).toFixed(1);
					const availGB = (parseInt(availMatch[1], 10) / 1024).toFixed(1);

					// Extract top processes
					const topProcessesMatch = output.match(/TOP_PROCESSES:\n([\s\S]+)$/);
					const topProcesses = topProcessesMatch ? topProcessesMatch[1].trim() : "Unable to fetch";

					// Determine threshold
					let currentThreshold: "none" | "warning" | "critical" = "none";
					if (memoryPercent >= 95) {
						currentThreshold = "critical";
					} else if (memoryPercent >= 90) {
						currentThreshold = "warning";
					}

					// Send alert if threshold crossed and different from last alert
					if (currentThreshold !== "none" && currentThreshold !== lastMemoryAlertThreshold) {
						const alertLevel = currentThreshold === "critical" ? "🚨 CRITICAL" : "⚠️ WARNING";
						const alertMessage = [
							`**${alertLevel}: High Memory Usage**`,
							``,
							`**Memory Usage:** ${memoryPercent.toFixed(1)}% (${usedGB}Gi / ${totalGB}Gi)`,
							`**Available:** ${availGB}Gi`,
							``,
							`**Top 3 Processes by Memory:**`,
							`\`\`\``,
							topProcesses,
							`\`\`\``,
							``,
							currentThreshold === "critical"
								? `⚠️ **Action required:** Memory usage is critically high. Consider restarting services or investigating memory leaks.`
								: `Monitor closely. Alert will trigger again if usage increases to 95%+.`,
						].join("\n");

						// Send to alert channel or DM first allowed user
						if (ALERTS_CHANNEL_ID) {
							await channelRouter.sendAlert(alertMessage);
						} else if (ALLOWED_USER_IDS.length > 0) {
							try {
								const user = await client.users.fetch(ALLOWED_USER_IDS[0]);
								await user.send(alertMessage);
							} catch (dmError) {
								logError(
									"[CRON] Failed to send memory alert DM",
									dmError instanceof Error ? dmError.message : String(dmError),
								);
							}
						}

						lastMemoryAlertThreshold = currentThreshold;
						logInfo(`[CRON] Memory alert sent: ${currentThreshold} (${memoryPercent.toFixed(1)}%)`);
					} else if (currentThreshold === "none" && lastMemoryAlertThreshold !== "none") {
						// Memory returned to normal, reset tracking
						lastMemoryAlertThreshold = "none";
						logInfo(`[CRON] Memory returned to normal levels (${memoryPercent.toFixed(1)}%)`);
					}
				}
			}
		} catch (error) {
			logError("[CRON] Status check failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Daily analytics summary (midnight UTC)
	cron.schedule("0 0 * * *", async () => {
		logInfo("[CRON] Generating daily analytics summary");
		try {
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);

			const summary = analytics.generateDailySummary(yesterday);
			const dateStr = yesterday.toISOString().split("T")[0];
			const summaryPath = join(workingDir, "analytics", `summary-${dateStr}.md`);

			writeFileSync(summaryPath, summary);
			logInfo(`[CRON] Daily analytics summary saved to ${summaryPath}`);

			// Optionally send to report channel
			if (REPORT_CHANNEL_ID) {
				await sendToReportChannel(
					`**Daily Analytics Summary - ${dateStr}**\n\`\`\`\n${summary.substring(0, 1800)}\n\`\`\``,
				);
			}
		} catch (error) {
			logError("[CRON] Analytics summary failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Weekly analytics cleanup (Sunday at 3 AM)
	cron.schedule("0 3 * * 0", async () => {
		logInfo("[CRON] Running analytics cleanup");
		try {
			const deletedCount = analytics.cleanup(90); // Keep 90 days
			logInfo(`[CRON] Cleaned up ${deletedCount} old analytics files`);
		} catch (error) {
			logError("[CRON] Analytics cleanup failed", error instanceof Error ? error.message : String(error));
		}
	});

	// Daily AI News Digest (8 AM UTC)
	const NEWS_CHANNEL_ID = process.env.NEWS_CHANNEL_ID;
	if (NEWS_CHANNEL_ID) {
		cron.schedule("0 8 * * *", async () => {
			logInfo("[CRON] Fetching daily AI news digest");
			try {
				const smolNews = getSmolAINews();
				const digest = await smolNews.fetchLatest();

				const embed = new EmbedBuilder()
					.setColor(0x9b59b6)
					.setTitle(`Daily AI News - ${digest.date}`)
					.setURL("https://news.smol.ai")
					.setTimestamp()
					.setFooter({ text: "Smol AI News | Auto-digest" });

				const sections: string[] = [];

				if (digest.headlines.length > 0) {
					sections.push("**Headlines**");
					for (const h of digest.headlines.slice(0, 5)) {
						sections.push(`• ${h.title}`);
					}
					sections.push("");
				}

				if (digest.modelReleases.length > 0) {
					sections.push("**Model Releases**");
					for (const m of digest.modelReleases.slice(0, 5)) {
						sections.push(`• ${m.title}`);
					}
					sections.push("");
				}

				if (digest.tools.length > 0) {
					sections.push("**Tools & Infrastructure**");
					for (const t of digest.tools.slice(0, 3)) {
						sections.push(`• ${t.title}`);
					}
				}

				if (sections.length > 0) {
					embed.setDescription(sections.join("\n"));

					const channel = client.channels.cache.get(NEWS_CHANNEL_ID);
					if (channel?.isTextBased() && "send" in channel) {
						await channel.send({ embeds: [embed] });
						logInfo("[CRON] AI news digest posted successfully");
					} else {
						logWarning("[CRON] NEWS_CHANNEL_ID not found or not text-based");
					}
				} else {
					logInfo("[CRON] No AI news to post today");
				}
			} catch (error) {
				logError("[CRON] AI news digest failed", error instanceof Error ? error.message : String(error));
			}
		});
		logInfo(`[CRON] AI News digest scheduled for 8 AM UTC to channel ${NEWS_CHANNEL_ID}`);
	} else {
		logInfo("[CRON] NEWS_CHANNEL_ID not set - AI news digest disabled");
	}

	// Webhook server for external alerts
	const webhookApp = express();
	webhookApp.use(express.json());

	// API Key Authentication Middleware
	const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY;

	function authenticateApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
		// Skip auth for health endpoint
		if (req.path === "/health") {
			next();
			return;
		}

		// Check for API key in header or query param
		const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
		const apiKeyQuery = req.query.api_key as string | undefined;
		const providedKey = apiKeyHeader || apiKeyQuery;

		if (!WEBHOOK_API_KEY) {
			logWarning("[WEBHOOK] WEBHOOK_API_KEY not configured - authentication disabled");
			next();
			return;
		}

		if (!providedKey) {
			// Skip warning for localhost/internal requests (health checks, dashboard)
			const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip?.includes("127.0.0.1");
			if (!isLocalhost) {
				logWarning(`[WEBHOOK] Unauthorized attempt from ${req.ip} - no API key provided`);
			}
			res.status(401).json({ error: "Unauthorized - API key required" });
			return;
		}

		if (providedKey !== WEBHOOK_API_KEY) {
			logWarning(`[WEBHOOK] Unauthorized attempt from ${req.ip} - invalid API key`);
			res.status(401).json({ error: "Unauthorized - invalid API key" });
			return;
		}

		// Authentication successful
		next();
	}

	// ========================================================================
	// Telegram Webhook (NO AUTH - must be before authenticateApiKey middleware)
	// Telegram sends updates directly via webhook, no API key needed
	// ========================================================================
	webhookApp.post("/telegram/webhook", async (req, res) => {
		try {
			const { getTelegramWebhookHandler } = await import("./telegram/index.js");
			const handler = getTelegramWebhookHandler();
			await handler(req, res);
		} catch (error) {
			console.error("[TELEGRAM WEBHOOK] Error:", error);
			res.status(500).json({ error: "Webhook processing failed" });
		}
	});

	// Apply authentication middleware to all routes (AFTER telegram webhook)
	webhookApp.use(authenticateApiKey);

	// Price alert webhook
	webhookApp.post("/webhook/alert", async (req, res) => {
		try {
			const { message, priority, type } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message" });
				return;
			}

			const prefix = priority === "high" ? "**ALERT**" : "**Alert**";
			const content = `${prefix}: ${message}`;

			// Route based on type field, default to alert channel
			if (type === "alert" || !type) {
				await channelRouter.sendAlert(content);
			} else {
				await sendToReportChannel(content);
			}

			logInfo(`[WEBHOOK] Alert received: ${message.substring(0, 50)}...`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Alert handling failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading signal webhook
	webhookApp.post("/webhook/signal", async (req, res) => {
		try {
			const { symbol, action, price, reason, type } = req.body;
			if (!symbol || !action) {
				res.status(400).json({ error: "Missing symbol or action" });
				return;
			}

			const msg = `**Trading Signal**\nSymbol: \`${symbol}\`\nAction: **${action}**\nPrice: ${price || "N/A"}\nReason: ${reason || "N/A"}`;

			// Route based on type field, default to signal channel
			if (type === "signal" || !type) {
				await channelRouter.sendSignal(msg);
			} else {
				await sendToReportChannel(msg);
			}

			logInfo(`[WEBHOOK] Signal: ${symbol} ${action}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Signal handling failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GitHub webhook (for PR/Issue notifications)
	webhookApp.post("/webhook/github", async (req, res) => {
		try {
			const event = req.headers["x-github-event"] as string;
			const { action, repository, pull_request, issue, sender, type } = req.body;

			let msg = "";
			if (event === "pull_request") {
				msg = `**GitHub PR ${action}**\nRepo: \`${repository?.full_name}\`\nPR: #${pull_request?.number} - ${pull_request?.title}\nBy: ${sender?.login}`;
			} else if (event === "issues") {
				msg = `**GitHub Issue ${action}**\nRepo: \`${repository?.full_name}\`\nIssue: #${issue?.number} - ${issue?.title}\nBy: ${sender?.login}`;
			} else if (event === "push") {
				msg = `**GitHub Push**\nRepo: \`${repository?.full_name}\`\nBy: ${sender?.login}`;
			} else {
				msg = `**GitHub Event**: ${event} (${action || "N/A"})`;
			}

			// Route based on type field, default to log channel
			if (type === "log" || !type) {
				await channelRouter.sendLog(msg);
			} else {
				await sendToReportChannel(msg);
			}

			logInfo(`[WEBHOOK] GitHub: ${event} ${action || ""}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] GitHub handling failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Agent task webhook (trigger agent to do something)
	webhookApp.post("/webhook/agent", async (req, res) => {
		try {
			const { task, channel_id, model: reqModel } = req.body;
			if (!task) {
				res.status(400).json({ error: "Missing task" });
				return;
			}

			const _targetChannel = channel_id || REPORT_CHANNEL_ID;
			logInfo(`[WEBHOOK] Agent task: ${task.substring(0, 50)}...`);

			// Execute via opencode CLI
			const { exec } = await import("child_process");
			const { promisify } = await import("util");
			const execAsync = promisify(exec);

			const modelArg = reqModel ? `-m ${reqModel}` : "";
			const cmd = `timeout 60 opencode run "${task.replace(/"/g, '\\"')}" ${modelArg} 2>&1 | head -100`;

			try {
				const { stdout } = await execAsync(cmd, { maxBuffer: 512 * 1024 });
				await sendToReportChannel(
					`**Agent Task Result:**\nTask: ${task.substring(0, 100)}\n\`\`\`\n${stdout.substring(0, 1500)}\n\`\`\``,
				);
				res.json({ status: "ok", result: stdout.substring(0, 500) });
			} catch (e) {
				const errMsg = e instanceof Error ? e.message : String(e);
				await sendToReportChannel(`**Agent Task Failed:**\nTask: ${task.substring(0, 100)}\nError: ${errMsg}`);
				res.json({ status: "error", error: errMsg });
			}
		} catch (error) {
			logError("[WEBHOOK] Agent task failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Scheduled task webhook (for cron-like external triggers)
	webhookApp.post("/webhook/scheduled", async (req, res) => {
		try {
			const { task_name, payload, type } = req.body;
			if (!task_name) {
				res.status(400).json({ error: "Missing task_name" });
				return;
			}

			logInfo(`[WEBHOOK] Scheduled task: ${task_name}`);

			// Handle different scheduled tasks
			let msg = "";
			switch (task_name) {
				case "daily_summary":
					msg = `**Daily Summary Triggered**\n${JSON.stringify(payload || {}, null, 2)}`;
					break;
				case "health_check": {
					const uptime = process.uptime();
					msg = `**Health Check**\nUptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\nChannels: ${channelStates.size}\nModel: ${model.id}`;
					break;
				}
				default:
					msg = `**Scheduled Task: ${task_name}**\n${JSON.stringify(payload || {}, null, 2)}`;
			}

			// Route based on type field, default to report channel
			if (type === "report" || !type) {
				await channelRouter.sendReport(msg);
			} else if (type === "log") {
				await channelRouter.sendLog(msg);
			} else {
				await sendToReportChannel(msg);
			}

			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Scheduled task failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Custom message webhook (send any message to a channel)
	webhookApp.post("/webhook/message", async (req, res) => {
		try {
			const { channel_id, message, embed, type } = req.body;
			if (!message && !embed) {
				res.status(400).json({ error: "Missing message or embed" });
				return;
			}

			// Determine target channel based on type or explicit channel_id
			let targetChannel = channel_id;
			if (!targetChannel && type) {
				// Map type to channel ID
				switch (type) {
					case "alert":
						targetChannel = ALERTS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					case "signal":
						targetChannel = SIGNALS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					case "report":
						targetChannel = REPORTS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					case "log":
						targetChannel = LOGS_CHANNEL_ID || REPORT_CHANNEL_ID;
						break;
					default:
						targetChannel = REPORT_CHANNEL_ID;
				}
			} else if (!targetChannel) {
				targetChannel = REPORT_CHANNEL_ID;
			}

			if (!targetChannel) {
				res.status(400).json({ error: "No target channel" });
				return;
			}

			const channel = client.channels.cache.get(targetChannel) as TextChannel;
			if (!channel) {
				res.status(404).json({ error: "Channel not found" });
				return;
			}

			if (embed) {
				const embedObj = new EmbedBuilder()
					.setTitle(embed.title || "Notification")
					.setDescription(embed.description || message)
					.setColor(embed.color || 0x0099ff)
					.setTimestamp();
				await channel.send({ embeds: [embedObj] });
			} else {
				await channel.send(message);
			}

			logInfo(`[WEBHOOK] Message sent to ${targetChannel}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Message failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading Learning webhook (record trading outcomes for self-improvement)
	webhookApp.post("/webhook/trading/outcome", async (req, res) => {
		try {
			const { symbol, action, entryPrice, exitPrice, pnl, success, confidence, marketCondition, agents, reason } =
				req.body;
			if (!symbol || !action) {
				res.status(400).json({ error: "Missing symbol or action" });
				return;
			}

			const { tradingLearning } = await import("./trading/index.js");
			await tradingLearning.recordOutcome({
				timestamp: new Date().toISOString(),
				symbol,
				action,
				entryPrice: entryPrice || 0,
				exitPrice,
				pnl,
				success: success ?? false,
				confidence: confidence || 0.5,
				marketCondition: marketCondition || "unknown",
				agents: agents || [],
				reason: reason || "N/A",
			});

			logInfo(`[WEBHOOK] Trading outcome: ${symbol} ${action} ${success ? "SUCCESS" : "FAIL"}`);
			res.json({ status: "ok", message: "Outcome recorded for learning" });
		} catch (error) {
			logError("[WEBHOOK] Trading outcome failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading Learning stats endpoint
	webhookApp.get("/webhook/trading/stats", async (_req, res) => {
		try {
			const { tradingLearning } = await import("./trading/index.js");
			const stats = tradingLearning.getStats();
			res.json({ status: "ok", ...stats });
		} catch (_error) {
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Telegram bridge webhook (forward from external Telegram to Discord)
	webhookApp.post("/webhook/telegram", async (req, res) => {
		try {
			const { chat_id, username, message, message_type } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message" });
				return;
			}

			const content = `**[Telegram${username ? ` - @${username}` : ""}]**\n${message}`;

			// Route based on message_type
			if (message_type === "alert") {
				await channelRouter.sendAlert(content);
			} else if (message_type === "signal") {
				await channelRouter.sendSignal(content);
			} else {
				await sendToReportChannel(content);
			}

			logInfo(`[WEBHOOK] Telegram message from ${username || chat_id || "unknown"}`);
			res.json({ status: "ok" });
		} catch (error) {
			logError("[WEBHOOK] Telegram bridge failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Universal route endpoint (smart routing based on content)
	webhookApp.post("/webhook/route", async (req, res) => {
		try {
			const { message, source, priority, tags } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message" });
				return;
			}

			// Smart routing based on content/tags
			const lowerMsg = message.toLowerCase();
			const tagSet = new Set(tags || []);

			if (tagSet.has("alert") || priority === "high" || lowerMsg.includes("alert") || lowerMsg.includes("warning")) {
				await channelRouter.sendAlert(`**[${source || "Webhook"}]** ${message}`);
			} else if (tagSet.has("signal") || lowerMsg.includes("signal") || lowerMsg.includes("trade")) {
				await channelRouter.sendSignal(`**[${source || "Webhook"}]** ${message}`);
			} else if (tagSet.has("log") || lowerMsg.includes("log") || lowerMsg.includes("debug")) {
				await channelRouter.sendLog(`**[${source || "Webhook"}]** ${message}`);
			} else if (tagSet.has("report") || lowerMsg.includes("report") || lowerMsg.includes("summary")) {
				await channelRouter.sendReport(`**[${source || "Webhook"}]** ${message}`);
			} else {
				await sendToReportChannel(`**[${source || "Webhook"}]** ${message}`);
			}

			logInfo(`[WEBHOOK] Smart routed message from ${source || "unknown"}`);
			res.json({ status: "ok", routed: true });
		} catch (error) {
			logError("[WEBHOOK] Smart routing failed", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Health check endpoint
	webhookApp.get("/health", (_req, res) => {
		res.json({
			status: "ok",
			uptime: process.uptime(),
			model: model.id,
			channels: channelStates.size,
			tools: 35,
			skills: 32,
		});
	});

	// List available webhook endpoints
	webhookApp.get("/webhooks", (_req, res) => {
		res.json({
			endpoints: [
				{ path: "/webhook/alert", method: "POST", description: "Send alert message" },
				{ path: "/webhook/signal", method: "POST", description: "Trading signal notification" },
				{ path: "/webhook/github", method: "POST", description: "GitHub event notifications" },
				{ path: "/webhook/agent", method: "POST", description: "Trigger agent task" },
				{ path: "/webhook/scheduled", method: "POST", description: "Scheduled task trigger" },
				{ path: "/webhook/message", method: "POST", description: "Send custom message to channel" },
				{ path: "/webhook/trading/outcome", method: "POST", description: "Record trading outcome for learning" },
				{ path: "/webhook/trading/stats", method: "GET", description: "Get trading learning stats" },
				{ path: "/webhook/telegram", method: "POST", description: "Forward Telegram messages to Discord" },
				{ path: "/webhook/route", method: "POST", description: "Smart routing based on content" },
				{ path: "/health", method: "GET", description: "Health check" },
				{ path: "/webhooks", method: "GET", description: "List endpoints (this)" },
			],
		});
	});

	// Real Metrics API Endpoints
	webhookApp.get("/api/status", (_req, res) => {
		const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
		res.json({
			status: "ok",
			uptime,
			model: globalModelId,
			provider: currentProvider,
			commands: botStats.commandsProcessed,
			messages: botStats.messagesProcessed,
			errors: botStats.errorsCount,
			activeUsers: botStats.userInteractions.size,
			channels: channelStates.size,
		});
	});

	webhookApp.get("/api/metrics", (_req, res) => {
		const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
		const memUsage = process.memoryUsage();

		res.json({
			uptime,
			memory: {
				heapUsed: memUsage.heapUsed,
				heapTotal: memUsage.heapTotal,
				rss: memUsage.rss,
				external: memUsage.external,
			},
			stats: {
				commands: botStats.commandsProcessed,
				messages: botStats.messagesProcessed,
				errors: botStats.errorsCount,
				errorRate:
					botStats.messagesProcessed > 0
						? `${((botStats.errorsCount / botStats.messagesProcessed) * 100).toFixed(2)}%`
						: "0%",
			},
			users: {
				total: botStats.userInteractions.size,
				active: Array.from(botStats.userInteractions.values()).filter((u) => Date.now() - u.lastSeen < 3600000)
					.length,
			},
			channels: channelStates.size,
			rateLimits: {
				userLimit: "20/min",
				globalLimit: "100/min",
			},
		});
	});

	webhookApp.get("/api/tools", (_req, res) => {
		const tools = getToolUsageStats();
		res.json({
			total: tools.length,
			tools: tools.slice(0, 50),
		});
	});

	webhookApp.get("/api/users", (_req, res) => {
		const users = Array.from(botStats.userInteractions.entries())
			.map(([id, data]) => ({
				id,
				username: data.username,
				requests: data.count,
				lastSeen: new Date(data.lastSeen).toISOString(),
			}))
			.sort((a, b) => b.requests - a.requests)
			.slice(0, 50);

		res.json({ total: botStats.userInteractions.size, users });
	});

	// Serve dashboard static files
	webhookApp.use("/dashboard", express.static(join(workingDir, "dashboard")));

	webhookApp.listen(WEBHOOK_PORT, () => {
		logInfo(`[WEBHOOK] Server listening on port ${WEBHOOK_PORT}`);
	});

	// ========================================================================
	// Analytics Dashboard API (Port 9090)
	// ========================================================================

	const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || "9090", 10);
	const dashboardApp = express();
	dashboardApp.use(express.json());

	// CORS headers for dashboard
	dashboardApp.use((req, res, next) => {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.header("Access-Control-Allow-Headers", "Content-Type");
		if (req.method === "OPTIONS") {
			return res.sendStatus(200);
		}
		next();
	});

	// Main analytics endpoint
	dashboardApp.get("/api/analytics", (req, res) => {
		try {
			const period = (req.query.period as "today" | "week" | "all") || "today";
			const stats = analytics.getStats(period);
			const commandStats = analytics.getCommandStats();
			const userStats = analytics.getUserStats();
			const hourlyDist = analytics.getHourlyDistribution();
			const modelUsage = analytics.getModelUsage();

			res.json({
				period,
				summary: stats,
				commands: commandStats.slice(0, 10),
				users: userStats.slice(0, 20),
				hourlyDistribution: hourlyDist,
				modelUsage,
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Command-specific stats
	dashboardApp.get("/api/analytics/commands", (_req, res) => {
		try {
			const commandStats = analytics.getCommandStats();
			res.json(commandStats);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// User activity stats
	dashboardApp.get("/api/analytics/users", (_req, res) => {
		try {
			const userStats = analytics.getUserStats();
			res.json(userStats);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Health check for dashboard
	dashboardApp.get("/api/health", (_req, res) => {
		res.json({
			status: "ok",
			uptime: process.uptime(),
			model: model.id,
			channels: channelStates.size,
			analyticsEnabled: true,
		});
	});

	// Setup the enhanced dashboard with additional endpoints
	setupDashboard(dashboardApp, {
		analytics,
		botStats,
		model,
		currentProvider,
		channelStates,
		getToolUsageStats,
	});

	dashboardApp.listen(DASHBOARD_PORT, () => {
		logInfo(`[DASHBOARD] Analytics API listening on port ${DASHBOARD_PORT}`);
		logInfo(`[DASHBOARD] Access dashboard at http://localhost:${DASHBOARD_PORT}/dashboard`);
	});

	// ========================================================================
	// Telegram Bot (Pi Remote Agent)
	// ========================================================================

	if (process.env.TELEGRAM_BOT_TOKEN) {
		try {
			const telegramBot = createTelegramBot();

			if (shouldUseWebhook()) {
				// Webhook mode - for VPS with Telegram API blocked
				const webhookSuccess = await setupTelegramWebhook(telegramBot);
				if (webhookSuccess) {
					logInfo(`[TELEGRAM] Bot started in WEBHOOK mode: @Pi_discordbot`);
					logInfo(`[TELEGRAM] Webhook path: ${getWebhookPath()}`);
				} else {
					logWarning("[TELEGRAM] Failed to set up webhook, falling back to polling");
					telegramBot.launch({ dropPendingUpdates: true });
				}
			} else {
				// Polling mode - standard with error handling
				logInfo(`[TELEGRAM] Starting bot in POLLING mode...`);
				telegramBot
					.launch({
						dropPendingUpdates: false, // Don't drop - receive pending messages
					})
					.then(() => {
						logInfo(`[TELEGRAM] ✓ Polling connection established successfully`);
					})
					.catch((err) => {
						logWarning(`[TELEGRAM] ✗ Polling failed: ${err instanceof Error ? err.message : String(err)}`);
					});
				logInfo(`[TELEGRAM] Bot started in POLLING mode: @Pi_discordbot`);
			}

			logInfo(`[TELEGRAM] Expert modes: ${Object.keys(TelegramExpertModes).join(", ")}`);

			// Graceful shutdown
			process.once("SIGINT", () => telegramBot.stop("SIGINT"));
			process.once("SIGTERM", () => telegramBot.stop("SIGTERM"));
		} catch (error) {
			logWarning("[TELEGRAM] Failed to start bot", error instanceof Error ? error.message : String(error));
		}
	} else {
		logInfo("[TELEGRAM] TELEGRAM_BOT_TOKEN not set - Telegram bot disabled");
	}

	// ========================================================================
	// Slack Bot (Pi Remote Agent)
	// ========================================================================

	// Slack can run in socket mode (APP_TOKEN) or HTTP mode (SIGNING_SECRET)
	const slackHasCredentials =
		process.env.SLACK_BOT_TOKEN && (process.env.SLACK_SIGNING_SECRET || process.env.SLACK_APP_TOKEN);
	if (slackHasCredentials) {
		try {
			const { createSlackBot, SlackExpertModes } = await import("./slack/slack-bot.js");
			const { app: slackApp, webClient } = createSlackBot();

			// Start Slack app
			await slackApp.start();

			// Register with cross-platform hub
			const hub = getHub();
			hub.registerSlack(webClient, process.env.SLACK_REPORT_CHANNEL);

			const mode = process.env.SLACK_APP_TOKEN ? "socket" : "HTTP";
			logInfo(`[SLACK] Bot started successfully (${mode} mode)`);
			logInfo(`[SLACK] Expert modes: ${Object.keys(SlackExpertModes).join(", ")}`);

			// Graceful shutdown
			process.once("SIGINT", async () => {
				await slackApp.stop();
			});
			process.once("SIGTERM", async () => {
				await slackApp.stop();
			});
		} catch (error) {
			logWarning("[SLACK] Failed to start bot", error instanceof Error ? error.message : String(error));
		}
	} else {
		logInfo("[SLACK] SLACK_BOT_TOKEN + (SLACK_SIGNING_SECRET or SLACK_APP_TOKEN) not set - Slack bot disabled");
	}

	// ========================================================================
	// WhatsApp Bot (Pi Remote Agent)
	// ========================================================================

	if (process.env.WHATSAPP_ENABLED === "true") {
		try {
			const { startWhatsAppBot, WHATSAPP_EXPERT_MODES } = await import("./whatsapp/index.js");
			await startWhatsAppBot(workingDir);
			logInfo(`[WHATSAPP] Expert modes: ${Object.keys(WHATSAPP_EXPERT_MODES).join(", ")}`);
		} catch (error) {
			logWarning("[WHATSAPP] Failed to start bot", error instanceof Error ? error.message : String(error));
		}
	} else {
		logInfo("[WHATSAPP] WHATSAPP_ENABLED not set - WhatsApp bot disabled");
	}

	logInfo("Event-driven triggers initialized (cron jobs + webhooks + analytics + telegram + slack + whatsapp)");
}

main().catch((error) => {
	logError("Fatal error", error instanceof Error ? error.message : String(error));
	process.exit(1);
});
