/**
 * State Machine - Generic Finite State Machine for Workflow Orchestration
 *
 * A comprehensive state machine implementation supporting:
 * - State definitions with entry/exit actions
 * - Transitions with guards (conditions)
 * - Hierarchical/nested states
 * - History states (shallow and deep)
 * - Parallel regions (concurrent state execution)
 * - Event queue with priority support
 *
 * Based on UML state machine semantics with practical workflow extensions.
 *
 * Example:
 * ```typescript
 * const machine = createStateMachine({
 *   id: 'order-workflow',
 *   initial: 'pending',
 *   states: {
 *     pending: {
 *       on: { SUBMIT: 'processing' },
 *       onEntry: () => console.log('Order created'),
 *     },
 *     processing: {
 *       on: {
 *         APPROVE: { target: 'approved', guard: (ctx) => ctx.amount < 1000 },
 *         REJECT: 'rejected',
 *       },
 *     },
 *     approved: { type: 'final' },
 *     rejected: { type: 'final' },
 *   },
 * });
 *
 * machine.start();
 * machine.send('SUBMIT');
 * machine.send('APPROVE');
 * ```
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

/** State type classification */
export type StateType = "atomic" | "compound" | "parallel" | "final" | "history";

/** History type for history states */
export type HistoryType = "shallow" | "deep";

/** Transition target - can be string state name or transition object */
export type TransitionTarget<TContext> =
	| string
	| {
			target: string;
			guard?: TransitionGuard<TContext>;
			actions?: TransitionAction<TContext>[];
	  };

/** Guard function - determines if transition can fire */
export type TransitionGuard<TContext> = (context: TContext, event: StateMachineEvent) => boolean;

/** Action function - executed during transitions or state entry/exit */
export type TransitionAction<TContext> = (context: TContext, event: StateMachineEvent) => void | Promise<void>;

/** Context updater function */
export type ContextUpdater<TContext> = (context: TContext, event: StateMachineEvent) => Partial<TContext>;

/** Event that triggers transitions */
export interface StateMachineEvent {
	type: string;
	payload?: Record<string, unknown>;
	priority?: number;
	timestamp?: number;
}

/** State definition */
export interface StateDefinition<TContext> {
	/** State type (default: atomic) */
	type?: StateType;

	/** Initial child state for compound states */
	initial?: string;

	/** Transitions keyed by event type */
	on?: Record<string, TransitionTarget<TContext> | TransitionTarget<TContext>[]>;

	/** Entry actions */
	onEntry?: TransitionAction<TContext> | TransitionAction<TContext>[];

	/** Exit actions */
	onExit?: TransitionAction<TContext> | TransitionAction<TContext>[];

	/** Child states for compound/parallel states */
	states?: Record<string, StateDefinition<TContext>>;

	/** History type for history states */
	history?: HistoryType;

	/** Activity that runs while in this state */
	activities?: Array<(context: TContext) => () => void>;

	/** Data associated with state */
	data?: Record<string, unknown>;

	/** Description for documentation */
	description?: string;
}

/** State machine configuration */
export interface StateMachineConfig<TContext> {
	/** Unique machine identifier */
	id: string;

	/** Initial state */
	initial: string;

	/** State definitions */
	states: Record<string, StateDefinition<TContext>>;

	/** Initial context */
	context?: TContext;

	/** Global event handlers (always checked) */
	on?: Record<string, TransitionTarget<TContext>>;

	/** Actions to run on machine start */
	onStart?: TransitionAction<TContext>[];

	/** Actions to run on machine stop */
	onStop?: TransitionAction<TContext>[];

	/** Enable strict mode (throws on invalid transitions) */
	strict?: boolean;

	/** Maximum event queue size */
	maxQueueSize?: number;

	/** Enable debug logging */
	debug?: boolean;
}

/** Current state value - can be string or nested object for parallel states */
export type StateValue = string | { [key: string]: StateValue };

/** Snapshot of machine state */
export interface StateMachineSnapshot<TContext> {
	/** Current state value */
	value: StateValue;

