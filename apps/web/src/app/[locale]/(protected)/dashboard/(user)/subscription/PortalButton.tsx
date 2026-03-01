"use client";

import { Button } from "@niu/ui/button";
import { PaymentProvider } from "@niu/db/schema";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

interface PortalButtonProps {
  provider: PaymentProvider;
}

function SubmitButton({ provider }: PortalButtonProps) {
  const { pending } = useFormStatus();

  const buttonText =
    provider === "stripe" ? "Manage Subscription (Stripe)" : "Manage Subscription (Creem)";

  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading...
        </>
      ) : (
        buttonText
      )}
    </Button>
  );
}

export function PortalButton({
  provider,
  action,
}: PortalButtonProps & {
  action: () => Promise<void>;
}) {
  return (
    <form action={action}>
      <SubmitButton provider={provider} />
    </form>
  );
}
