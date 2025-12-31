/**
 * Class 3.52: Dependency Injector
 * IoC (Inversion of Control) container for agent dependencies
 *
 * Features:
 * - Service registration with multiple lifetimes (singleton, transient, scoped)
 * - Constructor injection with automatic dependency resolution
 * - Factory providers for complex instantiation
 * - Lazy loading for deferred initialization
 * - Circular dependency detection
 * - Child containers for request-scoped dependencies
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

/** Service lifetime options */
export type ServiceLifetime = "singleton" | "transient" | "scoped";

/** Service token - can be string, symbol, or constructor */
export type ServiceToken<T = unknown> = string | symbol | (new (...args: unknown[]) => T);

/** Factory function type */
export type FactoryFunction<T> = (container: DIContainer) => T | Promise<T>;

/** Service descriptor */
export interface ServiceDescriptor<T = unknown> {
	/** Token to identify the service */
	token: ServiceToken<T>;
	/** Service lifetime */
	lifetime: ServiceLifetime;
	/** Factory function to create the service */
	factory?: FactoryFunction<T>;
	/** Constructor class (for auto-wiring) */
	implementation?: new (
		...args: unknown[]
	) => T;
	/** Pre-created instance (for singleton only) */
	instance?: T;
	/** Dependencies to inject (tokens or param indices) */
	dependencies?: ServiceToken[];
	/** Whether to lazy load */
	lazy?: boolean;
	/** Optional tags for grouping */
	tags?: string[];
}

/** Registration options */
export interface RegistrationOptions<_T = unknown> {
	/** Service lifetime */
	lifetime?: ServiceLifetime;
	/** Dependencies to inject */
	dependencies?: ServiceToken[];
	/** Whether to lazy load */
	lazy?: boolean;
	/** Tags for grouping */
	tags?: string[];
}

/** Lazy wrapper for deferred initialization */
export interface Lazy<T> {
	/** Get the value (initializes on first access) */
	value: T;
	/** Whether the value has been initialized */
	isInitialized: boolean;
}

/** Resolution context for tracking dependencies */
export interface ResolutionContext {
	/** Current resolution stack (for circular detection) */
	stack: ServiceToken[];
	/** Scoped instances for this resolution */
	scopedInstances: Map<ServiceToken, unknown>;
}

/** Container events */
export type DIContainerEventType =
	| "service:registered"
	| "service:resolved"
	| "service:disposed"
	| "scope:created"
	| "scope:disposed"
	| "error";

/** Container event payload */
export interface DIContainerEvent {
	type: DIContainerEventType;
	token?: ServiceToken;
	lifetime?: ServiceLifetime;
	error?: Error;
	timestamp: number;
}

/** Container configuration */
export interface DIContainerConfig {
	/** Parent container (for child containers) */
	parent?: DIContainer;
	/** Enable strict mode (throws on missing services) */
	strict?: boolean;
	/** Enable debug logging */
	debug?: boolean;
	/** Maximum resolution depth (circular detection) */
	maxResolutionDepth?: number;
}

/** Container statistics */
export interface DIContainerStats {
	totalRegistrations: number;
	singletons: number;
	transients: number;
	scoped: number;
	resolvedCount: number;
	lazyCount: number;
	childContainers: number;
}

// =============================================================================
// Errors
// =============================================================================

export class DIError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly token?: ServiceToken,
	) {
		super(message);
		this.name = "DIError";
	}
}

export class ServiceNotFoundError extends DIError {
	constructor(token: ServiceToken) {
		super(`Service not found: ${String(token)}`, "SERVICE_NOT_FOUND", token);
		this.name = "ServiceNotFoundError";
	}
}

export class CircularDependencyError extends DIError {
	constructor(
		token: ServiceToken,
		public readonly chain: ServiceToken[],
	) {
		const chainStr = chain.map((t) => String(t)).join(" -> ");
		super(`Circular dependency detected: ${chainStr} -> ${String(token)}`, "CIRCULAR_DEPENDENCY", token);
		this.name = "CircularDependencyError";
	}
}

