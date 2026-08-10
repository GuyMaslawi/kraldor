/**
 * Hebrew → English.
 *
 * Keys are the Hebrew source text exactly as it appears at the call site — see
 * the long note in `src/i18n/translate.ts` for why. Two rules follow from that
 * and both matter:
 *
 *  - **Copy the key, never retype it.** A key that differs from the source by
 *    one character (a straight quote for a curly one, a missing נקודה, a
 *    non-breaking space) is simply never found, and the string silently stays
 *    Hebrew. If a string looks untranslated on screen, suspect the key first.
 *  - **`{placeholders}` must survive.** They are filled at render time, so an
 *    English value that drops one loses the number it was carrying. Word order
 *    around them is free — that is the whole point of having them.
 *
 * A missing key is not an error: the source Hebrew renders instead. That is
 * what lets this file be filled in screen by screen without ever shipping a
 * broken page.
 *
 * Sections below follow the player's path through the game, not the file tree,
 * so a translator can work top to bottom.
 */
export const EN: Record<string, string> = {
  /* ------------------------------------------------------------------ */
  /* brand + shared chrome                                              */
  /* ------------------------------------------------------------------ */
  "קראלדור | Kraldor": "Kraldor",
  "בנה אימפריה. צור ברית. כבוש את הדירוג.":
    "Build an empire. Forge an alliance. Conquer the ladder.",
  /* the other two lines of the rotating tagline on the login screen */
  "האויב לא ישן. גם החומות שלך לא צריכות.":
    "The enemy never sleeps. Neither should your walls.",
  "עונה חדשה, עולם חדש, מלך אחד.": "A new season, a new world, one king.",

  /* resources — the six balances in the command bar */
  "זהב": "Gold",
  "עץ": "Wood",
  "ברזל": "Iron",
  "אבן": "Stone",
  "יהלומים": "Diamonds",
  "אזרחים": "Citizens",
  "תורות": "Turns",

  /* navigation */
  "בסיס": "Base",
  "גיבור": "Hero",
  "דירוג": "Rankings",
  "מפעל": "Armory",
  "ניהול": "Army",
  "מכונות": "Mines",
  "ברית": "Guild",
  "מלחמת בריתות": "Guild War",
  "בנק": "Bank",
  "מחסנים": "Storage",
  "הישגים": "Achievements",
  "שדרוגים": "Upgrades",
  "מדריך": "Guide",
  "קהילה": "Community",
  "היסטוריה": "History",
  "הודעות": "Messages",
  "פרסים": "Prizes",
  "תגמולים": "Rewards",
  "הגדרות": "Settings",
  "התנתקות": "Log out",
  "פתיחת תפריט": "Open menu",
  "סגירת תפריט": "Close menu",
  "ברוך שובך,": "Welcome back,",
  "חי": "LIVE",

  /* the hero card in the sidebar */
  "חיים": "Health",
  "ניסיון": "XP",
  "מקצוע הגיבור": "Hero class",
  "רמת הגיבור — עולה מניסיון שנצבר בקרבות":
    "Hero level — rises with the experience earned in battle",
  "חיי הגיבור — כל תקיפה שפורצת את ההגנה שלך מורידה מהם":
    "Your hero's health — every attack that breaks your defence takes a bite out of it",
  "ניסיון הגיבור — נצבר מקרבות: ניצחון בתקיפה מעניק הכי הרבה, גם הגנה מוצלחת מזכה. במלוא הבר הגיבור עולה רמה":
    "Hero experience — earned in battle: a won attack pays the most, a successful defence also counts. A full bar is a level.",
  "💀 הגיבור מת": "💀 Your hero is dead",
  "הגיבור נפל בקרב — כל נקודותיו והבונוסים שלו מושבתים עד שיקום לתחייה. לחץ לפרטים.":
    "Your hero has fallen — every point and bonus he carries is switched off until he is raised. Tap for details.",
  "נקודות גיבור פנויות — הקצה אותן בעמוד הגיבור (כל נקודה = +1%)":
    "Unspent hero points — allocate them on the hero screen (each point is +1%)",
  "{points} נקודות פנויות": "{points} points to spend",
  "תג איפוס: הגיבור הגיע לרמה 100 ואופס פעם אחת":
    "Prestige badge: your hero reached level 100 and was reset once",
  "תג איפוס: הגיבור הגיע לרמה 100 ואופס {count} פעמים":
    "Prestige badge: your hero reached level 100 and was reset {count} times",

  /* command-bar pills */
  "היסטוריית קרבות וריגול — תקיפות עליי, תקיפות שלי, ריגול עליי וריגול שלי. ההתראה נדלקת רק כשתוקפים או מרגלים עליי":
    "Battle and spy history — attacks on me, my attacks, spies on me and my missions. The alert only lights up when someone attacks or spies on me.",
  "תיבת הדואר: הודעות משחקנים, התראות על התקפות, מרגלים שנתפסו ועדכוני מערכת":
    "Your inbox: player mail, attack alerts, spies you caught and system notices",
  "פרסי העונה — יהלומים לשלושת הראשונים בסיום העונה, והדירוג החי שקובע מי יושב על כל מדרגה":
    "Season prizes — diamonds for the top three when the season ends, and the live ladder deciding who stands on each step",
  "יש לך הישגים שהושלמו וממתינים לאיסוף — היכנס ואסוף את התגמולים":
    "You have completed achievements waiting to be collected — go in and claim them",
  "{label} — {count} חדשים": "{label} — {count} new",

  /* ------------------------------------------------------------------ */
  /* the way in — auth shell, login, Google                             */
  /* ------------------------------------------------------------------ */
  // Two call sites share this word: the wordmark's subtitle under the crest,
  // and the tenth city — the seat of the broken crown. One value has to serve
  // both (the source text IS the key, see translate.ts), and it is the city
  // that appears constantly, so the city's reading wins. Under the crest it
  // reads as the lockup repeating its own name, which is what a lockup does.
  "קראלדור": "Kraldor",
  "התחברות | קראלדור": "Sign in | Kraldor",
  "התחברות": "Sign in",
  "אימייל": "Email",
  "סיסמה": "Password",
  "מתחבר...": "Signing in…",
  "התחבר למשחק": "Enter the game",
  "עדיין אין לך אימפריה?": "No empire yet?",
  "הירשם עכשיו": "Create one",
  "או": "or",
  // Google renders its button's own wording, in the locale it is handed — the
  // label is not ours to translate. Only what we put around it is.
  "מתחבר עם Google...": "Signing in with Google…",
  "התחברות Google נכשלה, נסה שוב": "Google sign-in failed — please try again",
  "הצטרפו לקהילה בדיסקורד": "Join the community on Discord",
  "תנאי שימוש": "Terms of Service",
  "ביטולים והחזרים": "Cancellations & Refunds",
  "פרטיות": "Privacy",
  "כל הזכויות שמורות": "All rights reserved",
  "{season} הסתיימה": "{season} has ended",
  "המשחק סגור עד פתיחת העונה הבאה.":
    "The game is closed until the next season opens.",
  "לתוצאות העונה ולספירה לאחור →":
    "Season results and the countdown →",

  /* ------------------------------------------------------------------ */
  /* the armory (weapons)                                               */
  /* ------------------------------------------------------------------ */
  "רמה": "Tier",
  "ברשותך:": "You own:",
  "עוצמה ליחידה:": "Power per unit:",
  "קנה": "Buy",
  "קונה...": "Buying…",
  "הכל": "All",
  "כמות לא תקינה": "That quantity is not valid",
  "נשק לא מוכר": "Unknown weapon",
  "אין מספיק משאבים זמינים לקנייה.": "You do not have enough available resources.",
  "אין מספיק מהמשאב הזה ליחידה אחת":
    "Not enough of this resource for even one unit",
  "קסם הנחה פעיל": "Discount spell active",
  "הנשק נעול — פתח נשק מתקדם כדי לקנות אותו":
    "This weapon is locked — unlock the next tier to buy it",
  "נקנו {count} {weapon} בהצלחה!": "Bought {count} {weapon}.",
  "לא ניתן להחזיק יותר מ-{max} יחידות מאותו נשק — יש לך כבר {owned}":
    "You cannot hold more than {max} of one weapon — you already have {owned}",

  /* ------------------------------------------------------------------ */
  /* the barracks (training)                                            */
  /* ------------------------------------------------------------------ */
  "עלות:": "Cost:",
  "אזרח אחד": "one citizen",
  "ביצוע אימון": "Train",
  "מאמן...": "Training…",
  "עוצמה": "power",
  "כמות לאימון (אזרחים פנויים: {available})":
    "How many to train (citizens free: {available})",
  "נדרש מרכז מודיעין כדי להכשיר מרגלים":
    "You need an intelligence centre to train spies",
  "אין מספיק אזרחים פנויים לאימון": "You do not have enough free citizens",
  "אומנו {count} {unit} בהצלחה!": "Trained {count} {unit}.",
  "לא ניתן להחזיק יותר מ-{max} {unit} — יש לך כבר {owned}":
    "You cannot hold more than {max} {unit} — you already have {owned}",

  /* ------------------------------------------------------------------ */
  /* generic action outcomes                                            */
  /* ------------------------------------------------------------------ */
  "אירעה שגיאה, נסה שוב": "Something went wrong — please try again",
  "לא מחובר": "Not signed in",
  "העונה הסתיימה — המשחק סגור עד פתיחת העונה הבאה":
    "The season is over — the game is closed until the next one opens",
  "סוג משאב לא תקין": "That is not a valid resource",
  "סוג מחסן לא תקין": "That is not a valid warehouse",
  "סוג שדרוג לא תקין": "That is not a valid upgrade",
  "יעד לא תקין": "That is not a valid target",
  " ו-": " and ",

  /* ------------------------------------------------------------------ */
  /* the armory screen                                                  */
  /* ------------------------------------------------------------------ */
  "נשקים | קראלדור": "Weapons | Kraldor",
  "חנות נשקים": "Weapon Shop",
  "התקפה": "Attack",
  "הגנה": "Defence",
  "ריגול": "Espionage",
  "כוח התקפה מנשקים": "Attack power from weapons",
  "כוח הגנה מנשקים": "Defence power from weapons",
  "כוח ריגול מנשקים": "Espionage power from weapons",
  "כוח התקפה כולל מנשקים": "Total attack power from weapons",
  "כוח הגנה כולל מנשקים": "Total defence power from weapons",
  "כוח ריגול כולל מנשקים": "Total espionage power from weapons",
  "קסם הנחה פעיל!": "Discount spell active!",
  "כל הנשקים והפתיחות ב־{pct}% הנחה כל עוד הקסם פעיל.":
    "Every weapon and unlock is {pct}% off for as long as the spell holds.",
  "🎉 המפעל במקסימום! כל הנשקים פתוחים.":
    "🎉 The armory is maxed out — every weapon is unlocked.",
  "נפחיית {label} — {powerLabel}: {power}, שכבה {tier} מתוך {maxTier}":
    "{label} forge — {powerLabel}: {power}, tier {tier} of {maxTier}",
  "← הנשק הבא": "NEXT WEAPON →",
  "🔒 נעול": "🔒 Locked",
  "עלות ליחידה:": "Cost per unit:",
  "עלות פתיחה:": "Unlock cost:",
  "דרישות לרמה הבאה:": "Requirements for the next tier:",
  "🏰 עיר {required} (אתה בעיר {current})":
    "🏰 City {required} (you are on city {current})",
  "⚔️ גיבור רמה {required} (רמה {current})":
    "⚔️ Hero level {required} (you are level {current})",
  "פתיחה מקדמת את הנשק הבא בכל הקטגוריות — התקפה, הגנה וריגול.":
    "Unlocking advances the next weapon in all three categories — attack, defence and espionage.",
  "אין מספיק מהמשאב הזה לפתיחה":
    "Not enough of this resource for the unlock",
  "פותח...": "Unlocking…",
  "🔓 פתח נשק הבא": "🔓 Unlock next weapon",
  "🔒 דרישות לא הושלמו": "🔒 Requirements not met",
  "אין מספיק משאבים לפתיחת הנשק הבא":
    "You do not have enough resources to unlock the next weapon",
  "כל הנשקים פתוחים.": "Every weapon is already unlocked.",
  "כדי לפתוח רמה {tier} צריך {needs}.":
    "Unlocking tier {tier} needs {needs}.",
  "{required} ערים (יש לך {current})": "{required} cities (you have {current})",
  "גיבור ברמה {required} (הגיבור שלך ברמה {current})":
    "a level {required} hero (yours is level {current})",
  "נפתחה רמה {tier} לכל הנשקים — התקפה, הגנה וריגול!":
    "Tier {tier} unlocked across attack, defence and espionage!",

  /* ------------------------------------------------------------------ */
  /* resources, buildings, units, upgrades — the game's data labels      */
  /* ------------------------------------------------------------------ */
  "מכרה זהב": "Gold Mine",
  "מכרה עץ": "Lumber Camp",
  "מכרה ברזל": "Iron Mine",
  "מחצבת אבן": "Stone Quarry",
  "מחנה אימונים": "Training Camp",
  "מרכז מודיעין": "Intelligence Centre",
  "מחסן זהב": "Gold Warehouse",
  "מחסן עץ": "Lumber Warehouse",
  "מחסן ברזל": "Iron Warehouse",
  "מחסן אבן": "Stone Warehouse",
  "חייל": "Soldier",
  "חיילים": "soldiers",
  "מרגל": "Spy",
  "מרגלים": "spies",
  "עבד מכרות": "Mine Slave",
  "עבדי מכרות": "mine slaves",
  "קבלת אזרחים": "Citizen Intake",
  "מודיעין": "Intelligence",
  "כמות הפקדות בבנק": "Bank Deposit Limit",
  "ריבית בנק": "Bank Interest",
  "קבלת תורות": "Turn Income",
  "מזל הגלגל": "Wheel Luck",
  "{building} שודרג לרמה {level}!": "{building} upgraded to level {level}!",
  "{storage} שודרג לרמה {level} (קיבולת: {capacity})":
    "{storage} upgraded to level {level} (capacity: {capacity})",
  "{upgrade} שודרג לרמה {level}!": "{upgrade} upgraded to level {level}!",
  "אין מספיק משאבים לשדרוג": "You do not have enough resources for this upgrade",
  "אין מספיק משאבים לשדרוג המחסן":
    "You do not have enough resources to upgrade the warehouse",
  "רמה מקסימלית": "Maximum level",
  "המכרה לא נמצא": "Mine not found",
  "המכרה כבר ברמה המקסימלית": "That mine is already at its maximum level",
  "אין מספיק משאבים זמינים. ניתן למשוך משאבים מהמחסן.":
    "Not enough available resources — you can withdraw some from your warehouse.",

  /* mines & slave assignment */
  "כמות עבדי מכרות לא תקינה": "That mine-slave count is not valid",
  "אין מספיק עבדי מכרות (סה\"כ עבדי מכרות: {total})":
    "You do not have that many mine slaves (you own {total})",
  "אין מספיק עבדי מכרות פנויים (ניתן להציב כאן עד {max})":
    "Not enough idle mine slaves — you can place up to {max} here",
  "הוצבו {count} עבדי מכרות ב{mine}": "Placed {count} mine slaves in the {mine}",
  "כל {total} עבדי המכרות הוצבו ב{resource}":
    "All {total} mine slaves are now working {resource}",
  "עבדי המכרות חולקו שווה בשווה בין ארבעת המשאבים":
    "Your mine slaves are split evenly across all four resources",
  "החלוקה נוקתה — כל עבדי המכרות פנויים":
    "Assignments cleared — every mine slave is idle",

  /* warehouses */
  "המחסן לא נמצא": "Warehouse not found",
  "המחסן ריק": "That warehouse is empty",
  "המחסן מלא — שדרג אותו כדי לאחסן עוד":
    "That warehouse is full — upgrade it to store more",
  "אין משאבים זמינים לאחסון": "You have no available resources to store",
  "אין מספיק משאבים זמינים לאחסון":
    "You do not have enough available resources to store",
  "אין מספיק משאבים במחסן": "There is not that much in the warehouse",
  "אוחסנו {amount} {resource} במחסן": "Stored {amount} {resource}",
  "נמשכו {amount} {resource} מהמחסן": "Withdrew {amount} {resource}",
  "אין מספיק מקום במחסן (מקום פנוי: {free})":
    "Not enough room in the warehouse (free space: {free})",
  "אין מספיק משאבים במחסן (מאוחסן: {stored})":
    "Not enough in the warehouse (stored: {stored})",

  /* cities */
  "הגעת לרמת העיר המרבית ({max}).": "You have reached the highest city ({max}).",
  "נדרש גיבור ברמה {level} כדי לעלות עיר.":
    "Founding the next city needs a level {level} hero.",
  "נדרשים {soldiers} חיילים בצבא כדי לעלות עיר.":
    "Founding the next city needs {soldiers} soldiers in your army.",
  "אין מספיק משאבים כדי לעלות עיר.":
    "You do not have enough resources to found the next city.",
  "עלית לעיר {city}! התפוקה שלך גדלה בהתאם.":
    "You have risen to city {city} — your output grows with it.",

  /* attacking & spying */
  "לא ניתן לתקוף את האימפריה שלך": "You cannot attack your own empire",
  "לא ניתן לרגל אחרי האימפריה שלך": "You cannot spy on your own empire",
  "האימפריה המבוקשת לא נמצאה": "That empire was not found",
  "האימפריה הזו אינה זמינה.": "That empire is not available.",
  "האימפריה הזו מוגנת (שחקן חדש) — לא ניתן לתקוף או לרגל אותה עדיין.":
    "That empire is under new-player protection — it cannot be attacked or spied on yet.",
  "לא ניתן לתקוף אימפריה שאינה בעיר שלך.":
    "You can only attack empires in your own city.",
  "לא ניתן לרגל אחר אימפריה שאינה בעיר שלך.":
    "You can only spy on empires in your own city.",
  "לא ניתן לתקוף חבר לברית — שניכם בברית {guild}.":
    "You cannot attack a guildmate — you are both in {guild}.",
  "אין לך מספיק תורות לביצוע תקיפה.": "You do not have enough turns to attack.",
  "אין לך מספיק תורות לביצוע ריגול.":
    "You do not have enough turns for a spy mission.",
  "אין לך צבא לתקיפה — אמן חיילים קודם":
    "You have no army to attack with — train soldiers first",
  "נדרש לפחות מרגל אחד למשימת ריגול":
    "A spy mission needs at least one spy",
  "כוחות הביטחון שלך תפסו מרגל של {attacker} לפני שהספיק לאסוף מידע.":
    "Your guards caught a spy sent by {attacker} before they gathered anything.",

  /* misc */
  "שם האימפריה נעול למשך העונה ולא ניתן לשינוי.":
    "Your empire's name is locked for the season and cannot be changed.",
  "דיסקורד": "Discord",
  "קהילת קראלדור בדיסקורד — עדכונים, שעות שמחה, מיני-משחקים ושאר השחקנים. נפתח בלשונית חדשה":
    "The Kraldor community on Discord — updates, happy hours, mini-games and the other players. Opens in a new tab.",

  /* ------------------------------------------------------------------ */
  /* weapon names and flavour — attack                                  */
  /* ------------------------------------------------------------------ */
  "חרבות ברזל": "Iron Swords",
  "חרבות בסיסיות ואמינות לחיילי החזית.":
    "Plain, dependable blades for the men holding the line.",
  "קשתות קרב": "War Bows",
  "קשתות ארוכות טווח שפוגעות באויב עוד לפני ההתנגשות.":
    "Long-range bows that bleed the enemy before the lines ever meet.",
  "גרזני מלחמה": "War Axes",
  "גרזנים כבדים ששוברים מגן ועצם כאחד.":
    "Heavy axes that split shield and bone alike.",
  "רמחי פרשים": "Cavalry Lances",
  "רמחים ארוכים להסתערות פרשים מוחצת.":
    "Long lances for a charge nothing on foot survives.",
  "בליסטראות": "Ballistae",
  "מכונות ירי כבדות שמרסקות שורות שלמות של אויבים.":
    "Heavy shooters that tear whole ranks apart at once.",
  "איילי ניגוח": "Battering Rams",
  "קורות ברזל שמפרקות שערים וחומות.":
    "Iron-headed beams that take gates and walls apart.",
  "מנגנוני קטפולט": "Catapults",
  "אבני ענק עפות מעל החומות אל לב האויב.":
    "Boulders arcing over the walls into the enemy's heart.",
  "תותחי מצור": "Siege Cannons",
  "תותחים אדירים שמפילים חומות ומבצרים.":
    "Great guns that bring down walls and fortresses.",
  "רובי אבק שריפה": "Gunpowder Muskets",
  "נשק חם ראשון ששובר את מערכות הקרב הישנות.":
    "The first firearms — and the end of every old battle formation.",
  "להבי אש": "Flameblades",
  "להבים אגדיים עטופי אש — נשק העילית של האימפריה.":
    "Legendary fire-wreathed blades — the empire's finest steel.",
  "מטילי להביור": "Flame Throwers",
  "מכונות שיורות סילוני אש על שדה הקרב.":
    "Machines that wash the battlefield in burning fuel.",
  "תותחי רעם": "Thunder Cannons",
  "תותחים שקולם לבדו מפיל אימה על האויב.":
    "Guns whose sound alone breaks the enemy's nerve.",
  "מרגמות ברק": "Lightning Mortars",
  "פגזים שמתפוצצים בברק כחול על הכוחות.":
    "Shells that burst in blue lightning over massed troops.",
  "רובאי צלפים": "Sharpshooters",
  "יחידת עילית שפוגעת במפקדי האויב מרחוק.":
    "An elite unit that takes enemy commanders from a distance.",
  "מכונות ירי מהיר": "Rapid-Fire Guns",
  "מטר כדורים בלתי פוסק שמכסה את כל החזית.":
    "An unbroken hail of fire covering the whole front.",
  "טנקי פלדה": "Steel Tanks",
  "מפלצות משוריינות שדורסות כל התנגדות.":
    "Armoured monsters that roll over any resistance.",
  "תותחי ענק": "Giant Cannons",
  "לוע ברזל שמוחק ביצורים בפגז אחד.":
    "An iron muzzle that erases fortifications in one shell.",
  "משגרי טילים": "Missile Launchers",
  "טילים מונחים שרודפים את האויב עד חיסולו.":
    "Guided missiles that chase the enemy until nothing is left.",
  "מפציצי אש": "Firebombers",
  "מכונות מעופפות שממטירות אש מהשמיים.":
    "Flying machines that rain fire from above.",
  "קרני לייזר": "Laser Beams",
  "אלומות אנרגיה שחותכות שריון כמו חמאה.":
    "Energy beams that cut armour like butter.",
  "תותחי פלזמה": "Plasma Cannons",
  "כדורי פלזמה בוערים ששורפים כל דבר בדרכם.":
    "Burning plasma bolts that consume everything in their path.",
  "רובי חלקיקים": "Particle Rifles",
  "נשק שמפרק את האויב לרמת האטום.":
    "Weapons that take the enemy apart atom by atom.",
  "משגרי אלקטרומגנט": "Railguns",
  "פגזים במהירות על-קולית שמנקבים כל מבצר.":
    "Hypersonic slugs that punch through any fortress.",
  "רחפני נחיל": "Swarm Drones",
  "נחיל מכונות זעירות שתוקף מכל כיוון בו-זמנית.":
    "A cloud of tiny machines striking from every direction at once.",
  "תותחי חורבן": "Devastator Cannons",
  "נשק כבד שמשאיר מכתשים בשדה הקרב.":
    "Heavy guns that leave craters where the battlefield was.",
  "מחוללי הדף": "Shockwave Generators",
  "גלי הלם שמוחקים גדודים שלמים בבת אחת.":
    "Shock waves that erase entire battalions in a breath.",
  "להבי אנרגיה טהורה": "Pure Energy Blades",
  "חרבות אור שחותכות דרך כל הגנה.":
    "Blades of light that cut through any defence.",
  "תותחי סינגולריות": "Singularity Cannons",
  "נשק שיוצר חור שחור זעיר בלב האויב.":
    "Weapons that open a pinhole black hole in the enemy's heart.",
  "משמידי ממדים": "Dimension Breakers",
  "נשק שמוחק את האויב מהמציאות עצמה.":
    "Weapons that erase the enemy from reality itself.",
  "יד קראלדור": "The Hand of Kraldor",
  "הנשק האולטימטיבי — כוח שאין לו אח ורע ביקום.":
    "The ultimate weapon — nothing in the universe stands beside it.",

  /* ------------------------------------------------------------------ */
  /* weapon names and flavour — defence                                 */
  /* ------------------------------------------------------------------ */
  "מגני עץ": "Wooden Shields",
  "מגנים פשוטים שבולמים את המכות הראשונות.":
    "Simple shields that soak up the opening blows.",
  "שריון ברזל": "Iron Armour",
  "שריון כבד שמגן על החיילים בקרב פנים אל פנים.":
    "Heavy plate for soldiers who fight face to face.",
  "קסדות פלדה": "Steel Helms",
  "קסדות שמגנות על הלוחמים מפגיעות ראש.":
    "Helms that keep a blow to the head from ending a soldier.",
  "שריון קשקשים": "Scale Armour",
  "שריון גמיש שסופג מכות ומאפשר תנועה חופשית.":
    "Flexible mail that absorbs a strike without binding the wearer.",
  "חומות חניתות": "Spear Walls",
  "שורות חניתות דחוסות שעוצרות כל הסתערות.":
    "Dense ranks of spears that stop any charge dead.",
  "תעלות הגנה": "Defensive Trenches",
  "תעלות עמוקות שמאטות את הסתערות האויב.":
    "Deep cuts in the ground that break the enemy's momentum.",
  "סוללות עפר": "Earthworks",
  "סוללות מבוצרות שמגנות על המחנה.":
    "Fortified banks thrown up around the camp.",
  "מגדלי שמירה": "Watchtowers",
  "מגדלים מבוצרים שיורים באויב מלמעלה.":
    "Fortified towers that fire down on the enemy.",
  "חומות אבן": "Stone Walls",
  "חומות עבות שעומדות בפני כל מצור.":
    "Thick walls that outlast any siege.",
  "חומת קראלדור": "The Wall of Kraldor",
  "החומה האיתנה שסביבה נבנתה הממלכה.":
    "The unshaken wall the kingdom was built around.",
  "שערי ברזל": "Iron Gates",
  "שערים כבדים שאף איל ניגוח לא שובר.":
    "Gates so heavy no ram has ever broken one.",
  "מבצרי פלדה": "Steel Fortresses",
  "מצודות ממתכת שאין דרך לחדור אליהן.":
    "Metal citadels with no way in.",
  "מגיני מצור": "Siege Shields",
  "מערך הגנה שסופג פגזי קטפולט ותותח.":
    "A screen built to swallow catapult stones and cannon shot.",
  "שריון מרוכב": "Composite Armour",
  "שכבות מתכת מרובות שסופגות כל פגיעה.":
    "Layer upon layer of metal, each one drinking the impact.",
  "כיפת מגן": "Shield Dome",
  "מערך שמיירט קליעים לפני שהם פוגעים.":
    "A screen that intercepts incoming fire before it lands.",
  "בונקרים מבוצרים": "Reinforced Bunkers",
  "מקלטים תת-קרקעיים שאי אפשר לפצח.":
    "Underground shelters nothing has ever cracked.",
  "חומות ריאקטיביות": "Reactive Armour",
  "שריון שמתפוצץ החוצה ומנטרל פגזים.":
    "Armour that detonates outward and kills the shell first.",
  "מגני אנרגיה": "Energy Shields",
  "שדות כוח שבולמים את אש האויב.":
    "Force fields that halt the enemy's fire in the air.",
  "כיפת ברזל": "Iron Dome",
  "מערך יירוט שמפיל כל טיל באוויר.":
    "An interception grid that takes every missile down in flight.",
  "מגן פלזמה": "Plasma Shield",
  "קיר פלזמה בוער ששורף כל מתקרב.":
    "A burning plasma wall that consumes anything that approaches.",
  "שדות כוח": "Force Fields",
  "מחסום אנרגיה בלתי חדיר סביב המבצר.":
    "An impenetrable energy barrier around the fortress.",
  "שריון ננו": "Nano Armour",
  "שריון שמתקן את עצמו תוך שניות.":
    "Armour that repairs itself in seconds.",
  "מגני עקיפה": "Deflector Shields",
  "טכנולוגיה שמסיטה קליעים מהמסלול.":
    "Technology that pushes incoming rounds off course.",
  "מבצר מרחף": "Floating Fortress",
  "מצודה מעופפת שאי אפשר להגיע אליה.":
    "A citadel in the air that nothing can reach.",
  "חומות קוונטיות": "Quantum Walls",
  "הגנה שקיימת בכמה ממדים בו-זמנית.":
    "A defence that exists in several dimensions at once.",
  "מגן סינגולריות": "Singularity Shield",
  "שדה שבולע כל התקפה לתוך עצמו.":
    "A field that swallows every attack into itself.",
  "שריון על-ממדי": "Hyperdimensional Armour",
  "הגנה שהאויב פשוט לא מסוגל לגעת בה.":
    "A defence the enemy simply cannot touch.",
  "כיפת נצח": "Eternal Dome",
  "מגן שלא נפרץ מעולם בכל ההיסטוריה.":
    "A shield never breached in all of recorded history.",
  "חומת המציאות": "The Reality Wall",
  "מחסום ששובר את חוקי הפיזיקה עצמם.":
    "A barrier that breaks the laws of physics themselves.",
  "מבצר קראלדור": "The Fortress of Kraldor",
  "ההגנה האולטימטיבית — בלתי חדירה לחלוטין.":
    "The ultimate defence — utterly impenetrable.",

  /* ------------------------------------------------------------------ */
  /* weapon names and flavour — espionage                               */
  /* ------------------------------------------------------------------ */
  "גלימות הסוואה": "Camouflage Cloaks",
  "גלימות שמסתירות את המרגלים מעיני השומרים.":
    "Cloaks that hide your spies from the guards' eyes.",
  "סכיני צללים": "Shadow Knives",
  "סכינים שקטים למשימות חשאיות במיוחד.":
    "Silent blades for the quietest work.",
  "כלי פריצה": "Lockpicks",
  "ערכות לפתיחת מנעולים ושערים סמויים.":
    "Kits for every lock and hidden gate.",
  "תחפושות סוחרים": "Merchant Disguises",
  "מסווה שמאפשר להיכנס לכל עיר בלי חשד.":
    "A cover that walks into any city unquestioned.",
  "עורבי מודיעין": "Messenger Ravens",
  "עורבים מאולפים שמעבירים מסרים מעבר לקווי האויב.":
    "Trained ravens carrying word across enemy lines.",
  "רשת מודיעים": "Informant Network",
  "עיניים ואוזניים בכל פונדק ושוק.":
    "Eyes and ears in every tavern and market.",
  "סמים מרדימים": "Sleeping Draughts",
  "שיקויים שמפילים שומרים בשקט.":
    "Potions that put a guard down without a sound.",
  "אבקת היעלמות": "Vanishing Powder",
  "אבקה שמעלימה את המרגל בענן עשן.":
    "Powder that takes the spy away in a cloud of smoke.",
  "מפות סתר": "Secret Maps",
  "מפות מדויקות של כל ביצורי האויב.":
    "Exact drawings of every enemy fortification.",
  "טבעות התחזות": "Rings of Guise",
  "טבעות קסומות שמאפשרות למרגל להתחזות לכל אדם.":
    "Enchanted rings that let a spy wear any face.",
  "יוני דואר": "Carrier Pigeons",
  "מסרים מוצפנים שעפים מעל קווי האויב.":
    "Ciphered messages flying straight over the enemy's lines.",
  "משקפות ליל": "Night Glasses",
  "עדשות שרואות בחשכה מוחלטת.":
    "Lenses that see in complete darkness.",
  "מכשירי האזנה": "Listening Devices",
  "מכשירים שקולטים כל לחישה בארמון.":
    "Devices that catch every whisper in the palace.",
  "סוכני עומק": "Deep-Cover Agents",
  "מרגלים ששתולים שנים בלב האויב.":
    "Spies planted years ago in the enemy's own house.",
  "צפני סתרים": "Secret Ciphers",
  "שפה סודית שאיש אינו יכול לפצח.":
    "A private language nobody has ever broken.",
  "רחפני ריגול": "Surveillance Drones",
  "עיניים מעופפות מעל מחנה האויב.":
    "Eyes in the air above the enemy camp.",
  "מצלמות זעירות": "Micro Cameras",
  "עדשות נסתרות שמתעדות כל מסמך.":
    "Hidden lenses recording every document.",
  "וירוסי מידע": "Data Viruses",
  "קוד שגונב תוכניות מארכיוני האויב.":
    "Code that lifts the plans straight out of the enemy's archives.",
  "רשת לוויינים": "Satellite Network",
  "עיניים בשמיים שרואות הכול מלמעלה.":
    "Eyes in the sky that see everything from above.",
  "פורצי הצפנה": "Codebreakers",
  "מכונות ששוברות כל קוד סתרים.":
    "Machines that break any cipher put in front of them.",
  "שתלי מוח": "Neural Implants",
  "טכנולוגיה שקוראת מחשבות של שבויים.":
    "Technology that reads a prisoner's thoughts.",
  "מרגלי כפילים": "Doppelgänger Agents",
  "עותקים מושלמים של מפקדי האויב.":
    "Perfect copies of the enemy's own commanders.",
  "רשת עצבים": "Neural Web",
  "רשת שחודרת לכל מערכת מידע של האויב.":
    "A web reaching into every system the enemy owns.",
  "עיני צל": "Shadow Eyes",
  "חיישנים בלתי נראים בכל פינה בממלכה.":
    "Invisible sensors in every corner of the realm.",
  "פורצי קוונטים": "Quantum Breakers",
  "מחשבים ששוברים כל הצפנה בשבריר שנייה.":
    "Machines that break any encryption in a fraction of a second.",
  "רוחות רפאים": "Ghosts",
  "סוכנים שאיש לא יודע שהם קיימים.":
    "Agents nobody knows exist.",
  "עין כול-רואה": "The All-Seeing Eye",
  "מערך שרואה כל תנועה בכל הממלכות.":
    "A network watching every movement in every realm.",
  "תודעת רשת": "Network Consciousness",
  "בינה שיודעת הכול עוד לפני שזה קורה.":
    "An intelligence that knows everything before it happens.",
  "עין המציאות": "The Eye of Reality",
  "ריגול שחודר את מסך הזמן עצמו.":
    "Espionage that reaches through the veil of time itself.",
  "עין קראלדור": "The Eye of Kraldor",
  "הריגול האולטימטיבי — שום סוד לא נסתר ממנה.":
    "The ultimate intelligence — no secret is hidden from it.",

  /* ------------------------------------------------------------------ */
  /* the base screen — command centre                                   */
  /* ------------------------------------------------------------------ */
  "בסיס | KRALDOR": "Base | KRALDOR",
  "מרכז הפיקוד": "Command Centre",
  "{season} התחילה!": "{season} has begun!",
  "העונה פעילה": "The season is live",
  "— בהצלחה לכולם בעונה החדשה!": "— good luck to everyone this season!",
  "סיום עונה:": "Season ends:",
  "פרטי בסיס": "Base Details",
  "עונה": "Season",
  "ללא": "None",
  "לעמוד הברית": "Go to guild",
  "הצטרף לברית": "Join a guild",
  "משאבים": "Resources",
  "מאוחסן:": "Stored:",
  "בבנק": "Banked",
  "פעילות אחרונה": "Recent Activity",
  "אין דיווחים עדיין. היכנס לפרופיל אימפריה מעמוד הדירוג כדי לרגל או לתקוף.":
    "No reports yet. Open an empire's profile from the rankings to spy on it or attack it.",
  "תקפת את": "You attacked",
  "הותקפת על ידי": "You were attacked by",
  "ריגלת אחרי": "You spied on",
  "ניצחון": "Victory",
  "הפסד": "Defeat",
  "הצלחה": "Success",
  "כישלון": "Failure",
  "הפקדה לבנק": "Bank deposit",
  "משיכה מהבנק": "Bank withdrawal",
  "ריבית מהבנק": "Bank interest",
  "לכל הדוחות ←": "All reports ←",

  /* ------------------------------------------------------------------ */
  /* world records — the board on the base screen and the profile case   */
  /* ------------------------------------------------------------------ */
  "שיאי העולם": "World Records",
  "שיאי המשחק ומי כבש אותם ראשון — מכל השחקנים בעולם":
    "The game's records, and who claimed each one first — across every player in the world",
  "שיאים שנכבשו": "records claimed",
  "על שמך": "in your name",
  "ימי שרת": "days on the server",
  "השיא שלך": "Your record",
  "הושג": "Reached",
  "ראשון בעולם:": "First in the world:",
  "השיא עדיין פנוי — אף אחד לא הגיע לכאן":
    "This record is still open — nobody has got here yet",
  "שיאי עולם": "World Records",
  "שיא עולם": "world record",
  "ראשון בעולם": "First in the world",
  "הישגים שאתה הראשון בעולם שהגיע אליהם":
    "Milestones you were the first in the world to reach",
  "הישגים שהאימפריה הזו הראשונה בעולם שהגיעה אליהם":
    "Milestones this empire was the first in the world to reach",

  /* the five capstones, as the records board names them */
  "להגיע לעיר 10": "Reach City 10",
  "להגיע לשדרוג של 500 אזרחים בעדכון יומי":
    "Reach 500 citizens per daily update",
  "גיבור הגיע לרמה 100": "Hero reaches level 100",
  "להגיע למקסימום מכרות": "Max out every mine",
  "להגיע לכל דגמי הנשק": "Own every weapon model",
  "האימפריה המלאה, כל עשר הערים": "The full empire — all ten cities",
  'שדרוג "קבלת מגויסים" עד 500 אזרחים בכל עדכון':
    'The "Citizen Intake" upgrade at 500 citizens per update',
  "הרמה האחרונה של הגיבור": "The hero's final level",
  "ארבעת המכרות ברמה {mines}": "All four mines at level {mines}",
  "כל {models} הדגמים במחסן": "All {models} models in the armory",

  /* ------------------------------------------------------------------ */
  /* achievements — the reward ladder                                    */
  /* ------------------------------------------------------------------ */
  "הושלמו": "Completed",
  "פרס אחד ממתין לך": "One reward is waiting for you",
  "{count} פרסים ממתינים לך": "{count} rewards are waiting for you",
  "אסוף הכל": "Collect all",
  "אוסף...": "Collecting…",
  "מוכן לאיסוף": "Ready to collect",
  "נאסף": "Collected",
  "נאספו {count} הישגים": "Collected {count} achievements",
  "האיסוף נכשל": "The collection failed",
  "אין הישגים בקטגוריה הזו": "No achievements in this category",
  "אין הישגים חדשים לאיסוף": "No new achievements to collect",

  /* categories — "ריגול" is already above, under the armory */
  "מלחמה": "War",
  "כלכלה": "Economy",
  "אימפריה": "Empire",
  "תהילה": "Glory",

  /* war */
  "{goal} תקיפות": "{goal} attacks",
  "פתח ב-{goal} תקיפות, בניצחון או בהפסד":
    "Launch {goal} attacks, win or lose",
  "תקיפה ראשונה": "First Strike",
  "תקוף אימפריה אחת מהדירוג": "Attack one empire from the rankings",
  "אלף תקיפות": "A Thousand Attacks",
  "פתח ב-1,000 תקיפות — מצביא אמיתי":
    "Launch 1,000 attacks — a true warlord",
  "{goal} ניצחונות": "{goal} victories",
  "נצח ב-{goal} תקיפות": "Win {goal} attacks",
  "ניצחון ראשון": "First Victory",
  "נצח בתקיפה אחת": "Win a single attack",
  "{goal} הדיפות": "{goal} repelled",
  "הדוף {goal} תקיפות על האימפריה שלך":
    "Repel {goal} attacks on your empire",
  "חומה ראשונה": "First Wall",
  "הדוף תקיפה אחת על האימפריה שלך": "Repel one attack on your empire",
  "{goal} חיילי אויב": "{goal} enemy soldiers",
  "חסל {goal} חיילי אויב בקרב": "Slay {goal} enemy soldiers in battle",
  "קוצר הנשמות": "The Reaper",
  "חסל 100,000 חיילי אויב": "Slay 100,000 enemy soldiers",
  "{goal} שבויים": "{goal} captives",
  "שבה {goal} חיילי אויב לעבדות מכרות":
    "Capture {goal} enemy soldiers into the mines",
  "שוד {goal} זהב": "{goal} gold plundered",
  "שדוד {goal} זהב מאימפריות אחרות":
    "Plunder {goal} gold from other empires",
  "מלך השודדים": "King of Thieves",
  "שדוד 10,000,000 זהב מאימפריות אחרות":
    "Plunder 10,000,000 gold from other empires",

  /* espionage */
  "{goal} משימות ריגול": "{goal} spy missions",
  "שלח {goal} משימות ריגול": "Send {goal} spy missions",
  "ריגול ראשון": "First Infiltration",
  "שלח מרגלים לאימפריה אחת": "Send spies to a single empire",
  "{goal} דוחות ריגול": "{goal} spy reports",
  "חזור עם {goal} דוחות ריגול מוצלחים":
    "Come back with {goal} successful spy reports",
  "דוח ראשון": "First Report",
  "חזור עם דוח ריגול מוצלח אחד": "Come back with one successful spy report",
  "צל האימפריה": "Shadow of the Empire",
  "חזור עם 300 דוחות ריגול מוצלחים":
    "Come back with 300 successful spy reports",
  "{goal} מרגלים": "{goal} spies",
  "אמן {goal} מרגלים": "Train {goal} spies",

  /* hero */
  "גיבור ברמה {goal}": "Hero at level {goal}",
  "העלה את הגיבור שלך לרמה {goal}": "Raise your hero to level {goal}",
  "גיבור בשיא": "Hero at the Peak",
  "העלה את הגיבור שלך לרמה {goal} — הרמה המרבית":
    "Raise your hero to level {goal} — the maximum",
  "{goal} איפוסי גיבור": "{goal} hero resets",
  "אפס את הגיבור {goal} פעמים לאחר שהגיע לשיא":
    "Reset your hero {goal} times after reaching the cap",
  "לידה מחדש": "Rebirth",
  "אפס את הגיבור בפעם הראשונה לאחר שהגיע לשיא":
    "Reset your hero for the first time after reaching the cap",
  "{goal} פריטי ציוד": "{goal} pieces of gear",
  "אסוף {goal} פריטי ציוד לגיבור": "Collect {goal} pieces of hero gear",
  "למצוא חפץ ראשון": "First Find",
  "נצח בתקיפה וזכה בציוד לגיבור": "Win an attack and take hero gear from it",
  "{goal} פריטים אפיים": "{goal} epic items",
  "זכה ב-{goal} פריטים בדרגת נדירות אפי":
    "Win {goal} items of epic rarity",
  "חפץ אפי": "Epic Relic",
  "זכה בפריט אחד בדרגת נדירות אפי": "Win one item of epic rarity",
  "{goal} פריטים אגדיים": "{goal} legendary items",
  "זכה ב-{goal} פריטים בדרגת נדירות אגדי":
    "Win {goal} items of legendary rarity",
  "חפץ אגדי": "Legendary Relic",
  "זכה בפריט אחד בדרגת נדירות אגדי": "Win one item of legendary rarity",
  "ציוד מלא": "Fully Equipped",
  "צייד את הגיבור בכל תשעת המשבצות בו-זמנית":
    "Fill all nine of your hero's slots at once",

  /* economy */
  "{goal} מכרות": "{goal} mines",
  "שדרג {goal} מכרות מעל רמה {start}":
    "Upgrade {goal} mines above level {start}",
  "לשדרג מכרה": "Upgrade a Mine",
  "שדרג מכרה אחד מעל רמה {start}": "Upgrade one mine above level {start}",
  "לשדרג את כל המכרות": "Upgrade Every Mine",
  "שדרג את ארבעת המכרות מעל רמה {start}":
    "Upgrade all four mines above level {start}",
  "כל המכרות ברמה {goal}": "All mines at level {goal}",
  "שדרג את ארבעת המכרות לרמה {goal} ומעלה":
    "Upgrade all four mines to level {goal} or higher",
  "תעשייה בשיא": "Industry at the Peak",
  "שדרג את ארבעת המכרות לרמה {goal} — הרמה המרבית":
    "Upgrade all four mines to level {goal} — the maximum",
  "כל המחסנים ברמה {goal}": "All warehouses at level {goal}",
  "שדרג את ארבעת המחסנים לרמה {goal} ומעלה":
    "Upgrade all four warehouses to level {goal} or higher",
  "{goal} זהב": "{goal} gold",
  "החזק {goal} זהב בבת אחת": "Hold {goal} gold at once",
  "מיליונר ראשון": "First Million",
  "החזק 1,000,000 זהב בבת אחת": "Hold 1,000,000 gold at once",
  "הון עתק": "Vast Fortune",
  "החזק 100,000,000 זהב בבת אחת": "Hold 100,000,000 gold at once",
  "{goal} הפקדות": "{goal} deposits",
  "בצע {goal} הפקדות בבנק": "Make {goal} deposits at the bank",
  "הפקדה ראשונה בבנק": "First Deposit",
  "הפקד זהב בבנק פעם אחת": "Deposit gold at the bank once",
  "{goal} זהב בבנק": "{goal} gold banked",
  "החזק {goal} זהב בחשבון הבנק": "Hold {goal} gold in your bank account",
  "{goal} תשלומי ריבית": "{goal} interest payments",
  "קבל {goal} תשלומי ריבית מהבנק":
    "Receive {goal} interest payments from the bank",
  "ריבית ראשונה": "First Interest",
  "קבל תשלום ריבית אחד מהבנק": "Receive one interest payment from the bank",
  "מחסנים מלאים": "Full Warehouses",
  "החזק מיליון עץ, מיליון ברזל ומיליון אבן בו-זמנית":
    "Hold a million wood, a million iron and a million stone at once",

  /* empire */
  "{goal} ערים": "{goal} cities",
  "ייסד אימפריה בת {goal} ערים": "Build an empire of {goal} cities",
  "לעלות עיר": "Found a City",
  "ייסד עיר שנייה": "Found a second city",
  "קיסרות": "Imperium",
  "החזק את כל {goal} הערים — האימפריה המלאה":
    "Hold all {goal} cities — the full empire",
  "קבלת מגויסים {goal}": "Citizen Intake {goal}",
  'שדרג את "קבלת מגויסים" לרמה {goal}':
    'Upgrade "Citizen Intake" to level {goal}',
  "לשדרג קבלת מגויסים": "Upgrade Citizen Intake",
  'שדרג את "קבלת מגויסים" לרמה 2': 'Upgrade "Citizen Intake" to level 2',
  "500 אזרחים ביום": "500 Citizens a Day",
  'שדרג את "קבלת מגויסים" לרמה {goal} — 500 אזרחים בכל עדכון יומי':
    'Upgrade "Citizen Intake" to level {goal} — 500 citizens per daily update',
  "עיר שוקקת": "A Teeming City",
  'שדרג את "קבלת מגויסים" לרמה {goal} — {citizens} אזרחים בכל עדכון יומי':
    'Upgrade "Citizen Intake" to level {goal} — {citizens} citizens per daily update',
  "כל השדרוגים ברמה {goal}": "Every upgrade at level {goal}",
  "העלה כל אחד משדרוגי האימפריה לרמה {goal} ומעלה":
    "Raise every empire upgrade to level {goal} or higher",
  "אימפריה משודרגת": "An Upgraded Empire",
  "העלה כל אחד משדרוגי האימפריה לרמה 5 ומעלה":
    "Raise every empire upgrade to level 5 or higher",
  "צבא של {goal}": "An army of {goal}",
  "אמן {goal} חיילים": "Train {goal} soldiers",
  "צבא אין-סופי": "An Endless Army",
  "אמן 100,000 חיילים": "Train 100,000 soldiers",
  "{goal} עבדי מכרות": "{goal} mine slaves",
  "החזק {goal} עבדי מכרות": "Hold {goal} mine slaves",
  "לקנות נשק התקפה": "Buy an Attack Weapon",
  "רכוש כלי נשק אחד מקטגוריית התקפה":
    "Buy one weapon from the attack category",
  "לקנות נשק הגנה": "Buy a Defence Weapon",
  "רכוש כלי נשק אחד מקטגוריית הגנה":
    "Buy one weapon from the defence category",
  "לקנות נשק ריגול": "Buy a Spy Weapon",
  "רכוש כלי נשק אחד מקטגוריית ריגול":
    "Buy one weapon from the espionage category",
  "{goal} דגמי נשק": "{goal} weapon models",
  "החזק {goal} דגמי נשק שונים": "Own {goal} different weapon models",
  "נשקייה מושלמת": "A Perfect Armory",
  "החזק את כל {goal} דגמי הנשק במשחק":
    "Own all {goal} weapon models in the game",
  "{goal} כלי נשק": "{goal} weapons",
  "החזק {goal} כלי נשק בסך הכל": "Own {goal} weapons in total",
  "דרגת נשק {goal} בכל הקטגוריות": "Weapon tier {goal} in every category",
  "פתח את דרגה {goal} בשלוש קטגוריות הנשק":
    "Unlock tier {goal} in all three weapon categories",
  "כל הדרגות פתוחות": "Every Tier Unlocked",
  "פתח את דרגה 30 בשלוש קטגוריות הנשק":
    "Unlock tier 30 in all three weapon categories",

  /* legacy */
  "להצטרף לגילדה": "Join a Guild",
  "הצטרף לגילדה קיימת או הקם אחת": "Join an existing guild or found one",
  "מנהיג גילדה": "Guild Leader",
  "הקם גילדה משלך והובל אותה": "Found your own guild and lead it",
  "{goal} ניצחונות על בוסים": "{goal} boss victories",
  "נצח את בוס העיר {goal} פעמים": "Beat your city boss {goal} times",
  "להביס את בוס העיר": "Beat the City Boss",
  "נצח את הבוס של העיר שלך": "Beat the boss of your city",
  "צייד העריצים": "Tyrant Hunter",
  "הבס את הבוסים של כל {cities} דרגות הערים":
    "Beat the bosses of all {cities} city tiers",
  "{goal} ניצחונות במיני-משחק": "{goal} mini-game wins",
  "נצח {goal} פעמים במיני-משחק": "Win the mini-game {goal} times",
  "ניצחון ראשון במיני-משחק": "First Mini-Game Win",
  "נצח פעם אחת במיני-משחק": "Win the mini-game once",
  "{goal} מכתבים": "{goal} letters",
  "שלח {goal} מכתבים לשחקנים אחרים":
    "Send {goal} letters to other players",
  "מכתב ראשון": "First Letter",
  "שלח מכתב לשחקן אחר": "Send a letter to another player",
  "לכבוש מקום ראשון בדירוג": "Take First Place",
  "היה מספר 1 בדירוג העיר שלך": "Be number 1 in your city's rankings",

  /* ------------------------------------------------------------------ */
  /* buildings, units, warehouses, empire upgrades                       */
  /* ------------------------------------------------------------------ */
  "כורה זהב מהאדמה. ככל שרמת המכרה גבוהה יותר ויש יותר עבדי מכרות — התפוקה עולה.":
    "Digs gold out of the ground. The higher the mine's level and the more slaves worked into it, the more it yields.",
  "עבדי המכרות כורתים כאן עץ לבנייה ולצבא.":
    "Your slaves fell timber here, for building and for the army.",
  "ברזל הוא הבסיס לכל כלי הנשק של האימפריה.":
    "Iron is the basis of every weapon the empire fields.",
  "אבן איכותית לחומות, מבנים וביצורים.":
    "Good stone for walls, buildings and fortifications.",
  "כאן מאומנים חיילי האימפריה.": "Where the empire's soldiers are trained.",
  "מרכז הריגול של האימפריה. נדרש להכשרת מרגלים.":
    "The empire's spy headquarters. Required to train spies.",

  "כוח הלחימה המרכזי של האימפריה.":
    "The empire's main fighting force.",
  "חושפים מידע על אימפריות יריבות.":
    "They uncover intelligence on rival empires.",
  "מוצבים במכרות ומגדילים את תפוקת המשאבים.":
    "Stationed in the mines, raising your resource output.",


  "מגדיל את כמות האזרחים שמתקבלת בכל עדכון יומי.":
    "Raises how many citizens arrive on every daily update.",
  "{citizens} אזרחים בכל עדכון יומי": "{citizens} citizens per daily update",
  "מגדיל את כח המודיעין שלך. ריגול מצליח כשכח המודיעין שלך גדול מזה של היעד — בלי הגרלה.":
    "Raises your intelligence rating. A spy mission succeeds when your rating beats the target's — no dice involved.",
  "+{pct}% כח מודיעין": "+{pct}% intelligence",
  "מגדיל את מספר ההפקדות שניתן לבצע בבנק בין עדכון יומי לעדכון יומי.":
    "Raises how many deposits you may make between one daily update and the next.",
  "{count} הפקדות בין עדכון יומי לעדכון יומי":
    "{count} deposits between daily updates",
  "מוסיף 1% לריבית שמתקבלת בבנק בכל עדכון יומי — עד {max}% ברמה {maxLevel}. הריבית מצטברת פעמיים ביום על זהב שאי אפשר לבזוז, ולכן הסולם יקר: כל רמה עולה פי {growth} מקודמתה.":
    "Adds 1% to the interest the bank pays on every daily update — up to {max}% at level {maxLevel}. It compounds twice a day on gold nobody can plunder, which is why the ladder is expensive: each level costs {growth}× the one before.",
  "{pct}% ריבית בכל עדכון יומי": "{pct}% interest per daily update",
  "מוסיף תור אחד לכל עדכון רגיל — כלומר {perDay} תורות נוספות ביום, לתמיד. לכן הסולם יקר: כל רמה עולה פי {growth} מקודמתה.":
    "Adds one turn to every regular update — {perDay} extra turns a day, forever. Which is why the ladder is expensive: each level costs {growth}× the one before.",
  "+{turns} תורות לעדכון רגיל ({perDay} ביום)":
    "+{turns} turns per regular update ({perDay} a day)",
  "מוסיף 1% לסיכוי לזכות בסיבוב גלגל מזל — מזריקת חפץ ומתקיפה מנצחת — עד {max}% ברמה המקסימלית. השדרוג היקר במשחק: כל רמה עולה פי {growth} מקודמתה.":
    "Adds 1% to your chance of winning a wheel spin — from discarding an item and from a winning attack — up to {max}% at the cap. The most expensive upgrade in the game: each level costs {growth}× the one before.",
  "+{pct}% סיכוי לסיבוב גלגל מזל": "+{pct}% chance of a wheel spin",

  /* ------------------------------------------------------------------ */
  /* the ten cities                                                      */
  /* ------------------------------------------------------------------ */
  "אשמורן": "Ashmoran",
  "משמר הגבול": "The Border Watch",
  "תרשיש": "Tarshish",
  "נמל האניות השבורות": "Harbour of Broken Ships",
  "כרכמיש": "Carchemish",
  "המעבר שמעבר לנהר": "The Crossing Beyond the River",
  "ארגוב": "Argov",
  "מבצר הבזלת": "The Basalt Fortress",
  "אופיר": "Ophir",
  "אוצר המדבר": "Treasure of the Desert",
  "תדמור": "Tadmor",
  "נווה העמודים": "Oasis of Columns",
  "מגידו": "Megiddo",
  "שדה הקרב האחרון": "The Last Battlefield",
  "פתרוס": "Pathros",
  "עיר הכבשנים": "City of Furnaces",
  "בבל": "Babel",
  "צל המגדל": "Shadow of the Tower",
  "כס הכתר השבור": "Seat of the Broken Crown",

  /* ------------------------------------------------------------------ */
  /* the ten city bosses                                                 */
  /* ------------------------------------------------------------------ */
  "ורקוס": "Varkos",
  "שובר השערים": "The Gatebreaker",
  "ענק משוריין שמנפץ שערי ערים במקבת אחת. הוא חונה על חורבות העיר הראשונה ודורש מס דמים מכל אימפריה שעולה לדרך.":
    "An armoured giant who shatters city gates with a single hammer blow. He camps on the ruins of the first city and demands a blood tax from every empire setting out.",
  "מורגהת": "Morgheth",
  "אלמנת האפר": "Widow of Ash",
  "מכשפה עטופת רעלות פחם ששרפה את ממלכתה שלה. כל מי שמתקרב לחומותיה נושם אפר — והאפר זוכר את שמו.":
    "A witch wrapped in veils of coal who burned her own kingdom. Anyone nearing her walls breathes ash — and the ash remembers their name.",
  "דראגור": "Dragor",
  "בן הברזל": "Son of Iron",
  "נולד בכבשן ומעולם לא הסיר את שריונו. חרב התליין שלו נעוצה באדמה, וסביבה קבורים כל מי שניסו להזיז אותה.":
    "Born in a furnace and never once out of his armour. His headsman's sword stands driven into the earth, and buried around it is everyone who tried to move it.",
  "סרפינה": "Serpina",
  "לוחשת הרעל": "The Poison Whisperer",
  "מלכת המתנקשים של הביצות הירוקות. היא לא נלחמת בצבאות — היא מרעילה את בארותיהם ומחכה שהמצור ייגמר מעצמו.":
    "Assassin queen of the green marshes. She does not fight armies — she poisons their wells and waits for the siege to end itself.",
  "קרון": "Karon",
  "רועה השבויים": "Shepherd of Captives",
  "סוחר עבדים במסכת ארד ללא פה. כל שרשרת שכרוכה על זרועו הייתה פעם צבא שלם שחשב שהוא חזק מספיק.":
    "A slaver in a bronze mask with no mouth. Every chain coiled on his arm was once an entire army that thought it was strong enough.",
  "אזראל": "Azrael",
  "נביא הלהבה": "Prophet of the Flame",
  "כוהן אש שפניו נמסו לתוך הלבה שהוא סוגד לה. הוא מטיף שכל אימפריה נועדה להישרף — ומקדים להגשים את הנבואה.":
    "A fire priest whose face melted into the lava he worships. He preaches that every empire is destined to burn — and hurries the prophecy along.",
  "תארוס": "Tharos",
  "מצביא הלגיון השחור": "Warlord of the Black Legion",
  "מפקד הלגיון שלא הפסיד קרב מעולם. הוא לא בא לבזוז — הוא בא למחוק את שם האימפריה מכל מפה קיימת.":
    "Commander of the legion that has never lost a battle. He does not come to plunder — he comes to erase your empire's name from every map there is.",
  "רית'ן": "Rithen",
  "מלך הצללים": "King of Shadows",
  "אין לו גוף, רק שריון שממשיך לצעוד. חרמש הצל שלו חותך דרך חומות כאילו הן לא היו שם מעולם.":
    "He has no body, only armour that keeps marching. His shadow scythe cuts through walls as though they had never been there.",
  "וולגריס": "Volgaris",
  "הר הפלדה": "The Steel Mountain",
  "טיטאן מצור בגובה חומה, ששריונו בנוי משערי הערים שהפיל. הוא לא צועד מהר — הוא פשוט לא נעצר.":
    "A siege titan as tall as a wall, armoured in the city gates he has felled. He does not march fast — he simply never stops.",
  "נוקס": "Nox",
  "קיסר הכתר השבור": "Emperor of the Broken Crown",
  "הקיסר האפל הראשון, שיושב על כס שבור מאז שהעולם היה צעיר. מי שמפיל אותו יורש את קראלדור כולה.":
    "The first dark emperor, seated on a broken throne since the world was young. Whoever fells him inherits all of Kraldor.",

  /* ------------------------------------------------------------------ */
  /* the hero — stats, gear slots, rarities, classes                     */
  /* ------------------------------------------------------------------ */
  /* "התקפה" and "הגנה" are already above, under the armory's categories */
  "כל אחוז מגדיל את כוח הצבא שלך בתקיפה.":
    "Every percent raises your army's power when you attack.",
  "כל אחוז מגדיל את כוח הצבא שלך בהגנה מפני תקיפות.":
    "Every percent raises your army's power when you are attacked.",
  "משאבים לעדכון רגיל": "resources per regular update",
  "כל אחוז נקודות מגדיל את תפוקת המכרות. פרי שטן, מכנסיים ונעליים מוסיפים משאבים בכמות קבועה בכל עדכון רגיל; חרב ומגן מגדילים את תפוקת המכרות באחוזים.":
    "Every allocated point raises mine output. The demon fruit, the trousers and the boots add a flat amount of resources on every regular update; the sword and the buckler raise mine output by a percentage.",
  "כל אחוז מחפצים מגדיל את סיכוי הצלחת משימת הריגול שלך.":
    "Every percent from gear raises the chance your spy mission succeeds.",
  "תורות לעדכון יומי": "turns per daily update",
  "חפצים מוסיפים תורות בכמות קבועה בכל עדכון יומי (לא באחוזים).":
    "Gear adds a flat number of turns on every daily update — never a percentage.",
  "אזרחים לעדכון יומי": "citizens per daily update",
  "חפצים מוסיפים אזרחים בכמות קבועה בכל עדכון יומי (לא באחוזים).":
    "Gear adds a flat number of citizens on every daily update — never a percentage.",
  "תפוקת המכרות": "mine output",
  "{resource} לעדכון רגיל": "{resource} per regular update",
  "תפוקת משאבים": "Resource output",
  "ניסיון גיבור": "Hero XP",

  /* rarities */
  "פשוט": "Plain",
  "מתקדם": "Advanced",
  "אליט": "Elite",
  "אגדי": "Legendary",
  // Hebrew names the object then its grade; English the other way round.
  "{slot} {rarity}": "{rarity} {slot}",

  /* gear slots */
  "חרב": "Sword",
  "כפפות": "Gauntlets",
  "קסדה": "Helmet",
  "שריון": "Armour",
  "מגן": "Buckler",
  "פרי שטן": "Demon Fruit",
  "כנפיים": "Wings",
  "מכנסיים": "Trousers",
  "נעליים": "Boots",

  /* the four classes */
  "המצביא": "The Warlord",
  "כוח הוא הטיעון היחיד": "Power is the only argument",
  "מפקד קרבות מלידה — צבאותיו מכים חזק יותר בכל תקיפה.":
    "A born battle commander — his armies hit harder on every attack.",
  "המגן": "The Guardian",
  "החומה שלא נפלה מעולם": "The wall that never fell",
  "שומר הסף של האימפריה — הגנתו עומדת גם מול המתקפות הקשות.":
    "The empire's gatekeeper — his defence holds even against the hardest assault.",
  "הסוחר": "The Merchant",
  "כל מלחמה מתחילה באוצר": "Every war begins in the treasury",
  "אשף כלכלה ערמומי — המכרות שלו מפיקים יותר מכל אחד אחר.":
    "A cunning economist — his mines yield more than anyone else's.",
  "הצל": "The Shadow",
  "מה שלא רואים — מנצח": "What is not seen, wins",
  "מרגל־מתנקש הלומד מכל קרב — ריגול חד יותר וניסיון נצבר מהר.":
    "A spy-assassin who learns from every fight — sharper espionage, faster experience.",

  /* the ten gear sets */
  "מסע הנווד": "The Wanderer's Journey",
  "ברזל הלגיון": "Legion Iron",
  "פלדת האביר": "Knight's Steel",
  "כפור הספיר": "Sapphire Frost",
  "זהב המלוכה": "Royal Gold",
  "אובסידיאן הדם": "Blood Obsidian",
  "להט המאגמה": "Magma Fervour",
  "זעם הסערה": "Storm Wrath",
  "תהום האינסוף": "The Endless Abyss",
  "זוהר האלים": "Radiance of the Gods",

  /* ------------------------------------------------------------------ */
  /* hero quests — the expedition board                                  */
  /* ------------------------------------------------------------------ */
  "פשיטת הגבול": "Border Raid",
  "שיירת אספקה חוצה את קצה הנחלה בלי ליווי. הגיבור יוצא לבדו, חוזר לפני רדת הלילה.":
    "A supply train crosses the edge of your holding unescorted. The hero rides out alone and is back before nightfall.",
  "ליווי השיירה": "Caravan Escort",
  "סוחרים משלמים בזהב כדי שמישהו יצעד לצדם דרך המעבר. הגיבור לוקח את התשלום ואת מה שנופל בדרך.":
    "Merchants pay gold for someone to walk the pass beside them. The hero takes the fee — and whatever falls along the way.",
  "טיהור המאורה": "Clearing the Den",
  "מערה מתחת לגבעות שממנה יוצאים פושטים כל לילה. מי שנכנס פנימה חייב לצאת עם ראש.":
    "A cave under the hills that raiders pour out of every night. Whoever goes in must come out with a head.",
  "ציד ראשי השבט": "Chieftain Hunt",
  "שלושה ראשי שבט חולקים את הערבה ואת השלל שגנבו ממך. הגיבור יוצא לגבות חוב.":
    "Three chieftains share the steppe — and the plunder they took from you. The hero rides out to collect.",
  "מצור על מעוז הפורעים": "Siege of the Bandit Hold",
  "מבצר עץ על צוק, ובתוכו כל מה שנשדד מהאזור בעשור האחרון. מצור לוקח זמן.":
    "A timber fort on a cliff, holding everything looted from the region this decade. A siege takes time.",
  "חציית ארץ האפר": "Crossing the Ashlands",
  "אין שם דרך ואין שם מים — רק ערים שרופות שאיש לא בזז מאז שנפלו.":
    "No road and no water — only burned cities nobody has looted since they fell.",
  "שוד גנזך הנסיך": "The Prince's Vault",
  "נסיך גולה החביא את אוצרו מתחת לארמון נטוש. המפה עלתה לגיבור יותר ממה שהוא מודה.":
    "An exiled prince hid his treasury under an abandoned palace. The map cost the hero more than he admits.",
  "מסע אל ההרים השבורים": "Into the Broken Mountains",
  "מעברים שקפואים תשעה חודשים בשנה, ומנזר בפסגה ששומר על משהו ישן מהאימפריה.":
    "Passes frozen nine months of the year, and a monastery at the summit guarding something older than the empire.",
  "משלחת מעבר לים": "Expedition Overseas",
  "ספינה אחת, צוות ששכרת בנמל, ויבשת שאיש מאנשיך לא ראה. הוא יחזור — כנראה.":
    "One ship, a crew hired at the docks, and a continent none of your people has seen. He will be back — probably.",
  "עלייה למגדל הכתר השבור": "Ascent of the Broken Crown",
  "המגדל שממנו שלט הקיסר האפל הראשון. יממה שלמה של טיפוס, ובראשו כל מה שנשאר מקראלדור הישנה.":
    "The tower the first dark emperor ruled from. A full day of climbing, and at the top everything left of the old Kraldor.",

  /* how a quest turned out */
  "מסע קשה": "A Hard Road",
  "הדרך גבתה את שלה — הוא חוזר חבול ועם מעט מכפי שקיווה.":
    "The road took its due — he comes back bruised and with less than he hoped for.",
  "מסע כשורה": "A Journey as Planned",
  "בלי הפתעות. יצא, עשה את שלו, חזר עם מה שמגיע.":
    "No surprises. He went, did what he went to do, and came back with what was owed.",
  "מסע מוצלח": "A Good Journey",
  "הוא מצא יותר משציפה, וידע לקחת את הכול.":
    "He found more than he expected, and knew to take all of it.",
  "שלל אדיר": "A Mighty Haul",
  "עגלה שלמה נגררת אחריו, וחצי מהעיר יצאה לראות.":
    "A whole cart dragging behind him, and half the city came out to look.",
  "מסע אגדי": "A Legendary Journey",
  "על מסע כזה מספרים בטברנות שנים אחרי שהגיבור כבר איננו.":
    "They tell of a journey like this in taverns years after the hero is gone.",

  /* ------------------------------------------------------------------ */
  /* potions                                                             */
  /* ------------------------------------------------------------------ */
  "שיקוי הניסיון": "Potion of Experience",
  "פי 2 ניסיון גיבור בקרבות": "Double hero XP in battle",
  "כל עוד השיקוי פועל, כל נקודת ניסיון שהגיבור שלך מרוויח בקרב נספרת פעמיים — בתקיפות, בהגנות מוצלחות ובקרבות מול שליטי הערים.":
    "While it holds, every point of experience your hero earns in battle counts twice — attacking, defending successfully, and fighting a city ruler.",
  "שיקוי השפע": "Potion of Plenty",
  "פי 2 משאבים — ביזה ותפוקה": "Double resources — plunder and output",
  "כל עוד השיקוי פועל, הביזה שאתה לוקח מתקיפות מוצלחות מוכפלת, וגם המכרות שלך מייצרים כפול בכל עדכון רגיל.":
    "While it holds, the plunder you take from won attacks is doubled, and your mines also produce double on every regular update.",
  "שיקוי החסינות": "Potion of Immunity",
  "הגיבור לא סופג נזק": "Your hero takes no damage",
  "כל עוד השיקוי פועל, הגיבור שלך לא מאבד חיים — גם אם תוקף פורץ את ההגנה שלך, הוא יוצא מהקרב ללא שריטה. שאר הקרב (ביזה, שבויים) מתנהל כרגיל.":
    "While it holds, your hero loses no health — even if an attacker breaks through your defence, he walks away without a scratch. The rest of the battle (plunder, captives) plays out as usual.",
  "שיקוי הנפח": "Potion of the Smith",
  "50% הנחה על שדרוג חפצים": "50% off item upgrades",
  "כל עוד השיקוי פועל, כל שדרוג חפץ בתיק או על הגיבור עולה חצי מחיר — גם בשדרוג בודד וגם ב'שדרג הכל'.":
    "While it holds, upgrading any item — in the bag or on the hero — costs half price, both one at a time and with \"upgrade all\".",

  /* ------------------------------------------------------------------ */
  /* durations — Hebrew has a dual, so one/two/many are three sentences   */
  /* ------------------------------------------------------------------ */
  "רגע": "a moment",
  "דקה": "a minute",
  "שתי דקות": "two minutes",
  "{count} דקות": "{count} minutes",
  "שעה": "an hour",
  "חצי שעה": "half an hour",
  "שעתיים": "two hours",
  "{count} שעות": "{count} hours",
  "יום": "a day",
  "יומיים": "two days",
  "{count} ימים": "{count} days",

  /* ------------------------------------------------------------------ */
  /* the guild — roles, spells, the nightly war                          */
  /* ------------------------------------------------------------------ */
  "מנהיג": "Leader",
  "סגן": "Deputy",
  "חבר": "Member",
  "קסם התקפה": "Attack Spell",
  "מגביר את כוח ההתקפה שלך בקרבות.": "Raises your attack power in battle.",
  "+{pct}% לכוח ההתקפה למשך {hours} שעות":
    "+{pct}% attack power for {hours} hours",
  "קסם הגנה": "Defence Spell",
  "מגביר את כוח ההגנה שלך כשמתקיפים אותך.":
    "Raises your defence power when you are attacked.",
  "+{pct}% לכוח ההגנה למשך {hours} שעות":
    "+{pct}% defence power for {hours} hours",
  "קסם משאבים": "Resource Spell",
  "מאיץ את תפוקת המכרות של האימפריה שלך.":
    "Speeds up your empire's mine output.",
  "+{pct}% לתפוקת המכרות למשך {hours} שעות":
    "+{pct}% mine output for {hours} hours",
  "אלופת המלחמה": "War Champion",
  "סגנית האלופה": "Runner-Up",
  "{count} אזרחים": "{count} citizens",
  "{count} תורות": "{count} turns",
  "סיבוב גלגל אחד": "one wheel spin",
  "{count} סיבובי גלגל": "{count} wheel spins",
  "ההרשמה פתוחה": "Registration is open",
  "הקרב בעיצומו": "The battle is under way",
  "סופרים את הנקודות": "Counting the points",
  "המלחמה הוכרעה": "The war is decided",
  "המלחמה בוטלה": "The war was called off",

  /* ------------------------------------------------------------------ */
  /* power ledgers, mine output lines                                    */
  /* ------------------------------------------------------------------ */
  "בונוס גיבור": "Hero bonus",
  "קסם ברית": "Guild spell",
  "עזרת ברית": "Guild aid",
  "בונוס מגן": "Defender's bonus",
  "ערים — ×{cities}": "Cities — ×{cities}",
  "קסם גילדה — משאבים": "Guild spell — resources",
  "בוסט יהלומים": "Diamond boost",

  /* ------------------------------------------------------------------ */
  /* the diamond shop and store                                          */
  /* ------------------------------------------------------------------ */
  "מגן משאבים": "Resource Shield",
  "תוקף שמנצח אותך לא לוקח ולו משאב אחד — הזהב, העץ, הברזל והאבן שלך נשארים אצלך.":
    "An attacker who beats you takes not one resource — your gold, wood, iron and stone stay yours.",
  "מגן משאבים פעיל — לא ניתן לבזוז ממנו משאבים":
    "Resource shield active — nothing can be plundered from this empire",
  "מגן חיילים": "Soldier Shield",
  "תוקף שמנצח אותך לא משעבד אף חייל — הצבא שלך יוצא מהקרב בגודלו המלא.":
    "An attacker who beats you enslaves no soldier — your army leaves the battle at full strength.",
  "מגן חיילים פעיל — לא ניתן לשעבד את חייליו":
    "Soldier shield active — this empire's soldiers cannot be enslaved",
  "ניצוץ": "Spark",
  "פיקדון": "Deposit",
  "ארגז אוצר": "Treasure Chest",
  "כספת הקיסר": "The Emperor's Vault",
  "אוצר הכתר": "The Crown Hoard",

  /* ------------------------------------------------------------------ */
  /* season prizes, the wheel, mini-games                                */
  /* ------------------------------------------------------------------ */
  "מקום ראשון": "First place",
  "מקום שני": "Second place",
  "מקום שלישי": "Third place",
  "חפץ לגיבור": "Hero item",
  "דורש מקום פנוי בתיק הגיבור": "Needs a free slot in the hero's bag",
  "סיבובים": "Spins",
  "{amount} {resource}": "{amount} {resource}",
  "כבוד בלבד": "Honour only",
  "מצא את הכדור": "Find the Ball",
  "פריצת הכספת": "Crack the Safe",

  /* ------------------------------------------------------------------ */
  /* the VIP pass                                                        */
  /* ------------------------------------------------------------------ */
  "חותם המלוכה": "The Royal Seal",
  "הפעולה הזו נפתחת עם {vip} — לחיצה על הכפתור הנעול פותחת את הרכישה":
    "This action opens with {vip} — press the locked button to buy it",
  "נעול · נפתח עם {vip}": "Locked · opens with {vip}",
  "בנק · הפקד הכל · משוך הכל": "Bank · deposit all · withdraw all",
  "כל הזהב הזמין נכנס לחיסכון (או חוזר ממנו) בלי להקליד סכום.":
    "All your available gold goes into savings (or comes back out) without typing an amount.",
  "מחסנים · הפקד הכל · משוך הכל": "Warehouses · store all · take all",
  "כל מחסן מתמלא או מתרוקן בלחיצה, במקום הקלדת כמות בכל אחד מהארבעה.":
    "Each warehouse fills or empties in one press, instead of typing a quantity into all four.",
  "מכרות · הצב הכל · חלק שווה · שדרג למקסימום":
    "Mines · assign all · split evenly · upgrade to max",
  "כל עבדי המכרות למשאב אחד או בחלוקה שווה, ומכרה שעולה רמות עד שנגמר התקציב.":
    "Every mine slave onto one resource or split evenly, and a mine that climbs levels until the budget runs out.",
  "מפקדה בכל מסך": "A command post on every screen",
  "כפתור בסרגל העליון שפותח את כל הפעולות האלה מכל עמוד במשחק.":
    "A button in the top bar that opens all of these from any page in the game.",

  /* ------------------------------------------------------------------ */
  /* Happy Hour                                                          */
  /* ------------------------------------------------------------------ */
  "ניסיון בקרבות": "Battle experience",
  "כל נקודת ניסיון שהגיבור מרוויח בתקיפה, בהגנה ומול שליטי הערים":
    "Every point of experience your hero earns attacking, defending and fighting city rulers",
  "ביזה מאויבים ומבוסים": "Plunder from enemies and bosses",
  "ביזה": "Plunder",
  "המשאבים שאתה לוקח מאימפריה מובסת ומהשלל של שליט העיר":
    "The resources you take from a beaten empire and from a city ruler's hoard",
  "תפוקת מכרות": "Mine output",
  "מכרות": "Mines",
  "כל עדכון רגיל — המכרות שלך מייצרים בקצב המוגבר":
    "Every regular update — your mines produce at the raised rate",

  /* ------------------------------------------------------------------ */
  /* the boss duel — moves, stances, grades                              */
  /* ------------------------------------------------------------------ */
  "מחץ כבד": "Heavy Crush",
  "מרים את נשקו מעל הראש — מכה אחת, כל הכוח בה":
    "He raises his weapon overhead — one blow, all of his strength in it",
  "מכה אנכית הרסנית. חומת מגן בולמת אותה כמעט לגמרי.":
    "A devastating overhead strike. A shield wall stops almost all of it.",
  "סער סוחף": "Sweeping Storm",
  "פורש את זרועותיו לרוחב וסוחף את הקו כולו":
    "He spreads his arms wide and sweeps the whole line",
  "פוגע בכל השורה הצפופה. תמרון עוקף מפזר את הכוח מתחת למכה.":
    "It hits the entire packed rank. A flanking manoeuvre spreads your force out from under it.",
  "פרצה בהגנה": "An Opening",
  "מתנשם כבדות — ההגנה שלו נפערת לרגע":
    "He is breathing hard — his guard gapes open for a moment",
  "חלון ההזדמנות. הסתערות חזית מכפילה כאן את הנזק.":
    "The window. A frontal charge doubles your damage here.",
  "הסתערות חזית": "Frontal Charge",
  "נזק מקסימלי, חשוף למכות": "Maximum damage, wide open to blows",
  "חומת מגן": "Shield Wall",
  "אבדות מינימליות, נזק נמוך": "Minimal losses, low damage",
  "תמרון עוקף": "Flanking Manoeuvre",
  "מאוזן — טוב מול סער": "Balanced — good against the sweep",
  "זעם הגיבור": "The Hero's Fury",
  "מכת מחץ אחת, מתעלמת מהמהלך": "One crushing blow that ignores his move",
  "מושלם": "Flawless",
  "מצוין": "Excellent",
  "טוב": "Good",
  "מדשדש": "Scraping by",

  /* ------------------------------------------------------------------ */
  /* chat                                                                */
  /* ------------------------------------------------------------------ */
  "{name} מקליד…": "{name} is typing…",
  "{names} מקלידים…": "{names} are typing…",
  " ו": " and ",
  "{count} שחקנים מקלידים…": "{count} players are typing…",

  /* ------------------------------------------------------------------ */
  /* the bank                                                            */
  /* ------------------------------------------------------------------ */
  "בנק | קראלדור": "Bank | Kraldor",
  "תשואה": "Yield",
  "ריבית בעדכון היומי הבא": "Interest at the next daily update",
  "ריבית סופית:": "Final rate:",
  "הפקדות זמינות להיום:": "Deposits left today:",
  "העדכון היומי הבא:": "Next daily update:",
  "שדרוגי בנק": "Bank Upgrades",
  "עבור לשדרוגים": "Go to upgrades",
  "תנועות אחרונות": "Recent Movements",
  "אין עדיין תנועות בבנק.": "No bank movements yet.",
  "יתרה:": "Balance:",
  "הפקדה": "Deposit",
  "משיכה": "Withdrawal",
  "ריבית": "Interest",
  "הופקדו {amount} זהב בבנק": "Deposited {amount} gold at the bank",
  "נמשכו {amount} זהב מהבנק": "Withdrew {amount} gold from the bank",
  "ניצלת את כל ההפקדות הזמינות עד העדכון היומי הבא.":
    "You have used every deposit available until the next daily update.",
  "יש למשוך זהב מהמחסן לפני שניתן להפקיד אותו בבנק.":
    "Gold has to come out of the warehouse before it can be banked.",
  "אין מספיק זהב זמין להפקדה.": "You do not have enough available gold to deposit.",
  "אין מספיק זהב בבנק למשיכה.": "You do not have enough gold in the bank.",
  "אין זהב למשיכה מהבנק.": "There is no gold to withdraw.",

  /* ------------------------------------------------------------------ */
  /* empire upgrades screen                                              */
  /* ------------------------------------------------------------------ */
  "שדרוגים | קראלדור": "Upgrades | Kraldor",
  "כל עלייה בעיר מכפילה את תפוקת המכרות (×מספר העיר) ופותחת עוד רמות לשדרוג קבלת האזרחים — עד":
    "Every city you rise to multiplies mine output (× the city number) and unlocks more levels of citizen intake — up to",
  "תפוקה ברמת עיר {max}. אין תקרה לכמות האזרחים שאפשר לצבור.":
    "output at city {max}. There is no ceiling on how many citizens you may hold.",
  "הממלכה שלך": "Your Realm",
  "ערים": "Cities",
  "שדרוגי אימפריה קבועים שמשפרים אזרחים, מודיעין, בנקאות וקבלת תורות.":
    "Permanent empire upgrades improving citizens, intelligence, banking and turn income.",
  "כעת:": "Now:",
  "אחרי שדרוג:": "After upgrading:",
  "עלות שדרוג:": "Upgrade cost:",
  "אין מספיק מהמשאב הזה לשדרוג": "Not enough of this resource for the upgrade",
  "חסר: {amount}": "Short by {amount}",
  "חסר לשדרוג: {resources}": "Short for the upgrade: {resources}",
  "משדרג...": "Upgrading…",
  "שדרג לרמה {level}": "Upgrade to level {level}",

  /* guild shop card */
  "פעיל עד {time}": "Active until {time}",
  "מטיל קסם...": "Casting…",
  "הטל קסם": "Cast",
  "שדרג ל־{pct}%": "Upgrade to {pct}%",
  "עזרה מקסימלית ({max}%)": "Maximum aid ({max}%)",

  /* ------------------------------------------------------------------ */
  /* server actions — refusals, receipts and confirmations               */
  /* ------------------------------------------------------------------ */
  "בחירה לא תקינה": "That choice is not valid",
  "בקשה לא תקינה": "That request is not valid",
  "פריט לא תקין": "That item is not valid",
  "לא נבחרו פריטים": "No items selected",
  "חבר לא תקין": "That member is not valid",
  "ברית לא תקינה": "That guild is not valid",
  "קסם לא תקין": "That spell is not valid",
  "משאב לא תקין": "That resource is not valid",
  "מגן לא תקין": "That shield is not valid",
  "חבילה לא תקינה": "That package is not valid",
  "משך מגן לא תקין": "That shield duration is not valid",
  "משימה לא תקינה": "That quest is not valid",
  "שיקוי לא תקין": "That potion is not valid",
  "שם לא תקין": "That name is not valid",
  "שם ברית לא תקין": "That guild name is not valid",
  "שם הברית קצר מדי": "That guild name is too short",
  "שם הברית ארוך מדי": "That guild name is too long",
  "הזן שם אימפריה": "Enter an empire name",

  /* the hero */
  "הגיבור לא נמצא": "Hero not found",
  "אין לך גיבור": "You have no hero",
  "אין מספיק נקודות גיבור פנויות": "You do not have enough unspent hero points",
  "+{amount}% {stat} — הנקודות הוקצו!": "+{amount}% {stat} — points allocated.",
  "איפוס גיבור זמין רק ברמה {level}":
    "A hero reset is only available at level {level}",
  "הגיבור אופס! קיבלת {citizens} אזרחים, {turns} תורות ו-{points} נקודות גיבור":
    "Your hero has been reset. You received {citizens} citizens, {turns} turns and {points} hero points.",
  "הפריט לא נמצא בתיק שלך": "That item is not in your bag",
  "הפריטים לא נמצאו בתיק שלך": "Those items are not in your bag",
  "הפריט כבר לבוש": "That item is already equipped",
  "הפריט אינו לבוש": "That item is not equipped",
  "דרוש גיבור רמה {required} כדי ללבוש את הפריט (אתה ברמה {level})":
    "Wearing this needs a level {required} hero — yours is level {level}",
  "{item} נלבש!": "{item} equipped.",
  "{item} הוסר לתיק": "{item} went back into the bag",
  "התיק מלא — לא ניתן להסיר את הפריט": "Your bag is full — the item cannot come off",
  "{item} נזרק": "{item} discarded",
  "{item} נזרק — ומזל טוב! 🎡 זכית בסיבוב גלגל מזל!":
    "{item} discarded — and congratulations! 🎡 You won a wheel spin.",
  "{count} חפצים נזרקו": "{count} items discarded",
  "{count} חפצים נזרקו — ומזל טוב! 🎡 זכית ב-{spins} סיבובי גלגל מזל!":
    "{count} items discarded — and congratulations! 🎡 You won {spins} wheel spins.",
  "הפריט כבר ברמה הגבוהה ביותר": "That item is already at its highest level",
  'אגדי הוא שיא הסט "{set}" — הסט הבא מגיע כשלל בקרב':
    'Legendary is the ceiling of the "{set}" set — the next set arrives as battle plunder',
  "דרוש גיבור רמה {required} כדי לשדרג (אתה ברמה {level})":
    "Upgrading this needs a level {required} hero — yours is level {level}",
  "דרוש {cost} זהב לשדרוג (יש לך {gold})":
    "The upgrade costs {cost} gold — you have {gold}",
  "אין מספיק זהב לשדרוג": "You do not have enough gold for the upgrade",
  "{item} שודרג לרמה {level} ({rarity})!":
    "{item} upgraded to level {level} ({rarity}).",
  "אין פריטים לשדרוג מבין הנבחרים": "None of the selected items can be upgraded",
  "אין מספיק זהב — השדרוג הזול ביותר עולה {cost} זהב":
    "Not enough gold — the cheapest upgrade costs {cost} gold",
  " ({count} לא שודרגו — חסר זהב)": " ({count} left unupgraded — not enough gold)",
  "{count} חפצים שודרגו תמורת {gold} זהב{suffix}":
    "{count} items upgraded for {gold} gold{suffix}",
  "כבר אפסת נקודות גיבור העונה":
    "You have already reset your hero points this season",
  "אין נקודות מוקצות לאיפוס": "There are no allocated points to reset",
  "{count} נקודות גיבור שוחררו מחדש להקצאה!":
    "{count} hero points are yours to spend again.",
  "הגיבור בחיים — אין צורך בהחייאה": "Your hero is alive — no revival needed",
  "דרושים {cost} יהלומים להחייאת הגיבור":
    "Reviving your hero costs {cost} diamonds",
  "הגיבור קם לתחייה עם 100% חיים — כל הבונוסים שלו חזרו!":
    "Your hero is back at 100% health — every one of his bonuses is live again.",

  /* hero quests */
  "לוח המסעות סגור כרגע.": "The expedition board is closed right now.",
  '"{quest}" נפתחת עם העיר ה-{tier} שלך.':
    '"{quest}" opens with your city {tier}.',
  "הגיבור מת — אי אפשר לשלוח אותו למסע עד שיקום לתחייה.":
    "Your hero is dead — he cannot be sent out until he is raised.",
  "הגיבור כבר במסע — הוא יוצא רק לאחד בכל פעם.":
    "Your hero is already away — he only takes one expedition at a time.",
  'נדרשות {turns} תורות כדי לשלוח את הגיבור ל"{quest}".':
    'Sending your hero to "{quest}" costs {turns} turns.',
  'הגיבור יצא ל"{quest}". הוא יחזור בעוד {duration}.':
    'Your hero has set out for "{quest}". He will be back in {duration}.',
  "הגיבור אינו במסע.": "Your hero is not away.",
  "המסע": "the expedition",
  "{quest} עדיין בעיצומו.": "{quest} is still under way.",
  "המסע כבר נאסף.": "That expedition has already been collected.",
  '{fortune}! הגיבור חזר מ"{quest}" עם {spoils}. {lore}':
    '{fortune}! Your hero is back from "{quest}" with {spoils}. {lore}',

  /* potions */
  "אין לך {potion} בתרמיל": "You have no {potion} in your satchel",
  "{potion} הוארך ב־{duration} נוספות!": "{potion} extended by another {duration}.",
  "{potion} פועל! {tagline} למשך {duration}.":
    "{potion} is live. {tagline}, for {duration}.",

  /* the guild */
  "אינך חבר בברית.": "You are not in a guild.",
  "אתה כבר חבר בברית.": "You are already in a guild.",
  "אתה כבר מנהיג הברית.": "You are already the guild's leader.",
  "שם הברית כבר תפוס — בחר שם אחר.": "That guild name is taken — pick another.",
  "הקמת ברית עולה {cost} יהלומים — אין לך מספיק.":
    "Founding a guild costs {cost} diamonds — you do not have enough.",
  'הברית "{guild}" הוקמה — אתה המנהיג!':
    'The guild "{guild}" is founded — you are its leader.',
  "הברית לא נמצאה.": "That guild was not found.",
  'הצטרפות ל"{guild}" אפשרית רק בהזמנה — בקש ממנהיג הברית או מסגן להזמין אותך.':
    'Joining "{guild}" is by invitation only — ask its leader or a deputy to invite you.',
  'הצטרפת לברית "{guild}"!': 'You have joined "{guild}".',
  "הברית מלאה או שאירעה שגיאה — נסה שוב.":
    "The guild is full, or something went wrong — try again.",
  "ההזמנה נדחתה.": "Invitation declined.",
  'הברית "{guild}" פורקה.': 'The guild "{guild}" is disbanded.',
  'עזבת את הברית "{guild}".': 'You have left "{guild}".',
  "רק מנהיג או סגן יכולים לצרף שחקנים לברית.":
    "Only a leader or a deputy may recruit into the guild.",
  'לא נמצאה אימפריה בשם "{name}".': 'No empire named "{name}" was found.',
  "{name} כבר חבר בברית אחרת.": "{name} is already in another guild.",
  "הברית מלאה — הרחב את הקיבולת קודם.":
    "The guild is full — buy a seat first.",
  "נשלחה הזמנה ל{name} (תקפה {hours} שעות).":
    "Invitation sent to {name} — good for {hours} hours.",
  "לא ניתן להרחיק את עצמך — השתמש בעזיבת הברית.":
    "You cannot kick yourself — leave the guild instead.",
  "החבר לא נמצא בברית.": "That member is not in the guild.",
  "אין לך הרשאה להרחיק את החבר הזה.": "You may not kick that member.",
  "{name} הורחק מהברית.": "{name} has been removed from the guild.",
  "רק המנהיג יכול לשנות תפקידים.": "Only the leader may change roles.",
  "לא ניתן לשנות את התפקיד של עצמך.": "You cannot change your own role.",
  "{name} מונה לסגן.": "{name} is now a deputy.",
  "{name} הורד לחבר מן השורה.": "{name} is back to a plain member.",
  "רק המנהיג יכול להעביר את ההנהגה.": "Only the leader may hand over the crown.",
  "{name} הוא מנהיג הברית החדש.": "{name} is the guild's new leader.",
  "הקסם לא נמצא.": "That spell was not found.",
  "הקסם כבר ברמה המקסימלית ({max}%).":
    "That spell is already at its ceiling ({max}%).",
  "השדרוג עולה {cost} יהלומים — אין לך מספיק.":
    "The upgrade costs {cost} diamonds — you do not have enough.",
  "{spell} שודרג ל־{pct}% עבור כל הברית!":
    "{spell} raised to {pct}% for the whole guild.",
  "רק מנהיג או סגן יכולים להרחיב את הברית.":
    "Only a leader or a deputy may expand the guild.",
  "הברית כבר בקיבולת המקסימלית ({max} חברים).":
    "The guild is already at its maximum size ({max} members).",
  "ההרחבה עולה {cost} זהב מהזהב הזמין שלך — אין לך מספיק.":
    "The seat costs {cost} gold out of your own available gold — you do not have enough.",
  "הברית הורחבה ל־{max} חברים!": "The guild now seats {max} members.",
  "עזרת הברית כבר ברמה המקסימלית ({max}%).":
    "Guild aid is already at its ceiling ({max}%).",
  "השדרוג עולה {cost} זהב מהזהב הזמין שלך — אין לך מספיק.":
    "The upgrade costs {cost} gold out of your own available gold — you do not have enough.",
  "עזרת הברית שודרגה ל־{pct}% מהכוח הכולל של הברית!":
    "Guild aid raised to {pct}% of the guild's combined power.",
  "הקסם הזה כבר פעיל עליך.": "That spell is already on you.",
  "הקסם עולה {cost} יהלומים — אין לך מספיק.":
    "The cast costs {cost} diamonds — you do not have enough.",
  "{icon} {spell} הופעל — {effect}!": "{icon} {spell} is live — {effect}.",

  /* the guild war */
  "רק מנהיג או סגן יכולים לרשום את הברית למלחמה.":
    "Only a leader or a deputy may enter the guild in the war.",
  "הברית שלך כבר רשומה למלחמה הקרובה.":
    "Your guild is already entered in the next war.",
  "{guild} נרשמה למלחמת הבריתות! הקרב מתנהל אוטומטית בין {start} ל־{end} — אין מה לעשות חוץ מלצפות.":
    "{guild} is entered in the guild war. The battle runs itself between {start} and {end} — there is nothing to do but watch.",
  "רק מנהיג או סגן יכולים לבטל את ההרשמה.":
    "Only a leader or a deputy may withdraw the entry.",
  "הברית שלך לא רשומה למלחמה הקרובה.":
    "Your guild is not entered in the next war.",
  "ההרשמה למלחמה בוטלה.": "Your entry has been withdrawn.",

  /* the wheel */
  "אין סיבובים זמינים": "You have no spins left",
  "זכית ב־{amount} יהלומים!": "You won {amount} diamonds.",
  "זכית ב־{amount} זהב!": "You won {amount} gold.",
  "זכית ב־{amount} ברזל!": "You won {amount} iron.",
  "זכית ב־{amount} אבן!": "You won {amount} stone.",
  "זכית ב־{amount} עץ!": "You won {amount} wood.",
  "זכית ב־{amount} אזרחים!": "You won {amount} citizens.",
  "זכית ב־{item} לתיק הגיבור!": "You won {item} for your hero's bag.",
  "התיק מלא — קיבלת {amount} זהב במקום החפץ.":
    "Your bag is full — you were paid {amount} gold instead of the item.",
  "זכית בפרס!": "You won a prize.",

  /* mini-games */
  "אימפריה אלמונית": "An unknown empire",
  "במקום": "in place",
  "בקוד": "in the code",
  "בחוץ": "not in it",
  "{count} {mark}": "{count} {mark}",
  "🔐 {marks}": "🔐 {marks}",
  "בחר ניחוש תקין": "Pick a valid guess",
  "המשחק הסתיים": "The game is over",
  "חשבון הנהלה אינו משתתף במשחקי הצד":
    "A staff account does not play the side games",
  "כבר פתרת את המשחק 🎉": "You have already solved it 🎉",
  "נגמרו הניסיונות": "You are out of attempts",
  "🫙 הכוס ריקה…": "🫙 The cup is empty…",
  "😔 נגמרו הניסיונות — נסה בפעם הבאה":
    "😔 Out of attempts — better luck next time",
  "✅ ניחשת נכון! אך כל הפרסים כבר חולקו":
    "✅ Correct — but every prize has already gone",
  "🎉 ניצחת! הפרס בדרך: {prize}": "🎉 You won! The prize is on its way: {prize}",
  '🎉 ניצחת ב"{game}"!': '🎉 You won "{game}"!',
  "כל הכבוד! זכית בפרס: {prize}": "Well played — your prize: {prize}",

  /* chat and mail */
  "לאט יותר — המתן רגע לפני ההודעה הבאה":
    "Slow down — wait a moment before the next message",
  "כתוב הודעה (עד {max} תווים)": "Write a message (up to {max} characters)",
  "אי אפשר לשלוח הודעה לעצמך": "You cannot message yourself",
  "השחקן לא נמצא": "That player was not found",
  "שלחת יותר מדי הודעות — המתן דקה":
    "You have sent too many messages — wait a minute",
  "יותר מדי הודעות בשיחה הזו — המתן דקה":
    "Too many messages in this thread — wait a minute",
  "כבר כתבת את זה": "You have already said that",
  "אין הרשאה": "Not permitted",
  "ההודעה כבר הוסרה": "That message is already hidden",
  "שלחת יותר מדי הודעות — נסה שוב בעוד כמה דקות":
    "You have sent too many messages — try again in a few minutes",
  "בחר עד {recipients} נמענים ומלא נושא (עד {title} תווים) ותוכן (עד {body} תווים)":
    "Pick up to {recipients} recipients and fill in a subject (up to {title} characters) and a body (up to {body} characters)",
  "לא נבחרו נמענים תקינים": "No valid recipients were selected",
  "שלחת הודעות ליותר מדי שחקנים בזמן קצר — נסה שוב בעוד כמה דקות":
    "You have written to too many players too quickly — try again in a few minutes",
  "שלחת לאחרונה כמה הודעות אל {name} — המתן לפני שתשלח שוב":
    "You have written to {name} several times recently — wait before writing again",
  "שלחת לאחרונה כמה הודעות אל השחקנים האלה — המתן לפני שתשלח שוב":
    "You have written to these players several times recently — wait before writing again",
  " (לא נשלחה אל {names} — יותר מדי הודעות אליהם לאחרונה)":
    " (not sent to {names} — too much mail to them recently)",
  "ההודעה נשלחה אל {name}": "Message sent to {name}",
  "ההודעה נשלחה אל {count} שחקנים": "Message sent to {count} players",

  /* the diamond shop and the store */
  "אין מספיק יהלומים": "You do not have enough diamonds",
  "הבונוס כבר בתקרה (+{max}%)": "The boost is already at its ceiling (+{max}%)",
  "בונוס תפוקה עלה ל־+{pct}% ל־24 שעות!":
    "Output boost raised to +{pct}% for 24 hours.",
  "ההנחה כבר פעילה": "The discount is already running",
  "הנחת {pct}% על נשק ושדרוגים פעילה ל־24 שעות!":
    "{pct}% off weapons and upgrades, for 24 hours.",
  "{shield} עדיין פעיל — ניתן לרכוש מחדש רק {minutes} דקות אחרי שיסתיים":
    "{shield} is still up — it can only be bought again {minutes} minutes after it ends",
  "{shield} בקירור — ניתן לחדש בעוד כ־{minutes} דקות":
    "{shield} is cooling down — renewable in about {minutes} minutes",
  "{shield} פעיל ל־{hours} השעות הבאות!": "{shield} is up for the next {hours} hours.",
  "כ־{count} שעות": "about {count} hours",
  "כ־{count} דקות": "about {count} minutes",
  "החבילה בקירור — זמינה בעוד {wait}": "The pack is cooling down — back in {wait}",
  "נוספו {turns} תורות!": "{turns} turns added.",
  "הקסם בקירור — זמין בעוד כ־{minutes} דקות":
    "The spell is cooling down — ready in about {minutes} minutes",
  "אין יתרה בבנק לצבירת ריבית": "There is no bank balance to pay interest on",
  "הריבית הנוכחית אפסית": "Your current interest rate is zero",
  "נצברה ריבית של {gold} זהב לבנק!": "{gold} gold in interest paid into the bank.",
  "הקסם זמין רק מעיר {min} ומעלה — אין עיר לוותר עליה":
    "The spell only works from city {min} upward — there is no city to give up",
  "דרושים {cost} יהלומים להטלת הקסם": "Casting it costs {cost} diamonds",
  " הקסם יהיה זמין שוב בעוד {hours} שעה.": " The spell is available again in {hours} hour.",
  "ירדת ל{city}.{tail}": "You have dropped to {city}.{tail}",
  "יש להתחבר כדי לרכוש": "You have to be signed in to buy",
  "החשבון חסום": "This account is suspended",
  "יש לאמת את כתובת האימייל לפני רכישה":
    "Your email address has to be verified before you can buy",
  "יותר מדי נסיונות רכישה. נסה שוב מאוחר יותר.":
    "Too many purchase attempts. Try again later.",
  "לא נמצאה אימפריה": "No empire found",
  "רכישות יהלומים ייפתחו ברגע שנחבר את מערכת התשלומים. תודה על הסבלנות!":
    "Diamond purchases open the moment the payment system is connected. Thanks for your patience.",
  "יש להשלים את התשלום בעמוד הסליקה. רענן את הדף ונסה שוב.":
    "The payment has to be completed on the checkout page. Refresh and try again.",
  "התשלום נכשל — לא חויבת. נסה שוב.":
    "The payment failed — you were not charged. Try again.",
  "רכישת בדיקה: נזקפו {diamonds} יהלומים.":
    "Test purchase: {diamonds} diamonds credited.",
  "נזקפו {diamonds} יהלומים לחשבונך!": "{diamonds} diamonds credited to your account.",
  "יש להזין שם פרטי ושם משפחה": "Enter a first name and a surname",
  "מספר טלפון נייד לא תקין (למשל 0501234567)":
    "That mobile number is not valid (for example 0501234567)",
  "אמצעי התשלום השתנה. רענן את הדף ונסה שוב.":
    "The payment method has changed. Refresh and try again.",
  "לא הצלחנו לפתוח את עמוד התשלום. נסה שוב.":
    "We could not open the payment page. Try again.",
  "התשלום לא הושלם. אם חויבת, פנה לתמיכה ונטפל בזה.":
    "The payment did not go through. If you were charged, contact support and we will sort it out.",

  /* the season pass */
  "כבר רכשת את מסלול הפרימיום לעונה הזו":
    "You have already bought the premium track this season",
  "מסלול הפרימיום נפתח לכל העונה! 👑":
    "The premium track is open for the whole season. 👑",
  "אין מספיק יהלומים (דרושים {cost})":
    "You do not have enough diamonds ({cost} needed)",
  "עדיין לא הגעת לאף דרגה במחזור הזה":
    "You have not reached a single tier this cycle yet",
  "אין תגמולים חדשים לאיסוף": "There are no new rewards to collect",
  "נאספו: {haul}": "Collected: {haul}",
  "{resource} {amount}": "{amount} {resource}",

  /* the city boss */
  "בוס העיר אינו זמין כרגע.": "The city ruler is not available right now.",
  "{boss} מת — הוא קם לתחייה ב־{time}.": "{boss} is dead — he rises again at {time}.",
  "נדרשות {turns} תורות כדי לצאת לקרב מול {boss}.":
    "Marching on {boss} costs {turns} turns.",
  "👑 {boss} הופל!": "👑 {boss} has fallen!",
  "💥 הצבא נשבר מול {boss}": "💥 Your army broke against {boss}",
  "⚔️ הקרב מול {boss} נסגר": "⚔️ The fight against {boss} is closed",
  "🩸 {boss} נפצע אבל שרד": "🩸 {boss} is wounded but survived",
  "{count} עבדים": "{count} slaves",
  "{amount} ניסיון לגיבור": "{amount} hero experience",
  "שלל: {spoils}.": "Spoils: {spoils}.",
  "בלי שלל.": "No spoils.",
  " אבדות: {count} חיילים.": " Losses: {count} soldiers.",
  " נותרו לו {hp} חיים.": " He has {hp} health left.",
  "{haul}{cost} הבוס יקום לתחייה בעוד שעה.":
    "{haul}{cost} He rises again in an hour.",
  "הקו נשבר והצבא נסוג מוקדם.{left} {haul}{cost}":
    "The line broke and your army pulled back early.{left} {haul}{cost}",
  "הקרב נסגר לפני שהוכרע. {haul}{cost}":
    "The fight closed before it was decided. {haul}{cost}",
  "{boss} עוד עומד.{left} {haul}{cost} צא שוב וסיים את העבודה.":
    "{boss} is still standing.{left} {haul}{cost} March again and finish the job.",
  "מצור על {boss}": "The siege of {boss}",

  /* the VIP pass */
  "{vip} כבר ברשותך": "You already hold {vip}",
  "דרושים {cost} יהלומים לרכישת {vip}": "{vip} costs {cost} diamonds",
  "{vip} שלך! הפעולות המהירות פתוחות מעכשיו מכל מסך במשחק.":
    "{vip} is yours. The quick actions are open from every screen in the game.",
  "שדרג ל־{vip}": "Upgrade to {vip}",
  "״{action}״ נפתח עם {vip}": "“{action}” opens with {vip}",
  "רכישה חד־פעמית שפותחת את כפתורי ״הכל״ שכבר קיימים במשחק. חיסכון בלחיצות בלבד — כל מה שהם עושים אפשר לעשות גם בלעדיהם, ידנית.":
    "A one-off purchase that unlocks the “do it to everything” buttons the game already has. It buys presses, nothing else — every one of those states is reachable by hand without it.",
  "רוכש...": "Buying…",
  "אין מספיק יהלומים? לרכישת יהלומים": "Short on diamonds? Buy some",

  /* profile, community, bans */
  "ערכת את התיאור יותר מדי פעמים — נסה שוב בעוד כמה דקות":
    "You have edited your blurb too many times — try again in a few minutes",
  "התיאור נמחק": "Your blurb has been cleared",
  "התיאור נשמר": "Your blurb has been saved",
  "ערוץ הקהילה עדיין לא נפתח": "The community channel is not open yet",
  "כבר אספת את המתנה הזו": "You have already collected this gift",
  "האימפריה לא נמצאה": "That empire was not found",
  "האימפריה הזו שייכת להנהלת המשחק — לא ניתן לתקוף או לרגל אותה.":
    "This empire belongs to the game's staff — it cannot be attacked or spied on.",
  "החשבון נחסם על ידי ההנהלה": "This account has been suspended by the staff",
  "החשבון נחסם על ידי ההנהלה עד {until}":
    "This account is suspended by the staff until {until}",

  /* cities */
  "{city} ({tier})": "{city} ({tier})",
  "{city} · {epithet}": "{city} · {epithet}",

  /* ------------------------------------------------------------------ */
  /* the verification email and the pages either side of it              */
  /* ------------------------------------------------------------------ */
  "אימות אימייל | קראלדור": "Verify your email | Kraldor",
  "אימות כתובת האימייל שלך בקראלדור": "Verify your email address for Kraldor",
  "שלום {name},\n\nכדי להפעיל את החשבון שלך בקראלדור, פתח את הקישור:\n{link}\n\nהקישור תקף ל-24 שעות. אם לא נרשמת, אפשר להתעלם מההודעה.":
    "Hello {name},\n\nTo activate your Kraldor account, open this link:\n{link}\n\nThe link is good for 24 hours. If you did not sign up, you can ignore this message.",
  "ברוך הבא לקראלדור, {name}": "Welcome to Kraldor, {name}",
  "כדי להפעיל את החשבון ולהתחיל לשחק, אשר את כתובת האימייל שלך:":
    "To activate your account and start playing, confirm your email address:",
  "אימות האימייל": "Verify email",
  "הקישור תקף ל-24 שעות. אם לא נרשמת לקראלדור, אפשר להתעלם מההודעה.":
    "The link is good for 24 hours. If you did not sign up for Kraldor, you can ignore this message.",
  "האימייל אומת": "Email verified",
  "החשבון שלך פעיל. אפשר להיכנס ולהתחיל לבנות.":
    "Your account is live. Sign in and start building.",
  "כניסה למשחק": "Enter the game",
  "האימות נכשל": "Verification failed",
  "אמת את האימייל שלך": "Verify your email",
  "שלחנו קישור אימות אל": "We have sent a verification link to",
  ". פתח אותו כדי להפעיל את החשבון. הקישור תקף ל-24 שעות.":
    ". Open it to activate your account. The link is good for 24 hours.",
  "לא רואה את המייל? בדוק בתיקיית הספאם.":
    "Cannot see it? Check your spam folder.",
  "אם אינך מחובר,": "If you are not signed in,",
  "התחבר תחילה": "sign in first",
  "ואז בקש קישור חדש.": "and then ask for a new link.",
  "הקמת אימפריה | קראלדור": "Found your empire | Kraldor",
  "הרשמה | קראלדור": "Sign up | Kraldor",

  /* ------------------------------------------------------------------ */
  /* screens: army, achievements, settings, production, storage, reports */
  /* ------------------------------------------------------------------ */
  "צבא | קראלדור": "Army | Kraldor",
  "אימון מגויסים": "Training Recruits",
  "אזרחים פנויים": "Citizens free",
  "הישגים | KRALDOR": "Achievements | KRALDOR",
  "היכל הפרסים": "The Trophy Hall",
  "פרסים מחכים על המדף": "rewards waiting on the shelf",
  "הישגים בהיכל — אין מה לאסוף כרגע":
    "achievements in the hall — nothing to collect right now",
  "הגדרות | קראלדור": "Settings | Kraldor",
  "שם האימפריה": "Empire name",
  "פרטי חשבון": "Account details",
  "שם": "Name",
  "האימפריה נוסדה": "Empire founded",
  "התנתקות מהחשבון במכשיר הזה. ההתקדמות שלך נשמרת.":
    "Sign out of this device. Your progress is kept.",
  "התנתק מהמשחק": "Sign out",
  "ייצור | קראלדור": "Production | Kraldor",
  'סה"כ עבדי מכרות': "Mine slaves in total",
  "עבדי מכרות מוצבים": "Slaves assigned",
  "עבדי מכרות פנויים": "Slaves free",
  "מפעלים ותעשייה": "Works and Industry",
  "מחסנים | קראלדור": "Warehouses | Kraldor",
  "משאבים מאוחסנים": "Resources stored",
  "קיבולת כוללת": "Total capacity",
  "ניצול כולל": "Overall use",
  "מערך המחסנים": "The Warehouse Yard",
  "ניצול כולל של המערך": "Overall use of the yard",
  "המחסן מגן רק על משאבים שהפקדת אליו. משאבים זמינים אינם מוגנים ויכולים להיגנב בתקיפה.":
    "A warehouse only protects what you put into it. Available resources are unprotected and can be stolen in an attack.",
  "דוחות | קראלדור": "Reports | Kraldor",
  "שולחן המבצעים": "The Dispatch Desk",
  "דוחות קרב": "Battle reports",
  "משימות ריגול": "Spy missions",
  "מאז ביקורך האחרון": "Since your last visit",
  "יהלומים | KRALDOR": "Diamonds | KRALDOR",
  "הוצא יהלומים על האצות ייצור, מגני תקיפה, חבילות תורות וקסמים — כל רכישה משפיעה מיידית על האימפריה.":
    "Spend diamonds on output boosts, raid shields, turn packs and spells — every purchase lands on your empire at once.",
  "כל הפריטים | KRALDOR": "All items | KRALDOR",
  "כל הפריטים": "All items",
  "חזרה לגיבור": "Back to the hero",
  "קרב בוס | KRALDOR": "Boss fight | KRALDOR",
  "חזרה לדירוג": "Back to the rankings",
  "סגור": "Close",
  "סגירה": "Close",

  /* ------------------------------------------------------------------ */
  /* the expedition board — מסעות הגיבור                                 */
  /* ------------------------------------------------------------------ */
  "הגיבור יוצא למסע אחד בכל פעם. כל עיר שאתה מקים פותחת מסע ארוך יותר — והשלל של כל המסעות גדל עם מספר הערים שלך ועם התקדמות העונה.":
    "Your hero walks one road at a time. Every city you found opens a longer one — and the haul of every expedition grows with the number of cities you hold and with the season's progress.",
  "נפתחו {open} מתוך {total}": "{open} of {total} unlocked",
  "אף אחד לא יודע מה יחזור מהדרך.": "Nobody knows what comes back down the road.",
  "כל מסע מגלגל את מזלו שלו — לפעמים הגיבור חוזר חבול ועם מעט, ולפעמים נגררת אחריו עגלה שלמה. מה שכן בטוח: השלל גדל עם מספר הערים שלך ועם התקדמות העונה, וכל מסע משלם אותו ממוצע":
    "Every run rolls its own fortune — sometimes the hero limps home with scraps, sometimes a whole wagon follows him in. What is certain: the haul grows with the number of cities you hold and with the season's progress, and every expedition pays the same average",
  "לכל שעה": "per hour",
  ". המסעות הארוכים קונים מחיר תורות נמוך יותר לשעה וסיכויי שלל גבוהים בהרבה; הקצרים קונים חפצים לשעה ואת החופש להגיב. הגיבור ממשיך להעניק את כל הבונוסים שלו גם בזמן שהוא בדרכים.":
    ". The long roads buy a lower turn price per hour and far better loot odds; the short ones buy items per hour and the freedom to react. The hero keeps granting every one of his bonuses while he is away.",
  "חזר!": "Home!",
  "לחץ כדי לראות מה הוא הביא — השלל, המזל שליווה אותו, וכל מה שנפל בדרך.":
    "Tap to see what he brought — the haul, the fortune that rode with him, and everything picked up along the way.",
  "השלל נקבע ברגע שהוא יצא לדרך, אבל אף אחד בעיר עוד לא יודע מה יש בשק. הוא ייספר כשיחזור.":
    "The haul was settled the moment he left, but nobody in the city knows yet what is in the sack. It gets counted when he walks back in.",
  "אוסף…": "Collecting…",
  "קבל את פני הגיבור ואסוף את השלל": "Welcome the hero home and take the haul",
  "הגיבור בדרכים…": "The hero is on the road…",
  "הגיבור חזר מ”{quest}”": "The hero is back from “{quest}”",
  "סגור את סיכום המסע": "Dismiss the expedition summary",
  "הגיבור עלה {count} דרגות!": "The hero gained {count} levels!",
  "הגיבור עלה דרגה!": "The hero gained a level!",
  "נמצא בדרך:": "Found on the road:",
  "מחכה בתרמיל": "waiting in the pack",
  "נפתח עם העיר ה-{tier}": "Unlocks with city {tier}",
  "הגיבור כבר במסע": "The hero is already away",
  "חסרות {turns} תורות": "{turns} turns short",
  "{quest} — מסע נעול": "{quest} — expedition locked",
  "השלל של המסע הזה לא ידוע מראש: כל יציאה מגלגלת את מזלה שלה — לפעמים מעט, לפעמים עגלה שלמה. הגודל הממוצע נגזר ממספר הערים שלך ומיום העונה, ואותו לכל שעת מסע בכל הדרגות.":
    "This expedition's haul is not known in advance: every departure rolls its own fortune — sometimes scraps, sometimes a full wagon. The average size follows the number of cities you hold and the day of the season, and it is the same per hour on the road at every rung.",
  "סיכוי לחפץ גיבור בסיום המסע: {item}% · סיכוי לשיקוי: {potion}% — שתי הגרלות נפרדות, ומסע יכול להחזיר את שניהם.":
    "Chance of a hero item at the end of the road: {item}% · chance of a potion: {potion}% — two separate draws, and one expedition can bring back both.",
  "עלות שליחה: {cost} תורות — {perHour} לכל שעת מסע.":
    "Cost to send: {cost} turns — {perHour} per hour on the road.",
  "שלח למסע": "Send out",
  "מחכה בשער": "waiting at the gate",
  "שלל לא ידוע": "haul unknown",
  "ניסיון לגיבור — הדבר היחיד במסע שידוע מראש: הוא נקבע לפי דרגת המסע בלבד ולא מושפע ממזל.":
    "Hero experience — the one thing about an expedition that is known in advance: it follows the rung alone and no roll of fortune touches it.",
  "מסעות הגיבור": "The Hero's Expeditions",
  "הגיבור מת": "Your hero is dead",

  /* ------------------------------------------------------------------ */
  /* founding the next city                                             */
  /* ------------------------------------------------------------------ */
  "עליית עיר": "Rise a City",
  "(מתוך {max} ערים)": "(of {max} cities)",
  "הגעת ל־": "You have reached ",
  "— העיר האחרונה. תפוקת המכרות ורמות קבלת האזרחים שלך במקסימום.":
    "— the last city. Your mine output and your citizen-intake levels are both maxed out.",
  "עליית עיר מכפילה את תפוקת המכרות ל־": "Rising a city multiplies mine output to ",
  "ופותחת עוד {levels} רמות לשדרוג קבלת האזרחים.":
    "and opens {levels} more levels of the citizen-intake upgrade.",
  "דרישות (אינן נצרכות):": "Requirements (nothing is spent):",
  "גיבור רמה {required} (כעת {level})": "Level {required} hero (yours is {level})",
  "{count} חיילים בצבא": "{count} soldiers in the army",
  "עלות עלייה (נצרכת):": "Cost to rise (spent):",
  "אין מספיק מהמשאב הזה": "Not enough of this resource",
  "מעלה עיר...": "Rising…",
  "עלה עיר": "Rise a city",
  "ערים · תפוקת מכרות": "cities · mine output",
  "הממלכה שלך — {cities} ערים מתוך {max}, ומושבך ב{city}":
    "Your realm — {cities} of {max} cities, seated in {city}",
  "{city} — ריגול ותקיפה אפשריים רק בתוך העיר שלך.":
    "{city} — you can only spy on and attack empires inside your own city.",

  /* ------------------------------------------------------------------ */
  /* the city boss, as it sits above the ladder                          */
  /* ------------------------------------------------------------------ */
  "{boss} מת — הוא קם לתחייה בעוד רגע": "{boss} is dead — he rises again shortly",
  "הקרב הנוכחי עוד רץ": "The current battle is still running",
  "חסרות לך {turns} תורות": "You are {turns} turns short",
  "אין לך צבא — אמן חיילים קודם": "You have no army — train soldiers first",
  "הפלת את {boss} {count} פעמים בעיר הזו.":
    "You have brought {boss} down {count} times in this city.",
  "{boss} שולט ב{city}.": "{boss} rules {city}.",
  "עיר {city}": "{city}",
  "{boss} הופל": "{boss} has fallen",
  "— קם לתחייה בעוד": "— rises again in",
  "חיי הבוס": "Boss health",
  "פצוע ב־{pct}% מתקיפה אחת — הפצעים נשארים עד שהוא נופל":
    "Wounded {pct}% by one assault — the wounds stay until he falls",
  "פצוע ב־{pct}% מ־{sorties} תקיפות — הפצעים נשארים עד שהוא נופל":
    "Wounded {pct}% across {sorties} assaults — the wounds stay until he falls",
  "{boss} יושב על": "{boss} is sitting on",
  "ציוד מובטח": "Gear guaranteed",
  "{chip}% מהאוצר מתחלק לפי הנזק שאתה גורם — משולם על כל תקיפה, גם כזו שלא הפילה אותו. את השאר ({kill}%, והציוד) לוקח מי שמפיל אותו.":
    "{chip}% of the hoard is split by the damage you deal — paid out on every assault, even one that did not finish him. The rest ({kill}%, and the gear) goes to whoever brings him down.",
  "תקיפה אחת תוריד לו": "One assault takes off",
  "ותכניס לך מהאוצר": "and takes out of the hoard",
  "ותעלה לך": "and costs you",
  "{boss} עדיין חזק ממך.": "{boss} is still stronger than you.",
  "בקצב הזה צריך כ־{sorties} תקיפות כדי להפיל אותו, וכל אחת עולה {turns} תורות":
    "At this rate it takes about {sorties} assaults to bring him down, and each one costs {turns} turns",
  " ובערך {soldiers} חיילים": " and roughly {soldiers} soldiers",
  ". השלל הגדול ({share}% ממנו + הציוד) משולם רק בהפלה — עדיף לגדל צבא ולהעלות את הגיבור, ואז לתקוף.":
    ". The big haul ({share}% of it, plus the gear) is only paid on the kill — grow the army and level the hero first, then march.",
  "הקרב רץ — צפה בו": "The battle is running — watch it",
  "תקיפה עולה {cost} תורות ורצה כדקה. הצבא נלחם לבד {rounds} סבבים — תקבל הודעה עם השלל כשהקרב נגמר, גם אם עברת לדף אחר.":
    "An assault costs {cost} turns and runs about a minute. The army fights {rounds} rounds on its own — you get a message with the haul when it ends, even if you have moved on to another page.",
  "איך הקרב עובד, איך מתחלק האוצר, וסיפור הרקע":
    "How the fight works, how the hoard is split, and the lore",
  "מפילי {boss}": "Those who felled {boss}",
  "איך הקרב עובד": "How the fight works",
  "לוחצים תקיפה פעם אחת. הצבא יוצא ל־{rounds} סבבים לאורך כדקה, ובכל סבב הקצינים מנסים לקרוא את המהלך של {boss} ולענות עליו. קריאה נכונה מכפילה את הנזק":
    "You press attack once. The army marches out for {rounds} rounds over about a minute, and in each one the officers try to read {boss}'s move and answer it. A correct read doubles the damage",
  " ומבטלת כמעט את האבדות": " and all but cancels the losses",
  "; קריאה שגויה עושה את ההפוך. הסיכוי לקרוא נכון תלוי":
    "; a wrong read does the opposite. The odds of reading right depend on",
  "ברמת הגיבור שלך": "your hero's level",
  "כרגע": "right now",
  "אבדות של {pct}% מבריחות את הצבא באמצע הקרב.":
    "Losses of {pct}% rout the army mid-battle.",
  "הקרב לא עולה לך אף חייל — הצבא חוזר שלם תמיד, והמחיר היחיד הוא התורות.":
    "The fight costs you no soldiers at all — the army always comes home whole, and the only price is the turns.",
  "תקיפה אחת שלך מורידה בממוצע {damage} חיים —":
    "One of your assaults takes an average of {damage} health off him —",
  "אמן צבא כדי להתחיל": "train an army to get started",
  "תקיפה אחת להפלה": "one assault to bring him down",
  "כ־{sorties} תקיפות להפלה": "about {sorties} assaults to bring him down",
  ". כוח הבוס {bossPower} מול כוח התקיפה שלך {myPower}.":
    ". His power is {bossPower} against your attack power of {myPower}.",
  "איך מגדילים את הסיכויים": "How to improve your odds",
  "כדי לפגוע בו יותר — כוח תקיפה": "To hit him harder — attack power",
  "(חיילים": "(soldiers",
  "+ נשקי תקיפה": "+ attack weapons",
  ") × גיבור": ") × hero",
  "× גילדה": "× guild",
  "+ סיוע": "+ aid",
  "הנזק בכל סבב הוא אחוז מהכוח הזה — כל 100 חיילים מוסיפים 1,000 כוח, ונשקי תקיפה מוסיפים כוח":
    "Each round's damage is a percentage of that power — every 100 soldiers add 1,000 power, and attack weapons add power",
  " בלי לעלות בדם": " without costing blood",
  " בלי לאמן אף חייל": " without training a single soldier",
  ". שיקוי כוח, באפ גילדה וציוד גיבור נספרים גם הם.":
    ". A power potion, the guild buff and hero gear all count too.",
  "כדי לספוג פחות — הגיבור": "To take less — the hero",
  "כדי לפגוע בכל סבב — הגיבור": "To land every round — the hero",
  "אבדות נקבעות רק לפי אם הקצינים קראו את המהלך נכון. גיבור רמה":
    "Losses come down to one thing: whether the officers read the move right. A level",
  "כמה נזק ייצא מהסבב נקבע לפי אם הקצינים קראו את המהלך נכון. גיבור רמה":
    "How much damage a round lands comes down to whether the officers read the move right. A level",
  "קורא נכון": "hero reads",
  "מהמהלכים": "of the moves correctly",
  ", וסבב שנקרא נכון עולה כשליש מהדם של סבב שגוי — ומכפיל את הנזק.":
    ", and a round read right costs about a third of the blood of one read wrong — and doubles the damage.",
  ", וסבב שנקרא נכון מכפיל את הנזק מול סבב שנקרא לא נכון.":
    ", and a round read right does double the damage of one read wrong.",
  "הגיבור שלך מת — הקצינים מנחשים ואין זעם":
    "Your hero is dead — the officers are guessing and there is no fury",
  ", והאבדות כמעט מוכפלות": ", and the losses nearly double",
  ". החייה אותו לפני שתתקוף.": ". Raise him before you march.",
  "כל רמה מוסיפה לסיכוי הקריאה (עד {max}%) ומחזקת את מכת הזעם. גיבור מת מאבד את שניהם.":
    "Every level adds to the read chance (up to {max}%) and sharpens the fury blow. A dead hero loses both.",
  "איך מתחלק האוצר": "How the hoard is split",
  "שבויים ששוחררו ממכלאות הבוס — מצטרפים למאגר עבדי המכרות הפנוי שלך.":
    "Captives freed from the boss's pens — they join your pool of free mine slaves.",
  "עבדים": "slaves",
  "הבוס תמיד מפיל ציוד גיבור — ולעולם לא ציוד פשוט. דירוג קרב מושלם (S) מעלה את הרצפה בדרגה.":
    "The boss always drops hero gear — and never common gear. A perfect battle grade (S) raises the floor by one rarity.",
  "{chip}% מהשלל משולם לפי הנזק שאתה מספיק לגרום — גם בתקיפה שלא הפילה אותו. השאר ({kill}%) הוא אוצר ההפלה, שגדל עד ×{grade} בקרב מושלם. השלל גדל עם התקדמות העונה ועם מספר הערים שלך.":
    "{chip}% of the haul is paid out for the damage you manage to land — even on an assault that did not finish him. The rest ({kill}%) is the kill treasure, which grows up to ×{grade} in a perfect battle. The haul grows with the season's progress and with the number of cities you hold.",

  /* ------------------------------------------------------------------ */
  /* the diamond shop                                                    */
  /* ------------------------------------------------------------------ */
  "בונוס תפוקת משאבים": "Resource output boost",
  "עד +{max}% לכל משאב · 24ש׳": "up to +{max}% per resource · 24h",
  "תוספת {resource}": "{resource} boost",
  "כל רכישה +{step}% לתפוקה · עד +{max}% · 24ש׳":
    "each purchase is +{step}% output · up to +{max}% · 24h",
  "בתקרה (+{max}%)": "At the cap (+{max}%)",
  "✨ פעיל עד {when}": "✨ Live until {when}",
  "🛡️ מגן עד {when}": "🛡️ Shielded until {when}",
  "🛡️ פעיל עד {when}": "🛡️ Live until {when}",
  "הנחת חנות {pct}%": "{pct}% shop discount",
  "{pct}% הנחה על רכישת נשק וכל השדרוגים (מכרות, מחסנים, שדרוגי אימפריה) למשך 24 שעות.":
    "{pct}% off weapons and every upgrade (mines, warehouses, empire upgrades) for 24 hours.",
  "הפעל הנחה": "Start the discount",
  "מגני תקיפה": "Raid shields",
  "24 או 48 שעות · חידוש רק {minutes} דקות אחרי שנגמר":
    "24 or 48 hours · renewable only {minutes} minutes after it ends",
  "פעיל": "Live",
  "התקיפה עצמה עדיין מתרחשת. לא ניתן לחדש בזמן שהמגן פעיל — רק {minutes} דקות אחרי שהוא נגמר.":
    "The attack itself still happens. A running shield cannot be renewed — only {minutes} minutes after it ends.",
  "חלון חשוף · ניתן לחדש ב־{when}": "Exposed window · renewable at {when}",
  "{hours}ש׳": "{hours}h",
  "חבילות תורות": "Turn packs",
  "לכל חבילה קירור משלה": "each pack has its own cooldown",
  "{hours} שעות": "{hours} hours",
  "{minutes} דקות": "{minutes} minutes",
  "זמין אחת ל־{cooldown}": "Available once every {cooldown}",
  "זמין ב־{when}": "Available at {when}",
  "קסמים ושירותים": "Spells and services",
  "איפוס נקודות גיבור": "Hero point reset",
  "משחרר את כל הנקודות שהקצית (התקפה/הגנה/משאבים) חזרה לנקודות פנויות, בלי לגעת ברמה. פעם אחת בעונה.":
    "Frees every point you have allocated (attack/defence/resources) back into unspent points, without touching your level. Once per season.",
  "כבר נוצל העונה": "Already used this season",
  "מאפס...": "Resetting…",
  "אפס": "Reset",
  "קסם ריבית בנק": "Bank interest spell",
  "צובר מיידית תשלום ריבית אחד לבנק, לפי הרמה שלך. ניתן להטיל אחת ל־24 שעות.":
    "Credits one bank interest payment at once, at your level. Castable once every 24 hours.",
  "בקירור · זמין ב־{when}": "Cooling down · available at {when}",
  "מטיל...": "Casting…",
  "הטל": "Cast",
  "קסם ירידת עיר": "City descent spell",
  "מוריד אותך עיר אחת בלבד — מעיר {from} ל{to}. אין החזר משאבים, והדרך חזרה היא ייסוד העיר מחדש במחיר המלא. ניתן להטיל אחת ל־{hours} שעה.":
    "Takes you down exactly one city — from {from} to {to}. Nothing is refunded, and the only way back is founding the city again at full price. Castable once every {hours} hour.",
  "זמין מעיר {min} ומעלה — אין לך עיר לוותר עליה":
    "Available from city {min} up — you have no city to give up",
  "רד לעיר {target}": "Drop to city {target}",

  /* ------------------------------------------------------------------ */
  /* the diamond store — real-money packages and the checkout            */
  /* ------------------------------------------------------------------ */
  "מבצע לזמן מוגבל!": "Limited-time offer!",
  "כל חבילות היהלומים ב־{pct}% הנחה — מחכה לך ברגע שהחנות תיפתח.":
    "Every diamond pack is {pct}% off — waiting for you the moment the store opens.",
  "כל חבילות היהלומים ב־{pct}% הנחה. הזמן מוגבל — נצל את זה עכשיו.":
    "Every diamond pack is {pct}% off. The clock is running — take it now.",
  "החנות תיפתח ברגע שמערכת התשלומים תסיים את ההרצה. עד אז אפשר להרוויח יהלומים במשחק עצמו.":
    "The store opens as soon as the payment system finishes its trial run. Until then you can earn diamonds in the game itself.",
  "התשלומים מעובדים בצורה מאובטחת. היהלומים נזקפים לחשבונך מיד לאחר הרכישה.":
    "Payments are processed securely. Diamonds land in your account the moment the purchase completes.",
  "מערכת התשלומים בהרצה אחרונה. היהלומים נזקפים אוטומטית לחשבונך מיד עם סיום הרכישה.":
    "The payment system is in its final trial run. Diamonds are credited to your account automatically the moment the purchase completes.",
  "ערך": "value",
  "בונוס": "bonus",
  "רכישה מיידית": "Buy now",
  "רכישה": "Buy",
  "בקרוב": "Soon",
  "אישור רכישה": "Confirm purchase",
  "מעביר לתשלום מאובטח…": "Handing over to secure payment…",
  "עוד רגע תועבר לעמוד הסליקה. אל תסגור את החלון.":
    "You are about to be sent to the payment page. Do not close this window.",
  "התשלום בוצע!": "Payment complete!",
  "נזקפו {count} יהלומים לחשבונך.": "{count} diamonds have been credited to your account.",
  "מעולה!": "Excellent!",
  "התשלום בקרוב!": "Payment is coming soon!",
  "הבנתי": "Got it",
  "כולל בונוס": "Bonus included",
  "לתשלום": "To pay",
  "פרטים אלה נדרשים על ידי חברת הסליקה ולהפקת הקבלה.":
    "The payment provider requires these details, and so does the receipt.",
  "שם מלא": "Full name",
  "ישראל ישראלי": "Jane Doe",
  "טלפון נייד": "Mobile phone",
  "פותח עמוד תשלום...": "Opening the payment page…",
  "מעבד תשלום...": "Processing payment…",
  "המשך לתשלום {price}": "Continue to pay {price}",
  "שלם {price}": "Pay {price}",
  "ביטול": "Cancel",
  "בהשלמת הרכישה אתה מאשר את": "By completing this purchase you accept the",
  "תנאי השימוש": "Terms of Service",
  "ואת": "and the",
  "מדיניות הביטולים": "Refund Policy",
  "מצב הדגמה — לא מתבצע חיוב אמיתי עד לחיבור ספק התשלומים.":
    "Demo mode — no real charge is made until the payment provider is connected.",

  /* ------------------------------------------------------------------ */
  /* the power cards on the base, and the hero's combined yield          */
  /* ------------------------------------------------------------------ */
  "כוח האימפריה": "Empire power",
  "כוח התקפה": "Attack power",
  "כוח הגנה": "Defence power",
  "כוח מודיעין": "Intelligence power",
  "הברית החזקה": "The strongest guild",
  "כוח חברי הברית": "Guild members' power",
  "כוח כללי": "Overall power",
  "מהרכב הכוח": "What makes it up",
  "{label} (+{pct}%)": "{label} (+{pct}%)",
  "נשקי התקפה": "Attack weapons",
  "נשקי הגנה": "Defence weapons",
  "נשקי ריגול": "Spy weapons",
  "כולל בונוסים פעילים (גיבור / קסם / עזרת ברית).":
    "Includes every live bonus (hero / spell / guild aid).",
  "כוח ההגנה בפועל בקרב, כולל בונוס מגן ובונוסים פעילים.":
    "Your real defence power in battle, defender's bonus and live bonuses included.",
  "בקרב הגנה מתקבל בונוס הגנה של 20%.": "Defending in battle grants a 20% defence bonus.",
  "שדרוג מודיעין מכפיל אותו — ריגול מצליח כשהוא גדול מזה של היעד.":
    "The intelligence upgrade multiplies it — a spy run succeeds when it beats the target's.",
  "התקפה + הגנה + מודיעין": "attack + defence + intelligence",
  "ניהול נשקים": "Manage weapons",
  "ניהול נשקי ריגול": "Manage spy weapons",
  "אימון צבא": "Train the army",
  "אימון מרגלים": "Train spies",
  "סך הכל מהגיבור": "Everything the hero pays",
  "מה שאתה מקבל בפועל מהנקודות והחפצים יחד. שורות מודגשות פעילות; שורות עמומות ממתינות לחפץ מתאים.":
    "What the points and the gear actually pay you, together. Bright rows are live; dim ones are waiting on the right item.",
  "בונוסי קרב · באחוזים": "Battle bonuses · as percentages",
  "תשואה קבועה מחפצים · בכמויות": "Flat yield from gear · as amounts",
  "תפוקת משאבים · אחוזים + כמות": "Resource output · percentage + amount",
  "נקודות": "Points",
  "חפצים": "Gear",
  "דמות": "Class",
  "מנקודות התקפה ומחפצים לבושים": "from attack points and equipped gear",
  "מנקודות הגנה ומחפצים לבושים": "from defence points and equipped gear",
  "מחפצי ריגול לבושים בלבד": "from equipped spy gear only",
  "נוסף בכל עדכון יומי": "added on every daily update",
  "האחוזים מכפילים את תפוקת המכרות; הכמות הקבועה נוספת מעליה בכל עדכון רגיל.":
    "The percentages multiply mine output; the flat amount is added on top of it on every regular update.",
  "נקודות +{pct}% — מכפיל תפוקת מכרות": "Points +{pct}% — multiplies mine output",
  "דמות +{pct}% — יתרון הסוחר": "Class +{pct}% — the Merchant's edge",
  "חרב ומגן +{pct}% — מכפיל תפוקת מכרות":
    "Sword and shield +{pct}% — multiplies mine output",
  "כמות קבועה +{flat} —": "Flat amount +{flat} —",
  "— בכל עדכון רגיל": "— on every regular update",
  "מפרי שטן, מכנסיים או נעליים — המשאבים לפי דרגת החפץ":
    "from a devil's fruit, trousers or boots — which resources depends on the item's rung",

  /* ------------------------------------------------------------------ */
  /* the chat dock                                                       */
  /* ------------------------------------------------------------------ */
  "פתיחת הצ׳אט": "Open chat",
  "סגירת הצ׳אט": "Close chat",
  "צ׳אט": "Chat",
  "חדר כללי": "Public room",
  "שיחות פרטיות": "Private chats",
  "שיחות": "Conversations",
  "שחקנים": "Players",
  "({count} מחוברים)": "({count} online)",
  "דבר אל האימפריה…": "Speak to the empire…",
  "הודעה אל {name}…": "Message {name}…",
  "שלח": "Send",
  "אין עדיין הודעות בשיחה הזו — כתוב ראשון.":
    "No messages in this conversation yet — write the first one.",
  "החדר שקט. תהיה הראשון שמדבר.": "The room is quiet. Be the first to speak.",
  "פתיחת שיחה פרטית": "Open a private chat",
  "צוות": "Staff",
  "פרופיל": "Profile",
  "הסתרת ההודעה": "Hide this message",
  "חיפוש שחקן לשיחה חדשה…": "Search for a player to talk to…",
  "מחפש…": "Searching…",
  "לא נמצא שחקן בשם הזה": "No player by that name",
  "אין עדיין שחקנים אחרים במשחק.": "There are no other players in the game yet.",
  "כל השחקנים כבר ברשימת השיחות שלך.":
    "Every player is already in your conversation list.",
  "חזרה לרשימת השיחות": "Back to the conversation list",
  "מחובר": "online",
  "הקהילה נפגשת בדיסקורד — הצטרפו": "The community meets on Discord — come along",

  /* ------------------------------------------------------------------ */
  /* דרך התהילה — the season pass ladder                                 */
  /* ------------------------------------------------------------------ */
  "דרך התהילה": "The Road of Glory",
  "יום {day}": "Day {day}",
  "פרימיום": "Premium",
  "פרימיום פעיל": "Premium is live",
  "שדרג": "Upgrade",
  "שדרג עכשיו": "Upgrade now",
  "חינמי": "Free",
  "מסלול חינמי": "the free track",
  "מסלול פרימיום": "the premium track",
  "מסלול פרימיום (בנוסף)": "Premium track (on top)",
  "מסלול פרימיום — נעול": "Premium track — locked",
  "דרגות מוכנות לאיסוף": "tiers ready to collect",
  "סגור את דרך התהילה": "Close the Road of Glory",
  "מתאפס בעדכון היומי הבא בעוד": "Resets at the next daily update, in",
  "— וכל יום שעובר בעונה מגדיל את התגמולים":
    "— and every day of the season raises the rewards",
  "מתחדש עכשיו…": "refreshing now…",
  "{count} דרגות": "{count} tiers",
  "מחכה לך לאיסוף": "waiting for you",
  "אסוף את השלל": "Take the haul",
  "אסוף את השלל החינמי": "Take the free haul",
  "הרכישה נכשלה": "The purchase failed",
  "כל פעולה במשחק מזכה בניסיון — תקוף או בנה כדי לפתוח את הדרגה הראשונה":
    "Every action in the game earns experience — attack or build to open the first tier",
  "אספת כל מה שנפתח — עלה דרגה כדי לפתוח עוד":
    "You have taken everything that is open — climb a tier to open more",
  "השלל נאסף": "Haul collected",
  "סגור את סיכום השלל": "Dismiss the haul summary",
  "דרגה נוכחית": "Current tier",
  "מתוך {total}": "of {total}",
  "{xp}/{max} ניסיון · {pct}% מהסולם": "{xp}/{max} XP · {pct}% of the ladder",
  "כל הדרגות נפתחו": "Every tier is open",
  "עוד {xp} ניסיון לדרגה {tier}": "{xp} XP to tier {tier}",
  "דרגה {level} מתוך {total} — {pct}% מהסולם":
    "Tier {level} of {total} — {pct}% of the ladder",
  "{claimed}/{total} נאספו": "{claimed}/{total} collected",
  "דרגות": "Tiers",
  "אתה כאן": "you are here",
  "מוכן": "READY",
  "נעול מאחורי פרימיום": "locked behind premium",
  "עדיין לא הושג": "not reached yet",
  "דרגה {tier}, {track}: {reward} — {status}":
    "Tier {tier}, {track}: {reward} — {status}",
  "פתח את הצד הזהוב": "Open the golden side",
  "פי {multiplier} שלל בכל אחת מ־{tiers} הדרגות · תשלום אחד לכל העונה":
    "{multiplier}× the haul on every one of the {tiers} tiers · one payment for the whole season",
  "זה מה שהמסלול הזהוב מוסיף בסבב אחד — ויש שני סבבים ביום":
    "that is what the golden track adds in one cycle — and there are two cycles a day",
  "יש לך {count}": "You have {count}",
  "· נשאר פתוח עד סוף העונה": "· stays open to the end of the season",
  "אין מספיק יהלומים ({have}/{price}": "Not enough diamonds ({have}/{price}",
  "סבב מלא — כל {tiers} הדרגות": "A full cycle — all {tiers} tiers",
  "חזרה לדרגה שלך ({tier})": "Back to your tier ({tier})",
  "וואו! ניקית הכול 🔥": "Wow — you cleared the lot 🔥",
  "סיימת את כל {total} הדרגות של דרך התהילה — ביום {day} של העונה. משוגע.":
    "You finished all {total} tiers of the Road of Glory — on day {day} of the season. Ridiculous.",
  "כל השלל של הסבב הזה": "Everything this cycle paid",
  "סבב חדש נפתח בעדכון היומי הבא, בעוד": "A new cycle opens at the next daily update, in",
  "הסולם יתמלא מחדש — וכל יום שעובר בעונה מגדיל את התגמולים בכל דרגה":
    "The ladder refills — and every day of the season raises the reward on every tier",
  "זה מה שהצד הזהוב היה מוסיף על השלל הזה":
    "this is what the golden side would have added to that haul",
  "יאללה, בחזרה לקרב": "Right — back to the fight",

  /* ------------------------------------------------------------------ */
  /* the support chat — the one conversation held in front of the login  */
  /* ------------------------------------------------------------------ */
  "תמיכה": "Support",
  "פתיחת צ׳אט התמיכה": "Open the support chat",
  "סגירת צ׳אט התמיכה": "Close the support chat",
  "צוות קראלדור": "The Kraldor team",
  "צוות קראלדור — נשיב כאן, בדרך כלל תוך כמה שעות":
    "The Kraldor team — we answer here, usually within a few hours",
  "אפשר גם בדיסקורד — יש שם מי שעונה":
    "Discord works too — somebody is answering there",
  "נתקעת? ספר לנו מה קרה.": "Stuck? Tell us what happened.",
  "לא הגיע מייל אימות, ההרשמה נתקעת, ההתחברות עם גוגל לא עובדת, שילמת ולא קיבלת — כתוב כאן ונטפל בזה. אם תשאיר אימייל נוכל לחזור אליך גם אם תסגור את החלון.":
    "No verification mail, registration that will not go through, Google sign-in that loops, a payment that never arrived — write it here and we will sort it out. Leave an email and we can get back to you even if you close this window.",
  "אימייל לחזרה (לא חובה)": "Email to reply to (optional)",
  "מה קרה? כתוב כאן…": "What happened? Write here…",
  "הפנייה סומנה כטופלה. אם זה עדיין לא נפתר — כתוב שוב כאן.":
    "This ticket was marked as handled. If it is still not fixed — write here again.",
  "אורח": "Guest",
  /* the "stuck?" line under a form that just refused something */
  "משהו לא עובד?": "Something not working?",
  "דבר איתנו בצ׳אט": "Talk to us in chat",
  'נתקעתי ב{where}. ההודעה שקיבלתי: "{error}"':
    'I am stuck on {where}. The message I got: "{error}"',
  "נתקעתי ב{where} ואני צריך עזרה.": "I am stuck on {where} and need help.",
  "מסך ההתחברות": "the sign-in screen",
  "מסך ההרשמה": "the registration screen",
  /* its refusals */
  "נשלחו יותר מדי הודעות מהכתובת הזו. נסה שוב בעוד שעה.":
    "Too many messages from this address. Try again in an hour.",
  "נפתחו יותר מדי פניות מהכתובת הזו. נסה שוב מאוחר יותר.":
    "Too many tickets opened from this address. Try again later.",
  "שלחת יותר מדי הודעות — המתן כמה דקות":
    "You have sent too many messages — wait a few minutes",
  "הפנייה לא נמצאה": "Ticket not found",
  "הפנייה כבר במצב הזה": "The ticket is already in that state",

  /* ------------------------------------------------------------------ */
  /* the public pages in front of the game — the manual and the hall     */
  /* ------------------------------------------------------------------ */
  "מדריך המשחק": "Game guide",
  "מדריך המשחק | קראלדור": "Game guide | Kraldor",
  "כל מה שצריך לדעת על קראלדור: כלכלה, קרבות, ריגול, גיבור, בריתות ועונות — המדריך המלא, פתוח לכולם.":
    "Everything there is to know about Kraldor: economy, battle, espionage, your hero, alliances and seasons — the full manual, open to everyone.",
  "המדריך המלא — אותו אחד שנמצא בתוך המשחק, עם המספרים החיים של העונה הנוכחית.":
    "The full manual — the same one inside the game, with this season's live numbers.",
  "היכל התהילה | קראלדור": "Hall of Fame | Kraldor",
  "האלופים של העונות שהסתיימו בקראלדור — פודיום ושלושת לוחות התהילה.":
    "The champions of Kraldor's finished seasons — the podium and the three halls.",
  "כך הסתיימה {season}, ב־{date}. הלוחות נחרתו ברגע שהעונה ננעלה ואינם משתנים עוד.":
    "This is how {season} ended, on {date}. The boards were carved the moment the season locked and never change again.",
  "כאן ייחרתו האלופים ברגע שהעונה הראשונה תסתיים.":
    "The champions will be carved here the moment the first season ends.",
  "הצטרף לעונה הראשונה": "Join the first season",
  "פודיום העונה": "The season's podium",
  "כוח": "Power",
  "הקם אימפריה — חינם": "Found an empire — free",
  "חזרה למשחק": "Back to the game",
  "לתוצאות העונה ולספירה לאחור": "To the season results and the countdown",

  /* ------------------------------------------------------------------ */
  /* the mini-games: the pill, the board and the winners' rail           */
  /* ------------------------------------------------------------------ */
  "(אתה)": "(you)",
  "🏆 זכה": "🏆 won",
  "✅ פתר": "✅ solved",
  "💀 נגמרו": "💀 out",
  "⏳ משחק": "⏳ playing",
  "כוסות": "Cups",
  "כוס {n}": "Cup {n}",
  "כוס {n} — הכדור כאן!": "Cup {n} — the ball is here!",
  "כוס {n} — ריקה": "Cup {n} — empty",
  "ספרה נכונה במקום הנכון": "right digit, right slot",
  "ספרה נכונה במקום אחר": "right digit, wrong slot",
  "לא בקוד": "not in the code",
  "הכספת פתוחה 🎉": "The vault is open 🎉",
  "הזן קוד בן {digits} ספרות": "Enter a {digits}-digit code",
  "ספרה {n}": "Digit {n}",
  "🔓 נסה לפרוץ": "🔓 Try the code",
  "🏆 כבר זכו": "🏆 Already won",
  "פרס:": "Prize:",
  "זוכים": "Winners",
  "משתתפים": "Players",
  "נותר": "Left",
  "🎉 ניצחת!": "🎉 You won!",
  "✅ פתרת נכון": "✅ Solved it",
  "הפרס נוסף לאימפריה שלך: {prize}": "The prize is in your empire: {prize}",
  "כל הפרסים כבר חולקו — אבל כל הכבוד!":
    "Every prize is already claimed — but well played.",
  "😔 נגמרו הניסיונות": "😔 Out of attempts",
  "יצאת מהמשחק, אבל הוא עדיין רץ — סגור את החלון והמשך לשחק; הכפתור למעלה יעדכן אותך מי זכה.":
    "You are out of this one, but it is still running — close the window and carry on; the pill above will tell you who wins.",
  "נותרו {count} ניסיונות": "{count} attempts left",
  "המשחק ממשיך בלעדיך — עקוב אחרי המתחרים":
    "The game runs on without you — follow the rivals",
  "🏁 מי משחק עכשיו": "🏁 Who is playing now",
  "עדיין אף אחד לא ניסה — היה הראשון!": "Nobody has tried yet — be the first.",
  "ועוד {count} משתתפים": "and {count} more players",
  "לקח את הפרס": "took the prize",
  "ב־": "in",
  "ניסיון אחרון": "Last attempt",
  "נותרו {count}": "{count} left",
  "אין עדיין זוכה": "No winner yet",

  /* ------------------------------------------------------------------ */
  /* the history tables: battles and spy missions                        */
  /* ------------------------------------------------------------------ */
  "חדש": "NEW",
  "זמן": "Time",
  "יריב": "Rival",
  "פרטים": "Details",
  "תוצאה": "Outcome",
  "מידע שנחשף": "Intelligence gathered",
  "אין דוחות קרב בקטגוריה זו.": "No battle reports in this category.",
  "כבשת את היריב בהצלחה!": "You broke through!",
  "התקפתך נהדפה.": "Your attack was thrown back.",
  "הדפת את ההתקפה בהצלחה!": "You held the walls.",
  "היריב פרץ את הגנתך.": "The rival broke your defence.",
  "האבדות שלך:": "Your losses:",
  "שלל:": "Plunder:",
  "כאן מופיעים רק מרגלים שכוחות הביטחון שלך":
    "Only the spies your own security forces",
  "תפסו": "caught",
  "— ריגול מוצלח נגדך נשאר חשאי ואינו נרשם.":
    "appear here — a successful run against you stays secret and is never logged.",
  "לא שלחת מרגלים עדיין.": "You have not sent any spies yet.",
  "לא נתפסו מרגלים בשטחך.": "No spies have been caught on your ground.",
  "המשימה הצליחה": "The mission succeeded",
  "המרגל נתפס": "The spy was caught",
  "תפסת את המרגל!": "You caught the spy!",
  "כח מודיעין:": "Intelligence power:",
  "(שלך) מול": "(yours) against",
  "סיכוי:": "Odds:",
  "המרגל חוסל לפני שאסף מידע — לא דלף דבר.":
    "The spy was cut down before he gathered anything — nothing leaked.",
  "המרגל אבד במשימה ולא הושג מידע.":
    "The spy was lost on the mission and brought nothing back.",
  "התיק המלא": "The full dossier",

  /* ------------------------------------------------------------------ */
  /* the warehouses                                                      */
  /* ------------------------------------------------------------------ */
  "יש להזין כמות": "Enter an amount",
  "יש להזין מספר שלם גדול מ־0": "Enter a whole number greater than 0",
  "הכמות גדולה מהמשאבים הזמינים": "That is more than you have available",
  "הכמות גדולה מהכמות המאוחסנת במחסן": "That is more than the warehouse holds",
  "פנוי:": "Free:",
  "זמין אצלך:": "Available to you:",
  "כמות": "Amount",
  "כמות להפקדה או משיכה — {label}": "Amount to deposit or withdraw — {label}",
  "מפקיד...": "Depositing…",
  "מושך...": "Withdrawing…",
  "הפקד": "Deposit",
  "משוך": "Withdraw",
  "הפקד הכל": "Deposit all",
  "משוך הכל": "Withdraw all",
  "משאבים במחסן מוגנים ואינם זמינים לשימוש עד שתמשוך אותם.":
    "Resources in the warehouse are protected and cannot be spent until you withdraw them.",
  "לרמה הבאה:": "Next level:",
  "מקום אחסון": "of storage",
  "🔧 שדרג לרמה {level}": "🔧 Upgrade to level {level}",

  /* ------------------------------------------------------------------ */
  /* the guild-war arena                                                 */
  /* ------------------------------------------------------------------ */
  "עכשיו": "just now",
  "לפני {seconds} שנ׳": "{seconds}s ago",
  "לפני {minutes} דק׳": "{minutes}m ago",
  "לפני {hours} שע׳": "{hours}h ago",
  "הקרב נפתח בעוד": "The battle opens in",
  "נותר לקרב": "Left in the battle",
  "המלחמה הבאה בעוד": "The next war in",
  "נרשמו {count} בריתות. צריך לפחות {min} כדי שהמלחמה תתקיים — אחרת הערב מתבטל ואף אחד לא מקבל פרס.":
    "{count} guilds have signed up. At least {min} are needed for the war to happen — otherwise the evening is called off and nobody is paid.",
  "פחות מ־{min} בריתות נרשמו, ולכן המלחמה לא התקיימה. אין מנצחת ואין פרסים.":
    "Fewer than {min} guilds signed up, so the war never happened. There is no victor and no prize.",
  "כבשה את הזירה עם": "took the arena with",
  "נקודות — הפרס מחולק שווה בשווה לכל חברי הברית":
    "points — the prize is split evenly between every member of the guild",
  "הקרב מתנהל": "The battle runs",
  "אוטומטית": "automatically",
  "בין": "between",
  "ל־": "and",
  "(שעון ישראל) — אין מה ללחוץ, המערכת מנהלת את כל ההתנגשויות לבד.":
    "(Israel time) — there is nothing to press; the system runs every clash by itself.",
  "בריתות בזירה": "Guilds in the arena",
  "הברית שלך": "Your guild",
  "סבב": "Round",
  "טבלת הזירה": "The arena table",
  "כוח הברית הוא הכוח הצבאי המשולב של כל החברים. הזירה עצמה נמדדת לפי החבר הממוצע — רוסטר גדול מעלה את הסכום, לא בהכרח את הסיכוי.":
    "A guild's power is the combined military strength of all its members. The arena itself is measured by the average member — a big roster raises the total, not necessarily the odds.",
  "אף ברית לא נרשמה עדיין למלחמה הקרובה — היו הראשונים.":
    "No guild has signed up for the coming war yet — be the first.",
  "כוח הברית": "Guild power",
  "ניצחונות": "Wins",
  "הפסדים": "Losses",
  "לוחמי המלחמה": "The war's fighters",
  "המערכת מסובבת חבר אחר של כל ברית לכל סבב — הטבלה מראה מי הביא הכי הרבה נקודות. אין כאן פרס אישי.":
    "The system rotates a different member of each guild into every round — this table shows who brought in the most points. There is no personal prize here.",
  "לוחם": "Fighter",
  "פריצות": "Breakthroughs",
  "הדיפות": "Holds",
  "שידור חי מהזירה": "Live from the arena",
  "הזירה נפתחת — הסבב הראשון עוד רגע.":
    "The arena is opening — the first round is moments away.",
  "עוד לא היו קרבות במלחמה הזו.": "No clashes in this war yet.",
  "💥 פריצה": "💥 Breakthrough",
  "🛡️ הדיפה": "🛡️ Held",
  "הנקודות ל{guild}": "The points go to {guild}",

  /* ------------------------------------------------------------------ */
  /* the hero-item dialog                                                */
  /* ------------------------------------------------------------------ */
  "דרגה:": "Rarity:",
  "רמת פריט:": "Item level:",
  "סט:": "Set:",
  "דרישת רמה": "Level requirement",
  "גיבור רמה {level}": "Level {level} hero",
  "שדרוג לרמה": "Upgrade to level",
  "סט חדש": "New set",
  "בונוס לאחר שדרוג": "Bonus after the upgrade",
  "עלות": "Cost",
  "🧪 שיקוי הנפח פעיל — {pct}% הנחה על השדרוג":
    "🧪 The smith's brew is live — {pct}% off the upgrade",
  "שדרוג": "Upgrade",
  "שיא הסט ✦": "Set ceiling ✦",
  "רמה מקסימלית ✦": "Max level ✦",
  "אגדי הוא הרמה הגבוהה בסט": "Legendary is the top rung of the",
  "— אין לאן לשדרג אותו יותר. הסט הבא (":
    "set — there is nowhere left to upgrade it. The next set (",
  ") מגיע רק כשלל מתקיפה מנצחת.": ") only arrives as plunder from a won attack.",
  "— אין ציוד גבוה מזה במשחק.": "— there is no higher gear in the game.",
  "החפץ נשמר עליך מהאיפוס וממשיך להעניק את הבונוס המלא. אם תסיר אותו — לא תוכל ללבוש אותו שוב עד שהגיבור יחזור לרמה":
    "This piece survived the reset on you and still pays its full bonus. Take it off and you cannot wear it again until your hero is back at level",
  "אישור — הסר ונעל עד רמה {level}": "Confirm — remove and lock until level {level}",
  "הסר לתיק": "Move to the pack",
  "עלה לרמה {level} כדי ללבוש": "Reach level {level} to wear this",
  "לבש": "Wear",
  "דרוש רמה {level}": "Needs level {level}",
  "אגדי הוא שיא הסט {set} — הסט הבא מגיע כשלל":
    "Legendary is the ceiling of the {set} set — the next set arrives as plunder",
  "דרוש גיבור רמה {level} כדי לשדרג": "Upgrading needs a level {level} hero",
  "אין מספיק זהב": "Not enough gold",
  "שיא הסט": "Set ceiling",
  "אישור זריקה": "Confirm discard",
  "זרוק": "Discard",
  "🎡 סיכוי {pct}% לזכות בסיבוב גלגל מזל מהזריקה":
    "🎡 {pct}% chance the discard wins you a wheel spin",

  /* ------------------------------------------------------------------ */
  /* the bank, and the one-click actions the pass unlocks                */
  /* ------------------------------------------------------------------ */
  "זהב זמין:": "Gold available:",
  "זהב בבנק:": "Gold in the bank:",
  "סכום": "Amount",
  "כמות זהב": "Amount of gold",
  "הפקד לחיסכון": "Deposit to savings",
  "משוך כספים": "Withdraw funds",
  "ניצלת את כל ההפקדות עד העדכון היומי הבא.":
    "You have used every deposit until the next daily update.",
  "הפקדות מוגבלות לפי שדרוג כמות הפקדות בבנק.":
    "Deposits are capped by the bank's deposit-count upgrade.",
  "משיכות אינן מוגבלות.": "Withdrawals are unlimited.",
  "הריבית מחושבת על הזהב שנמצא בבנק בלבד.":
    "Interest is paid on the gold in the bank alone.",
  "הריבית נכנסת בכל עדכון יומי.": "Interest lands on every daily update.",
  "פעולות מהירות": "Quick actions",
  "מציב...": "Assigning…",
  "מחלק...": "Splitting…",
  "מנקה...": "Clearing…",
  "חלק שווה בין המשאבים": "Split evenly between the resources",
  "נקה חלוקה": "Clear the assignment",
  "הפקד הכל · {resource}": "Deposit all · {resource}",
  "משוך הכל · {resource}": "Withdraw all · {resource}",
  "הצב הכל · {resource}": "Assign all · {resource}",

  /* ------------------------------------------------------------------ */
  /* the boss arena — the assault playing itself out                     */
  /* ------------------------------------------------------------------ */
  "הקרב הוכרע": "The battle is decided",
  "הקרב נגמר בעוד": "The battle ends in",
  "מסכמים את השלל…": "Counting the haul…",
  "סבב {round} מתוך {total}": "Round {round} of {total}",
  "· המכה הבאה בעוד {seconds} שנ׳": "· next blow in {seconds}s",
  "אל תסגור — דוח הקרב המלא נפתח בעוד רגע.":
    "Do not close this — the full battle report opens in a moment.",
  "הצבא נלחם לבד. אין מה ללחוץ — אפשר גם לצאת ולחזור.":
    "The army fights on its own. There is nothing to press — you can leave and come back.",
  "הפסים המוזהבים הם הנזק של התקיפה הזו. הפצעים נשארים עליו גם אחרי שהקרב נגמר.":
    "The gold band is this assault's damage. The wounds stay on him after the battle ends.",
  "הקרב הזה כבר הסתיים. הדוח נשלח אליך להודעות.":
    "This battle is already over. The report has been sent to your messages.",
  "הכוחות מסתערים על השער… המכה הראשונה נופלת עוד רגע.":
    "The forces are storming the gate… the first blow lands in a moment.",
  "הגיבור השתחרר.": "The hero broke loose.",
  "{move} של {boss} לא הספיק — מכת זעם אחת הורידה לו {damage} חיים.":
    "{boss}'s {move} was not enough — one fury blow took {damage} health off him.",
  "— הקצינים ענו ב{tactic}": "— the officers answered with {tactic}",
  ", וזו התשובה הנכונה: נזק כפול": ", and that was the right answer: double damage",
  " ובקושי אבדות": " and almost no losses",
  "(−{damage} חיים).": "(−{damage} health).",
  "(−{damage} חיים, −{soldiers} חיילים).": "(−{damage} health, −{soldiers} soldiers).",
  ", וזו התשובה הלא נכונה — היה צריך {tactic}. הנזק נחלש":
    ", and that was the wrong answer — it should have been {tactic}. The damage was blunted",
  "(−{damage} חיים, והמכה נכנסה: −{soldiers} חיילים).":
    "(−{damage} health, and the blow landed: −{soldiers} soldiers).",
  "אפשר לחזור לבוס העיר או לקרוא את הדוח בהודעות.":
    "You can go back to the city boss or read the report in your messages.",
  "אפשר לצאת ולעשות דברים אחרים — כשהקרב ייגמר תקבל הודעה עם כל השלל.":
    "You can leave and do something else — when the battle ends you get a message with the whole haul.",
  "לבסיס": "To the base",
  "לבוס העיר": "To the city boss",
  "הצבא שלך": "Your army",
  "אבדות עד כה:": "Losses so far:",
  "({lossPct}%). הצבא נסוג אם יאבד {routPct}%.":
    "({lossPct}%). The army routs if it loses {routPct}%.",
  "כל החיילים חוזרים הביתה — קרב מול הבוס לא עולה באף חייל.":
    "Every soldier comes home — a boss fight costs you none of them.",
  "מתמלא בכל סבב. כשהוא מתמלא הגיבור משתחרר במכה אחת גדולה.":
    "Fills every round. When it fills, the hero breaks loose in one great blow.",
  "שלל שנצבר עד כה": "Haul earned so far",
  "נצבר לפי הנזק שנגרם עד כה. הפלת הבוס משלמת את האוצר כולו מעל זה, והכול משולם בסוף הקרב.":
    "Earned on the damage landed so far. Killing the boss pays the whole treasure on top, and all of it settles when the battle ends.",
  "יומן הקרב": "Battle log",
  "הכוחות מתקרבים לשער…": "The forces are approaching the gate…",
  "המהלך שלו": "His move",
  "התשובה שלנו": "Our answer",
  "נזק": "Damage",
  "אבדות": "Losses",
  "✔ קריאה נכונה": "✔ read right",
  "✘ קריאה שגויה": "✘ read wrong",
  "קריאות נכונות עד כה:": "Correct reads so far:",
  "מתוך {total} — הן קובעות גם את דירוג הקרב וגם את גודל אוצר ההפלה.":
    "of {total} — they set both the battle grade and the size of the kill treasure.",
  "מה בעצם קורה כאן, ואיך משפרים את התוצאה":
    "What is actually happening here, and how to do better",
  "שילמת תורות ושלחת את הצבא. מרגע הלחיצה הכול כבר מוכרע — הדקה הזו היא הצפייה, לא ההחלטה.":
    "You paid the turns and sent the army. From the moment you pressed, everything is already decided — this minute is the watching, not the deciding.",
  "בכל סבב {boss} מבצע מהלך, והקצינים שלך מנסים לקרוא אותו ולענות בתשובה הנכונה. סיכוי הקריאה שלך כרגע:":
    "Each round {boss} makes a move, and your officers try to read it and answer correctly. Your read chance right now:",
  "— הוא נקבע ברמת הגיבור.": "— it comes from your hero's level.",
  "כשהמונה נגמר משולם השלל": "When the clock runs out the haul is paid",
  ", נכנסות האבדות": ", the losses land",
  ", ונשלחת אליך הודעה עם הסיכום — גם אם עברת בינתיים למסך אחר.":
    ", and a message with the summary is sent to you — even if you have moved to another screen.",
  "שלוש התשובות": "The three answers",
  "כדי לפגוע בו יותר:": "To hit him harder:",
  "כוח התקיפה. עוד חיילים, נשקי תקיפה, ציוד ונקודות תקיפה לגיבור, באפ גילדה ושיקוי כוח — הנזק בכל סבב הוא אחוז מהכוח הזה.":
    "attack power. More soldiers, attack weapons, gear and attack points on the hero, the guild buff and a power potion — each round's damage is a percentage of it.",
  "כדי לאבד פחות חיילים:": "To lose fewer soldiers:",
  "הגיבור. רמה גבוהה יותר = קריאות נכונות יותר, וסבב שנקרא נכון עולה כשליש מהדם.":
    "the hero. A higher level means more correct reads, and a round read right costs a third of the blood.",
  "כדי לקרוא אותו נכון יותר:": "To read him better:",
  "הגיבור. רמה גבוהה יותר = יותר סבבים שנקראים נכון, וכל אחד מהם מכפיל את הנזק.":
    "the hero. A higher level means more rounds read right, and each of those doubles the damage.",
  "גיבור מת מוריד את הקריאה לניחוש ומבטל את הזעם.":
    "A dead hero drops the read to a guess and cancels the fury.",
  "השלל: {chip}% מהאוצר משולם לפי הנזק שגרמת — גם בקרב שלא הפיל אותו — והשאר ({kill}% + ציוד גיבור מובטח) משולם רק למי שמנחית את המכה האחרונה. הפצעים נשארים על הבוס בין תקיפות, אז כל תקיפה מקרבת את ההפלה.":
    "The haul: {chip}% of the treasure is paid on the damage you landed — even in a battle that did not finish him — and the rest ({kill}% plus guaranteed hero gear) goes only to whoever lands the last blow. The wounds stay on the boss between assaults, so every assault brings the kill closer.",

  /* ------------------------------------------------------------------ */
  /* the bag, the paperdoll, the potion belt and the wheel               */
  /* ------------------------------------------------------------------ */
  "התיק": "The pack",
  "חפצים שנלכדו בקרבות וממתינים בתיק. לחיצה על חפץ פותחת את פרטיו — שם אפשר ללבוש, לשדרג או לזרוק.":
    "Gear taken in battle, waiting in the pack. Tap a piece for its details — that is where you wear, upgrade or discard it.",
  "בטל": "Cancel",
  "בחירה": "Select",
  "הקטלוג המלא: כל החפצים הקיימים במשחק, מרמה 1 עד 100 בכל הדרגות":
    "The full catalogue: every item in the game, from level 1 to 100 at every rarity",
  "לכל הפריטים": "All items",
  "נקה בחירה": "Clear selection",
  "סמן הכל": "Select all",
  "מקום בתיק: {slots} סלוטים (5 על 3). כשהתיק מלא — לא נלכדים חפצים חדשים בקרב ואי אפשר להסיר ציוד מהגיבור!":
    "Pack space: {slots} slots (5 by 3). A full pack takes no new gear in battle, and nothing can come off the hero.",
  "סלוטים": "slots",
  "{count} נבחרו": "{count} selected",
  "התיק מלא — חפצים חדשים לא ייכנסו. זרוק או שדרג כדי לפנות מקום.":
    "The pack is full — nothing new will fit. Discard or upgrade to clear a slot.",
  "{slot} רמה {level}": "{slot}, level {level}",
  "לחץ לפרטים": "tap for details",
  "זרוק הכל": "Discard all",
  "שדרג הכל": "Upgrade all",
  "חפצים נלכדים בניצחון בתקיפה על שחקנים אחרים — ככל שהחפץ נדיר יותר, כך קשה יותר ללכוד אותו.":
    "Gear is taken by winning attacks on other players — the rarer the piece, the harder it is to take.",
  "שדרוג חפצים": "Upgrading gear",
  "עומדים לשדרג {count} חפצים לדרגה הבאה.":
    "You are about to upgrade {count} items to the next rung.",
  "עלות כוללת": "Total cost",
  "הזהב שלך": "Your gold",
  "🧪 שיקוי הנפח פעיל — המחירים כאן כבר כוללים {pct}% הנחה.":
    "🧪 The smith's brew is live — the prices here already include the {pct}% discount.",
  "אין מספיק זהב לשדרוג הכל — ישודרגו הזולים ביותר עד שייגמר הזהב.":
    "Not enough gold for all of them — the cheapest will be upgraded until the gold runs out.",
  "משדרג…": "Upgrading…",
  "אישור שדרוג": "Confirm upgrade",

  "{slot} רמה {level} — פרטים": "{slot}, level {level} — details",
  "יש חפץ חזק יותר בתיק": "There is a stronger piece in the pack",
  "תשעת חלקי הציוד שהגיבור לובש, כל אחד במקומו על הגוף. ריחוף מעל חפץ מציג את דרגתו והבונוסים שהוא מעניק. הלבשה והשדרוג נעשים בעמוד הגיבור.":
    "The nine pieces the hero wears, each in its place on the body. Hover a piece for its rarity and the bonuses it pays. Wearing and upgrading happen on the hero screen.",
  "תשעת חלקי הציוד שהגיבור לובש, כל אחד במקומו על הגוף. לחיצה על סלוט ריק בוחרת חפץ מהתיק; לחיצה על חפץ לבוש פותחת את פרטיו. הבונוסים שלהם מרוכזים ב'סך הכל מהגיבור' שלמטה.":
    "The nine pieces the hero wears, each in its place on the body. Tap an empty socket to pick from the pack; tap a worn piece for its details. Their bonuses are totalled in \"Everything the hero pays\" below.",
  "ציוד לבוש": "Gear worn",
  "סלוט ריק": "empty socket",
  "{count} בתיק — לחץ לבחירה": "{count} in the pack — tap to choose",
  "אין חפץ כזה בתיק — לכוד אחד בתקיפה":
    "no piece like this in the pack — take one in an attack",
  "סלוט {slot} ריק": "{slot} socket, empty",
  "סלוט {slot} ריק — בחר חפץ": "{slot} socket, empty — pick a piece",
  "{stat} — בחר חפץ מהתיק כדי ללבוש אותו":
    "{stat} — pick a piece from the pack to wear it",
  "אין חפצי {slot} בתיק.": "No {slot} gear in the pack.",
  "חפצים נלכדים בניצחון בתקיפה על שחקנים אחרים.":
    "Gear is taken by winning attacks on other players.",

  "שיקויים": "Potions",
  "שיקויים נלכדים בניצחון בתקיפה. כל שיקוי מפעיל אפקט זמני על כל האימפריה — לחיצה פותחת את פרטיו ומאפשרת לשתות.":
    "Potions are taken by winning attacks. Each one runs a timed effect over the whole empire — tap for its details and to drink it.",
  "שיקויים נופלים מתקיפות מוצלחות. שתיית שיקוי שכבר פועל מאריכה אותו — לעולם לא בזבוז.":
    "Potions drop from successful attacks. Drinking one that is already running extends it — never a waste.",
  "{potion} — {tagline} ({duration})": "{potion} — {tagline} ({duration})",
  " · אין לך אחד כזה": " · you have none of these",
  "משך:": "Lasts:",
  "בתרמיל:": "In the satchel:",
  "פועל כרגע — נותר": "Running now — left",
  "אין לך שיקוי כזה — נלכד בתקיפות מוצלחות":
    "You have none of these — they drop from successful attacks",
  "שותה…": "Drinking…",
  "אין במלאי": "None in stock",
  "שתה והארך": "Drink and extend",
  "שתה": "Drink",

  "גלגל המזל": "The Wheel of Fortune",
  "הושלמו {count} סיבובים — הנה מה שזכית בו:":
    "{count} spins done — here is what you won:",
  "כבה צלילים": "Mute the sound",
  "הפעל צלילים": "Unmute the sound",
  "סיבובים זמינים": "Spins available",
  "מחזור {cycle} לעונה — הפרסים גדלים בכל עדכון יומי!":
    "Cycle {cycle} of the season — the prizes grow with every daily update.",
  "פרס ״חפץ״ דורש לפחות מקום פנוי אחד בתיק הגיבור.":
    "An \"item\" prize needs at least one free slot in the hero's pack.",
  "סובב את כל הסיבובים הזמינים בבת אחת (עד 10)":
    "Spin every available spin at once (up to 10)",
  "מסתובב…": "Spinning…",
  "סובב": "Spin",
  "כפתור הבאטץ׳ מסובב את כל הסיבובים הזמינים בבת אחת (עד 10).":
    "The batch button spins every available spin at once (up to 10).",

  "ניסיונות": "attempts",
  "זוכה בלבד": "winner only",
  "אחר כך — הכפתור למעלה שומר לי אותו":
    "Later — the pill above keeps it for me",

  /* ------------------------------------------------------------------ */
  /* sign-up, sign-in and the account itself                             */
  /* ------------------------------------------------------------------ */
  "שם האימפריה כבר תפוס, בחר שם אחר": "That empire name is taken — pick another",
  "אירעה שגיאה ביצירת האימפריה, נסה שוב":
    "Something went wrong founding the empire — try again",
  "יותר מדי נסיונות הרשמה. נסה שוב מאוחר יותר.":
    "Too many sign-up attempts. Try again later.",
  "כתובת האימייל כבר רשומה במערכת": "That email address is already registered",
  "אירעה שגיאה בהרשמה, נסה שוב": "Something went wrong signing up — try again",
  "יותר מדי נסיונות התחברות. נסה שוב מאוחר יותר.":
    "Too many sign-in attempts. Try again later.",
  "יותר מדי נסיונות התחברות לחשבון זה. נסה שוב מאוחר יותר.":
    "Too many sign-in attempts for this account. Try again later.",
  "אימייל או סיסמה שגויים": "Wrong email or password",
  "יותר מדי נסיונות. נסה שוב מאוחר יותר.": "Too many attempts. Try again later.",
  "החשבון הזה מחובר דרך Google בלבד ואין לו סיסמה לשינוי.":
    "This account signs in with Google only and has no password to change.",
  "הסיסמה הנוכחית שגויה": "That is not your current password",
  "הסיסמה החדשה זהה לנוכחית": "The new password is the same as the current one",
  "הסיסמה שונתה. כל המכשירים האחרים נותקו.":
    "Password changed. Every other device has been signed out.",
  "אימות מול Google נכשל, נסה שוב": "Verifying with Google failed — try again",
  "כתובת האימייל של חשבון Google אינה מאומתת":
    "That Google account's email address is not verified",
  "כתובת האימייל הזו כבר רשומה עם סיסמה. התחבר עם האימייל והסיסמה שלך.":
    "That email address is already registered with a password. Sign in with your email and password.",
  "כתובת האימייל הזו כבר משויכת לחשבון Google אחר.":
    "That email address is already linked to another Google account.",
  "קישור אימות לא תקין": "That verification link is not valid",
  "קישור האימות אינו תקין": "That verification link is not valid",
  "פג תוקף הקישור — שלח לעצמך קישור חדש":
    "The link has expired — send yourself a new one",
  "הקישור כבר נוצל — שלח לעצמך קישור חדש":
    "That link has already been used — send yourself a new one",
  "נשלחו יותר מדי קישורים. נסה שוב בעוד שעה.":
    "Too many links sent. Try again in an hour.",
  "נשלחו יותר מדי קישורים. נסה שוב מאוחר יותר.":
    "Too many links sent. Try again later.",
  "האימייל שלך כבר מאומת": "Your email is already verified",
  "שלחנו קישור אימות חדש. בדוק את תיבת הדואר.":
    "A new verification link is on its way. Check your inbox.",
  "שליחת המייל נכשלה. נסה שוב בעוד רגע.":
    "Sending the email failed. Try again in a moment.",

  /* the sign-up form's own validation (the zod schemas in actions/auth.ts) */
  "בחר דמות גיבור": "Choose a hero class",
  "שם חייב להכיל לפחות 2 תווים": "A name needs at least 2 characters",
  "שם האימפריה חייב להכיל לפחות 2 תווים":
    "An empire name needs at least 2 characters",
  "כתובת אימייל לא תקינה": "That email address is not valid",
  "סיסמה חייבת להכיל לפחות 8 תווים": "A password needs at least 8 characters",
  "יש להזין סיסמה": "Enter a password",
  "יש להזין את הסיסמה הנוכחית": "Enter your current password",
  "סיסמה חדשה חייבת להכיל לפחות 8 תווים":
    "A new password needs at least 8 characters",

  /* ------------------------------------------------------------------ */
  /* the mines: one card and the rig drawn on it                         */
  /* ------------------------------------------------------------------ */
  "שיא": "max",
  "תפוקה לעדכון רגיל": "Output per regular update",
  " (כולל בונוסים)": " (bonuses included)",
  "תפוקה לעבד מכרות": "Output per mine slave",
  "תפוקת בסיס לעדכון": "Base output per update",
  "בונוסים פעילים": "Live bonuses",
  "סה״כ בפועל": "Actual total",
  "ניהול עובדים (פנויים:": "Crew (free:",
  "מעדכן...": "Updating…",
  "עדכן חלוקה": "Update the crew",
  "המכונה משודרגת למקסימום": "This machine is fully upgraded",
  "שדרג רמה": "Upgrade a level",
  "שדרג למקסימום": "Upgrade to max",
  "{mine} — מושבת, אין עובדים": "{mine} — idle, no crew",
  "{mine} — {slaves} עובדים, {output} {resource} לעדכון":
    "{mine} — {slaves} workers, {output} {resource} per update",
  "מושבת": "IDLE",
  "המכרה טרם נבנה": "the mine is not built yet",
  "אין עובדים במכרה": "no crew on the mine",
  "לעדכון · צוות": "per update · crew",

  /* ------------------------------------------------------------------ */
  /* composing a message                                                 */
  /* ------------------------------------------------------------------ */
  "הודעה חדשה": "New message",
  /* the mail trigger — short in the dossier's action row, spelled out when it
     stands alone; "ללא עלות" is its caption where the others show turn costs */
  "הודעה": "Message",
  "שלח הודעה": "Send a message",
  "ללא עלות": "Free",
  "נמען": "Recipient",
  "נמענים": "Recipients",
  "הסרת {name}": "Remove {name}",
  "חיפוש שחקן לפי שם אימפריה": "Search for a player by empire name",
  "לא נמצא שחקן בשם הזה.": "No player by that name.",
  "מוצגים {count} השחקנים הראשונים — הקלד שם כדי לחפש בכל המשחק.":
    "Showing the first {count} players — type a name to search the whole game.",
  "הגעת למקסימום {max} נמענים בהודעה אחת.":
    "You have hit the ceiling of {max} recipients in one message.",
  "נושא": "Subject",
  "על מה ההודעה?": "What is it about?",
  "תוכן ההודעה": "The message",
  "עד {max} תווים": "up to {max} characters",
  "ההודעה תגיע לתיבת הדואר של הנמענים.":
    "The message lands in the recipients' inbox.",
  "שולח...": "Sending…",
  "שליחה": "Send",

  /* ------------------------------------------------------------------ */
  /* signing the guild up for the war                                    */
  /* ------------------------------------------------------------------ */
  "הרשמה למלחמה הבאה": "Sign up for the next war",
  "הזירה נפתחת ב־": "the arena opens at",
  "ונסגרת ב־": "and closes at",
  "ההרשמה פתוחה תמיד — כל לחיצה רושמת אתכם לקרב הקרוב שטרם התחיל. אחרי זה אין מה לעשות: הקרב מתנהל אוטומטית והמערכת מנהלת אותו לבד.":
    "Sign-up is always open — one press enters you in the next battle that has not started. After that there is nothing to do: the fight runs automatically and the system handles every clash.",
  "הפרס מחולק לרוסטר שהיה בברית כשהפעמון צלצל. מי שמצטרף באמצע הקרב נלחם ומוסיף נקודות — אבל מקבל פרס רק מהמלחמה הבאה.":
    "The prize is split between the roster that was in the guild when the bell rang. Anyone who joins mid-battle fights and adds points — but is only paid from the next war on.",
  "{guild} רשומה ✓": "{guild} is signed up ✓",
  "לא רשומים": "Not signed up",
  "בריתות רשומות:": "Guilds signed up:",
  "צריך לפחות {min} בריתות — אחרת הקרב מתבטל ואף אחד לא זוכה בכלום.":
    "At least {min} guilds are needed — otherwise the battle is called off and nobody wins anything.",
  "מבטל...": "Withdrawing…",
  "ביטול ההרשמה": "Withdraw",
  "נרשמים...": "Signing up…",
  "רשום את {guild} למלחמה": "Sign {guild} up for the war",
  "רק מנהיג או סגן יכולים לרשום את הברית — ההרשמה מכניסה את כל הרוסטר לזירה למשך חצי שעה, וזו לא החלטה של חבר בודד.":
    "Only a leader or an officer can sign the guild up — it puts the whole roster in the arena for half an hour, and that is not one member's call.",

  /* ------------------------------------------------------------------ */
  /* the hero: prestige reset, death and the item catalogue              */
  /* ------------------------------------------------------------------ */
  "הגיבור הגיע לרמה {level}!": "Your hero has reached level {level}!",
  "איפוס הגיבור יחזיר אותו לרמה 1 ויעניק מיד":
    "Resetting the hero takes him back to level 1 and pays out, at once,",
  "ו־": "and",
  "{count} נקודות גיבור": "{count} hero points",
  ". כל הנקודות שהוקצו יימחקו — אך כל איפוס מוסיף {points} נקודות פתיחה לצמיתות, כך שתחזור לרמה {level} עם":
    ". Every allocated point is wiped — but each reset permanently adds {points} starting points, so you come back to level {level} with",
  "{count} נקודות": "{count} points",
  "הציוד הלבוש נשאר עליך": "The gear you are wearing stays on you",
  "וממשיך להעניק את מלוא הבונוס — אבל שים לב:":
    "and keeps paying its full bonus — but note:",
  "חפץ שתסיר יינעל בתיק עד שתחזור לרמתו":
    "a piece you take off is locked in the pack until you are back at its level",
  "🔄 איפוס גיבור": "🔄 Reset the hero",
  "אישור סופי — אפס!": "Final confirmation — reset!",

  "הגיבור שלך נפל בקרב": "Your hero has fallen in battle",
  "כל הבונוסים שלו מושבתים": "every bonus he carries is switched off",
  "כל עוד הוא מת,": "While he is dead,",
  "אף אחד מהבונוסים שלו אינו פועל": "not one of his bonuses is live",
  "— הנקודות שהקצית, החפצים שהוא לובש ובונוס המחלקה מושבתים לחלוטין: הצבא שלך נלחם בלעדיו, והמכרות מייצרים בלעדיו. הוא יקום מעצמו כעבור":
    "— the points you allocated, the gear he wears and the class bonus are all off: your army fights without him, and the mines produce without him. He rises on his own after",
  "— או מיד, תמורת יהלומים.": "— or at once, for diamonds.",
  "קם לתחייה מעצמו בעוד": "Rises on his own in",
  "מחייה...": "Reviving…",
  "החייאה מיידית ל-100% חיים ·": "Revive at once at 100% health ·",
  "יש לך": "You have",
  "יהלומים — חסרים": "diamonds — short by",
  "לרכישת יהלומים": "Buy diamonds",

  "🎯 חפצים נלכדים בניצחון בתקיפה (סיכוי":
    "🎯 Gear is taken by winning an attack (a",
  "ללכידה). ככל שהדרגה נדירה יותר, כך היא נופלת לעיתים רחוקות יותר — הסיכוי בכל תקיפה מנצחת:":
    "chance of a drop). The rarer the rung, the less often it falls — the odds on every won attack:",
  "⬆ שדרוג מעלה את רמת החפץ לדרגה הבאה בתוך הסט (וגם את הסטטים), ונעצר באגדי — הסט הבא מגיע רק כשלל · 🔒 = הגיבור שלך (רמה":
    "⬆ An upgrade raises the item to the next rung inside its set (and its stats with it), and stops at legendary — the next set only arrives as plunder · 🔒 = your hero (level",
  ") עדיין לא יכול ללבוש · ✓ = נמצא ברשותך":
    ") cannot wear it yet · ✓ = you own it",
  "✦ כל עשר רמות מתחלף הסט וכל תשעת החפצים מקבלים מראה חדש, יקר וחזק יותר:":
    "✦ Every ten levels the set changes and all nine pieces take on a new, richer, stronger look:",
  "— עד": "— up to",
  "ברמה 100": "at level 100",
  " · ועוד ": " · plus ",
  "נלכד בניצחון בתקיפה על שחקן אחר": "taken by winning an attack on another player",

  "דרישה: גיבור רמה": "Requires: a level",
  "ממשיך לפעול — אך הסרתו תנעל אותו עד רמה":
    "still working — but taking it off locks it until level",
  "✔ לבוש כעת": "✔ worn now",
  "נמצא ברשותך": "you own this",
  "רמה {level}": "Level {level}",
  "נעול — הגיבור ברמה נמוכה מדי": "Locked — your hero's level is too low",
  "לבוש": "WORN",

  /* ------------------------------------------------------------------ */
  /* account security and the Discord welcome purse                      */
  /* ------------------------------------------------------------------ */
  "שינוי סיסמה": "Change password",
  "שינוי הסיסמה מנתק את כל המכשירים האחרים המחוברים לחשבון.":
    "Changing your password signs out every other device on the account.",
  "סיסמה נוכחית": "Current password",
  "סיסמה חדשה": "New password",
  "לפחות 8 תווים": "at least 8 characters",
  "עדכן סיסמה": "Update password",
  "אבטחת החשבון": "Account security",
  "חושד שמישהו אחר נכנס לחשבון שלך? ניתוק מכל המכשירים מבטל מיד כל התחברות קיימת, בכל מכשיר, כולל זה — תצטרך להתחבר מחדש.":
    "Think someone else has been in your account? Signing out everywhere kills every live session at once, on every device including this one — you will have to sign in again.",
  "נתק מכל המכשירים": "Sign out everywhere",
  "אירעה שגיאה": "Something went wrong",
  "מתנת הצטרפות": "Joining gift",
  "פעם אחת בלבד, לכל אימפריה:": "Once per empire, and once only:",
  "יהלומים על הצטרפות לערוץ. אנחנו לא בודקים — סומכים עליכם. מתנת פתיחה, כל עוד הערוץ צעיר.":
    "diamonds for joining the channel. We do not check — we trust you. An opening gift, while the channel is young.",
  "המתנה נאספה. תודה שהצטרפת — נתראה בערוץ.":
    "Gift collected. Thanks for joining — see you in the channel.",
  "המתנה תיפתח לאיסוף ברגע שהערוץ יעלה לאוויר.":
    "The gift opens the moment the channel goes live.",
  "1. פתחו את הערוץ": "1. Open the channel",
  "2. אספו {count} יהלומים": "2. Collect {count} diamonds",

  /* ------------------------------------------------------------------ */
  /* the hero's own points, and the two buttons on a rival's row         */
  /* ------------------------------------------------------------------ */
  "נקודות שהתקבלו מעליות רמה וטרם הוקצו. לחיצה על +1 / +5 בשורת התכונה מקצה אותן לצמיתות (הן חוזרות רק באיפוס ברמה 100).":
    "Points earned from levelling that you have not spent yet. Pressing +1 / +5 on a stat's row commits them for good (they only come back on a level-100 reset).",
  "נקודות פנויות — כל נקודה ‎+1%": "unspent points — each one is ‎+1%",
  "אחוז זה מגיע אך ורק מהנקודות שהקצה ({pct}%). חפצי הגיבור אינם משפיעים עליו — הם נספרים בנפרד.":
    "This percentage comes from allocated points alone ({pct}%). Hero gear does not touch it — that is counted separately.",
  "אחוז זה מגיע אך ורק מהנקודות שהקצית ({pct}%). חפצי הגיבור אינם משפיעים עליו — ראה ״סך הכל מהגיבור״ למטה.":
    "This percentage comes from the points you allocated alone ({pct}%). Hero gear does not touch it — see \"Everything the hero pays\" below.",
  "שים את כל {count} הנקודות ב{stat}": "Put all {count} points into {stat}",
  "תוקף…": "Attacking…",
  "עלות תקיפה: {turns} תורות": "Attack costs {turns} turns",
  "אין לך מספיק תורות לתקיפה": "You do not have enough turns to attack",
  "תקיפה": "Attack",
  "{turns} תורות": "{turns} turns",
  "מרגל…": "Spying…",
  "עלות ריגול: {turns} תורות": "A spy run costs {turns} turns",
  "אין לך מספיק תורות לריגול": "You do not have enough turns to spy",

  /* ------------------------------------------------------------------ */
  /* the season countdown, the update clocks and the alert toasts        */
  /* ------------------------------------------------------------------ */
  "ימים": "days",
  "שעות": "hours",
  "דקות": "minutes",
  "שניות": "seconds",
  "פעמיים ביום (07:30 / 19:30) מגיעים אזרחים חדשים, יהלומים וריבית בבנק, ונפתחות הפקדות חדשות.":
    "Twice a day (07:30 / 19:30) new citizens, diamonds and bank interest arrive, and fresh deposits open.",
  "עדכון יומי:": "Daily update:",
  "כל 5 דקות: המכרות מייצרים משאבים (לפי עבדי המכרות המוצבים) ומתקבלות תורות.":
    "Every 5 minutes: the mines produce resources (by the slaves assigned to them) and turns arrive.",
  "עדכון דירוג:": "Regular update:",
  "מתעדכן…": "Updating…",

  /* ------------------------------------------------------------------ */
  /* the pass, the command dock, the vault and the player's own blurb    */
  /* ------------------------------------------------------------------ */
  "רכישה חד־פעמית · לא פג תוקף · חיסכון בלחיצות בלבד":
    "One-off purchase · never expires · saves clicks and nothing else",
  "פותח את כפתורי ״הכל״ שכבר קיימים במשחק — בבנק, במחסנים ובמכרות — ואת כפתור ״מפקדה״ בסרגל העליון שמפעיל אותם מכל מסך. אין כאן פעולה חדשה: כל מצב שהם מגיעים אליו, אפשר להגיע אליו גם ידנית. לא נותן משאבים, לא נותן עוצמה ולא מגן על האימפריה.":
    "Unlocks the \"all\" buttons the game already has — in the bank, the warehouses and the mines — and the \"Command\" button in the top bar that reaches them from any screen. There is no new action here: every state they reach, you can reach by hand. It grants no resources, no power and no protection.",
  "רכוש {pass} ·": "Buy {pass} ·",
  "מפקדה": "Command",
  "מפקדה מהירה": "Quick command",
  "אותן פעולות שבעמודי הבנק, המחסנים והייצור — מכל מסך במשחק. כל פעולה מדווחת בדיוק מה קרה.":
    "The same actions as on the bank, warehouse and production screens — from any screen in the game. Each one reports exactly what it did.",

  "כספת הבנק — {gold} זהב, {pct}% מהזהב שלך":
    "The bank vault — {gold} gold, {pct}% of everything you hold",
  "הכספת ריקה": "the vault is empty",
  "הבנק המרכזי": "The Central Bank",
  "פעיל · דרגה": "live · tier",
  "יתרה בבנק": "Balance in the bank",
  "מהזהב שלך מוגן בכספת · חשוף:": "of your gold is safe in the vault · exposed:",
  "ריבית:": "Interest:",
  "בעדכון הבא:": "Next update:",

  "התיאור שלי": "My blurb",
  "דברי השחקן": "The player's own words",
  "ערוך": "Edit",
  "כתוב תיאור": "Write a blurb",
  "מי אתה, בשביל מה אתה משחק, ולמי כדאי לא להתעסק איתך…":
    "Who you are, what you play for, and who had better leave you alone…",
  "נותרו": "Left:",
  "תווים · התיאור גלוי לכל שחקן שנכנס לפרופיל שלך":
    "characters · every player who opens your profile can read this",
  "שומר...": "Saving…",
  "שמור": "Save",
  "עוד לא כתבת כלום על עצמך. כל מי שנכנס לפרופיל שלך יראה כאן את מה שתכתוב.":
    "You have not written anything about yourself yet. Whatever you write here is what visitors to your profile will read.",

  /* ------------------------------------------------------------------ */
  /* the guild's two upgrade cards, and Happy Hour                       */
  /* ------------------------------------------------------------------ */
  "עזרת הברית": "Guild aid",
  "כל חבר נלחם עם תוספת כוח בקרב — גם כשהוא תוקף וגם כשתוקפים אותו.":
    "Every member fights with extra power — attacking and defending alike.",
  "+{pct}% מסך הכוח הכולל של הברית להתקפה ולהגנה":
    "+{pct}% of the guild's combined power, on attack and on defence",
  "כל חבר יכול לשדרג — משולם מהזהב הזמין שלך.":
    "Any member can upgrade it — paid from your own available gold.",
  "קיבולת הברית": "Guild capacity",
  "הרחבת הברית מוסיפה מקום לחבר נוסף — עד 10 חברים.":
    "Expanding the guild makes room for one more member — up to 10.",
  "מנהיג או סגן בלבד — משולם מהזהב הזמין שלו.":
    "Leader or officer only — paid from their own available gold.",
  "מרחיב...": "Expanding…",
  "הרחב ל־{count}": "Expand to {count}",
  "קיבולת מקסימלית (10)": "Capacity is maxed (10)",

  "נפתח עכשיו לכל השחקנים": "OPEN NOW TO EVERYONE",
  "נגמרת בעוד": "Ends in",
  "— כל תקיפה עכשיו שווה כפליים.": "— every attack is worth double right now.",
  "רצה עד להודעה חדשה — כל תקיפה עכשיו שווה כפליים.":
    "Running until further notice — every attack is worth double right now.",
  "⚔️ קדימה, לניצול!": "⚔️ Go and use it!",
  "Happy Hour פעיל — {multiplier}": "Happy Hour is live — {multiplier}",
  "כל השחקנים · עכשיו · אל תבזבז את זה":
    "everyone · right now · do not waste it",
  "∞ עד להודעה חדשה": "∞ until further notice",

  /* ------------------------------------------------------------------ */
  /* signing up, and the guild's own forms                               */
  /* ------------------------------------------------------------------ */
  "הקמת אימפריה חדשה": "Found a new empire",
  "השם שלך": "Your name",
  "למשל: דוד": "e.g. Alex",
  "למשל: ממלכת הברזל": "e.g. The Iron Realm",
  "מקים אימפריה...": "Founding the empire…",
  "הקם אימפריה": "Found the empire",
  "כבר יש לך אימפריה?": "Already have an empire?",
  "התחבר": "Sign in",
  "בחר את הגיבור שלך": "Choose your hero",
  "לכל דמות יתרון קבוע משלה — הבחירה מלווה את האימפריה שלך לאורך הדרך.":
    "Each class carries its own standing advantage — the choice stays with your empire the whole way.",
  "ברוך הבא, {name}": "Welcome, {name}",
  "עוד צעד אחד — בחר שם לאימפריה ואת הגיבור שיוביל אותה לקרב.":
    "One more step — name your empire and pick the hero who will lead it into battle.",
  "שלח לי קישור חדש": "Send me a new link",

  "שם הברית": "Guild name",
  "לדוגמה: אבירי השולחן": "e.g. Knights of the Table",
  "מקים ברית...": "Founding the guild…",
  "⚒️ שלם {cost}": "⚒️ Pay {cost}",
  "והקם ברית": "and found the guild",
  "אין לך מספיק יהלומים להקמת ברית.":
    "You do not have enough diamonds to found a guild.",
  "הקמת ברית דורשת משאבים ורצינות. בחר שם בתבונה.":
    "Founding a guild takes resources and intent. Choose the name wisely.",
  "שם האימפריה להזמנה": "Empire name to invite",
  "שם מדויק של השחקן": "the player's exact name",
  "שלח הזמנה": "Send the invitation",
  "הברית מלאה — הרחב את הקיבולת כדי להזמין עוד שחקנים.":
    "The guild is full — expand its capacity to invite more players.",
  "מנהיג וסגן יכולים להזמין שחקנים שאינם בברית אחרת, ולהרחיק חברים. ההזמנה נשלחת לתיבת ההודעות והשחקן בוחר אם להצטרף.":
    "A leader or officer can invite players who are not in another guild, and remove members. The invitation lands in the player's inbox and they choose whether to join.",
  "לדחות את ההזמנה מ״{guild}״? ההזמנה תימחק.":
    "Decline the invitation from \"{guild}\"? It will be deleted.",
  "מלאה 🚫": "full 🚫",
  "מצטרף...": "Joining…",
  "הצטרף": "Join",
  "דוחה...": "Declining…",
  "דחה": "Decline",
  "אתה החבר האחרון — עזיבה תפרק את הברית והזהב שבקופה יוחזר אליך. להמשיך?":
    "You are the last member — leaving disbands the guild and returns the treasury's gold to you. Continue?",
  "לעזוב את הברית?": "Leave the guild?",
  "עוזב...": "Leaving…",
  "פרק את הברית": "Disband the guild",
  "עזוב את הברית": "Leave the guild",
  "הורד לחבר": "Demote to member",
  "מנה לסגן": "Promote to officer",
  "להעביר את הנהגת הברית ל־{name}? אתה תהפוך לסגן.":
    "Hand the guild's leadership to {name}? You become an officer.",
  "העבר הנהגה": "Hand over leadership",
  "להרחיק את {name} מהברית?": "Remove {name} from the guild?",
  "❌ הרחק": "❌ Remove",

  /* ------------------------------------------------------------------ */
  /* odds and ends: the admin strip, the boss button, the small chrome   */
  /* ------------------------------------------------------------------ */
  "מרכז השליטה — ניהול שחקנים, אימפריות, מתנות, איזון והכרזות":
    "The control centre — players, empires, gifts, balance and announcements",
  "מרכז שליטה": "Control centre",
  "פניות תמיכה שממתינות למענה — מישהו שנתקע במסך ההרשמה, בהתחברות או באימות האימייל כתב אלינו ואף אחד עוד לא ענה":
    "Support tickets waiting for an answer — somebody stuck on the sign-up, sign-in or e-mail verification screen wrote to us and nobody has replied yet",
  "תמיכה — {count} ממתינות": "Support — {count} waiting",
  "מצב אדמין — אתה משחק בתור": "Admin mode — you are playing as",
  "כל פעולה תירשם על שם השחקן.": "Every action is recorded under their name.",
  "חזרה לחשבון האדמין": "Back to the admin account",
  "הצבא יוצא לדרך…": "The army is marching…",
  "תקוף שוב את {boss}": "Attack {boss} again",
  "תקוף את {boss}": "Attack {boss}",
  "לא ניתן לתקוף כרגע": "You cannot attack right now",
  "עלות התקיפה: {turns} תורות · הקרב רץ כדקה":
    "The assault costs {turns} turns · the battle runs about a minute",
  "היתרה שלך": "Your balance",
  "הוצאת יהלומים": "Spend diamonds",
  "רכישת יהלומים": "Buy diamonds",
  "אימוג׳ים": "Emoji",
  "קסמים פעילים": "Live spells",
  "שום אפקט לא פועל עליו כרגע.": "No effect is running on them right now.",
  "חנות היהלומים נעולה — {note}": "The diamond store is sealed — {note}",
  "נסה את מזלך!": "Try your luck!",
  "תוכן המדריך": "Guide contents",
  "תוכן העניינים": "Contents",
  "חזרה לתוכן העניינים": "Back to the contents",
  "דוגמה": "Example",
  "{unit} — {count} יחידות במסדר": "{unit} — {count} on parade",
  "{unit} — המסדר ריק": "{unit} — the yard is empty",
  "המסדר ריק": "the yard is empty",
  "{store} — {stored} מתוך {capacity}, {pct}% מלא":
    "{store} — {stored} of {capacity}, {pct}% full",
  "{days}ד": "{days}d",
  "פג": "over",
  "טוען": "Loading",
  "רק רגע...": "One moment…",
  "קהילת קראלדור בדיסקורד": "The Kraldor community on Discord",
  "הנהלת המשחק — {name}": "Game staff — {name}",
  "הפרופיל של {name}": "{name}'s profile",
  "מחובר עכשיו": "online now",
  "לא מחובר עכשיו": "offline",

  /* ------------------------------------------------------------------ */
  /* the spy report — the dossier a successful mission brings back       */
  /* ------------------------------------------------------------------ */
  "דוח ריגול | KRALDOR": "Spy report | KRALDOR",
  "דוח ריגול": "Spy report",
  "הריגול על {foe} הצליח! ✅": "The run on {foe} succeeded ✅",
  "המרגל נתפס! המשימה נכשלה 🚨": "The spy was caught. The mission failed 🚨",
  "כח המודיעין שלך גבר על היעד — התיק המלא לפניך.":
    "Your intelligence power beat theirs — the full dossier is below.",
  "כח המודיעין של היעד גבר — המרגל אבד. שדרג מודיעין, גייס מרגלים או נשקי ריגול.":
    "Their intelligence power won — the spy is lost. Upgrade intelligence, train spies or buy spy weapons.",
  "המודיעין שלך": "Your intelligence",
  "המודיעין שלו": "Their intelligence",
  "תקוף את {foe}": "Attack {foe}",
  "חזרה לבסיס": "Back to the base",

  "חסינות שחקן חדש": "New-player protection",
  "לא ניתן לתקוף או לרגל אותו כלל": "they cannot be attacked or spied on at all",
  "ניצחון עליו לא יניב שלל": "beating them yields no plunder",
  "ניצחון עליו לא ישעבד חיילים": "beating them enslaves no soldiers",
  "כל בונוסי הגיבור מנוטרלים עד שיקום":
    "every hero bonus is off until he rises",
  "מסע הגיבור · דרגה {tier}": "Hero expedition · rung {tier}",
  "הגיבור בדרכים — שלל צפוי לחזור אליו":
    "the hero is on the road — a haul is due back to him",
  "האצת מכרה זהב": "Gold mine boost",
  "האצת מכרה עץ": "Wood mine boost",
  "האצת מכרה ברזל": "Iron mine boost",
  "האצת מחצבת אבן": "Stone quarry boost",
  "הנחת חנות": "Shop discount",
  "+{pct}% תפוקת זהב": "+{pct}% gold output",
  "+{pct}% תפוקת עץ": "+{pct}% wood output",
  "+{pct}% תפוקת ברזל": "+{pct}% iron output",
  "+{pct}% תפוקת אבן": "+{pct}% stone output",
  "{pct}% הנחה על רכישות": "{pct}% off purchases",

  "אוכלוסייה": "Population",
  "אוכלוסייה ומלאי": "Population and stock",
  "סיבובי גלגל": "Wheel spins",
  "משאבים זמינים": "Available resources",
  "משאבים אלה זמינים לביזה — משאבים במחסן מוגנים מפני תקיפה.":
    "These are open to plunder — anything in a warehouse is safe from attack.",
  "דוח ישן — נאסף לפני שהמרגלים למדו להביא את התיק המלא. רגל שוב כדי לקבל דוח מלא.":
    "An old report — gathered before the spies learned to bring back the full dossier. Run it again for a complete one.",
  "אוצר גלוי — זמין לביזה": "Exposed treasury — open to plunder",
  "רק המשאבים שמחוץ למחסן נלקחים בקרב — {pct}% מהם לתוקף המנצח.":
    "Only what sits outside the warehouses is taken in battle — {pct}% of it to the winning attacker.",
  "מוגן במגן משאבים": "under a resource shield",
  "שלל צפוי {amount}": "expected plunder {amount}",
  "מחסנים — מחוץ להישג יד": "Warehouses — out of reach",
  "מה שנמצא במחסן לא נבזז לעולם. הרמה קובעת את הקיבולת — מחסן מלא מסמן שהיעד עומד לגלוש החוצה.":
    "Nothing in a warehouse is ever plundered. The level sets the capacity — a full one means the target is about to spill out into the open.",
  "סה״כ": "Total",
  "אין ליעד מחסנים.": "The target has no warehouses.",
  "חשבון הבנק": "The bank account",
  "זהב בבנק חסין מביזה לחלוטין — אבל הוא מגלה כמה שווה היעד באמת, וכמה הפקדות נשארו לו עד העדכון היומי הבא.":
    "Gold in the bank is completely safe from plunder — but it tells you what the target is really worth, and how many deposits they have left before the next daily update.",
  "הפקדות שנוצלו": "Deposits used",
  "ריבית יומית": "Daily interest",
  "כוח ריגול": "Spy power",
  "כוח צבאי": "Military power",
  "מודיעין אפקטיבי": "Effective intelligence",
  "״מודיעין אפקטיבי״ הוא מה שריגול נגדי צריך לעבור — כוח הריגול שלו כפול שדרוג המודיעין.":
    "\"Effective intelligence\" is what a counter-run has to beat — their spy power times their intelligence upgrade.",
  "מה יש להרוויח": "What there is to win",
  "הערכה לפי הכללים הנוכחיים, בהנחת ניצחון בקרב. מגנים בתוקף מאפסים את הרלוונטי מהם.":
    "An estimate under the current rules, assuming you win the battle. A live shield zeroes whichever line it covers.",
  "0 — מוגן": "0 — shielded",
  "חיילים לשבי": "Soldiers enslaved",
  "0 — פחות מ־{min} חיילים": "0 — fewer than {min} soldiers",
  "מחסן הנשק": "The armoury",
  "כל פריט נשק שנמצא במחסני היעד — כמות, דרגה וכוח. סכום הכוח לפי קטגוריה הוא בדיוק מה שיעמוד מולך בקרב.":
    "Every weapon in the target's stores — count, tier and power. The category totals are exactly what will face you in battle.",
  "פריטים · דרגה פתוחה": "items · tier unlocked",
  "אין ליעד ולו נשק אחד בקטגוריה הזו.":
    "The target has not one weapon in this category.",
  "נשק": "Weapon",
  "דרגה": "Tier",
  "כוח ליחידה": "Power each",
  "כוח כולל": "Total power",
  "מבנים ומכרות": "Buildings and mines",
  "רמת המבנה ומספר העבדים שהוצבו בו — יחד הם התפוקה שלו בכל עדכון רגיל.":
    "The building's level and the crew standing on it — together they are its output on every regular update.",
  "לא נמצאו מבנים.": "No buildings found.",
  "שדרוגי אימפריה": "Empire upgrades",
  "הרמות שהיעד קנה — מודיעין גבוה מסביר ריגול נגדי מוצלח, ותורות גבוהות מסבירות כמה תקיפות הוא יכול לספוג ולהחזיר.":
    "The levels the target has bought — high intelligence explains a successful counter-run, and high turns explain how many attacks they can absorb and answer.",
  "הגיבור": "The hero",
  "הגיבור מוטל מת — כל הבונוסים שלו מנוטרלים, כולל אחוזי ההגנה. זה החלון לתקוף.":
    "The hero lies dead — every bonus he carries is off, defence percentages included. This is the window.",
  "נק׳ התקפה": "Attack pts",
  "נק׳ הגנה": "Defence pts",
  "נק׳ משאבים": "Resource pts",
  "לא הושקעו": "Unspent",
  "בונוסים מלאים": "Full bonuses",
  "(מושהים — הגיבור מת)": "(suspended — the hero is dead)",
  "תורות מציוד": "Turns from gear",
  "אזרחים מציוד": "Citizens from gear",
  "הגיבור של היעד אינו לובש ציוד כלל.": "The target's hero wears no gear at all.",

  /* ------------------------------------------------------------------ */
  /* the battle report                                                   */
  /* ------------------------------------------------------------------ */
  "תוצאת קרב | KRALDOR": "Battle result | KRALDOR",
  "ניסיון לגיבור מהקרב הזה. רק תקיפה מנצחת מזכה בניסיון — הדפת התקפה לא, הפרס עליה הוא שלא נלקח ממך דבר. הכמות תלויה בפער הרמות (כל איפוס של היריב נחשב 100 רמות, ולכן גם יריב ברמה 1 אחרי איפוס משלם יפה) ובעד כמה הקרב היה צמוד: מחיקת יריב חלש ונמוך ממך מזכה במעט, ניצחון מול יריב שווה או גבוה ממך מזכה בהרבה. כשמצטבר מספיק — הגיבור עולה רמה ומקבל נקודת גיבור ו-25 אזרחים לאימפריה.":
    "Hero experience from this battle. Only a won attack pays it — holding off an attack does not; the reward for that is that nothing was taken from you. The amount follows the level gap (each of the rival's resets counts as 100 levels, so even a level 1 rival after a reset pays well) and how close the fight was: erasing a weak, low rival pays little, beating an equal or stronger one pays a lot. Enough of it and the hero levels, earning a hero point and 25 citizens for the empire.",
  "כוח חיילים": "Soldier power",
  "כוח הלחימה של החיילים בלבד (10 כוח לחייל).":
    "The soldiers' fighting power alone (10 power each).",
  "כוח נשקים": "Weapon power",
  "תוספת הכוח מהנשקים במחסן — נשקי התקפה לתוקף, נשקי הגנה למגן. נשק מהקטגוריה הלא־נכונה לא משתתף בקרב הזה.":
    "The power the stored weapons add — attack weapons for the attacker, defence weapons for the defender. A weapon from the wrong category takes no part in this battle.",
  "סך כוח בסיס": "Base power total",
  "חיילים + נשקים. כל הבונוסים שמתחת מוכפלים על הסכום הזה, בזה אחר זה.":
    "Soldiers + weapons. Every bonus below multiplies this total, one after another.",
  "יתרון המגן +{pct}%": "Defender's edge +{pct}%",
  "הצד המתגונן נלחם בשטח שלו ומקבל תוספת קבועה של {pct}% על כוח הבסיס — לפני הגיבור ולפני קסמי הברית. התוקף לא מקבל אותה.":
    "The defending side fights on its own ground and gets a flat {pct}% on its base power — before the hero and before any guild spell. The attacker gets none of it.",
  "בונוס גיבור +{pct}%": "Hero bonus +{pct}%",
  "הגיבור מגדיל את כל כוח הצד שלו: נקודות התקפה/הגנה שהוקצו + אחוזי החפצים הלבושים (כל נקודה ואחוז = 1%). גיבור מת תורם 0%.":
    "The hero lifts his whole side: allocated attack/defence points plus the percentages on his worn gear (each point and each percent is 1%). A dead hero contributes 0%.",
  "קסם ברית +{pct}%": "Guild spell +{pct}%",
  "קסם ברית פעיל שהוטל מראש — קסם התקפה לתוקף, קסם הגנה למגן. פועל 24 שעות מרגע ההטלה.":
    "A guild spell cast in advance — the attack spell for the attacker, the defence spell for the defender. It runs 24 hours from the cast.",
  "עזרה פסיבית: הברית מחזקת כל חבר בקרב ב־{pct}% מהכוח הצבאי המשולב של כל חבריה. זו תוספת שטוחה שנוספת בסוף, אחרי כל הכפולות — ולכן היא גדלה עם הברית, לא עם הצבא שלך.":
    "Passive aid: the guild strengthens every member in battle by {pct}% of its members' combined military power. It is a flat amount added last, after every multiplier — so it grows with the guild, not with your army.",
  "לא פורט בדוח זה": "Not itemised in this report",
  "הקרב הזה נרשם לפני שהדוח התחיל לתעד את כל מרכיבי הכוח (יתרון המגן ועזרת הברית). ההפרש מוצג כדי שהסכום יישאר נכון.":
    "This battle was recorded before the report started itemising every power term (the defender's edge and guild aid). The difference is shown so the total still adds up.",
  "אתם בברית {guild} מאז הקרב הזה — אין תקיפות בין חברי ברית.":
    "You have both been in {guild} since this battle — guildmates cannot attack each other.",
  "⚔️ תקוף שוב": "⚔️ Attack again",
  "⚔️ נקום": "⚔️ Take revenge",
  "לפרופיל היריב": "To their profile",
  "תוקף": "Attacker",
  "מתגונן": "Defender",
  "תבוסה": "Defeat",
  "מול": "against",
  "כוח קרב": "Battle power",
  "ניסיון לגיבור": "hero XP",
  "היעד היה מוגן": "The target was shielded",
  "המגן שלך עמד": "Your shield held",
  "חסמו": "blocked",
  "את הביזה": "the plunder",
  "את השעבוד": "the enslavement",
  " — הקרב נוצח, אך לא נלקח דבר.": " — the battle was won, but nothing was taken.",
  " — לא נלקח ממך דבר.": " — nothing was taken from you.",
  "שלל הביזה": "The plunder",
  "💸 נבזז ממך": "💸 Plundered from you",
  "אבדות שלך": "Your losses",
  "אבדות היריב": "Their losses",
  "אין": "none",
  "קרבות אינם גורמים לאבדות בחיילים — לא מול שחקנים ולא מול בוס עיר. חייל שמשועבד לא נהרג: הוא עובר לעבדי המכרות של התוקף.":
    "Battles cost no soldiers at all — not against players and not against a city boss. An enslaved soldier is not killed: he joins the attacker's mine slaves.",
  "שועבדו למכרות": "Enslaved to the mines",
  "ניצחון על מגן עם 20+ חיילים משעבד חלק מהם — ככל שצבאו גדול יותר, כך נשבים יותר. המשועבדים מצטרפים לעבדי המכרות הפנויים של התוקף (לא לאזרחים).":
    "Beating a defender with 20+ soldiers enslaves some of them — the bigger their army, the more are taken. They join the attacker's free mine slaves (not their citizens).",
  "🎡 זכית בסיבוב גלגל מזל!": "🎡 You won a wheel spin!",
  "נלכד בקרב": "Taken in battle",
  "נלכד שיקוי: {potion}": "Potion taken: {potion}",
  "נוסף לתרמיל": "added to the satchel",
  "לשיקויים": "To the potions",
  "נלכד חפץ: {item}": "Gear taken: {item}",
  "רמת פריט": "Item level",
  "נוסף לתיק הגיבור": "added to the hero's pack",
  "לציוד הגיבור": "To the hero's gear",
  "מאיזה כוח הורכב הקרב": "What the battle's power was made of",
  "כוח ההתקפה שלך": "Your attack power",
  "כוח ההגנה שלך": "Your defence power",
  "כוח ההגנה של היריב": "Their defence power",
  "כוח ההתקפה של היריב": "Their attack power",
  "סה״כ כוח בקרב": "Total battle power",
  "הקרב הוכרע בהשוואה ישירה בין שני הסכומים — התוקף מנצח רק אם כוחו גדול ממש מכוח המגן. שוויון נחשב הדיפה.":
    "The battle came down to a straight comparison of the two totals — the attacker wins only if his power is strictly greater. A tie counts as a repulse.",

  /* ------------------------------------------------------------------ */
  /* the boss battle report                                              */
  /* ------------------------------------------------------------------ */
  "הבוס הופל": "The boss has fallen",
  "{boss} נפל. מכלאות המצודה נפתחו והאוצר שלו נלקח.":
    "{boss} is down. The keep's pens are open and his treasure is yours.",
  "הצבא נשבר": "The army broke",
  "הקו נשבר תחת {boss} והכוחות נסוגו באמצע הקרב. חצי מהשלל שנצבר אבד עם שיירת האספקה.":
    "The line broke under {boss} and the forces pulled back mid-battle. Half the haul earned was lost with the supply train.",
  "הקרב נגמר": "The battle is over",
  "{boss} עוד עומד, אבל פצוע — והפצעים נשארים עד שהוא נופל. תקוף שוב וסיים את העבודה.":
    "{boss} is still standing, but wounded — and the wounds stay until he falls. Attack again and finish it.",
  "נסיגה מסודרת": "An orderly retreat",
  "הכוחות נסוגו. {boss} נשאר פצוע.": "The forces pulled back. {boss} is left wounded.",
  "הקרב נסגר": "The battle closed",
  "{boss} כבר לא היה שם כשהכוחות הגיעו — הוא נפל או קם לתחייה לפני שהקרב הוכרע. השלל שנצבר שולם.":
    "{boss} was no longer there when the forces arrived — he had fallen or risen again before the battle was decided. The haul earned has been paid.",
  "הקרב נמשך": "The battle runs on",
  "הקרב הזה עדיין רץ.": "This battle is still running.",
  "חזרה לבוס העיר": "Back to the city boss",
  "תקוף שוב": "Attack again",
  "דירוג הקרב נקבע לפי כמה מהמהלכים הקצינים קראו נכון (תלוי ברמת הגיבור) ולפי הצבא ששרד — והוא מכפיל את אוצר ההפלה ב־×{bonus}. דירוג S דורש לפחות {min} סבבים של קריאות נכונות, ולכן הפלה במכה אחת לא מגיעה אליו: קרב שהוכרע מהר לא הספיק להוכיח כלום.":
    "The battle grade follows how many moves the officers read right (which comes from the hero's level) and how much of the army survived — and it multiplies the kill treasure by ×{bonus}. An S needs at least {min} rounds read correctly, so a one-blow kill never reaches it: a battle decided that fast proved nothing.",
  "דירוג {grade} · {label} ×{bonus}": "Grade {grade} · {label} ×{bonus}",
  "נזק בקרב הזה מתוך מאגר של": "damage in this battle, out of a pool of",
  "אוצר {boss}": "{boss}'s treasure",
  "שלל הקרב": "The battle's haul",
  "שולם לפי הנזק שגרמת מתוך מאגר החיים שלו. אוצר ההפלה עצמו עוד מחכה מעבר לשער.":
    "Paid on the damage you landed out of his health pool. The kill treasure itself is still waiting behind the gate.",
  "סבבים שנלחמו": "Rounds fought",
  "קריאות נכונות": "read correctly",
  "תורות שנוצלו": "Turns spent",
  "⛓️ שבויים ששוחררו": "⛓️ Captives freed",
  "סבב אחר סבב": "Round by round",
  "הגיבור שלך": "Your hero",
  "ניסיון לגיבור מהקרב הזה, על אותה חלוקה כמו השלל: לפי הנזק שנגרם, ובונוס מלא על ההפלה.":
    "Hero experience from this battle, split the same way as the haul: by the damage landed, with the full bonus on the kill.",
  "ניסיון שהתקבל": "Experience earned",
  "שלל הבוס:": "Boss drop:",

  /* ------------------------------------------------------------------ */
  /* the hero screen, the inbox, the global boards and the error screens */
  /* ------------------------------------------------------------------ */
  "גיבור | KRALDOR": "Hero | KRALDOR",
  "תג איפוס: הגיבור הגיע לרמה {max} ואופס {times}. כל איפוס העניק {citizens} אזרחים, {turns} תורות ו-{points} נקודות פתיחה נוספות לצמיתות.":
    "Reset badge: the hero reached level {max} and was reset {times}. Each reset paid {citizens} citizens, {turns} turns and {points} more permanent starting points.",
  "פעם אחת": "once",
  "{count} פעמים": "{count} times",
  "הגיבור מת — כל הבונוסים שלו מושבתים עד שיקום לתחייה":
    "The hero is dead — every bonus he carries is off until he is raised",
  "חיי הגיבור — כל תקיפה שפורצת את ההגנה שלך מורידה {damage} נקודות. באפס הגיבור מת.":
    "The hero's health — every attack that breaks your defence takes {damage} points off it. At zero he dies.",
  "חיי הגיבור. כל תקיפה שפורצת את ההגנה שלך מורידה {damage} נקודות; באפס הגיבור מת וכל הבונוסים שלו מושבתים.":
    "The hero's health. Every attack that breaks your defence takes {damage} points off it; at zero he dies and every bonus he carries is off.",
  "על המחלקה": "About the class",
  "יתרון המחלקה — בונוס קבוע שנבחר בעת ההרשמה":
    "The class advantage — a standing bonus, chosen at sign-up",
  "ניסיון מצטבר מקרבות — ניצחון בתקיפה מעניק הכי הרבה, וגם הגנה מוצלחת מזכה. כל עליית רמה מעניקה נקודת גיבור.":
    "Experience earned in battle — a won attack pays the most, and a successful defence counts too. Every level pays a hero point.",
  "שלוש התכונות שנקודות הגיבור מחזקות. חפצי הגיבור אינם משנים אחוזים אלה — התרומה שלהם מרוכזת ב״סך הכל מהגיבור״ שלמטה.":
    "The three stats hero points strengthen. Hero gear does not touch these percentages — its contribution is totalled in \"Everything the hero pays\" below.",
  "נקודות גיבור": "Hero points",
  "נקודות גיבור שטרם הוקצו — מתקבלת נקודה בכל עליית רמה. כל נקודה = ‎+1% לצמיתות.":
    "Hero points you have not spent — one arrives with every level. Each is a permanent ‎+1%.",
  "פנויות": "unspent",
  "חנות פריטים וחיזוקים לגיבור — בקרוב": "A shop for hero gear and boosts — coming soon",
  "חנות גיבור": "Hero shop",

  "הודעות | קראלדור": "Messages | Kraldor",
  "מגדל היונים": "The Pigeon Tower",
  "הודעות חדשות מתוך": "new messages out of",
  "אין דואר חדש — ": "No new mail — ",
  "בתיבה": "in the box",
  "תיבת הדואר שלך — הודעות משחקנים והתראות מהמערכת.":
    "Your inbox — messages from players and alerts from the game.",
  "אין הודעות עדיין": "No messages yet",
  "הודעות משחקנים, התראות על התקפות, מרגלים שנתפסו ועדכוני מערכת יופיעו כאן.":
    "Player messages, attack alerts, spies caught and system notices all land here.",
  "שחקן שנמחק": "a deleted player",
  "מאת": "From",
  "לצפייה בדוח המלא": "Read the full report",

  "טבלאות מובילים | KRALDOR": "Leaderboards | KRALDOR",
  "טבלאות מובילים": "Leaderboards",
  "אין נתונים עדיין.": "No data yet.",
  "את/ה": "you",
  "דירוג גלובלי על פני כל השחקנים במשחק — ליד כל שם מופיעה העיר שבה הוא יושב.":
    "A global ranking across every player in the game — each name carries the city they sit in.",
  "דירוג העיר שלי": "My city's ladder",
  "הבנק הגדול ביותר": "The biggest bank",
  "הריגול הגבוה ביותר": "The highest intelligence",
  "הגניבות הגדולות ביותר": "The biggest heists",
  "השיעבודים הגדולים ביותר": "The biggest hauls of prisoners",
  "מי לוקח הכי הרבה משחקנים אחרים — זהב שנשדד וחיילים שנשבו בתקיפות מנצחות.":
    "Who is taking the most off other players — gold plundered and soldiers captured in winning attacks.",
  "היום": "Today",
  "השבוע": "This week",
  "לא נגנב זהב היום עדיין.": "No gold has been stolen today yet.",
  "לא נגנב זהב השבוע עדיין.": "No gold has been stolen this week yet.",
  "לא שועבדו חיילים היום עדיין.": "No soldiers have been taken prisoner today yet.",
  "לא שועבדו חיילים השבוע עדיין.": "No soldiers have been taken prisoner this week yet.",

  "לא נמצא": "Not found",
  "המשאב שחיפשת לא קיים או שאין לך גישה אליו — ייתכן שהאימפריה, הקרב או הדוח נמחקו.":
    "What you were looking for does not exist, or you have no access to it — the empire, battle or report may have been deleted.",
  // The root 404 — a URL that matches no route at all, rather than a missing
  // battle or empire behind one that does. See app/not-found.tsx.
  "הדף לא נמצא": "Page not found",
  "הדף לא נמצא | קראלדור": "Page not found | Kraldor",
  "הכתובת שהגעת אליה לא קיימת — ייתכן שהקישור נשבר בדרך או שהדף הוסר.":
    "That address does not exist — the link may have been broken on the way, or the page removed.",
  "לדירוג": "To the rankings",
  "משהו השתבש": "Something went wrong",
  "אירעה שגיאה בטעינת המסך. אפשר לנסות שוב או לחזור לבסיס.":
    "The screen failed to load. Try again, or head back to your base.",
  "🔄 נסה שוב": "🔄 Try again",

  /* ------------------------------------------------------------------ */
  /* the city ladder, the prize hall, the sealed season and the community */
  /* ------------------------------------------------------------------ */
  "דירוג | קראלדור": "Rankings | Kraldor",
  "עמוד": "Page",
  "מתוך": "of",
  "← הקודם": "← Previous",
  "הבא →": "Next →",
  "הדף שלי": "My page",
  "דירוג {city}": "{city} ladder",
  "{city} — הדירוג מציג רק את האימפריות בעיר שלך. ניתן לרגל ולתקוף רק אימפריות בעיר שלך.":
    "{city} — the ladder shows only the empires in your city. You can only spy on and attack empires in your own city.",
  "עיר": "City",
  "הדירוג שלך:": "Your rank:",
  "שם הצבא": "Army name",
  "תג איפוס: הגיבור הגיע לרמה 100 ואופס {times}. כל איפוס מוסיף +25% ליוקרה שלו.":
    "Reset badge: the hero reached level 100 and was reset {times}. Each reset adds +25% to his prestige.",
  "{role} בברית {guild}": "{role} of {guild}",
  "היכל התהילה": "The Hall of Fame",
  "כך הסתיימה": "This is how",
  "ב־{date}. העונה הנוכחית אינה משפיעה על הלוחות האלה — הם נחרתו ברגע שהעונה ננעלה.":
    "ended, on {date}. The current season does not touch these boards — they were carved the moment that season was sealed.",
  "מתעדכן פעם אחת, בסיום כל עונה.": "Updated once, when each season closes.",
  "עוד לא הסתיימה אף עונה. הלוחות הראשונים ייחרתו כאן בסיום העונה הנוכחית.":
    "No season has ended yet. The first boards will be carved here when the current one closes.",

  "פרסי העונה | KRALDOR": "Season prizes | KRALDOR",
  "פרסי העונה": "Season prizes",
  "הפרס הראשון": "First prize",
  "יהלומים לאלוף העונה": "diamonds to the season's champion",
  "גם המקום השני והשלישי זוכים — {second} ו־{third} יהלומים, {pool} בסך הכול. הדירוג נקבע לפי הכוח הצבאי בסיום העונה, וכל עוד העונה רצה כל תקיפה יכולה להזיז כיסא.":
    "Second and third place are paid too — {second} and {third} diamonds, {pool} in all. The ranking is decided by military power at the season's close, and while the season runs any attack can move a seat.",
  "{season} — הפרסים מוענקים בעוד": "{season} — prizes are awarded in",
  "מועד סיום העונה טרם נקבע — הפרסים ממתינים לעונה מתוזמנת.":
    "The season's closing time is not set yet — the prizes wait on a scheduled season.",
  "מחזיק בכיסא": "Holding the seat",
  "הכיסא עדיין פנוי": "The seat is still empty",
  "חשבונות ההנהלה אינם משתתפים בדירוג ואינם זכאים לפרסים.":
    "Staff accounts are out of the ranking and are not eligible for prizes.",
  "— שמירה על המקום עד נעילת העונה שווה": "— holding it to the season's close is worth",
  "המקום שלך בדירוג הכללי:": "Your place in the overall ranking:",
  "— חסרים לך": "— you are short by",
  "כוח צבאי כדי לעלות על הפודיום.": "military power to reach the podium.",
  " — הפודיום עדיין לא מלא, כל מקום פנוי שם שווה יהלומים.":
    " — the podium is not full yet, and every free seat on it is worth diamonds.",
  "איך זוכים": "How you win",
  "• הדירוג הוא גלובלי — כל השחקנים במשחק, לא רק העיר שלך.":
    "• The ranking is global — every player in the game, not just your city.",
  "• מדד הדירוג הוא הכוח הצבאי: הצבא, הנשק שבידיו והבונוסים של הגיבור.":
    "• The measure is military power: the army, the weapons in its hands and the hero's bonuses.",
  "• שוויון נשבר לפי רמת הגיבור, ואחריה מספר האיפוסים שלו.":
    "• A tie is broken by hero level, and then by the number of resets.",
  "• חשבונות ההנהלה אינם משתתפים ואינם תופסים מקום בפודיום.":
    "• Staff accounts do not take part and never occupy a podium seat.",
  "• הדירוג הקובע הוא זה שנחתם ברגע נעילת העונה, והיהלומים נכנסים לחשבון":
    "• The ranking that counts is the one sealed at the season's close, and the diamonds land in the account",
  "באותו רגע — עם הודעה לתיבת הדואר. אין צורך לאסוף דבר.":
    "at that moment — with a message to your inbox. There is nothing to collect.",
  "לטבלת הדירוג": "To the ladder",

  "העונה הסתיימה | קראלדור": "The season has ended | Kraldor",
  "העונה הסתיימה": "The season has ended",
  "השערים נעולים. הדירוג הסופי נחתם ונכנס להיכל התהילה, ולא ניתן עוד לשנות דבר בעולם הזה.":
    "The gates are sealed. The final ranking is signed and carved into the Hall of Fame, and nothing in this world can be changed any more.",
  "{season} נפתחת בעוד": "{season} opens in",
  "העונה הבאה נפתחת בעוד": "The next season opens in",
  "כשהשערים ייפתחו העולם יתאפס — כל אימפריה מתחילה מאפס והבריתות מתפרקות. רק היהלומים נשארים איתכם. 💎":
    "When the gates open the world resets — every empire starts from nothing and every guild is dissolved. Only your diamonds stay with you. 💎",
  "מועד העונה הבאה טרם נקבע. חזרו לכאן בקרוב.":
    "The next season's date is not set yet. Come back soon.",
  "אלופי העונה": "The season's champions",
  "{cities} ערים · גיבור {level}": "{cities} cities · hero {level}",
  "העונה במספרים": "The season in numbers",
  "העונה נסגרה לפני שנרשמו בה תוצאות.":
    "The season closed before any results were recorded.",
  "אימפריות": "Empires",
  "בריתות": "Guilds",
  "קרבות": "Battles",
  "זהב שנשדד": "Gold plundered",
  "חיילים שנפלו": "Soldiers lost",
  "נלקחו בשבי": "Taken captive",

  "קהילה | KRALDOR": "Community | KRALDOR",
  "הערוץ של קראלדור": "The Kraldor channel",
  "הדירוג הוא רק חצי מהמשחק. החצי השני הוא מי שיושב מהצד השני של המסך — בריתות שמתגבשות, טקטיקות שמתחלפות, וכל הכרזה על Happy Hour או סיזן חדש שנוחתת שם קודם.":
    "The ladder is only half the game. The other half is whoever is on the far side of the screen — guilds forming, tactics shifting, and every Happy Hour or new-season announcement landing there first.",
  "הערוץ נבנה בימים אלה": "The channel is being built",
  "ברגע שהוא ייפתח, הקישור יופיע כאן ובכל מסכי המשחק.":
    "The moment it opens, the link appears here and on every screen in the game.",
  "כללי הבית": "House rules",
  "מעדיפים להישאר בתוך המשחק? הצ׳אט החי בפינה השמאלית התחתונה פתוח תמיד — חדר כללי ושיחות פרטיות.":
    "Prefer to stay in the game? The live chat in the bottom-left corner is always open — a public room and private conversations.",

  /* hero gear */
  "ברשותך מאז": "Yours since",
  "לבש {item}": "Equip {item}",
  "דרוש גיבור רמה {level}": "Needs a level {level} hero",

  /* ------------------------------------------------------------------ */
  /* לוח היום — the daily board                                          */
  /* ------------------------------------------------------------------ */

  "לוח היום": "Daily Board",
  "לוח היום | KRALDOR": "Daily Board | KRALDOR",
  "לוח היום אינו זמין כרגע. נסה לרענן.":
    "The daily board is unavailable right now. Try refreshing.",
  "מתחדש בעוד": "Resets in",
  "מתחדש…": "Resetting…",
  /* the countdown's two forms — compact enough to sit next to a heading */
  "{h}ש {m}ד": "{h}h {m}m",
  "{m}ד": "{m}m",

  /* the muster roll */
  "מפקד הנאמנים": "The Loyal Muster",
  "חתום על המפקד פעם ביום. יום שמפוספס מאפס את הרצף — ולא את השיא.":
    "Sign the muster once a day. A missed day resets the run — never the record.",
  "ימים רצופים שבהם חתמת על המפקד": "Days in a row you have signed the muster",
  "הרצף הארוך ביותר שהיה לך אי־פעם": "The longest run you have ever held",
  "ברצף": "streak",
  "חתום על המפקד": "Sign the muster",
  "חותם…": "Signing…",
  "חתמת היום": "Signed today",
  "פספסת יום — החתימה הבאה מתחילה רצף חדש מיום 1.":
    "You missed a day — the next signature starts a fresh run at day 1.",
  "כבר חתמת על מפקד היום. חזור מחר.":
    "You have already signed today's muster. Come back tomorrow.",
  "יום {count} ברצף. קיבלת {spoils}.":
    "Day {count} of your run. You received {spoils}.",
  "הרצף נשבר, ומתחיל מחדש. חתמת על יום 1 וקיבלת {spoils}.":
    "The run broke and begins again. You signed for day 1 and received {spoils}.",

  /* the login chest (DailyGift) */
  "מתנת הכניסה היומית": "Daily login gift",
  "יום {day} ברצף": "Day {day} of your run",
  "יום {day} — תיבת הנאמנים": "Day {day} — the Loyal Chest",
  "יום {day} — נחתם!": "Day {day} — signed!",
  "חתמת על המפקד? עוד לא. התיבה של היום מחכה לך.":
    "Signed the muster yet? Not today. This day's chest is waiting for you.",
  "פספסת יום — הרצף מתחיל מחדש. פתח את התיבה ונתחיל מיום 1.":
    "You missed a day — the run starts over. Open the chest and we begin at day 1.",
  "הרצף שלך: {count} ימים. חזור מחר ותקבל יותר.":
    "Your run: {count} days. Come back tomorrow for more.",
  "פתח את התיבה": "Open the chest",
  "פותח…": "Opening…",
  "קדימה, לשלטון": "Onward, to the throne",
  "המתנה הבאה נפתחת בחצות — בעוד {left}":
    "The next gift unseals at midnight — in {left}",

  /* the seven rungs */
  "יום ראשון ברצף": "First day of the run",
  "יום שני ברצף": "Second day of the run",
  "יום שלישי ברצף": "Third day of the run",
  "יום רביעי ברצף": "Fourth day of the run",
  "יום חמישי ברצף": "Fifth day of the run",
  "יום שישי ברצף": "Sixth day of the run",
  "שבוע שלם — מפקד הנאמנים": "A full week — the Loyal Muster",

  /* mission boards */
  "משימות היום": "Today's missions",
  "משימות השבוע": "This week's missions",
  "שלוש משימות, נבחרות מחדש בכל יום בחצות. הן נמדדות ממתי שהלוח נפתח — לא מתחילת היום.":
    "Three missions, dealt again every midnight. They are measured from when the board opened — not from the start of the day.",
  "שלוש משימות גדולות יותר, נבחרות מחדש בכל יום ראשון בחצות.":
    "Three larger missions, dealt again every Sunday at midnight.",
  "אין משימות פתוחות כרגע.": "No open missions right now.",
  "אסוף": "Collect",
  "הלוח של היום עדיין לא נפתח.": "Today's board has not been opened yet.",
  "המשימה הזו לא על הלוח שלך.": "That mission is not on your board.",
  "כבר אספת את המשימה הזו.": "You have already collected that mission.",
  "המשימה עדיין לא הושלמה.": "That mission is not finished yet.",
  'השלמת "{mission}" וקיבלת {spoils}.':
    'You completed "{mission}" and received {spoils}.',
  'השלמת "{mission}" וקיבלת {spoils}. הברית השלימה את החוזה היומי!':
    'You completed "{mission}" and received {spoils}. Your guild has fulfilled its daily contract!',

  /* mission names and hints — patterns, so one entry covers every size */
  "{goal} פשיטות": "{goal} raids",
  "פתח ב-{goal} תקיפות — ניצחון או הפסד, שתיהן נספרות":
    "Launch {goal} attacks — win or lose, both count",
  "חסל {goal} חיילי אויב — בתקיפה או בהגנה":
    "Kill {goal} enemy soldiers — attacking or defending",
  "{goal} הפקדות בבנק": "{goal} bank deposits",
  "הפקד זהב בבנק {goal} פעמים": "Deposit gold at the bank {goal} times",
  "{goal} בוסים": "{goal} bosses",
  "הפל את בוס העיר {goal} פעמים": "Fell your city's boss {goal} times",
  "רכוש {goal} כלי נשק במפעל": "Buy {goal} weapons at the armory",
  "{goal} דגמי נשק חדשים": "{goal} new weapon models",
  "הוסף {goal} דגמי נשק שלא היו לך למחסן":
    "Add {goal} weapon models you did not own to your arsenal",
  "{goal} רמות גיבור": "{goal} hero levels",
  "העלה את הגיבור {goal} רמות": "Raise your hero {goal} levels",
  "{goal} רמות מכרה": "{goal} mine levels",
  "שדרג את המכרה המפותח ביותר שלך ב-{goal} רמות":
    "Raise your most developed mine by {goal} levels",
  "מחסנים ב-{goal} רמות": "Warehouses up {goal} levels",
  "העלה את המחסן הנמוך ביותר שלך ב-{goal} רמות":
    "Raise your lowest warehouse by {goal} levels",
  "{goal} רמות שדרוג": "{goal} upgrade levels",
  "העלה את השדרוג הנמוך ביותר שלך ב-{goal} רמות":
    "Raise your lowest empire upgrade by {goal} levels",
  "קבלת מגויסים +{goal}": "Recruit intake +{goal}",
  'שדרג את "קבלת מגויסים" ב-{goal} רמות': 'Raise "Recruit intake" by {goal} levels',
  "הדוף {goal} תקיפות על האימפריה שלך — הן מגיעות אליך, לא אתה אליהן":
    "Repel {goal} attacks on your empire — they come to you, not the other way round",
  "אסוף {goal} פריטי ציוד לגיבור — מתקיפות שניצחת וממסעות":
    "Collect {goal} pieces of hero gear — from attacks you won and from expeditions",
  "פריט אפי": "An epic item",
  "זכה בפריט אחד בדרגת נדירות אפי לפחות":
    "Win one item of epic rarity or better",
  "נצח {goal} פעמים במיני-משחק — הם משוחררים מדי פעם, שים לב לסרגל העליון":
    "Win {goal} mini-games — they are released from time to time; watch the top bar",
  "עיר נוספת": "One more city",
  "ייסד עיר נוספת לאימפריה": "Found another city for your empire",

  /* the guild contract */
  "משימות יומיות שחברי הברית השלימו":
    "Daily missions your guild's members have completed",
  "היעד נקבע לפי {members} חברי הברית כשהחוזה נפתח היום. רק משימות יומיות נספרות.":
    "The goal was set from the {members} members the guild had when today's contract opened. Only daily missions count.",
  "כשהברית תשלים את היעד, כל חבר יוכל לקחת את חלקו כאן.":
    "Once the guild meets the goal, every member can take their share here.",
  "קח את חלקך": "Take your share",
  "לקחת את חלקך.": "You have taken your share.",
  "החוזה של היום עדיין לא הושלם.": "Today's contract is not complete yet.",
  "החוזה של היום כבר אינו בתוקף.": "Today's contract is no longer valid.",
  "כבר לקחת את חלקך בחוזה של היום.":
    "You have already taken your share of today's contract.",
  "הצטרפת לברית אחרי שהחוזה הושלם — החלק הזה כבר חולק.":
    "You joined the guild after the contract was completed — that share is already divided.",
  '"{contract}" הושלם. חלקך: {spoils}.':
    '"{contract}" is complete. Your share: {spoils}.',

  "מסע האספקה": "The Supply Run",
  "השיירות של הברית יוצאות עם שחר. כל אחד לוקח את החלק שלו.":
    "The guild's caravans leave at dawn. Everyone carries their share.",
  "מפקד הברית": "The Guild Muster",
  "המפקדים רוצים לראות מי עוד עומד על הרגליים. תתייצבו.":
    "The commanders want to see who is still on their feet. Present yourselves.",
  "מכסת הנפחייה": "The Forge Quota",
  "המפעל עובד כל הלילה, ומישהו צריך להביא את הברזל.":
    "The works run all night, and somebody has to bring the iron.",
  "קריאת החרב": "The Call of the Sword",
  "יום אחד בשבוע הברית לא מתגוננת. היום הזה.":
    "One day a week the guild does not defend. This is that day.",

  /* ------------------------------------------------------------------ */
  /* נפחיית הגיבור — the forge                                           */
  /* ------------------------------------------------------------------ */

  "נפחייה": "Forge",
  "נפחייה | KRALDOR": "Forge | KRALDOR",
  "נפחיית הגיבור": "The Hero's Forge",
  "הנפחייה אינה זמינה כרגע. נסה לרענן.":
    "The forge is unavailable right now. Try refreshing.",
  "נפחייה: פרק ציוד לרסיסים, הזמן פריט למשבצת שחסרה לך, ולטש פריט קיים":
    "Forge: dismantle gear into shards, commission a piece for a slot you are missing, and temper what you hold",
  "פרק ציוד שאינך זקוק לו לרסיסים, והשתמש בהם כדי להזמין פריט למשבצת שחסרה לך או ללטש פריט קיים לדרגה הבאה.":
    "Dismantle gear you have no use for into shards, then spend them commissioning a piece for a slot you are missing or tempering one you already hold.",
  "כל פריט שאתה מפרק — בתיק או על הגוף — הופך לרסיסים. הנפחייה לא יוצרת ציוד חזק ממה שהמשחק היה נותן לך בלאו הכי: היא רק מכוונת אותו למשבצת שחסרה לך.":
    "Every piece you dismantle — in the bag or worn — becomes shards. The forge never makes gear stronger than the game would have given you anyway: it only aims it at the slot you are missing.",
  "רסיסים": "shards",
  "רסיסי ציוד — נצברים מפירוק פריטים":
    "Gear shards — earned by dismantling pieces",

  /* dismantling */
  "{item} פורק ל-{shards} רסיסים": "{item} dismantled into {shards} shards",
  "{item} פורק ל-{shards} רסיסים — ומזל טוב! 🎡 זכית בסיבוב גלגל מזל!":
    "{item} dismantled into {shards} shards — and congratulations! 🎡 You won a wheel spin!",
  "{count} חפצים פורקו ל-{shards} רסיסים":
    "{count} pieces dismantled into {shards} shards",
  "{count} חפצים פורקו ל-{shards} רסיסים — ומזל טוב! 🎡 זכית ב-{spins} סיבובי גלגל מזל!":
    "{count} pieces dismantled into {shards} shards — and congratulations! 🎡 You won {spins} wheel spins!",
  "פירוק: {shards}": "Dismantle: {shards}",

  /* the commission bench */
  "הזמנת ציוד": "Commission gear",
  "בחר משבצת ושלם. הנדירות והרמה נקבעות בדיוק לפי אותה טבלה שממנה נופל ציוד בקרב — הדבר היחיד שאתה קונה הוא המשבצת. שווה ערך ל-{drops} פריטים שפורקו.":
    "Pick a slot and pay. Rarity and level roll on exactly the table gear drops from in battle — the only thing you are buying is the slot. Worth {drops} dismantled pieces.",
  "בחר משבצת": "Pick a slot",
  "הזמן {slot}": "Commission {slot}",
  "מחשל…": "Forging…",
  "משבצת לא תקינה": "Invalid slot",
  "ריק": "empty",
  "×{count}": "×{count}",
  "· סדרה {decade} (רמת גיבור {level})":
    "· series {decade} (hero level {level})",
  "הזמנה עולה {shards} רסיסים ו-{gold} זהב.":
    "A commission costs {shards} shards and {gold} gold.",
  "הנפחייה מסרה {item} (רמה {level}, {rarity}).":
    "The forge delivered {item} (level {level}, {rarity}).",
  "התיק מלא — פרק או לבש פריט לפני שתזמין חדש.":
    "The bag is full — dismantle or equip something before commissioning more.",
  "הגיבור מת — הנפחייה לא עובדת עבורו עד שיקום לתחייה.":
    "Your hero is dead — the forge will not work for him until he rises.",

  /* the temper bench */
  "ליטוש": "Tempering",
  "העלה פריט לדרגה הבאה בתוך הסדרה שלו — אותה מדרגה שהשדרוג בזהב קונה, רק שכאן משלמים ברסיסים. פריט אגדי הוא שיא הסדרה שלו ואינו ניתן לליטוש.":
    "Raise a piece to the next grade within its own series — the same step the gold upgrade buys, paid in shards instead. A legendary is its series' ceiling and cannot be tempered.",
  "התיק ריק. ציוד נופל מתקיפות שניצחת וממסעות הגיבור.":
    "The bag is empty. Gear drops from attacks you win and from your hero's expeditions.",
  "ליטוש הפריט הזה עולה {shards} רסיסים.":
    "Tempering this piece costs {shards} shards.",
  "{item} לוטש ל{rarity} (רמה {level}).":
    "{item} tempered to {rarity} (level {level}).",
  "אין לפריט הזה דרגה גבוהה יותר.": "This piece has no higher grade.",
  "פריט אגדי הוא שיא הסדרה שלו": "A legendary is its series' ceiling",
  "פריט אגדי הוא שיא הסדרה שלו — רק פריט מסדרה גבוהה יותר יעלה עליו.":
    "A legendary is its series' ceiling — only a piece from a higher series will beat it.",
  "הפריט השתנה בינתיים — נסה שוב.": "The piece changed in the meantime — try again.",

  /* ------------------------------------------------------------------ */
  /* מבנים — the capital's skyline                                    */
  /* ------------------------------------------------------------------ */

  "מבנים": "Buildings",
  "מבנים | KRALDOR": "Buildings | KRALDOR",
  "מבני הבירה": "Buildings of the capital",
  "אתר הבנייה של הבירה": "The capital's build site",
  "{monument} — רמה {level} מתוך {max}": "{monument} — level {level} of {max}",
  "המבנים אינם זמינים כרגע. נסה לרענן.":
    "Buildings are unavailable right now. Try refreshing.",
  "מבנים שנבנים פעם אחת ועומדים עד סוף העונה. כל רמה מוסיפה {pct}% לאחד ממקורות ההכנסה של האימפריה — ואף מבנה אינו נוגע בכוח הקרב.":
    "Structures raised once and standing until the season ends. Every level adds {pct}% to one of the empire's sources of income — and no building touches combat power.",
  "רמות שהועלו מתוך כל הרמות האפשריות": "Levels raised out of every level on offer",
  "רמות": "levels",
  "רמה {level}/{max}": "Level {level}/{max}",
  "לחץ על מבנה במפה כדי לבנות או לשדרג אותו.":
    "Tap a building on the map to raise or upgrade it.",
  "אחרי הבנייה": "After building",
  "עלות הרמה הבאה": "Next level costs",
  "עלות הייסוד": "Founding costs",
  "חסרים {gold} זהב": "{gold} gold short",
  "ייסד": "Found it",
  "הרם רמה": "Raise a level",
  "בונה…": "Building…",
  "במלוא גובהו": "At its full height",
  "מבנה לא תקין": "Invalid building",
  "{monument} עומד במלוא גובהו.": "{monument} stands at its full height.",
  "הרמה הבאה של {monument} עולה {gold} זהב.":
    "The next level of {monument} costs {gold} gold.",
  "{monument} הועלה לרמה {level} — {effect}.":
    "{monument} raised to level {level} — {effect}.",
  "המבנה השתנה בינתיים — נסה שוב.":
    "The building changed in the meantime — try again.",

  /* the five, and what each of them does */
  "עמוד הפועלים": "The Labourers' Column",
  "עמוד בזלת בן ארבעים מטר, ועליו חקוקים שמותיהם של אלה שחפרו את המכרות הראשונים.":
    "Forty metres of basalt, carved with the names of those who dug the first mines.",
  "+{pct}% לתפוקת המכרות": "+{pct}% mine output",
  "מגדל השעון הגדול": "The Great Clock Tower",
  "פעמון אחד לכל שעה, ונשמע עד קצה הנחלה. מאז שהוקם, איש בבירה לא איחר.":
    "One bell an hour, heard to the far edge of the realm. Nobody in the capital has been late since it was raised.",
  "+{pct}% לתורות שנצברות": "+{pct}% turns accrued",
  "שער הניצחון": "The Victory Gate",
  "כל צבא שחוזר עובר תחתיו, וכל נער בעיר רואה אותו. הגיוס מאז לא היה בעיה.":
    "Every returning army marches under it, and every boy in the city watches. Recruitment has not been a problem since.",
  "+{pct}% לאזרחים בכל עדכון יומי": "+{pct}% citizens per daily update",
  "בית הגנזים": "The Hall of Records",
  "שמונה קומות מתחת לאדמה, ובהן ספרי החשבונות של האימפריה מאז ייסודה.":
    "Eight floors below ground, holding the empire's ledgers since its founding.",
  "+{pct}% לריבית הבנק": "+{pct}% bank interest",
  "גלגל השמיים": "The Sky Wheel",
  "מבנה שאיש אינו יודע להסביר, שממשיך להסתובב גם כשאין רוח. העם מייחס לו מזל.":
    "A structure nobody can explain, still turning when there is no wind. The people credit it with luck.",
  "+{pct}% לסיבובי גלגל המזל היומיים": "+{pct}% daily wheel spins",

  /* ------------------------------------------------------------------ */
  /* אוצר הברית — the guild treasury                                      */
  /* ------------------------------------------------------------------ */

  "אוצר הברית": "Guild treasury",
  "הזהב שנתרם על ידי חברי הברית — ממנו משולמים שדרוגי הברית":
    "Gold donated by the guild's members — the guild's upgrades are paid out of it",
  "כל חבר יכול לתרום זהב. מנהיג או סגן קונים מהאוצר את שדרוגי הברית. אין משיכה — מה שנכנס נשאר של הברית.":
    "Any member can donate gold. A leader or deputy buys the guild's upgrades out of the treasury. There is no withdrawal — what goes in stays the guild's.",
  "סכום לתרומה (מינימום {min})": "Amount to donate (minimum {min})",
  "תרום": "Donate",
  "תורם...": "Donating…",
  "תורמי הברית": "The guild's donors",
  "איש עדיין לא תרם. תהיה הראשון.": "Nobody has donated yet. Be the first.",
  "תרומה מינימלית היא {min} זהב.": "The minimum donation is {min} gold.",
  "אין לך {amount} זהב זמין לתרומה.":
    "You do not have {amount} gold available to donate.",
  "תרמת {amount} זהב לאוצר {guild}.":
    "You donated {amount} gold to {guild}'s treasury.",
  "מנהיג או סגן בלבד — משולם מאוצר הברית.":
    "Leader or deputy only — paid out of the guild treasury.",
  "ההרחבה עולה {cost} זהב מאוצר הברית — אין מספיק באוצר.":
    "The expansion costs {cost} gold from the guild treasury — there is not enough in it.",
  "השדרוג עולה {cost} זהב מאוצר הברית — אין מספיק באוצר.":
    "The upgrade costs {cost} gold from the guild treasury — there is not enough in it.",
  "רק מנהיג או סגן יכולים לשדרג את עזרת הברית.":
    "Only a leader or deputy can upgrade the guild's aid.",

  /* ------------------------------------------------------------------ */
  /* תארים — the line under a name                                       */
  /* ------------------------------------------------------------------ */

  "תארים": "Titles",
  "תארים | KRALDOR": "Titles | KRALDOR",
  "התואר שלך": "Your title",
  "התארים אינם זמינים כרגע. נסה לרענן.":
    "Titles are unavailable right now. Try refreshing.",
  "התואר מופיע לצד שמך בכל מקום שבו משווים בין שחקנים: בתיק השחקן, בסולם העיר ובטבלאות המובילים, ברשימת חברי הברית, בזירה, בלוח המלחמה, בפודיום העונה ובשיאי העולם. הוא לא מוסיף כוח, לא משאבים ולא הגנה — הוא רק שלך.":
    "Your title appears beside your name everywhere players are compared: your dossier, the city ladder and the leaderboards, your guild roster, the arena, the war board, the season podium and the world records. It adds no power, no resources and no protection — it is simply yours.",
  "נדיר": "Rare",
  "רגיל": "Common",
  /* "אגדי" is the item-rarity word, already in the dictionary above — the tiers
     deliberately reuse the vocabulary players learned from hero gear. */
  "אפשר להשיג אותם כבר בשבועות הראשונים של המשחק.":
    "You can get these in your first few weeks of playing.",
  "צריך לשחק הרבה בשביל אלה. לא לכל אחד יש אותם.":
    "These take a lot of playing. Not everyone has them.",
  "הכי קשים במשחק. רק מעטים מגיעים אליהם בכל עונה.":
    "The hardest in the game. Only a few players reach them each season.",
  "הושגו {earned} · נרכשו {owned}": "{earned} earned · {owned} bought",
  "ללא תואר": "No title",
  "ענוד": "Wear",
  "עונד…": "Wearing…",
  "נעול": "Locked",
  "תארים שמושגים במשחק": "Titles earned in play",
  "אי אפשר לקנות אותם בשום מחיר — רק לשחק ולהשיג. הם מסודרים לפי דרגת קושי: ככל שהדרגה גבוהה יותר, כך קשה יותר להשיג את התואר.":
    "They cannot be bought at any price — you play for them. They are sorted by difficulty: the higher the grade, the harder the title is to get.",
  "חנות התארים": "The title shop",
  "נרכשים ביהלומים, ואינם מתיימרים להיות הישג. מי שקורא את הדירוג יידע להבדיל.":
    "Bought with diamonds, and making no claim to be an achievement. Anyone reading the ladder will know the difference.",
  "תואר לא תקין": "Invalid title",
  "את התואר הזה משיגים במשחק, לא בקנייה.":
    "That title is earned in play, not bought.",
  "התואר הזה כבר שלך.": "That title is already yours.",
  "התואר הזה עדיין לא נרכש.": "That title has not been bought yet.",
  "התואר עולה {price} יהלומים — אין לך מספיק.":
    "The title costs {price} diamonds — you do not have enough.",
  'התואר "{title}" נרכש. אפשר לענוד אותו עכשיו.':
    'The title "{title}" is yours. You can wear it now.',
  'ענדת את התואר "{title}".': 'You are now wearing the title "{title}".',
  "הסרת את התואר.": "You have taken your title off.",
  "עדיין לא עמדת בתנאי של התואר הזה: {hint}":
    "You have not met that title's condition yet: {hint}",

  /* the earned shelf — common */
  "הפושט": "The Raider",
  "נצח ב-{wins} תקיפות על שחקנים אחרים":
    "Win {wins} attacks on other players",
  "צל המלך": "The King's Shadow",
  "שלח מרגלים וחזור עם {reports} דוחות ריגול מוצלחים":
    "Send spies and come back with {reports} successful reports",
  "החומה": "The Wall",
  "הגן על האימפריה שלך ונצח ב-{defenses} תקיפות של אחרים עליך":
    "Defend your empire and win {defenses} battles against attackers",
  "הוותיק": "The Veteran",
  "העלה את הגיבור שלך לרמה {heroLevel}": "Take your hero to level {heroLevel}",

  /* the earned shelf — rare */
  "צייד הבוסים": "The Boss Hunter",
  "נצח את הבוס של {bosses} דרגות ערים שונות":
    "Beat the boss of {bosses} different city tiers",
  "האגדה": "The Legend",
  "אסוף {legendaryItems} פריטים בדרגת אגדי לגיבור שלך":
    "Collect {legendaryItems} legendary items for your hero",
  "מצביא הדורות": "Warlord of Ages",
  "הגע עם הגיבור לרמה {cap}, אפס אותו, וטפס שוב עד רמה {warlordLevel}":
    "Take your hero to level {cap}, reset it, then climb back to level {warlordLevel}",
  "הקיסר": "The Emperor",
  "הגע לעיר האחרונה והחזק את כל {cities} הערים":
    "Reach the last city and hold all {cities} of them",

  /* the earned shelf — legendary */
  "מפיל הכתרים": "Crownbreaker",
  "נצח את הבוס של כל {allBosses} דרגות הערים — בלי לפספס אף אחד":
    "Beat the boss of all {allBosses} city tiers — without missing one",
  "בן האלמוות": "The Deathless",
  "הגע עם הגיבור לרמה {cap} ואפס אותו — {resets} פעמים":
    "Take your hero to level {cap} and reset it — {resets} times",
  "אימת הממלכות": "Dread of Kingdoms",
  "נצח ב-{greatWins} תקיפות על שחקנים אחרים":
    "Win {greatWins} attacks on other players",

  /* the shop shelf — boasts, not feats */
  "בעל המאה": "The Moneyed",
  "האספן": "The Collector",
  "המהמר": "The Gambler",
  "מי שלא ישן": "The One Who Never Sleeps",
  "הנדיב": "The Generous",
  "המשוגע לדבר": "Utterly Obsessed",
  "נקנה בחנות התארים": "Bought in the title shop",

  /* ------------------------------------------------------------------ */
  /* מפלצת העולם — the world boss                                        */
  /* ------------------------------------------------------------------ */

  "מפלצת העולם": "World Boss",
  "מפלצת העולם | KRALDOR": "World Boss | KRALDOR",
  "הזירה אינה זמינה כרגע. נסה לרענן.":
    "The arena is unavailable right now. Try refreshing.",
  "אין מפלצת עולם השבוע.": "There is no world boss this week.",
  "{count} נלחמים": "{count} fighting",
  "השבוע נגמר": "the week is over",
  "{d}י {h}ש": "{d}d {h}h",
  "{h}ש": "{h}h",

  /* striking */
  "הכה": "Strike",
  "מכה…": "Striking…",
  "כל מכה עולה תורות": "Every strike costs turns",
  "{left}/{max} מכות": "{left}/{max} strikes",
  "מספר המכות מוגבל כדי שלוח הנזק לא יהיה עותק של דירוג הכוח":
    "Strikes are capped so the damage board is not simply a copy of the power ladder",
  "מכה עולה {turns} תורות.": "A strike costs {turns} turns.",
  "ניצלת את כל {max} המכות שלך השבוע.":
    "You have used all {max} of your strikes this week.",
  "{boss} כבר הופלה השבוע.": "{boss} has already been felled this week.",
  "פגעת ב{boss} ב-{damage} נזק. נותרו לה {hp} חיים.":
    "You hit {boss} for {damage} damage. It has {hp} health left.",
  "המכה שלך הפילה את {boss}! {diamonds} יהלומים על המכה האחרונה.":
    "Your blow felled {boss}! {diamonds} diamonds for the killing strike.",

  /* the kill and the spoils */
  "המפלצת הופלה!": "The beast is down!",
  "המכה האחרונה: {name}": "Killing blow: {name}",
  "המפלצת עדיין עומדת — אין שלל לחלק.":
    "The beast is still standing — there are no spoils to divide.",
  "לא הכית את המפלצת השבוע.": "You did not strike the beast this week.",
  "לא הכית את המפלצת השבוע — אין חלק בשלל.":
    "You did not strike the beast this week — no share of the spoils.",
  "כבר אספת את חלקך.": "You have already collected your share.",
  "אספת את חלקך.": "You have collected your share.",
  "חלקך בשלל: {spoils}. ({pct}% מהנזק)":
    "Your share of the spoils: {spoils}. ({pct}% of the damage)",

  /* the damage board */
  "לוח הנזק": "Damage board",
  "הנזק שלך: {damage}": "Your damage: {damage}",
  "×{hits}": "×{hits}",
  "אף אחד עדיין לא הכה. תהיה הראשון.":
    "Nobody has struck yet. Be the first.",
  "חצי מהשלל מתחלק שווה בשווה בין כל מי שהכה, וחצי לפי נזק. מי שמפיל אותה מקבל {diamonds} יהלומים לעצמו.":
    "Half the spoils are split evenly among everyone who struck, and half by damage. Whoever fells it takes {diamonds} diamonds for themselves.",

  /* the six beasts */
  "תולעת האפר": "The Ashworm",
  "היא עלתה מתחת לארץ האפר ובלעה שיירה שלמה לפני שמישהו הספיק לצעוק. הדרך דרומה סגורה עד שהיא תיפול.":
    "It came up beneath the Ashlands and swallowed a whole caravan before anyone could shout. The southern road is closed until it falls.",
  "קולוסוס הברזל": "The Iron Colossus",
  "מבנה בגובה חומה שצועד לאט ולא עוצר. איש אינו יודע מי בנה אותו ולא ברור שיש בפנים מישהו.":
    "A wall-high thing that walks slowly and does not stop. Nobody knows who built it, and it is not clear anyone is inside.",
  "דרקון הסופה": "The Storm Drake",
  "הוא מגיע עם העננים ויוצא מהם רק כדי לקחת. שלוש ערים כבר איבדו את גגותיהן השבוע.":
    "It arrives with the clouds and leaves them only to take. Three cities have lost their roofs this week.",
  "מבשר הדבר": "The Plague Herald",
  "הוא אינו נלחם. הוא פשוט עומד, והמכרות שסביבו מפסיקים להפיק. זה מספיק.":
    "It does not fight. It simply stands, and the mines around it stop producing. That is enough.",
  "רוח הכתר": "The Crown Wraith",
  "מה שנשאר מהקיסר האפל הראשון, ומה שהוא רוצה זה בדיוק מה שיש לך.":
    "What is left of the first Dark Emperor, and what it wants is exactly what you have.",
  "לווייתן המעמקים": "The Deep Leviathan",
  "הנמלים ריקים מאז יום שלישי. הדייגים אומרים שהם ראו עין, ואיש לא צחק.":
    "The harbours have been empty since Tuesday. The fishermen say they saw an eye, and nobody laughed.",

  /* ------------------------------------------------------------------ */
  /* חבלה — sabotage                                                     */
  /* ------------------------------------------------------------------ */

  "חבלה": "Sabotage",
  "משימות חבלה פוגעות בכלכלה בלבד — מלאי, זהב ועבדי מכרות. הן לעולם לא נוגעות בחיילים, בנשק או בכוח. נדרש יתרון מודיעיני של פי {margin} לפחות, וכישלון עולה בכל התא.":
    "Sabotage hits the economy only — stores, gold and mine slaves. It never touches soldiers, weapons or power. It needs an intelligence advantage of at least {margin}×, and failure costs the whole cell.",
  "({pct}%)": "({pct}%)",
  "מרגלים שנשלחים — אובדים אם התא נתפס":
    "Spies committed — lost if the cell is caught",
  "שולח…": "Sending…",
  "על היעד יש מגן פעיל שחוסם את המשימה הזו":
    "The target has an active shield that blocks this mission",
  "{target} תמיד מקבל התראה על חבלה — מוצלחת או שנתפסה.":
    "{target} is always alerted to sabotage — whether it lands or is caught.",

  "משימת חבלה לא תקינה": "Invalid sabotage mission",
  "לא ניתן לחבל באימפריה שלך": "You cannot sabotage your own empire",
  "לא ניתן לחבל באימפריה שאינה בעיר שלך.":
    "You cannot sabotage an empire outside your own city.",
  "נדרשים {count} מרגלים למשימה הזו.":
    "That mission needs {count} spies.",
  "המשימה עולה {turns} תורות.": "The mission costs {turns} turns.",
  "על {target} יש מגן פעיל — המשימה הזו לא תעבור.":
    "{target} has an active shield — this mission will not get through.",
  '"{mission}" הצליחה נגד {target}.': '"{mission}" succeeded against {target}.',
  '"{mission}" נכשלה — התא נתפס ו-{spies} מרגלים אבדו.':
    '"{mission}" failed — the cell was caught and {spies} spies were lost.',
  '{attacker} ביצע "{mission}" נגדך. בדוק את ההיסטוריה לפרטים.':
    '{attacker} ran "{mission}" against you. Check your history for the details.',
  "כוחות הביטחון שלך תפסו תא חבלה של {attacker} לפני שהספיק לפעול.":
    "Your security forces caught a sabotage cell from {attacker} before it could act.",

  /* the three missions */
  "הצתת המחסנים": "Torch the Warehouses",
  "שריפת חלק מהמלאי המוגן במחסני היעד — עץ, ברזל ואבן.":
    "Burns part of the protected stock in the target's warehouses — wood, iron and stone.",
  "שוד הגנזך": "Raid the Vault",
  "גניבת חלק מהזהב הזמין של היעד — ישר לקופה שלך.":
    "Steals part of the target's available gold — straight into your own coffers.",
  "הרעלת הבארות": "Poison the Wells",
  "חיסול חלק מעבדי המכרות של היעד. המכרות שלו יאטו עד שיחליף אותם.":
    "Kills part of the target's mine slaves. Their mines run slower until they are replaced.",

  /* ------------------------------------------------------------------ */
  /* הזמנת חבר — referrals                                               */
  /* ------------------------------------------------------------------ */

  "הזמנת חברים": "Invite friends",
  "הזמנת חברים | KRALDOR": "Invite friends | KRALDOR",
  "הזמן חבר": "Invite a friend",
  "העמוד אינו זמין כרגע. נסה לרענן.":
    "This page is unavailable right now. Try refreshing.",
  "שלח את הקישור שלך. מי שנרשם דרכו נקשר אליך אוטומטית, וכשהוא מגיע ל-{goal} ערים כל אחד מכם אוסף את חלקו. אין פרס על הרשמה בלבד: זה מה שהופך את זה למשהו ששווה לעשות.":
    "Send your link. Anyone who signs up through it is linked to you automatically, and once they reach {goal} cities you each collect your half. Nothing is paid for a signup alone — that is exactly what makes this worth doing.",
  "העתק": "Copy",
  "העתק קישור": "Copy link",
  "שתף": "Share",
  "או תן לו את הקוד:": "Or give them the code:",
  "הועתק!": "Copied!",
  "על כל חבר:": "Per friend:",
  "נאספו {paid} מתוך {cap} הזמנות לעונה הזו.":
    "{paid} of {cap} invites collected this season.",
  "בוא לשחק איתי בקראלדור — הקם אימפריה, כבוש ערים ותפוס מקום בטבלה: {link}":
    "Come play KRALDOR with me — build an empire, take cities and climb the ladder: {link}",

  /* the review, as the players see it */
  "ההזמנה הזו ממתינה לבדיקה של הצוות. הפרס נשמר עד שתאושר.":
    "This invite is waiting on a staff check. The reward is held until it is approved.",
  "ההזמנה הזו ממתינה לבדיקה של הצוות. הפרס יישמר עד שתאושר.":
    "This invite is waiting on a staff check. The reward will be held until it is approved.",
  "ההזמנה הזו לא אושרה. אם לדעתך זו טעות, פנה לתמיכה.":
    "This invite was not approved. If you think that is a mistake, contact support.",
  "בבדיקה": "Under review",
  "לא אושר": "Not approved",

  /* who brought me */
  "מי הזמין אותך": "Who invited you",
  "הצטרפת דרך {name}.": "You joined through {name}.",
  "ההתקדמות שלך": "Your progress",
  "הגעת דרך קישור? הקישור נקשר לבד בהרשמה. אם מישהו נתן לך רק קוד או שם אימפריה — רשום אותו כאן. אפשר פעם אחת בלבד, ורק בתחילת הדרך.":
    "Arrived through a link? It attaches itself at signup. If somebody gave you only a code or an empire name, enter it here. Once only, and only early on.",
  "קוד הזמנה או שם האימפריה שהזמינה אותך":
    "Invite code, or the name of the empire that invited you",
  "רשום": "Register",
  "רושם...": "Registering…",
  "נפתח ב-{goal} ערים": "Opens at {goal} cities",
  "הוזמנת על ידי {name}. שניכם תקבלו פרס כשתגיע ל-3 ערים.":
    "You were invited by {name}. You will both be rewarded when you reach 3 cities.",

  /* who I brought */
  "החברים שהבאת": "The friends you brought",
  "עדיין לא הבאת אף אחד. שלח את הקישור שלך לחבר.":
    "You have not brought anyone in yet. Send a friend your link.",
  "ממתין ל-{goal} ערים": "Waiting for {goal} cities",

  /* the actions */
  "קוד או שם אימפריה לא תקינים": "Invalid code or empire name",
  "אימפריה לא תקינה": "Invalid empire",
  "כבר ציינת מי הזמין אותך.": "You have already named who invited you.",
  "אפשר לציין מזמין רק בתחילת הדרך, עד {max} ערים.":
    "You can only name an inviter early on, up to {max} cities.",
  "אי אפשר לקשר את שני החשבונות האלה.": "These two accounts cannot be linked.",
  "לא נמצאה אימפריה עם הקוד או השם הזה.":
    "No empire was found with that code or name.",
  // "יותר מדי נסיונות. נסה שוב מאוחר יותר." — the throttle on this field reuses
  // the entry the auth screens already carry; a second copy is a TS1117 error.
  "הגעת לתקרת ההזמנות לעונה הזו ({cap}).":
    "You have reached this season's invite ceiling ({cap}).",
  "{referrer} רשום כמי שהזמין אותך. שניכם תקבלו פרס כשתגיע ל-{goal} ערים.":
    "{referrer} is recorded as your inviter. You will both be rewarded when you reach {goal} cities.",
  "לא ציינת מי הזמין אותך.": "You have not named who invited you.",
  "הפרס נפתח ב-{goal} ערים.": "The reward opens at {goal} cities.",
  "כבר אספת את הפרס הזה.": "You have already collected that reward.",
  "קיבלת {spoils} על ההצטרפות דרך חבר.":
    "You received {spoils} for joining through a friend.",
  "לא הזמנת את האימפריה הזו.": "You did not invite that empire.",
  "{name} עדיין לא הגיע ל-{goal} ערים.":
    "{name} has not reached {goal} cities yet.",
  "כבר אספת את הפרס על {name}.":
    "You have already collected the reward for {name}.",
  "קיבלת {spoils} על שהבאת את {name}.":
    "You received {spoils} for bringing {name} in.",

  /* ------------------------------------------------------------------ */
  /* mini-games: מפת האוצר and חידה                                      */
  /* ------------------------------------------------------------------ */

  "מפת האוצר": "Treasure Map",
  "כל חפירה מגלה כמה קרוב היית — לא לאן ללכת.":
    "Every dig tells you how close you were — not which way to go.",
  "שורה {row}, עמודה {col}": "Row {row}, column {col}",
  "שורה {row}, עמודה {col} — {band}": "Row {row}, column {col} — {band}",
  "🗺️ {band}": "🗺️ {band}",
  /* the four readings a dig can come back with */
  "כאן!": "Here!",
  "חם": "Hot",
  "פושר": "Warm",
  "קר": "Cold",

  "חידה": "Riddle",
  "התשובה שלך": "Your answer",
  "ענה": "Answer",
  "בודק…": "Checking…",
  "❓ לא זו התשובה…": "❓ That is not it…",

  /* the takeover copy for both */
  "מפה חדשה הגיעה לנמל": "A new map has reached the harbour",
  "משהו קבור על הרשת. כל חפירה מספרת כמה קרוב היית — ולא יותר מזה.":
    "Something is buried on the grid. Every dig tells you how close you were — and nothing more.",
  "🗺️ קדימה, לחפירה!": "🗺️ Go on, start digging!",
  "חידה חדשה נתלתה בכיכר": "A new riddle is up in the square",
  "שאלה אחת, תשובה אחת. מי שיודע — יודע.":
    "One question, one answer. Either you know it or you do not.",
  "❓ קדימה, לחידה!": "❓ Go on, take a guess!",

  /* ------------------------------------------------------------------ */
  /* raid notifications                                                  */
  /* ------------------------------------------------------------------ */

  "התראות במייל": "Email notifications",
  "מייל קצר כשמישהו פורץ את ההגנות שלך, שולח תא חבלה או נתפס מרגל בשטחך — כדי שתדע גם כשאתה לא במשחק. לכל היותר מייל אחד ב-6 שעות, והוא לא מפרט מה נלקח.":
    "A short email when somebody breaches your defences, sends a sabotage cell, or has a spy caught on your ground — so you know even when you are not in the game. At most one email every 6 hours, and it never says what was taken.",
  "התראות פעילות": "Notifications on",
  "התראות כבויות": "Notifications off",
  "התראות הופעלו.": "Notifications enabled.",
  "התראות בוטלו.": "Notifications disabled.",

  /* ------------------------------------------------------------------ */
  /* הזירה — the weekly arena                                            */
  /* ------------------------------------------------------------------ */

  "הזירה": "The Arena",
  "הזירה | KRALDOR": "The Arena | KRALDOR",
  "אסוף שלל": "Collect spoils",
  "הזירה של השבוע": "This week's arena",
  "תוצאות הזירה": "Arena results",
  "כל מי שנרשם נלחם בכל השאר בדיוק פעם אחת, כשהשבוע מסתיים. אתה לא צריך להיות מחובר — הזירה נלחמת לבד. הזירה מוגבלת לעיר שלך, וכ-{luck}% מהתוצאה הם מזל, כדי שגם אימפריה קטנה תיקח קרבות.":
    "Everyone entered fights everyone else exactly once when the week ends. You do not need to be online — the arena fights itself. It is confined to your own city, and about {luck}% of each duel is luck, so a small empire still takes fights.",
  "נרשמו": "entered",
  "הירשם לזירה": "Enter the arena",
  "נרשם…": "Entering…",
  "הזירה מלאה השבוע": "The arena is full this week",
  "אתה בפנים. הקרבות ייערכו בסוף השבוע.":
    "You are in. The fights happen when the week ends.",
  "נלחמת בעוד": "Fought in",
  "עוד רגע": "any moment",
  "מקום {place}": "Place {place}",
  "לא נרשמת לזירה הזו.": "You did not enter that arena.",
  "הטבלה הסופית": "The final table",
  "מי נרשם": "Who has entered",
  "עדיין אף אחד לא נרשם. היה הראשון.": "Nobody has entered yet. Be the first.",

  "כבר נרשמת לזירה של השבוע.": "You have already entered this week's arena.",
  "הזירה של השבוע מלאה ({max} משתתפים).":
    "This week's arena is full ({max} entrants).",
  "הרשמה לזירה עולה {turns} תורות.": "Entering the arena costs {turns} turns.",
  "נרשמת לזירה של השבוע. הקרבות ייערכו כשהשבוע יסתיים.":
    "You have entered this week's arena. The fights happen when the week ends.",
  "אין לך שלל זירה לאסוף.": "You have no arena spoils to collect.",
  "כבר אספת את השלל הזה.": "You have already collected those spoils.",
  "מקום {place} בזירה, {wins} ניצחונות. קיבלת {spoils}.":
    "Place {place} in the arena, {wins} wins. You received {spoils}.",
  "מקום {place} בזירה, {wins} ניצחונות. קיבלת {spoils} — פרסי הפודיום נפתחים מ-{min} משתתפים.":
    "Place {place} in the arena, {wins} wins. You received {spoils} — podium prizes open from {min} entrants.",
  "פרסי הפודיום (היהלומים) נפתחים מ-{min} משתתפים. מתחת לזה הזירה עדיין נלחמת ומשלמת על השתתפות ועל כל ניצחון.":
    "Podium prizes (the diamonds) open from {min} entrants. Below that the arena still fights and still pays for entering and for every win.",
  "חשבונות הנהלה אינם משתתפים בזירה.":
    "Staff accounts do not take part in the arena.",

};
