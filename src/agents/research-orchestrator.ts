/**
 * 24/7 Research Orchestrator
 *
 * Autonomous research system that runs continuously, combining:
 * - CTM (Continuous Thought Machine) for deep reasoning
 * - DGM (Darwin Gödel Machine) for self-improvement
 * - OpenEvolve for evolutionary optimization
 * - GEPA for prompt optimization
 * - Semantic Memory for knowledge persistence
 * - History Capture for learning accumulation
 *
 * Features:
 * - Continuous autonomous research cycles
 * - Self-improving research strategies
 * - Cross-domain knowledge synthesis
 * - Adaptive scheduling based on findings
 * - Integration with Discord for notifications
 */

import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
// Import database for persistence
import type { BotDatabase } from "../database.js";
// Import AgentLaboratory patterns
import { type DialogueSession, runTradingDialogue } from "./agent-dialogue.js";
import { type AggregatedReview, quickReview } from "./agent-reviewer.js";
// Import agent systems
import { type CTMDomain, CTMPresets, think } from "./ctm-agent.js";
import { DGMPresets, improve } from "./dgm-agent.js";
import { evolve, OpenEvolvePresets } from "./openevolve-agent.js";
import { getTradingRxiv, submitInsight } from "./trading-rxiv.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");
const ORCHESTRATOR_DIR = join(PACKAGE_ROOT, "data", "research-orchestrator");

// ============================================================================
// TYPES
// ============================================================================

/** Research topic configuration */
export interface ResearchTopic {
	/** Unique topic identifier */
	id: string;
	/** Topic name */
	name: string;
	/** Research question or objective */
	question: string;
	/** Domain for specialized thinking */
	domain: CTMDomain;
	/** Priority (higher = more frequent) */
	priority: number;
	/** Tags for categorization */
	tags: string[];
	/** Whether to enable self-improvement */
	enableSelfImprovement?: boolean;
	/** Whether to enable evolution */
	enableEvolution?: boolean;
	/** Maximum daily research cycles */
	maxDailyCycles?: number;
}

/** Research cycle result */
export interface ResearchCycleResult {
	cycleId: string;
	topicId: string;
	timestamp: number;
	phase: "thinking" | "dialogue" | "improving" | "evolving" | "reviewing" | "synthesizing";
	success: boolean;
	findings?: string[];
	insights?: string[];
	improvements?: string[];
	confidence: number;
	duration: number;
	error?: string;
	/** Dialogue session if pre-action dialogue was enabled */
	dialogueSession?: DialogueSession;
	/** Review result if post-research review was enabled */
	reviewResult?: AggregatedReview;
	/** Trading-Rxiv entry ID if discovery was submitted */
	rxivEntryId?: string;
}

/** Orchestrator state */
export interface OrchestratorState {
	isRunning: boolean;
	currentTopic?: string;
	currentPhase?: string;
	cyclesCompleted: number;
	lastCycleTime?: number;
	nextScheduledCycle?: number;
	topics: ResearchTopic[];
	recentResults: ResearchCycleResult[];
}

/** Webhook subscriber configuration */
export interface WebhookSubscriber {
	/** Unique subscriber ID */
	id: string;
	/** Webhook URL to POST discoveries */
	url: string;
	/** Filter by topics (empty = all) */
	topicIds?: string[];
	/** Filter by domains (empty = all) */
	domains?: string[];
	/** Minimum confidence threshold to trigger notification */
	minConfidence: number;
	/** Whether subscriber is active */
	enabled: boolean;
	/** Optional secret for HMAC signing */
	secret?: string;
	/** Created timestamp */
	createdAt: number;
}

