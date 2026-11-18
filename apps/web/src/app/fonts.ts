/**
 * [INPUT]: Depends on next/font/local with pinned, license-complete local
 *           assets (see fonts/SOURCES.md for upstream commit / SHA / OFL)
 * [OUTPUT]: Exports inter, karla and pacifico (brand script face, injects the
 *           --font-pacifico variable, mapped to the font-brand utility in
 *           styles/custom.utilities.css)
 * [POS]: Font registry of app/, pacifico is mounted on <body> by [locale]/layout.tsx
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import localFont from "next/font/local";

export const inter = localFont({
  src: "./fonts/Inter-Variable.ttf",
  weight: "100 900",
  display: "swap",
  variable: "--font-sans",
});

/* ------------------------------------------------------------------ */
/*  Brand face: Pacifico script, same spirit as the cursive "n" logo   */
/*  Usage: the font-brand utility (see styles/custom.utilities.css)    */
/* ------------------------------------------------------------------ */
export const pacifico = localFont({
  src: "./fonts/Pacifico-Regular.ttf",
  weight: "400",
  display: "swap",
  variable: "--font-pacifico",
});

export const karla = localFont({
  src: "./fonts/Karla-Variable.ttf",
  weight: "200 800",
  display: "swap",
});
