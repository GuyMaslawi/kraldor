"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PotionKind } from "@prisma/client";
import { PotionBottle } from "@/components/game/PotionBottle";
import { useServerNow } from "@/components/game/HeroPotions";
import { Tip } from "@/components/ui/Tip";
import { POTION_KINDS, POTION_META } from "@/lib/game/potions";
import { useT } from "@/i18n/client";

/**
 * Running potions, in the command bar beside the update timers.
 *
 * A potion bends a rule for an hour and then stops — and the player is rarely
 * on the hero page while it burns. Without this strip, a buff that is silently
 * changing their plunder and their XP would be invisible from every screen they
 * actually play on. Renders nothing at all when nothing is running.
 */
export function ActivePotions({
  activeUntil,
  serverNow,
  href = "/game/hero",
}: {
  /** Epoch ms at which each running brew wears off. */
  activeUntil: Partial<Record<PotionKind, number>>;
  serverNow: number;
  /**
   * Where a bottle leads. `null` for someone else's belt — a rival's running
   * brews are intel to read, not a shortcut into your own bag.
   */
  href?: string | null;
}) {
  const router = useRouter();
  const now = useServerNow(serverNow);

  const running = POTION_KINDS.filter((kind) => {
    const at = activeUntil[kind];
    return at !== undefined && at > now;
  });

  const t = useT();

  // The soonest window to close; when it does, re-render so the strip (and
  // every number the potion was inflating) tells the truth again.
  const soonest = POTION_KINDS.reduce<number | null>((best, kind) => {
    const at = activeUntil[kind];
    if (at === undefined) return best;
    return best === null || at < best ? at : best;
  }, null);
  const expired = soonest !== null && soonest <= now;
  useEffect(() => {
    if (!expired) return;
    const timeout = setTimeout(() => router.refresh(), 1000);
    const retry = setInterval(() => router.refresh(), 5000);
    return () => {
      clearTimeout(timeout);
      clearInterval(retry);
    };
  }, [expired, router]);

  if (running.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {running.map((kind) => {
        const meta = POTION_META[kind];
        const remaining = Math.max(0, (activeUntil[kind] ?? 0) - now);
        const minutes = Math.floor(remaining / 60_000);
        const seconds = Math.floor((remaining % 60_000) / 1000);
        const className =
          "flex items-center gap-1 rounded-lg border bg-black/50 px-1.5 py-0.5 text-[11px] font-bold";
        const style = { borderColor: `${meta.liquid.glow}66`, color: meta.liquid.glow };
        const face = (
          <>
            <PotionBottle kind={kind} className="h-4 w-4" />
            <span className="tabular-nums" dir="ltr">
              {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
            </span>
          </>
        );
        return (
          <Tip
            key={kind}
            tip={t("{name} — {tagline}", {
              name: t(meta.label),
              tagline: t(meta.tagline),
            })}
            side="bottom"
          >
            {href === null ? (
              <span className={className} style={style}>
                {face}
              </span>
            ) : (
              <Link href={href} className={className} style={style}>
                {face}
              </Link>
            )}
          </Tip>
        );
      })}
    </div>
  );
}