	/** Current context */
	context: TContext;

	/** History of state values */
	history: StateValue[];

	/** Is machine running */
	running: boolean;

	/** Is in final state */
	done: boolean;

	/** Timestamp */
	timestamp: number;
}

/** Transition record for history */
export interface TransitionRecord {
	from: StateValue;
	to: StateValue;
	event: StateMachineEvent;
	timestamp: number;
}

/** State machine statistics */
export interface StateMachineStats {
	id: string;
	currentState: StateValue;
	transitionCount: number;
	eventCount: number;
	queueSize: number;
	uptime: number;
	isRunning: boolean;
	isDone: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize transition target to consistent format
 */
function normalizeTarget<TContext>(target: TransitionTarget<TContext>): {
	target: string;
	guard?: TransitionGuard<TContext>;
	actions?: TransitionAction<TContext>[];
} {
	if (typeof target === "string") {
		return { target };
	}
	return target;
}

/**
 * Convert state value to string path
 */
function stateValueToPath(value: StateValue): string {
	if (typeof value === "string") {
		return value;
	}
	return Object.entries(value)
		.map(([region, subValue]) => `${region}:${stateValueToPath(subValue)}`)
		.join(",");
}

/**
 * Get state definition from path
 */
function getStateDefinition<TContext>(
	states: Record<string, StateDefinition<TContext>>,
	path: string,
): StateDefinition<TContext> | undefined {
	const parts = path.split(".");
	let current: Record<string, StateDefinition<TContext>> | undefined = states;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!current || !current[part]) {
			return undefined;
		}
		const state: StateDefinition<TContext> = current[part];
		if (i === parts.length - 1) {
			return state;
		}
		current = state.states;
	}

	return undefined;
}

/**
 * Check if state is a final state
 */
function isFinalState<TContext>(states: Record<string, StateDefinition<TContext>>, value: StateValue): boolean {
	if (typeof value === "string") {
		const state = getStateDefinition(states, value);
		return state?.type === "final";
	}
	// For parallel states, all regions must be in final state
	return Object.values(value).every((subValue) => isFinalState(states, subValue));
}

// ============================================================================
// State Machine Class
// ============================================================================

export class StateMachine<TContext = Record<string, unknown>> extends EventEmitter {
	private config: StateMachineConfig<TContext>;
	private _context: TContext;
	private _value: StateValue;
	private _running = false;
	private _done = false;
	private eventQueue: StateMachineEvent[] = [];
	private processing = false;
	private transitionHistory: TransitionRecord[] = [];
	private stateHistory: Map<string, StateValue> = new Map();
	private activeActivities: Array<() => void> = [];
	private eventCount = 0;
	private transitionCount = 0;
	private startTime = 0;
	private maxHistorySize = 100;

	constructor(config: StateMachineConfig<TContext>) {
		super();
		this.config = config;
		this._context = (config.context ?? {}) as TContext;
		this._value = config.initial;
	}

	// =========================================================================
	// Public Getters
	// =========================================================================

	/** Get current state value */
	get value(): StateValue {
		return this._value;
	}

	/** Get current context */
	get context(): TContext {
		return this._context;
	}

	/** Check if machine is running */
	get isRunning(): boolean {
		return this._running;
	}

	/** Check if machine reached final state */
	get isDone(): boolean {
		return this._done;
	}

	/** Get machine ID */
	get id(): string {
		return this.config.id;
	}

	// =========================================================================
	// Lifecycle Methods
	// =========================================================================

	/**
	 * Start the state machine
	 */
	async start(): Promise<void> {
		if (this._running) {
			this.log("Machine already running");
			return;
		}

		this._running = true;
		this._done = false;
		this.startTime = Date.now();

		this.log(`Starting machine in state: ${stateValueToPath(this._value)}`);

		// Run start actions
		if (this.config.onStart) {
			await this.executeActions(this.config.onStart, { type: "__start__" });
		}

		// Enter initial state
		await this.enterState(this._value, { type: "__start__" });

		this.emit("start", this.getSnapshot());

		// Process any queued events
		await this.processQueue();
	}