export class ResolutionDepthError extends DIError {
	constructor(
		token: ServiceToken,
		public readonly depth: number,
	) {
		super(`Maximum resolution depth (${depth}) exceeded for: ${String(token)}`, "RESOLUTION_DEPTH_EXCEEDED", token);
		this.name = "ResolutionDepthError";
	}
}

// =============================================================================
// Lazy Wrapper Implementation
// =============================================================================

class LazyImpl<T> implements Lazy<T> {
	private _value: T | undefined;
	private _isInitialized = false;
	private _initializer: () => T;

	constructor(initializer: () => T) {
		this._initializer = initializer;
	}

	get value(): T {
		if (!this._isInitialized) {
			this._value = this._initializer();
			this._isInitialized = true;
		}
		return this._value as T;
	}

	get isInitialized(): boolean {
		return this._isInitialized;
	}
}

// =============================================================================
// DI Container Implementation
// =============================================================================

export class DIContainer extends EventEmitter {
	private services = new Map<ServiceToken, ServiceDescriptor>();
	private singletons = new Map<ServiceToken, unknown>();
	private childContainers = new Set<DIContainer>();
	private resolvedCount = 0;
	private config: Required<DIContainerConfig>;

	constructor(config: DIContainerConfig = {}) {
		super();
		this.config = {
			parent: config.parent ?? undefined!,
			strict: config.strict ?? true,
			debug: config.debug ?? false,
			maxResolutionDepth: config.maxResolutionDepth ?? 50,
		};

		// Register self
		this.registerInstance("DIContainer" as ServiceToken<DIContainer>, this);
	}

	// =========================================================================
	// Registration Methods
	// =========================================================================

	/**
	 * Register a service with a factory function
	 */
	register<T>(token: ServiceToken<T>, factory: FactoryFunction<T>, options: RegistrationOptions<T> = {}): this {
		const descriptor: ServiceDescriptor<T> = {
			token,
			factory,
			lifetime: options.lifetime ?? "transient",
			dependencies: options.dependencies,
			lazy: options.lazy ?? false,
			tags: options.tags,
		};

		this.services.set(token, descriptor);
		this.emitEvent("service:registered", { token, lifetime: descriptor.lifetime });

		if (this.config.debug) {
			console.log(`[DI] Registered: ${String(token)} (${descriptor.lifetime})`);
		}

		return this;
	}

	/**
	 * Register a class with constructor injection
	 */
	registerClass<T>(
		token: ServiceToken<T>,
		implementation: new (...args: unknown[]) => T,
		options: RegistrationOptions<T> = {},
	): this {
		const descriptor: ServiceDescriptor<T> = {
			token,
			implementation,
			lifetime: options.lifetime ?? "transient",
			dependencies: options.dependencies ?? [],
			lazy: options.lazy ?? false,
			tags: options.tags,
		};

		this.services.set(token, descriptor);
		this.emitEvent("service:registered", { token, lifetime: descriptor.lifetime });

		if (this.config.debug) {
			console.log(`[DI] Registered class: ${String(token)} -> ${implementation.name}`);
		}

		return this;
	}

	/**
	 * Register a singleton instance directly
	 */
	registerInstance<T>(token: ServiceToken<T>, instance: T): this {
		const descriptor: ServiceDescriptor<T> = {
			token,
			instance,
			lifetime: "singleton",
		};

		this.services.set(token, descriptor);
		this.singletons.set(token, instance);
		this.emitEvent("service:registered", { token, lifetime: "singleton" });

		if (this.config.debug) {
			console.log(`[DI] Registered instance: ${String(token)}`);
		}

		return this;
	}

