/**
 * Class 3.45: Configuration Manager
 * TAC Pattern: Dynamic configuration with validation and hot reload
 *
 * Provides configuration management for the orchestrator:
 * - Schema validation for configuration values
 * - Environment variable binding
 * - Secrets management with encryption
 * - Change notifications and subscriptions
 * - Rollback support with history
 * - Profiles/environments (dev, staging, prod)
 */

import Database from "better-sqlite3";
import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export type ConfigValueType = "string" | "number" | "boolean" | "json" | "secret";

export type ValidationOperator = "required" | "min" | "max" | "minLength" | "maxLength" | "pattern" | "enum" | "custom";

export interface ConfigSchema {
	key: string;
	type: ConfigValueType;
	description: string;
	defaultValue?: unknown;
	required: boolean;
	validation?: ValidationRule[];
	envBinding?: string;
	sensitive: boolean;
	category: string;
}

export interface ValidationRule {
	operator: ValidationOperator;
	value?: unknown;
	message: string;
	validator?: (value: unknown) => boolean;
}

export interface ConfigValue {
	key: string;
	value: unknown;
	type: ConfigValueType;
	source: "default" | "database" | "environment" | "override";
	profile: string;
	encrypted: boolean;
	updatedAt: number;
	updatedBy?: string;
}

export interface ConfigChange {
	id: string;
	key: string;
	oldValue: unknown;
	newValue: unknown;
	profile: string;
	changedBy: string;
	changedAt: number;
	reason?: string;
	rolledBack: boolean;
}

export interface ConfigProfile {
	name: string;
	description: string;
	parentProfile?: string;
	active: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface ConfigSnapshot {
	id: string;
	profile: string;
	values: Record<string, unknown>;
	createdAt: number;
	createdBy: string;
	description: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: Array<{ key: string; message: string; rule: string }>;
}

export interface ConfigManagerConfig {
	encryptionKey?: string;
	defaultProfile: string;
	enableHotReload: boolean;
	hotReloadIntervalMs: number;
	maxHistoryEntries: number;
	maxSnapshots: number;
}

export interface ConfigStats {
	totalKeys: number;
	totalProfiles: number;
	activeProfile: string;
	changesLast24h: number;
	secretsCount: number;
	envBoundCount: number;
	validationErrors: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ConfigManagerConfig = {
	defaultProfile: "default",
	enableHotReload: true,
	hotReloadIntervalMs: 30000,
	maxHistoryEntries: 1000,
	maxSnapshots: 50,
};

// ============================================================================
// Configuration Manager
// ============================================================================

export class ConfigurationManager extends EventEmitter {
	private db: Database.Database;
	private config: ConfigManagerConfig;
	private schemas: Map<string, ConfigSchema> = new Map();
	private cache: Map<string, ConfigValue> = new Map();
	private overrides: Map<string, unknown> = new Map();
	private activeProfile: string;
	private encryptionKey: Buffer | null = null;
	private hotReloadTimer?: NodeJS.Timeout;
	private subscribers: Map<string, Set<(value: unknown) => void>> = new Map();

	constructor(dataDir: string, config: Partial<ConfigManagerConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.activeProfile = this.config.defaultProfile;

		// Setup encryption if key provided
		if (this.config.encryptionKey) {
			this.encryptionKey = crypto.scryptSync(this.config.encryptionKey, "salt", 32);
		}

		const dbPath = path.join(dataDir, "config-manager.db");
		fs.mkdirSync(dataDir, { recursive: true });

		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.initSchema();

		// Ensure default profile exists
		this.ensureProfile(this.activeProfile);

		// Load initial cache
		this.refreshCache();

		// Start hot reload if enabled
		if (this.config.enableHotReload) {
			this.startHotReload();
		}
	}

