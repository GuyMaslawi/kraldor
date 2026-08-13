import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { requireOpenSeason } from "@/server/seasonGuard";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { readPendingReferral, resolveReferralCode } from "@/server/referralGuard";
import { PRELAUNCH } from "@/lib/prelaunch";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("הרשמה | קראלדור") };
}

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // Signing up reopens with the next season — see seasonGuard.
  await requireOpenSeason();
  if (await getSessionUserId()) redirect("/game/base");

  // The invite the visitor arrived on, if any. `/r/<code>` deliberately says
  // nothing about whether a code was real (see the note there) — this line is
  // where a working link finally announces itself, to the one person who has it.
  //
  // Read only. The link is attached after the empire exists; nothing is written
  // here, which is just as well, since a page render cannot set cookies anyway.
  const code = await readPendingReferral();
  const inviter = code ? await resolveReferralCode(code) : null;

  return (
    <AuthShell wide>
      {/* Pre-launch there is nothing to log into: the sign-up sheet is the only
          thing open, and the form says so by not offering the alternative. */}
      <RegisterForm invitedBy={inviter?.empireName ?? null} canLogin={!PRELAUNCH} />
    </AuthShell>
  );
}
