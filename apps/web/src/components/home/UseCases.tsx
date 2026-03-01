import { DynamicIcon } from "@/components/DynamicIcon";
import FeatureBadge from "@/components/shared/FeatureBadge";
import { GlowingEffect } from "@niu/ui/glowing-effect";
import { useTranslations } from "next-intl";

type UseCase = {
  title: string;
  description: string;
  image: string;
  icon: string;
};

const UseCaseCard = ({ useCase }: { useCase: UseCase }) => {
  return (
    <li className="min-h-64 list-none">
      <div className="border-border relative h-full rounded-[1.25rem] border-[0.75px] p-2 md:rounded-3xl md:p-3">
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
          borderWidth={3}
        />
        <div className="bg-background relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-xl border-[0.75px] p-6 shadow-xs md:p-6 dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)]">
          <div className="relative flex flex-1 flex-col justify-between gap-3">
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-sans text-xl font-semibold lg:text-2xl">
                <div className="border-border bg-primary w-fit rounded-lg p-2 text-white dark:text-white">
                  <DynamicIcon name={useCase.icon} className="h-4 w-4" />
                </div>
                {useCase.title}
              </h3>
              <p className="text-muted-foreground font-sans text-sm leading-4.5 md:text-base md:leading-5.5 md:[&_b]:font-semibold md:[&_strong]:font-semibold">
                {useCase.description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};

export default function UseCases() {
  const t = useTranslations("Landing.UseCases");

  const useCases: UseCase[] = t.raw("cases").map((item: UseCase) => ({
    title: item.title,
    description: item.description,
    image: item.image,
    icon: item.icon,
  }));

  return (
    <section id="use-cases" className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <FeatureBadge label={t("badge.label")} text={t("badge.text")} className="mb-8" />
          <h2 className="z-10 mb-4 text-center font-sans text-lg font-semibold md:text-5xl">
            <span className="title-gradient">{t("title")}</span>
          </h2>
          <p className="mx-auto max-w-3xl text-xl text-gray-600 dark:text-gray-400">
            {t("description")}
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-8">
          {useCases.map((useCase) => (
            <UseCaseCard key={useCase.title} useCase={useCase} />
          ))}
        </ul>
      </div>
    </section>
  );
}
