# Deployment profiles

Version: `deployment-profiles-0.1`  
Status: program baseline

Gates reference a named profile. “Works locally” is not a profile.

## Profile: `dev-local-0.1`

| Metric                                      | Target                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| Purpose                                     | Local development and fixtures only                        |
| AuthN/AuthZ on issuance                     | Not required; must be impossible to mistake for production |
| State                                       | In-memory; lost on restart                                 |
| Availability                                | Best effort                                                |
| p99 verifier latency (excl. human ceremony) | Not gated                                                  |
| Sustained throughput                        | Not gated                                                  |
| Concurrent verify workers                   | 1 process                                                  |
| Clock-skew tolerance                        | ±60 seconds                                                |
| RTO / RPO                                   | N/A (ephemeral)                                            |
| Backup                                      | None                                                       |
| Rate limits                                 | Optional                                                   |
| Allowed to protect production value         | **No**                                                     |

## Profile: `eval-redis-0.2`

| Metric                                             | Target                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Purpose                                            | Single-region evaluation / staging with Redis atomic state |
| AuthN/AuthZ on issuance                            | Required (service identity + authorization policy)         |
| State                                              | Redis 6.2+ atomic scripts; authenticated metadata          |
| Availability                                       | 99.5% monthly (eval)                                       |
| p99 create-requirement                             | ≤ 100 ms                                                   |
| p99 verify (excl. provider RTT and human ceremony) | ≤ 250 ms                                                   |
| Sustained throughput                               | ≥ 50 verifies/s per instance                               |
| Concurrent instances                               | ≥ 2 behind one load balancer                               |
| Clock-skew tolerance                               | ±30 seconds                                                |
| RTO                                                | ≤ 30 minutes                                               |
| RPO                                                | ≤ 5 minutes                                                |
| Backup                                             | Redis AOF or snapshot every ≤ 5 minutes                    |
| Rate limits                                        | Required on issuance and verify                            |
| Provider egress                                    | Explicit allowlist                                         |
| Allowed to protect production value                | Only after independent assessment against this profile     |

## Profile: `prod-ha-0.2`

| Metric                                             | Target                                                   |
| -------------------------------------------------- | -------------------------------------------------------- |
| Purpose                                            | Production-shaped multi-instance deployment              |
| AuthN/AuthZ on issuance                            | Required; least-privilege resource/method/purpose grants |
| State                                              | Redis and/or PostgreSQL transactional profile; multi-AZ  |
| Availability                                       | 99.9% monthly                                            |
| p99 create-requirement                             | ≤ 80 ms                                                  |
| p99 verify (excl. provider RTT and human ceremony) | ≤ 200 ms                                                 |
| Sustained throughput                               | ≥ 200 verifies/s per region (horizontally scalable)      |
| Concurrent instances                               | ≥ 3; survive one AZ loss                                 |
| Clock-skew tolerance                               | ±15 seconds; fail closed beyond                          |
| RTO                                                | ≤ 15 minutes                                             |
| RPO                                                | ≤ 60 seconds                                             |
| Backup                                             | Continuous WAL/AOF; tested restore ≤ RTO                 |
| Rate limits + circuit breakers                     | Required                                                 |
| Key custody                                        | KMS/HSM-compatible; no exported production private keys  |
| Metadata                                           | Authenticated; cache, rollover, revocation tested        |
| Allowed to protect production value                | Only after signed gate record for this profile           |

## Measurement rules

- Latency excludes human ceremony and remote provider network time unless a
  test explicitly measures end-to-end including provider mock RTT.
- Capacity tests must use synthetic proofs and fake provider fixtures.
- Failover, partition, backup, and restore drills must name the profile and
  record wall-clock RTO/RPO evidence.
- Profiles may only get stricter in a new version ID; loosening requires a
  decision record and gate re-approval.
