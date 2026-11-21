import { SiteConfig } from "@/types/siteConfig";

export const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://biubiuniu.com";

const GITHUB_URL = 'https://github.com/sunpcm'
const TWITTER_EN = 'https://x.com/ylspcm'
const TWITTER_ZH = 'https://x.com/ylspcm'
const BSKY_URL = 'https://bsky.app/profile/sunpcm.bsky.social'
const YOUTUBE_URL = ''
const INSTAGRAM_URL = ''
const TIKTOK_URL = ''
const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL
const EMAIL_URL = 'hi@biubiuniu.com'

export const siteConfig: SiteConfig = {
  name: "BiuBiuNiu",
  description:
    "小熏同学和他朋友们的酷炫工具合集：AI 创作、内容工具与实验项目。",
  url: BASE_URL,
  authors: [
    {
      name: "BiuBiuNiu",
      url: "https://biubiuniu.com",
    }
  ],
  creator: '@sunpcm',
  socialLinks: {
    github: GITHUB_URL,
    bluesky: BSKY_URL,
    twitter: TWITTER_EN,
    twitterZh: TWITTER_ZH,
    youtube: YOUTUBE_URL,
    instagram: INSTAGRAM_URL,
    tiktok: TIKTOK_URL,
    discord: DISCORD_URL,
    email: EMAIL_URL,
  },
  themeColors: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
  defaultNextTheme: 'light', // next-theme option: system | dark | light
  icons: {
    icon: "/favicon.ico",
    shortcut: "/logo-mini.png",
    apple: "/logo-mini.png",
  },
}
