import { sha256Hex } from "./util.mjs";

const REQUIRED_CHECKS = [
  { id: "minimal", kind: "profile" },
  { id: "auth_credits", kind: "profile" },
  { id: "nano_payments", kind: "profile" },
  { id: "node", kind: "runtime" },
  { id: "vite", kind: "runtime" },
  { id: "next", kind: "runtime" },
];

function receiptFor(receipts, entry) {
  return receipts?.packages?.[entry.name] ?? null;
}

export function missingPackages({ manifest, receipts }) {
  const missing = [];
  for (const name of Object.keys(manifest.packages).sort()) {
    const entry = manifest.packages[name];
    const receipt = receiptFor(receipts, entry);
    if (!receipt || receipt.version !== entry.version || receipt.integrity !== entry.sri) missing.push(name);
  }
  return missing;
}

export function resumePlan({ manifest, receipts }) {
  const pending = missingPackages({ manifest, receipts });
  return { pending, complete: pending.length === 0, alreadyPublished: Object.keys(manifest.packages).length - pending.length };
}

function verifyEvidence(check, readEvidence, manifestHash) {
  if (!check.evidence || typeof check.evidence.path !== "string" || typeof check.evidence.sha256 !== "string") {
    return { error: "evidence is missing or malformed" };
  }
  let bytes;
  try {
    bytes = readEvidence(check.evidence.path);
  } catch (err) {
    return { error: `cannot read evidence: ${err.message}` };
  }
  if (sha256Hex(bytes) !== check.evidence.sha256) {
    return { error: "evidence sha256 mismatch" };
  }
  let doc;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { error: "evidence is not valid JSON" };
  }
  if (doc.schemaVersion !== 1) return { error: "evidence schemaVersion must be 1" };
  if (doc.id !== check.id) return { error: `evidence id ${doc.id} != check id ${check.id}` };
  if (doc.result !== "passed" || doc.exitCode !== 0) return { error: "evidence did not pass" };
  if (doc.manifestHash !== manifestHash) return { error: "evidence is bound to a different manifest" };
  if (!doc.packages || typeof doc.packages !== "object") return { error: "evidence packages missing" };
  if (!Array.isArray(doc.commands) || doc.commands.length === 0) return { error: "evidence has no execution record (commands)" };
  return { doc };
}

/**
 * A consumer gate must bind the exact manifest/payload, carry real passed
 * evidence for the fixed profile/runtime IDs, and actually install/verify every
 * manifest package. Empty evidence, wrong hash, missing checks, failures and
 * stale manifest bindings are rejected.
 */
export function validateGate({ manifest, gate, readEvidence }) {
  const reasons = [];
  if (!gate || typeof gate !== "object") return { ok: false, reasons: ["gate is missing"] };
  if (gate.schemaVersion !== 1) reasons.push("gate.schemaVersion must be 1");
  if (gate.manifestHash !== manifest.manifestHash) {
    reasons.push(`gate.manifestHash ${gate.manifestHash} != manifest ${manifest.manifestHash}`);
  }

  for (const name of Object.keys(manifest.packages).sort()) {
    if ((gate.payloadHashes?.[name] ?? null) !== manifest.packages[name].payloadHash) {
      reasons.push(`gate payload hash for ${name} does not match manifest`);
    }
  }

  const checks = gate.checks ?? [];
  const covered = new Set();
  for (const req of REQUIRED_CHECKS) {
    const check = checks.find((c) => c && c.id === req.id);
    if (!check) {
      reasons.push(`missing required check: ${req.id}`);
      continue;
    }
    if (check.kind !== req.kind) reasons.push(`${req.id} kind must be ${req.kind}`);
    if (check.result !== "passed" || check.exitCode !== 0) reasons.push(`${req.id} did not pass`);
    if (check.manifestHash !== manifest.manifestHash) reasons.push(`${req.id} bound to a different manifest`);

    const evidence = verifyEvidence(check, readEvidence, manifest.manifestHash);
    if (evidence.error) {
      reasons.push(`${req.id}: ${evidence.error}`);
      continue;
    }
    for (const pkg of check.packages ?? []) {
      const entry = manifest.packages[pkg];
      if (!entry) {
        reasons.push(`${req.id} covers unknown package ${pkg}`);
        continue;
      }
      const ep = evidence.doc.packages?.[pkg];
      if (!ep) {
        reasons.push(`${req.id} evidence is missing package ${pkg}`);
        continue;
      }
      if (ep.payloadHash !== entry.payloadHash) reasons.push(`${req.id} payload mismatch for ${pkg}`);
      if (ep.version !== entry.version) reasons.push(`${req.id} version mismatch for ${pkg}`);
      if (typeof ep.sha256 !== "string" || ep.sha256 !== entry.sha256) reasons.push(`${req.id} install identity mismatch for ${pkg}`);
      covered.add(pkg);
    }
  }

  for (const name of Object.keys(manifest.packages).sort()) {
    if (!covered.has(name)) reasons.push(`package ${name} is not covered by any consumer check`);
  }

  return { ok: reasons.length === 0, reasons };
}
