/**
 * Continuous-Claude Adapter for Pi-Mono Discord Bot
 *
 * Integrates parcadei/Continuous-Claude session continuity system:
 * - Ledger system (within-session state preservation)
 * - Handoff system (between-session context transfer)
 * - Artifact Index (SQLite + FTS5 for handoff search)
 * - Braintrust session tracing (optional)
 * - TDD workflow integration
 * - Reasoning history capture
 *
 * @see https://github.com/parcadei/Continuous-Claude
 */

import { EventEmitter } from "events";

// ========== Ledger Types ==========

export interface ContinuityLedger {
    id: string;
    sessionId: string;
    projectPath: string;
    goal: string;
    constraints: string[];
    completed: string[];
    inProgress: string[];
    pending: string[];
    keyDecisions: string[];
    workingFiles: string[];
    currentFocus: string;
    updatedAt: Date;
    createdAt: Date;
}

export interface LedgerUpdate {
    goal?: string;
    constraints?: string[];
    completed?: string[];
    inProgress?: string[];
    pending?: string[];
    keyDecisions?: string[];
    workingFiles?: string[];
    currentFocus?: string;
}

// ========== Handoff Types ==========

export type HandoffOutcome = "SUCCEEDED" | "PARTIAL_PLUS" | "PARTIAL_MINUS" | "FAILED";

export interface Handoff {
    id: string;
    sessionId: string;
    taskId?: string;
    projectPath: string;
    title: string;
    context: string;
    recentChanges: Array<{
        file: string;
        line?: number;
        description: string;
    }>;
    learnings: string[];
    patterns: string[];
    nextSteps: string[];
    outcome?: HandoffOutcome;
    braintrustSpanId?: string;
    createdAt: Date;
    markedAt?: Date;
}

export interface HandoffQuery {
    sessionId?: string;
    projectPath?: string;
    outcome?: HandoffOutcome;
    unmarkedOnly?: boolean;
    search?: string;
    limit?: number;
    since?: Date;
}

// ========== Artifact Index Types ==========

export interface ArtifactEntry {
    id: string;
    type: "handoff" | "plan" | "ledger";
    path: string;
    content: string;
    sessionId: string;
    outcome?: HandoffOutcome;
    braintrustSpanId?: string;
    indexedAt: Date;
}

// ========== Braintrust Tracing Types ==========

export interface BraintrustSpan {
    id: string;
    parentId?: string;
    type: "session" | "turn" | "tool" | "llm";
    name: string;
    input?: unknown;
    output?: unknown;
    startedAt: Date;
    endedAt?: Date;
    metadata?: Record<string, unknown>;
}

export interface SessionTrace {
    id: string;
    projectName: string;
    spans: BraintrustSpan[];
    learnings?: SessionLearning;
    startedAt: Date;
    endedAt?: Date;
}

export interface SessionLearning {
    whatWorked: string[];
    whatFailed: string[];
    keyDecisions: string[];
    patterns: string[];
    extractedAt: Date;
}

// ========== Reasoning History Types ==========

export interface ReasoningEntry {
    commitHash: string;
    attempts: Array<{
        description: string;
        outcome: "success" | "failure";
        reason?: string;
    }>;
    finalSolution: string;
    createdAt: Date;
}

// ========== Ledger Manager ==========

/**
 * LedgerManager - Within-session state preservation
 * Survives /clear commands
 */
export class LedgerManager extends EventEmitter {
    private ledgers: Map<string, ContinuityLedger> = new Map();
    private currentLedgerId: string | null = null;

