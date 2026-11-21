# app/[locale]/(basic-layout)/accept-invitation/[id]/
> L2 | Parent: /CLAUDE.md

Landing page for team invitation emails. The server only reads the invitation; accept/decline are client actions. Signed-out visitors round-trip through /login?next=.

Files
- page.tsx: Server entry — reads the invitation via auth.api.getInvitation, detects a recipient mismatch, emits noIndex metadata.
- AcceptInvitationCard.tsx: Interactive card — accept switches the active workspace and routes to /dashboard/team; invalid or already-settled invitations render read-only; an email mismatch offers a sign-out-and-switch exit.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
