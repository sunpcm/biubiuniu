# 探针运行输出（2026-11-10，自建临时 PG 16，库 fable_probe_c1c2，Node v24.15.0）

命令：FABLE_PROBE_PG_URL=postgres://fable_probe_role@127.0.0.1:55432/fable_probe_c1c2 FABLE_PROBE_EXPECTED_DB=fable_probe_c1c2 node review-delivery/FABLE-ARCH-20261110/evidence/probe-c1-c2-unknown.mjs

退出码：0

```
{
  severity_local: 'NOTICE',
  severity: 'NOTICE',
  code: '42622',
  message: 'identifier "credit_transactions_refunded_transaction_id_credit_transactions_id_fk" will be truncated to "credit_transactions_refunded_transaction_id_credit_transactions"',
  file: 'scansup.c',
  line: '99',
  routine: 'truncate_identifier'
}
migrated modules: [ 'auth', 'payments', 'credits', 'nano' ]
{
  "probe": "c1-c2-unknown",
  "database": "fable_probe_c1c2",
  "results": {
    "C1a": "unknown 保留 active job；余额 2→1 未退；DELETE user 23503；无 claim 的 fail/complete/cancel 全部拒绝",
    "C1b": "同一 claim 的迟到结果可把 unknown 推到 succeeded 并删除 active job（仅限原进程仍存活）",
    "C1c": "持 claim 的 fail 可把 unknown 推到 failed 并退款（同样只限原进程）",
    "C2": "SIGTERM 后子进程 exit=143，行停在 dispatching；lease 过期后被扫成 unknown，积分未退"
  }
}
```