    /**
     * Create or get ledger for a session
     */
    getOrCreate(sessionId: string, projectPath: string): ContinuityLedger {
        const existingId = `CONTINUITY_CLAUDE-${sessionId}`;

        if (this.ledgers.has(existingId)) {
            return this.ledgers.get(existingId)!;
        }

        const ledger: ContinuityLedger = {
            id: existingId,
            sessionId,
            projectPath,
            goal: "",
            constraints: [],
            completed: [],
            inProgress: [],
            pending: [],
            keyDecisions: [],
            workingFiles: [],
            currentFocus: "",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        this.ledgers.set(ledger.id, ledger);
        this.currentLedgerId = ledger.id;
        this.emit("ledger:created", ledger);

        return ledger;
    }

    /**
     * Update current ledger
     */
    update(update: LedgerUpdate): ContinuityLedger | null {
        if (!this.currentLedgerId) return null;

        const ledger = this.ledgers.get(this.currentLedgerId);
        if (!ledger) return null;

        Object.assign(ledger, update, { updatedAt: new Date() });
        this.emit("ledger:updated", ledger);

        return ledger;
    }

    /**
     * Mark item as completed
     */
    markCompleted(item: string): void {
        if (!this.currentLedgerId) return;
        const ledger = this.ledgers.get(this.currentLedgerId);
        if (!ledger) return;

        // Remove from inProgress or pending
        ledger.inProgress = ledger.inProgress.filter((i) => i !== item);
        ledger.pending = ledger.pending.filter((i) => i !== item);

        // Add to completed if not already there
        if (!ledger.completed.includes(item)) {
            ledger.completed.push(item);
        }

        ledger.updatedAt = new Date();
        this.emit("ledger:item:completed", { ledger, item });
    }

    /**
     * Set current focus
     */
    setFocus(focus: string): void {
        if (!this.currentLedgerId) return;
        const ledger = this.ledgers.get(this.currentLedgerId);
        if (!ledger) return;

        ledger.currentFocus = focus;
        ledger.updatedAt = new Date();
        this.emit("ledger:focus:changed", { ledger, focus });
    }

    /**
     * Get current ledger
     */
    getCurrent(): ContinuityLedger | null {
        if (!this.currentLedgerId) return null;
        return this.ledgers.get(this.currentLedgerId) || null;
    }

    /**
     * Find most recent ledger for project
     */
    findRecent(projectPath: string): ContinuityLedger | null {
        let mostRecent: ContinuityLedger | null = null;

        for (const ledger of this.ledgers.values()) {
            if (ledger.projectPath === projectPath) {
                if (!mostRecent || ledger.updatedAt > mostRecent.updatedAt) {
                    mostRecent = ledger;
                }
            }
        }

        return mostRecent;
    }

    /**
     * Generate markdown representation
     */
    toMarkdown(ledger: ContinuityLedger): string {
        const lines: string[] = [
            `# Continuity Ledger: ${ledger.sessionId}`,
            "",
            `**Project:** ${ledger.projectPath}`,
            `**Updated:** ${ledger.updatedAt.toISOString()}`,
            "",
            "## Goal",
            ledger.goal || "_Not set_",
            "",
        ];

        if (ledger.constraints.length > 0) {
            lines.push("## Constraints");
            for (const c of ledger.constraints) {
                lines.push(`- ${c}`);
            }
            lines.push("");
        }

        if (ledger.currentFocus) {
            lines.push("## Now", `> ${ledger.currentFocus}`, "");
        }

        if (ledger.inProgress.length > 0) {
            lines.push("## In Progress");
            for (const item of ledger.inProgress) {
                lines.push(`- [ ] ${item}`);
            }
            lines.push("");
        }

        if (ledger.completed.length > 0) {
            lines.push("## Completed");
            for (const item of ledger.completed) {
                lines.push(`- [x] ${item}`);
            }
            lines.push("");
        }

        if (ledger.pending.length > 0) {
            lines.push("## Pending");
            for (const item of ledger.pending) {
                lines.push(`- ${item}`);
            }
            lines.push("");
        }

        if (ledger.keyDecisions.length > 0) {
            lines.push("## Key Decisions");
            for (const d of ledger.keyDecisions) {
                lines.push(`- ${d}`);
            }
            lines.push("");
        }

        if (ledger.workingFiles.length > 0) {
            lines.push("## Working Files");
            for (const f of ledger.workingFiles) {
                lines.push(`- \`${f}\``);
            }
            lines.push("");
        }

        return lines.join("\n");
    }
}

// ========== Handoff Manager ==========

/**
 * HandoffManager - Between-session context transfer
 */
export class HandoffManager extends EventEmitter {
    private handoffs: Map<string, Handoff> = new Map();
    private artifactIndex: Map<string, ArtifactEntry> = new Map();

