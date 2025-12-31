/**
 * File Reservations System - Advisory Leases for Multi-Agent Coordination
 *
 * Inspired by MCP Agent Mail's file reservation system.
 * Provides advisory locks to prevent agents from conflicting on file edits.
 *
 * Features:
 * - Exclusive vs shared reservation modes
 * - TTL-based automatic expiration
 * - Pattern matching (glob) for file paths
 * - Conflict detection and reporting
 * - Optional pre-commit hook enforcement
 * - Audit trail of all reservations
 */

import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { minimatch } from "minimatch";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export interface FileReservation {
	id: string;
	agentId: string;
	agentName: string;
	projectId: string;
	pathPattern: string; // Glob pattern (e.g., "src/trading/**/*.ts")
	exclusive: boolean; // true = no other agent can reserve overlapping paths
	reason: string;
	createdAt: string;
	expiresAt: string;
	releasedAt?: string;
	beadsIssueId?: string; // Optional task/issue reference
}

export interface ReservationConflict {
	requestedPattern: string;
	conflictingReservation: FileReservation;
	overlappingPaths: string[];
}

export interface ReservationResult {
	success: boolean;
	reservation?: FileReservation;
	conflicts?: ReservationConflict[];
	error?: string;
}

export interface ReservationQuery {
	agentId?: string;
	projectId?: string;
	pathPattern?: string;
	includeExpired?: boolean;
	includeReleased?: boolean;
}

// ============================================================================
// File Reservation Manager
// ============================================================================

export class FileReservationManager extends EventEmitter {
	private reservations: Map<string, FileReservation> = new Map();
	private dataDir: string;
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(dataDir: string = DEFAULT_DATA_DIR) {
		super();
		this.dataDir = dataDir;
		this.loadState();
		this.startCleanupTimer();
	}

