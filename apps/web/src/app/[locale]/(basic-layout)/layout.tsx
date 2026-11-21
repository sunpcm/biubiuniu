import Footer from "@/components/footer/Footer";
import Header from "@/components/header/Header";
import { NanoConfigProvider } from "@/components/nano/NanoConfigContext";
import { NanoPublicConfigProvider } from "@/components/nano/NanoPublicConfigProvider";
import { isNanoEnabled } from "@/config/features";
import { getNanoPublicConfig } from "@/config/nano";

export default async function BasicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nanoPublicConfig = getNanoPublicConfig(isNanoEnabled());

  return (
    <NanoConfigProvider enabled={nanoPublicConfig.enabled}>
      <NanoPublicConfigProvider config={nanoPublicConfig}>
        <Header />
        <main className="flex-1 flex flex-col items-center">{children}</main>
        <Footer />
      </NanoPublicConfigProvider>
    </NanoConfigProvider>
  );
}
