# components/layout/
> L2 | Parent: /CLAUDE.md

Member roster
SidebarUserCard.tsx: dashboard sidebar footer card, SWR-loaded workspace credit balance rendered as a coin badge (`border-credit-border + bg-credit + text-credit-foreground`, Coins icon inside), with a primary-colored composition bar + legend and the upgrade/credit-pack CTA, stacked on the user menu (avatar + sign-out dropdown); collapses to a Coins icon button with a balance tooltip.

Gold law: the `--credit` trio is the balance affordance's colors and nothing else — dashboard balance stats (billing, team pool, admin user detail) stay `foreground`. The tokens swap roles across themes (light = gold fill + bronze ink, dark = gold ink on a wash), so the markup carries one class set and no `dark:` branch. Everything else in the card rides `--primary`, so a buyer swapping the tweakcn palette only ever sees this one warm badge.

Law: Complete roster, one line per file, parent link, tech terms first

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
