/**
 * Class 3.10 Agent Notification System
 *
 * TAC Pattern: Cross-Channel Alerts & Notifications
 * "Keep users informed of agent activity across channels"
 *
 * Features:
 * - Priority-based notifications (info, warning, critical)
 * - User preference management
 * - Notification aggregation and batching
 * - Quiet hours support
 * - Channel routing (DM, specific channel, broadcast)
 * - Notification templates
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import { join } from "path";

// =============================================================================
// Types
// =============================================================================

/** Notification priority levels */
export type NotificationPriority = "info" | "success" | "warning" | "error" | "critical";

/** Notification delivery method */
export type DeliveryMethod = "dm" | "channel" | "thread" | "broadcast";

/** Notification status */
export type NotificationStatus = "pending" | "sent" | "delivered" | "read" | "failed";

/** Notification entry */
export interface Notification {
	id: string;
	timestamp: Date;
	agentId: string;
	userId: string;
	channelId?: string;

	/** Notification title */
	title: string;
	/** Notification message */
	message: string;
	/** Priority level */
	priority: NotificationPriority;
	/** Delivery method */
	delivery: DeliveryMethod;
	/** Current status */
	status: NotificationStatus;

	/** Optional action URL or command */
	action?: string;
	/** Related entity ID (task, workflow, etc.) */
	relatedId?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;

	/** When the notification was sent */
	sentAt?: Date;
	/** When the notification was read */
	readAt?: Date;
}

/** User notification preferences */
export interface UserPreferences {
	userId: string;
	/** Enable notifications */
	enabled: boolean;
	/** Minimum priority to notify */
	minPriority: NotificationPriority;
	/** Preferred delivery method */
	preferredDelivery: DeliveryMethod;
	/** Quiet hours (no notifications) */
	quietHoursStart?: number; // Hour 0-23
	quietHoursEnd?: number;
	/** Agents to mute */
	mutedAgents: string[];
	/** Batch notifications instead of instant */
	batchNotifications: boolean;
	/** Batch interval in minutes */
	batchIntervalMinutes: number;
}

/** Notification template */
export interface NotificationTemplate {
	id: string;
	name: string;
	titleTemplate: string;
	messageTemplate: string;
	defaultPriority: NotificationPriority;
}

/** Notification config */
export interface NotificationConfig {
	/** Default priority */
	defaultPriority: NotificationPriority;
	/** Default delivery method */
	defaultDelivery: DeliveryMethod;
	/** Enable batching globally */
	enableBatching: boolean;
	/** Default batch interval */
	defaultBatchInterval: number;
	/** Max notifications per batch */
	maxBatchSize: number;
	/** Retention days */
	retentionDays: number;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
	defaultPriority: "info",
	defaultDelivery: "channel",
	enableBatching: false,
	defaultBatchInterval: 15,
	maxBatchSize: 10,
	retentionDays: 30,
};

// =============================================================================
// Built-in Templates
// =============================================================================

export const BUILTIN_TEMPLATES: Record<string, NotificationTemplate> = {
	"task-complete": {
		id: "task-complete",
		name: "Task Complete",
		titleTemplate: "✅ Task Completed",
		messageTemplate: "Agent **{agentId}** completed task: {taskName}",
		defaultPriority: "success",
	},
	"task-failed": {
		id: "task-failed",
		name: "Task Failed",
		titleTemplate: "❌ Task Failed",
		messageTemplate: "Agent **{agentId}** failed task: {taskName}\nError: {error}",
		defaultPriority: "error",
	},
	"workflow-started": {
		id: "workflow-started",
		name: "Workflow Started",
		titleTemplate: "🚀 Workflow Started",
		messageTemplate: "Workflow **{workflowName}** started with {agentCount} agents",
		defaultPriority: "info",
	},
	"workflow-complete": {
		id: "workflow-complete",
		name: "Workflow Complete",
		titleTemplate: "🎉 Workflow Complete",
		messageTemplate: "Workflow **{workflowName}** completed successfully",
		defaultPriority: "success",
	},
	"agent-error": {
		id: "agent-error",
		name: "Agent Error",
		titleTemplate: "⚠️ Agent Error",
		messageTemplate: "Agent **{agentId}** encountered an error: {error}",
		defaultPriority: "error",
	},
	"safety-blocked": {
		id: "safety-blocked",
		name: "Safety Block",
		titleTemplate: "🛡️ Command Blocked",
		messageTemplate: "Safety guards blocked a {risk} risk command: `{command}`",
		defaultPriority: "warning",
	},
	"learning-insight": {
		id: "learning-insight",
		name: "Learning Insight",
		titleTemplate: "💡 New Insight",
		messageTemplate: "Agent memory system discovered: {insight}",
		defaultPriority: "info",
	},
	"trading-signal": {
		id: "trading-signal",
		name: "Trading Signal",
		titleTemplate: "📈 Trading Signal",
		messageTemplate: "{action} **{symbol}** at ${price} (confidence: {confidence}%)",
		defaultPriority: "warning",
	},
	"system-alert": {
		id: "system-alert",
		name: "System Alert",
		titleTemplate: "🔔 System Alert",
		messageTemplate: "{message}",
		defaultPriority: "critical",
	},
};

