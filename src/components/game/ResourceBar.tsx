import type { ReactNode } from "react";
import { type ResourceKey } from "@/lib/game/constants";
import { formatCompact, formatNumber } from "@/lib/game/format";
import { Tip } from "@/components/ui/Tip";
import { Icon, RESOURCE_ICON_COLOR, type IconName } from "@/components/ui/Icon";
import { LogoMark } from "@/components/ui/Logo";
import { getT } from "@/i18n/server";

/**
 * Top command bar: the six spendable balances shown as pills, plus the brand
 * emblem and language toggle — matching the reference header row.
 * (Citizens live on the management screen, not here.)
 */

type PillConfig = {
  key: ResourceKey;
  label: string;
  icon: IconName;
  /** What this balance is and where it comes from — shown on hover. */
  tip: string;
  /** tailwind text color for the number */
  numClass: string;
  /** tailwind border color accent */
  borderClass: string;
};

// i18n-keys-start: dictionary keys, drawn through t(p.label) / t(p.tip) below
const PILLS: PillConfig[] = [
  {
    key: "turns", label: "תורות", icon: "turns",
    tip: "מטבע הפעולות: תקיפה עולה 10 תורות, ריגול 5. מתקבלות בכל עדכון דירוג לפי שדרוג \"קבלת תורות\".",
    numClass: "text-emerald-400", borderClass: "border-emerald-500/40",
  },
  {
    key: "gold", label: "זהב", icon: "gold",
    tip: "המשאב המרכזי לשדרוגים, נשקים ובנק. מיוצר במכרה הזהב על ידי עבדי מכרות.",
    numClass: "text-crimson-bright", borderClass: "border-crimson/50",
  },
  {
    key: "wood", label: "עץ", icon: "wood",
    tip: "חומר גלם לשדרוגי מבנים ונשקים. מיוצר במכרה העץ על ידי עבדי מכרות.",
    numClass: "text-bone", borderClass: "border-border-subtle",
  },
  {
    key: "iron", label: "ברזל", icon: "iron",
    tip: "הבסיס לכלי הנשק של האימפריה. מיוצר במכרה הברזל על ידי עבדי מכרות.",
    numClass: "text-zinc-200", borderClass: "border-border-subtle",
  },
  {
    key: "stone", label: "אבן", icon: "stone",
    tip: "אבן לחומות, מבנים וביצורים. מיוצרת במחצבת האבן על ידי עבדי מכרות.",
    numClass: "text-zinc-200", borderClass: "border-border-subtle",
  },
  {
    key: "diamonds", label: "יהלומים", icon: "diamond",
    tip: "מטבע פרימיום נדיר. מתקבל בכל עדכון יומי לפי רמת שדרוג \"מכרה יהלומים\".",
    numClass: "text-sky-300", borderClass: "border-sky-500/40",
  },
];
// i18n-keys-end

export async function ResourceBar({
  resources,
  mobileMenu,
  inbox,
  discord,
  admin,
  language,
}: {
  resources: Record<ResourceKey, number>;
  /** Mobile-only nav trigger, rendered at the start of the bar (hidden at lg+). */
  mobileMenu?: ReactNode;
  /** History + messages pills, parked in the bar's free space (see InboxNav). */
  inbox?: ReactNode;
  /**
   * The community channel, riding beside the inbox pills — null while no invite
   * is configured. It belongs next to the messages badge because it is the same
   * question ("what am I being told?"), just answered outside the game.
   */
  discord?: ReactNode;
  /** Admin control-center pill — the layout passes it for admins only. */
  admin?: ReactNode;
  /**
   * The HE/EN switch. It lives in the command bar rather than under settings
   * because the player most likely to need it is one who cannot read the menu
   * that would lead there.
   */
  language?: ReactNode;
}) {
  const t = await getT();
  return (
    <header
      dir="ltr"
      className="sticky top-0 z-40 border-b bg-[#0b0a0e]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0b0a0e]/80"
      style={{ borderColor: "rgba(196,160,50,0.22)" }}
    >
      {/* Fixed height so the sticky sidebar can offset itself by --header-h. */}
      <div className="mx-auto flex h-[var(--header-h)] max-w-[1900px] items-center gap-2 px-2 sm:gap-3 sm:px-3 md:px-5">
        {mobileMenu}
        {/* balances — the labelled pills, from lg up where the row is wide
            enough to carry all six beside the emblem and the inbox. Below that
            they move to their own row: squeezed into this one they shrink past
            legibility and four of the six end up parked off-screen inside the
            scroller, which is the same as not showing them. */}
        <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto lg:flex">
          {PILLS.map((p) => (
            <Tip key={p.key} tip={t(p.tip)} side="bottom">
              <div className={`res-pill ${p.borderClass}`}>
                {/* Icon wears the canonical resource tint; the number keeps the
                    pill's own accent, which is a bar-layout choice, not an
                    identity for the resource. */}
                <Icon name={p.icon} size={20} className={`shrink-0 ${RESOURCE_ICON_COLOR[p.key]}`} />
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-[10px] font-medium text-zinc-400">{t(p.label)}</span>
                  <span className={`nums text-sm font-extrabold ${p.numClass}`} dir="ltr">
                    {formatNumber(resources[p.key])}
                  </span>
                </div>
              </div>
            </Tip>
          ))}
        </div>
        {/* Below lg the balances are a row of their own, so the free stretch is
            all that holds the emblem and the inbox apart. */}
        <div className="flex-1 lg:hidden" />

        {/* history + messages (the bar's free stretch) */}
        {inbox}

        {/* the community channel, one pill further out */}
        {discord}

        {/* control center (admins only) */}
        {admin}

        {/* language switch, immediately before the emblem */}
        {language}

        {/* brand emblem */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-sm font-black tracking-[0.2em] text-bone-bright sm:inline">
            KRA<span className="text-crimson-bright">L</span>DOR
          </span>
          <LogoMark size={34} />
        </div>
      </div>

      {/* -------- phone and tablet balances --------
          All six on one row, each an equal share of the width. A balance you
          have to swipe sideways to find is a balance nobody checks, and these
          six are what every screen in the game spends. The figures go compact
          (1.9M, 22.3K) — the exact digit count is a desktop luxury, and the
          pill still carries the full story in its tip. */}
      <div className="mx-auto flex max-w-[1900px] items-stretch gap-1 px-2 pb-1.5 sm:gap-1.5 sm:px-3 lg:hidden">
        {PILLS.map((p) => (
          <Tip key={p.key} tip={t(p.tip)} side="bottom" className="min-w-0 flex-1">
            {/* Icon over number, not beside it: stacked, the whole pill width is
                the number's, so "22.3K" still reads at 320px. */}
            <div className={`res-pill-mini w-full ${p.borderClass}`}>
              <Icon name={p.icon} size={15} className={`shrink-0 ${RESOURCE_ICON_COLOR[p.key]}`} />
              <span
                className={`nums w-full truncate text-center text-[11px] font-extrabold leading-tight ${p.numClass}`}
                dir="ltr"
              >
                {formatCompact(resources[p.key])}
              </span>
            </div>
          </Tip>
        ))}
      </div>
    </header>
  );
}
