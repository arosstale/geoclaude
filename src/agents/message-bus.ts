/**
 * Class 3.42: Message Bus
 * TAC Pattern: Internal pub/sub system for agent communication
 *
 * Provides internal message bus for agent communication:
 * - Topic-based pub/sub with hierarchical topics
 * - Wildcard subscriptions (*, **)
 * - Message persistence and replay
 * - Dead letter queue for failed messages
 * - Priority-based message delivery
 * - Request-reply pattern with correlation IDs
 * - Message TTL and expiration
 */

import { EventEmitter } from "events";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export type MessagePriority = "low" | "normal" | "high" | "critical";

export type MessageStatus =
  | "pending"
  | "delivered"
  | "acknowledged"
  | "failed"
  | "expired"
  | "dead_letter";

export type SubscriptionType = "exact" | "wildcard" | "pattern";

export interface BusMessage {
  id: string;
  topic: string;
  payload: unknown;
  priority: MessagePriority;
  publisherId: string;
  correlationId?: string;
  replyTo?: string;
  headers: Record<string, string>;
  timestamp: number;
  expiresAt?: number;
  retryCount: number;
  maxRetries: number;
  status: MessageStatus;
}

export interface Subscription {
  id: string;
  subscriberId: string;
  topic: string;
  type: SubscriptionType;
  pattern?: RegExp;
  handler: SubscriptionHandler;
  filter?: MessageFilter;
  options: SubscriptionOptions;
  createdAt: number;
  messageCount: number;
  lastMessageAt?: number;
}

export interface SubscriptionOptions {
  ackRequired: boolean;
  maxRetries: number;
  retryDelayMs: number;
  batchSize: number;
  batchTimeoutMs: number;
  priority?: MessagePriority;
}

export interface MessageFilter {
  headers?: Record<string, string>;
  minPriority?: MessagePriority;
  publisherIds?: string[];
}

export interface PublishOptions {
  priority?: MessagePriority;
  correlationId?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  ttlMs?: number;
  maxRetries?: number;
  persist?: boolean;
}

export interface DeadLetterEntry {
  id: string;
  messageId: string;
  topic: string;
  payload: unknown;
  error: string;
  failedAt: number;
  retryCount: number;
  originalTimestamp: number;
}

export interface ReplayOptions {
  fromTimestamp?: number;
  toTimestamp?: number;
  topic?: string;
  limit?: number;
  subscriberId?: string;
}

export interface RequestReplyResult {
  success: boolean;
  response?: unknown;
  error?: string;
  correlationId: string;
  latencyMs: number;
}

export interface BusStats {
  totalMessages: number;
  messagesPerSecond: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  deadLetterCount: number;
  pendingMessages: number;
  topicCounts: Record<string, number>;
  priorityDistribution: Record<MessagePriority, number>;
}

export interface MessageBusConfig {
  maxMessageSize: number;
  defaultTtlMs: number;
  defaultMaxRetries: number;
  defaultRetryDelayMs: number;
  messageRetentionMs: number;
  deadLetterRetentionMs: number;
  cleanupIntervalMs: number;
  maxPendingMessages: number;
  enablePersistence: boolean;
}

export type SubscriptionHandler = (
  message: BusMessage
) => Promise<void | unknown>;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MessageBusConfig = {
  maxMessageSize: 1024 * 1024, // 1MB
  defaultTtlMs: 300000, // 5 minutes
  defaultMaxRetries: 3,
  defaultRetryDelayMs: 1000,
  messageRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
  deadLetterRetentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  cleanupIntervalMs: 60000, // 1 minute
  maxPendingMessages: 10000,
  enablePersistence: true,
};

const DEFAULT_SUBSCRIPTION_OPTIONS: SubscriptionOptions = {
  ackRequired: false,
  maxRetries: 3,
  retryDelayMs: 1000,
  batchSize: 1,
  batchTimeoutMs: 0,
};

