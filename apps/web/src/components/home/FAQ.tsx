import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@niu/ui/accordion";
import { useTranslations } from "next-intl";

type FAQItem = {
  question: string;
  answer: string;
};

export default function FAQ() {
  const t = useTranslations("Landing.FAQ");

  const faqs: FAQItem[] = t.raw("items");

  return (
    <section id="testimonials" className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="z-10 mb-4 text-center font-sans text-lg font-semibold md:text-5xl">
            <span className="title-gradient">{t("title")}</span>
          </h2>
          <p className="mx-auto max-w-3xl text-xl text-gray-600 dark:text-gray-400">
            {t("description")}
          </p>
        </div>

        <Accordion
          type="single"
          collapsible
          className="bg-card ring-muted w-full rounded-2xl border px-8 py-3 shadow-xs ring-4 dark:ring-0"
        >
          {faqs.map((item) => (
            <AccordionItem key={item.question} value={item.question} className="border-dashed">
              <AccordionTrigger className="cursor-pointer text-base hover:no-underline">
                {item.question}
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-base">{item.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
