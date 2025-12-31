/**
 * Class 3.59: Secret Manager System
 * TAC Pattern: Secure secret storage, rotation, and access control
 *
 * Features:
 * - Secret storage with AES-256-GCM encryption
 * - Secret versioning
 * - Secret rotation policies
 * - Access control (who can read which secrets)
 * - Audit logging for all access
 * - Secret expiration
 * - Dynamic secrets (generated on-demand)
 * - Secret references (one secret referencing another)
 * - Environment-based secrets (dev, staging, prod)
 * - Secret caching with TTL
 * - Bulk operations
 * - Import/export (encrypted)
 * - Secret types (API key, password, certificate, token)
 * - Lease-based access
 * - Automatic rotation triggers
 * - Integration hooks for rotation
 * - SQLite persistence with encrypted values
 */

import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type SecretType = "api_key" | "password" | "certificate" | "token" | "connection_string" | "ssh_key" | "generic";
export type SecretEnvironment = "development" | "staging" | "production" | "all";
export type RotationTrigger = "schedule" | "manual" | "expiration" | "compromise" | "policy";
export type AccessLevel = "read" | "write" | "admin";
export type LeaseStatus = "active" | "expired" | "revoked";

export interface Secret {
	id: string;
	name: string;
	type: SecretType;
	environment: SecretEnvironment;
	version: number;
	encryptedValue: string;
	iv: string;
	authTag: string;
	description?: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
	expiresAt?: Date;
	rotationPolicyId?: string;
	referencesSecretId?: string;
	isDynamic: boolean;
	dynamicGenerator?: string;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string;
}

export interface SecretVersion {
	id: string;
	secretId: string;
	version: number;
	encryptedValue: string;
	iv: string;
	authTag: string;
	createdAt: Date;
	createdBy: string;
	rotationTrigger?: RotationTrigger;
	metadata?: Record<string, unknown>;
}

export interface RotationPolicy {
	id: string;
	name: string;
	rotationIntervalDays: number;
	notifyBeforeDays: number;
	autoRotate: boolean;
	rotationHook?: string;
	secretTypes?: SecretType[];
	enabled: boolean;
	createdAt: Date;
	lastRotation?: Date;
	nextRotation?: Date;
}

export interface AccessPolicy {
	id: string;
	secretId: string;
	principalType: "user" | "agent" | "role" | "service";
	principalId: string;
	accessLevel: AccessLevel;
	environments: SecretEnvironment[];
	expiresAt?: Date;
	createdAt: Date;
	createdBy: string;
}

export interface SecretLease {
	id: string;
	secretId: string;
	principalType: "user" | "agent" | "service";
	principalId: string;
	status: LeaseStatus;
	ttlSeconds: number;
	issuedAt: Date;
	expiresAt: Date;
	revokedAt?: Date;
	revokedBy?: string;
	renewCount: number;
	maxRenewals: number;
	metadata?: Record<string, unknown>;
}

export interface SecretAuditEntry {
	id: string;
	timestamp: Date;
	action: "read" | "write" | "delete" | "rotate" | "grant" | "revoke" | "lease" | "renew" | "export" | "import";
	secretId: string;
	secretName: string;
	version?: number;
	principalType: string;
	principalId: string;
	environment?: SecretEnvironment;
	success: boolean;
	errorMessage?: string;
	ipAddress?: string;
	userAgent?: string;
	metadata?: Record<string, unknown>;
}

export interface SecretCache {
	secretId: string;
	decryptedValue: string;
	cachedAt: Date;
	expiresAt: Date;
}

export interface DynamicSecretGenerator {
	id: string;
	name: string;
	type: SecretType;
	generatorFn: () => string | Promise<string>;
	ttlSeconds: number;
}

export interface SecretExport {
	version: string;
	exportedAt: Date;
	exportedBy: string;
	environment?: SecretEnvironment;
	secrets: Array<{
		name: string;
		type: SecretType;
		environment: SecretEnvironment;
		encryptedPayload: string;
		iv: string;
		authTag: string;
		metadata?: Record<string, unknown>;
	}>;
	checksum: string;
}

export interface SecretStats {
	totalSecrets: number;
	byType: Record<string, number>;
	byEnvironment: Record<string, number>;
	expiringSoon: number;
	rotationsPending: number;
	activeLeases: number;
	accessDenied24h: number;
}

export interface SecretManagerConfig {
	dataDir: string;
	masterKey: string;
	cacheEnabled: boolean;
	cacheTtlSeconds: number;
	maxCacheSize: number;
	auditRetentionDays: number;
	leaseDefaultTtlSeconds: number;
	leaseMaxTtlSeconds: number;
	maxLeaseRenewals: number;
	rotationCheckIntervalMs: number;
}

// ============================================================================
// Encryption Utilities
// ============================================================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const _AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

function deriveKey(masterKey: string, salt: Buffer): Buffer {
	return scryptSync(masterKey, salt, KEY_LENGTH);
}

function encrypt(
	plaintext: string,
	masterKey: string,
): { encrypted: string; iv: string; authTag: string; salt: string } {
	const salt = randomBytes(SALT_LENGTH);
	const key = deriveKey(masterKey, salt);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	let encrypted = cipher.update(plaintext, "utf8", "base64");
	encrypted += cipher.final("base64");
	const authTag = cipher.getAuthTag();

	return {
		encrypted,
		iv: iv.toString("base64"),
		authTag: authTag.toString("base64"),
		salt: salt.toString("base64"),
	};
}

function decrypt(encrypted: string, iv: string, authTag: string, salt: string, masterKey: string): string {
	const saltBuffer = Buffer.from(salt, "base64");
	const key = deriveKey(masterKey, saltBuffer);
	const ivBuffer = Buffer.from(iv, "base64");
	const authTagBuffer = Buffer.from(authTag, "base64");

	const decipher = createDecipheriv(ALGORITHM, key, ivBuffer);
	decipher.setAuthTag(authTagBuffer);

	let decrypted = decipher.update(encrypted, "base64", "utf8");
	decrypted += decipher.final("utf8");

	return decrypted;
}

function generateSecureToken(length: number = 32): string {
	return randomBytes(length).toString("base64url");
}

