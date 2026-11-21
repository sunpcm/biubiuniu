export interface SiteInfo {
  name: string;
  url: string;
  socialLinks?: {
    [key: string]: string | undefined;
  };
}
