import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@niu/ui/card";
import { Mail } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import UnsubscribeForm from "./UnsubscribeForm";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function validateToken(token: string, _locale: string) {
  try {
    const email = Buffer.from(token, "base64").toString();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { isValid: false, email: "", error: "Invalid token format" };
    }

    return { isValid: true, email, error: "" };
  } catch (_error) {
    return { isValid: false, email: "", error: "Invalid token" };
  }
}

export default async function Page(props: { searchParams: SearchParams }) {
  const t = await getTranslations("Footer.Newsletter");
  const currentLocale = await getLocale();

  const searchParams = await props.searchParams;
  const token = searchParams.token as string;

  let tokenValidation = { isValid: false, email: "", error: "" };
  if (!token) {
    tokenValidation.error = t("unsubscribe.errorNoToken");
  } else {
    tokenValidation = await validateToken(token, currentLocale);
    if (!tokenValidation.isValid) {
      tokenValidation.error = t("unsubscribe.errorInvalidToken");
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4 pb-2 text-center">
          <div className="bg-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
            <Mail className="text-primary h-8 w-8" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl font-bold">{t("unsubscribe.title")}</CardTitle>
            <CardDescription className="text-base">
              {tokenValidation.isValid
                ? t("unsubscribe.confirmMessage")
                : t("unsubscribe.errorGeneric")}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {tokenValidation.isValid ? (
            <UnsubscribeForm
              token={token}
              email={tokenValidation.email}
              locale={currentLocale}
              adminEmail={process.env.ADMIN_EMAIL || ""}
            />
          ) : (
            <div className="space-y-6">
              <div className="bg-destructive/10 border-destructive/20 rounded-lg border p-4 text-center">
                <p className="text-destructive font-medium">{tokenValidation.error}</p>
              </div>

              <div className="border-border border-t pt-4 text-center">
                <p className="text-muted-foreground text-sm">
                  {t("unsubscribe.contactPrefix")}
                  <a
                    href={`mailto:${process.env.ADMIN_EMAIL}`}
                    title={process.env.ADMIN_EMAIL}
                    className="text-primary hover:text-primary/80 ml-1 transition-colors hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {process.env.ADMIN_EMAIL}
                  </a>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
