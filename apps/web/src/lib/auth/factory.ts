/**
 * Auth configuration factory. Thin re-export of `@sunpcm/niu-auth`'s
 * `createAuth`; the application assembly (adapter, policy store, billing,
 * mail, reward, signup guard, request signal, capabilities, Next plugins)
 * lives in `../composition/auth`. Production and the domain tests now both
 * call that one composition, so there is no second set of rules.
 */
export { createAuth } from "@sunpcm/niu-auth";
export type { CreateAuthDeps } from "@sunpcm/niu-auth";
