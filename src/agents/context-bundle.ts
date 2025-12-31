/**
 * Class 3.6 Context Bundle System
 *
 * TAC Pattern: Context Bundle Builder
 * "Capture and replay session state for consistent agent context"
 *
 * Capabilities:
 * - Capture current session context (files, changes, history)
 * - Save bundles for later replay
 * - Load bundles to restore context
 * - Share bundles between agents/sessions
 * - Compress large contexts for efficiency
 */

import Database from "better-sqlite3";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import { existsSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

// =============================================================================
// Types
// =============================================================================

/** File snapshot in bundle */
export interface FileSnapshot {
	path: string;
	relativePath: string;
	content: string;
	hash: string;
	size: number;
	modifiedAt: Date;
}

/** Git state snapshot */
export interface GitSnapshot {
	branch: string;
	commit: string;
	status: string[];
	diff: string;
	recentCommits: string[];
}

/** Conversation history entry */
export interface ConversationEntry {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
	toolCalls?: Array<{ name: string; input: string; output: string }>;
}

/** Context bundle - complete session state */
export interface ContextBundle {
	id: string;
	name: string;
	description: string;
	createdAt: Date;
	workingDir: string;

	// File context
	files: FileSnapshot[];

	// Git context
	git?: GitSnapshot;

	// Conversation history
	conversation: ConversationEntry[];

	// Active task context
	currentTask?: string;
	todoItems?: string[];

	// Agent context
	agentId?: string;
	agentRole?: string;
	systemPrompt?: string;

	// Metadata
	tags: string[];
	size: number;
	compressed: boolean;
}

/** Bundle summary (without full content) */
export interface BundleSummary {
	id: string;
	name: string;
	description: string;
	createdAt: Date;
	fileCount: number;
	conversationLength: number;
	size: number;
	tags: string[];
}

/** Bundle configuration */
export interface BundleConfig {
	dbPath: string;
	maxFiles: number;
	maxFileSize: number; // bytes
	maxConversationLength: number;
	compressionThreshold: number; // bytes
	autoCapture: boolean;
	captureInterval: number; // ms
}

// =============================================================================
// Context Bundle System
// =============================================================================

export class ContextBundleSystem extends EventEmitter {
	private db: Database.Database;
	private config: BundleConfig;
	private workingDir: string;
	private captureTimer: NodeJS.Timeout | null = null;

	constructor(workingDir: string, config: Partial<BundleConfig> = {}) {
		super();
		this.workingDir = resolve(workingDir);
		this.config = {
			dbPath: config.dbPath || join(workingDir, "context-bundles.db"),
			maxFiles: config.maxFiles ?? 50,
			maxFileSize: config.maxFileSize ?? 100 * 1024, // 100KB
			maxConversationLength: config.maxConversationLength ?? 100,
			compressionThreshold: config.compressionThreshold ?? 50 * 1024, // 50KB
			autoCapture: config.autoCapture ?? false,
			captureInterval: config.captureInterval ?? 5 * 60 * 1000, // 5 min
		};

		this.db = new Database(this.config.dbPath);
		this.initDatabase();

		if (this.config.autoCapture) {
			this.startAutoCapture();
		}
	}

	private initDatabase(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS bundles (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT,
				created_at TEXT NOT NULL,
				working_dir TEXT NOT NULL,
				files TEXT NOT NULL,
				git TEXT,
				conversation TEXT NOT NULL,
				current_task TEXT,
				todo_items TEXT,
				agent_id TEXT,
				agent_role TEXT,
				system_prompt TEXT,
				tags TEXT NOT NULL,
				size INTEGER NOT NULL,
				compressed INTEGER NOT NULL DEFAULT 0
			);

			CREATE INDEX IF NOT EXISTS idx_bundles_name ON bundles(name);
			CREATE INDEX IF NOT EXISTS idx_bundles_created ON bundles(created_at);
			CREATE INDEX IF NOT EXISTS idx_bundles_tags ON bundles(tags);
		`);
	}

	// =========================================================================
	// Bundle Capture
	// =========================================================================

	/** Capture current context as a bundle */
	async captureBundle(options: {
		name: string;
		description?: string;
		files?: string[];
		conversation?: ConversationEntry[];
		currentTask?: string;
		todoItems?: string[];
		agentId?: string;
		agentRole?: string;
		systemPrompt?: string;
		tags?: string[];
	}): Promise<ContextBundle> {
		const id = crypto.randomUUID();
		const now = new Date();

		// Capture files
		const files = await this.captureFiles(options.files || []);

		// Capture git state
		const git = await this.captureGitState();

		// Build bundle
		const bundle: ContextBundle = {
			id,
			name: options.name,
			description: options.description || "",
			createdAt: now,
			workingDir: this.workingDir,
			files,
			git,
			conversation: options.conversation || [],
			currentTask: options.currentTask,
			todoItems: options.todoItems,
			agentId: options.agentId,
			agentRole: options.agentRole,
			systemPrompt: options.systemPrompt,
			tags: options.tags || [],
			size: 0,
			compressed: false,
		};

		// Calculate size
		bundle.size = this.calculateBundleSize(bundle);

		// Compress if needed
		if (bundle.size > this.config.compressionThreshold) {
			this.compressBundle(bundle);
		}

		// Save to database
		this.saveBundle(bundle);

		this.emit("bundleCaptured", { id, name: options.name, size: bundle.size });
		return bundle;
	}

	/** Quick capture with auto-detected files */
	async quickCapture(name: string, recentFiles: string[] = []): Promise<ContextBundle> {
		// Find recently modified files if none provided
		const files = recentFiles.length > 0 ? recentFiles : await this.findRecentFiles();

		return this.captureBundle({
			name,
			description: `Quick capture at ${new Date().toISOString()}`,
			files,
			tags: ["quick", "auto"],
		});
	}

	// =========================================================================
	// Bundle Loading
	// =========================================================================

	/** Load a bundle by ID */
	loadBundle(id: string): ContextBundle | null {
		const row = this.db.prepare("SELECT * FROM bundles WHERE id = ?").get(id) as any;

		if (!row) return null;

		const bundle = this.rowToBundle(row);

		// Decompress if needed
		if (bundle.compressed) {
			this.decompressBundle(bundle);
		}

		this.emit("bundleLoaded", { id, name: bundle.name });
		return bundle;
	}

	/** Load bundle by name (most recent) */
	loadBundleByName(name: string): ContextBundle | null {
		const row = this.db
			.prepare("SELECT * FROM bundles WHERE name = ? ORDER BY created_at DESC LIMIT 1")
			.get(name) as any;

		if (!row) return null;

		return this.loadBundle(row.id);
	}

	/** List all bundles */
	listBundles(options: { tag?: string; limit?: number } = {}): BundleSummary[] {
		let query = "SELECT id, name, description, created_at, files, conversation, size, tags FROM bundles";
		const params: any[] = [];

		if (options.tag) {
			query += " WHERE tags LIKE ?";
			params.push(`%"${options.tag}"%`);
		}

		query += " ORDER BY created_at DESC";

		if (options.limit) {
			query += " LIMIT ?";
			params.push(options.limit);
		}

		const rows = this.db.prepare(query).all(...params) as any[];

		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			createdAt: new Date(row.created_at),
			fileCount: JSON.parse(row.files).length,
			conversationLength: JSON.parse(row.conversation).length,
			size: row.size,
			tags: JSON.parse(row.tags),
		}));
	}

	// =========================================================================
	// Bundle Application
	// =========================================================================

	/** Apply bundle context to current session */
	applyBundle(bundle: ContextBundle): {
		filesRestored: number;
		conversationLoaded: number;
		contextSummary: string;
	} {
		// Generate context summary for agent
		const contextSummary = this.generateContextSummary(bundle);

		this.emit("bundleApplied", {
			id: bundle.id,
			name: bundle.name,
			filesRestored: bundle.files.length,
			conversationLoaded: bundle.conversation.length,
		});

		return {
			filesRestored: bundle.files.length,
			conversationLoaded: bundle.conversation.length,
			contextSummary,
		};
	}

	/** Generate prompt context from bundle */
	generateContextSummary(bundle: ContextBundle): string {
		const parts: string[] = [];

		// Header
		parts.push(`# Context Bundle: ${bundle.name}`);
		parts.push(`Created: ${bundle.createdAt.toISOString()}`);
		parts.push("");

		// Current task
		if (bundle.currentTask) {
			parts.push(`## Current Task`);
			parts.push(bundle.currentTask);
			parts.push("");
		}

		// Todo items
		if (bundle.todoItems && bundle.todoItems.length > 0) {
			parts.push(`## Todo Items`);
			bundle.todoItems.forEach((item) => parts.push(`- ${item}`));
			parts.push("");
		}

		// Git state
		if (bundle.git) {
			parts.push(`## Git State`);
			parts.push(`Branch: ${bundle.git.branch}`);
			parts.push(`Commit: ${bundle.git.commit}`);
			if (bundle.git.status.length > 0) {
				parts.push(`Changes: ${bundle.git.status.length} files`);
			}
			parts.push("");
		}

		// Files summary
		if (bundle.files.length > 0) {
			parts.push(`## Files (${bundle.files.length})`);
			bundle.files.slice(0, 10).forEach((f) => {
				parts.push(`- ${f.relativePath} (${f.size} bytes)`);
			});
			if (bundle.files.length > 10) {
				parts.push(`... and ${bundle.files.length - 10} more`);
			}
			parts.push("");
		}

		// Recent conversation
		if (bundle.conversation.length > 0) {
			parts.push(`## Recent Conversation (${bundle.conversation.length} messages)`);
			bundle.conversation.slice(-5).forEach((msg) => {
				const preview = msg.content.slice(0, 100).replace(/\n/g, " ");
				parts.push(`[${msg.role}]: ${preview}...`);
			});
			parts.push("");
		}

		// Agent context
		if (bundle.agentRole || bundle.agentId) {
			parts.push(`## Agent Context`);
			if (bundle.agentId) parts.push(`Agent: ${bundle.agentId}`);
			if (bundle.agentRole) parts.push(`Role: ${bundle.agentRole}`);
			parts.push("");
		}

		return parts.join("\n");
	}

	// =========================================================================
	// Helper Methods
	// =========================================================================

	private async captureFiles(paths: string[]): Promise<FileSnapshot[]> {
		const snapshots: FileSnapshot[] = [];

		for (const filePath of paths.slice(0, this.config.maxFiles)) {
			const fullPath = resolve(this.workingDir, filePath);

			if (!existsSync(fullPath)) continue;

			try {
				const stats = statSync(fullPath);
				if (stats.size > this.config.maxFileSize) continue;

				const content = readFileSync(fullPath, "utf-8");
				const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

				snapshots.push({
					path: fullPath,
					relativePath: relative(this.workingDir, fullPath),
					content,
					hash,
					size: stats.size,
					modifiedAt: stats.mtime,
				});
			} catch {
				// Skip unreadable files
			}
		}

		return snapshots;
	}

	private async captureGitState(): Promise<GitSnapshot | undefined> {
		try {
			const { execSync } = await import("child_process");

			const branch = execSync("git branch --show-current", {
				cwd: this.workingDir,
				encoding: "utf-8",
			}).trim();

			const commit = execSync("git rev-parse HEAD", {
				cwd: this.workingDir,
				encoding: "utf-8",
			}).trim();

			const statusOutput = execSync("git status --porcelain", {
				cwd: this.workingDir,
				encoding: "utf-8",
			});
			const status = statusOutput.split("\n").filter(Boolean);

			const diff = execSync("git diff --stat", {
				cwd: this.workingDir,
				encoding: "utf-8",
			}).slice(0, 2000);

			const recentCommits = execSync("git log --oneline -5", {
				cwd: this.workingDir,
				encoding: "utf-8",
			})
				.split("\n")
				.filter(Boolean);

			return { branch, commit, status, diff, recentCommits };
		} catch {
			return undefined;
		}
	}

	private async findRecentFiles(): Promise<string[]> {
		try {
			const { execSync } = await import("child_process");

			// Get recently modified tracked files
			const output = execSync("git ls-files -m && git diff --name-only HEAD~5 2>/dev/null | head -20", {
				cwd: this.workingDir,
				encoding: "utf-8",
			});

			return [...new Set(output.split("\n").filter(Boolean))].slice(0, 20);
		} catch {
			return [];
		}
	}

	private calculateBundleSize(bundle: ContextBundle): number {
		let size = 0;
		size += bundle.files.reduce((sum, f) => sum + f.content.length, 0);
		size += bundle.conversation.reduce((sum, c) => sum + c.content.length, 0);
		size += bundle.git?.diff?.length || 0;
		return size;
	}

	private compressBundle(bundle: ContextBundle): void {
		// Simple compression: truncate large file contents
		for (const file of bundle.files) {
			if (file.content.length > 10000) {
				file.content = `${file.content.slice(0, 10000)}\n... [truncated]`;
			}
		}

		// Truncate old conversation
		if (bundle.conversation.length > 20) {
			bundle.conversation = bundle.conversation.slice(-20);
		}

		bundle.compressed = true;
		bundle.size = this.calculateBundleSize(bundle);
	}

	private decompressBundle(bundle: ContextBundle): void {
		// For now, just mark as decompressed
		bundle.compressed = false;
	}

	private saveBundle(bundle: ContextBundle): void {
		this.db
			.prepare(
				`INSERT INTO bundles (
					id, name, description, created_at, working_dir, files, git,
					conversation, current_task, todo_items, agent_id, agent_role,
					system_prompt, tags, size, compressed
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				bundle.id,
				bundle.name,
				bundle.description,
				bundle.createdAt.toISOString(),
				bundle.workingDir,
				JSON.stringify(bundle.files),
				bundle.git ? JSON.stringify(bundle.git) : null,
				JSON.stringify(bundle.conversation),
				bundle.currentTask || null,
				bundle.todoItems ? JSON.stringify(bundle.todoItems) : null,
				bundle.agentId || null,
				bundle.agentRole || null,
				bundle.systemPrompt || null,
				JSON.stringify(bundle.tags),
				bundle.size,
				bundle.compressed ? 1 : 0,
			);
	}

	private rowToBundle(row: any): ContextBundle {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			createdAt: new Date(row.created_at),
			workingDir: row.working_dir,
			files: JSON.parse(row.files),
			git: row.git ? JSON.parse(row.git) : undefined,
			conversation: JSON.parse(row.conversation),
			currentTask: row.current_task || undefined,
			todoItems: row.todo_items ? JSON.parse(row.todo_items) : undefined,
			agentId: row.agent_id || undefined,
			agentRole: row.agent_role || undefined,
			systemPrompt: row.system_prompt || undefined,
			tags: JSON.parse(row.tags),
			size: row.size,
			compressed: Boolean(row.compressed),
		};
	}

	/** Delete a bundle */
	deleteBundle(id: string): boolean {
		const result = this.db.prepare("DELETE FROM bundles WHERE id = ?").run(id);
		return result.changes > 0;
	}

	/** Start auto-capture timer */
	startAutoCapture(): void {
		if (this.captureTimer) return;

		this.captureTimer = setInterval(async () => {
			try {
				await this.quickCapture(`auto-${Date.now()}`);
			} catch {
				// Ignore auto-capture errors
			}
		}, this.config.captureInterval);
	}

	/** Stop auto-capture timer */
	stopAutoCapture(): void {
		if (this.captureTimer) {
			clearInterval(this.captureTimer);
			this.captureTimer = null;
		}
	}

	/** Close database */
	close(): void {
		this.stopAutoCapture();
		this.db.close();
	}
}

// =============================================================================
// Factory
// =============================================================================

let bundleSystemInstance: ContextBundleSystem | null = null;

export function getBundleSystem(workingDir: string, config?: Partial<BundleConfig>): ContextBundleSystem {
	if (!bundleSystemInstance) {
		bundleSystemInstance = new ContextBundleSystem(workingDir, config);
	}
	return bundleSystemInstance;
}

export function resetBundleSystem(): void {
	if (bundleSystemInstance) {
		bundleSystemInstance.close();
		bundleSystemInstance = null;
	}
}
