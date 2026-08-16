import { ActionForm } from "@/components/admin/ActionForm";
import { EditorSection, StatLine } from "@/components/admin/fields";
import {
  clearLoginLock,
  forceLogoutUser,
  toggleEmailVerified,
  unlinkGoogleAccount,
} from "@/server/actions/admin";
import { impersonatePlayer } from "@/server/actions/impersonation";
import { formatGameDateTime } from "@/lib/game/time";

export interface PlayerSecurityUser {
  id: string;
  emailVerified: Date | null;
  lockedUntil: Date | null;
  failedLogins: number;
  googleId: string | null;
  hasPassword: boolean;
  bannedAt: Date | null;
  createdAt: Date;
  hasEmpire: boolean;
}

function fmt(d: Date | null): string {
  return d ? formatGameDateTime(d) : "—";
}

/**
 * Everything about *getting into* the account, which the account panel above
 * deliberately does not touch: the verification gate, the brute-force lockout,
 * live sessions, the Google link — and the door in.
 */
export function PlayerSecurity({ user }: { user: PlayerSecurityUser }) {
  const locked = user.lockedUntil != null && user.lockedUntil > new Date();

  return (
    <EditorSection title="גישה ואבטחה" icon="🛡️">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel-inset space-y-1.5 rounded-lg p-3">
          <StatLine
            label="אימות אימייל"
            value={user.emailVerified ? fmt(user.emailVerified) : "לא אומת"}
            tone={user.emailVerified ? "text-emerald-300" : "text-amber-300"}
          />
          <StatLine
            label="נעילת התחברות"
            value={locked ? `עד ${fmt(user.lockedUntil)}` : "אין"}
            tone={locked ? "text-red-300" : "text-emerald-300"}
          />
          <StatLine label="ניסיונות כושלים" value={user.failedLogins} />
          <StatLine
            label="סיסמה"
            value={user.hasPassword ? "מוגדרת" : "אין (גוגל בלבד)"}
          />
          <StatLine label="חשבון גוגל" value={user.googleId ? "מקושר" : "לא מקושר"} />
          <StatLine label="נרשם" value={fmt(user.createdAt)} />
        </div>

        <div className="space-y-3">
          <ActionForm
            action={toggleEmailVerified}
            submitLabel={user.emailVerified ? "בטל אימות אימייל" : "סמן כמאומת"}
            submitVariant="secondary"
            submitClassName="w-full text-xs"
            confirm={
              user.emailVerified
                ? "לבטל את האימות? השחקן ייחסם מהמשחק עד שיאמת מחדש."
                : undefined
            }
          >
            <input type="hidden" name="userId" value={user.id} />
            <p className="text-[11px] text-zinc-500">
              חשבון לא מאומת חסום מכל המשחק עד לאישור הכתובת.
            </p>
          </ActionForm>

          <ActionForm
            action={clearLoginLock}
            submitLabel="שחרר נעילת התחברות"
            submitVariant="secondary"
            submitClassName="w-full text-xs"
          >
            <input type="hidden" name="userId" value={user.id} />
          </ActionForm>
        </div>

        <div className="space-y-3">
          <ActionForm
            action={forceLogoutUser}
            submitLabel="נתק את כל החיבורים"
            submitVariant="danger"
            submitClassName="w-full text-xs"
            confirm="לנתק את כל המכשירים המחוברים לחשבון?"
          >
            <input type="hidden" name="userId" value={user.id} />
            <p className="text-[11px] text-zinc-500">
              מבטל כל טוקן קיים — השחקן יידרש להתחבר מחדש בכל מכשיר.
            </p>
          </ActionForm>

          <ActionForm
            action={unlinkGoogleAccount}
            submitLabel="נתק חשבון גוגל"
            submitVariant="danger"
            submitClassName="w-full text-xs"
            confirm="לנתק את חשבון הגוגל מהמשתמש?"
          >
            <input type="hidden" name="userId" value={user.id} />
          </ActionForm>
        </div>
      </div>

      {/*
        Impersonation is the one control here that acts *as* the player rather
        than on them, so it gets its own framed row and its own warning.
      */}
      <div className="mt-4 rounded-lg border border-crimson/40 bg-crimson/10 p-3">
        <ActionForm
          action={impersonatePlayer}
          submitLabel="היכנס למשחק בתור השחקן"
          submitVariant="danger"
          confirm="להיכנס בתור השחקן? כל פעולה שתבצע תיראה כאילו השחקן עשה אותה. חזרה לאדמין דרך הפס העליון."
        >
          <input type="hidden" name="userId" value={user.id} />
          <p className="text-xs text-amber-100">
            <span aria-hidden>👁️</span> כניסה בתור השחקן — אתה רואה ועושה בדיוק
            מה שהוא רואה ועושה. פס אדום יופיע בראש המסך עם כפתור חזרה. פעולות
            שתבצע נרשמות על שמו, לא על שמך.
          </p>
          {!user.hasEmpire && (
            <p className="text-[11px] text-zinc-400">
              למשתמש אין אימפריה — הכניסה תיחסם.
            </p>
          )}
        </ActionForm>
      </div>
    </EditorSection>
  );
}
