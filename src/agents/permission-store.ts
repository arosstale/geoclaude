/**
 * Permission Store - Per-Channel/User Permission Overrides
 * Stores custom permission rules in the database for granular control
 */

import type { BotDatabase } from "../database.js";
import type { PermissionResult, ToolPermission } from "./tool-permissions.js";
import { getPermissionChecker } from "./tool-permissions.js";

// =============================================================================
// Types
// =============================================================================

export interface PermissionOverride {
	id: string;
	/** Channel ID or '*' for global */
	channelId: string;
	/** User ID or '*' for all users */
	userId: string;
	/** Tool name */
	tool: string;
	/** Override configuration */
	permission: ToolPermission;
	/** When this override was created */
	createdAt: string;
	/** Who created this override (admin user ID) */
	createdBy: string;
}

export interface ApprovalRequest {
	id: string;
	channelId: string;
	userId: string;
	tool: string;
	args: Record<string, any>;
	reason: string;
	status: "pending" | "approved" | "rejected";
	createdAt: string;
	resolvedAt?: string;
	resolvedBy?: string;
}

// =============================================================================
// Permission Store
// =============================================================================

export class PermissionStore {
	private db: BotDatabase;
	private overridesCache: Map<string, PermissionOverride> = new Map();

	constructor(db: BotDatabase) {
		this.db = db;
		this.initializeTables();
		this.loadOverrides();
	}

