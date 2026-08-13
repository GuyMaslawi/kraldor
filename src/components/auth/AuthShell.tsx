import type { CSSProperties, ReactNode } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { OperatorCredit } from "@/components/ui/OperatorCredit";
import { PublicNav } from "@/components/public/PublicNav";
import { GateScene } from "@/components/auth/GateScene";
import { SupportChat } from "@/components/support/SupportChat";
import { hasSupportThread } from "@/server/actions/support";
import { discordInviteUrl } from "@/server/discord";
import { getT } from "@/i18n/server";

/**
 * Three promises, cross-faded one at a time under the wordmark.
 *
 * A single static line has to describe the whole game and therefore describes
 * none of it; three take turns and a visitor reads at least two of them while
 * they are typing an email. Ordered so the first one — the line a reader who
 * asked for reduced motion sees, and the only one that ever showed here before
 * — is still the plainest description of what the game is.
 */
// i18n-keys-start: dictionary keys, drawn through t(line) under the wordmark
const TAGLINES = [
  "בנה אימפריה. צור ברית. כבוש את הדירוג.",
  "האויב לא ישן. גם החומות שלך לא צריכות.",
  "עונה חדשה, עולם חדש, מלך אחד.",
];
// i18n-keys-end

/** The wordmark, one letter per element so it can fall into place in sequence.
 *  The L keeps its accent colour — it is the brandmark's one gilded letter. */
const WORDMARK = [..."KRALDOR"];

export async function AuthShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  /** Widen the shell for screens with the visual hero-class picker. */
  wide?: boolean;
}) {
  const discord = discordInviteUrl();
  const t = await getT();
  // Resolved here, from the cookie, so the support dock knows at first paint
  // whether it has a conversation to poll for — see SupportChat.
  const hasThread = await hasSupportThread();
  return (
    // The bar is pinned to the top and only what is under it is centred. When
    // the whole column was centred together, the top bar on this screen sat
    // halfway down a desktop viewport while the same bar on /guide and /terms
    // sat at the top — so every link in it visibly threw the page upwards. The
    // form stays optically centred; the chrome stays put.
    <main className="flex min-h-screen flex-1 flex-col items-center px-4 pb-12 pt-6">
      {/* The world behind the form — a besieged capital at night, pure CSS, no
          client JavaScript. See the `gate-` block in globals.css. It is fixed
          and aria-hidden, so it never scrolls with a tall form and never
          reaches a screen reader. */}
      <GateScene />

      {/* Above the crest, on every screen in front of the login: the manual,
          last season's champions, the policies, the community, and the language
          switch. The switch is the one control here that genuinely cannot be
          skipped — a visitor who does not read Hebrew has no account yet, so
          there is no setting of theirs to carry a preference, and every other
          word on the page is one they cannot read. */}
      <PublicNav className="gate-content gate-fade" />
      <div
        className={`gate-content flex w-full flex-1 flex-col justify-center ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        <div className="mb-8 flex flex-col items-center text-center">
          {/* The crest, lit and read: a breathing halo behind it and two rings
              turning against each other, the way a seal is examined. */}
          <div className="gate-crest-wrap mb-2">
            <span aria-hidden className="gate-halo" />
            <span aria-hidden className="gate-ring gate-ring-outer" />
            <span aria-hidden className="gate-ring gate-ring-inner" />
            <LogoMark size={72} className="gate-crest" />
          </div>
          {/* Spelled out rather than reusing <Logo> so the wordmark can stack
              above the crest at hero size; the gilded letter matches it.
              `dir="ltr"` because the page around it is right-to-left and the
              sweep in ::after has to line up with the letters underneath. */}
          <h1
            dir="ltr"
            className="gate-word text-4xl font-black tracking-[0.18em] text-bone-bright"
          >
            {WORDMARK.map((letter, i) => (
              <span
                key={i}
                style={{ "--i": i } as CSSProperties}
                className={letter === "L" ? "text-crimson-bright" : undefined}
              >
                {letter}
              </span>
            ))}
          </h1>
          <p className="mt-1 text-xs font-semibold tracking-[0.4em] text-bone-dim">
            {t("קראלדור")}
          </p>
          <p className="gate-tagline mt-3 text-sm text-zinc-400">
            {TAGLINES.map((line, i) => (
              <span key={line} style={{ "--i": i } as CSSProperties}>
                {t(line)}
              </span>
            ))}
          </p>
        </div>
        <div className="gate-panel ornate-shell relative rounded-2xl p-6">
          {/* A light crossing the frame every few seconds, clipped to the panel
              by its own box so the ornate shell's outer glow survives. */}
          <span aria-hidden className="gate-sheen" />
          {children}
        </div>

        {/* Nothing under the panel but the operator's name. The Discord pill
            and the three policy links that used to hang here are all in
            <PublicNav> above — the same five destinations twice on one short
            screen read as clutter, and the top bar is the one a visitor
            actually scans. The legal links a payment gateway's underwriter
            goes looking for are still one click from every auth screen, just
            not twice. */}
        <OperatorCredit className="gate-fade mt-6" />
      </div>

      {/* The dock, on every screen in front of the game. This is the only place
          in the app where somebody can be completely stuck — the mail never
          arrived, the Google button loops, a payment went through on an account
          that will not open — and none of those people can reach the in-game
          chat, which is addressed by empire id. */}
      <SupportChat hasThread={hasThread} discordUrl={discord} />
    </main>
  );
}
