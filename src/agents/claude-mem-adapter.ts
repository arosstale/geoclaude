/**
 * Claude-Mem Adapter for Pi-Mono Discord Bot
 *
 * Integrates thedotmack/claude-mem persistent memory compression:
 * - Progressive disclosure (layered memory retrieval)
 * - Semantic summaries and compression
 * - FTS5 full-text search
 * - Skill-based search (mem-search)
 * - Privacy controls with <private> tags
 * - Context configuration
 *
 * @see https://github.com/thedotmack/claude-mem
 */

import { EventEmitter } from "events";

// ========== Core Types ==========

export interface Observation {
	id: string;
	sessionId: string;
	content: string;
	toolName?: string;
	toolInput?: unknown;
	toolOutput?: unknown;
	timestamp: Date;
	concepts?: string[];
	files?: string[];
	type?: "decision" | "bugfix" | "feature" | "refactor" | "discovery" | "change";
	isPrivate?: boolean;
}

export interface Session {
	id: string;
	projectPath: string;
	startedAt: Date;
	endedAt?: Date;
	summary?: string;
	observations: Observation[];
	tokenCount?: number;
}

export interface MemoryQuery {
	query: string;
	type?: "observations" | "sessions" | "prompts" | "concepts" | "files" | "types" | "recent" | "timeline";
	limit?: number;
	since?: Date;
	projectPath?: string;
}

export interface MemoryResult {
	id: string;
	content: string;
	score: number;
	type: string;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}

// ========== Progressive Disclosure Types ==========

export type DisclosureLevel = "minimal" | "summary" | "detailed" | "full";

export interface ProgressiveDisclosureConfig {
	initialLevel: DisclosureLevel;
	tokenBudget: number;
	autoExpand: boolean; // Automatically expand on request
	showTokenCosts: boolean;
}

export interface LayeredMemory {
	level: DisclosureLevel;
	content: string;
	tokenCount: number;
	canExpand: boolean;
	expandedFrom?: string;
}

// ========== Context Configuration ==========

export interface ContextConfig {
	maxTokens: number;
	includeRecentSessions: number;
	includeRecentObservations: number;
	autoInjectOnSessionStart: boolean;
	compressionRatio: number; // 0.0 to 1.0
	privacyMode: "strict" | "normal" | "none";
}

const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
	maxTokens: 8000,
	includeRecentSessions: 3,
	includeRecentObservations: 10,
	autoInjectOnSessionStart: true,
	compressionRatio: 0.5,
	privacyMode: "normal",
};

// ========== Memory Compression ==========

/**
 * MemoryCompressor - Semantic compression for context preservation
 */
export class MemoryCompressor {
	private compressionRatio: number;

	constructor(compressionRatio = 0.5) {
		this.compressionRatio = compressionRatio;
	}

	/**
	 * Compress content while preserving key information
	 */
	compress(content: string, targetTokens?: number): string {
		const tokens = this.estimateTokens(content);
		const targetLen = targetTokens || Math.floor(tokens * this.compressionRatio);

		if (tokens <= targetLen) return content;

		// Extract key sentences (those with important markers)
		const sentences = content.split(/[.!?]+/).filter((s) => s.trim());
		const scored = sentences.map((s) => ({
			text: s.trim(),
			score: this.scoreSentence(s),
		}));

		// Sort by score and take top sentences
		scored.sort((a, b) => b.score - a.score);

		let result = "";
		let currentTokens = 0;

		for (const { text } of scored) {
			const sentenceTokens = this.estimateTokens(text);
			if (currentTokens + sentenceTokens <= targetLen) {
				result += `${text}. `;
				currentTokens += sentenceTokens;
			}
		}

		return result.trim();
	}

	/**
	 * Generate progressive disclosure layers
	 */
	generateLayers(content: string): Map<DisclosureLevel, LayeredMemory> {
		const layers = new Map<DisclosureLevel, LayeredMemory>();
		const fullTokens = this.estimateTokens(content);

		// Minimal: Just key concepts (10% of tokens)
		const minimal = this.extractKeyConcepts(content);
		layers.set("minimal", {
			level: "minimal",
			content: minimal,
			tokenCount: this.estimateTokens(minimal),
			canExpand: true,
		});

		// Summary: Compressed version (30% of tokens)
		const summary = this.compress(content, Math.floor(fullTokens * 0.3));
		layers.set("summary", {
			level: "summary",
			content: summary,
			tokenCount: this.estimateTokens(summary),
			canExpand: true,
			expandedFrom: "minimal",
		});

		// Detailed: Less compressed (60% of tokens)
		const detailed = this.compress(content, Math.floor(fullTokens * 0.6));
		layers.set("detailed", {
			level: "detailed",
			content: detailed,
			tokenCount: this.estimateTokens(detailed),
			canExpand: true,
			expandedFrom: "summary",
		});

		// Full: Original content
		layers.set("full", {
			level: "full",
			content,
			tokenCount: fullTokens,
			canExpand: false,
			expandedFrom: "detailed",
		});

		return layers;
	}

