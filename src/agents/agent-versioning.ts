/**
 * Class 3.12: Agent Versioning System
 * TAC Pattern: Version control for agent configurations
 *
 * Provides versioning for agent configs:
 * - Semantic versioning for agent definitions
 * - Config diff and comparison
 * - Rollback to previous versions
 * - Version tagging (production, staging, dev)
 * - Migration between versions
 * - Audit trail for all changes
 */

import { EventEmitter } from "events";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ============================================================================
// Types
// ============================================================================

export type VersionTag = "dev" | "staging" | "production" | "archived";

export interface AgentVersion {
  id: string;
  agentId: string;
  version: string; // Semantic version: major.minor.patch
  config: AgentConfig;
  hash: string; // SHA256 of config for deduplication
  tag: VersionTag;
  createdAt: number;
  createdBy: string;
  changelog: string;
  parentVersion?: string; // Previous version ID
}

export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  tools: string[];
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export interface VersionDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  type: "added" | "removed" | "modified";
}

export interface VersionHistory {
  agentId: string;
  versions: AgentVersion[];
  currentVersion: AgentVersion | null;
  totalVersions: number;
}

export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  changes: VersionDiff[];
  rollbackAvailable: boolean;
}

export interface VersioningConfig {
  maxVersionsPerAgent: number;
  autoArchiveOld: boolean;
  requireChangelog: boolean;
}

export interface VersioningStats {
  totalAgents: number;
  totalVersions: number;
  productionVersions: number;
  stagingVersions: number;
  devVersions: number;
  archivedVersions: number;
  recentChanges: Array<{
    agentId: string;
    version: string;
    createdAt: number;
    createdBy: string;
  }>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: VersioningConfig = {
  maxVersionsPerAgent: 50,
  autoArchiveOld: true,
  requireChangelog: false,
};

// ============================================================================
// Agent Versioning System
// ============================================================================

export class AgentVersioningSystem extends EventEmitter {
  private db: Database.Database;
  private config: VersioningConfig;