const PRIORITY_ORDER: Record<MessagePriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// ============================================================================
// Message Bus System
// ============================================================================

export class MessageBus extends EventEmitter {
  private db: Database.Database;
  private config: MessageBusConfig;
  private subscriptions: Map<string, Subscription> = new Map();
  private topicSubscriptions: Map<string, Set<string>> = new Map();
  private wildcardSubscriptions: Set<string> = new Set();
  private pendingRequests: Map<
    string,
    {
      resolve: (result: RequestReplyResult) => void;
      timeout: NodeJS.Timeout;
      startTime: number;
    }
  > = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  private messageCount = 0;
  private messageCountResetTime = Date.now();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(dataDir: string, config: Partial<MessageBusConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    const dbPath = path.join(dataDir, "message-bus.db");
    fs.mkdirSync(dataDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();

    if (this.config.enablePersistence) {
      this.startCleanupTimer();
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        payload TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        publisher_id TEXT NOT NULL,
        correlation_id TEXT,
        reply_to TEXT,
        headers TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        expires_at INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS dead_letter (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        payload TEXT NOT NULL,
        error TEXT NOT NULL,
        failed_at INTEGER NOT NULL,
        retry_count INTEGER NOT NULL,
        original_timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_acks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        subscriber_id TEXT NOT NULL,
        acknowledged_at INTEGER NOT NULL,
        UNIQUE(message_id, subscriber_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_priority ON messages(priority);
      CREATE INDEX IF NOT EXISTS idx_messages_correlation ON messages(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
      CREATE INDEX IF NOT EXISTS idx_dead_letter_time ON dead_letter(failed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_acks_message ON message_acks(message_id);
    `);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredMessages();
    }, this.config.cleanupIntervalMs);
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clean up expired messages and old dead letter entries
   */
  private cleanupExpiredMessages(): void {
    const now = Date.now();

    // Expire pending messages past TTL
    const expiredMessages = this.db
      .prepare(
        `
      SELECT id, topic FROM messages
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
    `
      )
      .all(now) as Array<{ id: string; topic: string }>;

    for (const { id } of expiredMessages) {
      this.db
        .prepare(`UPDATE messages SET status = 'expired' WHERE id = ?`)
        .run(id);
    }

    // Delete old delivered/expired messages
    const messageCutoff = now - this.config.messageRetentionMs;
    this.db
      .prepare(
        `
      DELETE FROM messages
      WHERE status IN ('delivered', 'acknowledged', 'expired')
      AND timestamp < ?
    `
      )
      .run(messageCutoff);

    // Delete old dead letter entries
    const deadLetterCutoff = now - this.config.deadLetterRetentionMs;
    this.db
      .prepare(`DELETE FROM dead_letter WHERE failed_at < ?`)
      .run(deadLetterCutoff);

    this.emit("cleanup:completed", {
      expiredCount: expiredMessages.length,
      timestamp: now,
    });
  }

  /**
   * Generate unique message ID
   */
  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Generate correlation ID for request-reply
   */
  private generateCorrelationId(): string {
    return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Check if topic matches subscription pattern
   */
  private topicMatches(topic: string, pattern: string): boolean {
    // Exact match
    if (pattern === topic) return true;

    // Single-level wildcard (*)
    if (pattern.includes("*") && !pattern.includes("**")) {
      const patternParts = pattern.split(".");
      const topicParts = topic.split(".");

      if (patternParts.length !== topicParts.length) return false;

      return patternParts.every((part, i) => part === "*" || part === topicParts[i]);
    }

    // Multi-level wildcard (**)
    if (pattern.includes("**")) {
      const prefix = pattern.replace(".**", "").replace("**", "");
      if (prefix === "") return true;
      return topic === prefix || topic.startsWith(prefix + ".");
    }

    return false;
  }

  /**
   * Get matching subscriptions for a topic
   */
  private getMatchingSubscriptions(topic: string): Subscription[] {
    const matching: Subscription[] = [];

    // Exact topic subscriptions
    const exactSubs = this.topicSubscriptions.get(topic);
    if (exactSubs) {
      for (const subId of exactSubs) {
        const sub = this.subscriptions.get(subId);
        if (sub) matching.push(sub);
      }
    }

    // Wildcard subscriptions
    for (const subId of this.wildcardSubscriptions) {
      const sub = this.subscriptions.get(subId);
      if (sub && this.topicMatches(topic, sub.topic)) {
        matching.push(sub);
      }
    }

    // Sort by priority (subscriptions can have priority preference)
    return matching.sort((a, b) => {
      const prioA = a.options.priority
        ? PRIORITY_ORDER[a.options.priority]
        : 0;
      const prioB = b.options.priority
        ? PRIORITY_ORDER[b.options.priority]
        : 0;
      return prioB - prioA;
    });
  }

  /**
   * Check if message passes filter
   */
  private passesFilter(message: BusMessage, filter?: MessageFilter): boolean {
    if (!filter) return true;

    // Check headers
    if (filter.headers) {
      for (const [key, value] of Object.entries(filter.headers)) {
        if (message.headers[key] !== value) return false;
      }
    }

    // Check minimum priority
    if (filter.minPriority) {
      const msgPrio = PRIORITY_ORDER[message.priority];
      const minPrio = PRIORITY_ORDER[filter.minPriority];
      if (msgPrio < minPrio) return false;
    }

    // Check publisher IDs
    if (filter.publisherIds && filter.publisherIds.length > 0) {
      if (!filter.publisherIds.includes(message.publisherId)) return false;
    }

    return true;
  }

  // ========================================================================
  // Publishing
  // ========================================================================

  /**
   * Publish a message to a topic
   */
  async publish(
    topic: string,
    payload: unknown,
    publisherId: string,
    options: PublishOptions = {}
  ): Promise<BusMessage> {
    const now = Date.now();

    const message: BusMessage = {
      id: this.generateId(),
      topic,
      payload,
      priority: options.priority ?? "normal",
      publisherId,
      correlationId: options.correlationId,
      replyTo: options.replyTo,
      headers: options.headers ?? {},
      timestamp: now,
      expiresAt: options.ttlMs ? now + options.ttlMs : now + this.config.defaultTtlMs,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultMaxRetries,
      status: "pending",
    };

    // Persist if enabled
    if (this.config.enablePersistence && options.persist !== false) {
      this.db
        .prepare(
          `
        INSERT INTO messages (id, topic, payload, priority, publisher_id, correlation_id, reply_to, headers, timestamp, expires_at, retry_count, max_retries, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          message.id,
          message.topic,
          JSON.stringify(message.payload),
          message.priority,
          message.publisherId,
          message.correlationId ?? null,
          message.replyTo ?? null,
          JSON.stringify(message.headers),
          message.timestamp,
          message.expiresAt ?? null,
          message.retryCount,
          message.maxRetries,
          message.status
        );
    }

    // Track message count
    this.messageCount++;

    // Deliver to subscribers
    await this.deliverMessage(message);

    this.emit("message:published", { message });
    return message;
  }

  /**
   * Publish with fire-and-forget semantics
   */
  async publishAsync(
    topic: string,
    payload: unknown,
    publisherId: string,
    options: PublishOptions = {}
  ): Promise<string> {
    const message = await this.publish(topic, payload, publisherId, options);
    return message.id;
  }

  /**
   * Request-reply pattern
   */
  async request(
    topic: string,
    payload: unknown,
    publisherId: string,
    timeoutMs = 30000,
    options: PublishOptions = {}
  ): Promise<RequestReplyResult> {
    const correlationId = this.generateCorrelationId();
    const replyTo = `_reply.${publisherId}.${correlationId}`;
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        // Unsubscribe from reply topic
        this.unsubscribe(`reply-${correlationId}`);
        resolve({
          success: false,
          error: "Request timeout",
          correlationId,
          latencyMs: Date.now() - startTime,
        });
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, timeout, startTime });

      // Subscribe to reply topic temporarily
      this.subscribe(
        replyTo,
        `reply-${correlationId}`,
        async (message) => {
          const pending = this.pendingRequests.get(correlationId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(correlationId);
            this.unsubscribe(`reply-${correlationId}`);

            pending.resolve({
              success: true,
              response: message.payload,
              correlationId,
              latencyMs: Date.now() - pending.startTime,
            });
          }
        },
        { ackRequired: false, maxRetries: 0, retryDelayMs: 0, batchSize: 1, batchTimeoutMs: 0 }
      );

      // Publish request
      this.publish(topic, payload, publisherId, {
        ...options,
        correlationId,
        replyTo,
      }).catch((error) => {
        const pending = this.pendingRequests.get(correlationId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(correlationId);
          this.unsubscribe(`reply-${correlationId}`);

          pending.resolve({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            correlationId,
            latencyMs: Date.now() - pending.startTime,
          });
        }
      });
    });
  }

  /**
   * Reply to a request message
   */
  async reply(
    originalMessage: BusMessage,
    payload: unknown,
    publisherId: string
  ): Promise<void> {
    if (!originalMessage.replyTo) {
      throw new Error("Original message does not have replyTo address");
    }

    await this.publish(
      originalMessage.replyTo,
      payload,
      publisherId,
      {
        correlationId: originalMessage.correlationId,
        priority: originalMessage.priority,
        persist: false,
      }
    );
  }

  // ========================================================================
  // Subscribing
  // ========================================================================

  /**
   * Subscribe to a topic
   */
  subscribe(
    topic: string,
    subscriberId: string,
    handler: SubscriptionHandler,
    options: Partial<SubscriptionOptions> = {}
  ): string {
    const subId = `sub-${subscriberId}-${Date.now()}`;
    const isWildcard = topic.includes("*");

    const subscription: Subscription = {
      id: subId,
      subscriberId,
      topic,
      type: isWildcard ? "wildcard" : "exact",
      handler,
      options: { ...DEFAULT_SUBSCRIPTION_OPTIONS, ...options },
      createdAt: Date.now(),
      messageCount: 0,
    };

    this.subscriptions.set(subId, subscription);

    if (isWildcard) {
      this.wildcardSubscriptions.add(subId);
    } else {
      if (!this.topicSubscriptions.has(topic)) {
        this.topicSubscriptions.set(topic, new Set());
      }
      this.topicSubscriptions.get(topic)!.add(subId);
    }

    this.emit("subscription:created", { subscription });
    return subId;
  }

  /**
   * Subscribe with a regex pattern
   */
  subscribePattern(
    pattern: RegExp,
    subscriberId: string,
    handler: SubscriptionHandler,
    options: Partial<SubscriptionOptions> = {}
  ): string {
    const subId = `sub-${subscriberId}-${Date.now()}`;

    const subscription: Subscription = {
      id: subId,
      subscriberId,
      topic: pattern.source,
      type: "pattern",
      pattern,
      handler,
      options: { ...DEFAULT_SUBSCRIPTION_OPTIONS, ...options },
      createdAt: Date.now(),
      messageCount: 0,
    };

    this.subscriptions.set(subId, subscription);
    this.wildcardSubscriptions.add(subId); // Treat as wildcard for matching

    this.emit("subscription:created", { subscription });
    return subId;
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return false;

    this.subscriptions.delete(subscriptionId);

    if (subscription.type === "wildcard" || subscription.type === "pattern") {
      this.wildcardSubscriptions.delete(subscriptionId);
    } else {
      const topicSubs = this.topicSubscriptions.get(subscription.topic);
      if (topicSubs) {
        topicSubs.delete(subscriptionId);
        if (topicSubs.size === 0) {
          this.topicSubscriptions.delete(subscription.topic);
        }
      }
    }

    this.emit("subscription:removed", { subscriptionId });
    return true;
  }

  /**
   * Unsubscribe all subscriptions for a subscriber
   */
  unsubscribeAll(subscriberId: string): number {
    let count = 0;
    for (const [subId, sub] of this.subscriptions) {
      if (sub.subscriberId === subscriberId) {
        this.unsubscribe(subId);
        count++;
      }
    }
    return count;
  }

  // ========================================================================
  // Message Delivery
  // ========================================================================

  /**
   * Deliver message to matching subscribers
   */
  private async deliverMessage(message: BusMessage): Promise<void> {
    // Check for reply topic (direct delivery)
    if (message.correlationId && this.pendingRequests.has(message.correlationId)) {
      // Reply will be handled by request handler
    }

    // Get matching subscriptions
    let subscriptions = this.getMatchingSubscriptions(message.topic);

    // Also check pattern subscriptions
    for (const subId of this.wildcardSubscriptions) {
      const sub = this.subscriptions.get(subId);
      if (sub && sub.type === "pattern" && sub.pattern) {
        if (sub.pattern.test(message.topic) && !subscriptions.includes(sub)) {
          subscriptions.push(sub);
        }
      }
    }

    // Sort by message priority
    subscriptions = subscriptions.sort((a, b) => {
      const prioOrder = PRIORITY_ORDER[message.priority];
      return prioOrder; // Higher priority messages processed first
    });

    // Deliver to each subscriber
    const deliveryPromises = subscriptions.map(async (sub) => {
      // Apply filter
      if (!this.passesFilter(message, sub.filter)) {
        return;
      }

      try {
        await sub.handler(message);

        // Update subscription stats
        sub.messageCount++;
        sub.lastMessageAt = Date.now();

        // Acknowledge if required
        if (sub.options.ackRequired && this.config.enablePersistence) {
          this.db
            .prepare(
              `
            INSERT OR IGNORE INTO message_acks (message_id, subscriber_id, acknowledged_at)
            VALUES (?, ?, ?)
          `
            )
            .run(message.id, sub.subscriberId, Date.now());
        }

        this.emit("message:delivered", {
          messageId: message.id,
          subscriberId: sub.subscriberId,
        });
      } catch (error) {
        await this.handleDeliveryFailure(message, sub, error);
      }
    });

    await Promise.all(deliveryPromises);

    // Update message status
    if (this.config.enablePersistence) {
      this.db
        .prepare(`UPDATE messages SET status = 'delivered' WHERE id = ?`)
        .run(message.id);
    }
  }

  /**
   * Handle delivery failure with retry logic
   */
  private async handleDeliveryFailure(
    message: BusMessage,
    subscription: Subscription,
    error: unknown
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.emit("message:delivery-failed", {
      messageId: message.id,
      subscriberId: subscription.subscriberId,
      error: errorMessage,
    });

    // Check retry count
    if (message.retryCount < subscription.options.maxRetries) {
      // Schedule retry
      const retryKey = `${message.id}-${subscription.id}`;
      const delay = subscription.options.retryDelayMs * Math.pow(2, message.retryCount);

      const timer = setTimeout(async () => {
        this.retryTimers.delete(retryKey);
        message.retryCount++;

        // Update retry count in DB
        if (this.config.enablePersistence) {
          this.db
            .prepare(`UPDATE messages SET retry_count = ? WHERE id = ?`)
            .run(message.retryCount, message.id);
        }

        try {
          await subscription.handler(message);
          subscription.messageCount++;
          subscription.lastMessageAt = Date.now();
        } catch (retryError) {
          await this.handleDeliveryFailure(message, subscription, retryError);
        }
      }, delay);

      this.retryTimers.set(retryKey, timer);

      this.emit("message:retry-scheduled", {
        messageId: message.id,
        retryCount: message.retryCount + 1,
        delayMs: delay,
      });
    } else {
      // Move to dead letter queue
      await this.moveToDeadLetter(message, errorMessage);
    }
  }

  /**
   * Move message to dead letter queue
   */
  private async moveToDeadLetter(
    message: BusMessage,
    error: string
  ): Promise<void> {
    const deadLetterId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (this.config.enablePersistence) {
      this.db
        .prepare(
          `
        INSERT INTO dead_letter (id, message_id, topic, payload, error, failed_at, retry_count, original_timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          deadLetterId,
          message.id,
          message.topic,
          JSON.stringify(message.payload),
          error,
          Date.now(),
          message.retryCount,
          message.timestamp
        );

      this.db
        .prepare(`UPDATE messages SET status = 'dead_letter' WHERE id = ?`)
        .run(message.id);
    }

    this.emit("message:dead-letter", {
      messageId: message.id,
      error,
    });
  }

  // ========================================================================
  // Message Replay
  // ========================================================================

  /**
   * Replay messages from persistence
   */
  async replay(
    subscriberId: string,
    handler: SubscriptionHandler,
    options: ReplayOptions = {}
  ): Promise<number> {
    if (!this.config.enablePersistence) {
      throw new Error("Message persistence is not enabled");
    }

    let sql = `SELECT * FROM messages WHERE status IN ('delivered', 'acknowledged')`;
    const params: unknown[] = [];

    if (options.fromTimestamp) {
      sql += ` AND timestamp >= ?`;
      params.push(options.fromTimestamp);
    }

    if (options.toTimestamp) {
      sql += ` AND timestamp <= ?`;
      params.push(options.toTimestamp);
    }

    if (options.topic) {
      sql += ` AND topic LIKE ?`;
      params.push(options.topic.replace("**", "%").replace("*", "%"));
    }

    // Exclude already acknowledged messages for this subscriber
    sql += `
      AND id NOT IN (
        SELECT message_id FROM message_acks WHERE subscriber_id = ?
      )
    `;
    params.push(subscriberId);

    sql += ` ORDER BY timestamp ASC`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as DbMessageRow[];

    let replayedCount = 0;

    for (const row of rows) {
      const message = this.rowToMessage(row);

      try {
        await handler(message);
        replayedCount++;

        // Mark as acknowledged for this subscriber
        this.db
          .prepare(
            `
          INSERT OR IGNORE INTO message_acks (message_id, subscriber_id, acknowledged_at)
          VALUES (?, ?, ?)
        `
          )
          .run(message.id, subscriberId, Date.now());
      } catch (error) {
        this.emit("replay:error", {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.emit("replay:completed", {
      subscriberId,
      replayedCount,
      totalFound: rows.length,
    });

    return replayedCount;
  }

  // ========================================================================
  // Dead Letter Queue
  // ========================================================================

  /**
   * Get dead letter queue entries
   */
  getDeadLetters(limit = 100): DeadLetterEntry[] {
    if (!this.config.enablePersistence) return [];

    const rows = this.db
      .prepare(
        `
      SELECT * FROM dead_letter
      ORDER BY failed_at DESC
      LIMIT ?
    `
      )
      .all(limit) as DbDeadLetterRow[];

    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      topic: row.topic,
      payload: JSON.parse(row.payload),
      error: row.error,
      failedAt: row.failed_at,
      retryCount: row.retry_count,
      originalTimestamp: row.original_timestamp,
    }));
  }

  /**
   * Retry a dead letter message
   */
  async retryDeadLetter(deadLetterId: string, publisherId: string): Promise<BusMessage | null> {
    if (!this.config.enablePersistence) return null;

    const row = this.db
      .prepare(`SELECT * FROM dead_letter WHERE id = ?`)
      .get(deadLetterId) as DbDeadLetterRow | undefined;

    if (!row) return null;

    // Remove from dead letter queue
    this.db.prepare(`DELETE FROM dead_letter WHERE id = ?`).run(deadLetterId);

    // Republish
    const message = await this.publish(
      row.topic,
      JSON.parse(row.payload),
      publisherId,
      { priority: "normal" }
    );

    this.emit("dead-letter:retried", { deadLetterId, newMessageId: message.id });

    return message;
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetters(topic?: string): number {
    if (!this.config.enablePersistence) return 0;

    let sql = `DELETE FROM dead_letter`;
    const params: unknown[] = [];

    if (topic) {
      sql += ` WHERE topic = ?`;
      params.push(topic);
    }

    const result = this.db.prepare(sql).run(...params);
    this.emit("dead-letter:cleared", { count: result.changes });

    return result.changes;
  }

  // ========================================================================
  // Acknowledgment
  // ========================================================================

  /**
   * Acknowledge message receipt
   */
  acknowledge(messageId: string, subscriberId: string): boolean {
    if (!this.config.enablePersistence) return false;

    const result = this.db
      .prepare(
        `
      INSERT OR IGNORE INTO message_acks (message_id, subscriber_id, acknowledged_at)
      VALUES (?, ?, ?)
    `
      )
      .run(messageId, subscriberId, Date.now());

    if (result.changes > 0) {
      // Check if all subscribers acknowledged
      const message = this.db
        .prepare(`SELECT * FROM messages WHERE id = ?`)
        .get(messageId) as DbMessageRow | undefined;

      if (message) {
        const ackCount = (
          this.db
            .prepare(`SELECT COUNT(*) as cnt FROM message_acks WHERE message_id = ?`)
            .get(messageId) as { cnt: number }
        ).cnt;

        // If at least one ack, mark as acknowledged
        if (ackCount > 0) {
          this.db
            .prepare(`UPDATE messages SET status = 'acknowledged' WHERE id = ?`)
            .run(messageId);
        }
      }

      this.emit("message:acknowledged", { messageId, subscriberId });
    }

    return result.changes > 0;
  }

  // ========================================================================
  // Topic Management
  // ========================================================================

  /**
   * Get all active topics
   */
  getTopics(): string[] {
    const topics = new Set<string>();

    // From subscriptions
    for (const sub of this.subscriptions.values()) {
      if (sub.type === "exact") {
        topics.add(sub.topic);
      }
    }

    // From persistent messages
    if (this.config.enablePersistence) {
      const rows = this.db
        .prepare(`SELECT DISTINCT topic FROM messages WHERE status = 'pending'`)
        .all() as Array<{ topic: string }>;

      for (const row of rows) {
        topics.add(row.topic);
      }
    }

    return Array.from(topics).sort();
  }

  /**
   * Get subscribers for a topic
   */
  getSubscribers(topic: string): string[] {
    const subscriptions = this.getMatchingSubscriptions(topic);
    return subscriptions.map((s) => s.subscriberId);
  }

  // ========================================================================
  // Statistics
  // ========================================================================

  /**
   * Get message bus statistics
   */
  getStats(): BusStats {
    // Calculate messages per second
    const now = Date.now();
    const elapsed = (now - this.messageCountResetTime) / 1000;
    const messagesPerSecond = elapsed > 0 ? this.messageCount / elapsed : 0;

    // Reset counter periodically
    if (elapsed > 60) {
      this.messageCount = 0;
      this.messageCountResetTime = now;
    }

    const stats: BusStats = {
      totalMessages: 0,
      messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
      totalSubscriptions: this.subscriptions.size,
      activeSubscriptions: 0,
      deadLetterCount: 0,
      pendingMessages: 0,
      topicCounts: {},
      priorityDistribution: {
        critical: 0,
        high: 0,
        normal: 0,
        low: 0,
      },
    };

    // Count active subscriptions (with recent activity)
    const recentCutoff = now - 300000; // 5 minutes
    for (const sub of this.subscriptions.values()) {
      if (sub.lastMessageAt && sub.lastMessageAt > recentCutoff) {
        stats.activeSubscriptions++;
      }
    }

    // Database stats
    if (this.config.enablePersistence) {
      const totalCount = (
        this.db
          .prepare(`SELECT COUNT(*) as cnt FROM messages`)
          .get() as { cnt: number }
      ).cnt;
      stats.totalMessages = totalCount;

      const pendingCount = (
        this.db
          .prepare(`SELECT COUNT(*) as cnt FROM messages WHERE status = 'pending'`)
          .get() as { cnt: number }
      ).cnt;
      stats.pendingMessages = pendingCount;

      const deadLetterCount = (
        this.db
          .prepare(`SELECT COUNT(*) as cnt FROM dead_letter`)
          .get() as { cnt: number }
      ).cnt;
      stats.deadLetterCount = deadLetterCount;

      // Topic counts
      const topicCounts = this.db
        .prepare(
          `
        SELECT topic, COUNT(*) as cnt FROM messages
        WHERE timestamp > ?
        GROUP BY topic
        ORDER BY cnt DESC
        LIMIT 20
      `
        )
        .all(now - 3600000) as Array<{ topic: string; cnt: number }>;

      for (const { topic, cnt } of topicCounts) {
        stats.topicCounts[topic] = cnt;
      }

      // Priority distribution
      const prioCounts = this.db
        .prepare(
          `
        SELECT priority, COUNT(*) as cnt FROM messages
        WHERE timestamp > ?
        GROUP BY priority
      `
        )
        .all(now - 3600000) as Array<{ priority: MessagePriority; cnt: number }>;

      for (const { priority, cnt } of prioCounts) {
        stats.priorityDistribution[priority] = cnt;
      }
    }

    return stats;
  }

  /**
   * Get subscription info
   */
  getSubscription(subscriptionId: string): Subscription | null {
    return this.subscriptions.get(subscriptionId) ?? null;
  }

  /**
   * List all subscriptions
   */
  listSubscriptions(subscriberId?: string): Subscription[] {
    const subs = Array.from(this.subscriptions.values());

    if (subscriberId) {
      return subs.filter((s) => s.subscriberId === subscriberId);
    }

    return subs;
  }

  /**
   * Get message by ID
   */
  getMessage(messageId: string): BusMessage | null {
    if (!this.config.enablePersistence) return null;

    const row = this.db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .get(messageId) as DbMessageRow | undefined;

    if (!row) return null;

    return this.rowToMessage(row);
  }

  private rowToMessage(row: DbMessageRow): BusMessage {
    return {
      id: row.id,
      topic: row.topic,
      payload: JSON.parse(row.payload),
      priority: row.priority as MessagePriority,
      publisherId: row.publisher_id,
      correlationId: row.correlation_id ?? undefined,
      replyTo: row.reply_to ?? undefined,
      headers: JSON.parse(row.headers),
      timestamp: row.timestamp,
      expiresAt: row.expires_at ?? undefined,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      status: row.status as MessageStatus,
    };
  }

  /**
   * Close the message bus
   */
  close(): void {
    this.stopCleanupTimer();

    // Clear all retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    // Clear pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();

    this.db.close();
    this.emit("bus:closed");
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface DbMessageRow {
  id: string;
  topic: string;
  payload: string;
  priority: string;
  publisher_id: string;
  correlation_id: string | null;
  reply_to: string | null;
  headers: string;
  timestamp: number;
  expires_at: number | null;
  retry_count: number;
  max_retries: number;
  status: string;
}

interface DbDeadLetterRow {
  id: string;
  message_id: string;
  topic: string;
  payload: string;
  error: string;
  failed_at: number;
  retry_count: number;
  original_timestamp: number;
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: MessageBus | null = null;

export function getMessageBus(
  dataDir: string,
  config?: Partial<MessageBusConfig>
): MessageBus {
  if (!instance) {
    instance = new MessageBus(dataDir, config);
  }
  return instance;
}

export function resetMessageBus(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