	/**
	 * Estimate token count (rough approximation)
	 */
	estimateTokens(text: string): number {
		// Rough estimate: ~4 characters per token
		return Math.ceil(text.length / 4);
	}

	private scoreSentence(sentence: string): number {
		let score = 0;
		const lower = sentence.toLowerCase();

		// Important markers
		if (lower.includes("important")) score += 3;
		if (lower.includes("key")) score += 2;
		if (lower.includes("critical")) score += 3;
		if (lower.includes("note")) score += 2;
		if (lower.includes("decision")) score += 3;
		if (lower.includes("because")) score += 2;
		if (lower.includes("therefore")) score += 2;
		if (lower.includes("error")) score += 2;
		if (lower.includes("fix")) score += 2;
		if (lower.includes("bug")) score += 2;
		if (lower.includes("feature")) score += 1;

		// Code references
		if (sentence.includes("`")) score += 1;
		if (sentence.includes("()")) score += 1;
		if (sentence.match(/\.(ts|js|py|go|rs)/)) score += 1;

		// Length penalty (prefer medium-length sentences)
		const words = sentence.split(/\s+/).length;
		if (words < 5) score -= 1;
		if (words > 30) score -= 1;

		return score;
	}

	private extractKeyConcepts(content: string): string {
		const concepts: string[] = [];

		// Extract code references
		const codeRefs = content.match(/`[^`]+`/g) || [];
		concepts.push(...codeRefs.slice(0, 5));

		// Extract file paths
		const filePaths = content.match(/[\w\-/]+\.(ts|js|py|go|rs|tsx|jsx)/g) || [];
		concepts.push(...filePaths.slice(0, 3));

		// Extract action verbs with context
		const actions = content.match(/(created|fixed|added|removed|updated|refactored|implemented) [^.]+/gi) || [];
		concepts.push(...actions.slice(0, 3));

		return concepts.join("; ");
	}
}

// ========== FTS5 Search (SQLite Full-Text Search) ==========

/**
 * MemorySearch - FTS5-inspired search implementation
 */
export class MemorySearch {
	private observations: Map<string, Observation> = new Map();
	private sessions: Map<string, Session> = new Map();
	private conceptIndex: Map<string, Set<string>> = new Map(); // concept -> observation IDs
	private fileIndex: Map<string, Set<string>> = new Map(); // file -> observation IDs
	private typeIndex: Map<string, Set<string>> = new Map(); // type -> observation IDs

	/**
	 * Index an observation
	 */
	indexObservation(obs: Observation): void {
		this.observations.set(obs.id, obs);

		// Index concepts
		if (obs.concepts) {
			for (const concept of obs.concepts) {
				if (!this.conceptIndex.has(concept)) {
					this.conceptIndex.set(concept, new Set());
				}
				this.conceptIndex.get(concept)!.add(obs.id);
			}
		}

		// Index files
		if (obs.files) {
			for (const file of obs.files) {
				if (!this.fileIndex.has(file)) {
					this.fileIndex.set(file, new Set());
				}
				this.fileIndex.get(file)!.add(obs.id);
			}
		}

		// Index type
		if (obs.type) {
			if (!this.typeIndex.has(obs.type)) {
				this.typeIndex.set(obs.type, new Set());
			}
			this.typeIndex.get(obs.type)!.add(obs.id);
		}
	}

	/**
	 * Index a session
	 */
	indexSession(session: Session): void {
		this.sessions.set(session.id, session);
		for (const obs of session.observations) {
			obs.sessionId = session.id;
			this.indexObservation(obs);
		}
	}

	/**
	 * Full-text search across observations
	 */
	searchObservations(query: string, limit = 10): MemoryResult[] {
		const results: MemoryResult[] = [];
		const queryLower = query.toLowerCase();
		const queryTerms = queryLower.split(/\s+/);

		for (const obs of this.observations.values()) {
			if (obs.isPrivate) continue;

			const contentLower = obs.content.toLowerCase();
			let score = 0;

			// Exact phrase match
			if (contentLower.includes(queryLower)) {
				score += 10;
			}

			// Term matching
			for (const term of queryTerms) {
				if (contentLower.includes(term)) {
					score += 2;
				}
			}

			// Boost for recent
			const age = Date.now() - obs.timestamp.getTime();
			const hoursSince = age / (1000 * 60 * 60);
			if (hoursSince < 24) score += 3;
			else if (hoursSince < 168) score += 1; // Within a week

			if (score > 0) {
				results.push({
					id: obs.id,
					content: obs.content,
					score,
					type: obs.type || "observation",
					timestamp: obs.timestamp,
					metadata: { concepts: obs.concepts, files: obs.files },
				});
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	/**
	 * Search sessions by summary
	 */
	searchSessions(query: string, limit = 5): MemoryResult[] {
		const results: MemoryResult[] = [];
		const queryLower = query.toLowerCase();

		for (const session of this.sessions.values()) {
			if (!session.summary) continue;

			const summaryLower = session.summary.toLowerCase();
			let score = 0;

			if (summaryLower.includes(queryLower)) {
				score += 10;
			}

			// Check observations too
			for (const obs of session.observations) {
				if (obs.content.toLowerCase().includes(queryLower)) {
					score += 1;
				}
			}

			if (score > 0) {
				results.push({
					id: session.id,
					content: session.summary,
					score,
					type: "session",
					timestamp: session.startedAt,
					metadata: { observationCount: session.observations.length },
				});
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	/**
	 * Search by concept tag
	 */
	searchByConcept(concept: string, limit = 10): MemoryResult[] {
		const obsIds = this.conceptIndex.get(concept.toLowerCase());
		if (!obsIds) return [];

		const results: MemoryResult[] = [];
		for (const id of obsIds) {
			const obs = this.observations.get(id);
			if (obs && !obs.isPrivate) {
				results.push({
					id: obs.id,
					content: obs.content,
					score: 1,
					type: obs.type || "observation",
					timestamp: obs.timestamp,
					metadata: { concepts: obs.concepts },
				});
			}
		}

		return results.slice(0, limit);
	}

	/**
	 * Search by file reference
	 */
	searchByFile(filePath: string, limit = 10): MemoryResult[] {
		const obsIds = this.fileIndex.get(filePath);
		if (!obsIds) return [];

		const results: MemoryResult[] = [];
		for (const id of obsIds) {
			const obs = this.observations.get(id);
			if (obs && !obs.isPrivate) {
				results.push({
					id: obs.id,
					content: obs.content,
					score: 1,
					type: obs.type || "observation",
					timestamp: obs.timestamp,
					metadata: { files: obs.files },
				});
			}
		}

		return results.slice(0, limit);
	}

	/**
	 * Search by type
	 */
	searchByType(type: Observation["type"], limit = 10): MemoryResult[] {
		if (!type) return [];
		const obsIds = this.typeIndex.get(type);
		if (!obsIds) return [];

		const results: MemoryResult[] = [];
		for (const id of obsIds) {
			const obs = this.observations.get(id);
			if (obs && !obs.isPrivate) {
				results.push({
					id: obs.id,
					content: obs.content,
					score: 1,
					type: obs.type || "observation",
					timestamp: obs.timestamp,
				});
			}
		}

		return results.slice(0, limit);
	}

	/**
	 * Get recent context
	 */
	getRecentContext(projectPath: string, limit = 5): MemoryResult[] {
		const results: MemoryResult[] = [];

		const projectSessions = Array.from(this.sessions.values())
			.filter((s) => s.projectPath === projectPath)
			.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
			.slice(0, limit);

		for (const session of projectSessions) {
			if (session.summary) {
				results.push({
					id: session.id,
					content: session.summary,
					score: 1,
					type: "session",
					timestamp: session.startedAt,
				});
			}
		}

		return results;
	}

	/**
	 * Get timeline around a point
	 */
	getTimeline(aroundTime: Date, windowHours = 24): MemoryResult[] {
		const results: MemoryResult[] = [];
		const windowMs = windowHours * 60 * 60 * 1000;
		const start = aroundTime.getTime() - windowMs / 2;
		const end = aroundTime.getTime() + windowMs / 2;

		for (const obs of this.observations.values()) {
			const time = obs.timestamp.getTime();
			if (time >= start && time <= end && !obs.isPrivate) {
				results.push({
					id: obs.id,
					content: obs.content,
					score: 1 - Math.abs(time - aroundTime.getTime()) / windowMs,
					type: obs.type || "observation",
					timestamp: obs.timestamp,
				});
			}
		}

		return results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
	}

	/**
	 * Get stats
	 */
	getStats(): { observations: number; sessions: number; concepts: number; files: number } {
		return {
			observations: this.observations.size,
			sessions: this.sessions.size,
			concepts: this.conceptIndex.size,
			files: this.fileIndex.size,
		};
	}
}

// ========== Claude-Mem Client ==========

export interface ClaudeMemConfig {
	contextConfig?: Partial<ContextConfig>;
	compressionRatio?: number;
	autoCapture?: boolean;
	webViewerPort?: number;
}

/**
 * ClaudeMemClient - Main entry point for claude-mem integration
 */
export class ClaudeMemClient extends EventEmitter {
	private compressor: MemoryCompressor;
	private search: MemorySearch;
	private contextConfig: ContextConfig;
	private currentSession: Session | null = null;
	private disclosureLevel: DisclosureLevel = "summary";

	constructor(config: ClaudeMemConfig = {}) {
		super();
		this.compressor = new MemoryCompressor(config.compressionRatio || 0.5);
		this.search = new MemorySearch();
		this.contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config.contextConfig };
	}

	// ========== Session Management ==========

	/**
	 * Start a new session
	 */
	startSession(projectPath: string): Session {
		this.currentSession = {
			id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			projectPath,
			startedAt: new Date(),
			observations: [],
			tokenCount: 0,
		};

		this.emit("session:started", this.currentSession);
		return this.currentSession;
	}

	/**
	 * End current session with summary
	 */
	endSession(summary?: string): Session | null {
		if (!this.currentSession) return null;

		this.currentSession.endedAt = new Date();

		// Auto-generate summary if not provided
		if (!summary && this.currentSession.observations.length > 0) {
			const allContent = this.currentSession.observations.map((o) => o.content).join("\n");
			this.currentSession.summary = this.compressor.compress(allContent, 500);
		} else {
			this.currentSession.summary = summary;
		}

		// Index the session
		this.search.indexSession(this.currentSession);

		this.emit("session:ended", this.currentSession);

		const session = this.currentSession;
		this.currentSession = null;
		return session;
	}

	// ========== Observation Capture ==========

	/**
	 * Capture an observation (tool usage, decision, etc.)
	 */
	observe(content: string, options: Partial<Observation> = {}): Observation {
		// Check for <private> tags
		const isPrivate = content.includes("<private>") || options.isPrivate;
		const sanitizedContent = isPrivate ? this.stripPrivate(content) : content;

		const observation: Observation = {
			id: `obs-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			sessionId: this.currentSession?.id || "orphan",
			content: sanitizedContent,
			timestamp: new Date(),
			isPrivate,
			...options,
		};