	/**
	 * Register a singleton factory (lazy initialization)
	 */
	registerSingleton<T>(
		token: ServiceToken<T>,
		factory: FactoryFunction<T>,
		options: Omit<RegistrationOptions<T>, "lifetime"> = {},
	): this {
		return this.register(token, factory, { ...options, lifetime: "singleton" });
	}

	/**
	 * Register a transient factory (new instance each time)
	 */
	registerTransient<T>(
		token: ServiceToken<T>,
		factory: FactoryFunction<T>,
		options: Omit<RegistrationOptions<T>, "lifetime"> = {},
	): this {
		return this.register(token, factory, { ...options, lifetime: "transient" });
	}

	/**
	 * Register a scoped factory (one instance per scope)
	 */
	registerScoped<T>(
		token: ServiceToken<T>,
		factory: FactoryFunction<T>,
		options: Omit<RegistrationOptions<T>, "lifetime"> = {},
	): this {
		return this.register(token, factory, { ...options, lifetime: "scoped" });
	}

	/**
	 * Register with auto-wiring (infer dependencies from constructor)
	 */
	registerAuto<T>(
		token: ServiceToken<T>,
		implementation: new (...args: unknown[]) => T,
		options: RegistrationOptions<T> = {},
	): this {
		// Note: Full auto-wiring requires decorators/reflect-metadata
		// This is a simplified version that uses explicit dependencies
		return this.registerClass(token, implementation, options);
	}

	// =========================================================================
	// Resolution Methods
	// =========================================================================

	/**
	 * Resolve a service by token
	 */
	resolve<T>(token: ServiceToken<T>, context?: ResolutionContext): T {
		const ctx = context ?? this.createResolutionContext();

		// Check for circular dependencies
		if (ctx.stack.includes(token)) {
			throw new CircularDependencyError(token, ctx.stack);
		}

		// Check resolution depth
		if (ctx.stack.length >= this.config.maxResolutionDepth) {
			throw new ResolutionDepthError(token, this.config.maxResolutionDepth);
		}

		// Push to stack
		ctx.stack.push(token);

		try {
			const result = this.resolveInternal<T>(token, ctx);
			this.resolvedCount++;
			this.emitEvent("service:resolved", { token });
			return result;
		} finally {
			// Pop from stack
			ctx.stack.pop();
		}
	}

	/**
	 * Resolve a service asynchronously
	 */
	async resolveAsync<T>(token: ServiceToken<T>, context?: ResolutionContext): Promise<T> {
		const ctx = context ?? this.createResolutionContext();

		if (ctx.stack.includes(token)) {
			throw new CircularDependencyError(token, ctx.stack);
		}

		if (ctx.stack.length >= this.config.maxResolutionDepth) {
			throw new ResolutionDepthError(token, this.config.maxResolutionDepth);
		}

		ctx.stack.push(token);

		try {
			const result = await this.resolveInternalAsync<T>(token, ctx);
			this.resolvedCount++;
			this.emitEvent("service:resolved", { token });
			return result;
		} finally {
			ctx.stack.pop();
		}
	}

	/**
	 * Try to resolve a service, returning undefined if not found
	 */
	tryResolve<T>(token: ServiceToken<T>): T | undefined {
		try {
			return this.resolve(token);
		} catch (error) {
			if (error instanceof ServiceNotFoundError) {
				return undefined;
			}
			throw error;
		}
	}

	/**
	 * Resolve a lazy wrapper
	 */
	resolveLazy<T>(token: ServiceToken<T>): Lazy<T> {
		return new LazyImpl(() => this.resolve<T>(token));
	}

	/**
	 * Resolve all services with a specific tag
	 */
	resolveByTag<T>(tag: string): T[] {
		const results: T[] = [];

		for (const [token, descriptor] of this.services) {
			if (descriptor.tags?.includes(tag)) {
				results.push(this.resolve<T>(token as ServiceToken<T>));
			}
		}

		return results;
	}

