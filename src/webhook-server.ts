/**
 * Hardened Webhook Server with Security & Reliability
 */

import { timingSafeEqual } from "crypto";
import type { Client, TextChannel } from "discord.js";
import express from "express";
import helmet from "helmet";
import {
	CircuitBreaker,
	CONFIG,
	retryWithBackoff,
	sanitizeInput,
	sanitizeLogOutput,
	validateWebhookPayload,
	WebhookQueue,
} from "./hardening-utils.js";

// Auth rate limiter: tracks failed attempts per IP
const authFailures = new Map<string, { count: number; firstAttempt: number }>();
const AUTH_RATE_LIMIT = 5; // max failures
const AUTH_RATE_WINDOW = 60000; // 1 minute

function isAuthRateLimited(ip: string): boolean {
	const now = Date.now();
	const record = authFailures.get(ip);

	if (!record) return false;

	// Reset if window expired
	if (now - record.firstAttempt > AUTH_RATE_WINDOW) {
		authFailures.delete(ip);
		return false;
	}

	return record.count >= AUTH_RATE_LIMIT;
}

function recordAuthFailure(ip: string): void {
	const now = Date.now();
	const record = authFailures.get(ip);

	if (!record || now - record.firstAttempt > AUTH_RATE_WINDOW) {
		authFailures.set(ip, { count: 1, firstAttempt: now });
	} else {
		record.count++;
	}
}

// Constant-time string comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		const bufA = Buffer.from(a, "utf8");
		const bufB = Buffer.from(b, "utf8");
		return timingSafeEqual(bufA, bufB);
	} catch {
		return false;
	}
}

const webhookQueue = new WebhookQueue();
const apiCircuitBreaker = new CircuitBreaker("external-api");

// ============================================================================
// Helper Functions
// ============================================================================

function logInfo(message: string): void {
	console.log(`[WEBHOOK] ${message}`);
}

function logWarning(message: string): void {
	console.warn(`[WEBHOOK] ${sanitizeLogOutput(message)}`);
}

function logError(message: string, detail?: string): void {
	console.error(`[WEBHOOK ERROR] ${sanitizeLogOutput(message)}`, detail ? sanitizeLogOutput(detail) : "");
}

// Send message to report channel
async function sendToReportChannel(client: Client, content: string): Promise<void> {
	const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID;
	if (!REPORT_CHANNEL_ID) return;

	try {
		const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
		if (channel && "send" in channel) {
			await (channel as TextChannel).send(content.substring(0, 2000));
		}
	} catch (error) {
		logError("Failed to send to report channel", error instanceof Error ? error.message : String(error));
	}
}

// ============================================================================
// Webhook Server Setup
// ============================================================================