	/**
	 * Stop the state machine
	 */
	async stop(): Promise<void> {
		if (!this._running) {
			return;
		}

		this.log("Stopping machine");

		// Exit current state
		await this.exitState(this._value, { type: "__stop__" });

		// Stop all activities
		this.stopActivities();

		// Run stop actions
		if (this.config.onStop) {
			await this.executeActions(this.config.onStop, { type: "__stop__" });
		}

		this._running = false;
		this.emit("stop", this.getSnapshot());
	}

	/**
	 * Reset machine to initial state
	 */
	async reset(): Promise<void> {
		await this.stop();
		this._value = this.config.initial;
		this._context = (this.config.context ?? {}) as TContext;
		this._done = false;
		this.eventQueue = [];
		this.transitionHistory = [];
		this.stateHistory.clear();
		this.eventCount = 0;
		this.transitionCount = 0;
		this.emit("reset", this.getSnapshot());
	}

	// =========================================================================
	// Event Handling
	// =========================================================================

	/**
	 * Send an event to the state machine
	 */
	send(eventOrType: string | StateMachineEvent, payload?: Record<string, unknown>): void {
		const event: StateMachineEvent =
			typeof eventOrType === "string"
				? { type: eventOrType, payload, timestamp: Date.now() }
				: { ...eventOrType, timestamp: eventOrType.timestamp ?? Date.now() };

		this.eventCount++;
		this.log(`Event received: ${event.type}`);

		// Check queue size limit
		if (this.config.maxQueueSize && this.eventQueue.length >= this.config.maxQueueSize) {
			this.emit("error", new Error(`Event queue full (max: ${this.config.maxQueueSize})`));
			return;
		}

		// Add to queue with priority sorting
		this.eventQueue.push(event);
		this.eventQueue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

		// Process if not already processing
		if (!this.processing && this._running) {
			this.processQueue().catch((err) => this.emit("error", err));
		}
	}

	/**
	 * Send event and wait for transition to complete
	 */
	async sendAsync(eventOrType: string | StateMachineEvent, payload?: Record<string, unknown>): Promise<StateValue> {
		return new Promise((resolve) => {
			const handler = (record: TransitionRecord) => {
				this.off("transition", handler);
				resolve(record.to);
			};
			this.on("transition", handler);
			this.send(eventOrType, payload);
		});
	}

	// =========================================================================
	// State Queries
	// =========================================================================

	/**
	 * Check if machine is in a specific state
	 */
	matches(stateValue: StateValue): boolean {
		return this.matchesValue(this._value, stateValue);
	}

	/**
	 * Check if a transition is possible for an event
	 */
	can(eventType: string): boolean {
		const event: StateMachineEvent = { type: eventType };
		const transition = this.findTransition(this._value, event);
		return transition !== null;
	}

	/**
	 * Get available events from current state
	 */
	getAvailableEvents(): string[] {
		const events = new Set<string>();
		this.collectAvailableEvents(this._value, events);

		// Add global events
		if (this.config.on) {
			Object.keys(this.config.on).forEach((e) => events.add(e));
		}

		return Array.from(events);
	}

	/**
	 * Get state definition for current or specified state
	 */
	getStateDefinition(path?: string): StateDefinition<TContext> | undefined {
		const statePath = path ?? (typeof this._value === "string" ? this._value : "");
		return getStateDefinition(this.config.states, statePath);
	}

	// =========================================================================
	// Snapshot & History
	// =========================================================================

	/**
	 * Get current snapshot of machine state
	 */
	getSnapshot(): StateMachineSnapshot<TContext> {
		return {
			value: this._value,
			context: { ...this._context },
			history: this.transitionHistory.map((t) => t.to),
			running: this._running,
			done: this._done,
			timestamp: Date.now(),
		};
	}