    /**
     * Create a handoff for end of session
     */
    createHandoff(options: {
        sessionId: string;
        projectPath: string;
        title: string;
        context: string;
        recentChanges?: Handoff["recentChanges"];
        learnings?: string[];
        patterns?: string[];
        nextSteps?: string[];
        braintrustSpanId?: string;
    }): Handoff {
        const handoff: Handoff = {
            id: `handoff-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            sessionId: options.sessionId,
            projectPath: options.projectPath,
            title: options.title,
            context: options.context,
            recentChanges: options.recentChanges || [],
            learnings: options.learnings || [],
            patterns: options.patterns || [],
            nextSteps: options.nextSteps || [],
            braintrustSpanId: options.braintrustSpanId,
            createdAt: new Date(),
        };

        this.handoffs.set(handoff.id, handoff);
        this.indexArtifact(handoff);
        this.emit("handoff:created", handoff);

        return handoff;
    }

    /**
     * Create auto-handoff (triggered by pre-compact hook)
     */
    createAutoHandoff(sessionId: string, projectPath: string, transcript: string): Handoff {
        // Parse transcript to extract useful info
        const recentChanges = this.extractChangesFromTranscript(transcript);
        const context = this.summarizeTranscript(transcript);

        return this.createHandoff({
            sessionId,
            projectPath,
            title: `Auto-handoff ${new Date().toISOString()}`,
            context,
            recentChanges,
            nextSteps: ["Continue from where we left off"],
        });
    }

    /**
     * Mark handoff outcome
     */
    markOutcome(handoffId: string, outcome: HandoffOutcome): Handoff | null {
        const handoff = this.handoffs.get(handoffId);
        if (!handoff) return null;

        handoff.outcome = outcome;
        handoff.markedAt = new Date();
        this.emit("handoff:marked", handoff);

        return handoff;
    }

    /**
     * Query handoffs
     */
    query(query: HandoffQuery): Handoff[] {
        let results = Array.from(this.handoffs.values());

        if (query.sessionId) {
            results = results.filter((h) => h.sessionId === query.sessionId);
        }

        if (query.projectPath) {
            results = results.filter((h) => h.projectPath === query.projectPath);
        }

        if (query.outcome) {
            results = results.filter((h) => h.outcome === query.outcome);
        }

        if (query.unmarkedOnly) {
            results = results.filter((h) => !h.outcome);
        }

        if (query.since) {
            results = results.filter((h) => h.createdAt >= query.since!);
        }

        if (query.search) {
            const searchLower = query.search.toLowerCase();
            results = results.filter(
                (h) =>
                    h.title.toLowerCase().includes(searchLower) ||
                    h.context.toLowerCase().includes(searchLower) ||
                    h.learnings.some((l) => l.toLowerCase().includes(searchLower))
            );
        }

        // Sort by date descending
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        if (query.limit) {
            results = results.slice(0, query.limit);
        }

        return results;
    }

    /**
     * Get unmarked handoffs
     */
    getUnmarked(projectPath?: string): Handoff[] {
        return this.query({ unmarkedOnly: true, projectPath });
    }

    /**
     * Get latest handoff for session resumption
     */
    getLatest(projectPath: string): Handoff | null {
        const handoffs = this.query({ projectPath, limit: 1 });
        return handoffs[0] || null;
    }

    /**
     * Generate markdown representation
     */
    toMarkdown(handoff: Handoff): string {
        const lines: string[] = [
            `# Handoff: ${handoff.title}`,
            "",
            "---",
            `session_id: ${handoff.sessionId}`,
        ];

        if (handoff.braintrustSpanId) {
            lines.push(`root_span_id: ${handoff.braintrustSpanId}`);
        }

        lines.push(`created_at: ${handoff.createdAt.toISOString()}`, "---", "", "## Context", handoff.context, "");

        if (handoff.recentChanges.length > 0) {
            lines.push("## Recent Changes");
            for (const change of handoff.recentChanges) {
                const loc = change.line ? `:${change.line}` : "";
                lines.push(`- \`${change.file}${loc}\`: ${change.description}`);
            }
            lines.push("");
        }

        if (handoff.learnings.length > 0) {
            lines.push("## Learnings");
            for (const l of handoff.learnings) {
                lines.push(`- ${l}`);
            }
            lines.push("");
        }

        if (handoff.patterns.length > 0) {
            lines.push("## Patterns");
            for (const p of handoff.patterns) {
                lines.push(`- ${p}`);
            }
            lines.push("");
        }

        if (handoff.nextSteps.length > 0) {
            lines.push("## Next Steps");
            for (const step of handoff.nextSteps) {
                lines.push(`- [ ] ${step}`);
            }
            lines.push("");
        }

        if (handoff.outcome) {
            lines.push("## Outcome", `**${handoff.outcome}** (marked ${handoff.markedAt?.toISOString()})`, "");
        }

        return lines.join("\n");
    }

