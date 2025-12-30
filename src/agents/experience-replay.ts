/**
 * Class 3.30: Experience Replay
 *
 * Storage and retrieval of successful agent patterns.
 * Enables learning from past successful executions.
 *
 * Features:
 * - Pattern storage with embeddings
 * - Similarity-based retrieval
 * - Success/failure correlation
 * - Pattern evolution tracking
 *
 * @module experience-replay
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface Experience {
	id: string;
	task: string;
	taskEmbedding?: number[];
	solution: string;
	steps: ExperienceStep[];
	success: boolean;
	score: number;
	domain: string;
	tags: string[];
	createdAt: number;
	usedCount: number;
	lastUsed: number | null;
	metadata?: Record<string, unknown>;
}

export interface ExperienceStep {
	action: string;
	input: Record<string, unknown>;
	output: unknown;
	success: boolean;
	duration: number;
	toolsUsed: string[];
}

export interface ExperienceQuery {
	task?: string;
	domain?: string;
	tags?: string[];
	minScore?: number;
	minSuccessRate?: number;
	limit?: number;
}

export interface ExperienceMatch {
	experience: Experience;
	similarity: number;
	relevance: number;
	applicability: string;
}

export interface PatternCluster {
	id: string;
	name: string;
	pattern: string;
	experiences: string[];
	avgScore: number;
	successRate: number;
	createdAt: number;
}

export interface ExperienceReplayConfig {
	maxExperiences: number;
	similarityThreshold: number;
	minScoreForStorage: number;
	enableClustering: boolean;
	clusterThreshold: number;
	decayRate: number;
}

export interface ExperienceReplayEvents {
	"experience:stored": { experience: Experience };
	"experience:retrieved": { matches: ExperienceMatch[] };
	"experience:applied": { experience: Experience; success: boolean };
	"cluster:created": { cluster: PatternCluster };
	"cluster:updated": { cluster: PatternCluster };
}

export type EmbeddingFunction = (text: string) => Promise<number[]>;

// =============================================================================
// Experience Replay
// =============================================================================

export class ExperienceReplay extends EventEmitter {
	private config: ExperienceReplayConfig;
	private experiences: Map<string, Experience> = new Map();
	private clusters: Map<string, PatternCluster> = new Map();
	private embedFn: EmbeddingFunction | null = null;

	// Indices
	private byDomain: Map<string, Set<string>> = new Map();
	private byTag: Map<string, Set<string>> = new Map();

	constructor(config: Partial<ExperienceReplayConfig> = {}) {
		super();
		this.config = {
			maxExperiences: 10000,
			similarityThreshold: 0.75,
			minScoreForStorage: 0.6,
			enableClustering: true,
			clusterThreshold: 0.85,
			decayRate: 0.99,
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Configuration
	// ---------------------------------------------------------------------------

	setEmbeddingFunction(fn: EmbeddingFunction): void {
		this.embedFn = fn;
	}

	// ---------------------------------------------------------------------------
	// Storage
	// ---------------------------------------------------------------------------

	async store(params: {
		task: string;
		solution: string;
		steps: ExperienceStep[];
		success: boolean;
		score: number;
		domain: string;
		tags?: string[];
		metadata?: Record<string, unknown>;
	}): Promise<Experience | null> {
		// Skip low-quality experiences
		if (params.score < this.config.minScoreForStorage) {
			return null;
		}

		// Evict if at capacity
		while (this.experiences.size >= this.config.maxExperiences) {
			this.evictOne();
		}

		const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const experience: Experience = {
			id,
			task: params.task,
			solution: params.solution,
			steps: params.steps,
			success: params.success,
			score: params.score,
			domain: params.domain,
			tags: params.tags || [],
			createdAt: Date.now(),
			usedCount: 0,
			lastUsed: null,
			metadata: params.metadata,
		};

		// Generate embedding
		if (this.embedFn) {
			try {
				experience.taskEmbedding = await this.embedFn(params.task);
			} catch (error) {
				console.warn("Failed to generate embedding:", error);
			}
		}

		this.experiences.set(id, experience);
		this.indexExperience(experience);

		// Cluster if enabled
		if (this.config.enableClustering) {
			await this.updateClusters(experience);
		}

		this.emit("experience:stored", { experience });
		return experience;
	}

	// ---------------------------------------------------------------------------
	// Retrieval
	// ---------------------------------------------------------------------------

	async retrieve(query: ExperienceQuery): Promise<ExperienceMatch[]> {
		const candidates = this.getCandidates(query);
		const matches: ExperienceMatch[] = [];

		for (const experience of candidates) {
			// Apply filters
			if (query.minScore && experience.score < query.minScore) continue;

			// Calculate similarity
			let similarity = 0;
			if (query.task && this.embedFn && experience.taskEmbedding) {
				try {
					const queryEmbedding = await this.embedFn(query.task);
					similarity = this.cosineSimilarity(queryEmbedding, experience.taskEmbedding);
				} catch {
					// Fall back to text similarity
					similarity = this.textSimilarity(query.task, experience.task);
				}
			} else if (query.task) {
				similarity = this.textSimilarity(query.task, experience.task);
			} else {
				similarity = 1; // No task filter
			}

			if (similarity >= this.config.similarityThreshold) {
				matches.push({
					experience,
					similarity,
					relevance: this.calculateRelevance(experience, query),
					applicability: this.assessApplicability(experience, query),
				});
			}
		}

		// Sort by combined score
		matches.sort((a, b) => {
			const scoreA = a.similarity * 0.5 + a.relevance * 0.5;
			const scoreB = b.similarity * 0.5 + b.relevance * 0.5;
			return scoreB - scoreA;
		});

		const result = matches.slice(0, query.limit || 10);
		this.emit("experience:retrieved", { matches: result });
		return result;
	}

	async findSimilar(task: string, limit = 5): Promise<ExperienceMatch[]> {
		return this.retrieve({ task, limit });
	}

	// ---------------------------------------------------------------------------
	// Application
	// ---------------------------------------------------------------------------

	markUsed(experienceId: string, success: boolean): void {
		const experience = this.experiences.get(experienceId);
		if (!experience) return;

		experience.usedCount++;
		experience.lastUsed = Date.now();

		// Adjust score based on reuse success
		if (success) {
			experience.score = Math.min(1, experience.score * 1.05);
		} else {
			experience.score = Math.max(0, experience.score * 0.95);
		}

		this.emit("experience:applied", { experience, success });
	}

	// ---------------------------------------------------------------------------
	// Clustering
	// ---------------------------------------------------------------------------

	private async updateClusters(experience: Experience): Promise<void> {
		if (!experience.taskEmbedding) return;

		// Find matching cluster
		let bestCluster: PatternCluster | null = null;
		let bestSimilarity = 0;

		for (const cluster of this.clusters.values()) {
			const clusterExperiences = cluster.experiences
				.map((id) => this.experiences.get(id))
				.filter((e): e is Experience => !!e && !!e.taskEmbedding);

			if (clusterExperiences.length === 0) continue;

			// Calculate average similarity to cluster
			let totalSim = 0;
			for (const clusterExp of clusterExperiences) {
				totalSim += this.cosineSimilarity(experience.taskEmbedding, clusterExp.taskEmbedding!);
			}
			const avgSim = totalSim / clusterExperiences.length;

			if (avgSim >= this.config.clusterThreshold && avgSim > bestSimilarity) {
				bestSimilarity = avgSim;
				bestCluster = cluster;
			}
		}

		if (bestCluster) {
			// Add to existing cluster
			bestCluster.experiences.push(experience.id);
			this.recalculateClusterStats(bestCluster);
			this.emit("cluster:updated", { cluster: bestCluster });
		} else {
			// Create new cluster
			const cluster: PatternCluster = {
				id: `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
				name: this.generateClusterName(experience),
				pattern: this.extractPattern(experience),
				experiences: [experience.id],
				avgScore: experience.score,
				successRate: experience.success ? 1 : 0,
				createdAt: Date.now(),
			};
			this.clusters.set(cluster.id, cluster);
			this.emit("cluster:created", { cluster });
		}
	}

	private recalculateClusterStats(cluster: PatternCluster): void {
		const experiences = cluster.experiences
			.map((id) => this.experiences.get(id))
			.filter((e): e is Experience => !!e);

		if (experiences.length === 0) return;

		cluster.avgScore = experiences.reduce((sum, e) => sum + e.score, 0) / experiences.length;
		cluster.successRate = experiences.filter((e) => e.success).length / experiences.length;
	}

	private generateClusterName(experience: Experience): string {
		// Extract key action from first step
		const firstStep = experience.steps[0];
		if (firstStep) {
			return `${experience.domain}: ${firstStep.action}`;
		}
		return `${experience.domain}: ${experience.task.slice(0, 50)}`;
	}

	private extractPattern(experience: Experience): string {
		// Create a pattern description from steps
		const actions = experience.steps.map((s) => s.action).join(" -> ");
		return `Pattern: ${actions}`;
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private getCandidates(query: ExperienceQuery): Experience[] {
		let candidateIds: Set<string> | null = null;

		// Domain filter
		if (query.domain) {
			candidateIds = this.byDomain.get(query.domain) || new Set();
		}

		// Tag filter
		if (query.tags && query.tags.length > 0) {
			for (const tag of query.tags) {
				const tagIds = this.byTag.get(tag);
				if (!tagIds) continue;

				if (candidateIds === null) {
					candidateIds = new Set(tagIds);
				} else {
					// Intersection
					candidateIds = new Set([...candidateIds].filter((id) => tagIds.has(id)));
				}
			}
		}

		// If no filters, use all
		if (candidateIds === null) {
			return Array.from(this.experiences.values());
		}

		return [...candidateIds]
			.map((id) => this.experiences.get(id))
			.filter((e): e is Experience => !!e);
	}

	private indexExperience(experience: Experience): void {
		// Domain index
		if (!this.byDomain.has(experience.domain)) {
			this.byDomain.set(experience.domain, new Set());
		}
		this.byDomain.get(experience.domain)!.add(experience.id);

		// Tag index
		for (const tag of experience.tags) {
			if (!this.byTag.has(tag)) {
				this.byTag.set(tag, new Set());
			}
			this.byTag.get(tag)!.add(experience.id);
		}
	}

	private calculateRelevance(experience: Experience, query: ExperienceQuery): number {
		let relevance = experience.score;

		// Boost for matching domain
		if (query.domain && experience.domain === query.domain) {
			relevance *= 1.2;
		}

		// Boost for matching tags
		if (query.tags) {
			const matchingTags = experience.tags.filter((t) => query.tags!.includes(t));
			relevance *= 1 + matchingTags.length * 0.1;
		}

		// Boost for recent usage
		if (experience.lastUsed) {
			const recency = Date.now() - experience.lastUsed;
			const daysSinceUse = recency / (1000 * 60 * 60 * 24);
			relevance *= Math.pow(this.config.decayRate, daysSinceUse);
		}

		// Boost for high usage count
		relevance *= 1 + Math.log10(experience.usedCount + 1) * 0.1;

		return Math.min(1, relevance);
	}

	private assessApplicability(experience: Experience, query: ExperienceQuery): string {
		if (experience.score >= 0.9 && experience.success) {
			return "Highly applicable - proven successful pattern";
		} else if (experience.score >= 0.7) {
			return "Moderately applicable - may need adaptation";
		} else if (experience.success) {
			return "Potentially applicable - exercise caution";
		} else {
			return "Reference only - learn from mistakes";
		}
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) return 0;

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const denominator = Math.sqrt(normA) * Math.sqrt(normB);
		return denominator === 0 ? 0 : dotProduct / denominator;
	}

	private textSimilarity(a: string, b: string): number {
		const wordsA = new Set(a.toLowerCase().split(/\s+/));
		const wordsB = new Set(b.toLowerCase().split(/\s+/));

		const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
		const union = new Set([...wordsA, ...wordsB]);

		return intersection.size / union.size;
	}

	private evictOne(): void {
		// Find least valuable experience
		let target: Experience | null = null;
		let lowestValue = Infinity;

		for (const experience of this.experiences.values()) {
			const value = this.calculateValue(experience);
			if (value < lowestValue) {
				lowestValue = value;
				target = experience;
			}
		}

		if (target) {
			this.remove(target.id);
		}
	}

	private calculateValue(experience: Experience): number {
		// Value based on score, usage, and recency
		let value = experience.score;
		value *= 1 + Math.log10(experience.usedCount + 1) * 0.5;

		if (experience.lastUsed) {
			const recency = Date.now() - experience.lastUsed;
			const daysSinceUse = recency / (1000 * 60 * 60 * 24);
			value *= Math.pow(this.config.decayRate, daysSinceUse);
		}

		return value;
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getExperience(id: string): Experience | null {
		return this.experiences.get(id) || null;
	}

	getCluster(id: string): PatternCluster | null {
		return this.clusters.get(id) || null;
	}

	getAllClusters(): PatternCluster[] {
		return Array.from(this.clusters.values());
	}

	getStats(): {
		totalExperiences: number;
		totalClusters: number;
		avgScore: number;
		successRate: number;
		domainBreakdown: Map<string, number>;
	} {
		const experiences = Array.from(this.experiences.values());

		const domainBreakdown = new Map<string, number>();
		for (const exp of experiences) {
			domainBreakdown.set(exp.domain, (domainBreakdown.get(exp.domain) || 0) + 1);
		}

		return {
			totalExperiences: experiences.length,
			totalClusters: this.clusters.size,
			avgScore: experiences.length > 0 ? experiences.reduce((sum, e) => sum + e.score, 0) / experiences.length : 0,
			successRate: experiences.length > 0 ? experiences.filter((e) => e.success).length / experiences.length : 0,
			domainBreakdown,
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	remove(id: string): boolean {
		const experience = this.experiences.get(id);
		if (!experience) return false;

		// Remove from indices
		this.byDomain.get(experience.domain)?.delete(id);
		for (const tag of experience.tags) {
			this.byTag.get(tag)?.delete(id);
		}

		// Remove from clusters
		for (const cluster of this.clusters.values()) {
			const idx = cluster.experiences.indexOf(id);
			if (idx !== -1) {
				cluster.experiences.splice(idx, 1);
				if (cluster.experiences.length === 0) {
					this.clusters.delete(cluster.id);
				} else {
					this.recalculateClusterStats(cluster);
				}
			}
		}

		this.experiences.delete(id);
		return true;
	}

	clear(): void {
		this.experiences.clear();
		this.clusters.clear();
		this.byDomain.clear();
		this.byTag.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: ExperienceReplay | null = null;

export function getExperienceReplay(config?: Partial<ExperienceReplayConfig>): ExperienceReplay {
	if (!instance) {
		instance = new ExperienceReplay(config);
	}
	return instance;
}

export function resetExperienceReplay(): void {
	if (instance) {
		instance.clear();
	}
	instance = null;
}