	/**
	 * Get transition history
	 */
	getTransitionHistory(): TransitionRecord[] {
		return [...this.transitionHistory];
	}

	/**
	 * Get statistics
	 */
	getStats(): StateMachineStats {
		return {
			id: this.config.id,
			currentState: this._value,
			transitionCount: this.transitionCount,
			eventCount: this.eventCount,
			queueSize: this.eventQueue.length,
			uptime: this._running ? Date.now() - this.startTime : 0,
			isRunning: this._running,
			isDone: this._done,
		};
	}

	// =========================================================================
	// Context Management
	// =========================================================================

	/**
	 * Update context
	 */
	updateContext(updater: ContextUpdater<TContext> | Partial<TContext>): void {
		const updates = typeof updater === "function" ? updater(this._context, { type: "__update__" }) : updater;

		this._context = { ...this._context, ...updates };
		this.emit("contextUpdate", this._context);
	}

	// =========================================================================
	// Serialization
	// =========================================================================

	/**
	 * Serialize machine state for persistence
	 */
	serialize(): string {
		return JSON.stringify({
			value: this._value,
			context: this._context,
			history: this.transitionHistory,
			stateHistory: Array.from(this.stateHistory.entries()),
		});
	}

	/**
	 * Restore machine state from serialized data
	 */
	deserialize(data: string): void {
		const parsed = JSON.parse(data);
		this._value = parsed.value;
		this._context = parsed.context;
		this.transitionHistory = parsed.history || [];
		this.stateHistory = new Map(parsed.stateHistory || []);
	}

	// =========================================================================
	// Private Methods - Event Processing
	// =========================================================================

	private async processQueue(): Promise<void> {
		if (this.processing || !this._running) {
			return;
		}

		this.processing = true;

		try {
			while (this.eventQueue.length > 0 && this._running && !this._done) {
				const event = this.eventQueue.shift()!;
				await this.processEvent(event);
			}
		} finally {
			this.processing = false;
		}
	}

	private async processEvent(event: StateMachineEvent): Promise<void> {
		this.log(`Processing event: ${event.type}`);
		this.emit("event", event);

		// Find applicable transition
		const transition = this.findTransition(this._value, event);

		if (!transition) {
			this.log(`No transition found for event: ${event.type}`);
			if (this.config.strict) {
				throw new Error(`No transition for event "${event.type}" from state "${stateValueToPath(this._value)}"`);
			}
			this.emit("eventIgnored", { event, state: this._value });
			return;
		}

		// Execute transition
		await this.executeTransition(transition, event);
	}

	private findTransition(
		stateValue: StateValue,
		event: StateMachineEvent,
	): { target: string; actions?: TransitionAction<TContext>[] } | null {
		// Check global handlers first
		if (this.config.on?.[event.type]) {
			const globalTransition = this.evaluateTransition(this.config.on[event.type], event);
			if (globalTransition) {
				return globalTransition;
			}
		}

		// Check state-specific handlers
		return this.findStateTransition(stateValue, event);
	}

	private findStateTransition(
		stateValue: StateValue,
		event: StateMachineEvent,
	): { target: string; actions?: TransitionAction<TContext>[] } | null {
		if (typeof stateValue === "string") {
			const stateDef = getStateDefinition(this.config.states, stateValue);
			if (!stateDef) {
				return null;
			}

			// Check compound state children first
			if (stateDef.states && stateDef.initial) {
				const childTransition = this.findStateTransition(stateDef.initial, event);
				if (childTransition) {
					return childTransition;
				}
			}

			// Check state's own transitions
			if (stateDef.on?.[event.type]) {
				return this.evaluateTransition(stateDef.on[event.type], event);
			}
		} else {
			// Parallel state - check all regions
			for (const [, regionValue] of Object.entries(stateValue)) {
				const transition = this.findStateTransition(regionValue, event);
				if (transition) {
					return transition;
				}
			}
		}

		return null;
	}

