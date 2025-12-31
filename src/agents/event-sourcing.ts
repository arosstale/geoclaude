/**
 * Class 3.49: Event Sourcing System
 * TAC Pattern: Event store with snapshots and projections
 *
 * Features:
 * - Append-only event log
 * - Stream per aggregate
 * - Snapshots for performance
 * - Projections (read models)
 * - Event replay
 * - Versioning
 * - Causation/Correlation IDs
 * - Subscriptions
 */

import Database from "better-sqlite3";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type EventCategory = "domain" | "integration" | "system" | "audit" | "custom";
export type AggregateType = "user" | "session" | "agent" | "task" | "workflow" | "document" | "custom";
export type SubscriptionMode = "live" | "catch_up" | "persistent";
export type ProjectionStatus = "running" | "paused" | "rebuilding" | "failed";

export interface DomainEvent<T = unknown> {
	id: string;
	streamId: string;
	aggregateType: AggregateType;
	aggregateId: string;
	eventType: string;
	eventCategory: EventCategory;
	version: number;
	data: T;
	metadata: EventMetadata;
	timestamp: Date;
	hash?: string;
}

export interface EventMetadata {
	correlationId?: string;
	causationId?: string;
	userId?: string;
	agentId?: string;
	sessionId?: string;
	source?: string;
	schemaVersion?: number;
	tags?: string[];
	custom?: Record<string, unknown>;
}

export interface EventStream {
	id: string;
	aggregateType: AggregateType;
	aggregateId: string;
	version: number;
	createdAt: Date;
	updatedAt: Date;
	snapshotVersion?: number;
	metadata?: Record<string, unknown>;
}

export interface Snapshot<T = unknown> {
	id: string;
	streamId: string;
	aggregateType: AggregateType;
	aggregateId: string;
	version: number;
	state: T;
	createdAt: Date;
	hash?: string;
}

export interface Projection {
	id: string;
	name: string;
	status: ProjectionStatus;
	lastEventId?: string;
	lastEventVersion?: number;
	lastProcessedAt?: Date;
	checkpoint: number;
	errorMessage?: string;
	createdAt: Date;
	updatedAt: Date;
	metadata?: Record<string, unknown>;
}

export interface ProjectionHandler<T = unknown> {
	name: string;
	eventTypes: string[];
	handle: (event: DomainEvent, state: T | null) => T;
	init?: () => T;
}

export interface Subscription {
	id: string;
	name: string;
	mode: SubscriptionMode;
	streamFilter?: string;
	eventTypeFilter?: string[];
	fromPosition?: number;
	handler: (event: DomainEvent) => Promise<void>;
	checkpoint: number;
	isActive: boolean;
	createdAt: Date;
	lastEventAt?: Date;
	processedCount: number;
	errorCount: number;
	metadata?: Record<string, unknown>;
}

export interface EventQuery {
	streamId?: string;
	aggregateType?: AggregateType;
	aggregateId?: string;
	eventTypes?: string[];
	categories?: EventCategory[];
	correlationId?: string;
	causationId?: string;
	fromVersion?: number;
	toVersion?: number;
	fromTimestamp?: Date;
	toTimestamp?: Date;
	limit?: number;
	offset?: number;
}

export interface StreamQuery {
	aggregateType?: AggregateType;
	updatedAfter?: Date;
	hasSnapshot?: boolean;
	limit?: number;
	offset?: number;
}

export interface EventStoreStats {
	totalEvents: number;
	totalStreams: number;
	totalSnapshots: number;
	totalProjections: number;
	activeSubscriptions: number;
	eventsLast24h: number;
	eventsPerSecond: number;
	avgEventsPerStream: number;
	oldestEvent?: Date;
	newestEvent?: Date;
}

export interface AppendResult {
	success: boolean;
	event?: DomainEvent;
	error?: string;
	newVersion: number;
}

export interface ReplayResult {
	success: boolean;
	processedCount: number;
	fromVersion: number;
	toVersion: number;
	duration: number;
	errors: string[];
}

export interface EventSourcingConfig {
	dataDir: string;
	enableHashing: boolean;
	snapshotInterval: number; // Create snapshot every N events
	maxEventsPerQuery: number;
	retentionDays?: number;
	enableProjections: boolean;
	projectionBatchSize: number;
}

// ============================================================================
// Event Store System
// ============================================================================

export class EventStore extends EventEmitter {
	private db: Database.Database;
	private config: EventSourcingConfig;
	private subscriptions: Map<string, Subscription> = new Map();
	private projections: Map<string, ProjectionHandler> = new Map();
	private projectionStates: Map<string, unknown> = new Map();
	private subscriptionIntervals: Map<string, NodeJS.Timeout> = new Map();
	private projectionInterval: NodeJS.Timeout | null = null;
	private eventBuffer: DomainEvent[] = [];
	private lastEventTime = Date.now();
	private eventCountLast24h = 0;

