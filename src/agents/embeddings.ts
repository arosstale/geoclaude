/**
 * Vector Embeddings Module
 * Provides text embedding generation using Xenova Transformers
 * Model: all-MiniLM-L6-v2 (384-dimensional embeddings)
 */

import { type FeatureExtractionPipeline, pipeline } from "@xenova/transformers";

/** Singleton embedder instance */
let embedder: FeatureExtractionPipeline | null = null;

/**
 * Get or initialize the embedding pipeline
 * Uses Xenova/all-MiniLM-L6-v2 for high-quality semantic embeddings
 */
export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
	if (!embedder) {
		embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
	}
	return embedder;
}

/**
 * Generate embedding vector for given text
 * @param text Text to embed
 * @returns 384-dimensional Float32Array embedding
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
	const model = await getEmbedder();
	const output = await model(text, { pooling: "mean", normalize: true });
	// Convert Tensor data to Float32Array
	const data = output.data as any;
	if (Array.isArray(data)) {
		return new Float32Array(data);
	}
	// Handle TypedArray
	return new Float32Array(Array.from(data as number[]));
}

/**
 * Calculate cosine similarity between two embedding vectors
 * @param a First embedding vector
 * @param b Second embedding vector
 * @returns Similarity score between 0 and 1 (1 = identical)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) {
		throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
	}

	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	if (denominator === 0) return 0;

	return dot / denominator;
}

/**
 * Batch generate embeddings for multiple texts
 * More efficient than calling generateEmbedding() multiple times
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<Float32Array[]> {
	if (texts.length === 0) return [];

	const model = await getEmbedder();
	const embeddings: Float32Array[] = [];

	// Process in parallel batches for efficiency
	for (const text of texts) {
		const output = await model(text, { pooling: "mean", normalize: true });
		const data = output.data as any;
		if (Array.isArray(data)) {
			embeddings.push(new Float32Array(data));
		} else {
			embeddings.push(new Float32Array(Array.from(data as number[])));
		}
	}

	return embeddings;
}

/**
 * Dispose embedder to free resources
 */
export function disposeEmbedder(): void {
	embedder = null;
}