	/**
	 * Resolve multiple services by tokens
	 */
	resolveMany<T extends unknown[]>(...tokens: { [K in keyof T]: ServiceToken<T[K]> }): T {
		return tokens.map((token) => this.resolve(token)) as T;
	}

	// =========================================================================
	// Internal Resolution
	// =========================================================================

	private resolveInternal<T>(token: ServiceToken<T>, context: ResolutionContext): T {
		// Check for existing singleton
		if (this.singletons.has(token)) {
			return this.singletons.get(token) as T;
		}

		// Check for scoped instance
		if (context.scopedInstances.has(token)) {
			return context.scopedInstances.get(token) as T;
		}

		// Get descriptor
		const descriptor = this.getDescriptor<T>(token);
		if (!descriptor) {
			// Try parent container
			if (this.config.parent) {
				return this.config.parent.resolve(token, context);
			}

			if (this.config.strict) {
				throw new ServiceNotFoundError(token);
			}

			return undefined as T;
		}

		// Create instance
		const instance = this.createInstance<T>(descriptor, context);

		// Store based on lifetime
		if (descriptor.lifetime === "singleton") {
			this.singletons.set(token, instance);
		} else if (descriptor.lifetime === "scoped") {
			context.scopedInstances.set(token, instance);
		}

		return instance;
	}

	private async resolveInternalAsync<T>(token: ServiceToken<T>, context: ResolutionContext): Promise<T> {
		// Check for existing singleton
		if (this.singletons.has(token)) {
			return this.singletons.get(token) as T;
		}

		// Check for scoped instance
		if (context.scopedInstances.has(token)) {
			return context.scopedInstances.get(token) as T;
		}

		// Get descriptor
		const descriptor = this.getDescriptor<T>(token);
		if (!descriptor) {
			if (this.config.parent) {
				return this.config.parent.resolveAsync(token, context);
			}

			if (this.config.strict) {
				throw new ServiceNotFoundError(token);
			}

			return undefined as T;
		}

		// Create instance (may be async)
		const instance = await this.createInstanceAsync<T>(descriptor, context);

		// Store based on lifetime
		if (descriptor.lifetime === "singleton") {
			this.singletons.set(token, instance);
		} else if (descriptor.lifetime === "scoped") {
			context.scopedInstances.set(token, instance);
		}

		return instance;
	}

	private createInstance<T>(descriptor: ServiceDescriptor<T>, context: ResolutionContext): T {
		// If instance exists, return it
		if (descriptor.instance !== undefined) {
			return descriptor.instance;
		}

		// Resolve dependencies
		const dependencies: unknown[] = [];
		if (descriptor.dependencies) {
			for (const depToken of descriptor.dependencies) {
				dependencies.push(this.resolve(depToken, context));
			}
		}

		// Use factory if available
		if (descriptor.factory) {
			const result = descriptor.factory(this);
			if (result instanceof Promise) {
				throw new DIError(
					`Factory for ${String(descriptor.token)} returned a Promise. Use resolveAsync() instead.`,
					"ASYNC_FACTORY",
					descriptor.token,
				);
			}
			return result;
		}

		// Use constructor if available
		if (descriptor.implementation) {
			return new descriptor.implementation(...dependencies);
		}

		throw new DIError(
			`No factory or implementation for service: ${String(descriptor.token)}`,
			"NO_PROVIDER",
			descriptor.token,
		);
	}

	private async createInstanceAsync<T>(descriptor: ServiceDescriptor<T>, context: ResolutionContext): Promise<T> {
		if (descriptor.instance !== undefined) {
			return descriptor.instance;
		}

		// Resolve dependencies
		const dependencies: unknown[] = [];
		if (descriptor.dependencies) {
			for (const depToken of descriptor.dependencies) {
				dependencies.push(await this.resolveAsync(depToken, context));
			}
		}

		// Use factory if available
		if (descriptor.factory) {
			return descriptor.factory(this);
		}

		// Use constructor if available
		if (descriptor.implementation) {
			return new descriptor.implementation(...dependencies);
		}

		throw new DIError(
			`No factory or implementation for service: ${String(descriptor.token)}`,
			"NO_PROVIDER",
			descriptor.token,
		);
	}

