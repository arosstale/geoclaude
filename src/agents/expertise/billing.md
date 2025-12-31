# Billing Expert

## Mental Model
Accumulated expertise for payment processing, subscription management,
and financial transactions. Critical domain where errors can cause
real financial impact and compliance issues.

*Last updated: 2025-12-20 07:37:31 UTC*
*Risk Level: critical*
*Total sessions: 0*

## Patterns Learned
<!-- Billing patterns and best practices -->

## Common Pitfalls
<!-- Billing mistakes to avoid -->
- Race conditions in payment processing
- Missing idempotency keys for transactions
- Incorrect decimal handling for currency
- Not logging financial transactions

## Effective Approaches
<!-- Approaches for reliable billing -->
- Idempotent payment operations
- Decimal/BigInt for currency calculations
- Comprehensive audit logging
- Webhook signature verification

## Compliance Considerations
<!-- PCI-DSS and other compliance learnings -->

## Subscription Logic
<!-- Subscription management patterns -->

## Session Insights
### Seed: 2025-12-20 07:37:31 UTC
**Source:** critical-domain-seed

## Billing Domain Expertise

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
- Log all webhook events

<!-- Recent learning sessions are stored here -->