	/**
	 * Initialize database tables
	 */
	private initializeTables(): void {
		// Permission overrides table
		this.db.db.exec(`
			CREATE TABLE IF NOT EXISTS permission_overrides (
				id TEXT PRIMARY KEY,
				channel_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				tool TEXT NOT NULL,
				permission_json TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				created_by TEXT NOT NULL
			)
		`);

		// Approval requests table
		this.db.db.exec(`
			CREATE TABLE IF NOT EXISTS approval_requests (
				id TEXT PRIMARY KEY,
				channel_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				tool TEXT NOT NULL,
				args_json TEXT NOT NULL,
				reason TEXT NOT NULL,
				status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) NOT NULL DEFAULT 'pending',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				resolved_at TEXT,
				resolved_by TEXT
			)
		`);

		// Indexes
		this.db.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_permission_overrides_channel ON permission_overrides(channel_id);
			CREATE INDEX IF NOT EXISTS idx_permission_overrides_user ON permission_overrides(user_id);
			CREATE INDEX IF NOT EXISTS idx_permission_overrides_tool ON permission_overrides(tool);
			CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
			CREATE INDEX IF NOT EXISTS idx_approval_requests_user ON approval_requests(user_id);
		`);
	}

	/**
	 * Load all overrides into cache
	 */
	private loadOverrides(): void {
		const stmt = this.db.db.prepare("SELECT * FROM permission_overrides");
		const rows = stmt.all() as Array<{
			id: string;
			channel_id: string;
			user_id: string;
			tool: string;
			permission_json: string;
			created_at: string;
			created_by: string;
		}>;

		for (const row of rows) {
			const override: PermissionOverride = {
				id: row.id,
				channelId: row.channel_id,
				userId: row.user_id,
				tool: row.tool,
				permission: JSON.parse(row.permission_json),
				createdAt: row.created_at,
				createdBy: row.created_by,
			};
			this.overridesCache.set(override.id, override);
		}
	}

	/**
	 * Get permission override for specific channel/user/tool
	 * Priority: channel+user > channel+* > *+user > *+*
	 */
	getOverride(channelId: string, userId: string, tool: string): PermissionOverride | null {
		// Check in priority order
		const overrides = Array.from(this.overridesCache.values());

		// 1. Exact match: channel+user+tool
		for (const override of overrides) {
			if (override.channelId === channelId && override.userId === userId && override.tool === tool) {
				return override;
			}
		}

		// 2. Channel+all users+tool
		for (const override of overrides) {
			if (override.channelId === channelId && override.userId === "*" && override.tool === tool) {
				return override;
			}
		}

		// 3. All channels+user+tool
		for (const override of overrides) {
			if (override.channelId === "*" && override.userId === userId && override.tool === tool) {
				return override;
			}
		}

		// 4. Global: all channels+all users+tool
		for (const override of overrides) {
			if (override.channelId === "*" && override.userId === "*" && override.tool === tool) {
				return override;
			}
		}

		return null;
	}

	/**
	 * Add or update permission override
	 */
	setOverride(channelId: string, userId: string, tool: string, permission: ToolPermission, createdBy: string): string {
		const id = `override_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const stmt = this.db.db.prepare(`
			INSERT OR REPLACE INTO permission_overrides
			(id, channel_id, user_id, tool, permission_json, created_by)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		stmt.run(id, channelId, userId, tool, JSON.stringify(permission), createdBy);

		const override: PermissionOverride = {
			id,
			channelId,
			userId,
			tool,
			permission,
			createdAt: new Date().toISOString(),
			createdBy,
		};

		this.overridesCache.set(id, override);
		return id;
	}

	/**
	 * Remove permission override
	 */
	removeOverride(id: string): boolean {
		const stmt = this.db.db.prepare("DELETE FROM permission_overrides WHERE id = ?");
		const result = stmt.run(id);

		if (result.changes > 0) {
			this.overridesCache.delete(id);
			return true;
		}

		return false;
	}

	/**
	 * List all overrides
	 */
	listOverrides(filters?: { channelId?: string; userId?: string; tool?: string }): PermissionOverride[] {
		const results: PermissionOverride[] = [];
		const overrides = Array.from(this.overridesCache.values());

		for (const override of overrides) {
			if (filters?.channelId && override.channelId !== filters.channelId) {
				continue;
			}
			if (filters?.userId && override.userId !== filters.userId) {
				continue;
			}
			if (filters?.tool && override.tool !== filters.tool) {
				continue;
			}
			results.push(override);
		}

		return results;
	}

	/**
	 * Check permission with overrides applied
	 */
	checkPermission(channelId: string, userId: string, tool: string, args: Record<string, any>): PermissionResult {
		const override = this.getOverride(channelId, userId, tool);

		if (override) {
			// Use override permission
			const checker = getPermissionChecker({ [tool]: override.permission });
			return checker.checkPermission(tool, args);
		}

		// Fall back to default permission check
		const checker = getPermissionChecker();
		return checker.checkPermission(tool, args);
	}

	// =============================================================================
	// Approval Requests
	// =============================================================================

	/**
	 * Create approval request
	 */
	createApprovalRequest(
		channelId: string,
		userId: string,
		tool: string,
		args: Record<string, any>,
		reason: string,
	): string {
		const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const stmt = this.db.db.prepare(`
			INSERT INTO approval_requests
			(id, channel_id, user_id, tool, args_json, reason)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		stmt.run(id, channelId, userId, tool, JSON.stringify(args), reason);

		return id;
	}

	/**
	 * Get approval request
	 */
	getApprovalRequest(id: string): ApprovalRequest | null {
		const stmt = this.db.db.prepare("SELECT * FROM approval_requests WHERE id = ?");
		const row = stmt.get(id) as
			| {
					id: string;
					channel_id: string;
					user_id: string;
					tool: string;
					args_json: string;
					reason: string;
					status: "pending" | "approved" | "rejected";
					created_at: string;
					resolved_at?: string;
					resolved_by?: string;
			  }
			| undefined;

		if (!row) return null;

		return {
			id: row.id,
			channelId: row.channel_id,
			userId: row.user_id,
			tool: row.tool,
			args: JSON.parse(row.args_json),
			reason: row.reason,
			status: row.status,
			createdAt: row.created_at,
			resolvedAt: row.resolved_at,
			resolvedBy: row.resolved_by,
		};
	}

	/**
	 * List pending approval requests
	 */
	getPendingApprovals(channelId?: string): ApprovalRequest[] {
		let query = "SELECT * FROM approval_requests WHERE status = 'pending'";
		const params: string[] = [];

		if (channelId) {
			query += " AND channel_id = ?";
			params.push(channelId);
		}

		query += " ORDER BY created_at DESC";

		const stmt = this.db.db.prepare(query);
		const rows = stmt.all(...params) as Array<{
			id: string;
			channel_id: string;
			user_id: string;
			tool: string;
			args_json: string;
			reason: string;
			status: "pending" | "approved" | "rejected";
			created_at: string;
			resolved_at?: string;
			resolved_by?: string;
		}>;

		return rows.map((row) => ({
			id: row.id,
			channelId: row.channel_id,
			userId: row.user_id,
			tool: row.tool,
			args: JSON.parse(row.args_json),
			reason: row.reason,
			status: row.status,
			createdAt: row.created_at,
			resolvedAt: row.resolved_at,
			resolvedBy: row.resolved_by,
		}));
	}

	/**
	 * Approve request
	 */
	approveRequest(id: string, resolvedBy: string): boolean {
		const stmt = this.db.db.prepare(`
			UPDATE approval_requests
			SET status = 'approved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
			WHERE id = ? AND status = 'pending'
		`);

		const result = stmt.run(resolvedBy, id);
		return result.changes > 0;
	}

	/**
	 * Reject request
	 */
	rejectRequest(id: string, resolvedBy: string): boolean {
		const stmt = this.db.db.prepare(`
			UPDATE approval_requests
			SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
			WHERE id = ? AND status = 'pending'
		`);

		const result = stmt.run(resolvedBy, id);
		return result.changes > 0;
	}

	/**
	 * Delete old approval requests
	 */
	pruneOldApprovals(olderThanDays: number = 30): number {
		const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
		const stmt = this.db.db.prepare(`
			DELETE FROM approval_requests
			WHERE created_at < ? AND status != 'pending'
		`);
		const result = stmt.run(cutoff);
		return result.changes;
	}
}

// =============================================================================
// Singleton
// =============================================================================

let storeInstance: PermissionStore | null = null;

export function initPermissionStore(db: BotDatabase): PermissionStore {
	if (!storeInstance) {
		storeInstance = new PermissionStore(db);
	}
	return storeInstance;
}

export function getPermissionStore(): PermissionStore {
	if (!storeInstance) {
		throw new Error("Permission store not initialized. Call initPermissionStore() first.");
	}
	return storeInstance;
}
