/**
 * Class 3.57: API Gateway System
 * TAC Pattern: Centralized API gateway with routing, auth, and request management
 *
 * Features:
 * - Route registration with path patterns (wildcards, params)
 * - HTTP method matching
 * - Request/response transformation
 * - Authentication middleware hooks
 * - Authorization/permission checks
 * - Rate limiting per route/client
 * - Request validation (schema-based)
 * - Response caching
 * - Request logging/auditing
 * - Error handling and formatting
 * - Timeout per route
 * - Retry configuration
 * - Backend service mapping
 * - API versioning support
 * - CORS configuration
 * - Request ID generation
 * - Metrics collection (latency, status codes, throughput)
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type AuthType = "none" | "api_key" | "bearer" | "basic" | "oauth2" | "custom";

export type CacheStrategy = "none" | "memory" | "persistent" | "stale_while_revalidate";

export type ValidationTarget = "body" | "query" | "params" | "headers";

export interface RoutePattern {
	path: string;
	regex: RegExp;
	params: string[];
	hasWildcard: boolean;
}

export interface Route {
	id: string;
	name: string;
	version: string;
	method: HttpMethod | HttpMethod[];
	path: string;
	pattern: RoutePattern;
	backendService: string;
	backendPath?: string;
	enabled: boolean;
	auth: RouteAuth;
	rateLimit?: RouteRateLimit;
	cache?: RouteCache;
	timeout: number;
	retry?: RouteRetry;
	cors?: RouteCors;
	validation?: RouteValidation[];
	transform?: RouteTransform;
	metadata?: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface RouteAuth {
	type: AuthType;
	required: boolean;
	scopes?: string[];
	allowedRoles?: string[];
	customValidator?: string;
}

export interface RouteRateLimit {
	enabled: boolean;
	limit: number;
	windowMs: number;
	keyBy: "ip" | "client_id" | "user_id" | "api_key" | "custom";
	customKey?: string;
}

export interface RouteCache {
	strategy: CacheStrategy;
	ttlMs: number;
	varyBy?: string[];
	invalidateOn?: HttpMethod[];
}

export interface RouteRetry {
	enabled: boolean;
	maxAttempts: number;
	backoffMs: number;
	retryOn?: number[];
}

export interface RouteCors {
	enabled: boolean;
	allowOrigins: string[];
	allowMethods: HttpMethod[];
	allowHeaders: string[];
	exposeHeaders?: string[];
	maxAge?: number;
	allowCredentials?: boolean;
}

export interface RouteValidation {
	target: ValidationTarget;
	schema: Record<string, unknown>;
	strict?: boolean;
}

export interface RouteTransform {
	request?: {
		headers?: Record<string, string>;
		queryParams?: Record<string, string>;
		bodyTemplate?: string;
	};
	response?: {
		headers?: Record<string, string>;
		bodyTemplate?: string;
		statusCodeMap?: Record<number, number>;
	};
}

export interface BackendService {
	id: string;
	name: string;
	baseUrl: string;
	healthCheckPath?: string;
	timeout: number;
	headers?: Record<string, string>;
	enabled: boolean;
	priority: number;
	weight?: number;
	metadata?: Record<string, unknown>;
	createdAt: Date;
}

export interface GatewayRequest {
	id: string;
	method: HttpMethod;
	path: string;
	headers: Record<string, string>;
	query: Record<string, string>;
	params: Record<string, string>;
	body?: unknown;
	clientId?: string;
	userId?: string;
	ip?: string;
	timestamp: Date;
}

export interface GatewayResponse {
	requestId: string;
	statusCode: number;
	headers: Record<string, string>;
	body?: unknown;
	cached: boolean;
	latencyMs: number;
	backendService?: string;
	retryCount?: number;
}

export interface GatewayError {
	code: string;
	message: string;
	statusCode: number;
	details?: Record<string, unknown>;
	requestId?: string;
}

export interface RequestMetrics {
	routeId: string;
	method: HttpMethod;
	statusCode: number;
	latencyMs: number;
	cached: boolean;
	clientId?: string;
	timestamp: Date;
}

export interface RouteStats {
	routeId: string;
	totalRequests: number;
	successCount: number;
	errorCount: number;
	cacheHits: number;
	avgLatencyMs: number;
	p95LatencyMs: number;
	p99LatencyMs: number;
	requestsPerMinute: number;
	statusCodeDistribution: Record<number, number>;
}

export interface GatewayStats {
	totalRoutes: number;
	enabledRoutes: number;
	totalBackends: number;
	enabledBackends: number;
	totalRequests: number;
	requestsLast24h: number;
	avgLatencyMs: number;
	errorRate: number;
	cacheHitRate: number;
	topRoutes: { routeId: string; count: number }[];
}

export interface CacheEntry {
	key: string;
	routeId: string;
	response: GatewayResponse;
	expiresAt: number;
	createdAt: number;
}

export interface AuthContext {
	authenticated: boolean;
	clientId?: string;
	userId?: string;
	scopes?: string[];
	roles?: string[];
	metadata?: Record<string, unknown>;
}

export type AuthMiddleware = (request: GatewayRequest, route: Route) => Promise<AuthContext | GatewayError>;

export type RequestHandler = (request: GatewayRequest, route: Route, context: AuthContext) => Promise<GatewayResponse>;

export interface GatewayConfig {
	dataDir: string;
	defaultTimeout: number;
	maxBodySize: number;
	enableMetrics: boolean;
	metricsRetentionDays: number;
	enableRequestLogging: boolean;
	logRetentionDays: number;
	cacheMaxSize: number;
	defaultCorsOrigins?: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Omit<GatewayConfig, "dataDir"> = {
	defaultTimeout: 30000,
	maxBodySize: 10 * 1024 * 1024, // 10MB
	enableMetrics: true,
	metricsRetentionDays: 30,
	enableRequestLogging: true,
	logRetentionDays: 7,
	cacheMaxSize: 1000,
	defaultCorsOrigins: ["*"],
};

// ============================================================================
// API Gateway System
// ============================================================================

export class APIGatewaySystem extends EventEmitter {
	private db: Database.Database;
	private config: GatewayConfig;
	private routes: Map<string, Route> = new Map();
	private backends: Map<string, BackendService> = new Map();
	private cache: Map<string, CacheEntry> = new Map();
	private authMiddleware: Map<AuthType, AuthMiddleware> = new Map();
	private requestHandlers: Map<string, RequestHandler> = new Map();
	private rateLimitState: Map<string, { count: number; windowStart: number }> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(config: GatewayConfig) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.db = new Database(join(config.dataDir, "api_gateway.db"));
		this.initializeDatabase();
		this.loadRoutes();
		this.loadBackends();
		this.startCleanupScheduler();
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Routes table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT 'v1',
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        pattern_regex TEXT NOT NULL,
        pattern_params TEXT NOT NULL DEFAULT '[]',
        pattern_has_wildcard INTEGER NOT NULL DEFAULT 0,
        backend_service TEXT NOT NULL,
        backend_path TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        auth_type TEXT NOT NULL DEFAULT 'none',
        auth_required INTEGER NOT NULL DEFAULT 0,
        auth_scopes TEXT,
        auth_allowed_roles TEXT,
        auth_custom_validator TEXT,
        rate_limit_enabled INTEGER NOT NULL DEFAULT 0,
        rate_limit_count INTEGER,
        rate_limit_window_ms INTEGER,
        rate_limit_key_by TEXT,
        rate_limit_custom_key TEXT,
        cache_strategy TEXT DEFAULT 'none',
        cache_ttl_ms INTEGER,
        cache_vary_by TEXT,
        cache_invalidate_on TEXT,
        timeout INTEGER NOT NULL DEFAULT 30000,
        retry_enabled INTEGER NOT NULL DEFAULT 0,
        retry_max_attempts INTEGER,
        retry_backoff_ms INTEGER,
        retry_on TEXT,
        cors_enabled INTEGER NOT NULL DEFAULT 0,
        cors_allow_origins TEXT,
        cors_allow_methods TEXT,
        cors_allow_headers TEXT,
        cors_expose_headers TEXT,
        cors_max_age INTEGER,
        cors_allow_credentials INTEGER,
        validation TEXT,
        transform_request TEXT,
        transform_response TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

		// Backend services table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS backend_services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        health_check_path TEXT,
        timeout INTEGER NOT NULL DEFAULT 30000,
        headers TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        weight INTEGER,
        metadata TEXT,
        created_at TEXT NOT NULL
      )
    `);

		// Request log table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_log (
        id TEXT PRIMARY KEY,
        route_id TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        cached INTEGER NOT NULL DEFAULT 0,
        client_id TEXT,
        user_id TEXT,
        ip TEXT,
        error_code TEXT,
        error_message TEXT,
        backend_service TEXT,
        retry_count INTEGER DEFAULT 0,
        timestamp TEXT NOT NULL
      )
    `);

		// Metrics aggregation table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS route_metrics (
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        total_requests INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        cache_hits INTEGER NOT NULL DEFAULT 0,
        total_latency_ms INTEGER NOT NULL DEFAULT 0,
        min_latency_ms INTEGER,
        max_latency_ms INTEGER,
        status_codes TEXT NOT NULL DEFAULT '{}',
        UNIQUE(route_id, period_start)
      )
    `);

		// Cache metadata table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        response TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_routes_path ON routes(path);
      CREATE INDEX IF NOT EXISTS idx_routes_version ON routes(version);
      CREATE INDEX IF NOT EXISTS idx_routes_backend ON routes(backend_service);
      CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_request_log_route ON request_log(route_id);
      CREATE INDEX IF NOT EXISTS idx_request_log_status ON request_log(status_code);
      CREATE INDEX IF NOT EXISTS idx_metrics_route ON route_metrics(route_id);
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at);
    `);
	}

	private loadRoutes(): void {
		const stmt = this.db.prepare("SELECT * FROM routes WHERE enabled = 1");
		const rows = stmt.all() as DbRouteRow[];

		for (const row of rows) {
			const route = this.rowToRoute(row);
			this.routes.set(route.id, route);
		}
	}

	private loadBackends(): void {
		const stmt = this.db.prepare("SELECT * FROM backend_services WHERE enabled = 1");
		const rows = stmt.all() as DbBackendRow[];

		for (const row of rows) {
			const backend = this.rowToBackend(row);
			this.backends.set(backend.id, backend);
		}
	}

	private startCleanupScheduler(): void {
		// Run cleanup daily
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupExpiredData();
			},
			24 * 60 * 60 * 1000,
		);

		// Also run cache cleanup every 5 minutes
		setInterval(
			() => {
				this.cleanupExpiredCache();
			},
			5 * 60 * 1000,
		);
	}

	private cleanupExpiredData(): void {
		const now = new Date();

		// Clean request logs
		if (this.config.enableRequestLogging) {
			const logCutoff = new Date(now);
			logCutoff.setDate(logCutoff.getDate() - this.config.logRetentionDays);
			this.db.prepare("DELETE FROM request_log WHERE timestamp < ?").run(logCutoff.toISOString());
		}

		// Clean metrics
		if (this.config.enableMetrics) {
			const metricsCutoff = new Date(now);
			metricsCutoff.setDate(metricsCutoff.getDate() - this.config.metricsRetentionDays);
			this.db.prepare("DELETE FROM route_metrics WHERE period_end < ?").run(metricsCutoff.toISOString());
		}

		this.emit("cleanup:completed");
	}

	private cleanupExpiredCache(): void {
		const now = Date.now();

		// Clean in-memory cache
		for (const [key, entry] of this.cache) {
			if (entry.expiresAt < now) {
				this.cache.delete(key);
			}
		}

		// Clean persistent cache
		this.db.prepare("DELETE FROM cache_entries WHERE expires_at < ?").run(now);
	}

	// ============================================================================
	// Route Management
	// ============================================================================

	registerRoute(params: {
		name: string;
		version?: string;
		method: HttpMethod | HttpMethod[];
		path: string;
		backendService: string;
		backendPath?: string;
		auth?: Partial<RouteAuth>;
		rateLimit?: Partial<RouteRateLimit>;
		cache?: Partial<RouteCache>;
		timeout?: number;
		retry?: Partial<RouteRetry>;
		cors?: Partial<RouteCors>;
		validation?: RouteValidation[];
		transform?: RouteTransform;
		metadata?: Record<string, unknown>;
	}): Route {
		const id = `route_${Date.now()}_${randomUUID().slice(0, 8)}`;
		const now = new Date();
		const pattern = this.compilePath(params.path);

		const route: Route = {
			id,
			name: params.name,
			version: params.version ?? "v1",
			method: params.method,
			path: params.path,
			pattern,
			backendService: params.backendService,
			backendPath: params.backendPath,
			enabled: true,
			auth: {
				type: params.auth?.type ?? "none",
				required: params.auth?.required ?? false,
				scopes: params.auth?.scopes,
				allowedRoles: params.auth?.allowedRoles,
				customValidator: params.auth?.customValidator,
			},
			rateLimit: params.rateLimit
				? {
						enabled: params.rateLimit.enabled ?? true,
						limit: params.rateLimit.limit ?? 100,
						windowMs: params.rateLimit.windowMs ?? 60000,
						keyBy: params.rateLimit.keyBy ?? "ip",
						customKey: params.rateLimit.customKey,
					}
				: undefined,
			cache: params.cache
				? {
						strategy: params.cache.strategy ?? "none",
						ttlMs: params.cache.ttlMs ?? 60000,
						varyBy: params.cache.varyBy,
						invalidateOn: params.cache.invalidateOn,
					}
				: undefined,
			timeout: params.timeout ?? this.config.defaultTimeout,
			retry: params.retry
				? {
						enabled: params.retry.enabled ?? true,
						maxAttempts: params.retry.maxAttempts ?? 3,
						backoffMs: params.retry.backoffMs ?? 1000,
						retryOn: params.retry.retryOn,
					}
				: undefined,
			cors: params.cors
				? {
						enabled: params.cors.enabled ?? true,
						allowOrigins: params.cors.allowOrigins ?? this.config.defaultCorsOrigins ?? ["*"],
						allowMethods: params.cors.allowMethods ?? ["GET", "POST", "PUT", "DELETE"],
						allowHeaders: params.cors.allowHeaders ?? ["Content-Type", "Authorization"],
						exposeHeaders: params.cors.exposeHeaders,
						maxAge: params.cors.maxAge,
						allowCredentials: params.cors.allowCredentials,
					}
				: undefined,
			validation: params.validation,
			transform: params.transform,
			metadata: params.metadata,
			createdAt: now,
			updatedAt: now,
		};

		this.saveRoute(route);
		this.routes.set(route.id, route);
		this.emit("route:registered", route);

		return route;
	}

	private compilePath(path: string): RoutePattern {
		const params: string[] = [];
		let hasWildcard = false;

		// Convert path to regex pattern
		let regexStr = path
			// Escape special regex characters except : and *
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			// Convert :param to named capture groups
			.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
				params.push(name);
				return "([^/]+)";
			})
			// Convert * wildcard to catch-all
			.replace(/\*/g, () => {
				hasWildcard = true;
				return "(.*)";
			});

		// Ensure exact match
		regexStr = `^${regexStr}$`;

		return {
			path,
			regex: new RegExp(regexStr),
			params,
			hasWildcard,
		};
	}

	private saveRoute(route: Route): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO routes
      (id, name, version, method, path, pattern_regex, pattern_params, pattern_has_wildcard,
       backend_service, backend_path, enabled, auth_type, auth_required, auth_scopes,
       auth_allowed_roles, auth_custom_validator, rate_limit_enabled, rate_limit_count,
       rate_limit_window_ms, rate_limit_key_by, rate_limit_custom_key, cache_strategy,
       cache_ttl_ms, cache_vary_by, cache_invalidate_on, timeout, retry_enabled,
       retry_max_attempts, retry_backoff_ms, retry_on, cors_enabled, cors_allow_origins,
       cors_allow_methods, cors_allow_headers, cors_expose_headers, cors_max_age,
       cors_allow_credentials, validation, transform_request, transform_response,
       metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			route.id,
			route.name,
			route.version,
			JSON.stringify(Array.isArray(route.method) ? route.method : [route.method]),
			route.path,
			route.pattern.regex.source,
			JSON.stringify(route.pattern.params),
			route.pattern.hasWildcard ? 1 : 0,
			route.backendService,
			route.backendPath ?? null,
			route.enabled ? 1 : 0,
			route.auth.type,
			route.auth.required ? 1 : 0,
			route.auth.scopes ? JSON.stringify(route.auth.scopes) : null,
			route.auth.allowedRoles ? JSON.stringify(route.auth.allowedRoles) : null,
			route.auth.customValidator ?? null,
			route.rateLimit?.enabled ? 1 : 0,
			route.rateLimit?.limit ?? null,
			route.rateLimit?.windowMs ?? null,
			route.rateLimit?.keyBy ?? null,
			route.rateLimit?.customKey ?? null,
			route.cache?.strategy ?? "none",
			route.cache?.ttlMs ?? null,
			route.cache?.varyBy ? JSON.stringify(route.cache.varyBy) : null,
			route.cache?.invalidateOn ? JSON.stringify(route.cache.invalidateOn) : null,
			route.timeout,
			route.retry?.enabled ? 1 : 0,
			route.retry?.maxAttempts ?? null,
			route.retry?.backoffMs ?? null,
			route.retry?.retryOn ? JSON.stringify(route.retry.retryOn) : null,
			route.cors?.enabled ? 1 : 0,
			route.cors?.allowOrigins ? JSON.stringify(route.cors.allowOrigins) : null,
			route.cors?.allowMethods ? JSON.stringify(route.cors.allowMethods) : null,
			route.cors?.allowHeaders ? JSON.stringify(route.cors.allowHeaders) : null,
			route.cors?.exposeHeaders ? JSON.stringify(route.cors.exposeHeaders) : null,
			route.cors?.maxAge ?? null,
			route.cors?.allowCredentials ? 1 : 0,
			route.validation ? JSON.stringify(route.validation) : null,
			route.transform?.request ? JSON.stringify(route.transform.request) : null,
			route.transform?.response ? JSON.stringify(route.transform.response) : null,
			route.metadata ? JSON.stringify(route.metadata) : null,
			route.createdAt.toISOString(),
			route.updatedAt.toISOString(),
		);
	}

	getRoute(routeId: string): Route | null {
		return this.routes.get(routeId) ?? null;
	}

	getAllRoutes(enabledOnly: boolean = true): Route[] {
		if (enabledOnly) {
			return Array.from(this.routes.values());
		}

		const stmt = this.db.prepare("SELECT * FROM routes ORDER BY created_at DESC");
		const rows = stmt.all() as DbRouteRow[];
		return rows.map((row) => this.rowToRoute(row));
	}

	updateRoute(routeId: string, updates: Partial<Omit<Route, "id" | "createdAt" | "pattern">>): Route | null {
		const route = this.routes.get(routeId);
		if (!route) return null;

		const updatedRoute: Route = {
			...route,
			...updates,
			pattern: updates.path ? this.compilePath(updates.path) : route.pattern,
			updatedAt: new Date(),
		};

		this.saveRoute(updatedRoute);
		this.routes.set(routeId, updatedRoute);
		this.emit("route:updated", updatedRoute);

		return updatedRoute;
	}

	disableRoute(routeId: string): boolean {
		const route = this.routes.get(routeId);
		if (!route) return false;

		route.enabled = false;
		route.updatedAt = new Date();
		this.saveRoute(route);
		this.routes.delete(routeId);
		this.emit("route:disabled", route);

		return true;
	}

	deleteRoute(routeId: string): boolean {
		const stmt = this.db.prepare("DELETE FROM routes WHERE id = ?");
		const result = stmt.run(routeId);

		if (result.changes > 0) {
			this.routes.delete(routeId);
			this.emit("route:deleted", { routeId });
			return true;
		}

		return false;
	}

	// ============================================================================
	// Backend Service Management
	// ============================================================================

	registerBackend(params: {
		name: string;
		baseUrl: string;
		healthCheckPath?: string;
		timeout?: number;
		headers?: Record<string, string>;
		priority?: number;
		weight?: number;
		metadata?: Record<string, unknown>;
	}): BackendService {
		const id = `backend_${Date.now()}_${randomUUID().slice(0, 8)}`;

		const backend: BackendService = {
			id,
			name: params.name,
			baseUrl: params.baseUrl,
			healthCheckPath: params.healthCheckPath,
			timeout: params.timeout ?? this.config.defaultTimeout,
			headers: params.headers,
			enabled: true,
			priority: params.priority ?? 0,
			weight: params.weight,
			metadata: params.metadata,
			createdAt: new Date(),
		};

		const stmt = this.db.prepare(`
      INSERT INTO backend_services
      (id, name, base_url, health_check_path, timeout, headers, enabled, priority, weight, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			backend.id,
			backend.name,
			backend.baseUrl,
			backend.healthCheckPath ?? null,
			backend.timeout,
			backend.headers ? JSON.stringify(backend.headers) : null,
			1,
			backend.priority,
			backend.weight ?? null,
			backend.metadata ? JSON.stringify(backend.metadata) : null,
			backend.createdAt.toISOString(),
		);

		this.backends.set(backend.id, backend);
		this.emit("backend:registered", backend);

		return backend;
	}

	getBackend(backendId: string): BackendService | null {
		return this.backends.get(backendId) ?? null;
	}

	getAllBackends(enabledOnly: boolean = true): BackendService[] {
		if (enabledOnly) {
			return Array.from(this.backends.values());
		}

		const stmt = this.db.prepare("SELECT * FROM backend_services ORDER BY priority DESC");
		const rows = stmt.all() as DbBackendRow[];
		return rows.map((row) => this.rowToBackend(row));
	}

	// ============================================================================
	// Request Processing
	// ============================================================================

	async handleRequest(request: GatewayRequest): Promise<GatewayResponse | GatewayError> {
		const startTime = Date.now();
		request.id = request.id || `req_${Date.now()}_${randomUUID().slice(0, 8)}`;

		try {
			// Find matching route
			const match = this.matchRoute(request.method, request.path);
			if (!match) {
				return this.createError("ROUTE_NOT_FOUND", "No matching route found", 404, request.id);
			}

			const { route, params } = match;
			request.params = params;

			// Check CORS
			if (route.cors?.enabled) {
				const corsError = this.checkCors(request, route);
				if (corsError) return corsError;
			}

			// Check rate limit
			if (route.rateLimit?.enabled) {
				const rateLimitError = this.checkRateLimit(request, route);
				if (rateLimitError) return rateLimitError;
			}

			// Authentication
			let authContext: AuthContext = { authenticated: false };
			if (route.auth.required || route.auth.type !== "none") {
				const authResult = await this.authenticate(request, route);
				if ("code" in authResult) {
					return authResult;
				}
				authContext = authResult;

				// Authorization check
				const authzError = this.checkAuthorization(authContext, route);
				if (authzError) return authzError;
			}

			// Validation
			if (route.validation && route.validation.length > 0) {
				const validationError = this.validateRequest(request, route);
				if (validationError) return validationError;
			}

			// Check cache
			if (route.cache && route.cache.strategy !== "none" && request.method === "GET") {
				const cached = this.getCachedResponse(request, route);
				if (cached) {
					const latencyMs = Date.now() - startTime;
					this.logRequest(request, route, cached.statusCode, latencyMs, true);
					return { ...cached, cached: true, latencyMs, requestId: request.id };
				}
			}

			// Transform request
			const transformedRequest = route.transform?.request
				? this.transformRequest(request, route.transform.request)
				: request;

			// Execute request handler
			const handler = this.requestHandlers.get(route.backendService);
			if (!handler) {
				return this.createError(
					"BACKEND_NOT_FOUND",
					`Backend service ${route.backendService} not found`,
					503,
					request.id,
				);
			}

			let response: GatewayResponse;
			let retryCount = 0;

			// Retry logic
			while (true) {
				try {
					response = await this.executeWithTimeout(handler(transformedRequest, route, authContext), route.timeout);
					break;
				} catch (error) {
					if (route.retry?.enabled && retryCount < (route.retry.maxAttempts ?? 3)) {
						const shouldRetry = this.shouldRetry(error, route.retry);
						if (shouldRetry) {
							retryCount++;
							await this.delay(route.retry.backoffMs ?? 1000 * retryCount);
							continue;
						}
					}
					throw error;
				}
			}

			// Transform response
			if (route.transform?.response) {
				response = this.transformResponse(response, route.transform.response);
			}

			// Cache response
			if (route.cache && route.cache.strategy !== "none" && request.method === "GET" && response.statusCode < 400) {
				this.cacheResponse(request, route, response);
			}

			const latencyMs = Date.now() - startTime;
			response.latencyMs = latencyMs;
			response.requestId = request.id;
			response.retryCount = retryCount;

			this.logRequest(request, route, response.statusCode, latencyMs, false, undefined, retryCount);
			this.emit("request:completed", { request, response, route });

			return response;
		} catch (error) {
			const _latencyMs = Date.now() - startTime;
			const gatewayError = this.handleError(error, request.id);
			this.emit("request:error", { request, error: gatewayError });
			return gatewayError;
		}
	}

	private matchRoute(method: HttpMethod, path: string): { route: Route; params: Record<string, string> } | null {
		for (const route of this.routes.values()) {
			// Check method
			const methods = Array.isArray(route.method) ? route.method : [route.method];
			if (!methods.includes(method)) continue;

			// Check path pattern
			const match = route.pattern.regex.exec(path);
			if (!match) continue;

			// Extract params
			const params: Record<string, string> = {};
			route.pattern.params.forEach((name, index) => {
				params[name] = match[index + 1];
			});

			return { route, params };
		}

		return null;
	}

	private checkCors(request: GatewayRequest, route: Route): GatewayError | null {
		if (!route.cors?.enabled) return null;

		const origin = request.headers.origin;
		if (!origin) return null;

		const allowedOrigins = route.cors.allowOrigins;
		const isAllowed = allowedOrigins.includes("*") || allowedOrigins.includes(origin);

		if (!isAllowed) {
			return this.createError("CORS_ERROR", `Origin ${origin} not allowed`, 403, request.id);
		}

		return null;
	}

	private checkRateLimit(request: GatewayRequest, route: Route): GatewayError | null {
		if (!route.rateLimit?.enabled) return null;

		const key = this.getRateLimitKey(request, route);
		const now = Date.now();
		const state = this.rateLimitState.get(key);

		if (!state || now - state.windowStart > route.rateLimit.windowMs) {
			this.rateLimitState.set(key, { count: 1, windowStart: now });
			return null;
		}

		if (state.count >= route.rateLimit.limit) {
			const retryAfter = Math.ceil((state.windowStart + route.rateLimit.windowMs - now) / 1000);
			return this.createError(
				"RATE_LIMIT_EXCEEDED",
				`Rate limit exceeded. Retry after ${retryAfter} seconds`,
				429,
				request.id,
				{ retryAfter },
			);
		}

		state.count++;
		return null;
	}

	private getRateLimitKey(request: GatewayRequest, route: Route): string {
		const keyBy = route.rateLimit?.keyBy ?? "ip";
		let keyValue: string;

		switch (keyBy) {
			case "client_id":
				keyValue = request.clientId ?? request.ip ?? "unknown";
				break;
			case "user_id":
				keyValue = request.userId ?? request.ip ?? "unknown";
				break;
			case "api_key":
				keyValue = request.headers["x-api-key"] ?? request.ip ?? "unknown";
				break;
			case "custom":
				keyValue = route.rateLimit?.customKey ?? request.ip ?? "unknown";
				break;
			default:
				keyValue = request.ip ?? "unknown";
		}

		return `rate:${route.id}:${keyValue}`;
	}

	private async authenticate(request: GatewayRequest, route: Route): Promise<AuthContext | GatewayError> {
		const middleware = this.authMiddleware.get(route.auth.type);
		if (!middleware) {
			if (route.auth.required) {
				return this.createError(
					"AUTH_NOT_CONFIGURED",
					`Auth type ${route.auth.type} not configured`,
					500,
					request.id,
				);
			}
			return { authenticated: false };
		}

		return middleware(request, route);
	}

	private checkAuthorization(context: AuthContext, route: Route): GatewayError | null {
		if (!context.authenticated && route.auth.required) {
			return this.createError("UNAUTHORIZED", "Authentication required", 401);
		}

		// Check scopes
		if (route.auth.scopes && route.auth.scopes.length > 0) {
			const hasScope = route.auth.scopes.some((scope) => context.scopes?.includes(scope));
			if (!hasScope) {
				return this.createError("FORBIDDEN", "Insufficient scope", 403);
			}
		}

		// Check roles
		if (route.auth.allowedRoles && route.auth.allowedRoles.length > 0) {
			const hasRole = route.auth.allowedRoles.some((role) => context.roles?.includes(role));
			if (!hasRole) {
				return this.createError("FORBIDDEN", "Insufficient role", 403);
			}
		}

		return null;
	}

	private validateRequest(request: GatewayRequest, route: Route): GatewayError | null {
		if (!route.validation) return null;

		for (const validation of route.validation) {
			let data: unknown;
			switch (validation.target) {
				case "body":
					data = request.body;
					break;
				case "query":
					data = request.query;
					break;
				case "params":
					data = request.params;
					break;
				case "headers":
					data = request.headers;
					break;
			}

			const error = this.validateAgainstSchema(data, validation.schema, validation.strict);
			if (error) {
				return this.createError("VALIDATION_ERROR", error, 400, request.id);
			}
		}

		return null;
	}

	private validateAgainstSchema(data: unknown, schema: Record<string, unknown>, strict?: boolean): string | null {
		// Basic schema validation
		if (typeof schema !== "object" || schema === null) return null;

		const schemaType = schema.type as string | undefined;
		const required = schema.required as string[] | undefined;
		const properties = schema.properties as Record<string, unknown> | undefined;

		if (schemaType === "object" && typeof data !== "object") {
			return "Expected object";
		}

		if (required && Array.isArray(required)) {
			const dataObj = data as Record<string, unknown> | null;
			for (const field of required) {
				if (!dataObj || !(field in dataObj)) {
					return `Missing required field: ${field}`;
				}
			}
		}

		if (strict && properties && typeof data === "object" && data !== null) {
			const allowedKeys = Object.keys(properties);
			const dataKeys = Object.keys(data);
			const unknownKeys = dataKeys.filter((k) => !allowedKeys.includes(k));
			if (unknownKeys.length > 0) {
				return `Unknown fields: ${unknownKeys.join(", ")}`;
			}
		}

		return null;
	}

	private getCachedResponse(request: GatewayRequest, route: Route): GatewayResponse | null {
		const cacheKey = this.buildCacheKey(request, route);

		// Check memory cache
		const memEntry = this.cache.get(cacheKey);
		if (memEntry && memEntry.expiresAt > Date.now()) {
			return memEntry.response;
		}

		// Check persistent cache
		if (route.cache?.strategy === "persistent" || route.cache?.strategy === "stale_while_revalidate") {
			const stmt = this.db.prepare("SELECT * FROM cache_entries WHERE key = ? AND expires_at > ?");
			const row = stmt.get(cacheKey, Date.now()) as DbCacheRow | undefined;
			if (row) {
				return JSON.parse(row.response);
			}
		}

		return null;
	}

	private cacheResponse(request: GatewayRequest, route: Route, response: GatewayResponse): void {
		if (!route.cache || route.cache.strategy === "none") return;

		const cacheKey = this.buildCacheKey(request, route);
		const now = Date.now();
		const expiresAt = now + (route.cache.ttlMs ?? 60000);

		const entry: CacheEntry = {
			key: cacheKey,
			routeId: route.id,
			response,
			expiresAt,
			createdAt: now,
		};

		// Store in memory
		if (this.cache.size >= this.config.cacheMaxSize) {
			// Evict oldest entries
			const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
			const toRemove = entries.slice(0, Math.floor(this.config.cacheMaxSize * 0.1));
			toRemove.forEach(([key]) => this.cache.delete(key));
		}
		this.cache.set(cacheKey, entry);

		// Store persistently
		if (route.cache.strategy === "persistent" || route.cache.strategy === "stale_while_revalidate") {
			const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO cache_entries (key, route_id, response, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
			stmt.run(cacheKey, route.id, JSON.stringify(response), expiresAt, now);
		}
	}

	private buildCacheKey(request: GatewayRequest, route: Route): string {
		let key = `${route.id}:${request.method}:${request.path}`;

		if (route.cache?.varyBy) {
			const varyParts: string[] = [];
			for (const header of route.cache.varyBy) {
				const value = request.headers[header.toLowerCase()];
				if (value) {
					varyParts.push(`${header}=${value}`);
				}
			}
			if (varyParts.length > 0) {
				key += `:${varyParts.join("&")}`;
			}
		}

		// Include query params
		const queryString = Object.entries(request.query)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}=${v}`)
			.join("&");
		if (queryString) {
			key += `?${queryString}`;
		}

		return key;
	}

	invalidateCache(routeId: string, pattern?: string): number {
		let count = 0;

		// Invalidate memory cache
		for (const [key, entry] of this.cache) {
			if (entry.routeId === routeId) {
				if (!pattern || key.includes(pattern)) {
					this.cache.delete(key);
					count++;
				}
			}
		}

		// Invalidate persistent cache
		if (pattern) {
			const stmt = this.db.prepare("DELETE FROM cache_entries WHERE route_id = ? AND key LIKE ?");
			const result = stmt.run(routeId, `%${pattern}%`);
			count += result.changes;
		} else {
			const stmt = this.db.prepare("DELETE FROM cache_entries WHERE route_id = ?");
			const result = stmt.run(routeId);
			count += result.changes;
		}

		this.emit("cache:invalidated", { routeId, pattern, count });
		return count;
	}

	private transformRequest(request: GatewayRequest, transform: RouteTransform["request"]): GatewayRequest {
		if (!transform) return request;

		const transformed = { ...request };

		if (transform.headers) {
			transformed.headers = { ...request.headers, ...transform.headers };
		}

		if (transform.queryParams) {
			transformed.query = { ...request.query, ...transform.queryParams };
		}

		if (transform.bodyTemplate && request.body) {
			// Simple template substitution
			let body = transform.bodyTemplate;
			const bodyObj = request.body as Record<string, unknown>;
			for (const [key, value] of Object.entries(bodyObj)) {
				body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
			}
			try {
				transformed.body = JSON.parse(body);
			} catch {
				transformed.body = body;
			}
		}

		return transformed;
	}

	private transformResponse(response: GatewayResponse, transform: RouteTransform["response"]): GatewayResponse {
		if (!transform) return response;

		const transformed = { ...response };

		if (transform.headers) {
			transformed.headers = { ...response.headers, ...transform.headers };
		}

		if (transform.statusCodeMap?.[response.statusCode]) {
			transformed.statusCode = transform.statusCodeMap[response.statusCode];
		}

		if (transform.bodyTemplate && response.body) {
			let body = transform.bodyTemplate;
			const bodyObj = response.body as Record<string, unknown>;
			for (const [key, value] of Object.entries(bodyObj)) {
				body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
			}
			try {
				transformed.body = JSON.parse(body);
			} catch {
				transformed.body = body;
			}
		}

		return transformed;
	}

	private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("Request timeout"));
			}, timeoutMs);

			promise
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}

	private shouldRetry(error: unknown, retryConfig: RouteRetry): boolean {
		if (!retryConfig.enabled) return false;

		// Check if error is retryable
		if (error instanceof Error) {
			if (error.message === "Request timeout") return true;
			if (error.message.includes("ECONNREFUSED")) return true;
			if (error.message.includes("ETIMEDOUT")) return true;
		}

		// Check specific status codes
		if (retryConfig.retryOn && "statusCode" in (error as Record<string, unknown>)) {
			const statusCode = (error as { statusCode: number }).statusCode;
			return retryConfig.retryOn.includes(statusCode);
		}

		return false;
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private handleError(error: unknown, requestId?: string): GatewayError {
		if (error instanceof Error) {
			if (error.message === "Request timeout") {
				return this.createError("TIMEOUT", "Request timed out", 504, requestId);
			}
			return this.createError("INTERNAL_ERROR", error.message, 500, requestId);
		}
		return this.createError("INTERNAL_ERROR", "An unexpected error occurred", 500, requestId);
	}

	private createError(
		code: string,
		message: string,
		statusCode: number,
		requestId?: string,
		details?: Record<string, unknown>,
	): GatewayError {
		return {
			code,
			message,
			statusCode,
			requestId,
			details,
		};
	}

	// ============================================================================
	// Auth Middleware Registration
	// ============================================================================

	registerAuthMiddleware(type: AuthType, middleware: AuthMiddleware): void {
		this.authMiddleware.set(type, middleware);
		this.emit("auth:registered", { type });
	}

	registerRequestHandler(backendId: string, handler: RequestHandler): void {
		this.requestHandlers.set(backendId, handler);
		this.emit("handler:registered", { backendId });
	}

	// ============================================================================
	// Logging and Metrics
	// ============================================================================

	private logRequest(
		request: GatewayRequest,
		route: Route,
		statusCode: number,
		latencyMs: number,
		cached: boolean,
		error?: GatewayError,
		retryCount?: number,
	): void {
		if (!this.config.enableRequestLogging) return;

		const stmt = this.db.prepare(`
      INSERT INTO request_log
      (id, route_id, method, path, status_code, latency_ms, cached, client_id, user_id,
       ip, error_code, error_message, backend_service, retry_count, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			request.id,
			route.id,
			request.method,
			request.path,
			statusCode,
			latencyMs,
			cached ? 1 : 0,
			request.clientId ?? null,
			request.userId ?? null,
			request.ip ?? null,
			error?.code ?? null,
			error?.message ?? null,
			route.backendService,
			retryCount ?? 0,
			request.timestamp.toISOString(),
		);

		// Update metrics
		if (this.config.enableMetrics) {
			this.updateMetrics(route.id, statusCode, latencyMs, cached);
		}
	}

	private updateMetrics(routeId: string, statusCode: number, latencyMs: number, cached: boolean): void {
		const now = new Date();
		const periodStart = new Date(now);
		periodStart.setMinutes(0, 0, 0);
		const periodEnd = new Date(periodStart);
		periodEnd.setHours(periodEnd.getHours() + 1);

		// Try to update existing record
		const updateStmt = this.db.prepare(`
      UPDATE route_metrics
      SET total_requests = total_requests + 1,
          success_count = success_count + ?,
          error_count = error_count + ?,
          cache_hits = cache_hits + ?,
          total_latency_ms = total_latency_ms + ?,
          min_latency_ms = MIN(COALESCE(min_latency_ms, ?), ?),
          max_latency_ms = MAX(COALESCE(max_latency_ms, ?), ?),
          status_codes = ?
      WHERE route_id = ? AND period_start = ?
    `);

		const isSuccess = statusCode >= 200 && statusCode < 400;
		const isError = statusCode >= 400;

		// Get current status codes
		const selectStmt = this.db.prepare(
			"SELECT status_codes FROM route_metrics WHERE route_id = ? AND period_start = ?",
		);
		const existing = selectStmt.get(routeId, periodStart.toISOString()) as { status_codes: string } | undefined;

		const statusCodes: Record<number, number> = existing ? JSON.parse(existing.status_codes) : {};
		statusCodes[statusCode] = (statusCodes[statusCode] ?? 0) + 1;

		const result = updateStmt.run(
			isSuccess ? 1 : 0,
			isError ? 1 : 0,
			cached ? 1 : 0,
			latencyMs,
			latencyMs,
			latencyMs,
			latencyMs,
			latencyMs,
			JSON.stringify(statusCodes),
			routeId,
			periodStart.toISOString(),
		);

		if (result.changes === 0) {
			// Insert new record
			const insertStmt = this.db.prepare(`
        INSERT INTO route_metrics
        (id, route_id, period_start, period_end, total_requests, success_count, error_count,
         cache_hits, total_latency_ms, min_latency_ms, max_latency_ms, status_codes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

			insertStmt.run(
				`metric_${Date.now()}_${randomUUID().slice(0, 8)}`,
				routeId,
				periodStart.toISOString(),
				periodEnd.toISOString(),
				1,
				isSuccess ? 1 : 0,
				isError ? 1 : 0,
				cached ? 1 : 0,
				latencyMs,
				latencyMs,
				latencyMs,
				JSON.stringify({ [statusCode]: 1 }),
			);
		}
	}

	getRouteStats(routeId: string, hours: number = 24): RouteStats | null {
		const cutoff = new Date();
		cutoff.setHours(cutoff.getHours() - hours);

		const stmt = this.db.prepare(`
      SELECT
        SUM(total_requests) as total,
        SUM(success_count) as success,
        SUM(error_count) as errors,
        SUM(cache_hits) as cache_hits,
        SUM(total_latency_ms) as total_latency,
        MIN(min_latency_ms) as min_latency,
        MAX(max_latency_ms) as max_latency
      FROM route_metrics
      WHERE route_id = ? AND period_start >= ?
    `);

		const row = stmt.get(routeId, cutoff.toISOString()) as {
			total: number | null;
			success: number | null;
			errors: number | null;
			cache_hits: number | null;
			total_latency: number | null;
			min_latency: number | null;
			max_latency: number | null;
		};

		if (!row || !row.total) return null;

		// Calculate latency percentiles from request log
		const latencyStmt = this.db.prepare(`
      SELECT latency_ms FROM request_log
      WHERE route_id = ? AND timestamp >= ?
      ORDER BY latency_ms ASC
    `);
		const latencies = latencyStmt.all(routeId, cutoff.toISOString()) as { latency_ms: number }[];

		const p95Index = Math.floor(latencies.length * 0.95);
		const p99Index = Math.floor(latencies.length * 0.99);

		// Aggregate status codes
		const statusStmt = this.db.prepare(`
      SELECT status_codes FROM route_metrics
      WHERE route_id = ? AND period_start >= ?
    `);
		const statusRows = statusStmt.all(routeId, cutoff.toISOString()) as { status_codes: string }[];
		const statusCodeDistribution: Record<number, number> = {};
		for (const statusRow of statusRows) {
			const codes = JSON.parse(statusRow.status_codes) as Record<number, number>;
			for (const [code, count] of Object.entries(codes)) {
				statusCodeDistribution[Number(code)] = (statusCodeDistribution[Number(code)] ?? 0) + count;
			}
		}

		return {
			routeId,
			totalRequests: row.total,
			successCount: row.success ?? 0,
			errorCount: row.errors ?? 0,
			cacheHits: row.cache_hits ?? 0,
			avgLatencyMs: row.total > 0 ? Math.round((row.total_latency ?? 0) / row.total) : 0,
			p95LatencyMs: latencies[p95Index]?.latency_ms ?? 0,
			p99LatencyMs: latencies[p99Index]?.latency_ms ?? 0,
			requestsPerMinute: Math.round(row.total / (hours * 60)),
			statusCodeDistribution,
		};
	}

	getGatewayStats(): GatewayStats {
		const now = new Date();
		const last24h = new Date(now);
		last24h.setHours(last24h.getHours() - 24);

		const routeCountStmt = this.db.prepare("SELECT COUNT(*) as total, SUM(enabled) as enabled FROM routes");
		const routeCount = routeCountStmt.get() as { total: number; enabled: number };

		const backendCountStmt = this.db.prepare(
			"SELECT COUNT(*) as total, SUM(enabled) as enabled FROM backend_services",
		);
		const backendCount = backendCountStmt.get() as { total: number; enabled: number };

		const requestStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(latency_ms) as avg_latency,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) as cache_hits
      FROM request_log
      WHERE timestamp >= ?
    `);
		const requestStats = requestStmt.get(last24h.toISOString()) as {
			total: number;
			avg_latency: number | null;
			errors: number;
			cache_hits: number;
		};

		const topRoutesStmt = this.db.prepare(`
      SELECT route_id, COUNT(*) as count
      FROM request_log
      WHERE timestamp >= ?
      GROUP BY route_id
      ORDER BY count DESC
      LIMIT 10
    `);
		const topRoutes = topRoutesStmt.all(last24h.toISOString()) as { route_id: string; count: number }[];

		return {
			totalRoutes: routeCount.total,
			enabledRoutes: routeCount.enabled ?? 0,
			totalBackends: backendCount.total,
			enabledBackends: backendCount.enabled ?? 0,
			totalRequests: requestStats.total,
			requestsLast24h: requestStats.total,
			avgLatencyMs: Math.round(requestStats.avg_latency ?? 0),
			errorRate: requestStats.total > 0 ? (requestStats.errors / requestStats.total) * 100 : 0,
			cacheHitRate: requestStats.total > 0 ? (requestStats.cache_hits / requestStats.total) * 100 : 0,
			topRoutes: topRoutes.map((r) => ({ routeId: r.route_id, count: r.count })),
		};
	}

	getRequestLog(params: {
		routeId?: string;
		method?: HttpMethod;
		statusCode?: number;
		clientId?: string;
		startDate?: Date;
		endDate?: Date;
		limit?: number;
		offset?: number;
	}): { id: string; method: string; path: string; statusCode: number; latencyMs: number; timestamp: Date }[] {
		let query = "SELECT * FROM request_log WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.routeId) {
			query += " AND route_id = ?";
			queryParams.push(params.routeId);
		}
		if (params.method) {
			query += " AND method = ?";
			queryParams.push(params.method);
		}
		if (params.statusCode) {
			query += " AND status_code = ?";
			queryParams.push(params.statusCode);
		}
		if (params.clientId) {
			query += " AND client_id = ?";
			queryParams.push(params.clientId);
		}
		if (params.startDate) {
			query += " AND timestamp >= ?";
			queryParams.push(params.startDate.toISOString());
		}
		if (params.endDate) {
			query += " AND timestamp <= ?";
			queryParams.push(params.endDate.toISOString());
		}

		query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
		queryParams.push(params.limit ?? 100, params.offset ?? 0);

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as DbRequestLogRow[];

		return rows.map((row) => ({
			id: row.id,
			method: row.method,
			path: row.path,
			statusCode: row.status_code,
			latencyMs: row.latency_ms,
			timestamp: new Date(row.timestamp),
		}));
	}

	// ============================================================================
	// CORS Headers
	// ============================================================================

	getCorsHeaders(request: GatewayRequest, route: Route): Record<string, string> {
		if (!route.cors?.enabled) return {};

		const origin = request.headers.origin;
		const headers: Record<string, string> = {};

		// Check if origin is allowed
		const allowedOrigins = route.cors.allowOrigins;
		if (allowedOrigins.includes("*")) {
			headers["Access-Control-Allow-Origin"] = "*";
		} else if (origin && allowedOrigins.includes(origin)) {
			headers["Access-Control-Allow-Origin"] = origin;
			headers.Vary = "Origin";
		}

		headers["Access-Control-Allow-Methods"] = route.cors.allowMethods.join(", ");
		headers["Access-Control-Allow-Headers"] = route.cors.allowHeaders.join(", ");

		if (route.cors.exposeHeaders) {
			headers["Access-Control-Expose-Headers"] = route.cors.exposeHeaders.join(", ");
		}

		if (route.cors.maxAge) {
			headers["Access-Control-Max-Age"] = String(route.cors.maxAge);
		}

		if (route.cors.allowCredentials) {
			headers["Access-Control-Allow-Credentials"] = "true";
		}

		return headers;
	}

	// ============================================================================
	// Row Converters
	// ============================================================================

	private rowToRoute(row: DbRouteRow): Route {
		const methods = JSON.parse(row.method) as HttpMethod[];

		return {
			id: row.id,
			name: row.name,
			version: row.version,
			method: methods.length === 1 ? methods[0] : methods,
			path: row.path,
			pattern: {
				path: row.path,
				regex: new RegExp(row.pattern_regex),
				params: JSON.parse(row.pattern_params),
				hasWildcard: Boolean(row.pattern_has_wildcard),
			},
			backendService: row.backend_service,
			backendPath: row.backend_path ?? undefined,
			enabled: Boolean(row.enabled),
			auth: {
				type: row.auth_type as AuthType,
				required: Boolean(row.auth_required),
				scopes: row.auth_scopes ? JSON.parse(row.auth_scopes) : undefined,
				allowedRoles: row.auth_allowed_roles ? JSON.parse(row.auth_allowed_roles) : undefined,
				customValidator: row.auth_custom_validator ?? undefined,
			},
			rateLimit: row.rate_limit_enabled
				? {
						enabled: Boolean(row.rate_limit_enabled),
						limit: row.rate_limit_count ?? 100,
						windowMs: row.rate_limit_window_ms ?? 60000,
						keyBy: (row.rate_limit_key_by as RouteRateLimit["keyBy"]) ?? "ip",
						customKey: row.rate_limit_custom_key ?? undefined,
					}
				: undefined,
			cache:
				row.cache_strategy !== "none"
					? {
							strategy: row.cache_strategy as CacheStrategy,
							ttlMs: row.cache_ttl_ms ?? 60000,
							varyBy: row.cache_vary_by ? JSON.parse(row.cache_vary_by) : undefined,
							invalidateOn: row.cache_invalidate_on ? JSON.parse(row.cache_invalidate_on) : undefined,
						}
					: undefined,
			timeout: row.timeout,
			retry: row.retry_enabled
				? {
						enabled: Boolean(row.retry_enabled),
						maxAttempts: row.retry_max_attempts ?? 3,
						backoffMs: row.retry_backoff_ms ?? 1000,
						retryOn: row.retry_on ? JSON.parse(row.retry_on) : undefined,
					}
				: undefined,
			cors: row.cors_enabled
				? {
						enabled: Boolean(row.cors_enabled),
						allowOrigins: row.cors_allow_origins ? JSON.parse(row.cors_allow_origins) : ["*"],
						allowMethods: row.cors_allow_methods ? JSON.parse(row.cors_allow_methods) : ["GET", "POST"],
						allowHeaders: row.cors_allow_headers ? JSON.parse(row.cors_allow_headers) : ["Content-Type"],
						exposeHeaders: row.cors_expose_headers ? JSON.parse(row.cors_expose_headers) : undefined,
						maxAge: row.cors_max_age ?? undefined,
						allowCredentials: Boolean(row.cors_allow_credentials),
					}
				: undefined,
			validation: row.validation ? JSON.parse(row.validation) : undefined,
			transform:
				row.transform_request || row.transform_response
					? {
							request: row.transform_request ? JSON.parse(row.transform_request) : undefined,
							response: row.transform_response ? JSON.parse(row.transform_response) : undefined,
						}
					: undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
		};
	}

	private rowToBackend(row: DbBackendRow): BackendService {
		return {
			id: row.id,
			name: row.name,
			baseUrl: row.base_url,
			healthCheckPath: row.health_check_path ?? undefined,
			timeout: row.timeout,
			headers: row.headers ? JSON.parse(row.headers) : undefined,
			enabled: Boolean(row.enabled),
			priority: row.priority,
			weight: row.weight ?? undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			createdAt: new Date(row.created_at),
		};
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Internal Types
// ============================================================================

interface DbRouteRow {
	id: string;
	name: string;
	version: string;
	method: string;
	path: string;
	pattern_regex: string;
	pattern_params: string;
	pattern_has_wildcard: number;
	backend_service: string;
	backend_path: string | null;
	enabled: number;
	auth_type: string;
	auth_required: number;
	auth_scopes: string | null;
	auth_allowed_roles: string | null;
	auth_custom_validator: string | null;
	rate_limit_enabled: number;
	rate_limit_count: number | null;
	rate_limit_window_ms: number | null;
	rate_limit_key_by: string | null;
	rate_limit_custom_key: string | null;
	cache_strategy: string;
	cache_ttl_ms: number | null;
	cache_vary_by: string | null;
	cache_invalidate_on: string | null;
	timeout: number;
	retry_enabled: number;
	retry_max_attempts: number | null;
	retry_backoff_ms: number | null;
	retry_on: string | null;
	cors_enabled: number;
	cors_allow_origins: string | null;
	cors_allow_methods: string | null;
	cors_allow_headers: string | null;
	cors_expose_headers: string | null;
	cors_max_age: number | null;
	cors_allow_credentials: number;
	validation: string | null;
	transform_request: string | null;
	transform_response: string | null;
	metadata: string | null;
	created_at: string;
	updated_at: string;
}

interface DbBackendRow {
	id: string;
	name: string;
	base_url: string;
	health_check_path: string | null;
	timeout: number;
	headers: string | null;
	enabled: number;
	priority: number;
	weight: number | null;
	metadata: string | null;
	created_at: string;
}

interface DbCacheRow {
	key: string;
	route_id: string;
	response: string;
	expires_at: number;
	created_at: number;
}

interface DbRequestLogRow {
	id: string;
	route_id: string | null;
	method: string;
	path: string;
	status_code: number;
	latency_ms: number;
	cached: number;
	client_id: string | null;
	user_id: string | null;
	ip: string | null;
	error_code: string | null;
	error_message: string | null;
	backend_service: string | null;
	retry_count: number;
	timestamp: string;
}

// ============================================================================
// Factory Functions
// ============================================================================

let apiGatewayInstance: APIGatewaySystem | null = null;

export function getAPIGateway(config?: GatewayConfig): APIGatewaySystem {
	if (!apiGatewayInstance) {
		if (!config) {
			throw new Error("APIGatewaySystem requires config on first initialization");
		}
		apiGatewayInstance = new APIGatewaySystem(config);
	}
	return apiGatewayInstance;
}

export function resetAPIGateway(): void {
	if (apiGatewayInstance) {
		apiGatewayInstance.shutdown();
		apiGatewayInstance = null;
	}
}
