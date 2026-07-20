# Operational runbooks

| Runbook                                              | Profile gate                 |
| ---------------------------------------------------- | ---------------------------- |
| [key-compromise.md](key-compromise.md)               | eval-redis-0.2 / prod-ha-0.2 |
| [provider-outage.md](provider-outage.md)             | all                          |
| [state-restore.md](state-restore.md)                 | eval-redis-0.2 / prod-ha-0.2 |
| [abuse-and-rate-limits.md](abuse-and-rate-limits.md) | eval+/prod                   |

These are operator procedures. They do not weaken fail-closed protocol
behavior. Production cutover still requires independent assessment evidence.
