/**
 * Guild Settings Cache
 * In-memory LRU cache for guild settings to reduce database queries
 */

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

interface GuildSettings {
	prefix?: string;
	defaultModel?: string;
	allowedChannels?: string[];
	rateLimitOverride?: number;
	features?: Record<string, boolean>;
	webhookUrl?: string;
	timezone?: string;
}

class LRUCache<K, V> {
	private cache = new Map<K, CacheEntry<V>>();
	private maxSize: number;
	private defaultTTL: number;

	constructor(maxSize = 1000, defaultTTL = 300000) {
		// 5 min TTL
		this.maxSize = maxSize;
		this.defaultTTL = defaultTTL;
	}

	get(key: K): V | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;

		// Check expiration
		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return undefined;
		}

		// Move to end (most recently used)
		this.cache.delete(key);
		this.cache.set(key, entry);

		return entry.value;
	}

	set(key: K, value: V, ttl = this.defaultTTL): void {
		// Evict oldest if at capacity
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(key, {
			value,
			expiresAt: Date.now() + ttl,
		});
	}

	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	size(): number {
		return this.cache.size;
	}

	// Clean up expired entries
	prune(): number {
		const now = Date.now();
		let pruned = 0;

		for (const [key, entry] of this.cache) {
			if (now > entry.expiresAt) {
				this.cache.delete(key);
				pruned++;
			}
		}

		return pruned;
	}
}

// Singleton cache instance
const guildSettingsCache = new LRUCache<string, GuildSettings>(1000, 300000);

// Database fetch function type
type FetchFunction = (guildId: string) => Promise<GuildSettings | null>;

let dbFetchFn: FetchFunction | null = null;

/**
 * Initialize the guild cache with a database fetch function
 */
export function initGuildCache(fetchFn: FetchFunction): void {
	dbFetchFn = fetchFn;
}

/**
 * Get guild settings (from cache or database)
 */
export async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
	// Check cache first
	const cached = guildSettingsCache.get(guildId);
	if (cached !== undefined) {
		return cached;
	}

	// Fetch from database
	if (!dbFetchFn) {
		return null;
	}

	const settings = await dbFetchFn(guildId);
	if (settings) {
		guildSettingsCache.set(guildId, settings);
	}

	return settings;
}

/**
 * Update guild settings (updates both cache and should persist to DB)
 */
export function updateGuildSettings(guildId: string, settings: GuildSettings): void {
	guildSettingsCache.set(guildId, settings);
}

/**
 * Invalidate cache for a guild (call after DB update)
 */
export function invalidateGuildCache(guildId: string): void {
	guildSettingsCache.delete(guildId);
}

/**
 * Get cache statistics
 */
export function getGuildCacheStats(): { size: number; maxSize: number } {
	return {
		size: guildSettingsCache.size(),
		maxSize: 1000,
	};
}

/**
 * Clear all cached settings
 */
export function clearGuildCache(): void {
	guildSettingsCache.clear();
}

/**
 * Prune expired entries
 */
export function pruneGuildCache(): number {
	return guildSettingsCache.prune();
}

// Auto-prune every 5 minutes
setInterval(() => pruneGuildCache(), 300000);

// Export the cache class for custom use
export { LRUCache };
