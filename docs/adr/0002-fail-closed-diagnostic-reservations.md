# Retain uncertain diagnostic capacity instead of expiring it

**Status: superseded by [ADR 0006](0006-in-memory-timed-diagnostic-capacity.md).** Uncertain capacity now frees itself after the execution budget.

Persistence follow-up: [ADR 0003](0003-durable-diagnostic-ledger.md) extends this first slice with a durable ledger; the safety-over-availability decision below remains in force.

A finite probe count and reply timeout do not establish when an already-delivered eAPI request will start. Releasing a reservation after a guessed command/HTTP window can therefore admit replacement work while the original command can still execute. Prefer safety over availability: retain unknown-completion reservations without automatic expiry, releasing them only after confirmed completion or definitive rejection before execution. When all capacity is uncertain, reject new and queued diagnostics with `diagnostic_capacity_uncertain`; expose sanitized live reservation metadata through server info rather than suggesting automatic retries or a larger cooldown.

This first implementation is scoped to one running server instance. It adds no SSH/shell fallback, remote kill timer, operator reset endpoint, or persistent journal. Restarting loses reservations and is not safe reconciliation. Durable recovery and qualification of any native EOS execution lifecycle/deadline require separate work; this change closes the timer-based capacity-reuse gap, not those remaining guarantees.