	private evaluateTransition(
		target: TransitionTarget<TContext> | TransitionTarget<TContext>[],
		event: StateMachineEvent,
	): { target: string; actions?: TransitionAction<TContext>[] } | null {
		const targets = Array.isArray(target) ? target : [target];

		for (const t of targets) {
			const normalized = normalizeTarget(t);

			// Check guard
			if (normalized.guard && !normalized.guard(this._context, event)) {
				continue;
			}

			return { target: normalized.target, actions: normalized.actions };
		}

		return null;
	}

	// =========================================================================
	// Private Methods - Transition Execution
	// =========================================================================

	private async executeTransition(
		transition: { target: string; actions?: TransitionAction<TContext>[] },
		event: StateMachineEvent,
	): Promise<void> {
		const fromState = this._value;
		const toState = this.resolveTargetState(transition.target);

		this.log(`Transitioning: ${stateValueToPath(fromState)} -> ${stateValueToPath(toState)}`);

		// Record history before transition
		this.recordHistory(fromState);

		// Exit current state
		await this.exitState(fromState, event);

		// Execute transition actions
		if (transition.actions) {
			await this.executeActions(transition.actions, event);
		}

		// Update state
		this._value = toState;

		// Enter new state
		await this.enterState(toState, event);

		// Record transition
		const record: TransitionRecord = {
			from: fromState,
			to: toState,
			event,
			timestamp: Date.now(),
		};
		this.transitionHistory.push(record);
		if (this.transitionHistory.length > this.maxHistorySize) {
			this.transitionHistory.shift();
		}
		this.transitionCount++;

		// Check for final state
		if (isFinalState(this.config.states, toState)) {
			this._done = true;
			this.emit("done", this.getSnapshot());
		}

		this.emit("transition", record);
	}

	private resolveTargetState(target: string): StateValue {
		// Handle history state references
		if (target.endsWith(".$history") || target.endsWith(".$history*")) {
			const isDeep = target.endsWith(".$history*");
			const parentPath = target.replace(/\.\$history\*?$/, "");
			const historyValue = this.stateHistory.get(parentPath);

			if (historyValue) {
				return isDeep ? historyValue : typeof historyValue === "string" ? historyValue : parentPath;
			}

			// Fall back to initial state of parent
			const parentDef = getStateDefinition(this.config.states, parentPath);
			return parentDef?.initial ?? parentPath;
		}

		return target;
	}

	// =========================================================================
	// Private Methods - State Entry/Exit
	// =========================================================================

	private async enterState(stateValue: StateValue, event: StateMachineEvent): Promise<void> {
		if (typeof stateValue === "string") {
			const stateDef = getStateDefinition(this.config.states, stateValue);
			if (!stateDef) {
				return;
			}

			this.log(`Entering state: ${stateValue}`);

			// Execute entry actions
			if (stateDef.onEntry) {
				const actions = Array.isArray(stateDef.onEntry) ? stateDef.onEntry : [stateDef.onEntry];
				await this.executeActions(actions, event);
			}

			// Start activities
			if (stateDef.activities) {
				for (const activity of stateDef.activities) {
					const cleanup = activity(this._context);
					this.activeActivities.push(cleanup);
				}
			}

			// Enter compound state's initial child
			if (stateDef.type === "compound" && stateDef.initial && stateDef.states) {
				const childPath = `${stateValue}.${stateDef.initial}`;
				this._value = childPath;
				await this.enterState(stateDef.initial, event);
			}

			// Enter parallel state regions
			if (stateDef.type === "parallel" && stateDef.states) {
				const parallelValue: Record<string, StateValue> = {};
				for (const [region, regionDef] of Object.entries(stateDef.states)) {
					parallelValue[region] = regionDef.initial ?? region;
					await this.enterState(parallelValue[region], event);
				}
				this._value = parallelValue;
			}

			this.emit("stateEntered", { state: stateValue, context: this._context });
		} else {
			// Enter all parallel regions
			for (const [, regionValue] of Object.entries(stateValue)) {
				await this.enterState(regionValue, event);
			}
		}
	}

