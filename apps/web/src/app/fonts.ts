/**
 * [INPUT]: Depends on next/font/google self-hosted font loading
 * [OUTPUT]: Exports inter, karla and pacifico (brand script face, injects the
 *           --font-pacifico variable, mapped to the font-brand utility in
 *           styles/custom.utilities.css)
 * [POS]: Font registry of app/, pacifico is mounted on <body> by [locale]/layout.tsx
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

// https://fonts.google.com/

import { Inter, Karla, Pacifico } from 'next/font/google'

export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
})

/* ------------------------------------------------------------------ */
/*  Brand face: Pacifico script, same spirit as the cursive "n" logo   */
/*  Usage: the font-brand utility (see styles/custom.utilities.css)    */
/* ------------------------------------------------------------------ */
export const pacifico = Pacifico({
  weight: "400",
  display: "swap",
  subsets: ["latin"],
  variable: "--font-pacifico",
})

export const karla = Karla({
  subsets: ['latin'],
  display: 'swap',
})
