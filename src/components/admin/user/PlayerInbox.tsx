import Link from "next/link";
import type { MessageKind } from "@prisma/client";
import { ActionForm } from "@/components/admin/ActionForm";
import { EditorSection, LabeledSelect, StatLine } from "@/components/admin/fields";
import {
  clearEmpireHistory,
  deletePlayerMessage,
  manageInbox,
} from "@/server/actions/admin";
import { formatGameDateTime } from "@/lib/game/time";

export interface PlayerInboxProps {
  empireId: string;
  userId: string;
  messages: {
    id: string;
    kind: MessageKind;
    title: string;
    readAt: Date | null;
    createdAt: Date;
    sender: { name: string } | null;
  }[];
  counts: {
    messages: number;
    unread: number;
    battleReports: number;
    spyReports: number;
    bossFights: number;
    purchases: number;
    bankTransactions: number;
  };
}

const KIND_LABEL: Record<MessageKind, string> = {
  SYSTEM: "מערכת",
  ANNOUNCEMENT: "הכרזה",
  BATTLE: "קרב",
  SPY: "ריגול",
  PLAYER: "שחקן",
};

/** The player's paper trail: mail, and the report tables the game writes. */
export function PlayerInbox({ empireId, userId, messages, counts }: PlayerInboxProps) {
  return (
    <>
      <EditorSection title="תיבת ההודעות" icon="📨">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="panel-inset space-y-1 rounded-lg p-3">
            <StatLine label="הודעות" value={counts.messages} />
            <StatLine
              label="לא נקראו"
              value={counts.unread}
              tone={counts.unread > 0 ? "text-amber-300" : "text-zinc-400"}
            />
          </div>
          <ActionForm
            action={manageInbox}
            submitLabel="סמן הכל כנקרא"
            submitVariant="secondary"
            submitClassName="w-full text-xs"
            className="panel-inset rounded-lg p-3"
          >
            <input type="hidden" name="empireId" value={empireId} />
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="op" value="read_all" />
          </ActionForm>
          <ActionForm
            action={manageInbox}
            submitLabel="רוקן תיבה"
            submitVariant="danger"
            submitClassName="w-full text-xs"
            className="panel-inset rounded-lg p-3"
            confirm="למחוק את כל ההודעות של השחקן?"
          >
            <input type="hidden" name="empireId" value={empireId} />
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="op" value="clear" />
          </ActionForm>
          <div className="panel-inset space-y-1 rounded-lg p-3">
            <StatLine label="רכישות יהלומים" value={counts.purchases} />
            <StatLine label="תנועות בנק" value={counts.bankTransactions} />
            <Link
              href="/admin/purchases"
              className="block text-[11px] text-gold-dim underline-offset-2 hover:underline"
            >
              לניהול הרכישות →
            </Link>
          </div>
        </div>

        {messages.length > 0 ? (
          <div className="space-y-2">
            {messages.map((m) => (
              <ActionForm
                key={m.id}
                action={deletePlayerMessage}
                submitLabel="🗑"
                submitVariant="danger"
                submitClassName="!px-2 !py-1 text-xs"
                className="panel-inset flex flex-wrap items-center justify-between gap-2 rounded-lg p-2"
              >
                <input type="hidden" name="messageId" value={m.id} />
                <input type="hidden" name="userId" value={userId} />
                <span className="min-w-0 flex-1 text-[11px] text-zinc-300">
                  <span className="text-gold-dim">[{KIND_LABEL[m.kind]}]</span>{" "}
                  {m.title}
                  {m.sender && <span className="text-zinc-500"> · מאת {m.sender.name}</span>}
                  <span className="text-zinc-600">
                    {" "}
                    · {formatGameDateTime(m.createdAt)}
                    {!m.readAt && " · לא נקרא"}
                  </span>
                </span>
              </ActionForm>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">התיבה ריקה.</p>
        )}
      </EditorSection>

      <EditorSection title="היסטוריית קרבות ודוחות" icon="📜">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel-inset space-y-1 rounded-lg p-3">
            <StatLine label="דוחות קרב" value={counts.battleReports} />
            <StatLine label="דוחות ריגול" value={counts.spyReports} />
            <StatLine label="קרבות מול שליטי ערים" value={counts.bossFights} />
            <p className="pt-2 text-[11px] text-zinc-500">
              מחיקת היסטוריה משפיעה גם על ההישגים — חלקם נספרים מהדוחות עצמם.
              קרבות מול שליטים נמחקים גם כדי לשחרר את מכסת הניצחון למחזור.
            </p>
          </div>

          <ActionForm
            action={clearEmpireHistory}
            submitLabel="מחק היסטוריה"
            submitVariant="danger"
            className="panel rounded-lg p-3"
            confirm="למחוק את ההיסטוריה שנבחרה? הפעולה בלתי הפיכה ומשפיעה גם על היריבים בדוחות."
          >
            <input type="hidden" name="empireId" value={empireId} />
            <input type="hidden" name="userId" value={userId} />
            <LabeledSelect
              label="מה למחוק"
              name="what"
              options={[
                { value: "battle", label: "דוחות קרב" },
                { value: "spy", label: "דוחות ריגול" },
                { value: "boss", label: "קרבות שליטי ערים" },
                { value: "all", label: "הכל" },
              ]}
            />
          </ActionForm>
        </div>
      </EditorSection>
    </>
  );
}