	private async exitState(stateValue: StateValue, event: StateMachineEvent): Promise<void> {
		if (typeof stateValue === "string") {
			const stateDef = getStateDefinition(this.config.states, stateValue);
			if (!stateDef) {
				return;
			}

			// Exit child states first (compound/parallel)
			if (stateDef.states) {
				if (stateDef.type === "compound" && stateDef.initial) {
					await this.exitState(stateDef.initial, event);
				} else if (stateDef.type === "parallel") {
					for (const region of Object.keys(stateDef.states)) {
						await this.exitState(region, event);
					}
				}
			}

			this.log(`Exiting state: ${stateValue}`);

			// Stop activities
			this.stopActivities();

			// Execute exit actions
			if (stateDef.onExit) {
				const actions = Array.isArray(stateDef.onExit) ? stateDef.onExit : [stateDef.onExit];
				await this.executeActions(actions, event);
			}

			this.emit("stateExited", { state: stateValue, context: this._context });
		} else {
			// Exit all parallel regions
			for (const [, regionValue] of Object.entries(stateValue)) {
				await this.exitState(regionValue, event);
			}
		}
	}

	// =========================================================================
	// Private Methods - Utilities
	// =========================================================================

	private async executeActions(actions: TransitionAction<TContext>[], event: StateMachineEvent): Promise<void> {
		for (const action of actions) {
			try {
				await action(this._context, event);
			} catch (error) {
				this.emit("error", error);
				if (this.config.strict) {
					throw error;
				}
			}
		}
	}

	private stopActivities(): void {
		for (const cleanup of this.activeActivities) {
			try {
				cleanup();
			} catch (error) {
				this.emit("error", error);
			}
		}
		this.activeActivities = [];
	}

	private recordHistory(stateValue: StateValue): void {
		if (typeof stateValue === "string") {
			// Record for all parent states
			const parts = stateValue.split(".");
			let path = "";
			for (const part of parts) {
				path = path ? `${path}.${part}` : part;
				this.stateHistory.set(path, stateValue);
			}
		}
	}

	private collectAvailableEvents(stateValue: StateValue, events: Set<string>): void {
		if (typeof stateValue === "string") {
			const stateDef = getStateDefinition(this.config.states, stateValue);
			if (stateDef?.on) {
				Object.keys(stateDef.on).forEach((e) => events.add(e));
			}
			// Check children
			if (stateDef?.states) {
				for (const childDef of Object.values(stateDef.states)) {
					if (childDef.on) {
						Object.keys(childDef.on).forEach((e) => events.add(e));
					}
				}
			}
		} else {
			for (const regionValue of Object.values(stateValue)) {
				this.collectAvailableEvents(regionValue, events);
			}
		}
	}

	private matchesValue(current: StateValue, target: StateValue): boolean {
		if (typeof target === "string") {
			if (typeof current === "string") {
				return current === target || current.startsWith(`${target}.`);
			}
			return Object.values(current).some((v) => this.matchesValue(v, target));
		}

		if (typeof current !== "object") {
			return false;
		}

		return Object.entries(target).every(([key, value]) => current[key] && this.matchesValue(current[key], value));
	}

