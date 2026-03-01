"use client";

import { Button } from "@niu/ui/button";
import { Input } from "@niu/ui/input";
import { Label } from "@niu/ui/label";
import { Slider } from "@niu/ui/slider";
import { Textarea } from "@niu/ui/textarea";
import { type VideoModelCapabilities } from "@/config/ai-models";
import { cn } from "@niu/utils";
import { Camera, Dices, Monitor, Proportions, Type, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";

export interface VideoAdvancedValues {
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  cfgScale?: number;
  generateAudio?: boolean;
  cameraFixed?: boolean;
  seed?: number;
}

interface VideoAdvancedSettingsProps {
  capabilities: VideoModelCapabilities;
  values: VideoAdvancedValues;
  onChange: (values: VideoAdvancedValues) => void;
  disabled?: boolean;
}

function AspectRatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const maxDim = 22;
  const scale = maxDim / Math.max(w, h);
  const width = Math.max(Math.round(w * scale), 6);
  const height = Math.max(Math.round(h * scale), 6);

  return <div className="bg-muted-foreground/30 rounded-sm" style={{ width, height }} />;
}

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Label className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Label>
  );
}

export default function VideoAdvancedSettings({
  capabilities,
  values,
  onChange,
  disabled,
}: VideoAdvancedSettingsProps) {
  const t = useTranslations("AIDemo.video");

  const hasAnySettings =
    capabilities.aspectRatios ||
    capabilities.resolutions ||
    capabilities.negativePrompt ||
    capabilities.cfgScale ||
    capabilities.generateAudio ||
    capabilities.cameraFixed ||
    capabilities.seed;

  if (!hasAnySettings) {
    return null;
  }

  const update = (patch: Partial<VideoAdvancedValues>) => {
    onChange({ ...values, ...patch });
  };

  return (
    <div className="space-y-5">
      {/* Aspect Ratio */}
      {capabilities.aspectRatios && (
        <div>
          <SectionLabel icon={Proportions}>{t("aspectRatio")}</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {capabilities.aspectRatios.map((ratio) => (
              <button
                key={ratio}
                type="button"
                disabled={disabled}
                onClick={() =>
                  update({
                    aspectRatio: values.aspectRatio === ratio ? undefined : ratio,
                  })
                }
                className={cn(
                  "flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 transition-all",
                  "hover:border-primary/50",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  values.aspectRatio === ratio
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background",
                )}
              >
                <AspectRatioIcon ratio={ratio} />
                <span className="text-muted-foreground text-[11px]">{ratio}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Resolution */}
      {capabilities.resolutions && (
        <div>
          <SectionLabel icon={Monitor}>{t("resolution")}</SectionLabel>
          <div className="flex gap-2">
            {capabilities.resolutions.map((res) => (
              <button
                key={res}
                type="button"
                disabled={disabled}
                onClick={() =>
                  update({
                    resolution: values.resolution === res ? undefined : res,
                  })
                }
                className={cn(
                  "h-10 min-w-[72px] rounded-lg border px-4 text-sm font-medium transition-all",
                  "hover:border-primary/50",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  values.resolution === res
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground",
                )}
              >
                {res}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Generate Audio */}
      {capabilities.generateAudio && (
        <div>
          <SectionLabel icon={Volume2}>{t("generateAudio")}</SectionLabel>
          <div className="flex gap-2">
            {[true, false].map((val) => (
              <button
                key={String(val)}
                type="button"
                disabled={disabled}
                onClick={() => update({ generateAudio: val })}
                className={cn(
                  "h-10 min-w-[72px] rounded-lg border px-4 text-sm font-medium transition-all",
                  "hover:border-primary/50",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  values.generateAudio === val
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground",
                )}
              >
                {val ? "ON" : "OFF"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Camera Fixed */}
      {capabilities.cameraFixed && (
        <div>
          <SectionLabel icon={Camera}>{t("cameraFixed")}</SectionLabel>
          <div className="flex gap-2">
            {[true, false].map((val) => (
              <button
                key={String(val)}
                type="button"
                disabled={disabled}
                onClick={() => update({ cameraFixed: val })}
                className={cn(
                  "h-10 min-w-[72px] rounded-lg border px-4 text-sm font-medium transition-all",
                  "hover:border-primary/50",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  values.cameraFixed === val
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground",
                )}
              >
                {val ? "ON" : "OFF"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Negative Prompt */}
      {capabilities.negativePrompt && (
        <div>
          <SectionLabel icon={Type}>{t("negativePrompt")}</SectionLabel>
          <Textarea
            className="min-h-[60px] resize-none text-sm"
            placeholder={t("negativePromptPlaceholder")}
            value={values.negativePrompt || ""}
            onChange={(e) => update({ negativePrompt: e.target.value || undefined })}
            disabled={disabled}
          />
        </div>
      )}

      {/* CFG Scale */}
      {capabilities.cfgScale && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-muted-foreground text-xs">{t("cfgScale")}</Label>
            <span className="text-xs font-medium tabular-nums">
              {(values.cfgScale ?? capabilities.cfgScale[2]).toFixed(2)}
            </span>
          </div>
          <Slider
            min={capabilities.cfgScale[0]}
            max={capabilities.cfgScale[1]}
            step={0.05}
            value={[values.cfgScale ?? capabilities.cfgScale[2]]}
            onValueChange={([v]) => update({ cfgScale: v })}
            disabled={disabled}
          />
        </div>
      )}

      {/* Seed */}
      {capabilities.seed && (
        <div>
          <SectionLabel icon={Dices}>{t("seed")}</SectionLabel>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="h-9 flex-1 text-sm"
              placeholder={t("seed")}
              value={values.seed ?? ""}
              onChange={(e) =>
                update({
                  seed: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              disabled={disabled}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => update({ seed: Math.floor(Math.random() * 2147483647) })}
              disabled={disabled}
              title={t("randomSeed")}
            >
              <Dices className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
