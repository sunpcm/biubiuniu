# 探针复跑输出（FABLE-XCHECK-20261111）

环境：本会话 scratchpad 内自建的临时 PostgreSQL 16.15 集群，只监听 127.0.0.1:55432，trust 认证，角色 `fable_probe_admin`。用完已 `pg_ctl stop`。
这些库不是 `docs/agent-review-loop.md` 规定的标准隔离库，结果只算补充证据。

## 1. 上一轮探针原样复跑

脚本 `probe-c1-c2-unknown.mjs` 与上一轮分支上的文件逐字节相同（SHA256 `e144f2a52ec3e780ba4eb28388cf11d56cfd9cc9a2cdc5d294394ad67f1c5075`）。

```text
$ FABLE_PROBE_PG_URL=postgres://fable_probe_admin@127.0.0.1:55432/fable_probe_xcheck_c1c2 \
  FABLE_PROBE_EXPECTED_DB=fable_probe_xcheck_c1c2 \
  node review-delivery/FABLE-XCHECK-20261111/evidence/probe-c1-c2-unknown.mjs
退出码：0
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
  "database": "fable_probe_xcheck_c1c2",
  "results": {
    "C1a": "unknown 保留 active job；余额 2→1 未退；DELETE user 23503；无 claim 的 fail/complete/cancel 全部拒绝",
    "C1b": "同一 claim 的迟到结果可把 unknown 推到 succeeded 并删除 active job（仅限原进程仍存活）",
    "C1c": "持 claim 的 fail 可把 unknown 推到 failed 并退款（同样只限原进程）",
    "C2": "SIGTERM 后子进程 exit=143，行停在 dispatching；lease 过期后被扫成 unknown，积分未退"
  }
}
```

## 2. 补充探针 `probe-xcheck-extra.mjs`

第一次运行（库 `fable_probe_xcheck_extra`）退出码 0，但 X1 的断言写错了：我预期先触发的是 `nano_active_jobs` 的外键，实际先触发的是 `credit_transactions_organization_id_organization_id_fk`。脚本把它记成了“未完成”。改掉这条错误预期后在新的空库上重跑：

```text
$ FABLE_PROBE_PG_URL=postgres://fable_probe_admin@127.0.0.1:55432/fable_probe_xcheck_extra2 \
  FABLE_PROBE_EXPECTED_DB=fable_probe_xcheck_extra2 \
  node review-delivery/FABLE-XCHECK-20261111/evidence/probe-xcheck-extra.mjs
退出码：0
{
  severity_local: 'NOTICE',
  severity: 'NOTICE',
  code: '42622',
  message: 'identifier "credit_transactions_refunded_transaction_id_credit_transactions_id_fk" will be truncated to "credit_transactions_refunded_transaction_id_credit_transactions"',
  file: 'scansup.c',
  line: '99',
  routine: 'truncate_identifier'
}
{
  "probe": "xcheck-extra",
  "database": "fable_probe_xcheck_extra2",
  "results": {
    "X1": {
      "deleteOrganization": "23503",
      "firstBlocker": "credit_transactions_organization_id_organization_id_fk",
      "allRestrictingFks": [
        "credit_transactions.credit_transactions_organization_id_organization_id_fk",
        "nano_active_jobs.nano_active_jobs_organization_id_organization_id_fk",
        "subscriptions.subscriptions_organization_id_organization_id_fk"
      ],
      "actorUserDeleted": true
    },
    "X2": {
      "inputBase64Bytes": 6990508,
      "listBySubject_1row": {
        "bytes": 6991147,
        "ms": 35
      },
      "get_poll": {
        "bytes": 6991145,
        "ms": 41
      },
      "markLeased_returning": {
        "bytes": 6991201
      },
      "projected_select": {
        "bytes": 161,
        "ms": 1
      },
      "note": "列表 DTO 实际只用 id/status/cost/时间；前端轮询默认每秒一次 get"
    },
    "X3": "unknown 后同 requestKey 重放：created=false，返回同一 unknown 任务，余额仍为 1（不新建、不再扣、也不退）"
  }
}
```

## 3. 两条迁移链的 schema 实测对比

库 `fable_probe_ddl_n2`：用 psql 依次执行 `apps/web/src/lib/db/migrations/0000…0002` 三份 SQL。
库 `fable_probe_ddl_niu`：用 `ddl-dump-modules.mts` 导出 `auth`、`payments`、`credits`、`nano` 四个模块的 SQL 后用 psql 依次执行。
两边都没有经过各自的 runner，所以没有 journal 表，对比的只是业务 DDL。

```text
$ pg_dump --schema-only --no-owner --no-privileges <库> （去掉 \restrict 行）
$ diff n2.schema.sql niu.schema.sql   → 退出码 1
只在 n2 一侧的行：351；只在 niu 一侧的行：0
n2 表数 21，niu 表数 16；n2 独有：feedback、feedback_replies、post_tags、posts、tags
```

完整 diff 见 `ddl-n2-vs-niu.schema.diff`。