	private log(message: string): void {
		if (this.config.debug) {
			console.log(`[StateMachine:${this.config.id}] ${message}`);
		}
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new state machine instance
 *
 * Note: This is NOT a singleton - each workflow needs its own state machine.
 * Use this factory to create independent state machine instances.
 */
export function createStateMachine<TContext = Record<string, unknown>>(
	config: StateMachineConfig<TContext>,
): StateMachine<TContext> {
	return new StateMachine(config);
}

// ============================================================================
// Presets & Helpers
// ============================================================================

/**
 * Common state machine presets
 */
export const StateMachinePresets = {
	/**
	 * Simple linear workflow
	 */
	linear: <TContext>(steps: string[], config?: Partial<StateMachineConfig<TContext>>) => {
		const states: Record<string, StateDefinition<TContext>> = {};

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			const nextStep = steps[i + 1];

			states[step] = {
				type: i === steps.length - 1 ? "final" : "atomic",
				on: nextStep ? { NEXT: nextStep, COMPLETE: nextStep } : undefined,
			};
		}

		return createStateMachine<TContext>({
			id: config?.id ?? "linear-workflow",
			initial: steps[0],
			states,
			...config,
		});
	},

	/**
	 * Approval workflow with retry
	 */
	approval: <TContext>(config?: Partial<StateMachineConfig<TContext>>) =>
		createStateMachine<TContext>({
			id: config?.id ?? "approval-workflow",
			initial: "pending",
			states: {
				pending: {
					on: {
						SUBMIT: "review",
						CANCEL: "cancelled",
					},
				},
				review: {
					on: {
						APPROVE: "approved",
						REJECT: "rejected",
						REQUEST_CHANGES: "pending",
					},
				},
				approved: { type: "final" },
				rejected: {
					on: {
						RETRY: "pending",
					},
				},
				cancelled: { type: "final" },
			},
			...config,
		}),

	/**
	 * Trading order state machine
	 */
	tradingOrder: <TContext>(config?: Partial<StateMachineConfig<TContext>>) =>
		createStateMachine<TContext>({
			id: config?.id ?? "trading-order",
			initial: "idle",
			states: {
				idle: {
					on: {
						CREATE: "validating",
					},
				},
				validating: {
					on: {
						VALID: "pending",
						INVALID: "rejected",
					},
				},
				pending: {
					on: {
						EXECUTE: "executing",
						CANCEL: "cancelled",
						TIMEOUT: "expired",
					},
				},
				executing: {
					on: {
						FILLED: "filled",
						PARTIAL: "partiallyFilled",
						FAILED: "failed",
					},
				},
				partiallyFilled: {
					on: {
						FILLED: "filled",
						CANCEL: "cancelled",
						TIMEOUT: "expired",
					},
				},
				filled: { type: "final" },
				cancelled: { type: "final" },
				rejected: { type: "final" },
				expired: { type: "final" },
				failed: {
					on: {
						RETRY: "pending",
					},
				},
			},
			...config,
		}),

	/**
	 * Agent task workflow
	 */
	agentTask: <TContext>(config?: Partial<StateMachineConfig<TContext>>) =>
		createStateMachine<TContext>({
			id: config?.id ?? "agent-task",
			initial: "created",
			states: {
				created: {
					on: {
						ASSIGN: "assigned",
						CANCEL: "cancelled",
					},
				},
				assigned: {
					on: {
						START: "running",
						UNASSIGN: "created",
						CANCEL: "cancelled",
					},
				},
				running: {
					on: {
						PAUSE: "paused",
						COMPLETE: "completed",
						FAIL: "failed",
						CANCEL: "cancelled",
					},
				},
				paused: {
					on: {
						RESUME: "running",
						CANCEL: "cancelled",
					},
				},
				completed: { type: "final" },
				failed: {
					on: {
						RETRY: "assigned",
					},
				},
				cancelled: { type: "final" },
			},
			...config,
		}),
};

/**
 * Type guard to check if a value is a StateMachine
 */
export function isStateMachine<TContext>(value: unknown): value is StateMachine<TContext> {
	return value instanceof StateMachine;
}

/**
 * Create a state machine from a simple definition object
 */
export function defineStateMachine<TContext = Record<string, unknown>>(definition: {
	id: string;
	initial: string;
	states: Record<
		string,
		{
			on?: Record<string, string>;
			final?: boolean;
		}
	>;
	context?: TContext;
}): StateMachine<TContext> {
	const states: Record<string, StateDefinition<TContext>> = {};

	for (const [name, def] of Object.entries(definition.states)) {
		states[name] = {
			type: def.final ? "final" : "atomic",
			on: def.on,
		};
	}

	return createStateMachine({
		id: definition.id,
		initial: definition.initial,
		states,
		context: definition.context,
	});
}
