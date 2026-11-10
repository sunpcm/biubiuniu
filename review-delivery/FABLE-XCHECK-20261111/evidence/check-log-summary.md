# 本轮检查日志摘要

## test:packages 中被 skip 的 8 项（记为未验证）

```text
﹣ auth-only PG: no billing tables and real ban/member reads; reclaim rejects without billing  # AUTH_PG_TEST_URL not set
﹣ auth-only PG: Teams endpoints unregistered when organization is not selected  # AUTH_PG_TEST_URL not set
﹣ auth+credits PG: compensation deletes only the just-added member and keeps owner + existing  # AUTH_CREDITS_PG_TEST_URL not set
﹣ auth+credits PG: getOrgSeatCap reads the open transaction but not the root connection  # AUTH_CREDITS_PG_TEST_URL not set
﹣ auth+credits PG: live/dunning entitlement and personal/org deletion protection  # AUTH_CREDITS_PG_TEST_URL not set
﹣ PG billing queries and commerce join share the caller transaction  # COMMERCE_PG_DATABASE_URL is not injected; controller runs this after schema freeze
﹣ PG commerce refuses root, foreign, other-instance, and closed units before any write  # COMMERCE_PG_DATABASE_URL is not injected; controller runs this after schema freeze
﹣ PG migration profiles end-to-end  # SKIP
```

## 干净 checkout 上直接 typecheck 的失败

```text
@sunpcm/niu-feature-nano:typecheck: src/core.ts(16,36): error TS2307: Cannot find module '@sunpcm/niu-commerce' or its corresponding type declarations.
 Tasks:    6 successful, 9 total
Failed:    @sunpcm/niu-feature-nano#typecheck
```
