/**
 * Class 3.40: Rate Limiter
 * TAC Pattern: API rate limiting for LLM and tool calls with token bucket algorithm
 *
 * Features:
 * - Token bucket algorithm with configurable refill rates
 * - Per-endpoint/model rate limits
 * - Sliding window tracking
 * - Burst allowance for sudden traffic
 * - Request queue management with priorities
 * - Priority support (high, normal, low)
 * - Automatic retry with exponential backoff
 * - Rate limit statistics and monitoring
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type RateLimitScope = 'global' | 'endpoint' | 'model' | 'user' | 'channel' | 'agent';
export type RequestPriority = 'high' | 'normal' | 'low';
export type RateLimitStatus = 'allowed' | 'queued' | 'rejected' | 'throttled';

export interface TokenBucket {
  id: string;
  scope: RateLimitScope;
  scopeId: string;
  tokens: number;
  maxTokens: number;
  refillRate: number;  // Tokens per second
  lastRefillAt: number;
  burstTokens: number;
  maxBurstTokens: number;
  burstRefillRate: number;
  lastBurstRefillAt: number;
}

export interface RateLimitRule {
  id: string;
  name: string;
  scope: RateLimitScope;
  scopePattern?: string;  // Regex pattern for matching endpoints/models
  maxTokens: number;
  refillRate: number;
  burstAllowance: number;
  burstRefillRate: number;
  windowMs: number;
  maxQueueSize: number;
  maxQueueWaitMs: number;
  priority: number;  // Higher = more specific, used for rule selection
  enabled: boolean;
  createdAt: Date;
}

export interface RateLimitRequest {
  id: string;
  scope: RateLimitScope;
  scopeId: string;
  tokens: number;
  priority: RequestPriority;
  userId?: string;
  channelId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  requestedAt: Date;
  resolvedAt?: Date;
  status: RateLimitStatus;
  waitTimeMs?: number;
  retryAfterMs?: number;
}

export interface QueuedRequest {
  request: RateLimitRequest;
  resolve: (result: RateLimitResult) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  addedAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  status: RateLimitStatus;
  tokensRemaining: number;
  retryAfterMs?: number;
  waitTimeMs?: number;
  queuePosition?: number;
}

export interface SlidingWindowEntry {
  timestamp: number;
  tokens: number;
}

export interface SlidingWindow {
  id: string;
  scope: RateLimitScope;
  scopeId: string;
  windowMs: number;
  entries: SlidingWindowEntry[];
  totalTokens: number;
  maxTokens: number;
}

export interface RateLimitStats {
  totalRequests: number;
  allowedRequests: number;
  queuedRequests: number;
  rejectedRequests: number;
  throttledRequests: number;
  avgWaitTimeMs: number;
  avgTokensPerRequest: number;
  peakRequestsPerSecond: number;
  currentQueueSize: number;
  bucketUtilization: Record<string, number>;
}

export interface EndpointStats {
  endpoint: string;
  totalRequests: number;
  allowedRequests: number;
  rejectedRequests: number;
  avgLatencyMs: number;
  tokensConsumed: number;
  lastRequestAt: Date;
}

export interface RateLimiterConfig {
  defaultMaxTokens: number;
  defaultRefillRate: number;
  defaultBurstAllowance: number;
  defaultBurstRefillRate: number;
  defaultWindowMs: number;
  defaultMaxQueueSize: number;
  defaultMaxQueueWaitMs: number;
  cleanupIntervalMs: number;
  statsRetentionMs: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RateLimiterConfig = {
  defaultMaxTokens: 100,
  defaultRefillRate: 10,  // 10 tokens per second
  defaultBurstAllowance: 20,
  defaultBurstRefillRate: 5,  // 5 burst tokens per second
  defaultWindowMs: 60000,  // 1 minute sliding window
  defaultMaxQueueSize: 100,
  defaultMaxQueueWaitMs: 30000,  // 30 seconds max wait
  cleanupIntervalMs: 60000,  // Cleanup every minute
  statsRetentionMs: 3600000,  // Keep stats for 1 hour
};

// Priority weights for queue ordering
const PRIORITY_WEIGHTS: Record<RequestPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

// ============================================================================
// Rate Limiter System
// ============================================================================

export class RateLimiterSystem extends EventEmitter {
  private config: RateLimiterConfig;
  private buckets: Map<string, TokenBucket> = new Map();
  private windows: Map<string, SlidingWindow> = new Map();
  private rules: Map<string, RateLimitRule> = new Map();
  private queues: Map<string, QueuedRequest[]> = new Map();
  private requestHistory: RateLimitRequest[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;
  private processInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startBackgroundTasks();
    this.setupDefaultRules();
  }

  private startBackgroundTasks(): void {
    // Cleanup old data periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);

    // Process queues periodically
    this.processInterval = setInterval(() => {
      this.processQueues();
    }, 100);  // Process every 100ms
  }

  private setupDefaultRules(): void {
    // Default global rule
    this.createRule({
      name: 'default-global',
      scope: 'global',
      maxTokens: this.config.defaultMaxTokens,
      refillRate: this.config.defaultRefillRate,
      burstAllowance: this.config.defaultBurstAllowance,
      burstRefillRate: this.config.defaultBurstRefillRate,
      priority: 0,
    });

    // Common LLM provider rules
    this.createRule({
      name: 'openrouter-default',
      scope: 'endpoint',
      scopePattern: '^openrouter.*',
      maxTokens: 60,
      refillRate: 1,  // ~60 requests per minute
      burstAllowance: 10,
      burstRefillRate: 0.5,
      priority: 10,
    });

    this.createRule({
      name: 'anthropic-default',
      scope: 'endpoint',
      scopePattern: '^anthropic.*',
      maxTokens: 50,
      refillRate: 0.83,  // ~50 requests per minute
      burstAllowance: 10,
      burstRefillRate: 0.5,
      priority: 10,
    });

    this.createRule({
      name: 'openai-default',
      scope: 'endpoint',
      scopePattern: '^openai.*',
      maxTokens: 60,
      refillRate: 1,
      burstAllowance: 20,
      burstRefillRate: 1,
      priority: 10,
    });

    // Free tier providers - more conservative limits
    this.createRule({
      name: 'groq-free',
      scope: 'endpoint',
      scopePattern: '^groq.*',
      maxTokens: 30,
      refillRate: 0.5,  // ~30 requests per minute
      burstAllowance: 5,
      burstRefillRate: 0.25,
      priority: 10,
    });

    this.createRule({
      name: 'cerebras-free',
      scope: 'endpoint',
      scopePattern: '^cerebras.*',
      maxTokens: 30,
      refillRate: 0.5,
      burstAllowance: 5,
      burstRefillRate: 0.25,
      priority: 10,
    });
  }

  // ============================================================================
  // Rule Management
  // ============================================================================

  createRule(params: {
    name: string;
    scope: RateLimitScope;
    scopePattern?: string;
    maxTokens?: number;
    refillRate?: number;
    burstAllowance?: number;
    burstRefillRate?: number;
    windowMs?: number;
    maxQueueSize?: number;
    maxQueueWaitMs?: number;
    priority?: number;
  }): RateLimitRule {
    const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const rule: RateLimitRule = {
      id,
      name: params.name,
      scope: params.scope,
      scopePattern: params.scopePattern,
      maxTokens: params.maxTokens ?? this.config.defaultMaxTokens,
      refillRate: params.refillRate ?? this.config.defaultRefillRate,
      burstAllowance: params.burstAllowance ?? this.config.defaultBurstAllowance,
      burstRefillRate: params.burstRefillRate ?? this.config.defaultBurstRefillRate,
      windowMs: params.windowMs ?? this.config.defaultWindowMs,
      maxQueueSize: params.maxQueueSize ?? this.config.defaultMaxQueueSize,
      maxQueueWaitMs: params.maxQueueWaitMs ?? this.config.defaultMaxQueueWaitMs,
      priority: params.priority ?? 0,
      enabled: true,
      createdAt: new Date(),
    };

    this.rules.set(rule.id, rule);
    this.emit('rule:created', rule);
    return rule;
  }

  getRule(ruleId: string): RateLimitRule | null {
    return this.rules.get(ruleId) ?? null;
  }

  getRuleByName(name: string): RateLimitRule | null {
    for (const rule of this.rules.values()) {
      if (rule.name === name) return rule;
    }
    return null;
  }

  getAllRules(): RateLimitRule[] {
    return Array.from(this.rules.values());
  }

  updateRule(ruleId: string, updates: Partial<Omit<RateLimitRule, 'id' | 'createdAt'>>): RateLimitRule | null {
    const rule = this.rules.get(ruleId);
    if (!rule) return null;

    const updated = { ...rule, ...updates };
    this.rules.set(ruleId, updated);
    this.emit('rule:updated', updated);
    return updated;
  }

  deleteRule(ruleId: string): boolean {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      this.emit('rule:deleted', { ruleId });
    }
    return deleted;
  }

  enableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = true;
    this.emit('rule:enabled', rule);
    return true;
  }

  disableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = false;
    this.emit('rule:disabled', rule);
    return true;
  }

  // ============================================================================
  // Rate Limiting Core
  // ============================================================================

  /**
   * Acquire tokens for a request. Returns immediately with result.
   */
  acquire(params: {
    scope: RateLimitScope;
    scopeId: string;
    tokens?: number;
    priority?: RequestPriority;
    userId?: string;
    channelId?: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
  }): RateLimitResult {
    const tokens = params.tokens ?? 1;
    const priority = params.priority ?? 'normal';

    // Find applicable rule
    const rule = this.findMatchingRule(params.scope, params.scopeId);

    // Get or create bucket
    const bucket = this.getOrCreateBucket(params.scope, params.scopeId, rule);

    // Refill bucket
    this.refillBucket(bucket);

    // Check sliding window
    const window = this.getOrCreateWindow(params.scope, params.scopeId, rule);
    this.updateWindow(window);

    // Create request record
    const request = this.createRequest({
      ...params,
      tokens,
      priority,
    });

    // Try to acquire tokens
    const result = this.tryAcquire(bucket, window, tokens, rule);

    // Update request status
    request.status = result.status;
    request.resolvedAt = result.allowed ? new Date() : undefined;
    request.retryAfterMs = result.retryAfterMs;

    // Record request
    this.recordRequest(request);

    this.emit('request:processed', { request, result });
    return result;
  }

  /**
   * Acquire tokens with queueing. Returns a promise that resolves when tokens are available.
   */
  async acquireAsync(params: {
    scope: RateLimitScope;
    scopeId: string;
    tokens?: number;
    priority?: RequestPriority;
    userId?: string;
    channelId?: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
    allowQueue?: boolean;
  }): Promise<RateLimitResult> {
    const allowQueue = params.allowQueue ?? true;

    // First try immediate acquisition
    const result = this.acquire(params);

    if (result.allowed || !allowQueue) {
      return result;
    }

    // Check if queue is available
    const rule = this.findMatchingRule(params.scope, params.scopeId);
    const queueKey = `${params.scope}:${params.scopeId}`;
    const queue = this.queues.get(queueKey) ?? [];

    if (queue.length >= rule.maxQueueSize) {
      return {
        allowed: false,
        status: 'rejected',
        tokensRemaining: 0,
        retryAfterMs: result.retryAfterMs,
      };
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      const request = this.createRequest({
        ...params,
        tokens: params.tokens ?? 1,
        priority: params.priority ?? 'normal',
      });
      request.status = 'queued';

      const timeoutId = setTimeout(() => {
        this.removeFromQueue(queueKey, request.id);
        request.status = 'rejected';
        request.resolvedAt = new Date();
        this.recordRequest(request);

        resolve({
          allowed: false,
          status: 'rejected',
          tokensRemaining: 0,
          retryAfterMs: 0,
        });
      }, rule.maxQueueWaitMs);

      const queuedRequest: QueuedRequest = {
        request,
        resolve,
        reject,
        timeoutId,
        addedAt: Date.now(),
      };

      if (!this.queues.has(queueKey)) {
        this.queues.set(queueKey, []);
      }

      // Insert by priority
      const queueList = this.queues.get(queueKey)!;
      const insertIndex = this.findQueueInsertIndex(queueList, params.priority ?? 'normal');
      queueList.splice(insertIndex, 0, queuedRequest);

      this.emit('request:queued', { request, position: insertIndex + 1 });
    });
  }

  private tryAcquire(
    bucket: TokenBucket,
    window: SlidingWindow,
    tokens: number,
    rule: RateLimitRule
  ): RateLimitResult {
    // Check sliding window limit
    if (window.totalTokens + tokens > window.maxTokens) {
      const oldestEntry = window.entries[0];
      const retryAfterMs = oldestEntry
        ? Math.max(0, oldestEntry.timestamp + rule.windowMs - Date.now())
        : 1000;

      return {
        allowed: false,
        status: 'throttled',
        tokensRemaining: Math.max(0, window.maxTokens - window.totalTokens),
        retryAfterMs,
      };
    }

    // Try regular tokens first
    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      this.addToWindow(window, tokens);

      return {
        allowed: true,
        status: 'allowed',
        tokensRemaining: bucket.tokens,
      };
    }

    // Try using burst tokens
    const regularNeeded = Math.min(tokens, bucket.tokens);
    const burstNeeded = tokens - regularNeeded;

    if (bucket.burstTokens >= burstNeeded) {
      bucket.tokens -= regularNeeded;
      bucket.burstTokens -= burstNeeded;
      this.addToWindow(window, tokens);

      return {
        allowed: true,
        status: 'allowed',
        tokensRemaining: bucket.tokens + bucket.burstTokens,
      };
    }

    // Calculate retry time based on refill rate
    const tokensNeeded = tokens - bucket.tokens - bucket.burstTokens;
    const refillTimeMs = (tokensNeeded / bucket.refillRate) * 1000;

    return {
      allowed: false,
      status: 'throttled',
      tokensRemaining: bucket.tokens + bucket.burstTokens,
      retryAfterMs: Math.ceil(refillTimeMs),
    };
  }

  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsedSeconds = (now - bucket.lastRefillAt) / 1000;

    // Refill regular tokens
    const newTokens = elapsedSeconds * bucket.refillRate;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + newTokens);
    bucket.lastRefillAt = now;

    // Refill burst tokens
    const burstElapsedSeconds = (now - bucket.lastBurstRefillAt) / 1000;
    const newBurstTokens = burstElapsedSeconds * bucket.burstRefillRate;
    bucket.burstTokens = Math.min(bucket.maxBurstTokens, bucket.burstTokens + newBurstTokens);
    bucket.lastBurstRefillAt = now;
  }

  private getOrCreateBucket(
    scope: RateLimitScope,
    scopeId: string,
    rule: RateLimitRule
  ): TokenBucket {
    const key = `${scope}:${scopeId}`;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      const now = Date.now();
      bucket = {
        id: key,
        scope,
        scopeId,
        tokens: rule.maxTokens,
        maxTokens: rule.maxTokens,
        refillRate: rule.refillRate,
        lastRefillAt: now,
        burstTokens: rule.burstAllowance,
        maxBurstTokens: rule.burstAllowance,
        burstRefillRate: rule.burstRefillRate,
        lastBurstRefillAt: now,
      };
      this.buckets.set(key, bucket);
    }

    return bucket;
  }

  private getOrCreateWindow(
    scope: RateLimitScope,
    scopeId: string,
    rule: RateLimitRule
  ): SlidingWindow {
    const key = `${scope}:${scopeId}`;
    let window = this.windows.get(key);

    if (!window) {
      window = {
        id: key,
        scope,
        scopeId,
        windowMs: rule.windowMs,
        entries: [],
        totalTokens: 0,
        maxTokens: rule.maxTokens * (rule.windowMs / 1000) / rule.refillRate,
      };
      this.windows.set(key, window);
    }

    return window;
  }

  private updateWindow(window: SlidingWindow): void {
    const cutoff = Date.now() - window.windowMs;

    // Remove expired entries
    while (window.entries.length > 0 && window.entries[0].timestamp < cutoff) {
      const removed = window.entries.shift()!;
      window.totalTokens -= removed.tokens;
    }
  }

  private addToWindow(window: SlidingWindow, tokens: number): void {
    window.entries.push({
      timestamp: Date.now(),
      tokens,
    });
    window.totalTokens += tokens;
  }

  private findMatchingRule(scope: RateLimitScope, scopeId: string): RateLimitRule {
    let bestRule: RateLimitRule | null = null;
    let bestPriority = -1;

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check scope match
      if (rule.scope !== scope && rule.scope !== 'global') continue;

      // Check pattern match if specified
      if (rule.scopePattern) {
        const regex = new RegExp(rule.scopePattern);
        if (!regex.test(scopeId)) continue;
      }

      // Select highest priority matching rule
      if (rule.priority > bestPriority) {
        bestRule = rule;
        bestPriority = rule.priority;
      }
    }

    // Fallback to default global rule
    if (!bestRule) {
      bestRule = this.getRuleByName('default-global')!;
    }

    return bestRule;
  }

  // ============================================================================
  // Queue Management
  // ============================================================================

  private findQueueInsertIndex(queue: QueuedRequest[], priority: RequestPriority): number {
    const weight = PRIORITY_WEIGHTS[priority];

    for (let i = 0; i < queue.length; i++) {
      const existingWeight = PRIORITY_WEIGHTS[queue[i].request.priority];
      if (weight > existingWeight) {
        return i;
      }
    }

    return queue.length;
  }

  private processQueues(): void {
    for (const [queueKey, queue] of this.queues.entries()) {
      if (queue.length === 0) continue;

      const [scope, scopeId] = queueKey.split(':') as [RateLimitScope, string];
      const rule = this.findMatchingRule(scope, scopeId);
      const bucket = this.getOrCreateBucket(scope, scopeId, rule);
      const window = this.getOrCreateWindow(scope, scopeId, rule);

      this.refillBucket(bucket);
      this.updateWindow(window);

      // Process queue items
      while (queue.length > 0) {
        const item = queue[0];
        const tokens = item.request.tokens;

        const result = this.tryAcquire(bucket, window, tokens, rule);

        if (result.allowed) {
          queue.shift();
          clearTimeout(item.timeoutId);

          item.request.status = 'allowed';
          item.request.resolvedAt = new Date();
          item.request.waitTimeMs = Date.now() - item.addedAt;
          this.recordRequest(item.request);

          result.waitTimeMs = item.request.waitTimeMs;
          item.resolve(result);

          this.emit('request:dequeued', { request: item.request, result });
        } else {
          // Stop processing this queue - tokens not available
          break;
        }
      }
    }
  }

  private removeFromQueue(queueKey: string, requestId: string): void {
    const queue = this.queues.get(queueKey);
    if (!queue) return;

    const index = queue.findIndex(item => item.request.id === requestId);
    if (index !== -1) {
      const removed = queue.splice(index, 1)[0];
      clearTimeout(removed.timeoutId);
    }
  }

  getQueueStatus(scope: RateLimitScope, scopeId: string): {
    size: number;
    oldestWaitMs: number;
    positions: { requestId: string; priority: RequestPriority; waitMs: number }[];
  } {
    const queueKey = `${scope}:${scopeId}`;
    const queue = this.queues.get(queueKey) ?? [];
    const now = Date.now();

    return {
      size: queue.length,
      oldestWaitMs: queue.length > 0 ? now - queue[0].addedAt : 0,
      positions: queue.map((item, index) => ({
        requestId: item.request.id,
        priority: item.request.priority,
        waitMs: now - item.addedAt,
      })),
    };
  }

  clearQueue(scope: RateLimitScope, scopeId: string): number {
    const queueKey = `${scope}:${scopeId}`;
    const queue = this.queues.get(queueKey);
    if (!queue) return 0;

    const count = queue.length;
    for (const item of queue) {
      clearTimeout(item.timeoutId);
      item.request.status = 'rejected';
      item.request.resolvedAt = new Date();
      this.recordRequest(item.request);

      item.resolve({
        allowed: false,
        status: 'rejected',
        tokensRemaining: 0,
      });
    }

    this.queues.delete(queueKey);
    this.emit('queue:cleared', { scope, scopeId, count });
    return count;
  }

  // ============================================================================
  // Request Management
  // ============================================================================

  private createRequest(params: {
    scope: RateLimitScope;
    scopeId: string;
    tokens: number;
    priority: RequestPriority;
    userId?: string;
    channelId?: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
  }): RateLimitRequest {
    return {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      scope: params.scope,
      scopeId: params.scopeId,
      tokens: params.tokens,
      priority: params.priority,
      userId: params.userId,
      channelId: params.channelId,
      agentId: params.agentId,
      metadata: params.metadata,
      requestedAt: new Date(),
      status: 'allowed',
    };
  }

  private recordRequest(request: RateLimitRequest): void {
    this.requestHistory.push(request);

    // Keep history within retention limit
    const cutoff = Date.now() - this.config.statsRetentionMs;
    while (this.requestHistory.length > 0 && this.requestHistory[0].requestedAt.getTime() < cutoff) {
      this.requestHistory.shift();
    }
  }

  // ============================================================================
  // Bucket Management
  // ============================================================================

  getBucket(scope: RateLimitScope, scopeId: string): TokenBucket | null {
    const key = `${scope}:${scopeId}`;
    const bucket = this.buckets.get(key);
    if (bucket) {
      this.refillBucket(bucket);
    }
    return bucket ?? null;
  }

  getAllBuckets(): TokenBucket[] {
    const buckets = Array.from(this.buckets.values());
    for (const bucket of buckets) {
      this.refillBucket(bucket);
    }
    return buckets;
  }

  resetBucket(scope: RateLimitScope, scopeId: string): boolean {
    const key = `${scope}:${scopeId}`;
    const bucket = this.buckets.get(key);
    if (!bucket) return false;

    const rule = this.findMatchingRule(scope, scopeId);
    const now = Date.now();

    bucket.tokens = rule.maxTokens;
    bucket.maxTokens = rule.maxTokens;
    bucket.refillRate = rule.refillRate;
    bucket.lastRefillAt = now;
    bucket.burstTokens = rule.burstAllowance;
    bucket.maxBurstTokens = rule.burstAllowance;
    bucket.burstRefillRate = rule.burstRefillRate;
    bucket.lastBurstRefillAt = now;

    this.emit('bucket:reset', { scope, scopeId });
    return true;
  }

  deleteBucket(scope: RateLimitScope, scopeId: string): boolean {
    const key = `${scope}:${scopeId}`;
    const deleted = this.buckets.delete(key);
    this.windows.delete(key);

    if (deleted) {
      this.emit('bucket:deleted', { scope, scopeId });
    }
    return deleted;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): RateLimitStats {
    const now = Date.now();
    const statsWindow = this.config.statsRetentionMs;
    const cutoff = now - statsWindow;

    const recentRequests = this.requestHistory.filter(r => r.requestedAt.getTime() >= cutoff);

    const totalRequests = recentRequests.length;
    const allowedRequests = recentRequests.filter(r => r.status === 'allowed').length;
    const queuedRequests = recentRequests.filter(r => r.status === 'queued').length;
    const rejectedRequests = recentRequests.filter(r => r.status === 'rejected').length;
    const throttledRequests = recentRequests.filter(r => r.status === 'throttled').length;

    const waitTimes = recentRequests
      .filter(r => r.waitTimeMs !== undefined)
      .map(r => r.waitTimeMs!);
    const avgWaitTimeMs = waitTimes.length > 0
      ? waitTimes.reduce((sum, t) => sum + t, 0) / waitTimes.length
      : 0;

    const totalTokens = recentRequests.reduce((sum, r) => sum + r.tokens, 0);
    const avgTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 0;

    // Calculate peak requests per second
    const requestsBySecond: Record<number, number> = {};
    for (const request of recentRequests) {
      const second = Math.floor(request.requestedAt.getTime() / 1000);
      requestsBySecond[second] = (requestsBySecond[second] ?? 0) + 1;
    }
    const peakRequestsPerSecond = Math.max(0, ...Object.values(requestsBySecond));

    // Current queue sizes
    let currentQueueSize = 0;
    for (const queue of this.queues.values()) {
      currentQueueSize += queue.length;
    }

    // Bucket utilization
    const bucketUtilization: Record<string, number> = {};
    for (const [key, bucket] of this.buckets.entries()) {
      this.refillBucket(bucket);
      const totalAvailable = bucket.maxTokens + bucket.maxBurstTokens;
      const currentAvailable = bucket.tokens + bucket.burstTokens;
      bucketUtilization[key] = totalAvailable > 0
        ? Math.round((1 - currentAvailable / totalAvailable) * 100)
        : 0;
    }

    return {
      totalRequests,
      allowedRequests,
      queuedRequests,
      rejectedRequests,
      throttledRequests,
      avgWaitTimeMs: Math.round(avgWaitTimeMs),
      avgTokensPerRequest: Math.round(avgTokensPerRequest * 100) / 100,
      peakRequestsPerSecond,
      currentQueueSize,
      bucketUtilization,
    };
  }

  getEndpointStats(scope: RateLimitScope = 'endpoint'): EndpointStats[] {
    const now = Date.now();
    const cutoff = now - this.config.statsRetentionMs;

    const recentRequests = this.requestHistory.filter(
      r => r.requestedAt.getTime() >= cutoff && r.scope === scope
    );

    const byEndpoint: Map<string, {
      totalRequests: number;
      allowedRequests: number;
      rejectedRequests: number;
      totalLatency: number;
      tokensConsumed: number;
      lastRequestAt: Date;
    }> = new Map();

    for (const request of recentRequests) {
      let stats = byEndpoint.get(request.scopeId);
      if (!stats) {
        stats = {
          totalRequests: 0,
          allowedRequests: 0,
          rejectedRequests: 0,
          totalLatency: 0,
          tokensConsumed: 0,
          lastRequestAt: request.requestedAt,
        };
        byEndpoint.set(request.scopeId, stats);
      }

      stats.totalRequests++;
      if (request.status === 'allowed') {
        stats.allowedRequests++;
        stats.tokensConsumed += request.tokens;
      } else if (request.status === 'rejected') {
        stats.rejectedRequests++;
      }
      if (request.waitTimeMs !== undefined) {
        stats.totalLatency += request.waitTimeMs;
      }
      if (request.requestedAt > stats.lastRequestAt) {
        stats.lastRequestAt = request.requestedAt;
      }
    }

    return Array.from(byEndpoint.entries()).map(([endpoint, stats]) => ({
      endpoint,
      totalRequests: stats.totalRequests,
      allowedRequests: stats.allowedRequests,
      rejectedRequests: stats.rejectedRequests,
      avgLatencyMs: stats.totalRequests > 0
        ? Math.round(stats.totalLatency / stats.totalRequests)
        : 0,
      tokensConsumed: stats.tokensConsumed,
      lastRequestAt: stats.lastRequestAt,
    }));
  }

  getRequestHistory(params: {
    scope?: RateLimitScope;
    scopeId?: string;
    status?: RateLimitStatus;
    userId?: string;
    limit?: number;
  } = {}): RateLimitRequest[] {
    let filtered = this.requestHistory;

    if (params.scope) {
      filtered = filtered.filter(r => r.scope === params.scope);
    }
    if (params.scopeId) {
      filtered = filtered.filter(r => r.scopeId === params.scopeId);
    }
    if (params.status) {
      filtered = filtered.filter(r => r.status === params.status);
    }
    if (params.userId) {
      filtered = filtered.filter(r => r.userId === params.userId);
    }

    const limit = params.limit ?? 100;
    return filtered.slice(-limit);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Calculate estimated wait time for acquiring tokens
   */
  estimateWaitTime(scope: RateLimitScope, scopeId: string, tokens: number = 1): number {
    const bucket = this.getBucket(scope, scopeId);
    if (!bucket) return 0;

    const availableTokens = bucket.tokens + bucket.burstTokens;
    if (availableTokens >= tokens) return 0;

    const tokensNeeded = tokens - availableTokens;
    const effectiveRefillRate = bucket.refillRate + bucket.burstRefillRate;

    return Math.ceil((tokensNeeded / effectiveRefillRate) * 1000);
  }

  /**
   * Check if tokens are currently available without consuming them
   */
  canAcquire(scope: RateLimitScope, scopeId: string, tokens: number = 1): boolean {
    const bucket = this.getBucket(scope, scopeId);
    if (!bucket) return true;  // No bucket means no limit applied yet

    return (bucket.tokens + bucket.burstTokens) >= tokens;
  }

  /**
   * Reserve tokens for future use (decrements available tokens without request)
   */
  reserve(scope: RateLimitScope, scopeId: string, tokens: number = 1): boolean {
    const rule = this.findMatchingRule(scope, scopeId);
    const bucket = this.getOrCreateBucket(scope, scopeId, rule);
    this.refillBucket(bucket);

    const availableTokens = bucket.tokens + bucket.burstTokens;
    if (availableTokens < tokens) return false;

    // Consume from regular tokens first
    const fromRegular = Math.min(tokens, bucket.tokens);
    bucket.tokens -= fromRegular;
    bucket.burstTokens -= (tokens - fromRegular);

    this.emit('tokens:reserved', { scope, scopeId, tokens });
    return true;
  }

  /**
   * Release previously reserved tokens
   */
  release(scope: RateLimitScope, scopeId: string, tokens: number = 1): void {
    const bucket = this.buckets.get(`${scope}:${scopeId}`);
    if (!bucket) return;

    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokens);
    this.emit('tokens:released', { scope, scopeId, tokens });
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.statsRetentionMs;

    // Clean old request history
    while (this.requestHistory.length > 0 && this.requestHistory[0].requestedAt.getTime() < cutoff) {
      this.requestHistory.shift();
    }

    // Clean stale buckets (no activity for 2x stats retention)
    const staleCutoff = now - (this.config.statsRetentionMs * 2);
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.lastRefillAt < staleCutoff) {
        this.buckets.delete(key);
        this.windows.delete(key);
      }
    }

    // Clean empty queues
    for (const [key, queue] of this.queues.entries()) {
      if (queue.length === 0) {
        this.queues.delete(key);
      }
    }

    this.emit('cleanup:completed');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }

    // Reject all queued requests
    for (const [queueKey, queue] of this.queues.entries()) {
      for (const item of queue) {
        clearTimeout(item.timeoutId);
        item.reject(new Error('Rate limiter shutting down'));
      }
    }
    this.queues.clear();

    this.emit('shutdown');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let rateLimiterInstance: RateLimiterSystem | null = null;

export function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiterSystem {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiterSystem(config);
  }
  return rateLimiterInstance;
}

export function resetRateLimiter(): void {
  if (rateLimiterInstance) {
    rateLimiterInstance.shutdown();
    rateLimiterInstance = null;
  }
}