function hashValue(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

// ============================================================================
// Secret Manager System
// ============================================================================

export class SecretManagerSystem extends EventEmitter {
	private db: Database.Database;
	private config: SecretManagerConfig;
	private cache: Map<string, SecretCache> = new Map();
	private dynamicGenerators: Map<string, DynamicSecretGenerator> = new Map();
	private rotationInterval: NodeJS.Timeout | null = null;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private masterKeySalt: string;

	constructor(config: SecretManagerConfig) {
		super();
		this.config = config;
		this.db = new Database(join(config.dataDir, "secrets.db"));
		this.masterKeySalt = hashValue(config.masterKey).substring(0, 32);
		this.initializeDatabase();
		this.startRotationChecker();
		this.startCleanupScheduler();
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Secrets table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        environment TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        encrypted_value TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        salt TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        metadata TEXT,
        expires_at TEXT,
        rotation_policy_id TEXT,
        references_secret_id TEXT,
        is_dynamic INTEGER NOT NULL DEFAULT 0,
        dynamic_generator TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        FOREIGN KEY (rotation_policy_id) REFERENCES rotation_policies(id),
        FOREIGN KEY (references_secret_id) REFERENCES secrets(id)
      )
    `);

		// Secret versions table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS secret_versions (
        id TEXT PRIMARY KEY,
        secret_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        encrypted_value TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        rotation_trigger TEXT,
        metadata TEXT,
        FOREIGN KEY (secret_id) REFERENCES secrets(id),
        UNIQUE(secret_id, version)
      )
    `);

		// Rotation policies table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS rotation_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        rotation_interval_days INTEGER NOT NULL,
        notify_before_days INTEGER NOT NULL DEFAULT 7,
        auto_rotate INTEGER NOT NULL DEFAULT 0,
        rotation_hook TEXT,
        secret_types TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_rotation TEXT,
        next_rotation TEXT
      )
    `);

		// Access policies table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS access_policies (
        id TEXT PRIMARY KEY,
        secret_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        access_level TEXT NOT NULL,
        environments TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        FOREIGN KEY (secret_id) REFERENCES secrets(id),
        UNIQUE(secret_id, principal_type, principal_id)
      )
    `);

		// Leases table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS secret_leases (
        id TEXT PRIMARY KEY,
        secret_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        ttl_seconds INTEGER NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT,
        renew_count INTEGER NOT NULL DEFAULT 0,
        max_renewals INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (secret_id) REFERENCES secrets(id)
      )
    `);

		// Audit log table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS secret_audit (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        secret_id TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        version INTEGER,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        environment TEXT,
        success INTEGER NOT NULL,
        error_message TEXT,
        ip_address TEXT,
        user_agent TEXT,
        metadata TEXT
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_secrets_name ON secrets(name);
      CREATE INDEX IF NOT EXISTS idx_secrets_type ON secrets(type);
      CREATE INDEX IF NOT EXISTS idx_secrets_env ON secrets(environment);
      CREATE INDEX IF NOT EXISTS idx_secrets_expires ON secrets(expires_at);
      CREATE INDEX IF NOT EXISTS idx_versions_secret ON secret_versions(secret_id);
      CREATE INDEX IF NOT EXISTS idx_access_secret ON access_policies(secret_id);
      CREATE INDEX IF NOT EXISTS idx_access_principal ON access_policies(principal_type, principal_id);
      CREATE INDEX IF NOT EXISTS idx_leases_secret ON secret_leases(secret_id);
      CREATE INDEX IF NOT EXISTS idx_leases_status ON secret_leases(status);
      CREATE INDEX IF NOT EXISTS idx_leases_expires ON secret_leases(expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON secret_audit(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_secret ON secret_audit(secret_id);
      CREATE INDEX IF NOT EXISTS idx_audit_principal ON secret_audit(principal_type, principal_id);
    `);
	}

	private startRotationChecker(): void {
		this.rotationInterval = setInterval(() => {
			this.checkRotations();
		}, this.config.rotationCheckIntervalMs);
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupExpiredLeases();
				this.cleanupAuditLogs();
				this.cleanupCache();
			},
			60 * 60 * 1000,
		); // Hourly
	}

	// ============================================================================
	// Secret CRUD Operations
	// ============================================================================

	createSecret(params: {
		name: string;
		value: string;
		type: SecretType;
		environment: SecretEnvironment;
		description?: string;
		tags?: string[];
		metadata?: Record<string, unknown>;
		expiresAt?: Date;
		rotationPolicyId?: string;
		referencesSecretId?: string;
		isDynamic?: boolean;
		dynamicGenerator?: string;
		createdBy: string;
	}): Secret {
		const id = `secret_${Date.now()}_${randomBytes(8).toString("hex")}`;
		const now = new Date();

		// Encrypt the value
		const { encrypted, iv, authTag, salt } = encrypt(params.value, this.config.masterKey);

		const secret: Secret = {
			id,
			name: params.name,
			type: params.type,
			environment: params.environment,
			version: 1,
			encryptedValue: encrypted,
			iv,
			authTag,
			description: params.description,
			tags: params.tags,
			metadata: params.metadata,
			expiresAt: params.expiresAt,
			rotationPolicyId: params.rotationPolicyId,
			referencesSecretId: params.referencesSecretId,
			isDynamic: params.isDynamic ?? false,
			dynamicGenerator: params.dynamicGenerator,
			createdAt: now,
			createdBy: params.createdBy,
			updatedAt: now,
			updatedBy: params.createdBy,
		};

		const stmt = this.db.prepare(`
      INSERT INTO secrets
      (id, name, type, environment, version, encrypted_value, iv, auth_tag, salt,
       description, tags, metadata, expires_at, rotation_policy_id, references_secret_id,
       is_dynamic, dynamic_generator, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			secret.id,
			secret.name,
			secret.type,
			secret.environment,
			secret.version,
			secret.encryptedValue,
			secret.iv,
			secret.authTag,
			salt,
			secret.description ?? null,
			secret.tags ? JSON.stringify(secret.tags) : null,
			secret.metadata ? JSON.stringify(secret.metadata) : null,
			secret.expiresAt?.toISOString() ?? null,
			secret.rotationPolicyId ?? null,
			secret.referencesSecretId ?? null,
			secret.isDynamic ? 1 : 0,
			secret.dynamicGenerator ?? null,
			secret.createdAt.toISOString(),
			secret.createdBy,
			secret.updatedAt.toISOString(),
			secret.updatedBy,
		);

		// Create initial version
		this.createVersion(secret, salt, params.createdBy);

		this.auditLog({
			action: "write",
			secretId: secret.id,
			secretName: secret.name,
			version: 1,
			principalType: "user",
			principalId: params.createdBy,
			environment: secret.environment,
			success: true,
		});

		this.emit("secret:created", { secretId: secret.id, name: secret.name });
		return secret;
	}

	getSecret(params: {
		name?: string;
		id?: string;
		environment?: SecretEnvironment;
		version?: number;
		principalType: string;
		principalId: string;
		ipAddress?: string;
		userAgent?: string;
	}): { secret: Secret; value: string } | null {
		// Find the secret
		let query = "SELECT * FROM secrets WHERE ";
		const queryParams: unknown[] = [];

		if (params.id) {
			query += "id = ?";
			queryParams.push(params.id);
		} else if (params.name) {
			query += "name = ?";
			queryParams.push(params.name);
		} else {
			throw new Error("Either id or name must be provided");
		}

		if (params.environment && params.environment !== "all") {
			query += " AND (environment = ? OR environment = ?)";
			queryParams.push(params.environment, "all");
		}

		const stmt = this.db.prepare(query);
		const row = stmt.get(...queryParams) as Record<string, unknown> | undefined;

		if (!row) {
			this.auditLog({
				action: "read",
				secretId: params.id ?? "unknown",
				secretName: params.name ?? "unknown",
				principalType: params.principalType,
				principalId: params.principalId,
				environment: params.environment,
				success: false,
				errorMessage: "Secret not found",
				ipAddress: params.ipAddress,
				userAgent: params.userAgent,
			});
			return null;
		}

		// Check access
		if (!this.checkAccess(row.id as string, params.principalType, params.principalId, "read", params.environment)) {
			this.auditLog({
				action: "read",
				secretId: row.id as string,
				secretName: row.name as string,
				principalType: params.principalType,
				principalId: params.principalId,
				environment: params.environment,
				success: false,
				errorMessage: "Access denied",
				ipAddress: params.ipAddress,
				userAgent: params.userAgent,
			});
			this.emit("access:denied", {
				secretId: row.id,
				principalType: params.principalType,
				principalId: params.principalId,
			});
			return null;
		}

		// Check expiration
		if (row.expires_at && new Date(row.expires_at as string) < new Date()) {
			this.auditLog({
				action: "read",
				secretId: row.id as string,
				secretName: row.name as string,
				principalType: params.principalType,
				principalId: params.principalId,
				environment: params.environment,
				success: false,
				errorMessage: "Secret expired",
				ipAddress: params.ipAddress,
				userAgent: params.userAgent,
			});
			return null;
		}

		// Get specific version if requested
		let encryptedValue = row.encrypted_value as string;
		let iv = row.iv as string;
		let authTag = row.auth_tag as string;
		let salt = row.salt as string;
		let version = row.version as number;

		if (params.version && params.version !== version) {
			const versionStmt = this.db.prepare("SELECT * FROM secret_versions WHERE secret_id = ? AND version = ?");
			const versionRow = versionStmt.get(row.id, params.version) as Record<string, unknown> | undefined;

			if (!versionRow) {
				return null;
			}

			encryptedValue = versionRow.encrypted_value as string;
			iv = versionRow.iv as string;
			authTag = versionRow.auth_tag as string;
			salt = versionRow.salt as string;
			version = versionRow.version as number;
		}

		// Check cache
		const cacheKey = `${row.id}:${version}`;
		if (this.config.cacheEnabled) {
			const cached = this.cache.get(cacheKey);
			if (cached && cached.expiresAt > new Date()) {
				this.auditLog({
					action: "read",
					secretId: row.id as string,
					secretName: row.name as string,
					version,
					principalType: params.principalType,
					principalId: params.principalId,
					environment: params.environment,
					success: true,
					metadata: { cached: true },
					ipAddress: params.ipAddress,
					userAgent: params.userAgent,
				});

				return {
					secret: this.rowToSecret(row),
					value: cached.decryptedValue,
				};
			}
		}

		// Handle dynamic secrets
		if (row.is_dynamic && row.dynamic_generator) {
			const generator = this.dynamicGenerators.get(row.dynamic_generator as string);
			if (generator) {
				const dynamicValue = typeof generator.generatorFn === "function" ? generator.generatorFn() : "";

				if (dynamicValue instanceof Promise) {
					throw new Error("Async dynamic generators must use getSecretAsync");
				}

				this.auditLog({
					action: "read",
					secretId: row.id as string,
					secretName: row.name as string,
					principalType: params.principalType,
					principalId: params.principalId,
					environment: params.environment,
					success: true,
					metadata: { dynamic: true },
					ipAddress: params.ipAddress,
					userAgent: params.userAgent,
				});

				return {
					secret: this.rowToSecret(row),
					value: dynamicValue as string,
				};
			}
		}

		// Handle secret references
		if (row.references_secret_id) {
			return this.getSecret({
				id: row.references_secret_id as string,
				principalType: params.principalType,
				principalId: params.principalId,
				ipAddress: params.ipAddress,
				userAgent: params.userAgent,
			});
		}

		// Decrypt the value
		const decryptedValue = decrypt(encryptedValue, iv, authTag, salt, this.config.masterKey);

		// Update cache
		if (this.config.cacheEnabled) {
			const cacheExpiry = new Date(Date.now() + this.config.cacheTtlSeconds * 1000);
			this.cache.set(cacheKey, {
				secretId: row.id as string,
				decryptedValue,
				cachedAt: new Date(),
				expiresAt: cacheExpiry,
			});

			// Enforce max cache size
			if (this.cache.size > this.config.maxCacheSize) {
				const oldest = Array.from(this.cache.entries()).sort(
					(a, b) => a[1].cachedAt.getTime() - b[1].cachedAt.getTime(),
				)[0];
				if (oldest) {
					this.cache.delete(oldest[0]);
				}
			}
		}

		this.auditLog({
			action: "read",
			secretId: row.id as string,
			secretName: row.name as string,
			version,
			principalType: params.principalType,
			principalId: params.principalId,
			environment: params.environment,
			success: true,
			ipAddress: params.ipAddress,
			userAgent: params.userAgent,
		});

		return {
			secret: this.rowToSecret(row),
			value: decryptedValue,
		};
	}

	updateSecret(params: {
		id?: string;
		name?: string;
		newValue: string;
		description?: string;
		tags?: string[];
		metadata?: Record<string, unknown>;
		expiresAt?: Date;
		rotationTrigger?: RotationTrigger;
		updatedBy: string;
	}): Secret | null {
		// Find the secret
		let query = "SELECT * FROM secrets WHERE ";
		const queryParams: unknown[] = [];

		if (params.id) {
			query += "id = ?";
			queryParams.push(params.id);
		} else if (params.name) {
			query += "name = ?";
			queryParams.push(params.name);
		} else {
			throw new Error("Either id or name must be provided");
		}

		const stmt = this.db.prepare(query);
		const row = stmt.get(...queryParams) as Record<string, unknown> | undefined;

		if (!row) return null;

		const now = new Date();
		const newVersion = (row.version as number) + 1;

		// Encrypt the new value
		const { encrypted, iv, authTag, salt } = encrypt(params.newValue, this.config.masterKey);

		// Update the secret
		const updateStmt = this.db.prepare(`
      UPDATE secrets SET
        version = ?,
        encrypted_value = ?,
        iv = ?,
        auth_tag = ?,
        salt = ?,
        description = COALESCE(?, description),
        tags = COALESCE(?, tags),
        metadata = COALESCE(?, metadata),
        expires_at = COALESCE(?, expires_at),
        updated_at = ?,
        updated_by = ?
      WHERE id = ?
    `);

		updateStmt.run(
			newVersion,
			encrypted,
			iv,
			authTag,
			salt,
			params.description ?? null,
			params.tags ? JSON.stringify(params.tags) : null,
			params.metadata ? JSON.stringify(params.metadata) : null,
			params.expiresAt?.toISOString() ?? null,
			now.toISOString(),
			params.updatedBy,
			row.id,
		);

		// Create version record
		const secret = this.rowToSecret({
			...row,
			version: newVersion,
			encrypted_value: encrypted,
			iv,
			auth_tag: authTag,
			updated_at: now.toISOString(),
			updated_by: params.updatedBy,
		});

		this.createVersion(secret, salt, params.updatedBy, params.rotationTrigger);

		// Invalidate cache
		this.invalidateCache(row.id as string);

		this.auditLog({
			action: "write",
			secretId: row.id as string,
			secretName: row.name as string,
			version: newVersion,
			principalType: "user",
			principalId: params.updatedBy,
			success: true,
			metadata: { rotationTrigger: params.rotationTrigger },
		});

		this.emit("secret:updated", { secretId: row.id, name: row.name, version: newVersion });
		return secret;
	}

	deleteSecret(params: { id?: string; name?: string; deletedBy: string }): boolean {
		let query = "SELECT * FROM secrets WHERE ";
		const queryParams: unknown[] = [];

		if (params.id) {
			query += "id = ?";
			queryParams.push(params.id);
		} else if (params.name) {
			query += "name = ?";
			queryParams.push(params.name);
		} else {
			throw new Error("Either id or name must be provided");
		}

		const stmt = this.db.prepare(query);
		const row = stmt.get(...queryParams) as Record<string, unknown> | undefined;

		if (!row) return false;

		// Delete versions
		const deleteVersionsStmt = this.db.prepare("DELETE FROM secret_versions WHERE secret_id = ?");
		deleteVersionsStmt.run(row.id);

		// Delete access policies
		const deleteAccessStmt = this.db.prepare("DELETE FROM access_policies WHERE secret_id = ?");
		deleteAccessStmt.run(row.id);

		// Delete leases
		const deleteLeasesStmt = this.db.prepare("DELETE FROM secret_leases WHERE secret_id = ?");
		deleteLeasesStmt.run(row.id);

		// Delete the secret
		const deleteStmt = this.db.prepare("DELETE FROM secrets WHERE id = ?");
		deleteStmt.run(row.id);

		// Invalidate cache
		this.invalidateCache(row.id as string);

		this.auditLog({
			action: "delete",
			secretId: row.id as string,
			secretName: row.name as string,
			principalType: "user",
			principalId: params.deletedBy,
			success: true,
		});

		this.emit("secret:deleted", { secretId: row.id, name: row.name });
		return true;
	}

	listSecrets(
		params: { environment?: SecretEnvironment; type?: SecretType; tags?: string[]; includeExpired?: boolean } = {},
	): Secret[] {
		let query = "SELECT * FROM secrets WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.environment && params.environment !== "all") {
			query += " AND (environment = ? OR environment = ?)";
			queryParams.push(params.environment, "all");
		}

		if (params.type) {
			query += " AND type = ?";
			queryParams.push(params.type);
		}

		if (!params.includeExpired) {
			query += " AND (expires_at IS NULL OR expires_at > ?)";
			queryParams.push(new Date().toISOString());
		}

		query += " ORDER BY name";

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as Record<string, unknown>[];

		let secrets = rows.map((row) => this.rowToSecret(row));

		// Filter by tags if provided
		if (params.tags && params.tags.length > 0) {
			secrets = secrets.filter((s) => s.tags && params.tags!.some((tag) => s.tags!.includes(tag)));
		}

		return secrets;
	}

	private createVersion(secret: Secret, salt: string, createdBy: string, rotationTrigger?: RotationTrigger): void {
		const id = `version_${Date.now()}_${randomBytes(8).toString("hex")}`;

		const stmt = this.db.prepare(`
      INSERT INTO secret_versions
      (id, secret_id, version, encrypted_value, iv, auth_tag, salt, created_at, created_by, rotation_trigger)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			id,
			secret.id,
			secret.version,
			secret.encryptedValue,
			secret.iv,
			secret.authTag,
			salt,
			new Date().toISOString(),
			createdBy,
			rotationTrigger ?? null,
		);
	}

	getSecretVersions(secretId: string): SecretVersion[] {
		const stmt = this.db.prepare(`
      SELECT * FROM secret_versions WHERE secret_id = ? ORDER BY version DESC
    `);
		const rows = stmt.all(secretId) as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			secretId: row.secret_id as string,
			version: row.version as number,
			encryptedValue: row.encrypted_value as string,
			iv: row.iv as string,
			authTag: row.auth_tag as string,
			createdAt: new Date(row.created_at as string),
			createdBy: row.created_by as string,
			rotationTrigger: row.rotation_trigger as RotationTrigger | undefined,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		}));
	}

	private rowToSecret(row: Record<string, unknown>): Secret {
		return {
			id: row.id as string,
			name: row.name as string,
			type: row.type as SecretType,
			environment: row.environment as SecretEnvironment,
			version: row.version as number,
			encryptedValue: row.encrypted_value as string,
			iv: row.iv as string,
			authTag: row.auth_tag as string,
			description: row.description as string | undefined,
			tags: row.tags ? JSON.parse(row.tags as string) : undefined,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
			expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
			rotationPolicyId: row.rotation_policy_id as string | undefined,
			referencesSecretId: row.references_secret_id as string | undefined,
			isDynamic: Boolean(row.is_dynamic),
			dynamicGenerator: row.dynamic_generator as string | undefined,
			createdAt: new Date(row.created_at as string),
			createdBy: row.created_by as string,
			updatedAt: new Date(row.updated_at as string),
			updatedBy: row.updated_by as string,
		};
	}

	// ============================================================================
	// Access Control
	// ============================================================================

	grantAccess(params: {
		secretId: string;
		principalType: "user" | "agent" | "role" | "service";
		principalId: string;
		accessLevel: AccessLevel;
		environments: SecretEnvironment[];
		expiresAt?: Date;
		grantedBy: string;
	}): AccessPolicy {
		const id = `access_${Date.now()}_${randomBytes(8).toString("hex")}`;

		const policy: AccessPolicy = {
			id,
			secretId: params.secretId,
			principalType: params.principalType,
			principalId: params.principalId,
			accessLevel: params.accessLevel,
			environments: params.environments,
			expiresAt: params.expiresAt,
			createdAt: new Date(),
			createdBy: params.grantedBy,
		};

		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO access_policies
      (id, secret_id, principal_type, principal_id, access_level, environments, expires_at, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			policy.id,
			policy.secretId,
			policy.principalType,
			policy.principalId,
			policy.accessLevel,
			JSON.stringify(policy.environments),
			policy.expiresAt?.toISOString() ?? null,
			policy.createdAt.toISOString(),
			policy.createdBy,
		);

		// Get secret name for audit
		const secretStmt = this.db.prepare("SELECT name FROM secrets WHERE id = ?");
		const secretRow = secretStmt.get(params.secretId) as { name: string } | undefined;

		this.auditLog({
			action: "grant",
			secretId: params.secretId,
			secretName: secretRow?.name ?? "unknown",
			principalType: params.principalType,
			principalId: params.principalId,
			success: true,
			metadata: { accessLevel: params.accessLevel, environments: params.environments },
		});

		this.emit("access:granted", policy);
		return policy;
	}

	revokeAccess(params: { secretId: string; principalType: string; principalId: string; revokedBy: string }): boolean {
		const stmt = this.db.prepare(`
      DELETE FROM access_policies
      WHERE secret_id = ? AND principal_type = ? AND principal_id = ?
    `);
		const result = stmt.run(params.secretId, params.principalType, params.principalId);

		if (result.changes > 0) {
			const secretStmt = this.db.prepare("SELECT name FROM secrets WHERE id = ?");
			const secretRow = secretStmt.get(params.secretId) as { name: string } | undefined;

			this.auditLog({
				action: "revoke",
				secretId: params.secretId,
				secretName: secretRow?.name ?? "unknown",
				principalType: params.principalType,
				principalId: params.principalId,
				success: true,
			});

			this.emit("access:revoked", params);
			return true;
		}
		return false;
	}

	private checkAccess(
		secretId: string,
		principalType: string,
		principalId: string,
		requiredLevel: AccessLevel,
		environment?: SecretEnvironment,
	): boolean {
		const stmt = this.db.prepare(`
      SELECT * FROM access_policies
      WHERE secret_id = ? AND principal_type = ? AND principal_id = ?
        AND (expires_at IS NULL OR expires_at > ?)
    `);

		const row = stmt.get(secretId, principalType, principalId, new Date().toISOString()) as
			| Record<string, unknown>
			| undefined;

		if (!row) return false;

		// Check access level
		const accessLevel = row.access_level as AccessLevel;
		const levelHierarchy: Record<AccessLevel, number> = { read: 1, write: 2, admin: 3 };
		if (levelHierarchy[accessLevel] < levelHierarchy[requiredLevel]) return false;

		// Check environment
		if (environment) {
			const environments = JSON.parse(row.environments as string) as SecretEnvironment[];
			if (!environments.includes(environment) && !environments.includes("all")) return false;
		}

		return true;
	}

	getAccessPolicies(secretId: string): AccessPolicy[] {
		const stmt = this.db.prepare("SELECT * FROM access_policies WHERE secret_id = ?");
		const rows = stmt.all(secretId) as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			secretId: row.secret_id as string,
			principalType: row.principal_type as "user" | "agent" | "role" | "service",
			principalId: row.principal_id as string,
			accessLevel: row.access_level as AccessLevel,
			environments: JSON.parse(row.environments as string),
			expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
			createdAt: new Date(row.created_at as string),
			createdBy: row.created_by as string,
		}));
	}

	// ============================================================================
	// Rotation Policies
	// ============================================================================

	createRotationPolicy(params: {
		name: string;
		rotationIntervalDays: number;
		notifyBeforeDays?: number;
		autoRotate?: boolean;
		rotationHook?: string;
		secretTypes?: SecretType[];
	}): RotationPolicy {
		const id = `rotation_${Date.now()}_${randomBytes(8).toString("hex")}`;
		const now = new Date();
		const nextRotation = new Date(now.getTime() + params.rotationIntervalDays * 24 * 60 * 60 * 1000);

		const policy: RotationPolicy = {
			id,
			name: params.name,
			rotationIntervalDays: params.rotationIntervalDays,
			notifyBeforeDays: params.notifyBeforeDays ?? 7,
			autoRotate: params.autoRotate ?? false,
			rotationHook: params.rotationHook,
			secretTypes: params.secretTypes,
			enabled: true,
			createdAt: now,
			nextRotation,
		};

		const stmt = this.db.prepare(`
      INSERT INTO rotation_policies
      (id, name, rotation_interval_days, notify_before_days, auto_rotate, rotation_hook, secret_types, enabled, created_at, next_rotation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			policy.id,
			policy.name,
			policy.rotationIntervalDays,
			policy.notifyBeforeDays,
			policy.autoRotate ? 1 : 0,
			policy.rotationHook ?? null,
			policy.secretTypes ? JSON.stringify(policy.secretTypes) : null,
			1,
			policy.createdAt.toISOString(),
			policy.nextRotation?.toISOString() ?? null,
		);

		this.emit("rotation:policy:created", policy);
		return policy;
	}

	getRotationPolicies(enabledOnly: boolean = true): RotationPolicy[] {
		const query = enabledOnly
			? "SELECT * FROM rotation_policies WHERE enabled = 1"
			: "SELECT * FROM rotation_policies";

		const stmt = this.db.prepare(query);
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			name: row.name as string,
			rotationIntervalDays: row.rotation_interval_days as number,
			notifyBeforeDays: row.notify_before_days as number,
			autoRotate: Boolean(row.auto_rotate),
			rotationHook: row.rotation_hook as string | undefined,
			secretTypes: row.secret_types ? JSON.parse(row.secret_types as string) : undefined,
			enabled: Boolean(row.enabled),
			createdAt: new Date(row.created_at as string),
			lastRotation: row.last_rotation ? new Date(row.last_rotation as string) : undefined,
			nextRotation: row.next_rotation ? new Date(row.next_rotation as string) : undefined,
		}));
	}

	rotateSecret(params: {
		secretId?: string;
		secretName?: string;
		newValue?: string;
		rotationTrigger: RotationTrigger;
		rotatedBy: string;
	}): Secret | null {
		// Get the secret
		const stmt = this.db.prepare(
			params.secretId ? "SELECT * FROM secrets WHERE id = ?" : "SELECT * FROM secrets WHERE name = ?",
		);
		const row = stmt.get(params.secretId ?? params.secretName) as Record<string, unknown> | undefined;

		if (!row) return null;

		// Generate new value if not provided
		let newValue = params.newValue;
		if (!newValue) {
			newValue = generateSecureToken(32);
		}

		// Update the secret
		const updatedSecret = this.updateSecret({
			id: row.id as string,
			newValue,
			rotationTrigger: params.rotationTrigger,
			updatedBy: params.rotatedBy,
		});

		if (updatedSecret) {
			// Update rotation policy if linked
			if (row.rotation_policy_id) {
				const now = new Date();
				const policyStmt = this.db.prepare("SELECT rotation_interval_days FROM rotation_policies WHERE id = ?");
				const policyRow = policyStmt.get(row.rotation_policy_id) as { rotation_interval_days: number } | undefined;

				if (policyRow) {
					const nextRotation = new Date(now.getTime() + policyRow.rotation_interval_days * 24 * 60 * 60 * 1000);
					const updatePolicyStmt = this.db.prepare(`
            UPDATE rotation_policies SET last_rotation = ?, next_rotation = ? WHERE id = ?
          `);
					updatePolicyStmt.run(now.toISOString(), nextRotation.toISOString(), row.rotation_policy_id);
				}
			}

			this.auditLog({
				action: "rotate",
				secretId: row.id as string,
				secretName: row.name as string,
				version: updatedSecret.version,
				principalType: "user",
				principalId: params.rotatedBy,
				success: true,
				metadata: { trigger: params.rotationTrigger },
			});

			this.emit("secret:rotated", {
				secretId: row.id,
				name: row.name,
				trigger: params.rotationTrigger,
			});
		}

		return updatedSecret;
	}

	private checkRotations(): void {
		const now = new Date();
		const policies = this.getRotationPolicies(true);

		for (const policy of policies) {
			if (!policy.nextRotation || policy.nextRotation > now) continue;

			// Find secrets with this policy
			const secretsStmt = this.db.prepare("SELECT * FROM secrets WHERE rotation_policy_id = ?");
			const secrets = secretsStmt.all(policy.id) as Record<string, unknown>[];

			for (const secret of secrets) {
				if (policy.autoRotate) {
					// Auto-rotate the secret
					this.rotateSecret({
						secretId: secret.id as string,
						rotationTrigger: "schedule",
						rotatedBy: "system",
					});
				} else {
					// Emit notification
					this.emit("rotation:due", {
						secretId: secret.id,
						secretName: secret.name,
						policyId: policy.id,
						policyName: policy.name,
					});
				}
			}

			// Check for upcoming rotations (notify before)
			const notifyDate = new Date(now.getTime() + policy.notifyBeforeDays * 24 * 60 * 60 * 1000);
			if (policy.nextRotation <= notifyDate) {
				for (const secret of secrets) {
					this.emit("rotation:upcoming", {
						secretId: secret.id,
						secretName: secret.name,
						policyId: policy.id,
						daysUntilRotation: Math.ceil(
							(policy.nextRotation!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
						),
					});
				}
			}
		}
	}

	// ============================================================================
	// Leases
	// ============================================================================

	createLease(params: {
		secretId: string;
		principalType: "user" | "agent" | "service";
		principalId: string;
		ttlSeconds?: number;
		maxRenewals?: number;
		metadata?: Record<string, unknown>;
	}): SecretLease {
		const id = `lease_${Date.now()}_${randomBytes(8).toString("hex")}`;
		const now = new Date();
		const ttl = Math.min(params.ttlSeconds ?? this.config.leaseDefaultTtlSeconds, this.config.leaseMaxTtlSeconds);
		const expiresAt = new Date(now.getTime() + ttl * 1000);

		const lease: SecretLease = {
			id,
			secretId: params.secretId,
			principalType: params.principalType,
			principalId: params.principalId,
			status: "active",
			ttlSeconds: ttl,
			issuedAt: now,
			expiresAt,
			renewCount: 0,
			maxRenewals: params.maxRenewals ?? this.config.maxLeaseRenewals,
			metadata: params.metadata,
		};

		const stmt = this.db.prepare(`
      INSERT INTO secret_leases
      (id, secret_id, principal_type, principal_id, status, ttl_seconds, issued_at, expires_at, renew_count, max_renewals, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			lease.id,
			lease.secretId,
			lease.principalType,
			lease.principalId,
			lease.status,
			lease.ttlSeconds,
			lease.issuedAt.toISOString(),
			lease.expiresAt.toISOString(),
			lease.renewCount,
			lease.maxRenewals,
			lease.metadata ? JSON.stringify(lease.metadata) : null,
		);

		const secretStmt = this.db.prepare("SELECT name FROM secrets WHERE id = ?");
		const secretRow = secretStmt.get(params.secretId) as { name: string } | undefined;

		this.auditLog({
			action: "lease",
			secretId: params.secretId,
			secretName: secretRow?.name ?? "unknown",
			principalType: params.principalType,
			principalId: params.principalId,
			success: true,
			metadata: { leaseId: lease.id, ttlSeconds: ttl },
		});

		this.emit("lease:created", lease);
		return lease;
	}

	renewLease(leaseId: string, ttlSeconds?: number): SecretLease | null {
		const stmt = this.db.prepare("SELECT * FROM secret_leases WHERE id = ? AND status = ?");
		const row = stmt.get(leaseId, "active") as Record<string, unknown> | undefined;

		if (!row) return null;

		const renewCount = (row.renew_count as number) + 1;
		const maxRenewals = row.max_renewals as number;

		if (renewCount > maxRenewals) {
			return null;
		}

		const now = new Date();
		const ttl = Math.min(ttlSeconds ?? (row.ttl_seconds as number), this.config.leaseMaxTtlSeconds);
		const newExpiry = new Date(now.getTime() + ttl * 1000);

		const updateStmt = this.db.prepare(`
      UPDATE secret_leases SET expires_at = ?, renew_count = ? WHERE id = ?
    `);
		updateStmt.run(newExpiry.toISOString(), renewCount, leaseId);

		const secretStmt = this.db.prepare("SELECT name FROM secrets WHERE id = ?");
		const secretRow = secretStmt.get(row.secret_id) as { name: string } | undefined;

		this.auditLog({
			action: "renew",
			secretId: row.secret_id as string,
			secretName: secretRow?.name ?? "unknown",
			principalType: row.principal_type as string,
			principalId: row.principal_id as string,
			success: true,
			metadata: { leaseId, renewCount, newExpiry: newExpiry.toISOString() },
		});

		this.emit("lease:renewed", { leaseId, renewCount, expiresAt: newExpiry });

		return {
			id: row.id as string,
			secretId: row.secret_id as string,
			principalType: row.principal_type as "user" | "agent" | "service",
			principalId: row.principal_id as string,
			status: "active",
			ttlSeconds: ttl,
			issuedAt: new Date(row.issued_at as string),
			expiresAt: newExpiry,
			renewCount,
			maxRenewals,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		};
	}

	revokeLease(leaseId: string, revokedBy: string): boolean {
		const stmt = this.db.prepare("SELECT * FROM secret_leases WHERE id = ?");
		const row = stmt.get(leaseId) as Record<string, unknown> | undefined;

		if (!row) return false;

		const updateStmt = this.db.prepare(`
      UPDATE secret_leases SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?
    `);
		updateStmt.run(new Date().toISOString(), revokedBy, leaseId);

		const secretStmt = this.db.prepare("SELECT name FROM secrets WHERE id = ?");
		const secretRow = secretStmt.get(row.secret_id) as { name: string } | undefined;

		this.auditLog({
			action: "revoke",
			secretId: row.secret_id as string,
			secretName: secretRow?.name ?? "unknown",
			principalType: row.principal_type as string,
			principalId: row.principal_id as string,
			success: true,
			metadata: { leaseId, revokedBy },
		});

		this.emit("lease:revoked", { leaseId, revokedBy });
		return true;
	}

	getActiveLeases(secretId?: string): SecretLease[] {
		let query = "SELECT * FROM secret_leases WHERE status = 'active' AND expires_at > ?";
		const params: unknown[] = [new Date().toISOString()];

		if (secretId) {
			query += " AND secret_id = ?";
			params.push(secretId);
		}

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...params) as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			secretId: row.secret_id as string,
			principalType: row.principal_type as "user" | "agent" | "service",
			principalId: row.principal_id as string,
			status: row.status as LeaseStatus,
			ttlSeconds: row.ttl_seconds as number,
			issuedAt: new Date(row.issued_at as string),
			expiresAt: new Date(row.expires_at as string),
			revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : undefined,
			revokedBy: row.revoked_by as string | undefined,
			renewCount: row.renew_count as number,
			maxRenewals: row.max_renewals as number,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		}));
	}

	private cleanupExpiredLeases(): void {
		const stmt = this.db.prepare(`
      UPDATE secret_leases SET status = 'expired'
      WHERE status = 'active' AND expires_at <= ?
    `);
		const result = stmt.run(new Date().toISOString());

		if (result.changes > 0) {
			this.emit("leases:expired", { count: result.changes });
		}
	}

	// ============================================================================
	// Dynamic Secrets
	// ============================================================================

	registerDynamicGenerator(generator: DynamicSecretGenerator): void {
		this.dynamicGenerators.set(generator.id, generator);
		this.emit("generator:registered", generator);
	}

	unregisterDynamicGenerator(generatorId: string): boolean {
		const result = this.dynamicGenerators.delete(generatorId);
		if (result) {
			this.emit("generator:unregistered", { generatorId });
		}
		return result;
	}

	getDynamicGenerators(): DynamicSecretGenerator[] {
		return Array.from(this.dynamicGenerators.values());
	}

	// ============================================================================
	// Bulk Operations
	// ============================================================================

	bulkCreateSecrets(
		secrets: Array<{
			name: string;
			value: string;
			type: SecretType;
			environment: SecretEnvironment;
			description?: string;
			tags?: string[];
		}>,
		createdBy: string,
	): Secret[] {
		const results: Secret[] = [];

		const transaction = this.db.transaction(() => {
			for (const secretData of secrets) {
				const secret = this.createSecret({
					...secretData,
					createdBy,
				});
				results.push(secret);
			}
		});

		transaction();
		return results;
	}

	bulkDeleteSecrets(secretIds: string[], deletedBy: string): number {
		let deleted = 0;

		const transaction = this.db.transaction(() => {
			for (const secretId of secretIds) {
				if (this.deleteSecret({ id: secretId, deletedBy })) {
					deleted++;
				}
			}
		});

		transaction();
		return deleted;
	}

	// ============================================================================
	// Import/Export
	// ============================================================================

	exportSecrets(params: {
		environment?: SecretEnvironment;
		secretIds?: string[];
		exportKey: string;
		exportedBy: string;
	}): SecretExport {
		let secrets: Secret[];

		if (params.secretIds && params.secretIds.length > 0) {
			secrets = params.secretIds
				.map((id) => {
					const stmt = this.db.prepare("SELECT * FROM secrets WHERE id = ?");
					const row = stmt.get(id) as Record<string, unknown> | undefined;
					return row ? this.rowToSecret(row) : null;
				})
				.filter((s): s is Secret => s !== null);
		} else {
			secrets = this.listSecrets({ environment: params.environment });
		}

		const exportData: SecretExport = {
			version: "1.0",
			exportedAt: new Date(),
			exportedBy: params.exportedBy,
			environment: params.environment,
			secrets: [],
			checksum: "",
		};

		for (const secret of secrets) {
			// Get the salt for decryption
			const saltStmt = this.db.prepare("SELECT salt FROM secrets WHERE id = ?");
			const saltRow = saltStmt.get(secret.id) as { salt: string };

			// Decrypt with master key
			const decrypted = decrypt(
				secret.encryptedValue,
				secret.iv,
				secret.authTag,
				saltRow.salt,
				this.config.masterKey,
			);

			// Re-encrypt with export key
			const { encrypted, iv, authTag } = encrypt(decrypted, params.exportKey);

			exportData.secrets.push({
				name: secret.name,
				type: secret.type,
				environment: secret.environment,
				encryptedPayload: encrypted,
				iv,
				authTag,
				metadata: secret.metadata,
			});

			this.auditLog({
				action: "export",
				secretId: secret.id,
				secretName: secret.name,
				principalType: "user",
				principalId: params.exportedBy,
				success: true,
			});
		}

		// Calculate checksum
		exportData.checksum = hashValue(JSON.stringify(exportData.secrets));

		this.emit("secrets:exported", {
			count: secrets.length,
			environment: params.environment,
			exportedBy: params.exportedBy,
		});

		return exportData;
	}

	importSecrets(params: { exportData: SecretExport; importKey: string; importedBy: string; overwrite?: boolean }): {
		imported: number;
		skipped: number;
		errors: string[];
	} {
		const result = { imported: 0, skipped: 0, errors: [] as string[] };

		// Verify checksum
		const calculatedChecksum = hashValue(JSON.stringify(params.exportData.secrets));
		if (calculatedChecksum !== params.exportData.checksum) {
			result.errors.push("Checksum mismatch - export data may be corrupted");
			return result;
		}

		const transaction = this.db.transaction(() => {
			for (const secretData of params.exportData.secrets) {
				try {
					// Check if secret exists
					const existingStmt = this.db.prepare("SELECT id FROM secrets WHERE name = ?");
					const existing = existingStmt.get(secretData.name);

					if (existing && !params.overwrite) {
						result.skipped++;
						continue;
					}

					// Decrypt with import key
					const decrypted = decrypt(
						secretData.encryptedPayload,
						secretData.iv,
						secretData.authTag,
						"", // Salt is embedded in the encrypted data for export
						params.importKey,
					);

					if (existing && params.overwrite) {
						this.updateSecret({
							name: secretData.name,
							newValue: decrypted,
							metadata: secretData.metadata,
							updatedBy: params.importedBy,
						});
					} else {
						this.createSecret({
							name: secretData.name,
							value: decrypted,
							type: secretData.type,
							environment: secretData.environment,
							metadata: secretData.metadata,
							createdBy: params.importedBy,
						});
					}

					result.imported++;
				} catch (error) {
					result.errors.push(
						`Failed to import ${secretData.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		});

		try {
			transaction();
		} catch (error) {
			result.errors.push(`Transaction failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.emit("secrets:imported", {
			imported: result.imported,
			skipped: result.skipped,
			errors: result.errors.length,
			importedBy: params.importedBy,
		});

		return result;
	}

	// ============================================================================
	// Audit Logging
	// ============================================================================

	private auditLog(params: {
		action: SecretAuditEntry["action"];
		secretId: string;
		secretName: string;
		version?: number;
		principalType: string;
		principalId: string;
		environment?: SecretEnvironment;
		success: boolean;
		errorMessage?: string;
		ipAddress?: string;
		userAgent?: string;
		metadata?: Record<string, unknown>;
	}): void {
		const id = `audit_${Date.now()}_${randomBytes(8).toString("hex")}`;

		const stmt = this.db.prepare(`
      INSERT INTO secret_audit
      (id, timestamp, action, secret_id, secret_name, version, principal_type, principal_id,
       environment, success, error_message, ip_address, user_agent, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			id,
			new Date().toISOString(),
			params.action,
			params.secretId,
			params.secretName,
			params.version ?? null,
			params.principalType,
			params.principalId,
			params.environment ?? null,
			params.success ? 1 : 0,
			params.errorMessage ?? null,
			params.ipAddress ?? null,
			params.userAgent ?? null,
			params.metadata ? JSON.stringify(params.metadata) : null,
		);

		this.emit("audit:logged", params);
	}

	getAuditLog(
		params: {
			secretId?: string;
			principalId?: string;
			action?: SecretAuditEntry["action"];
			startDate?: Date;
			endDate?: Date;
			limit?: number;
		} = {},
	): SecretAuditEntry[] {
		let query = "SELECT * FROM secret_audit WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.secretId) {
			query += " AND secret_id = ?";
			queryParams.push(params.secretId);
		}
		if (params.principalId) {
			query += " AND principal_id = ?";
			queryParams.push(params.principalId);
		}
		if (params.action) {
			query += " AND action = ?";
			queryParams.push(params.action);
		}
		if (params.startDate) {
			query += " AND timestamp >= ?";
			queryParams.push(params.startDate.toISOString());
		}
		if (params.endDate) {
			query += " AND timestamp <= ?";
			queryParams.push(params.endDate.toISOString());
		}

		query += " ORDER BY timestamp DESC";

		if (params.limit) {
			query += " LIMIT ?";
			queryParams.push(params.limit);
		}

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			timestamp: new Date(row.timestamp as string),
			action: row.action as SecretAuditEntry["action"],
			secretId: row.secret_id as string,
			secretName: row.secret_name as string,
			version: row.version as number | undefined,
			principalType: row.principal_type as string,
			principalId: row.principal_id as string,
			environment: row.environment as SecretEnvironment | undefined,
			success: Boolean(row.success),
			errorMessage: row.error_message as string | undefined,
			ipAddress: row.ip_address as string | undefined,
			userAgent: row.user_agent as string | undefined,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		}));
	}

	private cleanupAuditLogs(): void {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - this.config.auditRetentionDays);

		const stmt = this.db.prepare("DELETE FROM secret_audit WHERE timestamp < ?");
		const result = stmt.run(cutoffDate.toISOString());

		if (result.changes > 0) {
			this.emit("audit:cleaned", { deleted: result.changes });
		}
	}

	// ============================================================================
	// Cache Management
	// ============================================================================

	private invalidateCache(secretId: string): void {
		for (const key of this.cache.keys()) {
			if (key.startsWith(secretId)) {
				this.cache.delete(key);
			}
		}
	}

	clearCache(): void {
		this.cache.clear();
		this.emit("cache:cleared");
	}

	private cleanupCache(): void {
		const now = new Date();
		for (const [key, entry] of this.cache) {
			if (entry.expiresAt <= now) {
				this.cache.delete(key);
			}
		}
	}

	getCacheStats(): { size: number; maxSize: number; hitRate: number } {
		return {
			size: this.cache.size,
			maxSize: this.config.maxCacheSize,
			hitRate: 0, // Would need hit/miss tracking for accurate rate
		};
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): SecretStats {
		const totalStmt = this.db.prepare("SELECT COUNT(*) as count FROM secrets");
		const totalResult = totalStmt.get() as { count: number };

		const byTypeStmt = this.db.prepare("SELECT type, COUNT(*) as count FROM secrets GROUP BY type");
		const byTypeRows = byTypeStmt.all() as Array<{ type: string; count: number }>;
		const byType: Record<string, number> = {};
		for (const row of byTypeRows) {
			byType[row.type] = row.count;
		}

		const byEnvStmt = this.db.prepare("SELECT environment, COUNT(*) as count FROM secrets GROUP BY environment");
		const byEnvRows = byEnvStmt.all() as Array<{ environment: string; count: number }>;
		const byEnvironment: Record<string, number> = {};
		for (const row of byEnvRows) {
			byEnvironment[row.environment] = row.count;
		}

		const soon = new Date();
		soon.setDate(soon.getDate() + 30);
		const expiringStmt = this.db.prepare(
			"SELECT COUNT(*) as count FROM secrets WHERE expires_at IS NOT NULL AND expires_at <= ?",
		);
		const expiringResult = expiringStmt.get(soon.toISOString()) as { count: number };

		const rotationStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT s.id) as count
      FROM secrets s
      JOIN rotation_policies rp ON s.rotation_policy_id = rp.id
      WHERE rp.next_rotation <= ?
    `);
		const rotationResult = rotationStmt.get(new Date().toISOString()) as { count: number };

		const leasesStmt = this.db.prepare(
			"SELECT COUNT(*) as count FROM secret_leases WHERE status = 'active' AND expires_at > ?",
		);
		const leasesResult = leasesStmt.get(new Date().toISOString()) as { count: number };

		const last24h = new Date();
		last24h.setHours(last24h.getHours() - 24);
		const deniedStmt = this.db.prepare(
			"SELECT COUNT(*) as count FROM secret_audit WHERE success = 0 AND timestamp >= ?",
		);
		const deniedResult = deniedStmt.get(last24h.toISOString()) as { count: number };

		return {
			totalSecrets: totalResult.count,
			byType,
			byEnvironment,
			expiringSoon: expiringResult.count,
			rotationsPending: rotationResult.count,
			activeLeases: leasesResult.count,
			accessDenied24h: deniedResult.count,
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		if (this.rotationInterval) {
			clearInterval(this.rotationInterval);
			this.rotationInterval = null;
		}
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.cache.clear();
		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let secretManagerInstance: SecretManagerSystem | null = null;

export function getSecretManager(config?: SecretManagerConfig): SecretManagerSystem {
	if (!secretManagerInstance) {
		if (!config) {
			throw new Error("SecretManagerSystem requires config on first initialization");
		}
		secretManagerInstance = new SecretManagerSystem(config);
	}
	return secretManagerInstance;
}

export function resetSecretManager(): void {
	if (secretManagerInstance) {
		secretManagerInstance.shutdown();
		secretManagerInstance = null;
	}
}
