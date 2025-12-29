/**
 * Agents Module
 * Lightweight agent (pi-agent-core), OpenHands SDK, Claude SDK, and Agent Experts system
 *
 * TAC Lesson 13: Agent Experts - Act-Learn-Reuse Pattern
 * "The massive problem with agents is they forget - Agent Experts solve this"
 *
 * Includes pi-coding-agent compatible hooks:
 * - Checkpoint Hook: Git-based state checkpointing
 * - LSP Hook: Language Server Protocol diagnostics
 * - Expert Hook: Act-Learn-Reuse integration
 */

// Agent Dialogue - Multi-Agent Discussion Before Action (AgentLaboratory Pattern)
export {
	createDialogueEngine,
	DEFAULT_DIALOGUE_AGENTS,
	type DialogueAgent,
	type DialogueConfig,
	DialogueEngine,
	type DialogueMessage,
	type DialogueRole,
	type DialogueRound,
	type DialogueSession,
	runDialogue,
	runTradingDialogue,
	TRADING_DIALOGUE_AGENTS,
} from "./agent-dialogue.js";
// Agent Experts - Advanced TAC Lesson 13 (Codebase Experts, Meta-Agentics)
export {
	CODEBASE_EXPERTS,
	createCodebaseExpert,
	detectExpertDomain,
	executeWithAutoExpert,
	executeWithExpert,
	generateSelfImprovePrompt,
	getExpert,
	loadExpertConfig,
	META_PROMPT_TEMPLATE,
	PRODUCT_EXPERTS,
} from "./agent-experts.js";
// Agent Mail MCP Server - Expose messaging via MCP protocol
export {
	type AgentMailMCPOptions,
	createAgentMailMCPServer,
	runAgentMailMCPServer,
} from "./agent-mail-mcp.js";
// Agent-to-Agent Messaging System (Enhanced with MCP Agent Mail patterns)
export {
	type AgentInfo,
	type AgentMessage,
	AgentMessageBus,
	type BroadcastResult,
	type ContactPolicy,
	type ContactRequest,
	createAgentMessagingTools,
	disposeAgentMessageBus,
	type EnhancedAgentMessage,
	getAgentMessageBus,
	type MessageAttachment,
	type MessageImportance,
	type MessageRecipient,
	type MessageResult,
	type RecipientType,
	type ThreadSummary,
} from "./agent-messaging.js";
// Agent Persona - Structured Personality System (learned from Agentis Framework)
export {
	type AgentGoal,
	type AgentPersona,
	type CommunicationStyle,
	createPersona,
	generatePersonaPrompt,
	getPersona,
	getPersonaManager,
	type PersonalityTraits,
	PersonaManager,
	PRESET_PERSONAS,
	TRAIT_PRESETS,
} from "./agent-persona.js";
// TAC-12 Agent Pool Segregation & Orchestration
export {
	type AgentCostRecord,
	AgentPoolManager,
	type AgentPoolStats,
	type AgentRegistration,
	type AgentRole,
	type AgentTask,
	createOrchestrationController,
	createTradingAgentPool,
	getAgentPool,
	OrchestrationController,
	OrchestrationMode,
	type TradingAgentRole,
} from "./agent-pool.js";
// Agent Reviewer - Multi-Persona Review System (AgentLaboratory Pattern)
export {
	type AggregatedReview,
	createReviewerEngine,
	DEFAULT_REVIEWERS,
	peerReview,
	quickReview,
	type Review,
	type ReviewConfig,
	type Reviewer,
	ReviewerEngine,
	type ReviewerPersona,
	reviewTradingStrategy,
	TRADING_REVIEWERS,
} from "./agent-reviewer.js";
// Agent Swarm - Multi-Agent Coordination System (learned from Agentis Framework)
export {
	type ConsensusProposal,
	type ConsensusResult,
	type ConsensusStrategy,
	type ConsensusVote,
	createConsensusProposal,
	createSwarmAgent,
	createSwarmCoordinator,
	createTaskRequest,
	getSwarmCoordinator,
	type MessagePriority,
	type SwarmAgent,
	type SwarmConfig,
	SwarmCoordinator,
	type SwarmMessage,
	type SwarmMessageType,
	type SwarmRole,
	type TaskRequest,
	type TaskResponse,
} from "./agent-swarm.js";
// Agentic Properties - IndyDevDan's 6 Agentic Properties Framework
export {
	// Property Types
	type AgentDomain,
	// Core Agent Class
	AgenticAgent,
	AgenticPresets,
	type AgenticProperties,
	type AgenticPropertiesConfig,
	type AgentReplica,
	type AgentState as AgenticAgentState,
	// Alignment
	type AlignmentEvaluation,
	// Autonomy
	AutonomyController,
	type AutonomyDecision,
	// Factory Functions
	createCodingAgent,
	createResearchAgent,
	createSecurityAgent,
	createTradingAgent,
	type DurabilityCheckpoint,
	// Durability
	DurabilityController,
	type EvaluationResult,
	evaluateAlignment,
	filterToJustBashTools,
	// GOAT Tool Filters (Mario, Vercel)
	filterToMinimalistTools,
	// Self-Improvement
	type LearningRecord,
	// Self-Organization
	type OptimizationAction,
	type OrganizationMetrics,
	// Property Level
	type PropertyLevel,
	// Self-Replication
	type ReplicaConfig,
	SelfImprovementController,
	SelfOrganizationController,
	SelfReplicationController,
} from "./agentic-properties.js";
// AIRIS-Inspired Causal Reasoning - ASI Alliance proto-AGI concepts
export {
	type CausalAction,
	type CausalEngineConfig,
	type CausalHypothesis,
	type CausalLink,
	CausalReasoningEngine,
	createCausalTools,
	DEFAULT_CAUSAL_CONFIG,
	getCausalEngine,
	getTradingCausalEngine,
	type Prediction,
	resetCausalEngine,
	StateGraph,
	TradingCausalEngine,
	type WorldState,
} from "./airis-causal.js";
// Aitmpl Adapter - aitmpl.com Claude Code templates platform
export {
	AITMPL_PLATFORMS,
	AitmplClient,
	type AitmplComponent,
	type AitmplConfig,
	AnalyticsTracker,
	type ComponentType,
	getAitmplClient,
	HealthChecker,
	type HealthCheckResult,
	initAitmpl,
	type PerformanceReport,
	type PlatformIntegration,
	type Plugin,
	PluginManager,
	TemplateRegistry,
} from "./aitmpl-adapter.js";
// Anomaly Detection Service - Market Manipulation Detection (inspired by ANG13T/DroneXtract)
export {
	type AnomalyConfig,
	AnomalyDetector,
	AnomalyDetectorPresets,
	type AnomalyResult,
	AnomalySeverity,
	AnomalyType,
	type DataPoint,
	type DataStatistics,
	DEFAULT_ANOMALY_CONFIG,
	getAnomalyDetector,
	type IntegrityReport,
} from "./anomaly-detector.js";
// ARC-AGI DSPy Evolution Agent (GEPA + Student-Teacher paradigm)
export {
	type ARCEvaluationResult,
	type ARCEvolutionConfig,
	type ARCEvolutionResult,
	ARCEvolvePresets,
	type ARCTask,
	benchmarkARCSeeds,
	DeepSeekModels,
	DefaultModels,
	evaluateARCProgram,
	evolveARCSolver,
	GeminiModels,
	getARCAgentStatus,
	isARCAgentAvailable,
	loadBestProgram,
	quickARCEvolve,
	saveBestProgram,
	standardARCEvolve,
} from "./arc-agi-agent.js";
// Archival Memory - Long-Term Storage with Semantic Search
export {
	type ArchivalEntry,
	ArchivalMemory,
	type ArchivalSearchResult,
	createArchivalTools,
	disposeArchivalMemory,
	type EmbeddingProvider,
	getArchivalMemory,
	LocalTFIDFEmbedding,
	OpenAIEmbedding,
} from "./archival-memory.js";
// Autonomous Daemon - Self-running agentic system (24/7 autonomy)
export {
	AutonomousDaemon,
	type CycleResult,
	type DaemonConfig,
	type DaemonEvent,
	DaemonPresets,
	type DaemonState,
	getAutonomousDaemon,
	getDaemonStatus,
	startDaemon,
	stopDaemon,
} from "./autonomous-daemon.js";
// Browser-Use Adapter - browser-use/browser-use AI browser agent
export {
	ActionRecognizer,
	type AgentStep,
	type AgentTask as BrowserAgentTask,
	BrowserAgent,
	BrowserUseClient,
	type BrowserUseConfig,
	createSandboxedRunner,
	DataExtractor,
	type ExtractedData,
	getBrowserUseClient,
	initBrowserUse,
	type SandboxConfig as BrowserSandboxConfig,
	SandboxManager,
	type SandboxSession,
} from "./browser-use-adapter.js";
// Claude Agent SDK - Official Anthropic CLI Framework
export {
	CLAUDE_MODELS,
	ClaudeAgentPresets,
	type ClaudeCLIOptions,
	type ClaudeCLIResult,
	getClaudeVersion,
	isClaudeAgentAvailable,
	runClaudeAgent,
} from "./claude-agent-sdk.js";
// Claude-Flow Adapter - ruvnet/claude-flow enterprise AI orchestration
export {
	AgentDB,
	CLAUDE_FLOW_SKILLS,
	ClaudeFlowClient,
	type ClaudeFlowConfig,
	type ClaudeSkill,
	getClaudeFlowClient,
	type HiveAgent,
	HiveMind,
	type HiveMindConfig,
	type HiveResult,
	type HiveRole,
	type HiveTask,
	initClaudeFlow,
	type Memory,
	type MemoryQuery,
	SkillActivator,
	type VectorSearchOptions,
	type VectorSearchResult,
} from "./claude-flow-adapter.js";
// Claude-Mem Adapter - thedotmack/claude-mem persistent memory compression
export {
	ClaudeMemClient,
	type ClaudeMemConfig,
	type ContextConfig,
	type DisclosureLevel,
	getClaudeMemClient,
	initClaudeMem,
	type LayeredMemory,
	MemoryCompressor,
	type MemoryQuery as ClaudeMemQuery,
	type MemoryResult,
	MemorySearch,
	type Observation,
	type ProgressiveDisclosureConfig,
	type Session,
} from "./claude-mem-adapter.js";
// Claude SDK Agent - Two-Agent Pattern (Initializer + Coding)
export {
	type ClaudeAgentOptions,
	type ClaudeAgentResult,
	executeNextFeature as executeClaudeFeature,
	type FeatureSpec,
	getTaskStatus as getClaudeTaskStatus,
	initializeTask as initializeClaudeTask,
	isClaudeSDKAvailable,
	loadTaskSpec as loadClaudeTaskSpec,
	resumeTask as resumeClaudeTask,
	runTwoAgentWorkflow,
	type TaskSpec as ClaudeTaskSpec,
} from "./claude-sdk-agent.js";
// Context Compression - Intelligent Context Window Management
export {
	type CompressedContext,
	type CompressionConfig,
	type ContextItem,
	ContextManager,
	createContextManager,
	createContextTools,
	DEFAULT_COMPRESSION_CONFIG,
	estimateItemTokens,
	estimateTokens,
	estimateTotalTokens,
	type SummarizationResult,
} from "./context-compression.js";
// Continuous-Claude Adapter - parcadei/Continuous-Claude session continuity
export {
	type ArtifactEntry,
	type BraintrustSpan,
	type ContinuityLedger,
	ContinuousClaudeClient,
	type ContinuousClaudeConfig,
	getContinuousClaudeClient,
	type Handoff,
	HandoffManager,
	type HandoffOutcome,
	type HandoffQuery,
	initContinuousClaude,
	LedgerManager,
	type LedgerUpdate,
	type ReasoningEntry,
	ReasoningHistory,
	type SessionLearning,
	type SessionTrace,
	SessionTracer,
} from "./continuous-claude-adapter.js";
// Conversation Memory - Full-Text Search with FTS5
export {
	ConversationMemory,
	type ConversationMessage,
	createConversationTools,
	disposeConversationMemory,
	getConversationMemory,
	type RecallOptions,
	type SearchResult as ConversationSearchResult,
	type TimeRange,
} from "./conversation-memory.js";
// Cross-Platform Swarm - Unified multi-agent coordination across Discord, Slack, Telegram, WhatsApp
export {
	broadcastToAllPlatforms,
	CrossPlatformSwarm,
	type CrossPlatformSwarmConfig,
	type CrossPlatformTask,
	createPlatformAgent,
	createPlatformAgentSet,
	getCrossPlatformSwarm,
	type PlatformAgent,
	type SwarmExecutionResult,
	type SwarmPlatform,
	submitCrossPlatformTask,
} from "./cross-platform-swarm.js";
// CTM - Continuous Thought Machine (Extended Reasoning)
export {
	type CTMDomain,
	CTMPresets,
	type CTMResult,
	type CTMStatus,
	type CTMTask,
	type CTMThoughtTrace,
	deepThink,
	getCTMStatus,
	getThinkingTrace,
	isCTMAvailable,
	listThinkingTasks,
	quickThink,
	researchThink,
	think,
} from "./ctm-agent.js";
// Dependency Inference - NLP-based Task Dependency Detection (learned from Agentis Framework)
export {
	createDependencyInference,
	DependencyInference,
	type DependencyLink,
	type InferenceConfig,
	type InferenceResult,
	type InferenceTask,
	inferTaskDependencies,
	type TaskType as InferenceTaskType,
} from "./dependency-inference.js";
// Dev-Browser Adapter - SawyerHood/dev-browser browser automation
export {
	type BrowserAction,
	type BrowserActionResult,
	type BrowserPage,
	type BrowserScript,
	BrowserSessionManager,
	DevBrowserClient,
	type DevBrowserConfig,
	type DOMSnapshot,
	DOMSnapshotGenerator,
	getDevBrowserClient,
	initDevBrowser,
	ScriptExecutor,
} from "./dev-browser-adapter.js";
// DGM - Darwin Gödel Machine (Self-Improving AI)
export {
	type DGMConstraints,
	type DGMModification,
	DGMPresets,
	type DGMResult,
	type DGMStatus,
	type DGMTarget,
	getDGMStatus,
	getImprovementHistory,
	improve,
	improveAgentExpertise,
	isDGMAvailable,
	quickImprove,
} from "./dgm-agent.js";
// E2B Sandbox - Isolated Code Execution Environments
export {
	E2BSandboxService,
	type ExecOptions,
	getE2BSandboxService,
	isE2BAvailable,
	runInSandbox,
	type SandboxConfig,
	type SandboxResult,
	type SandboxTemplate,
} from "./e2b-sandbox.js";
// Vector Embeddings - Text-to-Vector Transformation
export {
	cosineSimilarity,
	disposeEmbedder,
	generateEmbedding,
	generateEmbeddingsBatch,
	getEmbedder,
} from "./embeddings.js";
// Agent Experts - Act-Learn-Reuse System (Basic)
export {
	actLearnReuse,
	createLearningPrompt,
	type ExpertiseConfig,
	extractLearnings,
	getExpertiseModes,
	getExpertisePath,
	type LearningResult,
	loadExpertise,
	SELF_IMPROVE_PROMPTS,
	updateExpertise,
} from "./expertise-manager.js";
// File Reservations - Advisory Leases for Multi-Agent Coordination
export {
	createFileReservationTools,
	disposeFileReservationManager,
	type FileReservation,
	FileReservationManager,
	getFileReservationManager,
	type ReservationConflict,
	type ReservationQuery,
	type ReservationResult,
} from "./file-reservations.js";
// Generator-Critic Pattern - Code Quality (GLM-4.7 Dec 2025 Upgrade)
export {
	type CriticFn,
	type CritiqueIssue,
	type CritiqueResult,
	createCodeCritic,
	createCodeGenerator,
	createSignalGenerator,
	createSQLCritic,
	createSQLGenerator,
	createTradingSignalCritic,
	type GenerationResult,
	GeneratorCritic,
	type GeneratorFn,
	type RefinerFn,
	type TradingSignal as CriticTradingSignal,
} from "./generator-critic.js";
// Genetic Algorithm Optimizer - Trading Strategy Evolution (inspired by ANG13T/url_genie)
export {
	type BacktestFunction,
	type BacktestResult as GABacktestResult,
	type CrossoverFunction,
	createTradingFitnessFunction,
	createTradingOptimizer,
	crossoverPromptGenes,
	crossoverTradingGenes,
	DEFAULT_GENETIC_CONFIG,
	type EvolutionResult,
	type FitnessFunction,
	type GenerationStats,
	type GeneticConfig,
	GeneticOptimizer,
	GeneticOptimizerPresets,
	type Individual,
	type InitializerFunction,
	initializePromptGenes,
	initializeTradingGenes,
	type MutationFunction,
	mutatePromptGenes,
	mutateTradingGenes,
	type PromptGenes,
	type TradingStrategyGenes,
} from "./genetic-optimizer.js";
// GEPA - Reflective Prompt Evolution (Genetic-Pareto Optimizer)
export {
	evaluatePrompt,
	type GEPAAgentType,
	type GEPAEvaluateOptions,
	type GEPAEvaluateResult,
	type GEPAExample,
	type GEPAOptimizeOptions,
	type GEPAOptimizeResult,
	GEPAPresets,
	type GEPAStatus,
	generateCodingExamples,
	generateSecurityExamples,
	generateTradingExamples,
	getExpertiseDomains,
	getGEPAStatus,
	isGEPAAvailable,
	loadExpertisePrompt,
	optimizeExpertise,
	optimizePrompt,
	runGEPA,
} from "./gepa-agent.js";
// History Capture - Universal Output Capture System (UOCS)
export {
	type CaptureType,
	getHistoryCaptureService,
	HistoryCaptureService,
	type HistoryEntry,
	resetHistoryCaptureService,
} from "./history-capture.js";
// Agent Hooks - pi-coding-agent compatible (checkpoint, LSP, expert)
export {
	// Types
	type AgentHookAPI,
	type AgentHookContext,
	type AgentHookEvent,
	type AgentHookFactory,
	// Hook Manager
	AgentHookManager,
	ALL_HOOKS,
	type BranchEvent,
	type BranchEventResult,
	// Expert Hook
	buildExpertContext,
	type CheckpointConfig,
	type CheckpointData,
	CheckpointUtils,
	CODING_HOOKS,
	// Checkpoint Hook
	checkpointHook,
	cleanupOldCheckpoints,
	createCheckpoint,
	createCheckpointHook,
	createDefaultHookManager,
	createDiscordContext,
	// Discord Integration
	createDiscordHookIntegration,
	createExpertHook,
	createExpertPrompt,
	createHookRegistration,
	// LSP Hook
	createLSPHook,
	createTaskAwareExpertHook,
	type DiscordHookConfig,
	detectDomain,
	disposeAllHookIntegrations,
	disposeChannelHookIntegration,
	type ExpertContext,
	type ExpertHookConfig,
	ExpertUtils,
	expertHook,
	generateSessionId,
	getChannelHookIntegration,
	getDomainRiskLevel,
	type HookIntegration,
	type HookManager,
	type HookRegistration,
	type LSPConfig,
	type LSPDiagnostic,
	LSPUtils,
	listCheckpointRefs,
	loadAllCheckpoints,
	loadCheckpointFromRef,
	lspHook,
	MINIMAL_HOOKS,
	processAgentOutput,
	restoreCheckpoint,
	SECURITY_HOOKS,
	type SessionEvent,
	type ToolCallEvent,
	type ToolCallEventResult,
	type ToolResultEvent,
	type ToolResultEventResult,
	type TurnEndEvent,
	type TurnStartEvent,
	wrapToolWithHooks,
} from "./hooks/index.js";
// Integrated Preprocessor - Combines all Track enhancements
export {
	createIntegratedPreprocessor,
	DEFAULT_INTEGRATED_CONFIG,
	getPreprocessorStats,
	type IntegratedPreprocessorConfig,
	processAgentOutput as processAgentOutputForLearning,
} from "./integrated-preprocessor.js";
// Learning Activation Service - Central learning trigger
export {
	type ActivationResult,
	CRITICAL_DOMAIN_SEEDS,
	type DomainStats,
	getLearningActivationService,
	type LearningActivationConfig,
	seedCriticalDomains,
} from "./learning-activation.js";
// Lightweight Agent exports (pi-mono pattern)
export {
	AGENT_MODELS,
	type AgentOptions,
	AgentPresets,
	type AgentResult,
	DEFAULT_AGENT_MODEL,
	getAgentModels,
	getFreeAgentModels,
	isAgentAvailable,
	// Learning-enabled agent (Act-Learn-Reuse)
	type LearningAgentOptions,
	type LearningAgentResult,
	LearningPresets,
	runAgent,
	runLearningAgent,
} from "./lightweight-agent.js";
// LiveKit Voice AI Agent - Real-time voice interactions with function tools
export {
	getRunningAgents,
	getVoiceAgentStatus,
	isVoiceAgentAvailable,
	type StartVoiceAgentOptions,
	type StartVoiceAgentResult,
	startVoiceAgent,
	stopAllVoiceAgents,
	stopVoiceAgent,
	stopVoiceAgentByRoom,
	type VoiceAgentMode,
	type VoiceAgentStatus,
	type VoiceAgentVoice,
} from "./livekit-voice-agent.js";
// Memory Blocks - Letta-Style Structured Agent Memory
export {
	createMemoryTools,
	createTradingMemoryManager,
	DEFAULT_BLOCKS,
	disposeMemoryManager,
	getMemoryManager,
	type MemoryBlock,
	type MemoryBlockConfig,
	MemoryBlockManager,
	type MemoryEditResult,
	type MemoryToolContext,
	TRADING_BLOCKS,
} from "./memory-blocks.js";
// Omni Router - Unified Smart Model Selection (all providers)
export {
	detectTaskType,
	getOmniModelInfo,
	isHFRouterAvailable,
	isOllamaAvailable,
	listFreeModels,
	listLocalModels,
	listOmniModels,
	OMNI_MODELS,
	type OmniModelKey,
	type OmniOptions,
	OmniPresets,
	type OmniResult,
	omniRouteAdvanced,
	runOmni,
	type TaskType,
} from "./omni-router.js";
// OpenCode Agent - Models via OpenCode CLI
export {
	disposeOpenCode,
	getGrokModelName,
	getOpenCodeModels,
	hasGitHubToken,
	isOpenCodeAvailable,
	OPENCODE_FREE_MODELS,
	type OpenCodeModelKey,
	type OpenCodeOptions,
	OpenCodePresets,
	type OpenCodeResult,
	omniRoute,
	runOmniAgent,
	runOpenCodeAgent,
} from "./opencode-agent.js";
// OpenEvolve - LLM-based Evolutionary Code Optimization
export {
	continueEvolution,
	type EvolutionCandidate,
	evolve,
	evolveAgentPrompt,
	type GenerationHistory,
	getEvolutionStatus,
	getOpenEvolveStatus,
	isOpenEvolveAvailable,
	listEvolutionTasks,
	OpenEvolvePresets,
	type OpenEvolveResult,
	type OpenEvolveStatus,
	type OpenEvolveTask,
	quickEvolve,
} from "./openevolve-agent.js";
// OpenHands Software Agent SDK integration
export {
	getOpenHandsModes,
	isOpenHandsAvailable,
	type OpenHandsMode,
	OpenHandsModeDescriptions,
	type OpenHandsOptions,
	OpenHandsPresets,
	type OpenHandsResult,
	OpenHandsTools,
	runCodeReview,
	runDebug,
	runDocGeneration,
	runFullTradingAudit,
	runOpenHandsAgent,
	runOptimize,
	runRefactor,
	runRiskAssessment,
	runSecurityScan,
	runStrategyBacktest,
	runTestGeneration,
	// Trading Expert Functions (Moon Dev Inspired)
	runTradingAnalysis,
} from "./openhands-agent.js";
// Parallel Agent Patterns - Google ADK Style (GLM-4.7 Dec 2025 Upgrade)
export {
	type AgentContext,
	type AgentTask as ParallelAgentTask,
	AgentWorkflowBuilder,
	Coordinator,
	type CriticResult,
	createCoordinator,
	createGeneratorCritic,
	createIterativeRefinement,
	createParallelFanOut,
	createPipeline,
	createTradingFanOut,
	createTradingPipeline,
	GeneratorCriticLoop,
	IterativeRefinement,
	type MarketData,
	ParallelFanOut,
	type ParallelResult,
	type PipelineResult,
	type RefinementStep,
	type RoutingRule,
	SequentialPipeline,
	type TradingSignal as ParallelTradingSignal,
	workflow as parallelWorkflow,
} from "./parallel-patterns.js";
// Permission Store - Per-Channel/User Permission Overrides
export {
	type ApprovalRequest,
	getPermissionStore,
	initPermissionStore,
	type PermissionOverride,
	PermissionStore,
} from "./permission-store.js";
// 24/7 Research Orchestrator - Autonomous Research System
export {
	type DiscoveryNotification,
	getResearchOrchestrator,
	getResearchStatus,
	type OrchestratorConfig,
	type OrchestratorState,
	type ResearchCycleResult,
	ResearchOrchestrator,
	type ResearchTopic,
	startResearch,
	stopResearch,
	type WebhookSubscriber,
} from "./research-orchestrator.js";
// Self-Debug Service - Autonomous Error Detection and Repair
export {
	DEFAULT_SELF_DEBUG_CONFIG,
	type DiagnosisResult,
	disposeSelfDebugService,
	type ErrorCapture,
	getSelfDebugService,
	type ProposedFix,
	type RepairResult,
	type SelfDebugConfig,
	SelfDebugService,
} from "./self-debug.js";
// Semantic Search - Vector-Based Memory Search
export {
	disposeSemanticSearchService,
	getSemanticSearchService,
	type SearchOptions,
	type SemanticMemory,
	type SemanticSearchResult,
	SemanticSearchService,
} from "./semantic-search.js";
// SDK-Compatible Session Factory (pi SDK abstraction layer)
export {
	type AgentSession,
	type CreateSessionOptions,
	type CreateSessionResult,
	createSession,
	runPrompt,
	type SessionFactoryEvent,
	type SessionFactoryEventType,
	SessionManager,
	type SessionManagerConfig,
	type SessionMode,
	streamPrompt,
} from "./session-factory.js";
// Shared Memory Blocks - Multi-Agent Collaborative Memory
export {
	createSharedBlockTools,
	disposeSharedBlockManager,
	getSharedBlockManager,
	type SharedBlock,
	SharedBlockManager,
	type SharedBlockPermissions,
	type SharedBlockSubscription,
	type SharedBlockUpdate,
} from "./shared-blocks.js";
// Signal Classifier - Neural Network Classification (inspired by ANG13T/fly-catcher)
export {
	type AuthenticityResult,
	CandlePattern,
	type ClassificationResult,
	type ClassifierConfig,
	DEFAULT_CLASSIFIER_CONFIG,
	FeatureExtractor,
	getFeatureExtractor,
	getSignalClassifier,
	MarketSession,
	type QualityResult,
	type RegimeResult,
	SignalClassifier,
	SignalClassifierPresets,
	type SignalFeatures,
	SimpleNeuralNetwork,
	TrendDirection,
} from "./signal-classifier.js";
// Multi-Source Signal Validator (inspired by ANG13T/skytrack)
export {
	type AggregatedSignal,
	createSignalValidator,
	DEFAULT_SIGNAL_SOURCES,
	DEFAULT_VALIDATOR_CONFIG,
	getSignalValidator,
	type Signal,
	SignalDirection,
	type SignalSource,
	SignalValidator,
	SignalValidatorPresets,
	SourceType,
	type SourceValidation,
	type ValidationResult,
	type ValidationWarning,
	type ValidatorConfig,
} from "./signal-validator.js";
// Skill Manager - Hybrid Letta + Pi-Mono Implementation
export {
	type ALRResult,
	actLearnReuse as skillActLearnReuse,
	createLearningPrompt as createSkillPrompt,
	createSkillBundle,
	discoverSkills,
	extractLearnings as extractSkillLearnings,
	getExpertise as getSkillExpertise,
	type LearningResult as SkillLearningResult,
	type LoadDepth,
	loadSkill,
	migrateToBundle,
	type Priority as SkillPriority,
	type ResourceType,
	recordLearning,
	type Skill,
	type SkillBody,
	SkillManager,
	type SkillMetadata,
	type SkillResources,
	searchSkills,
	skillExists,
} from "./skill-manager.js";
// Agent Skills - Specification Loader (https://agentskills.io)
export {
	type AgentSkill,
	type BatchImportResult,
	batchImport,
	batchImportSkills,
	batchImportTopSkills,
	type CatalogResult,
	createSkill,
	type ExportResult,
	exportSkill,
	filterSkills,
	formatSkillsForPrompt,
	getDefaultInstallDir,
	getInstalledSkills,
	getSkillsLoader,
	type ImportResult,
	importSkill,
	importSkillFromUrl,
	type LoadSkillsResult,
	listCatalog,
	loadSkills,
	parseSkillFile,
	type RemoteSkill,
	SKILL_CATEGORIES,
	type SkillCategory,
	type SkillFrontmatter,
	SkillsLoader,
	type SkillsSettings,
	type SkillWarning,
	searchCatalog,
	TOP_SKILLS,
	type TopSkillName,
} from "./skills/index.js";
// Stateful Agent - Persistent State with Checkpoint/Restore
export {
	type AgentState,
	type AgentStatus,
	type CheckpointResult,
	createStatefulAgentTools,
	disposeAllStatefulAgents,
	disposeStatefulAgent,
	type ExecutionHistoryEntry,
	getStatefulAgent,
	listStatefulAgents,
	type RestoreResult,
	type ResumeOptions,
	StatefulAgent,
	type StatefulAgentConfig,
	type StatefulAgentTool,
} from "./stateful-agent.js";
// TAC-12 SDK - Multi-SDK AI Orchestrator (12 SDK integrations)
export {
	createTAC12SwarmIntegration,
	getBestSDKForTask,
	getTAC12Client,
	initTAC12FromEnv,
	quickExecute,
	type TAC12Agent,
	TAC12Client,
	type TAC12Config,
	type TAC12Pattern,
	type TAC12Result,
	type TAC12SDKType,
	type TAC12SwarmIntegration,
	type TAC12Task,
} from "./tac12-sdk.js";
// Tool Permissions - Security-First Tool Execution Control (ADA_V2 Inspired)
export {
	checkToolExecution,
	DEFAULT_PERMISSIONS,
	getPermissionChecker,
	getRateLimiter,
	PermissionChecker,
	type PermissionResult,
	type RateLimitEntry,
	RateLimiter,
	type ToolPermission,
} from "./tool-permissions.js";
// Trading-Rxiv - Cumulative Trading Knowledge Repository (AgentLaboratory Pattern)
export {
	type EntryMetadata,
	type EntryStatus,
	type EntryType,
	getRxivStats,
	getTradingRxiv,
	type RxivStats,
	recordFailure,
	type SearchOptions as RxivSearchOptions,
	type SearchResult as RxivSearchResult,
	searchRxiv,
	submitInsight,
	submitStrategy,
	TradingRxiv,
	type TradingRxivEntry,
} from "./trading-rxiv.js";
// Twitter Connector - Cross-Platform Reach (learned from Agentis Framework)
export {
	type CrossPostRequest,
	type CrossPostResult,
	createTwitterAgent,
	createTwitterConnector,
	getTwitterConnector,
	type MentionAlert,
	type Tweet,
	type TweetEntities,
	type TweetMedia,
	type TweetMetrics,
	type TwitterAgentConfig,
	type TwitterConfig,
	TwitterConnector,
	type TwitterCredentials,
	type TwitterSearchResult,
	type TwitterUser,
} from "./twitter-connector.js";
// Unified SDK Interface - All 4 SDKs in one
export {
	checkAllSDKs,
	getBestSDK,
	runWithBestSDK,
	SDK_INFO,
	type SDKStatus,
	type UnifiedResult,
} from "./unified-sdk.js";
// Vedic Quantum System - b5(9³), n4(8³), and Threefold Algorithms
export {
	type AgentOutputEvaluation,
	analyzeB5Pattern,
	B5_GRID,
	type B5PatternAnalysis,
	type BacktestResult,
	backtestIfaStrategy,
	binaryToOdu,
	calculateElementalDistribution,
	detectCyclicPattern,
	detectDiagonalSymmetry,
	evaluateAgentOutput,
	evaluateThreefold,
	generateIfaSignal,
	IFA_ODUS,
	type IfaSignal,
	type IfaTradingConfig,
	IndraQuantumSystem,
	type IndraQuantumSystemConfig,
	type IndraSystemAnalysis,
	ifaSignalToAction,
	N4_GRID,
	type ThreefoldScore,
	type TradingAction,
	throwOpele,
} from "./vedic-quantum-system.js";
// Workflow Chains - Multi-Step Agent Orchestration
export {
	createWorkflow,
	createWorkflowTools,
	listWorkflows,
	loadWorkflow,
	type ParallelStep,
	parallel,
	type StepExecutor,
	type StepResult,
	type StepStatus,
	Workflow,
	WorkflowBuilder,
	type WorkflowConfig,
	type WorkflowContext,
	type WorkflowEvents,
	type WorkflowState,
	type WorkflowStatus,
	type WorkflowStep,
	type WorkflowStepConfig,
	type WorkflowTool,
	workflow,
} from "./workflow-chains.js";
// Workflow Suspend Manager - VoltAgent-style Suspend/Resume
export {
	addSuspendMethods,
	createWorkflowSuspendTools,
	disposeWorkflowSuspendManager,
	getWorkflowSuspendManager,
	type ResumeResult,
	type SuspendedWorkflow,
	type SuspendFilter,
	type SuspendOptions,
	WorkflowSuspendManager,
	type WorkflowSuspendTool,
} from "./workflow-suspend.js";
// Class 3 Orchestrator - Codebase Singularity (CRUD over agents)
export {
	closeOrchestrator,
	type AgentDefinition as OrchestratorAgentDefinition,
	type DelegationRequest,
	type DelegationResult,
	getOrchestrator,
	Orchestrator,
	type OrchestratorEvent,
	type StepResult as OrchestratorStepResult,
	type WorkflowDefinition as OrchestratorWorkflowDefinition,
	type WorkflowExecution,
	type WorkflowStep as OrchestratorWorkflowStep,
} from "./orchestrator.js";
// ADW - AI Developer Workflow Wrapper (Deterministic + Non-Deterministic)
export {
	type ADWContext,
	type ADWEvent,
	type ADWExecutionResult,
	ADWRunner,
	type ADWStep,
	type ADWStepResult,
	type ADWWorkflow,
	CODE_COMPILES_GATE,
	CODE_REVIEW_GATE,
	createBugFixWorkflow,
	createFeatureWorkflow,
	createRefactorWorkflow,
	disposeADWRunner,
	FORMAT_VALID_GATE,
	type GateResult,
	getADWRunner,
	type QualityGate,
	SECURITY_GATE,
	TESTS_PASS_GATE,
} from "./adw-wrapper.js";
// Pi-Watcher - Autonomous Monitoring & Hotfix (Clopus-Watcher inspired)
export {
	type CustomCheck,
	DEFAULT_WATCHER_CONFIG,
	type DetectedIssue,
	type FixAttempt,
	getPiWatcher,
	getPiWatcherState,
	type HealthCheckResult as WatcherHealthCheckResult,
	type HealthCheckType,
	PiWatcher,
	startPiWatcher,
	stopPiWatcher,
	type WatcherConfig,
	type WatcherEvent,
	type WatcherState,
} from "./pi-watcher.js";