	constructor(config: EventSourcingConfig) {
		super();
		this.config = config;
		this.db = new Database(join(config.dataDir, "event_store.db"));
		this.initializeDatabase();
		this.loadProjections();
		if (config.enableProjections) {
			this.startProjectionProcessor();
		}
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Event streams table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_streams (
        id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        snapshot_version INTEGER,
        metadata TEXT,
        UNIQUE(aggregate_type, aggregate_id)
      )
    `);

		// Events table (append-only)
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_category TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        metadata TEXT,
        timestamp TEXT NOT NULL,
        hash TEXT,
        FOREIGN KEY (stream_id) REFERENCES event_streams(id),
        UNIQUE(stream_id, version)
      )
    `);

		// Snapshots table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        hash TEXT,
        FOREIGN KEY (stream_id) REFERENCES event_streams(id)
      )
    `);

		// Projections table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS projections (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        last_event_id TEXT,
        last_event_version INTEGER,
        last_processed_at TEXT,
        checkpoint INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

		// Projection states table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS projection_states (
        projection_id TEXT NOT NULL,
        key TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (projection_id, key),
        FOREIGN KEY (projection_id) REFERENCES projections(id)
      )
    `);

		// Subscriptions checkpoint table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_checkpoints (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        checkpoint INTEGER NOT NULL DEFAULT 0,
        last_event_at TEXT,
        processed_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

		// Global sequence for event ordering
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_sequence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_category ON events(event_category);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_type, aggregate_id);
      CREATE INDEX IF NOT EXISTS idx_streams_aggregate ON event_streams(aggregate_type, aggregate_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_stream ON snapshots(stream_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_version ON snapshots(stream_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_sequence_id ON event_sequence(id);
    `);
	}

	private loadProjections(): void {
		const stmt = this.db.prepare("SELECT * FROM projections WHERE status != 'failed'");
		const rows = stmt.all() as Record<string, unknown>[];

		for (const row of rows) {
			// Load projection state if exists
			const stateStmt = this.db.prepare("SELECT state FROM projection_states WHERE projection_id = ?");
			const stateRows = stateStmt.all(row.id) as { state: string }[];

			if (stateRows.length > 0) {
				this.projectionStates.set(row.id as string, JSON.parse(stateRows[0].state));
			}
		}
	}

	private startProjectionProcessor(): void {
		this.projectionInterval = setInterval(() => {
			this.processProjections();
		}, 1000); // Process projections every second
	}

	private async processProjections(): Promise<void> {
		for (const [name, handler] of this.projections) {
			const projection = this.getProjection(name);
			if (!projection || projection.status !== "running") continue;

			try {
				const events = this.queryEvents({
					eventTypes: handler.eventTypes,
					fromVersion: projection.checkpoint,
					limit: this.config.projectionBatchSize,
				});

				if (events.length === 0) continue;

				let state: unknown = this.projectionStates.get(projection.id) ?? handler.init?.() ?? null;

				for (const event of events) {
					state = handler.handle(event, state as null);
				}

				this.projectionStates.set(projection.id, state);

				const lastEvent = events[events.length - 1];
				this.updateProjectionCheckpoint(projection.id, {
					lastEventId: lastEvent.id,
					lastEventVersion: lastEvent.version,
					checkpoint: this.getGlobalPosition(lastEvent.id),
				});

				// Save projection state
				this.saveProjectionState(projection.id, state);
			} catch (error) {
				this.updateProjectionStatus(projection.id, "failed", String(error));
				this.emit("projection:error", { name, error });
			}
		}
	}

	// ============================================================================
	// Stream Management
	// ============================================================================

	getOrCreateStream(aggregateType: AggregateType, aggregateId: string): EventStream {
		const existingStmt = this.db.prepare(`
      SELECT * FROM event_streams WHERE aggregate_type = ? AND aggregate_id = ?
    `);
		const existing = existingStmt.get(aggregateType, aggregateId) as Record<string, unknown> | undefined;

		if (existing) {
			return this.rowToStream(existing);
		}

		const id = `stream_${aggregateType}_${aggregateId}`;
		const now = new Date();

		const insertStmt = this.db.prepare(`
      INSERT INTO event_streams (id, aggregate_type, aggregate_id, version, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `);

		insertStmt.run(id, aggregateType, aggregateId, now.toISOString(), now.toISOString());

		const stream: EventStream = {
			id,
			aggregateType,
			aggregateId,
			version: 0,
			createdAt: now,
			updatedAt: now,
		};

		this.emit("stream:created", stream);
		return stream;
	}

	getStream(streamId: string): EventStream | null {
		const stmt = this.db.prepare("SELECT * FROM event_streams WHERE id = ?");
		const row = stmt.get(streamId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToStream(row);
	}

	getStreamByAggregate(aggregateType: AggregateType, aggregateId: string): EventStream | null {
		const stmt = this.db.prepare(`
      SELECT * FROM event_streams WHERE aggregate_type = ? AND aggregate_id = ?
    `);
		const row = stmt.get(aggregateType, aggregateId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToStream(row);
	}

	queryStreams(query: StreamQuery): EventStream[] {
		let sql = "SELECT * FROM event_streams WHERE 1=1";
		const params: unknown[] = [];

		if (query.aggregateType) {
			sql += " AND aggregate_type = ?";
			params.push(query.aggregateType);
		}
		if (query.updatedAfter) {
			sql += " AND updated_at > ?";
			params.push(query.updatedAfter.toISOString());
		}
		if (query.hasSnapshot !== undefined) {
			if (query.hasSnapshot) {
				sql += " AND snapshot_version IS NOT NULL";
			} else {
				sql += " AND snapshot_version IS NULL";
			}
		}

		sql += " ORDER BY updated_at DESC";

		if (query.limit) {
			sql += " LIMIT ?";
			params.push(query.limit);
		}
		if (query.offset) {
			sql += " OFFSET ?";
			params.push(query.offset);
		}

		const stmt = this.db.prepare(sql);
		const rows = stmt.all(...params) as Record<string, unknown>[];

		return rows.map((row) => this.rowToStream(row));
	}

	private rowToStream(row: Record<string, unknown>): EventStream {
		return {
			id: row.id as string,
			aggregateType: row.aggregate_type as AggregateType,
			aggregateId: row.aggregate_id as string,
			version: row.version as number,
			createdAt: new Date(row.created_at as string),
			updatedAt: new Date(row.updated_at as string),
			snapshotVersion: row.snapshot_version as number | undefined,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		};
	}

	// ============================================================================
	// Event Appending
	// ============================================================================

	append<T>(params: {
		aggregateType: AggregateType;
		aggregateId: string;
		eventType: string;
		eventCategory?: EventCategory;
		data: T;
		metadata?: Partial<EventMetadata>;
		expectedVersion?: number;
	}): AppendResult {
		const stream = this.getOrCreateStream(params.aggregateType, params.aggregateId);

		// Optimistic concurrency check
		if (params.expectedVersion !== undefined && stream.version !== params.expectedVersion) {
			return {
				success: false,
				error: `Concurrency conflict: expected version ${params.expectedVersion}, but stream is at version ${stream.version}`,
				newVersion: stream.version,
			};
		}

		const newVersion = stream.version + 1;
		const id = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const timestamp = new Date();

		const metadata: EventMetadata = {
			...params.metadata,
			schemaVersion: params.metadata?.schemaVersion ?? 1,
		};

		const event: DomainEvent<T> = {
			id,
			streamId: stream.id,
			aggregateType: params.aggregateType,
			aggregateId: params.aggregateId,
			eventType: params.eventType,
			eventCategory: params.eventCategory ?? "domain",
			version: newVersion,
			data: params.data,
			metadata,
			timestamp,
		};

		// Generate hash if enabled
		if (this.config.enableHashing) {
			event.hash = this.generateEventHash(event);
		}

		const transaction = this.db.transaction(() => {
			// Insert event
			const eventStmt = this.db.prepare(`
        INSERT INTO events
        (id, stream_id, aggregate_type, aggregate_id, event_type, event_category, version, data, metadata, timestamp, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

			eventStmt.run(
				event.id,
				event.streamId,
				event.aggregateType,
				event.aggregateId,
				event.eventType,
				event.eventCategory,
				event.version,
				JSON.stringify(event.data),
				JSON.stringify(event.metadata),
				event.timestamp.toISOString(),
				event.hash ?? null,
			);

			// Update stream version
			const streamStmt = this.db.prepare(`
        UPDATE event_streams SET version = ?, updated_at = ? WHERE id = ?
      `);
			streamStmt.run(newVersion, timestamp.toISOString(), stream.id);

			// Add to global sequence
			const seqStmt = this.db.prepare(`
        INSERT INTO event_sequence (event_id, created_at) VALUES (?, ?)
      `);
			seqStmt.run(event.id, timestamp.toISOString());
		});

		try {
			transaction();
		} catch (error) {
			return {
				success: false,
				error: String(error),
				newVersion: stream.version,
			};
		}

		// Buffer event for subscriptions
		this.eventBuffer.push(event);
		this.eventCountLast24h++;
		this.lastEventTime = Date.now();

		this.emit("event:appended", event);

		// Process subscriptions immediately
		this.processSubscriptions(event);

		// Check if snapshot needed
		if (this.config.snapshotInterval > 0 && newVersion % this.config.snapshotInterval === 0) {
			this.emit("snapshot:needed", { streamId: stream.id, version: newVersion });
		}

		return {
			success: true,
			event,
			newVersion,
		};
	}

	appendMultiple<T>(params: {
		aggregateType: AggregateType;
		aggregateId: string;
		events: Array<{
			eventType: string;
			eventCategory?: EventCategory;
			data: T;
		}>;
		metadata?: Partial<EventMetadata>;
		expectedVersion?: number;
	}): AppendResult[] {
		const results: AppendResult[] = [];
		let currentExpectedVersion = params.expectedVersion;

		for (const evt of params.events) {
			const result = this.append({
				aggregateType: params.aggregateType,
				aggregateId: params.aggregateId,
				eventType: evt.eventType,
				eventCategory: evt.eventCategory,
				data: evt.data,
				metadata: params.metadata,
				expectedVersion: currentExpectedVersion,
			});

			results.push(result);

			if (!result.success) break;
			currentExpectedVersion = result.newVersion;
		}

		return results;
	}

	private generateEventHash(event: DomainEvent): string {
		const data = JSON.stringify({
			streamId: event.streamId,
			eventType: event.eventType,
			version: event.version,
			data: event.data,
			timestamp: event.timestamp.toISOString(),
		});
		return createHash("sha256").update(data).digest("hex");
	}

	// ============================================================================
	// Event Querying
	// ============================================================================

	queryEvents(query: EventQuery): DomainEvent[] {
		let sql = "SELECT * FROM events WHERE 1=1";
		const params: unknown[] = [];

		if (query.streamId) {
			sql += " AND stream_id = ?";
			params.push(query.streamId);
		}
		if (query.aggregateType) {
			sql += " AND aggregate_type = ?";
			params.push(query.aggregateType);
		}
		if (query.aggregateId) {
			sql += " AND aggregate_id = ?";
			params.push(query.aggregateId);
		}
		if (query.eventTypes && query.eventTypes.length > 0) {
			sql += ` AND event_type IN (${query.eventTypes.map(() => "?").join(",")})`;
			params.push(...query.eventTypes);
		}
		if (query.categories && query.categories.length > 0) {
			sql += ` AND event_category IN (${query.categories.map(() => "?").join(",")})`;
			params.push(...query.categories);
		}
		if (query.correlationId) {
			sql += " AND json_extract(metadata, '$.correlationId') = ?";
			params.push(query.correlationId);
		}
		if (query.causationId) {
			sql += " AND json_extract(metadata, '$.causationId') = ?";
			params.push(query.causationId);
		}
		if (query.fromVersion !== undefined) {
			sql += " AND version >= ?";
			params.push(query.fromVersion);
		}
		if (query.toVersion !== undefined) {
			sql += " AND version <= ?";
			params.push(query.toVersion);
		}
		if (query.fromTimestamp) {
			sql += " AND timestamp >= ?";
			params.push(query.fromTimestamp.toISOString());
		}
		if (query.toTimestamp) {
			sql += " AND timestamp <= ?";
			params.push(query.toTimestamp.toISOString());
		}

		sql += " ORDER BY version ASC";

		const limit = Math.min(query.limit ?? this.config.maxEventsPerQuery, this.config.maxEventsPerQuery);
		sql += " LIMIT ?";
		params.push(limit);

		if (query.offset) {
			sql += " OFFSET ?";
			params.push(query.offset);
		}

		const stmt = this.db.prepare(sql);
		const rows = stmt.all(...params) as Record<string, unknown>[];

		return rows.map((row) => this.rowToEvent(row));
	}

	getEvent(eventId: string): DomainEvent | null {
		const stmt = this.db.prepare("SELECT * FROM events WHERE id = ?");
		const row = stmt.get(eventId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToEvent(row);
	}

	getStreamEvents(streamId: string, fromVersion?: number, toVersion?: number): DomainEvent[] {
		return this.queryEvents({
			streamId,
			fromVersion,
			toVersion,
		});
	}

	getEventsByCorrelation(correlationId: string): DomainEvent[] {
		return this.queryEvents({ correlationId });
	}

	getEventsByCausation(causationId: string): DomainEvent[] {
		return this.queryEvents({ causationId });
	}

	private rowToEvent(row: Record<string, unknown>): DomainEvent {
		return {
			id: row.id as string,
			streamId: row.stream_id as string,
			aggregateType: row.aggregate_type as AggregateType,
			aggregateId: row.aggregate_id as string,
			eventType: row.event_type as string,
			eventCategory: row.event_category as EventCategory,
			version: row.version as number,
			data: JSON.parse(row.data as string),
			metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
			timestamp: new Date(row.timestamp as string),
			hash: row.hash as string | undefined,
		};
	}

	// ============================================================================
	// Snapshots
	// ============================================================================

	createSnapshot<T>(params: { streamId: string; state: T }): Snapshot<T> {
		const stream = this.getStream(params.streamId);
		if (!stream) {
			throw new Error(`Stream ${params.streamId} not found`);
		}

		const id = `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		const snapshot: Snapshot<T> = {
			id,
			streamId: params.streamId,
			aggregateType: stream.aggregateType,
			aggregateId: stream.aggregateId,
			version: stream.version,
			state: params.state,
			createdAt: now,
		};

		// Generate hash if enabled
		if (this.config.enableHashing) {
			snapshot.hash = createHash("sha256")
				.update(JSON.stringify({ state: params.state, version: stream.version }))
				.digest("hex");
		}

		const transaction = this.db.transaction(() => {
			const stmt = this.db.prepare(`
        INSERT INTO snapshots
        (id, stream_id, aggregate_type, aggregate_id, version, state, created_at, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

			stmt.run(
				snapshot.id,
				snapshot.streamId,
				snapshot.aggregateType,
				snapshot.aggregateId,
				snapshot.version,
				JSON.stringify(snapshot.state),
				snapshot.createdAt.toISOString(),
				snapshot.hash ?? null,
			);

			// Update stream's snapshot version
			const updateStmt = this.db.prepare(`
        UPDATE event_streams SET snapshot_version = ? WHERE id = ?
      `);
			updateStmt.run(snapshot.version, params.streamId);
		});

		transaction();
		this.emit("snapshot:created", snapshot);
		return snapshot;
	}

	getLatestSnapshot<T>(streamId: string): Snapshot<T> | null {
		const stmt = this.db.prepare(`
      SELECT * FROM snapshots WHERE stream_id = ? ORDER BY version DESC LIMIT 1
    `);
		const row = stmt.get(streamId) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToSnapshot<T>(row);
	}

	getSnapshotAtVersion<T>(streamId: string, version: number): Snapshot<T> | null {
		const stmt = this.db.prepare(`
      SELECT * FROM snapshots WHERE stream_id = ? AND version <= ? ORDER BY version DESC LIMIT 1
    `);
		const row = stmt.get(streamId, version) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToSnapshot<T>(row);
	}

	deleteOldSnapshots(streamId: string, keepCount: number = 3): number {
		const stmt = this.db.prepare(`
      DELETE FROM snapshots WHERE stream_id = ? AND id NOT IN (
        SELECT id FROM snapshots WHERE stream_id = ? ORDER BY version DESC LIMIT ?
      )
    `);
		const result = stmt.run(streamId, streamId, keepCount);
		return result.changes;
	}

	private rowToSnapshot<T>(row: Record<string, unknown>): Snapshot<T> {
		return {
			id: row.id as string,
			streamId: row.stream_id as string,
			aggregateType: row.aggregate_type as AggregateType,
			aggregateId: row.aggregate_id as string,
			version: row.version as number,
			state: JSON.parse(row.state as string),
			createdAt: new Date(row.created_at as string),
			hash: row.hash as string | undefined,
		};
	}

	// ============================================================================
	// Replay
	// ============================================================================

	replayStream<T>(params: {
		streamId: string;
		fromSnapshot?: boolean;
		toVersion?: number;
		reducer: (state: T, event: DomainEvent) => T;
		initialState: T;
	}): { state: T; version: number; eventsProcessed: number } {
		let state = params.initialState;
		let fromVersion = 0;

		// Start from snapshot if available and requested
		if (params.fromSnapshot) {
			const snapshot = this.getLatestSnapshot<T>(params.streamId);
			if (snapshot && (!params.toVersion || snapshot.version <= params.toVersion)) {
				state = snapshot.state;
				fromVersion = snapshot.version + 1;
			}
		}

		const events = this.getStreamEvents(params.streamId, fromVersion, params.toVersion);

		for (const event of events) {
			state = params.reducer(state, event);
		}

		return {
			state,
			version: events.length > 0 ? events[events.length - 1].version : fromVersion - 1,
			eventsProcessed: events.length,
		};
	}

	replayAll(params: {
		handler: (event: DomainEvent) => Promise<void>;
		fromPosition?: number;
		toPosition?: number;
		eventTypes?: string[];
		batchSize?: number;
	}): ReplayResult {
		const startTime = Date.now();
		const errors: string[] = [];
		let processedCount = 0;
		let fromVersion = params.fromPosition ?? 0;
		const batchSize = params.batchSize ?? 100;

		// Get events in batches
		while (true) {
			const events = this.queryEvents({
				eventTypes: params.eventTypes,
				fromVersion,
				limit: batchSize,
			});

			if (events.length === 0) break;

			for (const event of events) {
				try {
					// Note: This is synchronous wrapper for async handler
					// In production, use proper async handling
					params.handler(event);
					processedCount++;
				} catch (error) {
					errors.push(`Event ${event.id}: ${String(error)}`);
				}
				fromVersion = event.version + 1;

				if (params.toPosition && fromVersion > params.toPosition) break;
			}

			if (params.toPosition && fromVersion > params.toPosition) break;
		}

		return {
			success: errors.length === 0,
			processedCount,
			fromVersion: params.fromPosition ?? 0,
			toVersion: fromVersion - 1,
			duration: Date.now() - startTime,
			errors,
		};
	}

	// ============================================================================
	// Projections
	// ============================================================================

	registerProjection<T>(handler: ProjectionHandler<T>): Projection {
		// Check if projection exists
		let projection = this.getProjection(handler.name);

		if (!projection) {
			const id = `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			const now = new Date();

			const stmt = this.db.prepare(`
        INSERT INTO projections
        (id, name, status, checkpoint, created_at, updated_at)
        VALUES (?, ?, 'running', 0, ?, ?)
      `);

			stmt.run(id, handler.name, now.toISOString(), now.toISOString());

			projection = {
				id,
				name: handler.name,
				status: "running",
				checkpoint: 0,
				createdAt: now,
				updatedAt: now,
			};
		}

		this.projections.set(handler.name, handler as ProjectionHandler<unknown>);

		// Initialize state if needed
		if (!this.projectionStates.has(projection.id) && handler.init) {
			this.projectionStates.set(projection.id, handler.init());
		}

		this.emit("projection:registered", projection);
		return projection;
	}

	getProjection(name: string): Projection | null {
		const stmt = this.db.prepare("SELECT * FROM projections WHERE name = ?");
		const row = stmt.get(name) as Record<string, unknown> | undefined;

		if (!row) return null;
		return this.rowToProjection(row);
	}

	getProjectionState<T>(name: string): T | null {
		const projection = this.getProjection(name);
		if (!projection) return null;

		return (this.projectionStates.get(projection.id) as T) ?? null;
	}

	getAllProjections(): Projection[] {
		const stmt = this.db.prepare("SELECT * FROM projections ORDER BY name");
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => this.rowToProjection(row));
	}

	rebuildProjection(name: string): void {
		const projection = this.getProjection(name);
		if (!projection) {
			throw new Error(`Projection ${name} not found`);
		}

		const handler = this.projections.get(name);
		if (!handler) {
			throw new Error(`Projection handler for ${name} not registered`);
		}

		// Update status to rebuilding
		this.updateProjectionStatus(projection.id, "rebuilding");

		// Reset state and checkpoint
		const initialState = handler.init?.() ?? null;
		this.projectionStates.set(projection.id, initialState);

		const resetStmt = this.db.prepare(`
      UPDATE projections SET checkpoint = 0, last_event_id = NULL, last_event_version = NULL WHERE id = ?
    `);
		resetStmt.run(projection.id);

		// Set back to running
		this.updateProjectionStatus(projection.id, "running");

		this.emit("projection:rebuilt", { name });
	}

	private updateProjectionCheckpoint(
		projectionId: string,
		update: {
			lastEventId: string;
			lastEventVersion: number;
			checkpoint: number;
		},
	): void {
		const stmt = this.db.prepare(`
      UPDATE projections
      SET last_event_id = ?, last_event_version = ?, checkpoint = ?, last_processed_at = ?, updated_at = ?
      WHERE id = ?
    `);

		const now = new Date().toISOString();
		stmt.run(update.lastEventId, update.lastEventVersion, update.checkpoint, now, now, projectionId);
	}

	private updateProjectionStatus(projectionId: string, status: ProjectionStatus, errorMessage?: string): void {
		const stmt = this.db.prepare(`
      UPDATE projections SET status = ?, error_message = ?, updated_at = ? WHERE id = ?
    `);
		stmt.run(status, errorMessage ?? null, new Date().toISOString(), projectionId);
	}

	private saveProjectionState(projectionId: string, state: unknown): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO projection_states (projection_id, key, state, updated_at)
      VALUES (?, 'default', ?, ?)
    `);
		stmt.run(projectionId, JSON.stringify(state), new Date().toISOString());
	}

	private getGlobalPosition(eventId: string): number {
		const stmt = this.db.prepare("SELECT id FROM event_sequence WHERE event_id = ?");
		const row = stmt.get(eventId) as { id: number } | undefined;
		return row?.id ?? 0;
	}

	private rowToProjection(row: Record<string, unknown>): Projection {
		return {
			id: row.id as string,
			name: row.name as string,
			status: row.status as ProjectionStatus,
			lastEventId: row.last_event_id as string | undefined,
			lastEventVersion: row.last_event_version as number | undefined,
			lastProcessedAt: row.last_processed_at ? new Date(row.last_processed_at as string) : undefined,
			checkpoint: row.checkpoint as number,
			errorMessage: row.error_message as string | undefined,
			createdAt: new Date(row.created_at as string),
			updatedAt: new Date(row.updated_at as string),
			metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		};
	}

	// ============================================================================
	// Subscriptions
	// ============================================================================

	subscribe(params: {
		name: string;
		mode?: SubscriptionMode;
		streamFilter?: string;
		eventTypeFilter?: string[];
		fromPosition?: number;
		handler: (event: DomainEvent) => Promise<void>;
		metadata?: Record<string, unknown>;
	}): Subscription {
		const id = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date();

		// Load or create checkpoint
		let checkpoint = params.fromPosition ?? 0;
		const checkpointStmt = this.db.prepare("SELECT * FROM subscription_checkpoints WHERE name = ?");
		const existingCheckpoint = checkpointStmt.get(params.name) as Record<string, unknown> | undefined;

		if (existingCheckpoint) {
			checkpoint = existingCheckpoint.checkpoint as number;
		} else {
			const insertStmt = this.db.prepare(`
        INSERT INTO subscription_checkpoints (id, name, checkpoint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
			insertStmt.run(id, params.name, checkpoint, now.toISOString(), now.toISOString());
		}

		const subscription: Subscription = {
			id: (existingCheckpoint?.id as string) ?? id,
			name: params.name,
			mode: params.mode ?? "live",
			streamFilter: params.streamFilter,
			eventTypeFilter: params.eventTypeFilter,
			fromPosition: checkpoint,
			handler: params.handler,
			checkpoint,
			isActive: true,
			createdAt: now,
			processedCount: (existingCheckpoint?.processed_count as number) ?? 0,
			errorCount: (existingCheckpoint?.error_count as number) ?? 0,
			metadata: params.metadata,
		};

		this.subscriptions.set(params.name, subscription);

		// For catch-up mode, process historical events
		if (params.mode === "catch_up" || params.mode === "persistent") {
			this.processCatchUp(subscription);
		}

		this.emit("subscription:created", subscription);
		return subscription;
	}

	unsubscribe(name: string): boolean {
		const subscription = this.subscriptions.get(name);
		if (!subscription) return false;

		subscription.isActive = false;
		this.subscriptions.delete(name);

		const interval = this.subscriptionIntervals.get(name);
		if (interval) {
			clearInterval(interval);
			this.subscriptionIntervals.delete(name);
		}

		this.emit("subscription:removed", { name });
		return true;
	}

	getSubscription(name: string): Subscription | null {
		return this.subscriptions.get(name) ?? null;
	}

	getAllSubscriptions(): Subscription[] {
		return Array.from(this.subscriptions.values());
	}

	private async processCatchUp(subscription: Subscription): Promise<void> {
		const events = this.queryEvents({
			streamId: subscription.streamFilter,
			eventTypes: subscription.eventTypeFilter,
			fromVersion: subscription.checkpoint,
			limit: 100,
		});

		for (const event of events) {
			if (!subscription.isActive) break;

			try {
				await subscription.handler(event);
				subscription.checkpoint = event.version;
				subscription.processedCount++;
				subscription.lastEventAt = new Date();
				this.updateSubscriptionCheckpoint(subscription);
			} catch (error) {
				subscription.errorCount++;
				this.emit("subscription:error", { subscription, event, error });
			}
		}

		// Continue catching up if there are more events
		if (events.length === 100 && subscription.isActive) {
			setImmediate(() => this.processCatchUp(subscription));
		}
	}

	private async processSubscriptions(event: DomainEvent): Promise<void> {
		for (const subscription of this.subscriptions.values()) {
			if (!subscription.isActive) continue;

			// Check filters
			if (subscription.streamFilter && event.streamId !== subscription.streamFilter) continue;
			if (subscription.eventTypeFilter && !subscription.eventTypeFilter.includes(event.eventType)) continue;

			try {
				await subscription.handler(event);
				subscription.checkpoint = event.version;
				subscription.processedCount++;
				subscription.lastEventAt = new Date();
				this.updateSubscriptionCheckpoint(subscription);
			} catch (error) {
				subscription.errorCount++;
				this.emit("subscription:error", { subscription, event, error });
			}
		}
	}

	private updateSubscriptionCheckpoint(subscription: Subscription): void {
		const stmt = this.db.prepare(`
      UPDATE subscription_checkpoints
      SET checkpoint = ?, last_event_at = ?, processed_count = ?, error_count = ?, updated_at = ?
      WHERE name = ?
    `);

		stmt.run(
			subscription.checkpoint,
			subscription.lastEventAt?.toISOString() ?? null,
			subscription.processedCount,
			subscription.errorCount,
			new Date().toISOString(),
			subscription.name,
		);
	}

	// ============================================================================
	// Event Verification
	// ============================================================================

	verifyEventIntegrity(eventId: string): { valid: boolean; message: string } {
		const event = this.getEvent(eventId);
		if (!event) {
			return { valid: false, message: "Event not found" };
		}

		if (!event.hash) {
			return { valid: true, message: "No hash to verify (hashing was disabled)" };
		}

		const computedHash = this.generateEventHash(event);
		if (computedHash === event.hash) {
			return { valid: true, message: "Integrity verified" };
		}

		return { valid: false, message: "Hash mismatch - event may have been tampered with" };
	}

	verifyStreamIntegrity(streamId: string): { valid: boolean; errors: string[] } {
		const events = this.getStreamEvents(streamId);
		const errors: string[] = [];

		let expectedVersion = 1;
		for (const event of events) {
			// Check version sequence
			if (event.version !== expectedVersion) {
				errors.push(`Version gap: expected ${expectedVersion}, got ${event.version}`);
			}
			expectedVersion = event.version + 1;

			// Check hash if present
			if (event.hash) {
				const result = this.verifyEventIntegrity(event.id);
				if (!result.valid) {
					errors.push(`Event ${event.id}: ${result.message}`);
				}
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): EventStoreStats {
		const eventsStmt = this.db.prepare("SELECT COUNT(*) as count FROM events");
		const eventsResult = eventsStmt.get() as { count: number };

		const streamsStmt = this.db.prepare("SELECT COUNT(*) as count FROM event_streams");
		const streamsResult = streamsStmt.get() as { count: number };

		const snapshotsStmt = this.db.prepare("SELECT COUNT(*) as count FROM snapshots");
		const snapshotsResult = snapshotsStmt.get() as { count: number };

		const projectionsStmt = this.db.prepare("SELECT COUNT(*) as count FROM projections");
		const projectionsResult = projectionsStmt.get() as { count: number };

		const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const events24hStmt = this.db.prepare("SELECT COUNT(*) as count FROM events WHERE timestamp >= ?");
		const events24hResult = events24hStmt.get(last24h.toISOString()) as { count: number };

		const rangeStmt = this.db.prepare("SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM events");
		const rangeResult = rangeStmt.get() as { oldest: string | null; newest: string | null };

		const avgStmt = this.db.prepare("SELECT AVG(version) as avg FROM event_streams");
		const avgResult = avgStmt.get() as { avg: number | null };

		// Calculate events per second (over last minute)
		const timeSinceLastEvent = (Date.now() - this.lastEventTime) / 1000;
		const eventsPerSecond = timeSinceLastEvent > 60 ? 0 : this.eventBuffer.length / Math.max(1, timeSinceLastEvent);

		return {
			totalEvents: eventsResult.count,
			totalStreams: streamsResult.count,
			totalSnapshots: snapshotsResult.count,
			totalProjections: projectionsResult.count,
			activeSubscriptions: this.subscriptions.size,
			eventsLast24h: events24hResult.count,
			eventsPerSecond: Math.round(eventsPerSecond * 100) / 100,
			avgEventsPerStream: avgResult.avg ?? 0,
			oldestEvent: rangeResult.oldest ? new Date(rangeResult.oldest) : undefined,
			newestEvent: rangeResult.newest ? new Date(rangeResult.newest) : undefined,
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		// Stop projection processor
		if (this.projectionInterval) {
			clearInterval(this.projectionInterval);
			this.projectionInterval = null;
		}

		// Stop all subscription intervals
		for (const interval of this.subscriptionIntervals.values()) {
			clearInterval(interval);
		}
		this.subscriptionIntervals.clear();

		// Mark all subscriptions as inactive
		for (const subscription of this.subscriptions.values()) {
			subscription.isActive = false;
		}

		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let eventStoreInstance: EventStore | null = null;

export function getEventStore(config?: EventSourcingConfig): EventStore {
	if (!eventStoreInstance) {
		if (!config) {
			throw new Error("EventStore requires config on first initialization");
		}
		eventStoreInstance = new EventStore(config);
	}
	return eventStoreInstance;
}

export function resetEventStore(): void {
	if (eventStoreInstance) {
		eventStoreInstance.shutdown();
		eventStoreInstance = null;
	}
}