  constructor(dataDir: string, config: Partial<VersioningConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    const dbPath = path.join(dataDir, "agent-versioning.db");
    fs.mkdirSync(dataDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_versions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        version TEXT NOT NULL,
        config TEXT NOT NULL,
        hash TEXT NOT NULL,
        tag TEXT NOT NULL DEFAULT 'dev',
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        changelog TEXT NOT NULL DEFAULT '',
        parent_version TEXT,
        UNIQUE(agent_id, version)
      );

      CREATE TABLE IF NOT EXISTS active_versions (
        agent_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES agent_versions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_versions_agent ON agent_versions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_versions_tag ON agent_versions(tag);
      CREATE INDEX IF NOT EXISTS idx_versions_hash ON agent_versions(hash);
      CREATE INDEX IF NOT EXISTS idx_versions_created ON agent_versions(created_at DESC);
    `);
  }

  /**
   * Calculate config hash for deduplication
   */
  private hashConfig(config: AgentConfig): string {
    const normalized = JSON.stringify(config, Object.keys(config).sort());
    return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  /**
   * Parse semantic version
   */
  private parseVersion(version: string): { major: number; minor: number; patch: number } {
    const [major, minor, patch] = version.split(".").map(Number);
    return { major: major || 0, minor: minor || 0, patch: patch || 0 };
  }

  /**
   * Increment version based on change type
   */
  private incrementVersion(
    currentVersion: string,
    changeType: "major" | "minor" | "patch"
  ): string {
    const { major, minor, patch } = this.parseVersion(currentVersion);

    switch (changeType) {
      case "major":
        return `${major + 1}.0.0`;
      case "minor":
        return `${major}.${minor + 1}.0`;
      case "patch":
      default:
        return `${major}.${minor}.${patch + 1}`;
    }
  }

  /**
   * Create a new version of an agent
   */
  createVersion(params: {
    agentId: string;
    config: AgentConfig;
    createdBy: string;
    changelog?: string;
    changeType?: "major" | "minor" | "patch";
    tag?: VersionTag;
  }): AgentVersion {
    const {
      agentId,
      config,
      createdBy,
      changelog = "",
      changeType = "patch",
      tag = "dev",
    } = params;

    // Check changelog requirement
    if (this.config.requireChangelog && !changelog) {
      throw new Error("Changelog is required for new versions");
    }

    // Get current version
    const currentVersion = this.getCurrentVersion(agentId);
    const hash = this.hashConfig(config);

    // Check for duplicate config
    if (currentVersion && currentVersion.hash === hash) {
      throw new Error("Config unchanged from current version");
    }

    // Calculate new version number
    const newVersionNumber = currentVersion
      ? this.incrementVersion(currentVersion.version, changeType)
      : "1.0.0";

    const id = `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();

    const version: AgentVersion = {
      id,
      agentId,
      version: newVersionNumber,
      config,
      hash,
      tag,
      createdAt: now,
      createdBy,
      changelog,
      parentVersion: currentVersion?.id,
    };

    // Save version
    this.db
      .prepare(
        `
      INSERT INTO agent_versions (id, agent_id, version, config, hash, tag, created_at, created_by, changelog, parent_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        version.id,
        version.agentId,
        version.version,
        JSON.stringify(version.config),
        version.hash,
        version.tag,
        version.createdAt,
        version.createdBy,
        version.changelog,
        version.parentVersion ?? null
      );

    // Set as active version
    this.db
      .prepare(
        `
      INSERT INTO active_versions (agent_id, version_id)
      VALUES (?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET version_id = excluded.version_id
    `
      )
      .run(agentId, id);

    // Auto-archive old versions if needed
    if (this.config.autoArchiveOld) {
      this.archiveOldVersions(agentId);
    }

    this.emit("version:created", { version });
    return version;
  }

  /**
   * Archive old versions beyond the limit
   */
  private archiveOldVersions(agentId: string): void {
    const versions = this.db
      .prepare(
        `
      SELECT id FROM agent_versions
      WHERE agent_id = ? AND tag != 'archived'
      ORDER BY created_at DESC
    `
      )
      .all(agentId) as Array<{ id: string }>;

    if (versions.length > this.config.maxVersionsPerAgent) {
      const toArchive = versions.slice(this.config.maxVersionsPerAgent);

      this.db
        .prepare(
          `
        UPDATE agent_versions SET tag = 'archived'
        WHERE id IN (${toArchive.map(() => "?").join(",")})
      `
        )
        .run(...toArchive.map((v) => v.id));
    }
  }

  /**
   * Get current active version for an agent
   */
  getCurrentVersion(agentId: string): AgentVersion | null {
    const row = this.db
      .prepare(
        `
      SELECT v.* FROM agent_versions v
      JOIN active_versions a ON v.id = a.version_id
      WHERE a.agent_id = ?
    `
      )
      .get(agentId) as
      | {
          id: string;
          agent_id: string;
          version: string;
          config: string;
          hash: string;
          tag: VersionTag;
          created_at: number;
          created_by: string;
          changelog: string;
          parent_version: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      agentId: row.agent_id,
      version: row.version,
      config: JSON.parse(row.config),
      hash: row.hash,
      tag: row.tag,
      createdAt: row.created_at,
      createdBy: row.created_by,
      changelog: row.changelog,
      parentVersion: row.parent_version ?? undefined,
    };
  }

  /**
   * Get a specific version by ID
   */
  getVersion(versionId: string): AgentVersion | null {
    const row = this.db
      .prepare(`SELECT * FROM agent_versions WHERE id = ?`)
      .get(versionId) as
      | {
          id: string;
          agent_id: string;
          version: string;
          config: string;
          hash: string;
          tag: VersionTag;
          created_at: number;
          created_by: string;
          changelog: string;
          parent_version: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      agentId: row.agent_id,
      version: row.version,
      config: JSON.parse(row.config),
      hash: row.hash,
      tag: row.tag,
      createdAt: row.created_at,
      createdBy: row.created_by,
      changelog: row.changelog,
      parentVersion: row.parent_version ?? undefined,
    };
  }

  /**
   * Get version history for an agent
   */
  getHistory(agentId: string, includeArchived = false): VersionHistory {
    let query = `
      SELECT * FROM agent_versions
      WHERE agent_id = ?
    `;

    if (!includeArchived) {
      query += ` AND tag != 'archived'`;
    }

    query += ` ORDER BY created_at DESC`;

    const rows = this.db.prepare(query).all(agentId) as Array<{
      id: string;
      agent_id: string;
      version: string;
      config: string;
      hash: string;
      tag: VersionTag;
      created_at: number;
      created_by: string;
      changelog: string;
      parent_version: string | null;
    }>;

    const versions: AgentVersion[] = rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      version: row.version,
      config: JSON.parse(row.config),
      hash: row.hash,
      tag: row.tag,
      createdAt: row.created_at,
      createdBy: row.created_by,
      changelog: row.changelog,
      parentVersion: row.parent_version ?? undefined,
    }));

    return {
      agentId,
      versions,
      currentVersion: this.getCurrentVersion(agentId),
      totalVersions: versions.length,
    };
  }

  /**
   * Compare two versions and return differences
   */
  compareVersions(versionIdA: string, versionIdB: string): VersionDiff[] {
    const versionA = this.getVersion(versionIdA);
    const versionB = this.getVersion(versionIdB);

    if (!versionA || !versionB) {
      throw new Error("One or both versions not found");
    }

    const diffs: VersionDiff[] = [];
    const configA = versionA.config;
    const configB = versionB.config;

    // Compare all fields
    const allKeys = new Set([
      ...Object.keys(configA),
      ...Object.keys(configB),
    ]);

    for (const key of allKeys) {
      const valueA = (configA as unknown as Record<string, unknown>)[key];
      const valueB = (configB as unknown as Record<string, unknown>)[key];

      if (valueA === undefined && valueB !== undefined) {
        diffs.push({ field: key, oldValue: undefined, newValue: valueB, type: "added" });
      } else if (valueA !== undefined && valueB === undefined) {
        diffs.push({ field: key, oldValue: valueA, newValue: undefined, type: "removed" });
      } else if (JSON.stringify(valueA) !== JSON.stringify(valueB)) {
        diffs.push({ field: key, oldValue: valueA, newValue: valueB, type: "modified" });
      }
    }

    return diffs;
  }

  /**
   * Rollback to a previous version
   */
  rollback(agentId: string, targetVersionId: string, userId: string): MigrationResult {
    const currentVersion = this.getCurrentVersion(agentId);
    const targetVersion = this.getVersion(targetVersionId);

    if (!targetVersion) {
      throw new Error("Target version not found");
    }

    if (targetVersion.agentId !== agentId) {
      throw new Error("Target version belongs to different agent");
    }

    const changes = currentVersion
      ? this.compareVersions(currentVersion.id, targetVersionId)
      : [];

    // Create rollback version (copy of target with new version number)
    const newVersion = this.createVersion({
      agentId,
      config: targetVersion.config,
      createdBy: userId,
      changelog: `Rollback to ${targetVersion.version}`,
      changeType: "patch",
      tag: "dev",
    });

    this.emit("version:rollback", {
      agentId,
      fromVersion: currentVersion?.version,
      toVersion: newVersion.version,
      targetVersion: targetVersion.version,
    });

    return {
      success: true,
      fromVersion: currentVersion?.version ?? "none",
      toVersion: newVersion.version,
      changes,
      rollbackAvailable: !!currentVersion,
    };
  }

  /**
   * Promote a version to a different tag
   */
  promoteVersion(
    versionId: string,
    toTag: VersionTag,
    userId: string
  ): AgentVersion {
    const version = this.getVersion(versionId);
    if (!version) {
      throw new Error("Version not found");
    }

    // Update tag
    this.db
      .prepare(`UPDATE agent_versions SET tag = ? WHERE id = ?`)
      .run(toTag, versionId);

    version.tag = toTag;

    this.emit("version:promoted", {
      version,
      toTag,
      promotedBy: userId,
    });

    return version;
  }

  /**
   * Get all agents with their current versions
   */
  getAllAgents(): Array<{ agentId: string; currentVersion: AgentVersion | null }> {
    const rows = this.db
      .prepare(
        `
      SELECT DISTINCT agent_id FROM agent_versions
    `
      )
      .all() as Array<{ agent_id: string }>;

    return rows.map((row) => ({
      agentId: row.agent_id,
      currentVersion: this.getCurrentVersion(row.agent_id),
    }));
  }

  /**
   * Get versions by tag
   */
  getVersionsByTag(tag: VersionTag): AgentVersion[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_versions WHERE tag = ? ORDER BY created_at DESC`)
      .all(tag) as Array<{
      id: string;
      agent_id: string;
      version: string;
      config: string;
      hash: string;
      tag: VersionTag;
      created_at: number;
      created_by: string;
      changelog: string;
      parent_version: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      version: row.version,
      config: JSON.parse(row.config),
      hash: row.hash,
      tag: row.tag,
      createdAt: row.created_at,
      createdBy: row.created_by,
      changelog: row.changelog,
      parentVersion: row.parent_version ?? undefined,
    }));
  }