// Orchestrator Bootstrap - Wires real agent handlers
export {
	bootstrapOrchestrator,
	type BootstrapConfig,
	DEFAULT_AGENTS,
	getAgentByRole,
	getBootstrappedOrchestrator,
	quickDelegate,
	registerCustomAgent,
	resetBootstrap,
} from "./orchestrator-bootstrap.js";

// Class 3.2 Multi-Agent Coordinator
export {
	type AgentMessage as CoordinatorAgentMessage,
	type AgentVote,
	type ConsensusResult as CoordinatorConsensusResult,
	type CoordinationConfig,
	type CoordinationResult,
	type CoordinationTask,
	getCoordinator,
	MultiAgentCoordinator,
	resetCoordinator,
	runConsensusVote,
	runDebate,
	runParallel,
	runWithSupervisor,
} from "./multi-agent-coordinator.js";

// Class 3.3 Agent Memory System
export {
	AgentMemorySystem,
	type AgentStats as MemoryAgentStats,
	getMemorySystem,
	type Insight,
	type MemoryConfig,
	resetMemorySystem,
	type RoutingRecommendation,
	type TaskRecord,
} from "./agent-memory-system.js";

// Class 3.4 Orchestrator-Memory Bridge
export {
	type BridgeConfig,
	getOrchestratorMemoryBridge,
	OrchestratorMemoryBridge,
	resetBridge,
	type SmartDelegationRequest,
	type SmartDelegationResult,
} from "./orchestrator-memory-bridge.js";
