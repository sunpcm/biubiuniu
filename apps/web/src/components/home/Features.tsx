import FeatureBadge from "@/components/shared/FeatureBadge";
import { ImagePreview } from "@/components/shared/ImagePreview";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@niu/ui/carousel";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

type Feature = {
  title: string;
  description: string;
  details?: {
    title: string;
    description: string;
  }[];
  images?: string[];
};

const FeatureCard = ({ feature }: { feature: Feature }) => {
  return (
    <div key={feature.title} className="w-full py-4">
      <div className="mx-auto">
        <div className="grid grid-cols-1 items-center gap-8 px-8 py-4 md:py-8 lg:grid-cols-2">
          <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <h3 className="font-regular max-w-xl text-left text-3xl tracking-tighter lg:text-5xl">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground max-w-xl text-left text-lg leading-relaxed tracking-tight">
                  {feature.description}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-3 lg:grid-cols-1 lg:pl-6">
              {feature.details?.map((detail) => (
                <div key={detail.title} className="flex flex-row items-start gap-6">
                  <Check className="text-primary mt-2 h-4 w-4 shrink-0" />
                  <div className="flex flex-col gap-1">
                    <p>{detail.title}</p>
                    <p className="text-muted-foreground text-sm">{detail.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border p-2">
            {feature.images && feature.images.length > 1 ? (
              <div className="w-full max-w-full">
                <Carousel>
                  <CarouselContent>
                    {feature.images.map((image) => (
                      <CarouselItem key={image}>
                        <ImagePreview>
                          <Image
                            src={image || "/placeholder.svg"}
                            alt={feature.title}
                            width={1280}
                            height={630}
                            className="rounded-lg"
                          />
                        </ImagePreview>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious />
                  <CarouselNext />
                </Carousel>
              </div>
            ) : (
              <ImagePreview>
                <Image
                  src={feature.images?.[0] || "/placeholder.svg"}
                  alt={feature.title}
                  width={1280}
                  height={630}
                  className="rounded-lg"
                />
              </ImagePreview>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default function Features() {
  const t = useTranslations("Landing.Features");

  const features: Feature[] = t.raw("items");

  return (
    <section id="features" className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <FeatureBadge label={t("badge.label")} text={t("badge.text")} className="mb-8" />
          <h2 className="z-10 mb-4 text-center font-sans text-lg font-semibold md:text-5xl">
            <span className="title-gradient">{t("title")}</span>
          </h2>
          <p className="mx-auto max-w-3xl text-xl text-gray-600 dark:text-gray-400">
            {t("description")}
          </p>
        </div>

        <div className="">
          {features.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
