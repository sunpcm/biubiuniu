# 测试日志摘要（原始日志未入库，仅保留汇总与失败/跳过原因）

## test-packages.log
ℹ tests 179
ℹ pass 171
ℹ fail 0
ℹ cancelled 0
ℹ skipped 8
﹣ PG billing queries and commerce join share the caller transaction  # COMMERCE_PG_DATABASE_URL is not injected; controller runs this after schema freeze
﹣ PG commerce refuses root, foreign, other-instance, and closed units before any write  # COMMERCE_PG_DATABASE_URL is not injected; controller runs this after schema freeze
﹣ PG migration profiles end-to-end  # SKIP
﹣ auth+credits PG: compensation deletes only the just-added member and keeps owner + existing  # AUTH_CREDITS_PG_TEST_URL not set
﹣ auth+credits PG: getOrgSeatCap reads the open transaction but not the root connection  # AUTH_CREDITS_PG_TEST_URL not set
﹣ auth+credits PG: live/dunning entitlement and personal/org deletion protection  # AUTH_CREDITS_PG_TEST_URL not set
﹣ auth-only PG: Teams endpoints unregistered when organization is not selected  # AUTH_PG_TEST_URL not set
﹣ auth-only PG: no billing tables and real ban/member reads; reclaim rejects without billing  # AUTH_PG_TEST_URL not set

## test-engineering.log
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0

## test-engineering-offline-nometa.log
ℹ tests 4
ℹ pass 3
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
✖ failing tests:
✖ real tarball installs outside workspace and loads Tailwind sorting 

## test-routing.log
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0

## test-domain.log
ℹ tests 234
ℹ pass 104
ℹ fail 119
ℹ cancelled 0
ℹ skipped 11
✖ /home/user/biubiuniu/test/domain/commerce-atomicity.test.ts 
✖ A05: a plain user cannot impersonate 
✖ A05: anonymous callers are rejected from admin impersonation 
✖ A06: a banned user is denied fresh privileges and workspace immediately 
✖ A06: an expired ban no longer blocks the user 
✖ A06: fresh guard drops admin privileges after demotion 
✖ A06: fresh guard returns null after session revocation 
✖ A07: Magic link sends a URL and verifies into a session 
✖ A07: OTP creates a new account and sets a session 
✖ A07: OTP rejects a wrong code 
✖ A07: OTP rejects an expired code 
✖ A07: OTP signs an existing account back in without duplicating the user 
✖ A07: OTP signs in through the real HTTP handler 
✖ A08: a Redis failure lets the gift through 
✖ A08: missing signals and a null Redis still grant the gift 
✖ A08: per-IP cap withholds after the configured limit 
✖ A08: per-device cap withholds after the configured limit 
✖ A08: real signup is rejected by a blocklisted email with no user or gift 
✖ A08: real signup respects the per-IP gift cap through the hook wiring 
✖ A08: real signup with a failing Redis still grants the gift 
✖ A08: real signup with a null Redis still grants the gift 
✖ A08: reward orchestration grants on Redis failure and withholds on cap 
✖ A08: signup reward is granted exactly once through the real signup hook 
✖ A09: concurrent accepts never exceed the seat cap 
✖ A09: concurrent invitations never exceed the seat cap 
✖ A09: concurrent invitations with an identical createdAt converge to the seat cap 
✖ A09: personal workspaces are isolated between users 
✖ A09: sequential invitations respect the team seat cap 
✖ A09: workspace context re-verifies membership after switch and removal 
✖ A10: an already-completed order replays as a no-op 
✖ A13: concurrent spend drains exactly once and never goes negative 
✖ A16: a live personal subscription blocks account deletion 
✖ A16: a team subscription blocks organization deletion 
✖ A16: billing history blocks organization deletion 
✖ A16: financial rows survive account deletion (SET NULL) 
✖ A16: owning an organization blocks account deletion 
✖ A36: personal, team and other-team pools never mix 
✖ BR01: a single full refund claws back the same total as split refunds 
✖ BR01: cumulative refund watermark never claws back more than granted (3 credits / 100) 
✖ CMS post and tag associations commit together 

## test-engineering-online-hang.log（在线模式，被手动停止）
✔ private package roots and environment file boundaries are enforced 
✔ Prettier package exposes an auditable release contract 

## typecheck（第一次，未先 build:packages）
@sunpcm/niu-feature-nano:typecheck: src/core.ts(16,36): error TS2307: Cannot find module '@sunpcm/niu-commerce' or its corresponding type declarations.
 Tasks:    6 successful, 9 total
Failed:    @sunpcm/niu-feature-nano#typecheck

## typecheck（build:packages 之后）
 Tasks:    11 successful, 11 total

## build:packages
 Tasks:    9 successful, 9 total

## check:boundaries
  "cycles": [],
  "violations": [],
  "missingDist": []
}
