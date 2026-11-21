"use client";

import { Toaster as NiuToaster } from "@sunpcm/niu-ui/components/sonner";
import { useTheme } from "next-themes";

type ToasterProps = React.ComponentProps<typeof NiuToaster>;

const Toaster = (props: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return <NiuToaster theme={theme as ToasterProps["theme"]} {...props} />;
};

export { Toaster };