	// =========================================================================
	// Scope Management
	// =========================================================================

	/**
	 * Create a child container (inherits parent registrations)
	 */
	createChild(config?: Omit<DIContainerConfig, "parent">): DIContainer {
		const child = new DIContainer({
			...config,
			parent: this,
		});

		this.childContainers.add(child);
		this.emitEvent("scope:created");

		if (this.config.debug) {
			console.log("[DI] Created child container");
		}

		return child;
	}

	/**
	 * Create a scoped resolution context
	 */
	createScope(): { container: DIContainer; dispose: () => void } {
		const scope = this.createChild();
		const scopedInstances = new Map<ServiceToken, unknown>();

		return {
			container: scope,
			dispose: () => {
				this.disposeScope(scope);
				scopedInstances.clear();
			},
		};
	}

	/**
	 * Dispose a child scope
	 */
	private disposeScope(child: DIContainer): void {
		this.childContainers.delete(child);
		child.dispose();
		this.emitEvent("scope:disposed");

		if (this.config.debug) {
			console.log("[DI] Disposed child container");
		}
	}

	// =========================================================================
	// Container Management
	// =========================================================================

	/**
	 * Check if a service is registered
	 */
	has(token: ServiceToken): boolean {
		if (this.services.has(token)) {
			return true;
		}

		if (this.config.parent) {
			return this.config.parent.has(token);
		}

		return false;
	}

	/**
	 * Unregister a service
	 */
	unregister(token: ServiceToken): boolean {
		const existed = this.services.delete(token);
		this.singletons.delete(token);

		if (existed) {
			this.emitEvent("service:disposed", { token });

			if (this.config.debug) {
				console.log(`[DI] Unregistered: ${String(token)}`);
			}
		}

		return existed;
	}

	/**
	 * Clear all registrations
	 */
	clear(): void {
		this.services.clear();
		this.singletons.clear();
		this.resolvedCount = 0;

		if (this.config.debug) {
			console.log("[DI] Cleared all registrations");
		}
	}

	/**
	 * Dispose the container and all child containers
	 */
	dispose(): void {
		// Dispose children first
		for (const child of this.childContainers) {
			child.dispose();
		}
		this.childContainers.clear();

		// Clear services
		this.clear();

		// Remove all listeners
		this.removeAllListeners();

		if (this.config.debug) {
			console.log("[DI] Container disposed");
		}
	}

	// =========================================================================
	// Utility Methods
	// =========================================================================

	/**
	 * Get service descriptor
	 */
	private getDescriptor<T>(token: ServiceToken<T>): ServiceDescriptor<T> | undefined {
		return this.services.get(token) as ServiceDescriptor<T> | undefined;
	}

	/**
	 * Create a fresh resolution context
	 */
	private createResolutionContext(): ResolutionContext {
		return {
			stack: [],
			scopedInstances: new Map(),
		};
	}

	/**
	 * Emit a container event
	 */
	private emitEvent(type: DIContainerEventType, data: Partial<DIContainerEvent> = {}): void {
		const event: DIContainerEvent = {
			type,
			timestamp: Date.now(),
			...data,
		};
		this.emit(type, event);
	}

	/**
	 * Get all registered service tokens
	 */
	getRegisteredTokens(): ServiceToken[] {
		return Array.from(this.services.keys());
	}

	/**
	 * Get tokens by tag
	 */
	getTokensByTag(tag: string): ServiceToken[] {
		const tokens: ServiceToken[] = [];

		for (const [token, descriptor] of this.services) {
			if (descriptor.tags?.includes(tag)) {
				tokens.push(token);
			}
		}

		return tokens;
	}

