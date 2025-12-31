/**
 * Token Bucket Rate Limiter
 * Per-user rate limiting with automatic refill
 */

interface TokenBucket {
	tokens: number;
	lastRefill: number;
}

interface RateLimiterConfig {
	maxTokens: number; // Maximum tokens in bucket
	refillRate: number; // Tokens per second to refill
	defaultCost: number; // Default cost per action
}

const DEFAULT_CONFIG: RateLimiterConfig = {
	maxTokens: 10,
	refillRate: 0.5, // 1 token every 2 seconds
	defaultCost: 1,
};

// User buckets stored in memory
const userBuckets = new Map<string, TokenBucket>();

// Command-specific costs (expensive operations cost more)
const COMMAND_COSTS: Record<string, number> = {
	ask: 2,
	research: 3,
	agent: 3,
	openhands: 5,
	evolve: 4,
	ctm: 3,
	dgm: 4,
	trading: 2,
	generate: 3,
	suno: 4,
	browse: 2,
	default: 1,
};

/**
 * Get the cost for a specific command
 */
export function getCommandCost(command: string): number {
	return COMMAND_COSTS[command] || COMMAND_COSTS.default;
}

/**
 * Check if user has enough tokens and consume them
 * @returns true if action allowed, false if rate limited
 */
export function checkRateLimit(
	userId: string,
	cost?: number,
	config: Partial<RateLimiterConfig> = {},
): { allowed: boolean; remaining: number; resetIn: number } {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const actionCost = cost ?? cfg.defaultCost;

	// Get or create bucket for user
	let bucket = userBuckets.get(userId);
	if (!bucket) {
		bucket = { tokens: cfg.maxTokens, lastRefill: Date.now() };
		userBuckets.set(userId, bucket);
	}

	// Calculate refill since last check
	const now = Date.now();
	const elapsed = (now - bucket.lastRefill) / 1000;
	const refill = elapsed * cfg.refillRate;

	// Refill tokens (capped at max)
	bucket.tokens = Math.min(cfg.maxTokens, bucket.tokens + refill);
	bucket.lastRefill = now;

	// Check if we have enough tokens
	if (bucket.tokens >= actionCost) {
		bucket.tokens -= actionCost;
		userBuckets.set(userId, bucket);
		return {
			allowed: true,
			remaining: Math.floor(bucket.tokens),
			resetIn: 0,
		};
	}

	// Calculate time until enough tokens available
	const tokensNeeded = actionCost - bucket.tokens;
	const resetIn = Math.ceil(tokensNeeded / cfg.refillRate);

	return {
		allowed: false,
		remaining: Math.floor(bucket.tokens),
		resetIn,
	};
}

/**
 * Get remaining tokens for a user (without consuming)
 */
export function getRemainingTokens(userId: string, config: Partial<RateLimiterConfig> = {}): number {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const bucket = userBuckets.get(userId);

	if (!bucket) return cfg.maxTokens;

	const elapsed = (Date.now() - bucket.lastRefill) / 1000;
	const refill = elapsed * cfg.refillRate;
	return Math.min(cfg.maxTokens, Math.floor(bucket.tokens + refill));
}

/**
 * Reset rate limit for a user (admin function)
 */
export function resetRateLimit(userId: string): void {
	userBuckets.delete(userId);
}

/**
 * Get rate limit stats for all users
 */
export function getRateLimitStats(): { totalUsers: number; buckets: Array<{ userId: string; tokens: number }> } {
	const buckets: Array<{ userId: string; tokens: number }> = [];
	for (const [userId, bucket] of userBuckets) {
		buckets.push({ userId, tokens: Math.floor(bucket.tokens) });
	}
	return {
		totalUsers: userBuckets.size,
		buckets: buckets.sort((a, b) => a.tokens - b.tokens).slice(0, 10),
	};
}

/**
 * Clean up old buckets (call periodically)
 */
export function cleanupBuckets(maxAgeMs = 3600000): number {
	const now = Date.now();
	let cleaned = 0;
	for (const [userId, bucket] of userBuckets) {
		if (now - bucket.lastRefill > maxAgeMs) {
			userBuckets.delete(userId);
			cleaned++;
		}
	}
	return cleaned;
}

// Cleanup every hour
setInterval(() => cleanupBuckets(), 3600000);
