/**
 * LEARNING ACTIVATION SERVICE
 * ============================
 * Central service to trigger learning across all agent modes
 *
 * Problem: 18/21 expertise files are empty templates
 * Solution: Automatically extract learnings from agent outputs and seed critical domains
 *
 * Implements TAC Lesson 13: Agent Experts (Act-Learn-Reuse)
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { detectExpertDomain } from "./agent-experts.js";
import {
	extractLearnings,
	getExpertiseModes,
	getExpertisePath,
	loadExpertise,
	updateExpertise,
} from "./expertise-manager.js";

export interface LearningActivationConfig {
	autoLearn: boolean;
	minOutputLength: number;
	criticalDomains: string[];
	learningThreshold: number; // 0-1, how confident we need to be to learn
}

export interface ActivationResult {
	learned: boolean;
	domain: string;
	insight: string;
	expertiseFile: string;
	confidence: number;
}

export interface DomainStats {
	domain: string;
	sessionCount: number;
	lastUpdated: string | null;
	isEmpty: boolean;
}

// Default configuration
const DEFAULT_CONFIG: LearningActivationConfig = {
	autoLearn: true,
	minOutputLength: 200,
	criticalDomains: ["security", "database", "trading", "billing", "api_integration", "performance"],
	learningThreshold: 0.3,
};

// Learning triggers - patterns that indicate valuable output
const LEARNING_TRIGGERS = [
	// Success indicators
	/successfully|completed|fixed|resolved|implemented/i,
	// Pattern discovery
	/pattern|approach|technique|strategy|method/i,
	// Insights
	/discovered|found|noticed|identified|realized/i,
	// Recommendations
	/recommend|suggest|should|best practice|tip/i,
	// Error handling
	/error|bug|issue|problem|fix|debug/i,
	// Analysis
	/analysis|analyzed|assessment|evaluation/i,
];

// Anti-patterns - outputs we should NOT learn from
const ANTI_LEARNING_PATTERNS = [
	/^(ok|yes|no|done|sure|thanks)$/i,
	/i don't know|i'm not sure|i cannot/i,
	/error occurred|failed to|could not/i,
];

class LearningActivationService {
	private config: LearningActivationConfig;
	private sessionLearnings: Map<string, ActivationResult[]> = new Map();

	constructor(config: Partial<LearningActivationConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Process agent output and extract learnings
	 * This is the main entry point for learning activation
	 */
	async processOutput(output: string, task: string, success: boolean, sessionId?: string): Promise<ActivationResult> {
		const result: ActivationResult = {
			learned: false,
			domain: "general",
			insight: "",
			expertiseFile: "",
			confidence: 0,
		};

		// Check minimum requirements
		if (!this.config.autoLearn || !output || output.length < this.config.minOutputLength) {
			return result;
		}

		// Check for anti-patterns (outputs we shouldn't learn from)
		for (const pattern of ANTI_LEARNING_PATTERNS) {
			if (pattern.test(output)) {
				return result;
			}
		}

		// Detect the appropriate domain
		const domain = this.detectDomain(task, output);
		result.domain = domain;
		result.expertiseFile = getExpertisePath(domain);

		// Calculate learning confidence
		result.confidence = this.calculateLearningConfidence(output, task, success);

		// Only learn if confidence exceeds threshold
		if (result.confidence < this.config.learningThreshold) {
			return result;
		}

		// Extract learnings from output
		const learnings = extractLearnings(output);
		if (!learnings || learnings.length < 50) {
			return result;
		}

		// Update expertise file
		const updateResult = updateExpertise(domain, learnings, task, success);
		result.learned = updateResult.learned;
		result.insight = updateResult.insight;

		// Track session learnings
		if (sessionId && result.learned) {
			const sessionResults = this.sessionLearnings.get(sessionId) || [];
			sessionResults.push(result);
			this.sessionLearnings.set(sessionId, sessionResults);
		}

		return result;
	}

	/**
	 * Detect the appropriate domain for a task
	 */
	private detectDomain(task: string, output: string): string {
		// First try the agent-experts detector
		const expertDomain = detectExpertDomain(task);
		if (expertDomain) {
			return expertDomain;
		}

		// Fall back to keyword-based detection
		const combinedText = `${task} ${output}`.toLowerCase();

		const domainKeywords: Record<string, string[]> = {
			security: ["security", "auth", "encryption", "vulnerability", "owasp", "xss", "sql injection"],
			database: ["database", "sql", "query", "migration", "schema", "index", "table"],
			trading: ["trading", "market", "price", "token", "crypto", "dex", "signal", "position"],
			billing: ["billing", "payment", "subscription", "invoice", "stripe", "charge"],
			api_integration: ["api", "endpoint", "webhook", "rest", "graphql", "integration"],
			performance: ["performance", "optimize", "cache", "latency", "memory", "cpu"],
			coding: ["code", "function", "class", "refactor", "implement", "bug", "fix"],
			research: ["research", "analyze", "study", "paper", "findings", "data"],
		};

		let bestDomain = "general";
		let bestScore = 0;

		for (const [domain, keywords] of Object.entries(domainKeywords)) {
			let score = 0;
			for (const keyword of keywords) {
				if (combinedText.includes(keyword)) {
					score += 1;
				}
			}
			if (score > bestScore) {
				bestScore = score;
				bestDomain = domain;
			}
		}

		return bestDomain;
	}

	/**
	 * Calculate confidence that this output contains learnable content
	 */
	private calculateLearningConfidence(output: string, _task: string, success: boolean): number {
		let confidence = 0;

		// Base confidence from success
		if (success) {
			confidence += 0.3;
		}

		// Check learning triggers
		let triggerMatches = 0;
		for (const trigger of LEARNING_TRIGGERS) {
			if (trigger.test(output)) {
				triggerMatches++;
			}
		}
		confidence += Math.min(triggerMatches * 0.1, 0.4);

		// Bonus for structured output (markdown headers, lists)
		if (output.includes("##") || output.includes("###")) {
			confidence += 0.1;
		}
		if (output.includes("- ") || output.includes("* ")) {
			confidence += 0.1;
		}

		// Bonus for code blocks (likely contains examples)
		if (output.includes("```")) {
			confidence += 0.1;
		}

		// Cap at 1.0
		return Math.min(confidence, 1.0);
	}

	/**
	 * Seed a domain with initial knowledge
	 * Used to bootstrap empty expertise files
	 */
	async seedDomain(domain: string, content: string, source: string = "manual"): Promise<boolean> {
		const path = getExpertisePath(domain);
		const timestamp = `${new Date().toISOString().replace("T", " ").substring(0, 19)} UTC`;

		try {
			let current = "";
			if (existsSync(path)) {
				current = readFileSync(path, "utf-8");
			} else {
				// Create from template
				const modeTitle = domain.charAt(0).toUpperCase() + domain.slice(1).replace(/_/g, " ");
				current = `# ${modeTitle} Expert

## Mental Model
Accumulated expertise for ${domain.replace(/_/g, " ")} tasks.

*Last updated: Never*
*Total sessions: 0*

## Patterns Learned
<!-- Agent updates this section with successful patterns -->

## Common Pitfalls
<!-- Agent updates this section with mistakes to avoid -->

## Effective Approaches
<!-- Agent updates this section with approaches that worked well -->

## Session Insights
<!-- Recent learning sessions are stored here -->
`;
			}

			// Add seeded content
			const seedSection = `
### Seed: ${timestamp}
**Source:** ${source}

${content}
`;

			// Insert after Session Insights header
			const sessionMarker = "## Session Insights";
			let updated: string;
			if (current.includes(sessionMarker)) {
				const parts = current.split(sessionMarker);
				updated = parts[0] + sessionMarker + seedSection + (parts[1] || "");
			} else {
				updated = `${current}\n\n${sessionMarker}${seedSection}`;
			}

			// Update metadata
			const lines = updated.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].startsWith("*Last updated:")) {
					lines[i] = `*Last updated: ${timestamp}*`;
				}
			}

			writeFileSync(path, lines.join("\n"));
			return true;
		} catch (error) {
			console.error(`Failed to seed domain ${domain}:`, error);
			return false;
		}
	}

	/**
	 * Get statistics about all expertise domains
	 */
	getStats(): {
		totalDomains: number;
		activeDomains: string[];
		emptyDomains: string[];
		criticalDomainsCoverage: number;
		domainStats: DomainStats[];
	} {
		const modes = getExpertiseModes();
		const domainStats: DomainStats[] = [];
		const activeDomains: string[] = [];
		const emptyDomains: string[] = [];

		for (const mode of modes) {
			const path = getExpertisePath(mode);
			let sessionCount = 0;
			let lastUpdated: string | null = null;
			let isEmpty = true;

			try {
				const content = readFileSync(path, "utf-8");

				// Count sessions
				const sessionMatches = content.match(/### Session:/g);
				sessionCount = sessionMatches ? sessionMatches.length : 0;

				// Check if empty (only template content)
				isEmpty = !content.includes("### Session:") && !content.includes("### Seed:");

				// Get last updated
				const updatedMatch = content.match(/\*Last updated: ([^*]+)\*/);
				if (updatedMatch && updatedMatch[1] !== "Never") {
					lastUpdated = updatedMatch[1];
				}
			} catch {
				isEmpty = true;
			}

			domainStats.push({
				domain: mode,
				sessionCount,
				lastUpdated,
				isEmpty,
			});

			if (isEmpty) {
				emptyDomains.push(mode);
			} else {
				activeDomains.push(mode);
			}
		}

		// Calculate critical domains coverage
		const criticalActive = this.config.criticalDomains.filter((d) => activeDomains.includes(d)).length;
		const criticalDomainsCoverage =
			this.config.criticalDomains.length > 0 ? criticalActive / this.config.criticalDomains.length : 0;

		return {
			totalDomains: modes.length,
			activeDomains,
			emptyDomains,
			criticalDomainsCoverage,
			domainStats,
		};
	}

	/**
	 * Get session learnings
	 */
	getSessionLearnings(sessionId: string): ActivationResult[] {
		return this.sessionLearnings.get(sessionId) || [];
	}

	/**
	 * Clear session learnings
	 */
	clearSessionLearnings(sessionId: string): void {
		this.sessionLearnings.delete(sessionId);
	}

	/**
	 * Check if a domain needs seeding
	 */
	needsSeeding(domain: string): boolean {
		const expertise = loadExpertise(domain);
		return !expertise || expertise.length < 100;
	}

	/**
	 * Get critical domains that need attention
	 */
	getCriticalDomainsNeedingAttention(): string[] {
		return this.config.criticalDomains.filter((d) => this.needsSeeding(d));
	}
}