/** Discovery notification payload */
export interface DiscoveryNotification {
	type: "discovery";
	timestamp: number;
	cycleId: string;
	topic: {
		id: string;
		name: string;
		domain: string;
	};
	confidence: number;
	findings: string[];
	insights: string[];
	improvements: string[];
	duration: number;
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
	/** Minimum interval between cycles (ms) */
	minCycleInterval: number;
	/** Maximum interval between cycles (ms) */
	maxCycleInterval: number;
	/** Enable notifications */
	enableNotifications: boolean;
	/** Discord channel for notifications */
	notificationChannelId?: string;
	/** Maximum concurrent research tasks */
	maxConcurrent: number;
	/** Self-improvement trigger threshold */
	selfImprovementThreshold: number;
	/** Evolution trigger threshold */
	evolutionThreshold: number;
	/** Database instance for persistence (optional) */
	database?: BotDatabase;
	/** Enable database persistence */
	enableDatabasePersistence: boolean;
	/** Enable webhook notifications */
	enableWebhookNotifications: boolean;
	/** Webhook subscribers for discovery notifications */
	webhookSubscribers: WebhookSubscriber[];
	/** Timeout for webhook calls (ms) */
	webhookTimeout: number;
	// AgentLaboratory patterns
	/** Enable pre-action dialogue between agents */
	enableDialogue: boolean;
	/** Enable post-research peer review */
	enableReview: boolean;
	/** Enable Trading-Rxiv storage */
	enableRxiv: boolean;
	/** Minimum review score to accept findings */
	minReviewScore: number;
	/** LLM executor for dialogue and review */
	llmExecutor?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

// ============================================================================
// DEFAULT RESEARCH TOPICS
// ============================================================================

const DEFAULT_TOPICS: ResearchTopic[] = [
	{
		id: "trading-patterns",
		name: "Trading Pattern Discovery",
		question: "What emerging patterns in cryptocurrency markets could indicate profitable trading opportunities?",
		domain: "trading",
		priority: 10,
		tags: ["trading", "crypto", "patterns"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 24,
	},
	{
		id: "agent-optimization",
		name: "Agent Performance Optimization",
		question: "How can the agent system prompts and strategies be improved for better task completion?",
		domain: "coding",
		priority: 8,
		tags: ["meta", "optimization", "agents"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 12,
	},
	{
		id: "security-research",
		name: "Security Vulnerability Research",
		question: "What new security vulnerabilities or attack vectors should be monitored?",
		domain: "security",
		priority: 7,
		tags: ["security", "vulnerabilities", "defense"],
		enableSelfImprovement: false,
		enableEvolution: false,
		maxDailyCycles: 6,
	},
	{
		id: "ai-advances",
		name: "AI Research Advances",
		question: "What recent advances in AI/ML could be integrated to improve system capabilities?",
		domain: "research",
		priority: 6,
		tags: ["ai", "ml", "research"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 8,
	},
	{
		id: "code-quality",
		name: "Code Quality Improvement",
		question: "What code patterns in the codebase could be refactored for better maintainability?",
		domain: "coding",
		priority: 5,
		tags: ["coding", "refactoring", "quality"],
		enableSelfImprovement: true,
		enableEvolution: false,
		maxDailyCycles: 4,
	},
	// Trading-specific research topics
	{
		id: "market-microstructure",
		name: "Market Microstructure Analysis",
		question: "What order flow patterns and liquidity dynamics could be exploited for alpha generation?",
		domain: "trading",
		priority: 9,
		tags: ["trading", "microstructure", "orderflow", "liquidity"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 12,
	},
	{
		id: "whale-behavior",
		name: "Whale Wallet Behavior Analysis",
		question: "What on-chain whale wallet movements could signal upcoming price movements?",
		domain: "trading",
		priority: 9,
		tags: ["trading", "whales", "onchain", "signals"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 24,
	},
	{
		id: "sentiment-alpha",
		name: "Sentiment Alpha Discovery",
		question: "What social media and news sentiment patterns correlate with price movements?",
		domain: "trading",
		priority: 8,
		tags: ["trading", "sentiment", "nlp", "social"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 12,
	},
	{
		id: "risk-optimization",
		name: "Risk Management Optimization",
		question: "How can position sizing and risk allocation be optimized for better risk-adjusted returns?",
		domain: "trading",
		priority: 8,
		tags: ["trading", "risk", "portfolio", "optimization"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 6,
	},
	{
		id: "execution-improvement",
		name: "Trade Execution Improvement",
		question: "What execution strategies could reduce slippage and improve fill rates?",
		domain: "trading",
		priority: 7,
		tags: ["trading", "execution", "slippage", "dex"],
		enableSelfImprovement: true,
		enableEvolution: true,
		maxDailyCycles: 8,
	},
];

// ============================================================================
// RESEARCH ORCHESTRATOR CLASS
// ============================================================================

export class ResearchOrchestrator extends EventEmitter {
	private state: OrchestratorState;
	private config: OrchestratorConfig;
	private cycleTimer?: NodeJS.Timeout;
	private isProcessing = false;

	constructor(config: Partial<OrchestratorConfig> = {}) {
		super();

		this.config = {
			minCycleInterval: 5 * 60 * 1000, // 5 minutes
			maxCycleInterval: 60 * 60 * 1000, // 1 hour
			enableNotifications: true,
			maxConcurrent: 1,
			selfImprovementThreshold: 0.8,
			evolutionThreshold: 0.9,
			enableDatabasePersistence: true,
			enableWebhookNotifications: true,
			webhookSubscribers: [],
			webhookTimeout: 10000, // 10 seconds
			// AgentLaboratory patterns (disabled by default for performance)
			enableDialogue: false,
			enableReview: false,
			enableRxiv: true, // Always save to Trading-Rxiv
			minReviewScore: 7,
			...config,
		};

		this.state = {
			isRunning: false,
			cyclesCompleted: 0,
			topics: [...DEFAULT_TOPICS],
			recentResults: [],
		};

		// Ensure directory exists
		if (!existsSync(ORCHESTRATOR_DIR)) {
			mkdirSync(ORCHESTRATOR_DIR, { recursive: true });
		}

		// Load previous state if exists
		this.loadState();
	}

	// ==========================================================================
	// LIFECYCLE
	// ==========================================================================

	/**
	 * Start the 24/7 research orchestrator
	 */
	start(): void {
		if (this.state.isRunning) {
			this.emit("warning", "Orchestrator already running");
			return;
		}

		this.state.isRunning = true;
		this.emit("started", { timestamp: Date.now() });

		// Schedule first cycle
		this.scheduleNextCycle(1000); // Start in 1 second
		this.saveState();
	}

	/**
	 * Stop the orchestrator
	 */
	stop(): void {
		if (!this.state.isRunning) {
			return;
		}

		this.state.isRunning = false;

		if (this.cycleTimer) {
			clearTimeout(this.cycleTimer);
			this.cycleTimer = undefined;
		}

		this.emit("stopped", { timestamp: Date.now() });
		this.saveState();
	}

	/**
	 * Get current state
	 */
	getState(): OrchestratorState {
		return { ...this.state };
	}

	/**
	 * Add research topic
	 */
	addTopic(topic: ResearchTopic): void {
		const existing = this.state.topics.findIndex((t) => t.id === topic.id);
		if (existing >= 0) {
			this.state.topics[existing] = topic;
		} else {
			this.state.topics.push(topic);
		}
		this.saveState();
		this.emit("topicAdded", topic);
	}

	/**
	 * Remove research topic
	 */
	removeTopic(topicId: string): void {
		this.state.topics = this.state.topics.filter((t) => t.id !== topicId);
		this.saveState();
		this.emit("topicRemoved", { topicId });
	}

	/**
	 * Manually trigger a research cycle
	 */
	async triggerCycle(topicId?: string): Promise<ResearchCycleResult | null> {
		if (this.isProcessing) {
			this.emit("warning", "Already processing a cycle");
			return null;
		}

		const topic = topicId ? this.state.topics.find((t) => t.id === topicId) : this.selectNextTopic();

		if (!topic) {
			this.emit("error", "No topic available for research");
			return null;
		}

		return this.runResearchCycle(topic);
	}

	// ==========================================================================
	// CORE RESEARCH CYCLE
	// ==========================================================================

	/**
	 * Run a complete research cycle
	 */
	private async runResearchCycle(topic: ResearchTopic): Promise<ResearchCycleResult> {
		const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const startTime = Date.now();

		this.isProcessing = true;
		this.state.currentTopic = topic.id;

		const result: ResearchCycleResult = {
			cycleId,
			topicId: topic.id,
			timestamp: startTime,
			phase: "thinking",
			success: false,
			findings: [],
			insights: [],
			improvements: [],
			confidence: 0,
			duration: 0,
		};

		try {
			this.emit("cycleStarted", { cycleId, topic });

			// Phase 0: Pre-Action Dialogue (AgentLaboratory pattern)
			if (this.config.enableDialogue && this.config.llmExecutor) {
				this.state.currentPhase = "dialogue";
				this.emit("phaseChanged", { phase: "dialogue", topic: topic.id });

				try {
					const dialogueSession = await runTradingDialogue(
						topic.question,
						`Research topic: ${topic.name}\nDomain: ${topic.domain}\nTags: ${topic.tags.join(", ")}`,
						this.config.llmExecutor,
					);
					result.dialogueSession = dialogueSession;

					// Extract consensus insights if dialogue succeeded
					if (dialogueSession.success && dialogueSession.finalConsensus) {
						result.insights = result.insights || [];
						result.insights.push(`[Dialogue Consensus] ${dialogueSession.finalConsensus}`);
					}
					if (dialogueSession.actionItems) {
						result.insights = result.insights || [];
						result.insights.push(...dialogueSession.actionItems.map((a) => `[Action] ${a}`));
					}
				} catch (dialogueError) {
					this.emit("warning", `Dialogue phase failed: ${dialogueError}`);
				}
			}

			// Phase 1: Deep Thinking with CTM
			this.state.currentPhase = "thinking";
			this.emit("phaseChanged", { phase: "thinking", topic: topic.id });

			const thinkingResult = await think(CTMPresets.deep(topic.question, topic.domain));

			if (thinkingResult.success) {
				result.findings = [thinkingResult.answer || ""];
				result.insights = [...(result.insights || []), ...(thinkingResult.insights || [])];
				result.confidence = thinkingResult.confidence;
			}

			// Phase 2: Self-Improvement with DGM (if enabled and threshold met)
			if (topic.enableSelfImprovement && result.confidence >= this.config.selfImprovementThreshold) {
				this.state.currentPhase = "improving";
				this.emit("phaseChanged", { phase: "improving", topic: topic.id });

				const expertisePath = join(PACKAGE_ROOT, "src", "agents", "expertise", `${topic.domain}.md`);

				if (existsSync(expertisePath)) {
					const improvementResult = await improve(
						DGMPresets.agentPrompt(expertisePath, `Improve based on insight: ${result.insights?.join("; ")}`),
					);

					if (improvementResult.success && improvementResult.modifications) {
						result.improvements = improvementResult.modifications
							.filter((m) => m.accepted)
							.map((m) => m.description);
					}
				}
			}

			// Phase 3: Evolution with OpenEvolve (if enabled and threshold met)
			if (
				topic.enableEvolution &&
				result.confidence >= this.config.evolutionThreshold &&
				result.findings &&
				result.findings.length > 0
			) {
				this.state.currentPhase = "evolving";
				this.emit("phaseChanged", { phase: "evolving", topic: topic.id });

				const evolutionResult = await evolve(
					OpenEvolvePresets.researchHypothesis(result.findings.join("\n"), topic.domain),
				);

				if (evolutionResult.success && evolutionResult.bestSolution) {
					result.findings.push(`Evolved insight: ${evolutionResult.bestSolution}`);
				}
			}

			// Phase 4: Peer Review (AgentLaboratory pattern)
			if (this.config.enableReview && this.config.llmExecutor && result.findings && result.findings.length > 0) {
				this.state.currentPhase = "reviewing";
				this.emit("phaseChanged", { phase: "reviewing", topic: topic.id });

				try {
					const reviewResult = await quickReview(
						result.findings.join("\n\n"),
						`Research findings for: ${topic.name}\nDomain: ${topic.domain}`,
						this.config.llmExecutor,
					);
					result.reviewResult = reviewResult;

					// Adjust confidence based on review
					if (reviewResult.passed) {
						result.confidence = Math.min(1, result.confidence * 1.1); // Boost confidence
						result.insights = result.insights || [];
						result.insights.push(...reviewResult.unanimousStrengths.map((s) => `[Strength] ${s}`));
					} else {
						result.confidence *= 0.8; // Reduce confidence
						result.insights = result.insights || [];
						result.insights.push(...reviewResult.unanimousWeaknesses.map((w) => `[Weakness] ${w}`));
						result.insights.push(...reviewResult.combinedSuggestions.map((s) => `[Suggestion] ${s}`));
					}
				} catch (reviewError) {
					this.emit("warning", `Review phase failed: ${reviewError}`);
				}
			}

			// Phase 5: Synthesis & Trading-Rxiv Storage
			this.state.currentPhase = "synthesizing";
			this.emit("phaseChanged", { phase: "synthesizing", topic: topic.id });

			// Combine all findings into a synthesis
			result.phase = "synthesizing";
			result.success = true;
			result.duration = Date.now() - startTime;

			// Save to Trading-Rxiv (AgentLaboratory pattern)
			if (this.config.enableRxiv && result.success && result.findings && result.findings.length > 0) {
				try {
					const _rxiv = getTradingRxiv();
					const entry = await submitInsight(
						topic.name,
						result.findings[0].slice(0, 500), // Abstract from first finding
						result.findings.join("\n\n---\n\n"),
						{
							author: "research-orchestrator",
							tags: [...topic.tags, "auto-generated"],
							symbols: topic.tags.filter((t) => /^[A-Z]{2,5}$/.test(t)),
						},
					);
					result.rxivEntryId = entry.metadata.id;
					this.emit("rxivSubmitted", { entryId: entry.metadata.id, topic: topic.id });
				} catch (rxivError) {
					this.emit("warning", `Trading-Rxiv submission failed: ${rxivError}`);
				}
			}

			// Store results
			this.state.recentResults.unshift(result);
			if (this.state.recentResults.length > 100) {
				this.state.recentResults = this.state.recentResults.slice(0, 100);
			}

			this.state.cyclesCompleted++;
			this.state.lastCycleTime = Date.now();

			this.emit("cycleCompleted", result);

			// Save findings to file and database
			this.saveCycleResult(result, topic);

			// Send webhook notifications (fire-and-forget)
			this.sendDiscoveryNotifications(result, topic).catch((err) => {
				this.emit("warning", `Webhook notification error: ${err}`);
			});
		} catch (error) {
			result.error = `Cycle failed: ${error}`;
			result.duration = Date.now() - startTime;
			this.emit("cycleError", { cycleId, error });
		} finally {
			this.isProcessing = false;
			this.state.currentTopic = undefined;
			this.state.currentPhase = undefined;

			// Schedule next cycle
			if (this.state.isRunning) {
				this.scheduleNextCycle();
			}

			this.saveState();
		}

		return result;
	}

	// ==========================================================================
	// SCHEDULING
	// ==========================================================================

	/**
	 * Schedule the next research cycle
	 */
	private scheduleNextCycle(delayMs?: number): void {
		if (this.cycleTimer) {
			clearTimeout(this.cycleTimer);
		}

		// Calculate delay based on recent results
		const delay = delayMs ?? this.calculateNextCycleDelay();

		this.state.nextScheduledCycle = Date.now() + delay;

		this.cycleTimer = setTimeout(async () => {
			if (!this.state.isRunning) return;

			const topic = this.selectNextTopic();
			if (topic) {
				await this.runResearchCycle(topic);
			} else {
				// No topics available, wait and retry
				this.scheduleNextCycle(this.config.maxCycleInterval);
			}
		}, delay);

		this.emit("cycleScheduled", {
			delay,
			scheduledTime: this.state.nextScheduledCycle,
		});
	}

	/**
	 * Calculate delay for next cycle based on results
	 */
	private calculateNextCycleDelay(): number {
		const recentResults = this.state.recentResults.slice(0, 10);

		if (recentResults.length === 0) {
			return this.config.minCycleInterval;
		}

		// If recent cycles had high confidence findings, research more frequently
		const avgConfidence = recentResults.reduce((sum, r) => sum + r.confidence, 0) / recentResults.length;

		if (avgConfidence > 0.9) {
			return this.config.minCycleInterval;
		} else if (avgConfidence > 0.7) {
			return (this.config.minCycleInterval + this.config.maxCycleInterval) / 2;
		} else {
			return this.config.maxCycleInterval;
		}
	}

	/**
	 * Select next topic based on priority and recent activity
	 */
	private selectNextTopic(): ResearchTopic | null {
		const now = Date.now();
		const today = new Date(now).toDateString();

		// Count today's cycles per topic
		const todayCycles = new Map<string, number>();
		for (const result of this.state.recentResults) {
			const resultDate = new Date(result.timestamp).toDateString();
			if (resultDate === today) {
				todayCycles.set(result.topicId, (todayCycles.get(result.topicId) || 0) + 1);
			}
		}

		// Filter topics that haven't exceeded daily limit
		const availableTopics = this.state.topics.filter((topic) => {
			const cycleCount = todayCycles.get(topic.id) || 0;
			return cycleCount < (topic.maxDailyCycles || 10);
		});

		if (availableTopics.length === 0) {
			return null;
		}

		// Weight by priority and inverse of recent activity
		const weights = availableTopics.map((topic) => {
			const recentCount = this.state.recentResults.filter(
				(r) => r.topicId === topic.id && now - r.timestamp < 3600000,
			).length;

			return topic.priority / (recentCount + 1);
		});

		// Weighted random selection
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		let random = Math.random() * totalWeight;

		for (let i = 0; i < availableTopics.length; i++) {
			random -= weights[i];
			if (random <= 0) {
				return availableTopics[i];
			}
		}

		return availableTopics[0];
	}

	// ==========================================================================
	// PERSISTENCE
	// ==========================================================================

	/**
	 * Save orchestrator state
	 */
	private saveState(): void {
		const statePath = join(ORCHESTRATOR_DIR, "state.json");
		writeFileSync(
			statePath,
			JSON.stringify(
				{
					...this.state,
					savedAt: Date.now(),
				},
				null,
				2,
			),
		);
	}

	/**
	 * Load orchestrator state
	 */
	private loadState(): void {
		const statePath = join(ORCHESTRATOR_DIR, "state.json");

		if (existsSync(statePath)) {
			try {
				const saved = JSON.parse(readFileSync(statePath, "utf-8"));
				this.state = {
					...this.state,
					cyclesCompleted: saved.cyclesCompleted || 0,
					recentResults: saved.recentResults || [],
					topics: saved.topics || DEFAULT_TOPICS,
				};
			} catch {
				// Use defaults
			}
		}
	}

	/**
	 * Save cycle result to file and database
	 */
	private saveCycleResult(result: ResearchCycleResult, topic: ResearchTopic): void {
		// Save to file
		const date = new Date(result.timestamp);
		const dateStr = date.toISOString().split("T")[0];
		const resultDir = join(ORCHESTRATOR_DIR, "results", dateStr);

		if (!existsSync(resultDir)) {
			mkdirSync(resultDir, { recursive: true });
		}

		const resultPath = join(resultDir, `${result.cycleId}.json`);
		writeFileSync(resultPath, JSON.stringify(result, null, 2));

		// Save to database if enabled
		if (this.config.enableDatabasePersistence && this.config.database) {
			try {
				this.config.database.saveResearchResult({
					cycleId: result.cycleId,
					topicId: result.topicId,
					topicName: topic.name,
					domain: topic.domain,
					phase: result.phase,
					success: result.success,
					confidence: result.confidence,
					findings: result.findings,
					insights: result.insights,
					improvements: result.improvements,
					duration: result.duration,
					error: result.error,
				});
				this.emit("resultPersisted", { cycleId: result.cycleId, storage: "database" });
			} catch (error) {
				this.emit("warning", `Failed to persist to database: ${error}`);
			}
		}
	}

	/**
	 * Set database for persistence
	 */
	setDatabase(db: BotDatabase): void {
		this.config.database = db;
	}

	/**
	 * Get research statistics from database
	 */
	getResearchStats(): {
		total: number;
		successful: number;
		avgConfidence: number;
		byDomain: Record<string, number>;
	} | null {
		if (!this.config.database) {
			return null;
		}
		return this.config.database.getResearchStats();
	}

	/**
	 * Get recent results from database
	 */
	getRecentResultsFromDB(limit = 20): unknown[] {
		if (!this.config.database) {
			return [];
		}
		return this.config.database.getRecentResearchResults(limit);
	}

	// ==========================================================================
	// WEBHOOK NOTIFICATIONS
	// ==========================================================================

	/**
	 * Add a webhook subscriber for discovery notifications
	 */
	addWebhookSubscriber(subscriber: Omit<WebhookSubscriber, "id" | "createdAt">): string {
		const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const fullSubscriber: WebhookSubscriber = {
			...subscriber,
			id,
			createdAt: Date.now(),
		};
		this.config.webhookSubscribers.push(fullSubscriber);
		this.emit("subscriberAdded", { id, url: subscriber.url });
		this.saveState();
		return id;
	}

	/**
	 * Remove a webhook subscriber
	 */
	removeWebhookSubscriber(subscriberId: string): boolean {
		const index = this.config.webhookSubscribers.findIndex((s) => s.id === subscriberId);
		if (index >= 0) {
			this.config.webhookSubscribers.splice(index, 1);
			this.emit("subscriberRemoved", { id: subscriberId });
			this.saveState();
			return true;
		}
		return false;
	}

	/**
	 * Get all webhook subscribers
	 */
	getWebhookSubscribers(): WebhookSubscriber[] {
		return [...this.config.webhookSubscribers];
	}

	/**
	 * Toggle webhook subscriber enabled state
	 */
	toggleWebhookSubscriber(subscriberId: string, enabled: boolean): boolean {
		const subscriber = this.config.webhookSubscribers.find((s) => s.id === subscriberId);
		if (subscriber) {
			subscriber.enabled = enabled;
			this.saveState();
			return true;
		}
		return false;
	}

	/**
	 * Send discovery notification to all matching subscribers
	 */
	private async sendDiscoveryNotifications(result: ResearchCycleResult, topic: ResearchTopic): Promise<void> {
		if (!this.config.enableWebhookNotifications) {
			return;
		}

		// Filter applicable subscribers
		const applicableSubscribers = this.config.webhookSubscribers.filter((sub) => {
			if (!sub.enabled) return false;
			if (result.confidence < sub.minConfidence) return false;
			if (sub.topicIds && sub.topicIds.length > 0 && !sub.topicIds.includes(topic.id)) return false;
			if (sub.domains && sub.domains.length > 0 && !sub.domains.includes(topic.domain)) return false;
			return true;
		});

		if (applicableSubscribers.length === 0) {
			return;
		}

		// Build notification payload
		const notification: DiscoveryNotification = {
			type: "discovery",
			timestamp: result.timestamp,
			cycleId: result.cycleId,
			topic: {
				id: topic.id,
				name: topic.name,
				domain: topic.domain,
			},
			confidence: result.confidence,
			findings: result.findings || [],
			insights: result.insights || [],
			improvements: result.improvements || [],
			duration: result.duration,
		};

		// Send to all applicable subscribers in parallel
		const results = await Promise.allSettled(
			applicableSubscribers.map((sub) => this.sendWebhookNotification(sub, notification)),
		);

		// Log results
		results.forEach((res, index) => {
			const sub = applicableSubscribers[index];
			if (res.status === "fulfilled") {
				this.emit("webhookSent", { subscriberId: sub.id, cycleId: result.cycleId });
			} else {
				this.emit("webhookFailed", {
					subscriberId: sub.id,
					cycleId: result.cycleId,
					error: res.reason?.message || String(res.reason),
				});
			}
		});
	}

	/**
	 * Send notification to a single webhook subscriber
	 */
	private async sendWebhookNotification(
		subscriber: WebhookSubscriber,
		notification: DiscoveryNotification,
	): Promise<Response> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Research-Event": "discovery",
			"X-Cycle-Id": notification.cycleId,
		};

		// Add HMAC signature if secret is configured
		if (subscriber.secret) {
			const { createHmac } = await import("crypto");
			const payload = JSON.stringify(notification);
			const signature = createHmac("sha256", subscriber.secret).update(payload).digest("hex");
			headers["X-Signature"] = `sha256=${signature}`;
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.config.webhookTimeout);

		try {
			const response = await fetch(subscriber.url, {
				method: "POST",
				headers,
				body: JSON.stringify(notification),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			return response;
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

// ============================================================================
// SINGLETON AND CONVENIENCE
// ============================================================================

let orchestratorInstance: ResearchOrchestrator | null = null;

/**
 * Get or create the research orchestrator singleton
 */
export function getResearchOrchestrator(config?: Partial<OrchestratorConfig>): ResearchOrchestrator {
	if (!orchestratorInstance) {
		orchestratorInstance = new ResearchOrchestrator(config);
	}
	return orchestratorInstance;
}

/**
 * Start 24/7 research (convenience function)
 */
export function startResearch(config?: Partial<OrchestratorConfig>): ResearchOrchestrator {
	const orchestrator = getResearchOrchestrator(config);
	orchestrator.start();
	return orchestrator;
}

/**
 * Stop 24/7 research (convenience function)
 */
export function stopResearch(): void {
	if (orchestratorInstance) {
		orchestratorInstance.stop();
	}
}

/**
 * Get research status (convenience function)
 */
export function getResearchStatus(): OrchestratorState | null {
	return orchestratorInstance?.getState() ?? null;
}
