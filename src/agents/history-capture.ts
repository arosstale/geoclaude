/**
 * Universal Output Capture System (UOCS)
 * Automatic history capture for all agent outputs with semantic categorization
 */

import * as fs from "fs/promises";
import * as path from "path";

export type CaptureType = "FEATURE" | "BUG" | "LEARNING" | "RESEARCH" | "DECISION" | "SESSION";

export interface HistoryEntry {
	id: string;
	captureType: CaptureType;
	timestamp: Date;
	agentId: string;
	content: string;
	metadata: {
		duration_minutes?: number;
		files_changed?: string[];
		technologies?: string[];
		status: "completed" | "blocked" | "partial";
		tags: string[];
	};
}

interface CaptureMetadata {
	duration_minutes?: number;
	files_changed?: string[];
	technologies?: string[];
	status?: "completed" | "blocked" | "partial";
	tags?: string[];
	[key: string]: unknown;
}

export class HistoryCaptureService {
	private dataDir: string;
	private learningKeywords = [
		"learned",
		"realized",
		"discovered",
		"insight",
		"pattern",
		"understanding",
		"breakthrough",
		"aha",
	];

	constructor(dataDir: string) {
		this.dataDir = dataDir;
	}

	/**
	 * Initialize directory structure
	 */
	async initialize(): Promise<void> {
		const now = new Date();
		const yearMonth = this.getYearMonth(now);

		const dirs = [
			`history/sessions/${yearMonth}`,
			`history/learnings/${yearMonth}`,
			`history/research/${yearMonth}`,
			`history/decisions/${yearMonth}`,
			`history/execution/features/${yearMonth}`,
			`history/execution/bugs/${yearMonth}`,
			`history/raw-outputs/${yearMonth}`,
		];

		for (const dir of dirs) {
			const fullPath = path.join(this.dataDir, dir);
			await fs.mkdir(fullPath, { recursive: true });
		}
	}

	/**
	 * Capture a full session output
	 */
	async captureSession(agentId: string, content: string, meta: CaptureMetadata = {}): Promise<HistoryEntry> {
		const entry = this.createEntry("SESSION", agentId, content, meta);
		await this.writeEntry(entry, "sessions");
		return entry;
	}

	/**
	 * Capture a learning/insight
	 */
	async captureLearning(agentId: string, insight: string, context: CaptureMetadata = {}): Promise<HistoryEntry> {
		const entry = this.createEntry("LEARNING", agentId, insight, context);
		await this.writeEntry(entry, "learnings");
		return entry;
	}

	/**
	 * Capture a decision with rationale
	 */
	async captureDecision(
		agentId: string,
		decision: string,
		rationale: string,
		meta: CaptureMetadata = {},
	): Promise<HistoryEntry> {
		const content = `# Decision\n\n${decision}\n\n## Rationale\n\n${rationale}`;
		const entry = this.createEntry("DECISION", agentId, content, meta);
		await this.writeEntry(entry, "decisions");
		return entry;
	}

	/**
	 * Capture research output
	 */
	async captureResearch(agentId: string, content: string, meta: CaptureMetadata = {}): Promise<HistoryEntry> {
		const entry = this.createEntry("RESEARCH", agentId, content, meta);
		await this.writeEntry(entry, "research");
		return entry;
	}

	/**
	 * Capture feature implementation
	 */
	async captureFeature(agentId: string, content: string, meta: CaptureMetadata = {}): Promise<HistoryEntry> {
		const entry = this.createEntry("FEATURE", agentId, content, meta);
		await this.writeEntry(entry, "execution/features");
		return entry;
	}

	/**
	 * Capture bug fix
	 */
	async captureBug(agentId: string, content: string, meta: CaptureMetadata = {}): Promise<HistoryEntry> {
		const entry = this.createEntry("BUG", agentId, content, meta);
		await this.writeEntry(entry, "execution/bugs");
		return entry;
	}

