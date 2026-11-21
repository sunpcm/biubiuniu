/**
 * [INPUT]: No dependencies (a pure inline script, rendered by React on the server as a <script> tag)
 * [OUTPUT]: Exports the DomTranslationGuard component (DOM guard patch, must sit inside <head>)
 * [POS]: Global guard layer of components/shared, consumed by app/[locale]/layout and app/(site)/layout
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

// ============================================================
// Background: whole-page browser translation wraps
// React-managed text nodes in <font> tags; a later React commit
// calling removeChild / insertBefore on a node that has been
// moved away throws NotFoundError and the whole page collapses
// into the error boundary (facebook/react#11538).
//
// The first line of defense is translate="no" + the notranslate
// meta on the layout, but Edge, Safari and third-party
// translation extensions do not necessarily honour that marker,
// so this is the fallback: wrap those two DOM primitives
// defensively — when the target node is no longer under the
// expected parent, degrade silently (return the node itself) and
// let React keep committing. The only cost is that a translated
// page may retain a few stale text fragments — far better than a
// blank screen.
//
// Side-effect warning: this patch is global, so if the project's
// own code calls removeChild/insertBefore incorrectly it will
// also degrade silently instead of throwing.
//
// Must run as an inline script before hydration, hence no useEffect.
// ============================================================

const GUARD_SCRIPT = `
if (typeof Node === "function" && Node.prototype && !window.__domTranslationGuard) {
  window.__domTranslationGuard = true;
  var originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child.parentNode !== this) {
      if (console) {
        console.error("Cannot remove a child from a different parent", child, this);
      }
      return child;
    }
    return originalRemoveChild.apply(this, arguments);
  };
  var originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (console) {
        console.error("Cannot insert before a reference node from a different parent", referenceNode, this);
      }
      return newNode;
    }
    return originalInsertBefore.apply(this, arguments);
  };
}
`.trim();

export function DomTranslationGuard() {
  return <script dangerouslySetInnerHTML={{ __html: GUARD_SCRIPT }} />;
}
