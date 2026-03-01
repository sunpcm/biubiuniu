import Footer from "@/components/footer/Footer";
import Header from "@/components/header/Header";

export default function BasicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col items-center">{children}</main>
      <Footer />
    </>
  );
}