	/**
	 * Generate unique reservation ID
	 */
	private generateId(): string {
		return `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	/**
	 * Load persisted state
	 */
	private loadState(): void {
		const statePath = join(this.dataDir, "file_reservations.json");
		if (existsSync(statePath)) {
			try {
				const data = JSON.parse(readFileSync(statePath, "utf-8"));
				for (const [id, reservation] of Object.entries(data)) {
					this.reservations.set(id, reservation as FileReservation);
				}
			} catch {
				// Ignore corrupt state
			}
		}
	}

	/**
	 * Persist state to disk
	 */
	private persist(): void {
		const statePath = join(this.dataDir, "file_reservations.json");
		const dir = dirname(statePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const data: Record<string, FileReservation> = {};
		for (const [id, reservation] of this.reservations) {
			data[id] = reservation;
		}
		writeFileSync(statePath, JSON.stringify(data, null, 2));
	}

	/**
	 * Start cleanup timer for expired reservations
	 */
	private startCleanupTimer(): void {
		// Clean up every 60 seconds
		this.cleanupInterval = setInterval(() => {
			this.cleanupExpired();
		}, 60000);
	}

	/**
	 * Clean up expired reservations
	 */
	private cleanupExpired(): void {
		const now = new Date().toISOString();
		let cleaned = 0;

		for (const [_id, reservation] of this.reservations) {
			if (!reservation.releasedAt && reservation.expiresAt < now) {
				reservation.releasedAt = now;
				cleaned++;
				this.emit("expired", reservation);
			}
		}

		if (cleaned > 0) {
			this.persist();
		}
	}

	/**
	 * Check if two glob patterns could match overlapping paths
	 */
	private patternsOverlap(pattern1: string, pattern2: string): boolean {
		// Simple overlap check - if either pattern matches the other's base
		// or they share common segments
		const p1Parts = pattern1.split("/").filter((p) => !p.includes("*"));
		const p2Parts = pattern2.split("/").filter((p) => !p.includes("*"));

		// Check if one is a prefix of the other
		const minLen = Math.min(p1Parts.length, p2Parts.length);
		for (let i = 0; i < minLen; i++) {
			if (p1Parts[i] !== p2Parts[i]) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Get active reservations (not expired and not released)
	 */
	getActiveReservations(query: ReservationQuery = {}): FileReservation[] {
		const now = new Date().toISOString();
		const results: FileReservation[] = [];

		for (const reservation of this.reservations.values()) {
			// Skip released unless requested
			if (reservation.releasedAt && !query.includeReleased) continue;

			// Skip expired unless requested
			if (reservation.expiresAt < now && !query.includeExpired) continue;

			// Filter by agent
			if (query.agentId && reservation.agentId !== query.agentId) continue;

			// Filter by project
			if (query.projectId && reservation.projectId !== query.projectId) continue;

			// Filter by path pattern overlap
			if (query.pathPattern && !this.patternsOverlap(query.pathPattern, reservation.pathPattern)) {
				continue;
			}

			results.push(reservation);
		}

		return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	/**
	 * Check for conflicts before reserving
	 */
	checkConflicts(agentId: string, projectId: string, pathPattern: string, exclusive: boolean): ReservationConflict[] {
		const conflicts: ReservationConflict[] = [];
		const activeReservations = this.getActiveReservations({ projectId });

		for (const reservation of activeReservations) {
			// Skip own reservations
			if (reservation.agentId === agentId) continue;

			// Check for pattern overlap
			if (!this.patternsOverlap(pathPattern, reservation.pathPattern)) continue;

			// Conflict if either reservation is exclusive
			if (exclusive || reservation.exclusive) {
				conflicts.push({
					requestedPattern: pathPattern,
					conflictingReservation: reservation,
					overlappingPaths: [pathPattern, reservation.pathPattern],
				});
			}
		}

		return conflicts;
	}

	/**
	 * Reserve file paths for editing
	 */
	reserve(
		agentId: string,
		agentName: string,
		projectId: string,
		pathPattern: string,
		options: {
			exclusive?: boolean;
			reason?: string;
			ttlMinutes?: number;
			beadsIssueId?: string;
			force?: boolean; // Ignore conflicts (admin use)
		} = {},
	): ReservationResult {
		const { exclusive = true, reason = "", ttlMinutes = 30, beadsIssueId, force = false } = options;

		// Check for conflicts
		const conflicts = this.checkConflicts(agentId, projectId, pathPattern, exclusive);

		if (conflicts.length > 0 && !force) {
			return {
				success: false,
				conflicts,
				error: `Conflicts with ${conflicts.length} existing reservation(s)`,
			};
		}

		// Create reservation
		const now = new Date();
		const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

		const reservation: FileReservation = {
			id: this.generateId(),
			agentId,
			agentName,
			projectId,
			pathPattern,
			exclusive,
			reason,
			createdAt: now.toISOString(),
			expiresAt: expiresAt.toISOString(),
			beadsIssueId,
		};

		this.reservations.set(reservation.id, reservation);
		this.persist();

		this.emit("reserved", reservation);

		return { success: true, reservation };
	}

	/**
	 * Release a reservation
	 */
	release(reservationId: string, agentId?: string): ReservationResult {
		const reservation = this.reservations.get(reservationId);

		if (!reservation) {
			return { success: false, error: `Reservation ${reservationId} not found` };
		}

		if (reservation.releasedAt) {
			return { success: false, error: "Reservation already released" };
		}

		// Check ownership (unless admin force release)
		if (agentId && reservation.agentId !== agentId) {
			return {
				success: false,
				error: `Not authorized to release reservation owned by ${reservation.agentName}`,
			};
		}

		reservation.releasedAt = new Date().toISOString();
		this.persist();

		this.emit("released", reservation);

		return { success: true, reservation };
	}

	/**
	 * Force release all reservations for an agent (admin use)
	 */
	forceReleaseAllForAgent(agentId: string): number {
		const now = new Date().toISOString();
		let released = 0;

		for (const reservation of this.reservations.values()) {
			if (reservation.agentId === agentId && !reservation.releasedAt) {
				reservation.releasedAt = now;
				released++;
				this.emit("released", reservation);
			}
		}

		if (released > 0) {
			this.persist();
		}

		return released;
	}

	/**
	 * Extend a reservation's TTL
	 */
	extend(reservationId: string, agentId: string, additionalMinutes: number): ReservationResult {
		const reservation = this.reservations.get(reservationId);

		if (!reservation) {
			return { success: false, error: `Reservation ${reservationId} not found` };
		}

		if (reservation.releasedAt) {
			return { success: false, error: "Cannot extend released reservation" };
		}

		if (reservation.agentId !== agentId) {
			return { success: false, error: "Not authorized to extend this reservation" };
		}

		const currentExpiry = new Date(reservation.expiresAt);
		const newExpiry = new Date(currentExpiry.getTime() + additionalMinutes * 60 * 1000);
		reservation.expiresAt = newExpiry.toISOString();

		this.persist();

		this.emit("extended", reservation);

		return { success: true, reservation };
	}

	/**
	 * Check if a file path conflicts with any active reservation
	 */
	checkPath(
		filePath: string,
		agentId: string,
		projectId: string,
	): {
		allowed: boolean;
		conflictingReservations: FileReservation[];
	} {
		const activeReservations = this.getActiveReservations({ projectId });
		const conflicts: FileReservation[] = [];

		for (const reservation of activeReservations) {
			// Own reservations are always allowed
			if (reservation.agentId === agentId) continue;

			// Check if path matches reservation pattern
			if (minimatch(filePath, reservation.pathPattern)) {
				if (reservation.exclusive) {
					conflicts.push(reservation);
				}
			}
		}

		return {
			allowed: conflicts.length === 0,
			conflictingReservations: conflicts,
		};
	}

	/**
	 * Get reservation statistics
	 */
	getStats(projectId?: string): {
		total: number;
		active: number;
		expired: number;
		released: number;
		byAgent: Record<string, number>;
	} {
		const now = new Date().toISOString();
		let total = 0;
		let active = 0;
		let expired = 0;
		let released = 0;
		const byAgent: Record<string, number> = {};

		for (const reservation of this.reservations.values()) {
			if (projectId && reservation.projectId !== projectId) continue;

			total++;

			if (reservation.releasedAt) {
				released++;
			} else if (reservation.expiresAt < now) {
				expired++;
			} else {
				active++;
			}

			const key = reservation.agentName;
			byAgent[key] = (byAgent[key] || 0) + 1;
		}

		return { total, active, expired, released, byAgent };
	}

	/**
	 * Dispose manager
	 */
	dispose(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
	}
}

// ============================================================================
// MCP-Compatible Tools
// ============================================================================

export function createFileReservationTools(manager: FileReservationManager) {
	return {
		file_reserve: {
			name: "file_reserve",
			description:
				"Reserve file paths for exclusive or shared editing. Prevents conflicts between agents working on same files. Uses glob patterns.",
			parameters: {
				type: "object",
				properties: {
					agent_id: { type: "string", description: "Your agent ID" },
					agent_name: { type: "string", description: "Your agent name" },
					project_id: { type: "string", description: "Project/channel ID" },
					path_pattern: {
						type: "string",
						description: "Glob pattern for files (e.g., 'src/trading/**/*.ts')",
					},
					exclusive: {
						type: "boolean",
						description: "If true, no other agent can reserve overlapping paths (default: true)",
					},
					reason: { type: "string", description: "Why you need this reservation" },
					ttl_minutes: {
						type: "number",
						description: "How long to hold reservation (default: 30)",
					},
				},
				required: ["agent_id", "agent_name", "project_id", "path_pattern"],
			},
			execute: async (args: {
				agent_id: string;
				agent_name: string;
				project_id: string;
				path_pattern: string;
				exclusive?: boolean;
				reason?: string;
				ttl_minutes?: number;
			}) => {
				const result = manager.reserve(args.agent_id, args.agent_name, args.project_id, args.path_pattern, {
					exclusive: args.exclusive,
					reason: args.reason,
					ttlMinutes: args.ttl_minutes,
				});
				return JSON.stringify(result);
			},
		},

		file_release: {
			name: "file_release",
			description: "Release a file reservation when done editing.",
			parameters: {
				type: "object",
				properties: {
					reservation_id: { type: "string", description: "Reservation ID to release" },
					agent_id: { type: "string", description: "Your agent ID (for verification)" },
				},
				required: ["reservation_id"],
			},
			execute: async (args: { reservation_id: string; agent_id?: string }) => {
				const result = manager.release(args.reservation_id, args.agent_id);
				return JSON.stringify(result);
			},
		},

		file_check_conflicts: {
			name: "file_check_conflicts",
			description: "Check if editing a file would conflict with existing reservations.",
			parameters: {
				type: "object",
				properties: {
					file_path: { type: "string", description: "File path to check" },
					agent_id: { type: "string", description: "Your agent ID" },
					project_id: { type: "string", description: "Project/channel ID" },
				},
				required: ["file_path", "agent_id", "project_id"],
			},
			execute: async (args: { file_path: string; agent_id: string; project_id: string }) => {
				const result = manager.checkPath(args.file_path, args.agent_id, args.project_id);
				return JSON.stringify(result);
			},
		},

		file_list_reservations: {
			name: "file_list_reservations",
			description: "List active file reservations in a project.",
			parameters: {
				type: "object",
				properties: {
					project_id: { type: "string", description: "Project/channel ID" },
					agent_id: { type: "string", description: "Filter by agent ID (optional)" },
				},
				required: ["project_id"],
			},
			execute: async (args: { project_id: string; agent_id?: string }) => {
				const reservations = manager.getActiveReservations({
					projectId: args.project_id,
					agentId: args.agent_id,
				});
				return JSON.stringify({
					count: reservations.length,
					reservations: reservations.map((r) => ({
						id: r.id,
						agent: r.agentName,
						pattern: r.pathPattern,
						exclusive: r.exclusive,
						reason: r.reason,
						expiresAt: r.expiresAt,
					})),
				});
			},
		},

		file_extend_reservation: {
			name: "file_extend_reservation",
			description: "Extend an existing reservation's expiration time.",
			parameters: {
				type: "object",
				properties: {
					reservation_id: { type: "string", description: "Reservation ID" },
					agent_id: { type: "string", description: "Your agent ID" },
					additional_minutes: { type: "number", description: "Minutes to add" },
				},
				required: ["reservation_id", "agent_id", "additional_minutes"],
			},
			execute: async (args: { reservation_id: string; agent_id: string; additional_minutes: number }) => {
				const result = manager.extend(args.reservation_id, args.agent_id, args.additional_minutes);
				return JSON.stringify(result);
			},
		},
	};
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: FileReservationManager | null = null;

export function getFileReservationManager(dataDir?: string): FileReservationManager {
	if (!instance) {
		instance = new FileReservationManager(dataDir);
	}
	return instance;
}

export function disposeFileReservationManager(): void {
	if (instance) {
		instance.dispose();
		instance = null;
	}
}

export default FileReservationManager;
