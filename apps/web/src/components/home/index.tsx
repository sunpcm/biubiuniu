import { BG1 } from "@/components/shared/BGs";
import { getMessages } from "next-intl/server";

// [CUSTOM: START] - sunpcm - custom imports
import Hero1 from "@/components/home/Hero1";
import WechatDonate from "@/components/custom/WechatDonate";
// [CUSTOM: END]

export default async function HomeComponent() {
  const _messages = await getMessages();

  return (
    <div className="w-full">
      <BG1 />

      {/* [CUSTOM: START] - Replace original Hero with Hero1 + WechatDonate */}
      <Hero1 />
      <WechatDonate />
      {/* [CUSTOM: END] */}

      {/* {messages.Landing.Hero && <Hero />} */}

      {/* {messages.Landing.Features && <Features />} */}

      {/* {messages.Landing.UseCases && <UseCases />} */}

      {/* {messages.Pricing && <PricingByGroup />} */}

      {/* {messages.Landing.Pricing && <Pricing />} */}

      {/* {messages.Landing.Testimonials && <Testimonials />} */}

      {/* {messages.Landing.FAQ && <FAQ />} */}

      {/* {messages.Landing.CTA && <CTA />} */}
    </div>
  );
}