	/**
	 * Get container statistics
	 */
	getStats(): DIContainerStats {
		let singletons = 0;
		let transients = 0;
		let scoped = 0;
		let lazyCount = 0;

		for (const descriptor of this.services.values()) {
			switch (descriptor.lifetime) {
				case "singleton":
					singletons++;
					break;
				case "transient":
					transients++;
					break;
				case "scoped":
					scoped++;
					break;
			}

			if (descriptor.lazy) {
				lazyCount++;
			}
		}

		return {
			totalRegistrations: this.services.size,
			singletons,
			transients,
			scoped,
			resolvedCount: this.resolvedCount,
			lazyCount,
			childContainers: this.childContainers.size,
		};
	}

	/**
	 * Export container state for debugging
	 */
	export(): {
		services: Array<{ token: string; lifetime: ServiceLifetime; tags?: string[] }>;
		singletons: string[];
		stats: DIContainerStats;
	} {
		return {
			services: Array.from(this.services.entries()).map(([token, desc]) => ({
				token: String(token),
				lifetime: desc.lifetime,
				tags: desc.tags,
			})),
			singletons: Array.from(this.singletons.keys()).map((t) => String(t)),
			stats: this.getStats(),
		};
	}
}

// =============================================================================
// Service Registration Decorators (for use with reflect-metadata)
// =============================================================================

/**
 * Token symbol for dependency metadata
 */
export const INJECT_METADATA_KEY = Symbol("inject:dependencies");

/**
 * Create an injection token
 */
export function createToken<T>(name: string): ServiceToken<T> {
	return Symbol.for(`di:${name}`) as ServiceToken<T>;
}

// =============================================================================
// Singleton Access
// =============================================================================

let containerInstance: DIContainer | null = null;

/**
 * Get the global DI container instance
 */
export function getDIContainer(config?: DIContainerConfig): DIContainer {
	if (!containerInstance) {
		containerInstance = new DIContainer(config);
	}
	return containerInstance;
}

/**
 * Reset the global DI container (for testing)
 */
export function resetDIContainer(): void {
	if (containerInstance) {
		containerInstance.dispose();
		containerInstance = null;
	}
}

/**
 * Initialize the container with common services
 */
export function initDIContainer(config?: DIContainerConfig): DIContainer {
	resetDIContainer();
	containerInstance = new DIContainer(config);
	return containerInstance;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a factory that resolves dependencies automatically
 */
export function createFactory<T, D extends unknown[]>(
	implementation: new (...args: D) => T,
	...dependencyTokens: { [K in keyof D]: ServiceToken<D[K]> }
): FactoryFunction<T> {
	return (container: DIContainer) => {
		const deps = dependencyTokens.map((token) => container.resolve(token)) as D;
		return new implementation(...deps);
	};
}

/**
 * Create a lazy factory
 */
export function createLazyFactory<T>(factory: FactoryFunction<T>): FactoryFunction<Lazy<T>> {
	return (container: DIContainer) => {
		return new LazyImpl(() => {
			const result = factory(container);
			if (result instanceof Promise) {
				throw new Error("Lazy factories cannot return Promises");
			}
			return result;
		});
	};
}

/**
 * Bind decorator helper (for manual decoration)
 */
export function bindTo<T>(
	container: DIContainer,
	token: ServiceToken<T>,
	implementation: new (...args: unknown[]) => T,
	options: RegistrationOptions<T> = {},
): void {
	container.registerClass(token, implementation, options);
}

// =============================================================================
// Common Service Tokens
// =============================================================================

export const Tokens = {
	Logger: createToken<{ log: (...args: unknown[]) => void }>("Logger"),
	Config: createToken<Record<string, unknown>>("Config"),
	EventBus: createToken<EventEmitter>("EventBus"),
	Database: createToken<unknown>("Database"),
	HttpClient: createToken<unknown>("HttpClient"),
	Cache: createToken<Map<string, unknown>>("Cache"),
} as const;
