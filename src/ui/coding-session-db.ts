/**
 * Coding Session Database
 *
 * SQLite-based persistence for coding sessions, enabling stateful
 * AI coding interactions with context preservation.
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { CodeSuggestion, CodingSession, ModelOption } from "./reacord-components.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionCreateInput {
	userId: string;
	channelId: string;
	model?: string;
	initialContext?: string[];
}

export interface SessionUpdateInput {
	model?: string;
	status?: "active" | "paused" | "completed";
	context?: string[];
}

export interface SuggestionCreateInput {
	sessionId: string;
	language: string;
	code: string;
	explanation?: string;
	filePath?: string;
	lineStart?: number;
	lineEnd?: number;
	diff?: string;
}

export interface MessageMapping {
	messageId: string;
	sessionId: string;
	suggestionId?: string;
	componentType: "code_review" | "model_selector" | "session_controls" | "diff_viewer" | "quick_actions";
	createdAt: Date;
}

// ============================================================================
// Database Schema
// ============================================================================

const SCHEMA = `
-- Coding Sessions
CREATE TABLE IF NOT EXISTS coding_sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	model TEXT NOT NULL DEFAULT 'gpt-4o',
	context TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'active',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Code Suggestions
CREATE TABLE IF NOT EXISTS code_suggestions (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	language TEXT NOT NULL,
	code TEXT NOT NULL,
	explanation TEXT,
	file_path TEXT,
	line_start INTEGER,
	line_end INTEGER,
	diff TEXT,
	status TEXT NOT NULL DEFAULT 'pending',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (session_id) REFERENCES coding_sessions(id) ON DELETE CASCADE
);

-- Message to Component Mappings (for button collectors)
CREATE TABLE IF NOT EXISTS message_mappings (
	message_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	suggestion_id TEXT,
	component_type TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (session_id) REFERENCES coding_sessions(id) ON DELETE CASCADE,
	FOREIGN KEY (suggestion_id) REFERENCES code_suggestions(id) ON DELETE SET NULL
);

-- User Preferences
CREATE TABLE IF NOT EXISTS user_coding_preferences (
	user_id TEXT PRIMARY KEY,
	default_model TEXT DEFAULT 'gpt-4o',
	auto_commit BOOLEAN DEFAULT 0,
	show_diffs BOOLEAN DEFAULT 1,
	syntax_theme TEXT DEFAULT 'monokai',
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user ON coding_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_channel ON coding_sessions(channel_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON coding_sessions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_session ON code_suggestions(session_id);
CREATE INDEX IF NOT EXISTS idx_mappings_session ON message_mappings(session_id);
`;

// ============================================================================
// CodingSessionDB Class
// ============================================================================

export class CodingSessionDB {
	private db: Database.Database;

	constructor(dbPath: string = "coding_sessions.db") {
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(SCHEMA);
	}

	// -------------------------------------------------------------------------
	// Session Methods
	// -------------------------------------------------------------------------

	createSession(input: SessionCreateInput): CodingSession {
		const id = randomUUID();
		const model = input.model || "gpt-4o";
		const context = JSON.stringify(input.initialContext || []);

		this.db
			.prepare(
				`INSERT INTO coding_sessions (id, user_id, channel_id, model, context)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(id, input.userId, input.channelId, model, context);

		return this.getSession(id)!;
	}

	getSession(id: string): CodingSession | null {
		const row = this.db.prepare("SELECT * FROM coding_sessions WHERE id = ?").get(id) as
			| {
					id: string;
					user_id: string;
					channel_id: string;
					model: string;
					context: string;
					status: string;
					created_at: string;
					updated_at: string;
			  }
			| undefined;

		if (!row) return null;

		return {
			id: row.id,
			userId: row.user_id,
			channelId: row.channel_id,
			model: row.model,
			context: JSON.parse(row.context),
			suggestions: this.getSuggestions(row.id),
			status: row.status as "active" | "paused" | "completed",
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
		};
	}

	getActiveSession(userId: string, channelId: string): CodingSession | null {
		const row = this.db
			.prepare(
				`SELECT id FROM coding_sessions
				 WHERE user_id = ? AND channel_id = ? AND status = 'active'
				 ORDER BY created_at DESC LIMIT 1`,
			)
			.get(userId, channelId) as { id: string } | undefined;

		return row ? this.getSession(row.id) : null;
	}

	updateSession(id: string, input: SessionUpdateInput): CodingSession | null {
		const updates: string[] = [];
		const values: unknown[] = [];

		if (input.model !== undefined) {
			updates.push("model = ?");
			values.push(input.model);
		}
		if (input.status !== undefined) {
			updates.push("status = ?");
			values.push(input.status);
		}
		if (input.context !== undefined) {
			updates.push("context = ?");
			values.push(JSON.stringify(input.context));
		}

		if (updates.length === 0) return this.getSession(id);

		updates.push("updated_at = CURRENT_TIMESTAMP");
		values.push(id);

		this.db.prepare(`UPDATE coding_sessions SET ${updates.join(", ")} WHERE id = ?`).run(...values);

		return this.getSession(id);
	}

	endSession(id: string): void {
		this.updateSession(id, { status: "completed" });
	}

	pauseSession(id: string): void {
		this.updateSession(id, { status: "paused" });
	}

	resumeSession(id: string): void {
		this.updateSession(id, { status: "active" });
	}

	addContext(id: string, contextItem: string): void {
		const session = this.getSession(id);
		if (session) {
			const newContext = [...session.context, contextItem];
			this.updateSession(id, { context: newContext });
		}
	}

	clearContext(id: string): void {
		this.updateSession(id, { context: [] });
	}

	listSessions(userId?: string, status?: string): CodingSession[] {
		let query = "SELECT id FROM coding_sessions WHERE 1=1";
		const params: unknown[] = [];

		if (userId) {
			query += " AND user_id = ?";
			params.push(userId);
		}
		if (status) {
			query += " AND status = ?";
			params.push(status);
		}

		query += " ORDER BY created_at DESC";

		const rows = this.db.prepare(query).all(...params) as { id: string }[];
		return rows.map((row) => this.getSession(row.id)!).filter(Boolean);
	}

	// -------------------------------------------------------------------------
	// Suggestion Methods
	// -------------------------------------------------------------------------

	createSuggestion(input: SuggestionCreateInput): CodeSuggestion {
		const id = randomUUID();

		this.db
			.prepare(
				`INSERT INTO code_suggestions
				 (id, session_id, language, code, explanation, file_path, line_start, line_end, diff)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.sessionId,
				input.language,
				input.code,
				input.explanation || null,
				input.filePath || null,
				input.lineStart || null,
				input.lineEnd || null,
				input.diff || null,
			);

		return this.getSuggestion(id)!;
	}

	getSuggestion(id: string): CodeSuggestion | null {
		const row = this.db.prepare("SELECT * FROM code_suggestions WHERE id = ?").get(id) as
			| {
					id: string;
					language: string;
					code: string;
					explanation: string | null;
					file_path: string | null;
					line_start: number | null;
					line_end: number | null;
					diff: string | null;
			  }
			| undefined;

		if (!row) return null;

		return {
			id: row.id,
			language: row.language,
			code: row.code,
			explanation: row.explanation || undefined,
			filePath: row.file_path || undefined,
			lineStart: row.line_start || undefined,
			lineEnd: row.line_end || undefined,
			diff: row.diff || undefined,
		};
	}

	getSuggestions(sessionId: string): CodeSuggestion[] {
		const rows = this.db
			.prepare("SELECT id FROM code_suggestions WHERE session_id = ? ORDER BY created_at ASC")
			.all(sessionId) as { id: string }[];

		return rows.map((row) => this.getSuggestion(row.id)!).filter(Boolean);
	}

	updateSuggestionStatus(id: string, status: "pending" | "accepted" | "rejected"): void {
		this.db.prepare("UPDATE code_suggestions SET status = ? WHERE id = ?").run(status, id);
	}

	updateSuggestion(
		id: string,
		updates: { code?: string; status?: "pending" | "accepted" | "rejected"; explanation?: string },
	): void {
		const sets: string[] = [];
		const values: (string | null)[] = [];

		if (updates.code !== undefined) {
			sets.push("code = ?");
			values.push(updates.code);
		}
		if (updates.status !== undefined) {
			sets.push("status = ?");
			values.push(updates.status);
		}
		if (updates.explanation !== undefined) {
			sets.push("explanation = ?");
			values.push(updates.explanation);
		}

		if (sets.length === 0) return;

		values.push(id);
		this.db.prepare(`UPDATE code_suggestions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
	}

	// -------------------------------------------------------------------------
	// Message Mapping Methods (for Button Collectors)
	// -------------------------------------------------------------------------

	createMessageMapping(mapping: Omit<MessageMapping, "createdAt">): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO message_mappings (message_id, session_id, suggestion_id, component_type)
				 VALUES (?, ?, ?, ?)`,
			)
			.run(mapping.messageId, mapping.sessionId, mapping.suggestionId || null, mapping.componentType);
	}

	getMessageMapping(messageId: string): MessageMapping | null {
		const row = this.db.prepare("SELECT * FROM message_mappings WHERE message_id = ?").get(messageId) as
			| {
					message_id: string;
					session_id: string;
					suggestion_id: string | null;
					component_type: string;
					created_at: string;
			  }
			| undefined;

		if (!row) return null;

		return {
			messageId: row.message_id,
			sessionId: row.session_id,
			suggestionId: row.suggestion_id || undefined,
			componentType: row.component_type as MessageMapping["componentType"],
			createdAt: new Date(row.created_at),
		};
	}

	deleteMessageMapping(messageId: string): void {
		this.db.prepare("DELETE FROM message_mappings WHERE message_id = ?").run(messageId);
	}

	// -------------------------------------------------------------------------
	// User Preferences Methods
	// -------------------------------------------------------------------------

	getUserPreferences(userId: string): {
		defaultModel: string;
		autoCommit: boolean;
		showDiffs: boolean;
		syntaxTheme: string;
	} {
		const row = this.db.prepare("SELECT * FROM user_coding_preferences WHERE user_id = ?").get(userId) as
			| {
					default_model: string;
					auto_commit: number;
					show_diffs: number;
					syntax_theme: string;
			  }
			| undefined;

		return {
			defaultModel: row?.default_model || "gpt-4o",
			autoCommit: row?.auto_commit === 1,
			showDiffs: row?.show_diffs !== 0,
			syntaxTheme: row?.syntax_theme || "monokai",
		};
	}

	setUserPreferences(
		userId: string,
		prefs: Partial<{
			defaultModel: string;
			autoCommit: boolean;
			showDiffs: boolean;
			syntaxTheme: string;
		}>,
	): void {
		const existing = this.getUserPreferences(userId);
		const merged = { ...existing, ...prefs };

		this.db
			.prepare(
				`INSERT OR REPLACE INTO user_coding_preferences
				 (user_id, default_model, auto_commit, show_diffs, syntax_theme, updated_at)
				 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
			)
			.run(userId, merged.defaultModel, merged.autoCommit ? 1 : 0, merged.showDiffs ? 1 : 0, merged.syntaxTheme);
	}

	// -------------------------------------------------------------------------
	// Cleanup Methods
	// -------------------------------------------------------------------------

	cleanupOldSessions(daysOld: number = 7): number {
		const result = this.db
			.prepare(
				`DELETE FROM coding_sessions
				 WHERE status = 'completed'
				 AND updated_at < datetime('now', '-' || ? || ' days')`,
			)
			.run(daysOld);

		return result.changes;
	}

	close(): void {
		this.db.close();
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sessionDB: CodingSessionDB | null = null;

export function getCodingSessionDB(dbPath?: string): CodingSessionDB {
	if (!sessionDB) {
		sessionDB = new CodingSessionDB(dbPath);
	}
	return sessionDB;
}

export function closeCodingSessionDB(): void {
	if (sessionDB) {
		sessionDB.close();
		sessionDB = null;
	}
}
