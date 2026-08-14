// TEMPORARY audit harness — delete before commit. Renders the mini-game chrome
// against a fabricated state so the overlays can be photographed on a phone
// viewport without fielding a real release on the live database.
import { MiniGameButton } from "@/components/game/MiniGameButton";
import type { MiniGameState } from "@/lib/game/minigame";

const base = {
  prizeText: "‎1.2Q זהב",
  cups: 3,
  digits: 3,
  size: 4,
  question: "מה תמיד בא מחר ולעולם לא היום?",
  history: [],
  attempts: 1,
  maxAttempts: 5,
  solved: false,
  won: false,
  finished: false,
  prizesLeft: true,
  winnersCount: 1,
  maxWinners: 3,
  endsAt: Date.UTC(2030, 0, 1),
  serverNow: Date.UTC(2029, 11, 31, 23, 0, 0),
  board: Array.from({ length: 6 }, (_, i) => ({
    empireId: `e${i}`,
    name: `אימפריית הצפון ${i + 1}`,
    attempts: i,
    solved: i === 0,
    won: i === 0,
    isSelf: i === 2,
  })),
  players: 12,
};

export default function DevOverlay({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  return <Harness searchParams={searchParams} />;
}

async function Harness({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const type = (sp.type ?? "CRACK_SAFE") as MiniGameState["type"];
  const state = { ...base, id: "dev1", type, title: "פריצת הכספת הגדולה" } as MiniGameState;
  return (
    <div className="min-h-screen bg-black p-4">
      <MiniGameButton initial={[state]} />
    </div>
  );
}
