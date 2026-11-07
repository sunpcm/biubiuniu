import CTA from "@/components/home/CTA";
import FAQ from "@/components/home/FAQ";
import Features from "@/components/home/Features";
import Hero1 from "@/components/home/Hero1";
import Testimonials from "@/components/home/Testimonials";
import UseCases from "@/components/home/UseCases";
import WechatDonate from "@/components/custom/WechatDonate";
import { PricingSection } from "@/components/pricing";
import { BG1 } from "@/components/shared/BGs";
import { isWechatDonateEnabled } from "@/config/product-display";
import { getMessages } from "next-intl/server";

export default async function HomeComponent() {
  const messages = await getMessages();

  return (
    <div className="w-full">
      <BG1 />

      {messages.Landing.Hero && <Hero1 />}

      {isWechatDonateEnabled() && <WechatDonate />}

      {messages.Landing.Features && <Features />}

      {messages.Landing.UseCases && <UseCases />}

      {messages.Pricing && <PricingSection />}

      {messages.Landing.Testimonials && <Testimonials />}

      {messages.Landing.FAQ && <FAQ />}

      {messages.Landing.CTA && <CTA />}
    </div>
  );
}