    // ========== Private Methods ==========

    private indexArtifact(handoff: Handoff): void {
        const entry: ArtifactEntry = {
            id: handoff.id,
            type: "handoff",
            path: `thoughts/shared/handoffs/${handoff.sessionId}/${handoff.id}.md`,
            content: this.toMarkdown(handoff),
            sessionId: handoff.sessionId,
            outcome: handoff.outcome,
            braintrustSpanId: handoff.braintrustSpanId,
            indexedAt: new Date(),
        };
        this.artifactIndex.set(entry.id, entry);
    }

    private extractChangesFromTranscript(transcript: string): Handoff["recentChanges"] {
        const changes: Handoff["recentChanges"] = [];

        // Look for file modifications
        const editPatterns = [/Edit(?:ed)?\s+`?([^\s`]+\.(ts|js|py|go|rs))`?/gi, /Write\s+to\s+`?([^\s`]+)`?/gi, /Modified\s+`?([^\s`]+)`?/gi];

        for (const pattern of editPatterns) {
            let match;
            while ((match = pattern.exec(transcript)) !== null) {
                changes.push({
                    file: match[1],
                    description: "Modified during session",
                });
            }
        }

        return changes.slice(0, 10); // Limit to 10 changes
    }

    private summarizeTranscript(transcript: string): string {
        // Take first 2000 chars as summary (in real impl, use LLM)
        const truncated = transcript.substring(0, 2000);
        return truncated + (transcript.length > 2000 ? "..." : "");
    }
}

// ========== Session Tracer (Braintrust-compatible) ==========

/**
 * SessionTracer - Optional Braintrust-compatible session tracing
 */
export class SessionTracer extends EventEmitter {
    private traces: Map<string, SessionTrace> = new Map();
    private currentTraceId: string | null = null;
    private currentTurnId: string | null = null;
    private enabled: boolean;

    constructor(enabled = true) {
        super();
        this.enabled = enabled;
    }

    /**
     * Start a new session trace
     */
    startSession(projectName: string): SessionTrace {
        if (!this.enabled) {
            return { id: "disabled", projectName, spans: [], startedAt: new Date() };
        }

        const trace: SessionTrace = {
            id: `trace-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            projectName,
            spans: [],
            startedAt: new Date(),
        };

        // Create root session span
        const sessionSpan: BraintrustSpan = {
            id: trace.id,
            type: "session",
            name: `Session: ${projectName}`,
            startedAt: new Date(),
        };
        trace.spans.push(sessionSpan);

        this.traces.set(trace.id, trace);
        this.currentTraceId = trace.id;
        this.emit("session:started", trace);