// Singleton instance
let serviceInstance: LearningActivationService | null = null;

export function getLearningActivationService(config?: Partial<LearningActivationConfig>): LearningActivationService {
	if (!serviceInstance) {
		serviceInstance = new LearningActivationService(config);
	}
	return serviceInstance;
}

// Critical domain seed content
export const CRITICAL_DOMAIN_SEEDS: Record<string, string> = {
	security: `## Security Domain Expertise

### Key Principles
- **Defense in Depth**: Multiple layers of security controls
- **Least Privilege**: Minimum necessary permissions
- **Input Validation**: Never trust user input
- **Output Encoding**: Prevent XSS through proper encoding

### Common Vulnerabilities (OWASP Top 10)
1. Injection (SQL, Command, LDAP)
2. Broken Authentication
3. Sensitive Data Exposure
4. XML External Entities (XXE)
5. Broken Access Control
6. Security Misconfiguration
7. Cross-Site Scripting (XSS)
8. Insecure Deserialization
9. Using Components with Known Vulnerabilities
10. Insufficient Logging & Monitoring

### Best Practices
- Use parameterized queries for database operations
- Implement proper session management
- Store passwords with bcrypt/argon2
- Enable HTTPS everywhere
- Implement rate limiting
- Log security events`,

	database: `## Database Domain Expertise

### Query Optimization
- Use indexes on frequently queried columns
- Avoid SELECT * - specify needed columns
- Use EXPLAIN to analyze query plans
- Batch operations for bulk inserts/updates

### Schema Design
- Normalize to 3NF for transactional data
- Consider denormalization for read-heavy workloads
- Use appropriate data types (don't use TEXT for everything)
- Add foreign key constraints for referential integrity

### Migration Best Practices
- Always backup before migrations
- Test migrations on staging first
- Make migrations reversible when possible
- Use transactions for atomic changes
- Document breaking changes

### Performance Patterns
- Connection pooling
- Read replicas for scaling reads
- Caching frequently accessed data
- Pagination for large result sets`,

	trading: `## Trading Domain Expertise

### Market Analysis Patterns
- **Technical Analysis**: RSI, MACD, Bollinger Bands, Moving Averages
- **Order Flow**: Bid/ask spread, volume analysis, whale tracking
- **Sentiment**: Social signals, fear/greed index, news impact

### Risk Management
- Position sizing (never risk >2% per trade)
- Stop-loss placement (technical levels + volatility)
- Portfolio diversification
- Correlation awareness

### Execution Strategies
- Dollar-cost averaging for entry
- Scaling in/out of positions
- Limit orders vs market orders
- Slippage considerations

### Data Sources
- On-chain analytics (Dune, Flipside)
- DEX aggregators (Jupiter, 1inch)
- Price feeds (CoinGecko, DexScreener)
- Whale tracking (Nansen, Arkham)`,

	billing: `## Billing Domain Expertise

### Payment Processing
- PCI DSS compliance requirements
- Tokenization of card data
- Idempotency for payment requests
- Handling failed payments gracefully

### Subscription Management
- Proration calculations
- Grace periods for failed payments
- Upgrade/downgrade handling
- Usage-based billing calculations

### Financial Accuracy
- Use decimal types, never floats for money
- Store amounts in smallest currency unit (cents)
- Audit trail for all financial transactions
- Reconciliation processes

### Webhook Handling
- Verify webhook signatures
- Handle duplicate events (idempotency)
- Async processing with retries
- Log all webhook events`,

	api_integration: `## API Integration Domain Expertise

### Request Handling
- Implement exponential backoff for retries
- Handle rate limiting gracefully
- Use connection pooling
- Set appropriate timeouts

### Error Handling
- Distinguish transient vs permanent failures
- Circuit breaker pattern for failing services
- Fallback strategies
- Error logging with context

### Authentication Patterns
- OAuth 2.0 / OIDC flows
- API key management (rotation, scoping)
- JWT validation and refresh
- Webhook signature verification

### Data Contracts
- Validate API responses (runtime schema validation)
- Handle missing/null fields gracefully
- Version API integrations
- Document expected formats`,

	performance: `## Performance Domain Expertise

### Profiling Approach
- Measure before optimizing
- Focus on hot paths (80/20 rule)
- Use appropriate profiling tools
- Benchmark with realistic data

### Common Optimizations
- Caching (Redis, in-memory, CDN)
- Lazy loading / code splitting
- Database query optimization
- Async/parallel processing

### Memory Management
- Avoid memory leaks (event listeners, closures)
- Pool expensive objects
- Stream large data instead of buffering
- Monitor heap usage

### Latency Reduction
- Minimize network round trips
- Use edge computing where appropriate
- Compress responses (gzip, brotli)
- Optimize critical rendering path`,
};

/**
 * Seed all critical domains with initial knowledge
 */
export async function seedCriticalDomains(): Promise<{
	seeded: string[];
	skipped: string[];
	failed: string[];
}> {
	const service = getLearningActivationService();
	const result = {
		seeded: [] as string[],
		skipped: [] as string[],
		failed: [] as string[],
	};

	for (const [domain, content] of Object.entries(CRITICAL_DOMAIN_SEEDS)) {
		if (!service.needsSeeding(domain)) {
			result.skipped.push(domain);
			continue;
		}

		const success = await service.seedDomain(domain, content, "critical-domain-seed");
		if (success) {
			result.seeded.push(domain);
		} else {
			result.failed.push(domain);
		}
	}

	return result;
}

export default {
	getLearningActivationService,
	seedCriticalDomains,
	CRITICAL_DOMAIN_SEEDS,
};
