import { getRequestConfig } from 'next-intl/server';
import { DISABLED_UI_LOCALES, routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (
    !locale ||
    !routing.locales.includes(locale as (typeof routing.locales)[number]) ||
    DISABLED_UI_LOCALES.includes(locale as (typeof DISABLED_UI_LOCALES)[number])
  ) {
    locale = routing.defaultLocale;
  }

  const common = (await import(`./messages/${locale}/common.json`)).default;

  return {
    locale,
    messages: {
      Landing: (await import(`./messages/${locale}/Landing.json`)).default,
      Pricing: (await import(`./messages/${locale}/Pricing.json`)).default,
      PaymentSuccess: (await import(`./messages/${locale}/PaymentSuccess.json`)).default,
      NotFound: (await import(`./messages/${locale}/NotFound.json`)).default,
      Glossary: (await import(`./messages/${locale}/Glossary.json`)).default,

      // Dashboard - User
      Settings: (await import(`./messages/${locale}/Dashboard/User/Settings.json`)).default,
      Billing: (await import(`./messages/${locale}/Dashboard/User/Billing.json`)).default,
      CreditHistory: (await import(`./messages/${locale}/Dashboard/User/CreditHistory.json`)).default,
      MyOrders: (await import(`./messages/${locale}/Dashboard/User/MyOrders.json`)).default,
      Team: (await import(`./messages/${locale}/Dashboard/User/Team.json`)).default,

      // Dashboard - Admin
      Overview: (await import(`./messages/${locale}/Dashboard/Admin/Overview.json`)).default,
      Users: (await import(`./messages/${locale}/Dashboard/Admin/Users.json`)).default,
      DashboardBlogs: (await import(`./messages/${locale}/Dashboard/Admin/Blogs.json`)).default,
      DashboardGlossary: (await import(`./messages/${locale}/Dashboard/Admin/Glossary.json`)).default,
      Orders: (await import(`./messages/${locale}/Dashboard/Admin/Orders.json`)).default,
      Coupons: (await import(`./messages/${locale}/Dashboard/Admin/Coupons.json`)).default,
      Credits: (await import(`./messages/${locale}/Dashboard/Admin/Credits.json`)).default,
      R2Files: (await import(`./messages/${locale}/Dashboard/Admin/R2Files.json`)).default,
      Feedback: (await import(`./messages/${locale}/Feedback.json`)).default,

      // common
      ...common
    }
  };
});