	private initSchema(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        parent_profile TEXT,
        active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schemas (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        default_value TEXT,
        required INTEGER NOT NULL DEFAULT 0,
        validation TEXT NOT NULL DEFAULT '[]',
        env_binding TEXT,
        sensitive INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'general'
      );

      CREATE TABLE IF NOT EXISTS config_values (
        key TEXT NOT NULL,
        profile TEXT NOT NULL,
        value TEXT NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (key, profile),
        FOREIGN KEY (profile) REFERENCES profiles(name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS config_history (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        profile TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        changed_at INTEGER NOT NULL,
        reason TEXT,
        rolled_back INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        values TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_values_profile ON config_values(profile);
      CREATE INDEX IF NOT EXISTS idx_history_key ON config_history(key);
      CREATE INDEX IF NOT EXISTS idx_history_time ON config_history(changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_snapshots_profile ON snapshots(profile);
    `);
	}

	private ensureProfile(name: string): void {
		const now = Date.now();
		this.db
			.prepare(
				`
      INSERT OR IGNORE INTO profiles (name, description, active, created_at, updated_at)
      VALUES (?, '', 1, ?, ?)
    `,
			)
			.run(name, now, now);
	}

	// =========================================================================
	// Schema Management
	// =========================================================================

	/**
	 * Register a configuration schema
	 */
	registerSchema(schema: ConfigSchema): void {
		this.schemas.set(schema.key, schema);

		this.db
			.prepare(
				`
      INSERT INTO schemas (key, type, description, default_value, required, validation, env_binding, sensitive, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        type = excluded.type,
        description = excluded.description,
        default_value = excluded.default_value,
        required = excluded.required,
        validation = excluded.validation,
        env_binding = excluded.env_binding,
        sensitive = excluded.sensitive,
        category = excluded.category
    `,
			)
			.run(
				schema.key,
				schema.type,
				schema.description,
				schema.defaultValue !== undefined ? JSON.stringify(schema.defaultValue) : null,
				schema.required ? 1 : 0,
				JSON.stringify(schema.validation ?? []),
				schema.envBinding ?? null,
				schema.sensitive ? 1 : 0,
				schema.category,
			);

		this.emit("schema:registered", { key: schema.key });
	}

	/**
	 * Get schema for a key
	 */
	getSchema(key: string): ConfigSchema | null {
		// Check memory cache first
		if (this.schemas.has(key)) {
			return this.schemas.get(key)!;
		}

		// Load from database
		const row = this.db.prepare(`SELECT * FROM schemas WHERE key = ?`).get(key) as DbSchemaRow | undefined;

		if (!row) return null;

		const schema = this.rowToSchema(row);
		this.schemas.set(key, schema);
		return schema;
	}

	/**
	 * Get all schemas
	 */
	getAllSchemas(): ConfigSchema[] {
		const rows = this.db.prepare(`SELECT * FROM schemas ORDER BY category, key`).all() as DbSchemaRow[];

		return rows.map((row) => this.rowToSchema(row));
	}

	/**
	 * Get schemas by category
	 */
	getSchemasByCategory(category: string): ConfigSchema[] {
		const rows = this.db
			.prepare(`SELECT * FROM schemas WHERE category = ? ORDER BY key`)
			.all(category) as DbSchemaRow[];

		return rows.map((row) => this.rowToSchema(row));
	}

	// =========================================================================
	// Value Management
	// =========================================================================

	/**
	 * Get a configuration value
	 */
	get<T = unknown>(key: string, profile?: string): T | undefined {
		const targetProfile = profile ?? this.activeProfile;
		const cacheKey = `${targetProfile}:${key}`;

		// Check overrides first
		if (this.overrides.has(cacheKey)) {
			return this.overrides.get(cacheKey) as T;
		}

		// Check cache
		if (this.cache.has(cacheKey)) {
			return this.cache.get(cacheKey)!.value as T;
		}

		// Load from database
		const value = this.loadValue(key, targetProfile);
		if (value) {
			this.cache.set(cacheKey, value);
			return value.value as T;
		}

		// Check environment binding
		const schema = this.getSchema(key);
		if (schema?.envBinding) {
			const envValue = process.env[schema.envBinding];
			if (envValue !== undefined) {
				const parsed = this.parseValue(envValue, schema.type);
				this.cache.set(cacheKey, {
					key,
					value: parsed,
					type: schema.type,
					source: "environment",
					profile: targetProfile,
					encrypted: false,
					updatedAt: Date.now(),
				});
				return parsed as T;
			}
		}

		// Return default
		if (schema?.defaultValue !== undefined) {
			return schema.defaultValue as T;
		}

		return undefined;
	}

	/**
	 * Set a configuration value
	 */
	set(
		key: string,
		value: unknown,
		options: {
			profile?: string;
			changedBy?: string;
			reason?: string;
			skipValidation?: boolean;
		} = {},
	): ValidationResult {
		const targetProfile = options.profile ?? this.activeProfile;
		const schema = this.getSchema(key);

		// Validate if schema exists and validation not skipped
		if (schema && !options.skipValidation) {
			const validation = this.validateValue(key, value);
			if (!validation.valid) {
				return validation;
			}
		}

		const now = Date.now();
		const cacheKey = `${targetProfile}:${key}`;
		const oldValue = this.get(key, targetProfile);

		// Determine if encryption needed
		const shouldEncrypt = schema?.sensitive ?? false;
		const storedValue =
			shouldEncrypt && this.encryptionKey ? this.encrypt(JSON.stringify(value)) : JSON.stringify(value);

		// Save to database
		this.db
			.prepare(
				`
      INSERT INTO config_values (key, profile, value, encrypted, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key, profile) DO UPDATE SET
        value = excluded.value,
        encrypted = excluded.encrypted,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `,
			)
			.run(
				key,
				targetProfile,
				storedValue,
				shouldEncrypt && this.encryptionKey ? 1 : 0,
				now,
				options.changedBy ?? "system",
			);

		// Record history
		this.recordChange({
			key,
			oldValue,
			newValue: value,
			profile: targetProfile,
			changedBy: options.changedBy ?? "system",
			reason: options.reason,
		});

		// Update cache
		const configValue: ConfigValue = {
			key,
			value,
			type: schema?.type ?? "string",
			source: "database",
			profile: targetProfile,
			encrypted: shouldEncrypt && !!this.encryptionKey,
			updatedAt: now,
			updatedBy: options.changedBy,
		};
		this.cache.set(cacheKey, configValue);

		// Notify subscribers
		this.notifySubscribers(key, value);

		this.emit("config:changed", { key, oldValue, newValue: value, profile: targetProfile });

		return { valid: true, errors: [] };
	}

	/**
	 * Delete a configuration value
	 */
	delete(key: string, profile?: string): boolean {
		const targetProfile = profile ?? this.activeProfile;
		const cacheKey = `${targetProfile}:${key}`;

		const result = this.db.prepare(`DELETE FROM config_values WHERE key = ? AND profile = ?`).run(key, targetProfile);

		if (result.changes > 0) {
			this.cache.delete(cacheKey);
			this.emit("config:deleted", { key, profile: targetProfile });
		}

		return result.changes > 0;
	}

	/**
	 * Set a temporary override (not persisted)
	 */
	override(key: string, value: unknown, profile?: string): void {
		const targetProfile = profile ?? this.activeProfile;
		const cacheKey = `${targetProfile}:${key}`;
		this.overrides.set(cacheKey, value);
		this.notifySubscribers(key, value);
		this.emit("config:overridden", { key, value, profile: targetProfile });
	}

	/**
	 * Clear an override
	 */
	clearOverride(key: string, profile?: string): void {
		const targetProfile = profile ?? this.activeProfile;
		const cacheKey = `${targetProfile}:${key}`;
		this.overrides.delete(cacheKey);
		this.emit("config:override-cleared", { key, profile: targetProfile });
	}

	/**
	 * Clear all overrides
	 */
	clearAllOverrides(): void {
		this.overrides.clear();
		this.emit("config:overrides-cleared");
	}

	/**
	 * Get all values for a profile
	 */
	getAll(profile?: string): Record<string, unknown> {
		const targetProfile = profile ?? this.activeProfile;
		const values: Record<string, unknown> = {};

		// Load all from database
		const rows = this.db.prepare(`SELECT * FROM config_values WHERE profile = ?`).all(targetProfile) as DbValueRow[];

		for (const row of rows) {
			const _schema = this.getSchema(row.key);
			let value: unknown;

			if (row.encrypted && this.encryptionKey) {
				value = JSON.parse(this.decrypt(row.value));
			} else {
				value = JSON.parse(row.value);
			}

			values[row.key] = value;
		}

		// Add defaults for missing keys
		for (const schema of this.getAllSchemas()) {
			if (!(schema.key in values) && schema.defaultValue !== undefined) {
				values[schema.key] = schema.defaultValue;
			}
		}

		// Apply overrides
		for (const [cacheKey, value] of this.overrides) {
			const [oProfile, oKey] = cacheKey.split(":", 2);
			if (oProfile === targetProfile) {
				values[oKey] = value;
			}
		}

		return values;
	}

	// =========================================================================
	// Validation
	// =========================================================================

	/**
	 * Validate a single value against its schema
	 */
	validateValue(key: string, value: unknown): ValidationResult {
		const schema = this.getSchema(key);
		const errors: ValidationResult["errors"] = [];

		if (!schema) {
			return { valid: true, errors: [] };
		}

		// Check required
		if (schema.required && (value === undefined || value === null || value === "")) {
			errors.push({ key, message: `${key} is required`, rule: "required" });
		}

		// Type check
		if (!this.checkType(value, schema.type)) {
			errors.push({ key, message: `${key} must be of type ${schema.type}`, rule: "type" });
		}

		// Run validation rules
		if (schema.validation) {
			for (const rule of schema.validation) {
				if (!this.runValidationRule(value, rule)) {
					errors.push({ key, message: rule.message, rule: rule.operator });
				}
			}
		}

		return { valid: errors.length === 0, errors };
	}

	/**
	 * Validate all configuration values
	 */
	validateAll(profile?: string): ValidationResult {
		const targetProfile = profile ?? this.activeProfile;
		const values = this.getAll(targetProfile);
		const allErrors: ValidationResult["errors"] = [];

		for (const schema of this.getAllSchemas()) {
			const validation = this.validateValue(schema.key, values[schema.key]);
			allErrors.push(...validation.errors);
		}

		return { valid: allErrors.length === 0, errors: allErrors };
	}

	private checkType(value: unknown, type: ConfigValueType): boolean {
		if (value === undefined || value === null) return true;

		switch (type) {
			case "string":
				return typeof value === "string";
			case "number":
				return typeof value === "number" && !Number.isNaN(value);
			case "boolean":
				return typeof value === "boolean";
			case "json":
				return typeof value === "object";
			case "secret":
				return typeof value === "string";
			default:
				return true;
		}
	}

	private runValidationRule(value: unknown, rule: ValidationRule): boolean {
		if (value === undefined || value === null) return true;

		switch (rule.operator) {
			case "required":
				return value !== undefined && value !== null && value !== "";
			case "min":
				return typeof value === "number" && value >= (rule.value as number);
			case "max":
				return typeof value === "number" && value <= (rule.value as number);
			case "minLength":
				return typeof value === "string" && value.length >= (rule.value as number);
			case "maxLength":
				return typeof value === "string" && value.length <= (rule.value as number);
			case "pattern":
				return typeof value === "string" && new RegExp(rule.value as string).test(value);
			case "enum":
				return (rule.value as unknown[]).includes(value);
			case "custom":
				return rule.validator ? rule.validator(value) : true;
			default:
				return true;
		}
	}

	// =========================================================================
	// Profile Management
	// =========================================================================

	/**
	 * Create a new profile
	 */
	createProfile(params: {
		name: string;
		description?: string;
		parentProfile?: string;
		copyFrom?: string;
	}): ConfigProfile {
		const now = Date.now();

		this.db
			.prepare(
				`
      INSERT INTO profiles (name, description, parent_profile, active, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `,
			)
			.run(params.name, params.description ?? "", params.parentProfile ?? null, now, now);

		// Copy values from another profile if specified
		if (params.copyFrom) {
			const sourceValues = this.getAll(params.copyFrom);
			for (const [key, value] of Object.entries(sourceValues)) {
				this.set(key, value, { profile: params.name, changedBy: "system" });
			}
		}

		this.emit("profile:created", { name: params.name });

		return {
			name: params.name,
			description: params.description ?? "",
			parentProfile: params.parentProfile,
			active: false,
			createdAt: now,
			updatedAt: now,
		};
	}

	/**
	 * Delete a profile
	 */
	deleteProfile(name: string): boolean {
		if (name === this.config.defaultProfile) {
			throw new Error("Cannot delete the default profile");
		}

		if (name === this.activeProfile) {
			throw new Error("Cannot delete the active profile");
		}

		const result = this.db.prepare(`DELETE FROM profiles WHERE name = ?`).run(name);

		if (result.changes > 0) {
			// Clear cache for this profile
			for (const key of this.cache.keys()) {
				if (key.startsWith(`${name}:`)) {
					this.cache.delete(key);
				}
			}
			this.emit("profile:deleted", { name });
		}

		return result.changes > 0;
	}

	/**
	 * Switch active profile
	 */
	switchProfile(name: string): void {
		const profile = this.getProfile(name);
		if (!profile) {
			throw new Error(`Profile '${name}' does not exist`);
		}

		const oldProfile = this.activeProfile;
		this.activeProfile = name;

		// Update active flags
		this.db.prepare(`UPDATE profiles SET active = 0`).run();
		this.db.prepare(`UPDATE profiles SET active = 1 WHERE name = ?`).run(name);

		// Refresh cache
		this.refreshCache();

		this.emit("profile:switched", { oldProfile, newProfile: name });
	}

	/**
	 * Get a profile
	 */
	getProfile(name: string): ConfigProfile | null {
		const row = this.db.prepare(`SELECT * FROM profiles WHERE name = ?`).get(name) as DbProfileRow | undefined;

		if (!row) return null;

		return this.rowToProfile(row);
	}

	/**
	 * List all profiles
	 */
	listProfiles(): ConfigProfile[] {
		const rows = this.db.prepare(`SELECT * FROM profiles ORDER BY name`).all() as DbProfileRow[];

		return rows.map((row) => this.rowToProfile(row));
	}

	/**
	 * Get active profile name
	 */
	getActiveProfile(): string {
		return this.activeProfile;
	}

	// =========================================================================
	// History & Rollback
	// =========================================================================

	/**
	 * Get change history for a key
	 */
	getHistory(key: string, limit = 50): ConfigChange[] {
		const rows = this.db
			.prepare(
				`
      SELECT * FROM config_history
      WHERE key = ?
      ORDER BY changed_at DESC
      LIMIT ?
    `,
			)
			.all(key, limit) as DbHistoryRow[];

		return rows.map((row) => this.rowToChange(row));
	}

	/**
	 * Rollback to a previous value
	 */
	rollback(changeId: string, changedBy: string): boolean {
		const row = this.db.prepare(`SELECT * FROM config_history WHERE id = ?`).get(changeId) as
			| DbHistoryRow
			| undefined;

		if (!row) return false;

		const change = this.rowToChange(row);

		// Set the old value
		this.set(change.key, change.oldValue, {
			profile: change.profile,
			changedBy,
			reason: `Rollback from change ${changeId}`,
		});

		// Mark change as rolled back
		this.db.prepare(`UPDATE config_history SET rolled_back = 1 WHERE id = ?`).run(changeId);

		this.emit("config:rolledback", { changeId, key: change.key });

		return true;
	}

	private recordChange(params: {
		key: string;
		oldValue: unknown;
		newValue: unknown;
		profile: string;
		changedBy: string;
		reason?: string;
	}): void {
		const id = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

		this.db
			.prepare(
				`
      INSERT INTO config_history (id, key, old_value, new_value, profile, changed_by, changed_at, reason, rolled_back)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `,
			)
			.run(
				id,
				params.key,
				params.oldValue !== undefined ? JSON.stringify(params.oldValue) : null,
				JSON.stringify(params.newValue),
				params.profile,
				params.changedBy,
				Date.now(),
				params.reason ?? null,
			);

		// Cleanup old history
		this.db
			.prepare(
				`
      DELETE FROM config_history
      WHERE id NOT IN (
        SELECT id FROM config_history
        ORDER BY changed_at DESC
        LIMIT ?
      )
    `,
			)
			.run(this.config.maxHistoryEntries);
	}

	// =========================================================================
	// Snapshots
	// =========================================================================

	/**
	 * Create a snapshot of current configuration
	 */
	createSnapshot(params: { profile?: string; createdBy: string; description?: string }): ConfigSnapshot {
		const targetProfile = params.profile ?? this.activeProfile;
		const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const values = this.getAll(targetProfile);
		const now = Date.now();

		const snapshot: ConfigSnapshot = {
			id,
			profile: targetProfile,
			values,
			createdAt: now,
			createdBy: params.createdBy,
			description: params.description ?? "",
		};

		this.db
			.prepare(
				`
      INSERT INTO snapshots (id, profile, values, created_at, created_by, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				snapshot.id,
				snapshot.profile,
				JSON.stringify(snapshot.values),
				snapshot.createdAt,
				snapshot.createdBy,
				snapshot.description,
			);

		// Cleanup old snapshots
		this.db
			.prepare(
				`
      DELETE FROM snapshots
      WHERE profile = ? AND id NOT IN (
        SELECT id FROM snapshots
        WHERE profile = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
    `,
			)
			.run(targetProfile, targetProfile, this.config.maxSnapshots);

		this.emit("snapshot:created", { snapshotId: id, profile: targetProfile });

		return snapshot;
	}

	/**
	 * Restore from a snapshot
	 */
	restoreSnapshot(snapshotId: string, changedBy: string): boolean {
		const row = this.db.prepare(`SELECT * FROM snapshots WHERE id = ?`).get(snapshotId) as DbSnapshotRow | undefined;

		if (!row) return false;

		const values = JSON.parse(row.values) as Record<string, unknown>;

		for (const [key, value] of Object.entries(values)) {
			this.set(key, value, {
				profile: row.profile,
				changedBy,
				reason: `Restored from snapshot ${snapshotId}`,
			});
		}

		this.emit("snapshot:restored", { snapshotId, profile: row.profile });

		return true;
	}

	/**
	 * List snapshots for a profile
	 */
	listSnapshots(profile?: string): ConfigSnapshot[] {
		const targetProfile = profile ?? this.activeProfile;

		const rows = this.db
			.prepare(
				`
      SELECT * FROM snapshots
      WHERE profile = ?
      ORDER BY created_at DESC
    `,
			)
			.all(targetProfile) as DbSnapshotRow[];

		return rows.map((row) => ({
			id: row.id,
			profile: row.profile,
			values: JSON.parse(row.values),
			createdAt: row.created_at,
			createdBy: row.created_by,
			description: row.description,
		}));
	}

	// =========================================================================
	// Subscriptions
	// =========================================================================

	/**
	 * Subscribe to changes for a key
	 */
	subscribe(key: string, callback: (value: unknown) => void): () => void {
		if (!this.subscribers.has(key)) {
			this.subscribers.set(key, new Set());
		}
		this.subscribers.get(key)!.add(callback);

		// Return unsubscribe function
		return () => {
			this.subscribers.get(key)?.delete(callback);
		};
	}

	/**
	 * Subscribe to all changes
	 */
	subscribeAll(callback: (key: string, value: unknown) => void): () => void {
		const wrappedCallback = (value: unknown, key?: string) => {
			if (key) callback(key, value);
		};

		// Subscribe to wildcard
		if (!this.subscribers.has("*")) {
			this.subscribers.set("*", new Set());
		}
		this.subscribers.get("*")!.add(wrappedCallback as (value: unknown) => void);

		return () => {
			this.subscribers.get("*")?.delete(wrappedCallback as (value: unknown) => void);
		};
	}

	private notifySubscribers(key: string, value: unknown): void {
		// Notify specific key subscribers
		const keySubscribers = this.subscribers.get(key);
		if (keySubscribers) {
			for (const callback of keySubscribers) {
				try {
					callback(value);
				} catch (error) {
					this.emit("subscriber:error", { key, error });
				}
			}
		}

		// Notify wildcard subscribers
		const wildcardSubscribers = this.subscribers.get("*");
		if (wildcardSubscribers) {
			for (const callback of wildcardSubscribers) {
				try {
					(callback as (value: unknown, key: string) => void)(value, key);
				} catch (error) {
					this.emit("subscriber:error", { key, error });
				}
			}
		}
	}

	// =========================================================================
	// Hot Reload
	// =========================================================================

	private startHotReload(): void {
		this.hotReloadTimer = setInterval(() => {
			this.refreshCache();
		}, this.config.hotReloadIntervalMs);
	}

	private stopHotReload(): void {
		if (this.hotReloadTimer) {
			clearInterval(this.hotReloadTimer);
			this.hotReloadTimer = undefined;
		}
	}

	private refreshCache(): void {
		const rows = this.db
			.prepare(`SELECT * FROM config_values WHERE profile = ?`)
			.all(this.activeProfile) as DbValueRow[];

		for (const row of rows) {
			const cacheKey = `${row.profile}:${row.key}`;
			const schema = this.getSchema(row.key);

			let value: unknown;
			if (row.encrypted && this.encryptionKey) {
				value = JSON.parse(this.decrypt(row.value));
			} else {
				value = JSON.parse(row.value);
			}

			const oldCached = this.cache.get(cacheKey);
			const newConfig: ConfigValue = {
				key: row.key,
				value,
				type: schema?.type ?? "string",
				source: "database",
				profile: row.profile,
				encrypted: row.encrypted === 1,
				updatedAt: row.updated_at,
				updatedBy: row.updated_by ?? undefined,
			};

			// Detect changes and notify
			if (oldCached && JSON.stringify(oldCached.value) !== JSON.stringify(value)) {
				this.notifySubscribers(row.key, value);
				this.emit("config:hot-reloaded", { key: row.key, value });
			}

			this.cache.set(cacheKey, newConfig);
		}
	}

	// =========================================================================
	// Encryption
	// =========================================================================

	private encrypt(text: string): string {
		if (!this.encryptionKey) throw new Error("Encryption key not configured");

		const iv = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
		let encrypted = cipher.update(text, "utf8", "hex");
		encrypted += cipher.final("hex");
		const authTag = cipher.getAuthTag();

		return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
	}

	private decrypt(encryptedText: string): string {
		if (!this.encryptionKey) throw new Error("Encryption key not configured");

		const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
		const iv = Buffer.from(ivHex, "hex");
		const authTag = Buffer.from(authTagHex, "hex");

		const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
		decipher.setAuthTag(authTag);

		let decrypted = decipher.update(encrypted, "hex", "utf8");
		decrypted += decipher.final("utf8");

		return decrypted;
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	private loadValue(key: string, profile: string): ConfigValue | null {
		const row = this.db.prepare(`SELECT * FROM config_values WHERE key = ? AND profile = ?`).get(key, profile) as
			| DbValueRow
			| undefined;

		if (!row) return null;

		const schema = this.getSchema(key);
		let value: unknown;

		if (row.encrypted && this.encryptionKey) {
			value = JSON.parse(this.decrypt(row.value));
		} else {
			value = JSON.parse(row.value);
		}

		return {
			key: row.key,
			value,
			type: schema?.type ?? "string",
			source: "database",
			profile: row.profile,
			encrypted: row.encrypted === 1,
			updatedAt: row.updated_at,
			updatedBy: row.updated_by ?? undefined,
		};
	}

	private parseValue(value: string, type: ConfigValueType): unknown {
		switch (type) {
			case "number":
				return parseFloat(value);
			case "boolean":
				return value.toLowerCase() === "true" || value === "1";
			case "json":
				return JSON.parse(value);
			default:
				return value;
		}
	}

	private rowToSchema(row: DbSchemaRow): ConfigSchema {
		return {
			key: row.key,
			type: row.type as ConfigValueType,
			description: row.description,
			defaultValue: row.default_value ? JSON.parse(row.default_value) : undefined,
			required: row.required === 1,
			validation: JSON.parse(row.validation),
			envBinding: row.env_binding ?? undefined,
			sensitive: row.sensitive === 1,
			category: row.category,
		};
	}

	private rowToProfile(row: DbProfileRow): ConfigProfile {
		return {
			name: row.name,
			description: row.description,
			parentProfile: row.parent_profile ?? undefined,
			active: row.active === 1,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private rowToChange(row: DbHistoryRow): ConfigChange {
		return {
			id: row.id,
			key: row.key,
			oldValue: row.old_value ? JSON.parse(row.old_value) : undefined,
			newValue: JSON.parse(row.new_value),
			profile: row.profile,
			changedBy: row.changed_by,
			changedAt: row.changed_at,
			reason: row.reason ?? undefined,
			rolledBack: row.rolled_back === 1,
		};
	}

	// =========================================================================
	// Statistics
	// =========================================================================

	/**
	 * Get configuration statistics
	 */
	getStats(): ConfigStats {
		const keyCount = this.db.prepare(`SELECT COUNT(DISTINCT key) as cnt FROM config_values`).get() as { cnt: number };

		const profileCount = this.db.prepare(`SELECT COUNT(*) as cnt FROM profiles`).get() as { cnt: number };

		const changesLast24h = this.db
			.prepare(`SELECT COUNT(*) as cnt FROM config_history WHERE changed_at > ?`)
			.get(Date.now() - 24 * 60 * 60 * 1000) as { cnt: number };

		const secretsCount = this.db.prepare(`SELECT COUNT(*) as cnt FROM schemas WHERE sensitive = 1`).get() as {
			cnt: number;
		};

		const envBoundCount = this.db
			.prepare(`SELECT COUNT(*) as cnt FROM schemas WHERE env_binding IS NOT NULL`)
			.get() as { cnt: number };

		const validation = this.validateAll();

		return {
			totalKeys: keyCount.cnt,
			totalProfiles: profileCount.cnt,
			activeProfile: this.activeProfile,
			changesLast24h: changesLast24h.cnt,
			secretsCount: secretsCount.cnt,
			envBoundCount: envBoundCount.cnt,
			validationErrors: validation.errors.length,
		};
	}

	/**
	 * Export configuration for a profile
	 */
	export(profile?: string, includeSecrets = false): Record<string, unknown> {
		const targetProfile = profile ?? this.activeProfile;
		const values = this.getAll(targetProfile);

		if (!includeSecrets) {
			for (const schema of this.getAllSchemas()) {
				if (schema.sensitive && schema.key in values) {
					values[schema.key] = "[REDACTED]";
				}
			}
		}

		return values;
	}

	/**
	 * Import configuration
	 */
	import(
		values: Record<string, unknown>,
		options: {
			profile?: string;
			changedBy: string;
			merge?: boolean;
		},
	): ValidationResult {
		const targetProfile = options.profile ?? this.activeProfile;
		const errors: ValidationResult["errors"] = [];

		// Clear existing values if not merging
		if (!options.merge) {
			this.db.prepare(`DELETE FROM config_values WHERE profile = ?`).run(targetProfile);
		}

		// Import each value
		for (const [key, value] of Object.entries(values)) {
			const result = this.set(key, value, {
				profile: targetProfile,
				changedBy: options.changedBy,
				reason: "Imported",
			});

			errors.push(...result.errors);
		}

		this.refreshCache();
		this.emit("config:imported", { profile: targetProfile });

		return { valid: errors.length === 0, errors };
	}

	/**
	 * Close the configuration manager
	 */
	close(): void {
		this.stopHotReload();
		this.db.close();
		this.subscribers.clear();
		this.cache.clear();
		this.overrides.clear();
		this.emit("system:closed");
	}
}

// ============================================================================
// Internal Types
// ============================================================================

interface DbSchemaRow {
	key: string;
	type: string;
	description: string;
	default_value: string | null;
	required: number;
	validation: string;
	env_binding: string | null;
	sensitive: number;
	category: string;
}

interface DbValueRow {
	key: string;
	profile: string;
	value: string;
	encrypted: number;
	updated_at: number;
	updated_by: string | null;
}

interface DbProfileRow {
	name: string;
	description: string;
	parent_profile: string | null;
	active: number;
	created_at: number;
	updated_at: number;
}

interface DbHistoryRow {
	id: string;
	key: string;
	old_value: string | null;
	new_value: string;
	profile: string;
	changed_by: string;
	changed_at: number;
	reason: string | null;
	rolled_back: number;
}

interface DbSnapshotRow {
	id: string;
	profile: string;
	values: string;
	created_at: number;
	created_by: string;
	description: string;
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: ConfigurationManager | null = null;

export function getConfigManager(dataDir: string, config?: Partial<ConfigManagerConfig>): ConfigurationManager {
	if (!instance) {
		instance = new ConfigurationManager(dataDir, config);
	}
	return instance;
}

export function resetConfigManager(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