// =============================================================================
// Priority Helpers
// =============================================================================

const PRIORITY_ORDER: Record<NotificationPriority, number> = {
	info: 0,
	success: 1,
	warning: 2,
	error: 3,
	critical: 4,
};

function isPriorityAtOrAbove(priority: NotificationPriority, threshold: NotificationPriority): boolean {
	return PRIORITY_ORDER[priority] >= PRIORITY_ORDER[threshold];
}

// =============================================================================
// Agent Notification System
// =============================================================================

export class AgentNotificationSystem extends EventEmitter {
	private db: Database.Database;
	private config: NotificationConfig;
	private templates: Map<string, NotificationTemplate> = new Map();
	private pendingBatches: Map<string, Notification[]> = new Map();
	private batchTimers: Map<string, NodeJS.Timeout> = new Map();

	constructor(dataDir: string, config: Partial<NotificationConfig> = {}) {
		super();
		this.db = new Database(join(dataDir, "agent_notifications.db"));
		this.config = { ...DEFAULT_NOTIFICATION_CONFIG, ...config };

		this.initDatabase();
		this.loadTemplates();
	}

	private initDatabase(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS notifications (
				id TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				channel_id TEXT,
				title TEXT NOT NULL,
				message TEXT NOT NULL,
				priority TEXT NOT NULL,
				delivery TEXT NOT NULL,
				status TEXT NOT NULL,
				action TEXT,
				related_id TEXT,
				metadata TEXT,
				sent_at TEXT,
				read_at TEXT
			);

			CREATE TABLE IF NOT EXISTS user_preferences (
				user_id TEXT PRIMARY KEY,
				enabled INTEGER DEFAULT 1,
				min_priority TEXT DEFAULT 'info',
				preferred_delivery TEXT DEFAULT 'channel',
				quiet_hours_start INTEGER,
				quiet_hours_end INTEGER,
				muted_agents TEXT DEFAULT '[]',
				batch_notifications INTEGER DEFAULT 0,
				batch_interval_minutes INTEGER DEFAULT 15
			);

			CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
			CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
			CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp);
			CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
		`);
	}

	private loadTemplates(): void {
		for (const [id, template] of Object.entries(BUILTIN_TEMPLATES)) {
			this.templates.set(id, template);
		}
	}

	// =========================================================================
	// Notification Creation
	// =========================================================================

	/** Create and queue a notification */
	notify(params: {
		agentId: string;
		userId: string;
		channelId?: string;
		title: string;
		message: string;
		priority?: NotificationPriority;
		delivery?: DeliveryMethod;
		action?: string;
		relatedId?: string;
		metadata?: Record<string, unknown>;
	}): Notification {
		const preferences = this.getUserPreferences(params.userId);

		// Check if notifications are enabled
		if (!preferences.enabled) {
			return this.createSkippedNotification(params, "disabled");
		}

		// Check muted agents
		if (preferences.mutedAgents.includes(params.agentId)) {
			return this.createSkippedNotification(params, "muted");
		}

		// Check priority threshold
		const priority = params.priority || this.config.defaultPriority;
		if (!isPriorityAtOrAbove(priority, preferences.minPriority)) {
			return this.createSkippedNotification(params, "below_threshold");
		}

		// Check quiet hours
		if (this.isQuietHours(preferences)) {
			// Only allow critical during quiet hours
			if (priority !== "critical") {
				return this.createSkippedNotification(params, "quiet_hours");
			}
		}

		const notification: Notification = {
			id: crypto.randomUUID(),
			timestamp: new Date(),
			agentId: params.agentId,
			userId: params.userId,
			channelId: params.channelId,
			title: params.title,
			message: params.message,
			priority,
			delivery: params.delivery || preferences.preferredDelivery || this.config.defaultDelivery,
			status: "pending",
			action: params.action,
			relatedId: params.relatedId,
			metadata: params.metadata,
		};

		// Store notification
		this.storeNotification(notification);

		// Handle batching or immediate send
		if (preferences.batchNotifications && priority !== "critical") {
			this.addToBatch(notification, preferences);
		} else {
			this.emit("send", notification);
			notification.status = "sent";
			notification.sentAt = new Date();
			this.updateNotificationStatus(notification.id, "sent", notification.sentAt);
		}

		return notification;
	}

	/** Create notification from template */
	notifyFromTemplate(
		templateId: string,
		params: {
			agentId: string;
			userId: string;
			channelId?: string;
			variables: Record<string, string>;
			action?: string;
			relatedId?: string;
		},
	): Notification {
		const template = this.templates.get(templateId);
		if (!template) {
			throw new Error(`Template not found: ${templateId}`);
		}

		// Replace variables in template
		let title = template.titleTemplate;
		let message = template.messageTemplate;

		for (const [key, value] of Object.entries(params.variables)) {
			title = title.replace(new RegExp(`\\{${key}\\}`, "g"), value);
			message = message.replace(new RegExp(`\\{${key}\\}`, "g"), value);
		}

		return this.notify({
			agentId: params.agentId,
			userId: params.userId,
			channelId: params.channelId,
			title,
			message,
			priority: template.defaultPriority,
			action: params.action,
			relatedId: params.relatedId,
			metadata: { templateId, variables: params.variables },
		});
	}

	/** Quick notification helpers */
	info(agentId: string, userId: string, message: string, channelId?: string): Notification {
		return this.notify({ agentId, userId, channelId, title: "ℹ️ Info", message, priority: "info" });
	}

	success(agentId: string, userId: string, message: string, channelId?: string): Notification {
		return this.notify({ agentId, userId, channelId, title: "✅ Success", message, priority: "success" });
	}

	warning(agentId: string, userId: string, message: string, channelId?: string): Notification {
		return this.notify({ agentId, userId, channelId, title: "⚠️ Warning", message, priority: "warning" });
	}

	error(agentId: string, userId: string, message: string, channelId?: string): Notification {
		return this.notify({ agentId, userId, channelId, title: "❌ Error", message, priority: "error" });
	}

	critical(agentId: string, userId: string, message: string, channelId?: string): Notification {
		return this.notify({ agentId, userId, channelId, title: "🚨 Critical", message, priority: "critical" });
	}

	// =========================================================================
	// Batch Management
	// =========================================================================

	private addToBatch(notification: Notification, preferences: UserPreferences): void {
		const userId = notification.userId;

		if (!this.pendingBatches.has(userId)) {
			this.pendingBatches.set(userId, []);
		}

		const batch = this.pendingBatches.get(userId)!;
		batch.push(notification);

		// Start batch timer if not already running
		if (!this.batchTimers.has(userId)) {
			const timer = setTimeout(
				() => this.flushBatch(userId),
				(preferences.batchIntervalMinutes || this.config.defaultBatchInterval) * 60 * 1000,
			);
			this.batchTimers.set(userId, timer);
		}

		// Flush if batch is full
		if (batch.length >= this.config.maxBatchSize) {
			this.flushBatch(userId);
		}
	}

	private flushBatch(userId: string): void {
		const batch = this.pendingBatches.get(userId);
		if (!batch || batch.length === 0) return;

		// Clear timer
		const timer = this.batchTimers.get(userId);
		if (timer) {
			clearTimeout(timer);
			this.batchTimers.delete(userId);
		}

		// Emit batched notification
		this.emit("sendBatch", { userId, notifications: batch });

		// Update statuses
		const sentAt = new Date();
		for (const notification of batch) {
			notification.status = "sent";
			notification.sentAt = sentAt;
			this.updateNotificationStatus(notification.id, "sent", sentAt);
		}

		// Clear batch
		this.pendingBatches.delete(userId);
	}

	/** Flush all pending batches */
	flushAllBatches(): void {
		for (const userId of this.pendingBatches.keys()) {
			this.flushBatch(userId);
		}
	}

	// =========================================================================
	// User Preferences
	// =========================================================================

	/** Get user preferences */
	getUserPreferences(userId: string): UserPreferences {
		const row = this.db.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`).get(userId) as any;

		if (!row) {
			// Return defaults
			return {
				userId,
				enabled: true,
				minPriority: "info",
				preferredDelivery: this.config.defaultDelivery,
				mutedAgents: [],
				batchNotifications: this.config.enableBatching,
				batchIntervalMinutes: this.config.defaultBatchInterval,
			};
		}

		return {
			userId: row.user_id,
			enabled: Boolean(row.enabled),
			minPriority: row.min_priority,
			preferredDelivery: row.preferred_delivery,
			quietHoursStart: row.quiet_hours_start,
			quietHoursEnd: row.quiet_hours_end,
			mutedAgents: JSON.parse(row.muted_agents || "[]"),
			batchNotifications: Boolean(row.batch_notifications),
			batchIntervalMinutes: row.batch_interval_minutes,
		};
	}

	/** Update user preferences */
	setUserPreferences(userId: string, updates: Partial<UserPreferences>): void {
		const current = this.getUserPreferences(userId);
		const merged = { ...current, ...updates };

		this.db
			.prepare(
				`INSERT OR REPLACE INTO user_preferences (
					user_id, enabled, min_priority, preferred_delivery,
					quiet_hours_start, quiet_hours_end, muted_agents,
					batch_notifications, batch_interval_minutes
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				userId,
				merged.enabled ? 1 : 0,
				merged.minPriority,
				merged.preferredDelivery,
				merged.quietHoursStart ?? null,
				merged.quietHoursEnd ?? null,
				JSON.stringify(merged.mutedAgents),
				merged.batchNotifications ? 1 : 0,
				merged.batchIntervalMinutes,
			);

		this.emit("preferencesUpdated", { userId, preferences: merged });
	}

	/** Mute an agent */
	muteAgent(userId: string, agentId: string): void {
		const prefs = this.getUserPreferences(userId);
		if (!prefs.mutedAgents.includes(agentId)) {
			prefs.mutedAgents.push(agentId);
			this.setUserPreferences(userId, { mutedAgents: prefs.mutedAgents });
		}
	}

	/** Unmute an agent */
	unmuteAgent(userId: string, agentId: string): void {
		const prefs = this.getUserPreferences(userId);
		prefs.mutedAgents = prefs.mutedAgents.filter((id) => id !== agentId);
		this.setUserPreferences(userId, { mutedAgents: prefs.mutedAgents });
	}

	// =========================================================================
	// Notification Queries
	// =========================================================================

	/** Get notifications for a user */
	getUserNotifications(
		userId: string,
		options: {
			status?: NotificationStatus;
			priority?: NotificationPriority;
			limit?: number;
			unreadOnly?: boolean;
		} = {},
	): Notification[] {
		let sql = `SELECT * FROM notifications WHERE user_id = ?`;
		const params: any[] = [userId];

		if (options.status) {
			sql += ` AND status = ?`;
			params.push(options.status);
		}

		if (options.priority) {
			sql += ` AND priority = ?`;
			params.push(options.priority);
		}

		if (options.unreadOnly) {
			sql += ` AND read_at IS NULL`;
		}

		sql += ` ORDER BY timestamp DESC`;

		if (options.limit) {
			sql += ` LIMIT ?`;
			params.push(options.limit);
		}

		const rows = this.db.prepare(sql).all(...params) as any[];
		return rows.map(this.mapNotificationRow);
	}

	/** Get unread count for a user */
	getUnreadCount(userId: string): number {
		const result = this.db
			.prepare(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL`)
			.get(userId) as { count: number };
		return result.count;
	}

	/** Mark notification as read */
	markAsRead(notificationId: string): void {
		const readAt = new Date();
		this.db
			.prepare(`UPDATE notifications SET status = 'read', read_at = ? WHERE id = ?`)
			.run(readAt.toISOString(), notificationId);
		this.emit("read", { id: notificationId, readAt });
	}

	/** Mark all notifications as read for a user */
	markAllAsRead(userId: string): number {
		const result = this.db
			.prepare(`UPDATE notifications SET status = 'read', read_at = ? WHERE user_id = ? AND read_at IS NULL`)
			.run(new Date().toISOString(), userId);
		return result.changes;
	}

	/** Delete old notifications */
	cleanupOldNotifications(): number {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - this.config.retentionDays);

		const result = this.db.prepare(`DELETE FROM notifications WHERE timestamp < ?`).run(cutoff.toISOString());

		return result.changes;
	}

	// =========================================================================
	// Statistics
	// =========================================================================

	/** Get notification statistics */
	getStats(): {
		total: number;
		pending: number;
		sent: number;
		read: number;
		failed: number;
		byPriority: Record<NotificationPriority, number>;
		todayCount: number;
	} {
		const stats = this.db
			.prepare(
				`SELECT
					COUNT(*) as total,
					SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
					SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
					SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read,
					SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
				FROM notifications`,
			)
			.get() as any;

		const priorityStats = this.db
			.prepare(`SELECT priority, COUNT(*) as count FROM notifications GROUP BY priority`)
			.all() as { priority: NotificationPriority; count: number }[];

		const byPriority: Record<NotificationPriority, number> = {
			info: 0,
			success: 0,
			warning: 0,
			error: 0,
			critical: 0,
		};
		for (const ps of priorityStats) {
			byPriority[ps.priority] = ps.count;
		}

		const today = new Date().toISOString().split("T")[0];
		const todayResult = this.db
			.prepare(`SELECT COUNT(*) as count FROM notifications WHERE timestamp >= ?`)
			.get(`${today}T00:00:00`) as { count: number };

		return {
			total: stats.total,
			pending: stats.pending || 0,
			sent: stats.sent || 0,
			read: stats.read || 0,
			failed: stats.failed || 0,
			byPriority,
			todayCount: todayResult.count,
		};
	}

	// =========================================================================
	// Template Management
	// =========================================================================

	/** Register a custom template */
	registerTemplate(template: NotificationTemplate): void {
		this.templates.set(template.id, template);
		this.emit("templateRegistered", template);
	}

	/** Get all templates */
	listTemplates(): NotificationTemplate[] {
		return Array.from(this.templates.values());
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	private storeNotification(notification: Notification): void {
		this.db
			.prepare(
				`INSERT INTO notifications (
					id, timestamp, agent_id, user_id, channel_id,
					title, message, priority, delivery, status,
					action, related_id, metadata, sent_at, read_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				notification.id,
				notification.timestamp.toISOString(),
				notification.agentId,
				notification.userId,
				notification.channelId || null,
				notification.title,
				notification.message,
				notification.priority,
				notification.delivery,
				notification.status,
				notification.action || null,
				notification.relatedId || null,
				notification.metadata ? JSON.stringify(notification.metadata) : null,
				notification.sentAt?.toISOString() || null,
				notification.readAt?.toISOString() || null,
			);
	}

	private updateNotificationStatus(id: string, status: NotificationStatus, sentAt?: Date): void {
		if (sentAt) {
			this.db
				.prepare(`UPDATE notifications SET status = ?, sent_at = ? WHERE id = ?`)
				.run(status, sentAt.toISOString(), id);
		} else {
			this.db.prepare(`UPDATE notifications SET status = ? WHERE id = ?`).run(status, id);
		}
	}

	private createSkippedNotification(params: any, reason: string): Notification {
		return {
			id: crypto.randomUUID(),
			timestamp: new Date(),
			agentId: params.agentId,
			userId: params.userId,
			channelId: params.channelId,
			title: params.title,
			message: params.message,
			priority: params.priority || this.config.defaultPriority,
			delivery: params.delivery || this.config.defaultDelivery,
			status: "failed",
			metadata: { skippedReason: reason },
		};
	}

	private isQuietHours(preferences: UserPreferences): boolean {
		if (preferences.quietHoursStart === undefined || preferences.quietHoursEnd === undefined) {
			return false;
		}

		const now = new Date().getHours();
		const start = preferences.quietHoursStart;
		const end = preferences.quietHoursEnd;

		if (start <= end) {
			// Same day range (e.g., 9-17)
			return now >= start && now < end;
		} else {
			// Overnight range (e.g., 22-7)
			return now >= start || now < end;
		}
	}

	private mapNotificationRow(row: any): Notification {
		return {
			id: row.id,
			timestamp: new Date(row.timestamp),
			agentId: row.agent_id,
			userId: row.user_id,
			channelId: row.channel_id,
			title: row.title,
			message: row.message,
			priority: row.priority,
			delivery: row.delivery,
			status: row.status,
			action: row.action,
			relatedId: row.related_id,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			sentAt: row.sent_at ? new Date(row.sent_at) : undefined,
			readAt: row.read_at ? new Date(row.read_at) : undefined,
		};
	}

	// =========================================================================
	// Accessors
	// =========================================================================

	getConfig(): NotificationConfig {
		return { ...this.config };
	}

	updateConfig(updates: Partial<NotificationConfig>): void {
		this.config = { ...this.config, ...updates };
	}

	close(): void {
		this.flushAllBatches();
		this.db.close();
	}
}

// =============================================================================
// Factory
// =============================================================================

let notificationInstance: AgentNotificationSystem | null = null;

export function getNotificationSystem(dataDir: string, config?: Partial<NotificationConfig>): AgentNotificationSystem {
	if (!notificationInstance) {
		notificationInstance = new AgentNotificationSystem(dataDir, config);
	}
	return notificationInstance;
}

export function resetNotificationSystem(): void {
	if (notificationInstance) {
		notificationInstance.close();
		notificationInstance = null;
	}
}
