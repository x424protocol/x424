# Operational runbooks

| Runbook                                              | Profile gate                 |
| ---------------------------------------------------- | ---------------------------- |
| [key-compromise.md](key-compromise.md)               | eval-redis-0.2 / prod-ha-0.2 |
| [provider-outage.md](provider-outage.md)             | all                          |
| [handoff-operations.md](handoff-operations.md)       | eval-redis-0.2 / prod-ha-0.2 |
| [state-restore.md](state-restore.md)                 | eval-redis-0.2 / prod-ha-0.2 |
| [state-namespace-0.1.3.md](state-namespace-0.1.3.md) | mandatory <=0.1.2 → >=0.1.3  |
| [abuse-and-rate-limits.md](abuse-and-rate-limits.md) | eval+/prod                   |

These are operator procedures. They do not weaken fail-closed protocol
behavior. Production cutover still requires independent assessment evidence.