  /**
   * Delete a specific version
   */
  deleteVersion(versionId: string): boolean {
    // Check if it's the active version
    const activeCheck = this.db
      .prepare(`SELECT 1 FROM active_versions WHERE version_id = ?`)
      .get(versionId);

    if (activeCheck) {
      throw new Error("Cannot delete active version");
    }

    const result = this.db
      .prepare(`DELETE FROM agent_versions WHERE id = ?`)
      .run(versionId);

    if (result.changes > 0) {
      this.emit("version:deleted", { versionId });
    }

    return result.changes > 0;
  }

  /**
   * Get versioning statistics
   */
  getStats(): VersioningStats {
    const agentCount = this.db
      .prepare(`SELECT COUNT(DISTINCT agent_id) as cnt FROM agent_versions`)
      .get() as { cnt: number };

    const versionCount = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM agent_versions`)
      .get() as { cnt: number };

    const tagCounts = this.db
      .prepare(`SELECT tag, COUNT(*) as cnt FROM agent_versions GROUP BY tag`)
      .all() as Array<{ tag: VersionTag; cnt: number }>;

    const recentChanges = this.db
      .prepare(
        `
      SELECT agent_id, version, created_at, created_by
      FROM agent_versions
      ORDER BY created_at DESC
      LIMIT 10
    `
      )
      .all() as Array<{
      agent_id: string;
      version: string;
      created_at: number;
      created_by: string;
    }>;

    const stats: VersioningStats = {
      totalAgents: agentCount.cnt,
      totalVersions: versionCount.cnt,
      productionVersions: 0,
      stagingVersions: 0,
      devVersions: 0,
      archivedVersions: 0,
      recentChanges: recentChanges.map((r) => ({
        agentId: r.agent_id,
        version: r.version,
        createdAt: r.created_at,
        createdBy: r.created_by,
      })),
    };

    for (const { tag, cnt } of tagCounts) {
      switch (tag) {
        case "production":
          stats.productionVersions = cnt;
          break;
        case "staging":
          stats.stagingVersions = cnt;
          break;
        case "dev":
          stats.devVersions = cnt;
          break;
        case "archived":
          stats.archivedVersions = cnt;
          break;
      }
    }

    return stats;
  }

  /**
   * Close the system
   */
  close(): void {
    this.db.close();
    this.emit("system:closed");
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let instance: AgentVersioningSystem | null = null;

export function getVersioningSystem(
  dataDir: string,
  config?: Partial<VersioningConfig>
): AgentVersioningSystem {
  if (!instance) {
    instance = new AgentVersioningSystem(dataDir, config);
  }
  return instance;
}

export function resetVersioningSystem(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

// ============================================================================
// Default Config Template
// ============================================================================

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  name: "default-agent",
  description: "Default agent configuration",
  systemPrompt: "You are a helpful assistant.",
  model: "openai/gpt-4o",
  temperature: 0.7,
  maxTokens: 4096,
  tools: [],
  capabilities: [],
  metadata: {},
};