		// Extract concepts and files automatically
		if (!observation.concepts) {
			observation.concepts = this.extractConcepts(sanitizedContent);
		}
		if (!observation.files) {
			observation.files = this.extractFiles(sanitizedContent);
		}

		// Add to current session
		if (this.currentSession) {
			this.currentSession.observations.push(observation);
			this.currentSession.tokenCount =
				(this.currentSession.tokenCount || 0) + this.compressor.estimateTokens(sanitizedContent);
		}

		// Index for search
		this.search.indexObservation(observation);

		this.emit("observation:captured", observation);
		return observation;
	}

	/**
	 * Capture tool usage
	 */
	captureToolUse(toolName: string, input: unknown, output: unknown): Observation {
		const content = `Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2)}\nOutput: ${JSON.stringify(output, null, 2)}`;
		return this.observe(content, { toolName, toolInput: input, toolOutput: output, type: "change" });
	}

	// ========== Search API ==========

	/**
	 * Unified search interface (mem-search skill)
	 */
	memSearch(query: MemoryQuery): MemoryResult[] {
		const { type = "observations", limit = 10 } = query;

		switch (type) {
			case "observations":
				return this.search.searchObservations(query.query, limit);
			case "sessions":
				return this.search.searchSessions(query.query, limit);
			case "concepts":
				return this.search.searchByConcept(query.query, limit);
			case "files":
				return this.search.searchByFile(query.query, limit);
			case "types":
				return this.search.searchByType(query.query as Observation["type"], limit);
			case "recent":
				return this.search.getRecentContext(query.projectPath || "", limit);
			case "timeline":
				return this.search.getTimeline(query.since || new Date(), 24);
			default:
				return this.search.searchObservations(query.query, limit);
		}
	}

	// ========== Progressive Disclosure ==========

	/**
	 * Get context at current disclosure level
	 */
	getContext(content: string): LayeredMemory {
		const layers = this.compressor.generateLayers(content);
		return layers.get(this.disclosureLevel) || layers.get("summary")!;
	}

	/**
	 * Expand to next disclosure level
	 */
	expand(): DisclosureLevel {
		const levels: DisclosureLevel[] = ["minimal", "summary", "detailed", "full"];
		const currentIndex = levels.indexOf(this.disclosureLevel);
		if (currentIndex < levels.length - 1) {
			this.disclosureLevel = levels[currentIndex + 1];
		}
		return this.disclosureLevel;
	}

	/**
	 * Contract to previous disclosure level
	 */
	contract(): DisclosureLevel {
		const levels: DisclosureLevel[] = ["minimal", "summary", "detailed", "full"];
		const currentIndex = levels.indexOf(this.disclosureLevel);
		if (currentIndex > 0) {
			this.disclosureLevel = levels[currentIndex - 1];
		}
		return this.disclosureLevel;
	}

	/**
	 * Set disclosure level
	 */
	setDisclosureLevel(level: DisclosureLevel): void {
		this.disclosureLevel = level;
	}

	/**
	 * Get session start context (injected automatically)
	 */
	getSessionStartContext(projectPath: string): string {
		const recentSessions = this.search.getRecentContext(projectPath, this.contextConfig.includeRecentSessions);

		if (recentSessions.length === 0) {
			return "No previous session context available.";
		}

		const parts: string[] = ["## Previous Session Context\n"];

		for (const session of recentSessions) {
			const compressed = this.compressor.compress(
				session.content,
				Math.floor(this.contextConfig.maxTokens / recentSessions.length),
			);
			parts.push(`### ${session.timestamp.toISOString()}\n${compressed}\n`);
		}

		return parts.join("\n");
	}

	// ========== Utilities ==========

	private stripPrivate(content: string): string {
		return content.replace(/<private>[\s\S]*?<\/private>/g, "[REDACTED]");
	}

	private extractConcepts(content: string): string[] {
		const concepts: string[] = [];

		// Common concept patterns
		const patterns = [
			/\b(authentication|auth)\b/gi,
			/\b(database|db)\b/gi,
			/\b(api|endpoint)\b/gi,
			/\b(error|bug|fix)\b/gi,
			/\b(feature|enhancement)\b/gi,
			/\b(refactor|cleanup)\b/gi,
			/\b(test|testing)\b/gi,
			/\b(security)\b/gi,
			/\b(performance|optimization)\b/gi,
			/\b(deployment|deploy)\b/gi,
		];

		for (const pattern of patterns) {
			const matches = content.match(pattern);
			if (matches) {
				concepts.push(matches[0].toLowerCase());
			}
		}

		return [...new Set(concepts)];
	}

	private extractFiles(content: string): string[] {
		const files = content.match(/[\w\-./]+\.(ts|js|py|go|rs|tsx|jsx|json|md|yaml|yml)/g) || [];
		return [...new Set(files)];
	}

	/**
	 * Get stats
	 */
	getStats(): {
		search: ReturnType<MemorySearch["getStats"]>;
		currentSession: { id: string; observations: number; tokenCount: number } | null;
		disclosureLevel: DisclosureLevel;
	} {
		return {
			search: this.search.getStats(),
			currentSession: this.currentSession
				? {
						id: this.currentSession.id,
						observations: this.currentSession.observations.length,
						tokenCount: this.currentSession.tokenCount || 0,
					}
				: null,
			disclosureLevel: this.disclosureLevel,
		};
	}
}

// ========== Global Instance ==========

let claudeMemClient: ClaudeMemClient | null = null;

/**
 * Get or create Claude-Mem client instance
 */
export function getClaudeMemClient(config?: ClaudeMemConfig): ClaudeMemClient {
	if (!claudeMemClient) {
		claudeMemClient = new ClaudeMemClient(config);
	}
	return claudeMemClient;
}

/**
 * Initialize Claude-Mem from environment
 */
export function initClaudeMem(config?: ClaudeMemConfig): ClaudeMemClient {
	return getClaudeMemClient(config);
}
