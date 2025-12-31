# API Integration Expert

## Mental Model
Accumulated expertise for external API integration, error handling,
rate limiting, and contract validation. High-risk domain where external
dependencies can cause cascading failures.

*Last updated: 2025-12-20 07:37:31 UTC*
*Risk Level: high*
*Total sessions: 0*

## Patterns Learned
<!-- API integration patterns and best practices -->

## Common Pitfalls
<!-- Integration mistakes to avoid -->
- Missing retry logic for transient failures
- Unbounded timeouts blocking threads
- Not validating API responses
- Hardcoded API versions

## Effective Approaches
<!-- Approaches for reliable integrations -->
- Circuit breaker patterns for failing services
- Exponential backoff with jitter
- Response validation against schemas
- Graceful degradation when APIs unavailable

## Rate Limiting Strategies
<!-- Learned rate limiting techniques -->

## Error Handling
<!-- Error handling patterns for external APIs -->

## Session Insights
### Seed: 2025-12-20 07:37:31 UTC
**Source:** critical-domain-seed

## API Integration Domain Expertise

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
- Document expected formats

<!-- Recent learning sessions are stored here -->
