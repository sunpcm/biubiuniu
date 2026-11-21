import { resolveModule } from "./checksum.js";
import { ALL_MODULES } from "./modules/index.js";
import { PROFILES } from "./profiles.js";
import type {
  MigrationModule,
  MigrationPlan,
  ResolvedModule,
} from "./types.js";

function validateManifest(
  modules: readonly MigrationModule[],
): Map<string, MigrationModule> {
  const map = new Map<string, MigrationModule>();
  for (const module of modules) {
    if (map.has(module.name)) {
      throw new Error(`Migration manifest declares duplicate module: ${module.name}`);
    }
    map.set(module.name, module);
  }
  return map;
}

function closureOf(
  roots: readonly string[],
  manifest: Map<string, MigrationModule>,
): Set<string> {
  for (const root of roots) {
    if (!manifest.has(root)) {
      throw new Error(`Unknown migration module: ${root}`);
    }
  }

  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const module = manifest.get(name)!;
    for (const dep of module.dependencies) {
      if (!manifest.has(dep)) {
        throw new Error(
          `Module ${name} requires ${dep}, which is not declared in the manifest`,
        );
      }
      visit(dep);
    }
  };
  for (const root of roots) visit(root);
  return seen;
}

/**
 * Resolve an explicit module manifest and root set into an ordered, validated
 * plan.
 *
 * The dependency closure is expanded from the roots, then topologically sorted
 * (Kahn's algorithm). Duplicate modules, unknown modules, a missing dependency
 * inside the closure, and dependency cycles all reject with a clear error
 * before any SQL is touched.
 */
export function planModules(
  modules: readonly MigrationModule[],
  roots: readonly string[],
): MigrationPlan {
  const manifest = validateManifest(modules);
  const closure = closureOf(roots, manifest);

  // Kahn topological sort over the selected subset.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const name of closure) {
    indegree.set(name, 0);
    dependents.set(name, []);
  }
  for (const name of closure) {
    const module = manifest.get(name)!;
    for (const dep of module.dependencies) {
      indegree.set(name, (indegree.get(name) ?? 0) + 1);
      dependents.get(dep)!.push(name);
    }
  }

  const ready = [...closure]
    .filter((name) => indegree.get(name) === 0)
    .sort();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const name = ready.shift()!;
    ordered.push(name);
    for (const dependent of dependents.get(name)!) {
      const next = (indegree.get(dependent) ?? 1) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (ordered.length !== closure.size) {
    const cyclic = [...closure].filter((name) => !ordered.includes(name));
    throw new Error(`Migration dependency cycle detected: ${cyclic.join(", ")}`);
  }

  const resolved: ResolvedModule[] = ordered.map((name) =>
    resolveModule(manifest.get(name)!),
  );

  return { profile: "", modules: resolved };
}

/**
 * Resolve a named profile into an ordered, validated plan.
 */
export function planProfile(profileName: string): MigrationPlan {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown migration profile: ${profileName}`);
  }

  const plan = planModules(ALL_MODULES, profile.modules);
  return { ...plan, profile: profile.name };
}