export function createWebhookServer(client: Client): express.Application {
	const app = express();

	// Security: Helmet for HTTP headers
	app.use(
		helmet({
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					styleSrc: ["'self'", "'unsafe-inline'"],
				},
			},
			hsts: {
				maxAge: 31536000,
				includeSubDomains: true,
				preload: true,
			},
		}),
	);

	// Security: Request size limit
	app.use(
		express.json({
			limit: `${CONFIG.MAX_REQUEST_SIZE}b`,
		}),
	);

	// Security: Disable X-Powered-By
	app.disable("x-powered-by");

	// Request timeout middleware
	app.use((req, res, next) => {
		req.setTimeout(CONFIG.REQUEST_TIMEOUT);
		res.setTimeout(CONFIG.REQUEST_TIMEOUT);
		next();
	});

	// Request logging middleware
	app.use((req, res, next) => {
		const start = Date.now();
		res.on("finish", () => {
			const duration = Date.now() - start;
			logInfo(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
		});
		next();
	});

	// API Key Authentication Middleware
	const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY;

	function authenticateApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
		// Skip auth for health endpoint
		if (req.path === "/health") {
			next();
			return;
		}

		const clientIP = req.ip || "unknown";

		// SECURITY: Rate limit auth failures to prevent brute force
		if (isAuthRateLimited(clientIP)) {
			logWarning(`Rate limited auth attempt from ${clientIP}`);
			res.status(429).json({ error: "Too many failed attempts, try again later" });
			return;
		}

		// SECURITY: Only accept API key via header (not query string to prevent logging/leakage)
		const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

		if (!WEBHOOK_API_KEY) {
			logWarning("WEBHOOK_API_KEY not configured - authentication disabled");
			next();
			return;
		}

		if (!apiKeyHeader) {
			recordAuthFailure(clientIP);
			logWarning(`Unauthorized attempt from ${clientIP} - no API key provided`);
			res.status(401).json({ error: "Unauthorized - API key required in X-API-Key header" });
			return;
		}

		// SECURITY: Use constant-time comparison to prevent timing attacks
		if (!secureCompare(apiKeyHeader, WEBHOOK_API_KEY)) {
			recordAuthFailure(clientIP);
			logWarning(`Unauthorized attempt from ${clientIP} - invalid API key`);
			res.status(401).json({ error: "Unauthorized - invalid API key" });
			return;
		}

		next();
	}

	// ========================================================================
	// Telegram Webhook (NO AUTH - Telegram sends updates directly)
	// ========================================================================

	// Lazy import to avoid circular dependency
	app.post("/telegram/webhook", async (req, res) => {
		try {
			const { getTelegramWebhookHandler } = await import("./telegram/index.js");
			const handler = getTelegramWebhookHandler();
			await handler(req, res);
		} catch (error) {
			console.error("[TELEGRAM WEBHOOK] Error:", error);
			res.status(500).json({ error: "Webhook processing failed" });
		}
	});

	// Apply authentication middleware (for other endpoints)
	app.use(authenticateApiKey);

	// ========================================================================
	// Webhook Endpoints
	// ========================================================================

	// Price alert webhook
	app.post("/webhook/alert", async (req, res) => {
		try {
			// Validate payload
			const validation = validateWebhookPayload(req.body);
			if (!validation.valid) {
				res.status(400).json({ error: validation.error });
				return;
			}

			const { message, priority } = req.body;
			if (!message) {
				res.status(400).json({ error: "Missing message field" });
				return;
			}

			// Sanitize input
			const sanitizedMessage = sanitizeInput(message);
			const sanitizedPriority = priority ? sanitizeInput(priority) : "normal";

			// Add to queue
			const queued = webhookQueue.add("alert", {
				message: sanitizedMessage,
				priority: sanitizedPriority,
			});

			if (!queued) {
				res.status(503).json({ error: "Queue full, try again later" });
				return;
			}

			logInfo(`Alert queued: ${sanitizedMessage.substring(0, 50)}...`);
			res.json({ status: "queued", queueSize: webhookQueue.size() });
		} catch (error) {
			logError("Alert webhook error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Trading signal webhook
	app.post("/webhook/signal", async (req, res) => {
		try {
			// Validate payload
			const validation = validateWebhookPayload(req.body);
			if (!validation.valid) {
				res.status(400).json({ error: validation.error });
				return;
			}

			const { symbol, action, price, reason } = req.body;
			if (!symbol || !action) {
				res.status(400).json({ error: "Missing required fields: symbol, action" });
				return;
			}

			// Sanitize inputs
			const sanitizedData = {
				symbol: sanitizeInput(symbol),
				action: sanitizeInput(action),
				price: price ? sanitizeInput(String(price)) : "N/A",
				reason: reason ? sanitizeInput(reason) : "N/A",
			};

			// Add to queue
			const queued = webhookQueue.add("signal", sanitizedData);

			if (!queued) {
				res.status(503).json({ error: "Queue full, try again later" });
				return;
			}

			logInfo(`Signal queued: ${sanitizedData.symbol} ${sanitizedData.action}`);
			res.json({ status: "queued", queueSize: webhookQueue.size() });
		} catch (error) {
			logError("Signal webhook error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// Health check endpoint (unauthenticated)
	app.get("/health", (_req, res) => {
		const memUsage = process.memoryUsage();
		res.json({
			status: "ok",
			uptime: process.uptime(),
			memory: {
				heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
				heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
				rss: Math.round(memUsage.rss / 1024 / 1024),
			},
			queueSize: webhookQueue.size(),
			circuitBreaker: apiCircuitBreaker.getState(),
			timestamp: new Date().toISOString(),
		});
	});

	// Metrics endpoint (authenticated)
	app.get("/metrics", (_req, res) => {
		const memUsage = process.memoryUsage();
		res.json({
			uptime: process.uptime(),
			memory: {
				heapUsed: memUsage.heapUsed,
				heapTotal: memUsage.heapTotal,
				external: memUsage.external,
				arrayBuffers: memUsage.arrayBuffers,
				rss: memUsage.rss,
			},
			queueSize: webhookQueue.size(),
			circuitBreaker: apiCircuitBreaker.getState(),
			config: {
				maxQueueSize: CONFIG.WEBHOOK_QUEUE_MAX_SIZE,
				requestTimeout: CONFIG.REQUEST_TIMEOUT,
				maxRequestSize: CONFIG.MAX_REQUEST_SIZE,
			},
		});
	});

	// ========================================================================
	// Cross-Platform Hub Endpoints
	// ========================================================================

	// Lazy import to avoid circular dependency
	let hubMiddleware: ReturnType<typeof import("./cross-platform-hub.js").createHubWebhookMiddleware> | null = null;

	async function getHubMiddleware() {
		if (!hubMiddleware) {
			const { getHub, createHubWebhookMiddleware } = await import("./cross-platform-hub.js");
			const hub = getHub();
			hub.registerDiscord(client);
			hubMiddleware = createHubWebhookMiddleware(hub);
		}
		return hubMiddleware;
	}

	// POST /hub/message - Ingest cross-platform message
	app.post("/hub/message", async (req, res) => {
		const middleware = await getHubMiddleware();
		await middleware.ingestMessage(req, res);
	});

	// POST /hub/broadcast - Broadcast to all platforms
	app.post("/hub/broadcast", async (req, res) => {
		const middleware = await getHubMiddleware();
		await middleware.broadcast(req, res);
	});

	// POST /hub/github - GitHub webhook handler
	app.post("/hub/github", async (req, res) => {
		const middleware = await getHubMiddleware();
		await middleware.githubWebhook(req, res);
	});

	// GET /hub/stats - Hub statistics
	app.get("/hub/stats", async (_req, res) => {
		const middleware = await getHubMiddleware();
		middleware.stats(_req, res);
	});

	// GET /hub/routes - List routing rules
	app.get("/hub/routes", async (_req, res) => {
		const middleware = await getHubMiddleware();
		middleware.routes(_req, res);
	});

	// POST /hub/routes - Add routing rule
	app.post("/hub/routes", async (req, res) => {
		const middleware = await getHubMiddleware();
		middleware.addRoute(req, res);
	});

	// DELETE /hub/routes/:id - Remove routing rule
	app.delete("/hub/routes/:id", async (req, res) => {
		const middleware = await getHubMiddleware();
		middleware.removeRoute(req, res);
	});

	// ========================================================================
	// Agent Mail Endpoints (Human Oversight)
	// ========================================================================

	// Lazy import to avoid circular dependency
	let agentMailBus: import("./agents/agent-messaging.js").AgentMessageBus | null = null;

	async function getAgentMailBus() {
		if (!agentMailBus) {
			const { getAgentMessageBus } = await import("./agents/agent-messaging.js");
			agentMailBus = getAgentMessageBus();
		}
		return agentMailBus;
	}

	// GET /agent-mail/stats - Messaging statistics
	app.get("/agent-mail/stats", async (_req, res) => {
		try {
			const bus = await getAgentMailBus();
			const agents = bus.getAgents();

			res.json({
				status: "ok",
				stats: {
					registeredAgents: agents.length,
					onlineAgents: agents.filter((a) => a.status === "online").length,
					agents: agents.map((a) => ({
						id: a.id,
						name: a.name,
						status: a.status,
						tags: a.tags,
						contactPolicy: a.contactPolicy || "open",
						lastSeen: a.lastSeen,
					})),
				},
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			logError("Agent mail stats error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /agent-mail/inbox/:agentId - View inbox for an agent (human oversight)
	app.get("/agent-mail/inbox/:agentId", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { agentId } = req.params;
			const { unread, importance, limit } = req.query;

			const messages = bus.getInbox(agentId, {
				unreadOnly: unread === "true",
				importance: importance as "low" | "normal" | "high" | "urgent" | undefined,
				limit: limit ? parseInt(limit as string, 10) : 50,
			});

			res.json({
				agentId,
				count: messages.length,
				messages: messages.map((m) => ({
					id: m.id,
					from: m.from,
					subject: m.subject,
					importance: m.importance,
					threadId: m.threadId,
					timestamp: m.timestamp,
					ackRequired: m.ackRequired,
					recipients: m.recipients,
					content: m.content,
				})),
			});
		} catch (error) {
			logError("Agent mail inbox error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /agent-mail/threads/:agentId - List threads for an agent
	app.get("/agent-mail/threads/:agentId", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { agentId } = req.params;

			const threads = bus.listThreads(agentId);

			res.json({
				agentId,
				count: threads.length,
				threads,
			});
		} catch (error) {
			logError("Agent mail threads error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /agent-mail/thread/:threadId - View specific thread
	app.get("/agent-mail/thread/:threadId", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { threadId } = req.params;

			const messages = bus.getThread(threadId);
			const summary = bus.getThreadSummary(threadId);

			if (messages.length === 0) {
				res.status(404).json({ error: "Thread not found" });
				return;
			}

			res.json({
				summary,
				messages: messages.map((m) => ({
					id: m.id,
					from: m.from,
					subject: m.subject,
					content: m.content,
					timestamp: m.timestamp,
					importance: m.importance,
					recipients: m.recipients,
					attachments: m.attachments,
				})),
			});
		} catch (error) {
			logError("Agent mail thread error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /agent-mail/send - Send message as human overseer (high priority, bypasses contact policies)
	app.post("/agent-mail/send", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { to, cc, bcc, subject, content, threadId, importance } = req.body;

			if (!to || !Array.isArray(to) || to.length === 0) {
				res.status(400).json({ error: "Missing required 'to' field (array of agent IDs)" });
				return;
			}
			if (!subject || !content) {
				res.status(400).json({ error: "Missing required fields: subject, content" });
				return;
			}

			const result = await bus.sendEnhanced({
				from: "human-overseer",
				to: to.map(sanitizeInput),
				cc: cc ? cc.map(sanitizeInput) : undefined,
				bcc: bcc ? bcc.map(sanitizeInput) : undefined,
				subject: sanitizeInput(subject),
				content: sanitizeInput(content),
				threadId: threadId ? sanitizeInput(threadId) : undefined,
				importance: importance || "urgent",
				ackRequired: true,
				isHumanOverseer: true, // Bypasses contact policies
			});

			logInfo(`Human overseer sent message to ${to.join(", ")}: ${subject.substring(0, 50)}`);
			res.json(result);
		} catch (error) {
			logError("Agent mail send error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /agent-mail/search - Search messages
	app.get("/agent-mail/search", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { query, agentId, threadId } = req.query;

			if (!query) {
				res.status(400).json({ error: "Missing required 'query' parameter" });
				return;
			}

			const messages = bus.searchMessages(query as string, {
				agentId: agentId as string | undefined,
				threadId: threadId as string | undefined,
			});

			res.json({
				query,
				count: messages.length,
				messages: messages.map((m) => ({
					id: m.id,
					from: m.from,
					subject: m.subject,
					threadId: m.threadId,
					timestamp: m.timestamp,
					preview: m.content.substring(0, 200),
				})),
			});
		} catch (error) {
			logError("Agent mail search error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /agent-mail/contacts - List pending contact requests
	app.get("/agent-mail/contacts", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { agentId } = req.query;

			// If agentId provided, get requests for that agent, otherwise get all agents' requests
			const agents = agentId ? [agentId as string] : bus.getAgents().map((a) => a.id);

			const allRequests: Array<{ agentId: string; requests: ReturnType<typeof bus.getPendingContactRequests> }> = [];
			for (const id of agents) {
				const requests = bus.getPendingContactRequests(id);
				if (requests.length > 0) {
					allRequests.push({ agentId: id, requests });
				}
			}

			res.json({
				totalPending: allRequests.reduce((sum, a) => sum + a.requests.length, 0),
				byAgent: allRequests,
			});
		} catch (error) {
			logError("Agent mail contacts error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /agent-mail/contacts/:requestId/approve - Approve contact request (human override)
	app.post("/agent-mail/contacts/:requestId/approve", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { requestId } = req.params;

			const success = bus.respondToContact(requestId, true);

			if (!success) {
				res.status(404).json({ error: "Contact request not found" });
				return;
			}

			logInfo(`Human overseer approved contact request: ${requestId}`);
			res.json({ success: true, requestId, action: "approved" });
		} catch (error) {
			logError("Agent mail approve error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /agent-mail/contacts/:requestId/block - Block contact request (human override)
	app.post("/agent-mail/contacts/:requestId/block", async (req, res) => {
		try {
			const bus = await getAgentMailBus();
			const { requestId } = req.params;

			const success = bus.respondToContact(requestId, false);

			if (!success) {
				res.status(404).json({ error: "Contact request not found" });
				return;
			}

			logInfo(`Human overseer blocked contact request: ${requestId}`);
			res.json({ success: true, requestId, action: "blocked" });
		} catch (error) {
			logError("Agent mail block error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// ========================================================================
	// Research Discovery Endpoints
	// ========================================================================

	// Lazy import for research orchestrator
	let researchOrchestrator: Awaited<
		ReturnType<typeof import("./agents/research-orchestrator.js").getResearchOrchestrator>
	> | null = null;

	async function getOrchestrator() {
		if (!researchOrchestrator) {
			const { getResearchOrchestrator } = await import("./agents/research-orchestrator.js");
			researchOrchestrator = getResearchOrchestrator();
		}
		return researchOrchestrator;
	}

	// GET /research/status - Get research orchestrator status
	app.get("/research/status", async (_req, res) => {
		try {
			const orchestrator = await getOrchestrator();
			const state = orchestrator.getState();
			const stats = orchestrator.getResearchStats();

			res.json({
				isRunning: state.isRunning,
				currentTopic: state.currentTopic,
				currentPhase: state.currentPhase,
				cyclesCompleted: state.cyclesCompleted,
				lastCycleTime: state.lastCycleTime,
				nextScheduledCycle: state.nextScheduledCycle,
				topicCount: state.topics.length,
				recentResultsCount: state.recentResults.length,
				stats,
				timestamp: Date.now(),
			});
		} catch (error) {
			logError("Research status error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /research/topics - List all research topics
	app.get("/research/topics", async (_req, res) => {
		try {
			const orchestrator = await getOrchestrator();
			const state = orchestrator.getState();

			res.json({
				topics: state.topics.map((t) => ({
					id: t.id,
					name: t.name,
					domain: t.domain,
					priority: t.priority,
					tags: t.tags,
					enableSelfImprovement: t.enableSelfImprovement,
					enableEvolution: t.enableEvolution,
					maxDailyCycles: t.maxDailyCycles,
				})),
				count: state.topics.length,
			});
		} catch (error) {
			logError("Research topics error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /research/recent - Get recent research results
	app.get("/research/recent", async (req, res) => {
		try {
			const orchestrator = await getOrchestrator();
			const limit = Math.min(parseInt(String(req.query.limit) || "10", 10), 100);
			const state = orchestrator.getState();

			res.json({
				results: state.recentResults.slice(0, limit),
				count: state.recentResults.length,
			});
		} catch (error) {
			logError("Research recent error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// GET /research/subscribers - List webhook subscribers
	app.get("/research/subscribers", async (_req, res) => {
		try {
			const orchestrator = await getOrchestrator();
			const subscribers = orchestrator.getWebhookSubscribers();

			res.json({
				subscribers: subscribers.map((s) => ({
					id: s.id,
					url: s.url.substring(0, 50) + (s.url.length > 50 ? "..." : ""), // Truncate URL for security
					topicIds: s.topicIds,
					domains: s.domains,
					minConfidence: s.minConfidence,
					enabled: s.enabled,
					createdAt: s.createdAt,
				})),
				count: subscribers.length,
			});
		} catch (error) {
			logError("Research subscribers error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /research/subscribe - Add webhook subscriber
	app.post("/research/subscribe", async (req, res) => {
		try {
			const { url, topicIds, domains, minConfidence, secret } = req.body;

			if (!url || typeof url !== "string") {
				res.status(400).json({ error: "Missing required field: url" });
				return;
			}

			// Validate URL format
			try {
				new URL(url);
			} catch {
				res.status(400).json({ error: "Invalid URL format" });
				return;
			}

			const orchestrator = await getOrchestrator();
			const subscriberId = orchestrator.addWebhookSubscriber({
				url: sanitizeInput(url),
				topicIds: Array.isArray(topicIds) ? topicIds.map(String) : undefined,
				domains: Array.isArray(domains) ? domains.map(String) : undefined,
				minConfidence: typeof minConfidence === "number" ? minConfidence : 0.5,
				enabled: true,
				secret: secret ? String(secret) : undefined,
			});

			logInfo(`Research webhook subscriber added: ${subscriberId}`);
			res.json({
				success: true,
				subscriberId,
				message: "Webhook subscriber added successfully",
			});
		} catch (error) {
			logError("Research subscribe error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// DELETE /research/subscribe/:subscriberId - Remove webhook subscriber
	app.delete("/research/subscribe/:subscriberId", async (req, res) => {
		try {
			const { subscriberId } = req.params;
			const orchestrator = await getOrchestrator();

			const removed = orchestrator.removeWebhookSubscriber(subscriberId);

			if (!removed) {
				res.status(404).json({ error: "Subscriber not found" });
				return;
			}

			logInfo(`Research webhook subscriber removed: ${subscriberId}`);
			res.json({ success: true, subscriberId, action: "removed" });
		} catch (error) {
			logError("Research unsubscribe error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /research/subscribe/:subscriberId/toggle - Toggle subscriber enabled state
	app.post("/research/subscribe/:subscriberId/toggle", async (req, res) => {
		try {
			const { subscriberId } = req.params;
			const { enabled } = req.body;

			if (typeof enabled !== "boolean") {
				res.status(400).json({ error: "Missing required field: enabled (boolean)" });
				return;
			}

			const orchestrator = await getOrchestrator();
			const toggled = orchestrator.toggleWebhookSubscriber(subscriberId, enabled);

			if (!toggled) {
				res.status(404).json({ error: "Subscriber not found" });
				return;
			}

			logInfo(`Research webhook subscriber ${enabled ? "enabled" : "disabled"}: ${subscriberId}`);
			res.json({ success: true, subscriberId, enabled });
		} catch (error) {
			logError("Research toggle error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /research/trigger - Manually trigger a research cycle
	app.post("/research/trigger", async (req, res) => {
		try {
			const { topicId } = req.body;
			const orchestrator = await getOrchestrator();

			// Check if already running
			const state = orchestrator.getState();
			if (!state.isRunning) {
				res.status(400).json({ error: "Research orchestrator is not running. Start it first." });
				return;
			}

			// Trigger cycle (returns null if already processing)
			const result = await orchestrator.triggerCycle(topicId);

			if (!result) {
				res.status(409).json({ error: "A research cycle is already in progress" });
				return;
			}

			logInfo(`Research cycle manually triggered: ${result.cycleId}`);
			res.json({
				success: true,
				cycleId: result.cycleId,
				topicId: result.topicId,
				confidence: result.confidence,
				duration: result.duration,
				findings: result.findings?.length || 0,
				insights: result.insights?.length || 0,
			});
		} catch (error) {
			logError("Research trigger error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// ========================================================================
	// PITER Framework - External Prompt Triggers
	// "Stay out of the loop" - agents operate your codebase WITHOUT you
	// ========================================================================

	// Store for PITER trigger configs
	const piterTriggers = new Map<
		string,
		{
			id: string;
			source: "github" | "jira" | "slack" | "custom";
			pattern: string; // Regex pattern to match events
			promptTemplate: string; // Template with {{placeholders}}
			channelId?: string; // Discord channel to report to
			enabled: boolean;
			created: number;
		}
	>();

	// GET /piter/triggers - List all PITER triggers
	app.get("/piter/triggers", async (_req, res) => {
		const triggers = Array.from(piterTriggers.values());
		res.json({ triggers, count: triggers.length });
	});

	// POST /piter/triggers - Create a new PITER trigger
	app.post("/piter/triggers", async (req, res) => {
		try {
			const { source, pattern, promptTemplate, channelId } = req.body;

			if (!source || !pattern || !promptTemplate) {
				res.status(400).json({ error: "Missing required fields: source, pattern, promptTemplate" });
				return;
			}

			const id = `piter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			const trigger = {
				id,
				source: source as "github" | "jira" | "slack" | "custom",
				pattern,
				promptTemplate,
				channelId,
				enabled: true,
				created: Date.now(),
			};

			piterTriggers.set(id, trigger);
			logInfo(`PITER trigger created: ${id} (${source})`);
			res.json({ success: true, trigger });
		} catch (error) {
			logError("PITER trigger create error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// DELETE /piter/triggers/:id - Delete a PITER trigger
	app.delete("/piter/triggers/:id", async (req, res) => {
		const { id } = req.params;
		if (piterTriggers.has(id)) {
			piterTriggers.delete(id);
			logInfo(`PITER trigger deleted: ${id}`);
			res.json({ success: true });
		} else {
			res.status(404).json({ error: "Trigger not found" });
		}
	});

	// POST /piter/github - GitHub webhook handler
	app.post("/piter/github", async (req, res) => {
		try {
			const event = req.headers["x-github-event"] as string;
			const payload = req.body;

			logInfo(`PITER GitHub event: ${event}`);

			// Match against registered triggers
			for (const trigger of piterTriggers.values()) {
				if (trigger.source !== "github" || !trigger.enabled) continue;

				const regex = new RegExp(trigger.pattern);
				const eventStr = JSON.stringify({ event, ...payload });

				if (regex.test(eventStr)) {
					// Fire the prompt
					const prompt = trigger.promptTemplate
						.replace(/\{\{event\}\}/g, event)
						.replace(/\{\{repo\}\}/g, payload.repository?.full_name || "")
						.replace(/\{\{action\}\}/g, payload.action || "")
						.replace(/\{\{title\}\}/g, payload.issue?.title || payload.pull_request?.title || "")
						.replace(/\{\{body\}\}/g, payload.issue?.body || payload.pull_request?.body || "")
						.replace(/\{\{sender\}\}/g, payload.sender?.login || "");

					// Send to Discord channel for processing
					if (trigger.channelId) {
						const channel = await client.channels.fetch(trigger.channelId);
						if (channel && "send" in channel) {
							await (channel as TextChannel).send(
								`🤖 **PITER Trigger Fired**\n` +
									`Source: GitHub (${event})\n` +
									`Repo: ${payload.repository?.full_name || "N/A"}\n\n` +
									`**Prompt:**\n${prompt.slice(0, 1500)}`,
							);
						}
					}

					logInfo(`PITER prompt fired for trigger ${trigger.id}`);
				}
			}

			res.json({ success: true, event });
		} catch (error) {
			logError("PITER GitHub error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /piter/jira - Jira webhook handler
	app.post("/piter/jira", async (req, res) => {
		try {
			const payload = req.body;
			const event = payload.webhookEvent || payload.issue_event_type_name || "unknown";

			logInfo(`PITER Jira event: ${event}`);

			for (const trigger of piterTriggers.values()) {
				if (trigger.source !== "jira" || !trigger.enabled) continue;

				const regex = new RegExp(trigger.pattern);
				if (regex.test(JSON.stringify(payload))) {
					const prompt = trigger.promptTemplate
						.replace(/\{\{event\}\}/g, event)
						.replace(/\{\{key\}\}/g, payload.issue?.key || "")
						.replace(/\{\{summary\}\}/g, payload.issue?.fields?.summary || "")
						.replace(/\{\{description\}\}/g, payload.issue?.fields?.description || "")
						.replace(/\{\{user\}\}/g, payload.user?.displayName || "");

					if (trigger.channelId) {
						const channel = await client.channels.fetch(trigger.channelId);
						if (channel && "send" in channel) {
							await (channel as TextChannel).send(
								`🤖 **PITER Trigger Fired**\n` +
									`Source: Jira (${event})\n` +
									`Issue: ${payload.issue?.key || "N/A"}\n\n` +
									`**Prompt:**\n${prompt.slice(0, 1500)}`,
							);
						}
					}

					logInfo(`PITER prompt fired for trigger ${trigger.id}`);
				}
			}

			res.json({ success: true, event });
		} catch (error) {
			logError("PITER Jira error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /piter/slack - Slack webhook handler
	app.post("/piter/slack", async (req, res) => {
		try {
			const payload = req.body;

			// Handle Slack URL verification challenge
			if (payload.type === "url_verification") {
				res.json({ challenge: payload.challenge });
				return;
			}

			const event = payload.event?.type || payload.type || "unknown";
			logInfo(`PITER Slack event: ${event}`);

			for (const trigger of piterTriggers.values()) {
				if (trigger.source !== "slack" || !trigger.enabled) continue;

				const regex = new RegExp(trigger.pattern);
				if (regex.test(JSON.stringify(payload))) {
					const prompt = trigger.promptTemplate
						.replace(/\{\{event\}\}/g, event)
						.replace(/\{\{channel\}\}/g, payload.event?.channel || "")
						.replace(/\{\{text\}\}/g, payload.event?.text || "")
						.replace(/\{\{user\}\}/g, payload.event?.user || "");

					if (trigger.channelId) {
						const channel = await client.channels.fetch(trigger.channelId);
						if (channel && "send" in channel) {
							await (channel as TextChannel).send(
								`🤖 **PITER Trigger Fired**\n` +
									`Source: Slack (${event})\n\n` +
									`**Prompt:**\n${prompt.slice(0, 1500)}`,
							);
						}
					}

					logInfo(`PITER prompt fired for trigger ${trigger.id}`);
				}
			}

			res.json({ success: true, event });
		} catch (error) {
			logError("PITER Slack error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// POST /piter/custom - Custom webhook handler (generic)
	app.post("/piter/custom", async (req, res) => {
		try {
			const { triggerId, data } = req.body;

			if (triggerId) {
				// Fire specific trigger
				const trigger = piterTriggers.get(triggerId);
				if (!trigger || !trigger.enabled) {
					res.status(404).json({ error: "Trigger not found or disabled" });
					return;
				}

				const prompt = trigger.promptTemplate.replace(/\{\{data\}\}/g, JSON.stringify(data));

				if (trigger.channelId) {
					const channel = await client.channels.fetch(trigger.channelId);
					if (channel && "send" in channel) {
						await (channel as TextChannel).send(
							`🤖 **PITER Custom Trigger Fired**\n` +
								`Trigger: ${trigger.id}\n\n` +
								`**Prompt:**\n${prompt.slice(0, 1500)}`,
						);
					}
				}

				res.json({ success: true, triggerId });
			} else {
				// Match against all custom triggers
				for (const trigger of piterTriggers.values()) {
					if (trigger.source !== "custom" || !trigger.enabled) continue;

					const regex = new RegExp(trigger.pattern);
					if (regex.test(JSON.stringify(data))) {
						const prompt = trigger.promptTemplate.replace(/\{\{data\}\}/g, JSON.stringify(data));

						if (trigger.channelId) {
							const channel = await client.channels.fetch(trigger.channelId);
							if (channel && "send" in channel) {
								await (channel as TextChannel).send(
									`🤖 **PITER Custom Trigger Fired**\n` +
										`Trigger: ${trigger.id}\n\n` +
										`**Prompt:**\n${prompt.slice(0, 1500)}`,
								);
							}
						}
					}
				}

				res.json({ success: true });
			}
		} catch (error) {
			logError("PITER custom error", error instanceof Error ? error.message : String(error));
			res.status(500).json({ error: "Internal error" });
		}
	});

	// 404 handler
	app.use((_req, res) => {
		res.status(404).json({ error: "Not found" });
	});

	// Global error handler
	app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		logError("Express error", err.message);
		res.status(500).json({ error: "Internal server error" });
	});

	// ========================================================================
	// Queue Processing
	// ========================================================================

	// Process webhook queue periodically
	setInterval(async () => {
		await webhookQueue.process(async (item) => {
			try {
				if (item.type === "alert") {
					const { message, priority } = item.payload;
					const prefix = priority === "high" ? "**ALERT**" : "**Alert**";
					await retryWithBackoff(() => sendToReportChannel(client, `${prefix}: ${message}`));
				} else if (item.type === "signal") {
					const { symbol, action, price, reason } = item.payload;
					const msg = `**Trading Signal**\nSymbol: \`${symbol}\`\nAction: **${action}**\nPrice: ${price}\nReason: ${reason}`;
					await retryWithBackoff(() => sendToReportChannel(client, msg));
				}
			} catch (error) {
				logError(`Failed to process queue item ${item.id}`, error instanceof Error ? error.message : String(error));
				throw error; // Re-throw to trigger retry logic
			}
		});
	}, CONFIG.WEBHOOK_PROCESS_INTERVAL);

	return app;
}

export { webhookQueue };
