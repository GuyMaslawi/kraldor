import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import { LOCALE_DIR } from "@/i18n/locale";
import { getI18n } from "@/i18n/server";
import { LocaleProvider } from "@/i18n/client";
import { ScrollToTop } from "@/components/ui/ScrollToTop";

const heebo = Heebo({
  // Both alphabets in one face, so switching to English does not also switch
  // typeface — the game's chrome should look like itself in either language.
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
});

/**
 * Title and description in the reader's language. `generateMetadata` rather
 * than a static `metadata` export because it has to read the locale cookie, and
 * a constant cannot.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("קראלדור | Kraldor"),
    description: t("בנה אימפריה. צור ברית. כבוש את הדירוג."),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The one place a request's language is resolved. `lang` and `dir` are set
  // from it here, and the same value is handed to the client tree so that a
  // "use client" component's useT() agrees with the server's getT() — a
  // mismatch there is a hydration error, not merely wrong text.
  const { locale } = await getI18n();

  return (
    <html
      lang={locale}
      dir={LOCALE_DIR[locale]}
      className={`${heebo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {/* Every page change lands at the top of the new screen — Next's own
            default is to keep the scroll position. See ScrollToTop. */}
        <ScrollToTop />
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
