/**
 * Class 3.48: Cache Layer
 * TAC Pattern: Multi-tier caching system for performance optimization
 *
 * Features:
 * - L1 memory cache (fast, limited size)
 * - L2 disk cache (persistent, larger capacity)
 * - TTL (time-to-live) support
 * - LRU eviction policy
 * - Cache warming strategies
 * - Invalidation patterns (key, pattern, namespace, tags)
 * - Namespace support for isolation
 * - Optional compression for large values
 * - Comprehensive statistics
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { join } from 'path';
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';

// ============================================================================
// Types
// ============================================================================

export type CacheTier = 'l1' | 'l2' | 'both';
export type EvictionPolicy = 'lru' | 'lfu' | 'fifo' | 'ttl';
export type InvalidationStrategy = 'key' | 'pattern' | 'namespace' | 'tags' | 'all';

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  namespace?: string;
  tags?: string[];
  ttlMs?: number;
  createdAt: number;
  expiresAt?: number;
  accessCount: number;
  lastAccessedAt: number;
  size: number;
  compressed: boolean;
  tier: CacheTier;
  metadata?: Record<string, unknown>;
}

export interface CacheGetResult<T = unknown> {
  value: T | null;
  hit: boolean;
  tier?: CacheTier;
  age?: number;
  ttlRemaining?: number;
}

export interface CacheSetOptions {
  ttlMs?: number;
  namespace?: string;
  tags?: string[];
  tier?: CacheTier;
  compress?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CacheInvalidation {
  id: string;
  strategy: InvalidationStrategy;
  pattern?: string;
  namespace?: string;
  tags?: string[];
  keys?: string[];
  timestamp: Date;
  entriesRemoved: number;
}

export interface CacheWarmer {
  id: string;
  name: string;
  schedule: string;  // Cron expression
  namespace?: string;
  loader: () => Promise<Array<{ key: string; value: unknown; options?: CacheSetOptions }>>;
  enabled: boolean;
  lastRun?: Date;
  lastDuration?: number;
  lastEntriesWarmed?: number;
}

export interface CacheStats {
  l1Entries: number;
  l1SizeBytes: number;
  l1HitRate: number;
  l2Entries: number;
  l2SizeBytes: number;
  l2HitRate: number;
  totalHits: number;
  totalMisses: number;
  totalEvictions: number;
  totalInvalidations: number;
  avgGetLatencyMs: number;
  avgSetLatencyMs: number;
  namespaces: string[];
  compressionRatio: number;
}

export interface NamespaceStats {
  namespace: string;
  entries: number;
  sizeBytes: number;
  hitRate: number;
  avgTtlMs: number;
}

export interface L1Config {
  maxEntries: number;
  maxSizeBytes: number;
  defaultTtlMs: number;
  evictionPolicy: EvictionPolicy;
}

export interface L2Config {
  maxEntries: number;
  maxSizeBytes: number;
  defaultTtlMs: number;
  compressionThreshold: number;  // Bytes above which to compress
}

export interface CacheConfig {
  dataDir: string;
  l1: L1Config;
  l2: L2Config;
  cleanupIntervalMs: number;
  enableL2: boolean;
  promoteOnHit: boolean;  // Promote L2 hits to L1
  writeThrough: boolean;  // Write to both L1 and L2
  statsRetentionHours: number;
}

// ============================================================================
// L1 Memory Cache
// ============================================================================

class L1Cache extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private config: L1Config;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalGetLatency: 0,
    totalSetLatency: 0,
    operations: 0,
  };

  constructor(config: L1Config) {
    super();
    this.config = config;
  }

  get<T>(key: string): CacheEntry<T> | null {
    const start = performance.now();

    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      this.recordLatency('get', start);
      return null;
    }

    // Check TTL
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.recordLatency('get', start);
      return null;
    }

    // Update access stats for LRU/LFU
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

    this.stats.hits++;
    this.recordLatency('get', start);

    return entry;
  }

  set<T>(key: string, value: T, options: CacheSetOptions = {}): CacheEntry<T> {
    const start = performance.now();

    // Evict if necessary
    this.evictIfNeeded();

    const now = Date.now();
    const serialized = JSON.stringify(value);
    const size = Buffer.byteLength(serialized, 'utf8');

    const entry: CacheEntry<T> = {
      key,
      value,
      namespace: options.namespace,
      tags: options.tags,
      ttlMs: options.ttlMs ?? this.config.defaultTtlMs,
      createdAt: now,
      expiresAt: options.ttlMs ? now + options.ttlMs : undefined,
      accessCount: 1,
      lastAccessedAt: now,
      size,
      compressed: false,
      tier: 'l1',
      metadata: options.metadata,
    };

    this.cache.set(key, entry as CacheEntry);

    this.recordLatency('set', start);
    this.emit('set', entry);

    return entry;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  clear(): number {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  clearNamespace(namespace: string): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (entry.namespace === namespace) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clearByTags(tags: string[]): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (entry.tags && tags.some(t => entry.tags!.includes(t))) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clearByPattern(pattern: string): number {
    let count = 0;
    const regex = new RegExp(pattern);
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  getAll(): CacheEntry[] {
    return Array.from(this.cache.values());
  }

  getStats(): { entries: number; sizeBytes: number; hitRate: number; evictions: number } {
    const entries = this.cache.size;
    let sizeBytes = 0;

    for (const entry of this.cache.values()) {
      sizeBytes += entry.size;
    }

    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      entries,
      sizeBytes,
      hitRate,
      evictions: this.stats.evictions,
    };
  }

  getAvgGetLatency(): number {
    return this.stats.operations > 0
      ? this.stats.totalGetLatency / this.stats.operations
      : 0;
  }

  getAvgSetLatency(): number {
    return this.stats.operations > 0
      ? this.stats.totalSetLatency / this.stats.operations
      : 0;
  }

  private recordLatency(op: 'get' | 'set', start: number): void {
    const duration = performance.now() - start;
    if (op === 'get') {
      this.stats.totalGetLatency += duration;
    } else {
      this.stats.totalSetLatency += duration;
    }
    this.stats.operations++;
  }

  private evictIfNeeded(): void {
    // Check entry count
    if (this.cache.size >= this.config.maxEntries) {
      this.evictOne();
    }

    // Check size
    let totalSize = 0;
    for (const entry of this.cache.values()) {
      totalSize += entry.size;
    }

    while (totalSize > this.config.maxSizeBytes && this.cache.size > 0) {
      const evicted = this.evictOne();
      if (evicted) {
        totalSize -= evicted.size;
      } else {
        break;
      }
    }
  }

  private evictOne(): CacheEntry | null {
    if (this.cache.size === 0) return null;

    let keyToEvict: string | null = null;
    let entryToEvict: CacheEntry | null = null;

    switch (this.config.evictionPolicy) {
      case 'lru': {
        let oldest = Infinity;
        for (const [key, entry] of this.cache) {
          if (entry.lastAccessedAt < oldest) {
            oldest = entry.lastAccessedAt;
            keyToEvict = key;
            entryToEvict = entry;
          }
        }
        break;
      }

      case 'lfu': {
        let lowest = Infinity;
        for (const [key, entry] of this.cache) {
          if (entry.accessCount < lowest) {
            lowest = entry.accessCount;
            keyToEvict = key;
            entryToEvict = entry;
          }
        }
        break;
      }

      case 'fifo': {
        let oldest = Infinity;
        for (const [key, entry] of this.cache) {
          if (entry.createdAt < oldest) {
            oldest = entry.createdAt;
            keyToEvict = key;
            entryToEvict = entry;
          }
        }
        break;
      }

      case 'ttl': {
        // Evict entries closest to expiration
        let soonest = Infinity;
        for (const [key, entry] of this.cache) {
          const expiry = entry.expiresAt ?? Infinity;
          if (expiry < soonest) {
            soonest = expiry;
            keyToEvict = key;
            entryToEvict = entry;
          }
        }
        break;
      }
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
      this.stats.evictions++;
      this.emit('evict', entryToEvict);
    }

    return entryToEvict;
  }

  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }
}

// ============================================================================
// Cache Layer System
// ============================================================================

export class CacheLayerSystem extends EventEmitter {
  private db: Database.Database;
  private config: CacheConfig;
  private l1: L1Cache;
  private warmers: Map<string, CacheWarmer> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private stats = {
    totalHits: 0,
    totalMisses: 0,
    totalEvictions: 0,
    totalInvalidations: 0,
    l2Hits: 0,
    l2Misses: 0,
    compressedEntries: 0,
    totalCompressedSize: 0,
    totalUncompressedSize: 0,
  };

  constructor(config: CacheConfig) {
    super();
    this.config = config;
    this.l1 = new L1Cache(config.l1);
    this.db = new Database(join(config.dataDir, 'cache_layer.db'));
    this.initializeDatabase();
    this.setupL1Events();
    this.startCleanupScheduler();
  }

  private initializeDatabase(): void {
    this.db.pragma('journal_mode = WAL');

    // L2 cache entries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL,
        namespace TEXT,
        tags TEXT,
        ttl_ms INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 1,
        last_accessed_at INTEGER NOT NULL,
        size INTEGER NOT NULL,
        compressed INTEGER NOT NULL DEFAULT 0,
        metadata TEXT
      )
    `);

    // Cache warmers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_warmers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schedule TEXT NOT NULL,
        namespace TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run TEXT,
        last_duration INTEGER,
        last_entries_warmed INTEGER
      )
    `);

    // Invalidation log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invalidation_log (
        id TEXT PRIMARY KEY,
        strategy TEXT NOT NULL,
        pattern TEXT,
        namespace TEXT,
        tags TEXT,
        keys_affected TEXT,
        timestamp TEXT NOT NULL,
        entries_removed INTEGER NOT NULL
      )
    `);

    // Stats history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stats_history (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        l1_entries INTEGER NOT NULL,
        l1_size_bytes INTEGER NOT NULL,
        l1_hit_rate REAL NOT NULL,
        l2_entries INTEGER NOT NULL,
        l2_size_bytes INTEGER NOT NULL,
        l2_hit_rate REAL NOT NULL,
        total_hits INTEGER NOT NULL,
        total_misses INTEGER NOT NULL
      )
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cache_namespace ON cache_entries(namespace);
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at);
      CREATE INDEX IF NOT EXISTS idx_cache_accessed ON cache_entries(last_accessed_at);
      CREATE INDEX IF NOT EXISTS idx_invalidation_timestamp ON invalidation_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_stats_timestamp ON stats_history(timestamp);
    `);
  }

  private setupL1Events(): void {
    this.l1.on('evict', (entry: CacheEntry) => {
      this.stats.totalEvictions++;
      this.emit('evict', { tier: 'l1', entry });
    });

    this.l1.on('set', (entry: CacheEntry) => {
      // Write-through to L2 if enabled
      if (this.config.writeThrough && this.config.enableL2) {
        this.setL2(entry.key, entry.value, {
          ttlMs: entry.ttlMs,
          namespace: entry.namespace,
          tags: entry.tags,
          metadata: entry.metadata,
        });
      }
    });
  }

  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
      this.recordStatsSnapshot();
    }, this.config.cleanupIntervalMs);
  }

  // ============================================================================
  // Core Cache Operations
  // ============================================================================

  async get<T = unknown>(key: string, options: { namespace?: string } = {}): Promise<CacheGetResult<T>> {
    const fullKey = this.buildKey(key, options.namespace);

    // Try L1 first
    const l1Entry = this.l1.get<T>(fullKey);
    if (l1Entry) {
      this.stats.totalHits++;
      return {
        value: l1Entry.value,
        hit: true,
        tier: 'l1',
        age: Date.now() - l1Entry.createdAt,
        ttlRemaining: l1Entry.expiresAt ? l1Entry.expiresAt - Date.now() : undefined,
      };
    }

    // Try L2 if enabled
    if (this.config.enableL2) {
      const l2Entry = this.getL2<T>(fullKey);
      if (l2Entry) {
        this.stats.totalHits++;
        this.stats.l2Hits++;

        // Promote to L1 if configured
        if (this.config.promoteOnHit) {
          this.l1.set(fullKey, l2Entry.value, {
            ttlMs: l2Entry.ttlMs,
            namespace: l2Entry.namespace,
            tags: l2Entry.tags,
            metadata: l2Entry.metadata,
          });
        }

        return {
          value: l2Entry.value,
          hit: true,
          tier: 'l2',
          age: Date.now() - l2Entry.createdAt,
          ttlRemaining: l2Entry.expiresAt ? l2Entry.expiresAt - Date.now() : undefined,
        };
      }
      this.stats.l2Misses++;
    }

    this.stats.totalMisses++;
    return { value: null, hit: false };
  }

  async set<T = unknown>(key: string, value: T, options: CacheSetOptions = {}): Promise<CacheEntry<T>> {
    const fullKey = this.buildKey(key, options.namespace);
    const tier = options.tier ?? 'both';

    let entry: CacheEntry<T> | null = null;

    // Set in L1
    if (tier === 'l1' || tier === 'both') {
      entry = this.l1.set(fullKey, value, options);
    }

    // Set in L2 if enabled
    if (this.config.enableL2 && (tier === 'l2' || tier === 'both')) {
      const l2Entry = this.setL2(fullKey, value, options);
      if (!entry) entry = l2Entry;
    }

    this.emit('set', { key: fullKey, tier, entry });

    return entry!;
  }

  async delete(key: string, options: { namespace?: string } = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);

    const l1Deleted = this.l1.delete(fullKey);
    let l2Deleted = false;

    if (this.config.enableL2) {
      const stmt = this.db.prepare('DELETE FROM cache_entries WHERE key = ?');
      const result = stmt.run(fullKey);
      l2Deleted = result.changes > 0;
    }

    this.emit('delete', { key: fullKey, l1: l1Deleted, l2: l2Deleted });

    return l1Deleted || l2Deleted;
  }

  async has(key: string, options: { namespace?: string } = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);

    if (this.l1.has(fullKey)) return true;

    if (this.config.enableL2) {
      const stmt = this.db.prepare(`
        SELECT 1 FROM cache_entries
        WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)
      `);
      const result = stmt.get(fullKey, Date.now());
      if (result) return true;
    }

    return false;
  }

  async getOrSet<T = unknown>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions = {}
  ): Promise<T> {
    const result = await this.get<T>(key, { namespace: options.namespace });

    if (result.hit && result.value !== null) {
      return result.value;
    }

    const value = await loader();
    await this.set(key, value, options);

    return value;
  }

  async mget<T = unknown>(keys: string[], options: { namespace?: string } = {}): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();

    for (const key of keys) {
      const result = await this.get<T>(key, options);
      results.set(key, result.value);
    }

    return results;
  }

  async mset<T = unknown>(entries: Array<{ key: string; value: T; options?: CacheSetOptions }>): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.options);
    }
  }

  // ============================================================================
  // L2 Cache Operations
  // ============================================================================

  private getL2<T>(key: string): CacheEntry<T> | null {
    const stmt = this.db.prepare(`
      SELECT * FROM cache_entries
      WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)
    `);
    const row = stmt.get(key, Date.now()) as Record<string, unknown> | undefined;

    if (!row) return null;

    // Update access stats
    const updateStmt = this.db.prepare(`
      UPDATE cache_entries
      SET access_count = access_count + 1, last_accessed_at = ?
      WHERE key = ?
    `);
    updateStmt.run(Date.now(), key);

    // Decompress value if needed
    let value: T;
    const valueBuffer = row.value as Buffer;

    if (row.compressed) {
      const decompressed = gunzipSync(valueBuffer);
      value = JSON.parse(decompressed.toString('utf8'));
    } else {
      value = JSON.parse(valueBuffer.toString('utf8'));
    }

    return {
      key: row.key as string,
      value,
      namespace: row.namespace as string | undefined,
      tags: row.tags ? JSON.parse(row.tags as string) : undefined,
      ttlMs: row.ttl_ms as number | undefined,
      createdAt: row.created_at as number,
      expiresAt: row.expires_at as number | undefined,
      accessCount: row.access_count as number,
      lastAccessedAt: row.last_accessed_at as number,
      size: row.size as number,
      compressed: Boolean(row.compressed),
      tier: 'l2',
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  private setL2<T>(key: string, value: T, options: CacheSetOptions = {}): CacheEntry<T> {
    const now = Date.now();
    const ttlMs = options.ttlMs ?? this.config.l2.defaultTtlMs;
    const expiresAt = ttlMs ? now + ttlMs : null;

    // Serialize and optionally compress
    const serialized = JSON.stringify(value);
    const uncompressedSize = Buffer.byteLength(serialized, 'utf8');
    let valueBuffer: Buffer;
    let compressed = false;

    if (options.compress !== false && uncompressedSize > this.config.l2.compressionThreshold) {
      valueBuffer = gzipSync(Buffer.from(serialized, 'utf8'));
      compressed = true;
      this.stats.compressedEntries++;
      this.stats.totalCompressedSize += valueBuffer.length;
      this.stats.totalUncompressedSize += uncompressedSize;
    } else {
      valueBuffer = Buffer.from(serialized, 'utf8');
    }

    const size = valueBuffer.length;

    // Evict if L2 is full
    this.evictL2IfNeeded(size);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cache_entries
      (key, value, namespace, tags, ttl_ms, created_at, expires_at, access_count, last_accessed_at, size, compressed, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      key,
      valueBuffer,
      options.namespace ?? null,
      options.tags ? JSON.stringify(options.tags) : null,
      ttlMs ?? null,
      now,
      expiresAt,
      1,
      now,
      size,
      compressed ? 1 : 0,
      options.metadata ? JSON.stringify(options.metadata) : null
    );

    return {
      key,
      value,
      namespace: options.namespace,
      tags: options.tags,
      ttlMs,
      createdAt: now,
      expiresAt: expiresAt ?? undefined,
      accessCount: 1,
      lastAccessedAt: now,
      size,
      compressed,
      tier: 'l2',
      metadata: options.metadata,
    };
  }

  private evictL2IfNeeded(newEntrySize: number): void {
    // Check entry count
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM cache_entries');
    const countResult = countStmt.get() as { count: number };

    if (countResult.count >= this.config.l2.maxEntries) {
      this.evictL2Lru(1);
    }

    // Check size
    const sizeStmt = this.db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM cache_entries');
    const sizeResult = sizeStmt.get() as { total: number };

    while (sizeResult.total + newEntrySize > this.config.l2.maxSizeBytes) {
      const evicted = this.evictL2Lru(1);
      if (evicted === 0) break;
      sizeResult.total -= evicted;
    }
  }

  private evictL2Lru(count: number): number {
    const selectStmt = this.db.prepare(`
      SELECT key, size FROM cache_entries
      ORDER BY last_accessed_at ASC
      LIMIT ?
    `);
    const rows = selectStmt.all(count) as Array<{ key: string; size: number }>;

    if (rows.length === 0) return 0;

    const keys = rows.map(r => r.key);
    const totalSize = rows.reduce((sum, r) => sum + r.size, 0);

    const deleteStmt = this.db.prepare(`
      DELETE FROM cache_entries WHERE key IN (${keys.map(() => '?').join(',')})
    `);
    deleteStmt.run(...keys);

    this.stats.totalEvictions += rows.length;

    for (const row of rows) {
      this.emit('evict', { tier: 'l2', key: row.key });
    }

    return totalSize;
  }

  // ============================================================================
  // Invalidation
  // ============================================================================

  invalidate(params: {
    strategy: InvalidationStrategy;
    key?: string;
    pattern?: string;
    namespace?: string;
    tags?: string[];
  }): CacheInvalidation {
    const id = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let entriesRemoved = 0;
    const keysAffected: string[] = [];

    switch (params.strategy) {
      case 'key':
        if (params.key) {
          const fullKey = this.buildKey(params.key, params.namespace);
          if (this.l1.delete(fullKey)) {
            entriesRemoved++;
            keysAffected.push(fullKey);
          }
          if (this.config.enableL2) {
            const stmt = this.db.prepare('DELETE FROM cache_entries WHERE key = ?');
            const result = stmt.run(fullKey);
            if (result.changes > 0 && !keysAffected.includes(fullKey)) {
              entriesRemoved++;
              keysAffected.push(fullKey);
            }
          }
        }
        break;

      case 'pattern':
        if (params.pattern) {
          entriesRemoved += this.l1.clearByPattern(params.pattern);
          if (this.config.enableL2) {
            const stmt = this.db.prepare('SELECT key FROM cache_entries WHERE key LIKE ?');
            const pattern = params.pattern.replace(/\*/g, '%');
            const rows = stmt.all(pattern) as Array<{ key: string }>;
            keysAffected.push(...rows.map(r => r.key));

            const deleteStmt = this.db.prepare('DELETE FROM cache_entries WHERE key LIKE ?');
            const result = deleteStmt.run(pattern);
            entriesRemoved += result.changes;
          }
        }
        break;

      case 'namespace':
        if (params.namespace) {
          entriesRemoved += this.l1.clearNamespace(params.namespace);
          if (this.config.enableL2) {
            const stmt = this.db.prepare('SELECT key FROM cache_entries WHERE namespace = ?');
            const rows = stmt.all(params.namespace) as Array<{ key: string }>;
            keysAffected.push(...rows.map(r => r.key));

            const deleteStmt = this.db.prepare('DELETE FROM cache_entries WHERE namespace = ?');
            const result = deleteStmt.run(params.namespace);
            entriesRemoved += result.changes;
          }
        }
        break;

      case 'tags':
        if (params.tags && params.tags.length > 0) {
          entriesRemoved += this.l1.clearByTags(params.tags);
          if (this.config.enableL2) {
            // SQLite doesn't have native JSON array contains, so we use LIKE
            for (const tag of params.tags) {
              const stmt = this.db.prepare(`SELECT key FROM cache_entries WHERE tags LIKE ?`);
              const rows = stmt.all(`%"${tag}"%`) as Array<{ key: string }>;
              keysAffected.push(...rows.map(r => r.key));

              const deleteStmt = this.db.prepare(`DELETE FROM cache_entries WHERE tags LIKE ?`);
              const result = deleteStmt.run(`%"${tag}"%`);
              entriesRemoved += result.changes;
            }
          }
        }
        break;

      case 'all':
        entriesRemoved += this.l1.clear();
        if (this.config.enableL2) {
          const stmt = this.db.prepare('DELETE FROM cache_entries');
          const result = stmt.run();
          entriesRemoved += result.changes;
        }
        break;
    }

    this.stats.totalInvalidations += entriesRemoved;

    const invalidation: CacheInvalidation = {
      id,
      strategy: params.strategy,
      pattern: params.pattern,
      namespace: params.namespace,
      tags: params.tags,
      keys: keysAffected,
      timestamp: new Date(),
      entriesRemoved,
    };

    // Log invalidation
    this.logInvalidation(invalidation);

    this.emit('invalidate', invalidation);

    return invalidation;
  }

  private logInvalidation(invalidation: CacheInvalidation): void {
    const stmt = this.db.prepare(`
      INSERT INTO invalidation_log
      (id, strategy, pattern, namespace, tags, keys_affected, timestamp, entries_removed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      invalidation.id,
      invalidation.strategy,
      invalidation.pattern ?? null,
      invalidation.namespace ?? null,
      invalidation.tags ? JSON.stringify(invalidation.tags) : null,
      invalidation.keys ? JSON.stringify(invalidation.keys) : null,
      invalidation.timestamp.toISOString(),
      invalidation.entriesRemoved
    );
  }

  getInvalidationHistory(limit: number = 100): CacheInvalidation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM invalidation_log
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      strategy: row.strategy as InvalidationStrategy,
      pattern: row.pattern as string | undefined,
      namespace: row.namespace as string | undefined,
      tags: row.tags ? JSON.parse(row.tags as string) : undefined,
      keys: row.keys_affected ? JSON.parse(row.keys_affected as string) : undefined,
      timestamp: new Date(row.timestamp as string),
      entriesRemoved: row.entries_removed as number,
    }));
  }

  // ============================================================================
  // Cache Warming
  // ============================================================================

  registerWarmer(params: {
    name: string;
    schedule: string;
    namespace?: string;
    loader: () => Promise<Array<{ key: string; value: unknown; options?: CacheSetOptions }>>;
  }): CacheWarmer {
    const id = `warmer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const warmer: CacheWarmer = {
      id,
      name: params.name,
      schedule: params.schedule,
      namespace: params.namespace,
      loader: params.loader,
      enabled: true,
    };

    this.warmers.set(id, warmer);

    // Save to database (without loader function)
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cache_warmers
      (id, name, schedule, namespace, enabled)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, params.name, params.schedule, params.namespace ?? null, 1);

    this.emit('warmer:registered', warmer);

    return warmer;
  }

  async runWarmer(warmerId: string): Promise<{ success: boolean; entriesWarmed: number; duration: number }> {
    const warmer = this.warmers.get(warmerId);
    if (!warmer) {
      throw new Error(`Warmer ${warmerId} not found`);
    }

    if (!warmer.enabled) {
      return { success: false, entriesWarmed: 0, duration: 0 };
    }

    const start = Date.now();

    try {
      const entries = await warmer.loader();

      for (const entry of entries) {
        await this.set(entry.key, entry.value, {
          ...entry.options,
          namespace: entry.options?.namespace ?? warmer.namespace,
        });
      }

      const duration = Date.now() - start;

      // Update warmer stats
      warmer.lastRun = new Date();
      warmer.lastDuration = duration;
      warmer.lastEntriesWarmed = entries.length;

      const updateStmt = this.db.prepare(`
        UPDATE cache_warmers
        SET last_run = ?, last_duration = ?, last_entries_warmed = ?
        WHERE id = ?
      `);
      updateStmt.run(warmer.lastRun.toISOString(), duration, entries.length, warmerId);

      this.emit('warmer:completed', { warmer, entriesWarmed: entries.length, duration });

      return { success: true, entriesWarmed: entries.length, duration };
    } catch (error) {
      this.emit('warmer:error', { warmer, error });
      return { success: false, entriesWarmed: 0, duration: Date.now() - start };
    }
  }

  async warmAll(): Promise<Array<{ warmerId: string; success: boolean; entriesWarmed: number }>> {
    const results: Array<{ warmerId: string; success: boolean; entriesWarmed: number }> = [];

    for (const [warmerId, warmer] of this.warmers) {
      if (warmer.enabled) {
        const result = await this.runWarmer(warmerId);
        results.push({ warmerId, ...result });
      }
    }

    return results;
  }

  getWarmers(): CacheWarmer[] {
    return Array.from(this.warmers.values());
  }

  disableWarmer(warmerId: string): boolean {
    const warmer = this.warmers.get(warmerId);
    if (!warmer) return false;

    warmer.enabled = false;

    const stmt = this.db.prepare('UPDATE cache_warmers SET enabled = 0 WHERE id = ?');
    stmt.run(warmerId);

    return true;
  }

  // ============================================================================
  // Namespace Operations
  // ============================================================================

  getNamespaces(): string[] {
    const namespaces = new Set<string>();

    // From L1
    for (const entry of this.l1.getAll()) {
      if (entry.namespace) namespaces.add(entry.namespace);
    }

    // From L2
    if (this.config.enableL2) {
      const stmt = this.db.prepare('SELECT DISTINCT namespace FROM cache_entries WHERE namespace IS NOT NULL');
      const rows = stmt.all() as Array<{ namespace: string }>;
      for (const row of rows) {
        namespaces.add(row.namespace);
      }
    }

    return Array.from(namespaces);
  }

  getNamespaceStats(namespace: string): NamespaceStats {
    let entries = 0;
    let sizeBytes = 0;
    let hits = 0;
    let misses = 0;
    let totalTtl = 0;
    let entriesWithTtl = 0;

    // L1 stats
    for (const entry of this.l1.getAll()) {
      if (entry.namespace === namespace) {
        entries++;
        sizeBytes += entry.size;
        if (entry.ttlMs) {
          totalTtl += entry.ttlMs;
          entriesWithTtl++;
        }
      }
    }

    // L2 stats
    if (this.config.enableL2) {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as size,
               COALESCE(SUM(access_count), 0) as accesses, AVG(ttl_ms) as avg_ttl
        FROM cache_entries
        WHERE namespace = ?
      `);
      const result = stmt.get(namespace) as Record<string, unknown>;

      entries += result.count as number;
      sizeBytes += result.size as number;
      if (result.avg_ttl) {
        totalTtl += (result.avg_ttl as number) * (result.count as number);
        entriesWithTtl += result.count as number;
      }
    }

    return {
      namespace,
      entries,
      sizeBytes,
      hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
      avgTtlMs: entriesWithTtl > 0 ? totalTtl / entriesWithTtl : 0,
    };
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): CacheStats {
    const l1Stats = this.l1.getStats();

    let l2Entries = 0;
    let l2SizeBytes = 0;

    if (this.config.enableL2) {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as size
        FROM cache_entries
        WHERE expires_at IS NULL OR expires_at > ?
      `);
      const result = stmt.get(Date.now()) as { count: number; size: number };
      l2Entries = result.count;
      l2SizeBytes = result.size;
    }

    const l2Total = this.stats.l2Hits + this.stats.l2Misses;
    const l2HitRate = l2Total > 0 ? this.stats.l2Hits / l2Total : 0;

    const compressionRatio = this.stats.totalUncompressedSize > 0
      ? this.stats.totalCompressedSize / this.stats.totalUncompressedSize
      : 1;

    return {
      l1Entries: l1Stats.entries,
      l1SizeBytes: l1Stats.sizeBytes,
      l1HitRate: l1Stats.hitRate,
      l2Entries,
      l2SizeBytes,
      l2HitRate,
      totalHits: this.stats.totalHits,
      totalMisses: this.stats.totalMisses,
      totalEvictions: this.stats.totalEvictions,
      totalInvalidations: this.stats.totalInvalidations,
      avgGetLatencyMs: this.l1.getAvgGetLatency(),
      avgSetLatencyMs: this.l1.getAvgSetLatency(),
      namespaces: this.getNamespaces(),
      compressionRatio,
    };
  }

  private recordStatsSnapshot(): void {
    const stats = this.getStats();

    const stmt = this.db.prepare(`
      INSERT INTO stats_history
      (id, timestamp, l1_entries, l1_size_bytes, l1_hit_rate, l2_entries, l2_size_bytes, l2_hit_rate, total_hits, total_misses)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      `stats_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      new Date().toISOString(),
      stats.l1Entries,
      stats.l1SizeBytes,
      stats.l1HitRate,
      stats.l2Entries,
      stats.l2SizeBytes,
      stats.l2HitRate,
      stats.totalHits,
      stats.totalMisses
    );

    // Clean up old stats
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - this.config.statsRetentionHours);

    const cleanupStmt = this.db.prepare('DELETE FROM stats_history WHERE timestamp < ?');
    cleanupStmt.run(cutoff.toISOString());
  }

  getStatsHistory(hours: number = 24): Array<{ timestamp: Date; stats: Partial<CacheStats> }> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    const stmt = this.db.prepare(`
      SELECT * FROM stats_history
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `);
    const rows = stmt.all(cutoff.toISOString()) as Record<string, unknown>[];

    return rows.map(row => ({
      timestamp: new Date(row.timestamp as string),
      stats: {
        l1Entries: row.l1_entries as number,
        l1SizeBytes: row.l1_size_bytes as number,
        l1HitRate: row.l1_hit_rate as number,
        l2Entries: row.l2_entries as number,
        l2SizeBytes: row.l2_size_bytes as number,
        l2HitRate: row.l2_hit_rate as number,
        totalHits: row.total_hits as number,
        totalMisses: row.total_misses as number,
      },
    }));
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  private buildKey(key: string, namespace?: string): string {
    if (namespace) {
      return `${namespace}:${key}`;
    }
    return key;
  }

  computeHash(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex')
      .substring(0, 16);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  cleanup(): { l1Cleaned: number; l2Cleaned: number } {
    const l1Cleaned = this.l1.cleanup();

    let l2Cleaned = 0;
    if (this.config.enableL2) {
      const stmt = this.db.prepare(`
        DELETE FROM cache_entries
        WHERE expires_at IS NOT NULL AND expires_at < ?
      `);
      const result = stmt.run(Date.now());
      l2Cleaned = result.changes;
    }

    if (l1Cleaned > 0 || l2Cleaned > 0) {
      this.emit('cleanup', { l1Cleaned, l2Cleaned });
    }

    return { l1Cleaned, l2Cleaned };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Record final stats
    this.recordStatsSnapshot();

    this.db.close();
    this.emit('shutdown');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let cacheLayerInstance: CacheLayerSystem | null = null;

export function getCacheLayer(config?: CacheConfig): CacheLayerSystem {
  if (!cacheLayerInstance) {
    if (!config) {
      throw new Error('CacheLayerSystem requires config on first initialization');
    }
    cacheLayerInstance = new CacheLayerSystem(config);
  }
  return cacheLayerInstance;
}

export function resetCacheLayer(): void {
  if (cacheLayerInstance) {
    cacheLayerInstance.shutdown();
    cacheLayerInstance = null;
  }
}