	/**
	 * Auto-categorize and capture content
	 */
	async autoCapture(agentId: string, content: string, meta: CaptureMetadata = {}): Promise<HistoryEntry> {
		const type = this.detectCaptureType(content, meta);

		switch (type) {
			case "LEARNING":
				return this.captureLearning(agentId, content, meta);
			case "DECISION":
				return this.captureDecision(agentId, content, "", meta);
			case "RESEARCH":
				return this.captureResearch(agentId, content, meta);
			case "BUG":
				return this.captureBug(agentId, content, meta);
			case "FEATURE":
				return this.captureFeature(agentId, content, meta);
			default:
				return this.captureSession(agentId, content, meta);
		}
	}

	/**
	 * Capture raw output to raw-outputs directory
	 */
	async captureRaw(agentId: string, content: string): Promise<string> {
		const now = new Date();
		const yearMonth = this.getYearMonth(now);
		const timestamp = this.formatTimestamp(now);
		const sanitized = this.sanitizeForFilename(agentId);

		const filename = `${timestamp}_${sanitized}_RAW.md`;
		const filePath = path.join(this.dataDir, "history", "raw-outputs", yearMonth, filename);

		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, content, "utf-8");

		return filePath;
	}

	/**
	 * Search history entries
	 */
	async search(
		query: string,
		filters?: {
			type?: CaptureType;
			agentId?: string;
			startDate?: Date;
			endDate?: Date;
			tags?: string[];
			status?: "completed" | "blocked" | "partial";
		},
	): Promise<HistoryEntry[]> {
		const results: HistoryEntry[] = [];
		const baseDir = path.join(this.dataDir, "history");

		const searchDirs = filters?.type
			? [this.getSubdirForType(filters.type)]
			: ["sessions", "learnings", "research", "decisions", "execution/features", "execution/bugs"];

		for (const subdir of searchDirs) {
			const dirPath = path.join(baseDir, subdir);
			try {
				await this.searchDirectory(dirPath, query, filters, results);
			} catch (_err) {}
		}

		return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
	}

	/**
	 * Get recent entries
	 */
	async getRecent(type?: CaptureType, limit: number = 10): Promise<HistoryEntry[]> {
		const results: HistoryEntry[] = [];
		const baseDir = path.join(this.dataDir, "history");

		const searchDirs = type
			? [this.getSubdirForType(type)]
			: ["sessions", "learnings", "research", "decisions", "execution/features", "execution/bugs"];

		for (const subdir of searchDirs) {
			const dirPath = path.join(baseDir, subdir);
			try {
				await this.collectRecentFromDir(dirPath, results);
			} catch (_err) {}
		}

		results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
		return results.slice(0, limit);
	}

	/**
	 * Get statistics
	 */
	async getStats(): Promise<{
		total: number;
		byType: Record<CaptureType, number>;
		byStatus: Record<string, number>;
		recentAgents: string[];
	}> {
		const all = await this.getRecent(undefined, 1000);

		const byType: Record<string, number> = {};
		const byStatus: Record<string, number> = {};
		const agents = new Set<string>();

		for (const entry of all) {
			byType[entry.captureType] = (byType[entry.captureType] || 0) + 1;
			byStatus[entry.metadata.status] = (byStatus[entry.metadata.status] || 0) + 1;
			agents.add(entry.agentId);
		}

		return {
			total: all.length,
			byType: byType as Record<CaptureType, number>,
			byStatus,
			recentAgents: Array.from(agents).slice(0, 10),
		};
	}

	// ============ PRIVATE METHODS ============

	private createEntry(type: CaptureType, agentId: string, content: string, meta: CaptureMetadata): HistoryEntry {
		const id = this.generateId();
		const timestamp = new Date();

		return {
			id,
			captureType: type,
			timestamp,
			agentId,
			content,
			metadata: {
				duration_minutes: meta.duration_minutes,
				files_changed: meta.files_changed || [],
				technologies: meta.technologies || [],
				status: meta.status || "completed",
				tags: meta.tags || [],
			},
		};
	}

	private async writeEntry(entry: HistoryEntry, subdir: string): Promise<void> {
		const yearMonth = this.getYearMonth(entry.timestamp);
		const timestamp = this.formatTimestamp(entry.timestamp);
		const sanitized = this.sanitizeForFilename(entry.agentId);
		const description = this.extractDescription(entry.content);

		const filename = `${timestamp}_${sanitized}_${entry.captureType}_${description}.md`;
		const filePath = path.join(this.dataDir, "history", subdir, yearMonth, filename);

		await fs.mkdir(path.dirname(filePath), { recursive: true });

		const frontmatter = this.generateFrontmatter(entry);
		const fullContent = `---\n${frontmatter}\n---\n\n${entry.content}`;

		await fs.writeFile(filePath, fullContent, "utf-8");
	}

	private generateFrontmatter(entry: HistoryEntry): string {
		const lines = [
			`id: ${entry.id}`,
			`type: ${entry.captureType}`,
			`timestamp: ${entry.timestamp.toISOString()}`,
			`agent: ${entry.agentId}`,
			`status: ${entry.metadata.status}`,
		];

		if (entry.metadata.duration_minutes) {
			lines.push(`duration_minutes: ${entry.metadata.duration_minutes}`);
		}

		if (entry.metadata.files_changed?.length) {
			lines.push(`files_changed:`);
			for (const file of entry.metadata.files_changed) {
				lines.push(`  - ${file}`);
			}
		}

		if (entry.metadata.technologies?.length) {
			lines.push(`technologies:`);
			for (const tech of entry.metadata.technologies) {
				lines.push(`  - ${tech}`);
			}
		}

		if (entry.metadata.tags?.length) {
			lines.push(`tags:`);
			for (const tag of entry.metadata.tags) {
				lines.push(`  - ${tag}`);
			}
		}

		return lines.join("\n");
	}

	private detectCaptureType(content: string, meta: CaptureMetadata): CaptureType {
		const lower = content.toLowerCase();

		// Explicit type from metadata
		if (meta.tags?.includes("learning")) return "LEARNING";
		if (meta.tags?.includes("decision")) return "DECISION";
		if (meta.tags?.includes("research")) return "RESEARCH";
		if (meta.tags?.includes("bug")) return "BUG";
		if (meta.tags?.includes("feature")) return "FEATURE";

		// Learning detection (2+ keywords)
		let learningScore = 0;
		for (const keyword of this.learningKeywords) {
			if (lower.includes(keyword)) learningScore++;
		}
		if (learningScore >= 2) return "LEARNING";

		// Decision detection
		if (lower.includes("decided") || lower.includes("choosing") || lower.includes("selected")) {
			return "DECISION";
		}

		// Research detection
		if (lower.includes("investigating") || lower.includes("analyzing") || lower.includes("exploring")) {
			return "RESEARCH";
		}

		// Bug detection
		if (lower.includes("fixed") || lower.includes("bug") || lower.includes("error")) {
			return "BUG";
		}

		// Feature detection
		if (lower.includes("implemented") || lower.includes("added") || lower.includes("created")) {
			return "FEATURE";
		}

		return "SESSION";
	}

	private getSubdirForType(type: CaptureType): string {
		switch (type) {
			case "SESSION":
				return "sessions";
			case "LEARNING":
				return "learnings";
			case "RESEARCH":
				return "research";
			case "DECISION":
				return "decisions";
			case "FEATURE":
				return "execution/features";
			case "BUG":
				return "execution/bugs";
		}
	}

	private async searchDirectory(dirPath: string, query: string, filters: any, results: HistoryEntry[]): Promise<void> {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory()) {
				await this.searchDirectory(fullPath, query, filters, results);
			} else if (entry.name.endsWith(".md")) {
				const content = await fs.readFile(fullPath, "utf-8");
				const parsed = this.parseEntry(content, fullPath);

				if (this.matchesFilters(parsed, query, filters)) {
					results.push(parsed);
				}
			}
		}
	}

	private async collectRecentFromDir(dirPath: string, results: HistoryEntry[]): Promise<void> {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory()) {
				await this.collectRecentFromDir(fullPath, results);
			} else if (entry.name.endsWith(".md")) {
				const content = await fs.readFile(fullPath, "utf-8");
				const parsed = this.parseEntry(content, fullPath);
				results.push(parsed);
			}
		}
	}

	private parseEntry(content: string, filePath: string): HistoryEntry {
		const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
		const metadata: any = {};

		if (frontmatterMatch) {
			const yaml = frontmatterMatch[1];
			const lines = yaml.split("\n");
			let currentKey: string | null = null;
			let currentArray: string[] = [];

			for (const line of lines) {
				if (line.startsWith("  - ")) {
					currentArray.push(line.substring(4).trim());
				} else if (line.includes(":")) {
					if (currentKey && currentArray.length > 0) {
						metadata[currentKey] = currentArray;
						currentArray = [];
					}

					const [key, ...valueParts] = line.split(":");
					const value = valueParts.join(":").trim();
					currentKey = key.trim();

					if (value) {
						metadata[currentKey] = value;
						currentKey = null;
					}
				}
			}

			if (currentKey && currentArray.length > 0) {
				metadata[currentKey] = currentArray;
			}
		}

		const bodyContent = frontmatterMatch ? content.substring(frontmatterMatch[0].length).trim() : content;

		return {
			id: metadata.id || path.basename(filePath, ".md"),
			captureType: (metadata.type || "SESSION") as CaptureType,
			timestamp: metadata.timestamp ? new Date(metadata.timestamp) : new Date(),
			agentId: metadata.agent || "unknown",
			content: bodyContent,
			metadata: {
				duration_minutes: metadata.duration_minutes ? parseInt(metadata.duration_minutes, 10) : undefined,
				files_changed: metadata.files_changed || [],
				technologies: metadata.technologies || [],
				status: metadata.status || "completed",
				tags: metadata.tags || [],
			},
		};
	}

	private matchesFilters(entry: HistoryEntry, query: string, filters?: any): boolean {
		if (query && !entry.content.toLowerCase().includes(query.toLowerCase())) {
			return false;
		}

		if (filters?.type && entry.captureType !== filters.type) {
			return false;
		}

		if (filters?.agentId && entry.agentId !== filters.agentId) {
			return false;
		}

		if (filters?.status && entry.metadata.status !== filters.status) {
			return false;
		}

		if (filters?.tags && !filters.tags.some((t: string) => entry.metadata.tags.includes(t))) {
			return false;
		}

		if (filters?.startDate && entry.timestamp < new Date(filters.startDate)) {
			return false;
		}

		if (filters?.endDate && entry.timestamp > new Date(filters.endDate)) {
			return false;
		}

		return true;
	}

	private generateId(): string {
		return `hist_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	private getYearMonth(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		return `${year}-${month}`;
	}

	private formatTimestamp(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hour = String(date.getHours()).padStart(2, "0");
		const minute = String(date.getMinutes()).padStart(2, "0");
		const second = String(date.getSeconds()).padStart(2, "0");
		return `${year}-${month}-${day}-${hour}${minute}${second}`;
	}

	private sanitizeForFilename(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.substring(0, 30);
	}

	private extractDescription(content: string): string {
		// Extract first line or first 50 chars
		const firstLine = content.split("\n")[0].trim();
		const clean = firstLine
			.replace(/^#+\s*/, "")
			.replace(/[^a-zA-Z0-9\s]/g, "")
			.trim();
		return this.sanitizeForFilename(clean || "output").substring(0, 30);
	}
}

// Singleton instance
let instance: HistoryCaptureService | null = null;

export function getHistoryCaptureService(dataDir: string): HistoryCaptureService {
	if (!instance) {
		instance = new HistoryCaptureService(dataDir);
	}
	return instance;
}

/**
 * Reset singleton (for testing)
 */
export function resetHistoryCaptureService(): void {
	instance = null;
}