        return trace;
    }

    /**
     * Start a new turn (user message)
     */
    startTurn(userMessage: string): BraintrustSpan | null {
        if (!this.enabled || !this.currentTraceId) return null;

        const trace = this.traces.get(this.currentTraceId);
        if (!trace) return null;

        const turnSpan: BraintrustSpan = {
            id: `turn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            parentId: trace.id,
            type: "turn",
            name: "User Turn",
            input: userMessage,
            startedAt: new Date(),
        };

        trace.spans.push(turnSpan);
        this.currentTurnId = turnSpan.id;
        this.emit("turn:started", turnSpan);

        return turnSpan;
    }

    /**
     * Log a tool call
     */
    logTool(toolName: string, input: unknown, output: unknown): BraintrustSpan | null {
        if (!this.enabled || !this.currentTraceId || !this.currentTurnId) return null;

        const trace = this.traces.get(this.currentTraceId);
        if (!trace) return null;

        const toolSpan: BraintrustSpan = {
            id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            parentId: this.currentTurnId,
            type: "tool",
            name: toolName,
            input,
            output,
            startedAt: new Date(),
            endedAt: new Date(),
        };

        trace.spans.push(toolSpan);
        this.emit("tool:logged", toolSpan);

        return toolSpan;
    }

    /**
     * End current turn
     */
    endTurn(output: string): void {
        if (!this.enabled || !this.currentTraceId || !this.currentTurnId) return;

        const trace = this.traces.get(this.currentTraceId);
        if (!trace) return;

        const turnSpan = trace.spans.find((s) => s.id === this.currentTurnId);
        if (turnSpan) {
            turnSpan.output = output;
            turnSpan.endedAt = new Date();
        }

        this.currentTurnId = null;
        this.emit("turn:ended", turnSpan);
    }

    /**
     * End session and extract learnings
     */
    endSession(): SessionTrace | null {
        if (!this.enabled || !this.currentTraceId) return null;

        const trace = this.traces.get(this.currentTraceId);
        if (!trace) return null;

        trace.endedAt = new Date();

        // Extract learnings (in real impl, call LLM)
        trace.learnings = this.extractLearnings(trace);

        const sessionSpan = trace.spans.find((s) => s.type === "session");
        if (sessionSpan) {
            sessionSpan.endedAt = new Date();
        }

        this.currentTraceId = null;
        this.currentTurnId = null;
        this.emit("session:ended", trace);

        return trace;
    }

    /**
     * Get current trace
     */
    getCurrentTrace(): SessionTrace | null {
        if (!this.currentTraceId) return null;
        return this.traces.get(this.currentTraceId) || null;
    }

    private extractLearnings(trace: SessionTrace): SessionLearning {
        // In real implementation, this would call an LLM to extract insights
        return {
            whatWorked: [],
            whatFailed: [],
            keyDecisions: [],
            patterns: [],
            extractedAt: new Date(),
        };
    }
}

// ========== Reasoning History ==========

/**
 * ReasoningHistory - Track what was tried during development
 */
export class ReasoningHistory extends EventEmitter {
    private entries: Map<string, ReasoningEntry> = new Map();

    /**
     * Record reasoning for a commit
     */
    record(
        commitHash: string,
        attempts: ReasoningEntry["attempts"],
        finalSolution: string
    ): ReasoningEntry {
        const entry: ReasoningEntry = {
            commitHash,
            attempts,
            finalSolution,
            createdAt: new Date(),
        };

        this.entries.set(commitHash, entry);
        this.emit("reasoning:recorded", entry);

        return entry;
    }

    /**
     * Search reasoning history
     */
    search(query: string): ReasoningEntry[] {
        const queryLower = query.toLowerCase();
        const results: ReasoningEntry[] = [];

        for (const entry of this.entries.values()) {
            const matchesAttempts = entry.attempts.some(
                (a) => a.description.toLowerCase().includes(queryLower) || (a.reason && a.reason.toLowerCase().includes(queryLower))
            );
            const matchesSolution = entry.finalSolution.toLowerCase().includes(queryLower);

            if (matchesAttempts || matchesSolution) {
                results.push(entry);
            }
        }

        return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    /**
     * Get entry by commit
     */
    getByCommit(commitHash: string): ReasoningEntry | null {
        return this.entries.get(commitHash) || null;
    }
}

// ========== Continuous-Claude Client ==========

export interface ContinuousClaudeConfig {
    enableLedger?: boolean;
    enableHandoff?: boolean;
    enableTracing?: boolean;
    enableReasoning?: boolean;
    projectPath?: string;
}

/**
 * ContinuousClaudeClient - Main entry point for Continuous-Claude integration
 */
export class ContinuousClaudeClient extends EventEmitter {
    public ledgerManager: LedgerManager;
    public handoffManager: HandoffManager;
    public sessionTracer: SessionTracer;
    public reasoningHistory: ReasoningHistory;
    private config: ContinuousClaudeConfig;
    private sessionId: string | null = null;

    constructor(config: ContinuousClaudeConfig = {}) {
        super();
        this.config = {
            enableLedger: true,
            enableHandoff: true,
            enableTracing: true,
            enableReasoning: true,
            ...config,
        };

        this.ledgerManager = new LedgerManager();
        this.handoffManager = new HandoffManager();
        this.sessionTracer = new SessionTracer(config.enableTracing);
        this.reasoningHistory = new ReasoningHistory();

        // Forward events
        this.ledgerManager.on("ledger:created", (l) => this.emit("ledger:created", l));
        this.ledgerManager.on("ledger:updated", (l) => this.emit("ledger:updated", l));
        this.handoffManager.on("handoff:created", (h) => this.emit("handoff:created", h));
        this.sessionTracer.on("session:started", (t) => this.emit("trace:started", t));
    }

    /**
     * Initialize session (called on SessionStart hook)
     */
    initSession(projectPath: string): {
        ledger: ContinuityLedger | null;
        latestHandoff: Handoff | null;
        trace: SessionTrace | null;
    } {
        this.sessionId = `session-${Date.now()}`;
        const path = projectPath || this.config.projectPath || process.cwd();

        // Try to resume from existing ledger
        let ledger = this.ledgerManager.findRecent(path);
        if (!ledger && this.config.enableLedger) {
            ledger = this.ledgerManager.getOrCreate(this.sessionId, path);
        }

        // Get latest handoff
        const latestHandoff = this.config.enableHandoff ? this.handoffManager.getLatest(path) : null;

        // Start trace
        const trace = this.config.enableTracing ? this.sessionTracer.startSession(path) : null;

        this.emit("session:initialized", { ledger, latestHandoff, trace });

        return { ledger, latestHandoff, trace };
    }

    /**
     * Update ledger (called before /clear)
     */
    saveLedger(update: LedgerUpdate): ContinuityLedger | null {
        return this.ledgerManager.update(update);
    }

    /**
     * Create handoff (called on session end)
     */
    createHandoff(options: {
        title: string;
        context: string;
        learnings?: string[];
        nextSteps?: string[];
    }): Handoff | null {
        if (!this.sessionId || !this.config.enableHandoff) return null;

        const ledger = this.ledgerManager.getCurrent();
        const trace = this.sessionTracer.getCurrentTrace();

        return this.handoffManager.createHandoff({
            sessionId: this.sessionId,
            projectPath: ledger?.projectPath || this.config.projectPath || process.cwd(),
            title: options.title,
            context: options.context,
            learnings: options.learnings,
            nextSteps: options.nextSteps,
            braintrustSpanId: trace?.id,
        });
    }

    /**
     * End session (called on SessionEnd hook)
     */
    endSession(outcome?: HandoffOutcome): {
        ledger: ContinuityLedger | null;
        trace: SessionTrace | null;
    } {
        const ledger = this.ledgerManager.getCurrent();
        const trace = this.sessionTracer.endSession();

        // Mark latest handoff with outcome if provided
        if (outcome) {
            const handoffs = this.handoffManager.getUnmarked();
            if (handoffs.length > 0) {
                this.handoffManager.markOutcome(handoffs[0].id, outcome);
            }
        }

        this.sessionId = null;
        this.emit("session:ended", { ledger, trace });

        return { ledger, trace };
    }

    /**
     * Get context for session start (injected into Claude)
     */
    getSessionStartContext(): string {
        const ledger = this.ledgerManager.getCurrent();
        const handoff = this.handoffManager.getLatest(ledger?.projectPath || "");

        const parts: string[] = [];

        if (ledger) {
            parts.push("## Current Ledger", this.ledgerManager.toMarkdown(ledger), "");
        }

        if (handoff) {
            parts.push("## Latest Handoff", this.handoffManager.toMarkdown(handoff), "");
        }

        if (parts.length === 0) {
            return "No previous session context available.";
        }

        return parts.join("\n");
    }

    /**
     * Get stats
     */
    getStats(): {
        hasLedger: boolean;
        handoffCount: number;
        unmarkedHandoffs: number;
        hasActiveTrace: boolean;
        reasoningEntries: number;
    } {
        return {
            hasLedger: !!this.ledgerManager.getCurrent(),
            handoffCount: this.handoffManager.query({}).length,
            unmarkedHandoffs: this.handoffManager.getUnmarked().length,
            hasActiveTrace: !!this.sessionTracer.getCurrentTrace(),
            reasoningEntries: this.reasoningHistory.search("").length,
        };
    }
}

// ========== Global Instance ==========

let continuousClaudeClient: ContinuousClaudeClient | null = null;

/**
 * Get or create Continuous-Claude client instance
 */
export function getContinuousClaudeClient(config?: ContinuousClaudeConfig): ContinuousClaudeClient {
    if (!continuousClaudeClient) {
        continuousClaudeClient = new ContinuousClaudeClient(config);
    }
    return continuousClaudeClient;
}

/**
 * Initialize Continuous-Claude
 */
export function initContinuousClaude(config?: ContinuousClaudeConfig): ContinuousClaudeClient {
    return getContinuousClaudeClient(config);
}
