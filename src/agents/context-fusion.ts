/**
 * Class 3.33: Context Fusion
 *
 * Merges context from multiple sources into unified agent context.
 * Handles priority, relevance scoring, and token budget.
 *
 * Features:
 * - Multi-source context aggregation
 * - Priority-based ordering
 * - Relevance scoring
 * - Token budget management
 * - Deduplication
 *
 * @module context-fusion
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type ContextSourceType =
	| "memory"
	| "experience"
	| "file"
	| "conversation"
	| "tool"
	| "external"
	| "user"
	| "system";

export interface ContextSource {
	id: string;
	type: ContextSourceType;
	name: string;
	priority: number;
	fetch: (task: string) => Promise<ContextItem[]>;
	enabled: boolean;
	weight: number;
}

export interface ContextItem {
	id: string;
	sourceId: string;
	content: string;
	relevance: number;
	timestamp: number;
	metadata?: Record<string, unknown>;
	tokens?: number;
}

export interface FusedContext {
	task: string;
	items: ContextItem[];
	sources: string[];
	totalTokens: number;
	truncated: boolean;
	fusedAt: number;
}

export interface FusionConfig {
	maxTokens: number;
	minRelevance: number;
	deduplicateThreshold: number;
	enableCompression: boolean;
	compressionRatio: number;
}

export interface ContextFusionConfig {
	defaultMaxTokens: number;
	defaultMinRelevance: number;
	enableParallelFetch: boolean;
	timeoutMs: number;
	cacheResults: boolean;
	cacheTTLMs: number;
}

export interface ContextFusionEvents {
	"source:registered": { source: ContextSource };
	"fetch:started": { task: string; sources: string[] };
	"fetch:completed": { task: string; itemCount: number };
	"fusion:completed": { context: FusedContext };
	"item:filtered": { item: ContextItem; reason: string };
}

// =============================================================================
// Context Fusion
// =============================================================================

export class ContextFusion extends EventEmitter {
	private config: ContextFusionConfig;
	private sources: Map<string, ContextSource> = new Map();
	private cache: Map<string, { context: FusedContext; timestamp: number }> = new Map();

	constructor(config: Partial<ContextFusionConfig> = {}) {
		super();
		this.config = {
			defaultMaxTokens: 8000,
			defaultMinRelevance: 0.3,
			enableParallelFetch: true,
			timeoutMs: 10000,
			cacheResults: true,
			cacheTTLMs: 60000,
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Source Registration
	// ---------------------------------------------------------------------------

	registerSource(source: ContextSource): void {
		this.sources.set(source.id, source);
		this.emit("source:registered", { source });
	}

	enableSource(id: string): boolean {
		const source = this.sources.get(id);
		if (source) {
			source.enabled = true;
			return true;
		}
		return false;
	}

	disableSource(id: string): boolean {
		const source = this.sources.get(id);
		if (source) {
			source.enabled = false;
			return true;
		}
		return false;
	}

	setSourceWeight(id: string, weight: number): boolean {
		const source = this.sources.get(id);
		if (source) {
			source.weight = weight;
			return true;
		}
		return false;
	}

	// ---------------------------------------------------------------------------
	// Context Fusion
	// ---------------------------------------------------------------------------

	async fuse(task: string, options: Partial<FusionConfig> = {}): Promise<FusedContext> {
		const maxTokens = options.maxTokens ?? this.config.defaultMaxTokens;
		const minRelevance = options.minRelevance ?? this.config.defaultMinRelevance;
		const deduplicateThreshold = options.deduplicateThreshold ?? 0.9;

		// Check cache
		if (this.config.cacheResults) {
			const cached = this.cache.get(task);
			if (cached && Date.now() - cached.timestamp < this.config.cacheTTLMs) {
				return cached.context;
			}
		}

		// Get enabled sources sorted by priority
		const enabledSources = Array.from(this.sources.values())
			.filter((s) => s.enabled)
			.sort((a, b) => b.priority - a.priority);

		this.emit("fetch:started", {
			task,
			sources: enabledSources.map((s) => s.id),
		});

		// Fetch from all sources
		let allItems: ContextItem[];
		if (this.config.enableParallelFetch) {
			allItems = await this.fetchParallel(task, enabledSources);
		} else {
			allItems = await this.fetchSequential(task, enabledSources);
		}

		this.emit("fetch:completed", { task, itemCount: allItems.length });

		// Filter by relevance
		let filteredItems = allItems.filter((item) => {
			if (item.relevance < minRelevance) {
				this.emit("item:filtered", { item, reason: `Low relevance: ${item.relevance}` });
				return false;
			}
			return true;
		});

		// Deduplicate
		filteredItems = this.deduplicate(filteredItems, deduplicateThreshold);

		// Apply source weights
		filteredItems = filteredItems.map((item) => {
			const source = this.sources.get(item.sourceId);
			if (source) {
				return {
					...item,
					relevance: item.relevance * source.weight,
				};
			}
			return item;
		});

		// Sort by weighted relevance
		filteredItems.sort((a, b) => b.relevance - a.relevance);

		// Apply token budget
		const { items, truncated, totalTokens } = this.applyTokenBudget(filteredItems, maxTokens, options);

		// Compress if enabled
		let finalItems = items;
		if (options.enableCompression && truncated) {
			finalItems = this.compress(items, options.compressionRatio || 0.7);
		}

		const context: FusedContext = {
			task,
			items: finalItems,
			sources: [...new Set(finalItems.map((i) => i.sourceId))],
			totalTokens,
			truncated,
			fusedAt: Date.now(),
		};

		// Cache result
		if (this.config.cacheResults) {
			this.cache.set(task, { context, timestamp: Date.now() });
		}

		this.emit("fusion:completed", { context });
		return context;
	}

	private async fetchParallel(task: string, sources: ContextSource[]): Promise<ContextItem[]> {
		const fetchPromises = sources.map(async (source) => {
			try {
				return await this.withTimeout(source.fetch(task), this.config.timeoutMs);
			} catch (error) {
				console.warn(`Failed to fetch from source ${source.id}:`, error);
				return [];
			}
		});

		const results = await Promise.all(fetchPromises);
		return results.flat();
	}

	private async fetchSequential(task: string, sources: ContextSource[]): Promise<ContextItem[]> {
		const allItems: ContextItem[] = [];

		for (const source of sources) {
			try {
				const items = await this.withTimeout(source.fetch(task), this.config.timeoutMs);
				allItems.push(...items);
			} catch (error) {
				console.warn(`Failed to fetch from source ${source.id}:`, error);
			}
		}

		return allItems;
	}

	private deduplicate(items: ContextItem[], threshold: number): ContextItem[] {
		const seen: ContextItem[] = [];

		for (const item of items) {
			let isDuplicate = false;

			for (const seenItem of seen) {
				const similarity = this.textSimilarity(item.content, seenItem.content);
				if (similarity >= threshold) {
					isDuplicate = true;
					// Keep the higher relevance one
					if (item.relevance > seenItem.relevance) {
						seen[seen.indexOf(seenItem)] = item;
					}
					break;
				}
			}

			if (!isDuplicate) {
				seen.push(item);
			}
		}

		return seen;
	}

	private textSimilarity(a: string, b: string): number {
		const wordsA = new Set(a.toLowerCase().split(/\s+/));
		const wordsB = new Set(b.toLowerCase().split(/\s+/));

		const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
		const union = new Set([...wordsA, ...wordsB]);

		return intersection.size / union.size;
	}

	private applyTokenBudget(
		items: ContextItem[],
		maxTokens: number,
		_options: Partial<FusionConfig>,
	): { items: ContextItem[]; truncated: boolean; totalTokens: number } {
		const result: ContextItem[] = [];
		let totalTokens = 0;
		let truncated = false;

		for (const item of items) {
			const itemTokens = item.tokens || this.estimateTokens(item.content);

			if (totalTokens + itemTokens <= maxTokens) {
				result.push({ ...item, tokens: itemTokens });
				totalTokens += itemTokens;
			} else {
				truncated = true;
				// Try to fit partial content
				const remainingTokens = maxTokens - totalTokens;
				if (remainingTokens > 50) {
					const truncatedContent = this.truncateToTokens(item.content, remainingTokens);
					result.push({
						...item,
						content: `${truncatedContent}...`,
						tokens: remainingTokens,
					});
					totalTokens = maxTokens;
				}
				break;
			}
		}

		return { items: result, truncated, totalTokens };
	}

	private compress(items: ContextItem[], ratio: number): ContextItem[] {
		return items.map((item) => {
			const targetLength = Math.floor(item.content.length * ratio);
			if (item.content.length <= targetLength) {
				return item;
			}

			// Simple compression: keep first part
			const compressed = item.content.slice(0, targetLength);
			const lastPeriod = compressed.lastIndexOf(".");
			const truncateAt = lastPeriod > targetLength * 0.5 ? lastPeriod + 1 : targetLength;

			return {
				...item,
				content: `${item.content.slice(0, truncateAt)}...`,
				tokens: this.estimateTokens(item.content.slice(0, truncateAt)),
			};
		});
	}

	private estimateTokens(text: string): number {
		// Rough estimate: ~4 chars per token for English
		return Math.ceil(text.length / 4);
	}

	private truncateToTokens(text: string, maxTokens: number): string {
		const targetChars = maxTokens * 4;
		if (text.length <= targetChars) {
			return text;
		}
		return text.slice(0, targetChars);
	}

	private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
		]);
	}

	// ---------------------------------------------------------------------------
	// Context Formatting
	// ---------------------------------------------------------------------------

	format(context: FusedContext, options: { includeMetadata?: boolean; separator?: string } = {}): string {
		const separator = options.separator ?? "\n\n---\n\n";

		const parts: string[] = [];

		for (const item of context.items) {
			let section = item.content;

			if (options.includeMetadata) {
				const source = this.sources.get(item.sourceId);
				section = `[${source?.name || item.sourceId}] (relevance: ${(item.relevance * 100).toFixed(0)}%)\n${section}`;
			}

			parts.push(section);
		}

		return parts.join(separator);
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getSource(id: string): ContextSource | null {
		return this.sources.get(id) || null;
	}

	getAllSources(): ContextSource[] {
		return Array.from(this.sources.values());
	}

	getCacheStats(): { entries: number; hitRate: number } {
		return {
			entries: this.cache.size,
			hitRate: 0, // Would need hit/miss tracking
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clearCache(): void {
		this.cache.clear();
	}

	reset(): void {
		this.sources.clear();
		this.cache.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: ContextFusion | null = null;

export function getContextFusion(config?: Partial<ContextFusionConfig>): ContextFusion {
	if (!instance) {
		instance = new ContextFusion(config);
	}
	return instance;
}

export function resetContextFusion(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
