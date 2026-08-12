# חנות היהלומים — סליקה דרך Grow עם Make

איך kraldor גובה כסף אמיתי דרך **Grow (משולם)** כשממשק ה־API הישיר של Grow סגור,
באמצעות תרחישים (scenarios) ב־**Make**.

## למה בכלל Make

ה־Light API של Grow (`createPaymentProcess`) הוא תוסף בתשלום שלא נרכש. בלעדיו כל
קריאה ישירה חוזרת עם:

```
{"status":0,"err":{"id":701,"message":"פרמטר קוד זיהוי אינו תקין: userId"}}
```

זו לא שגיאת תצורה ואי אפשר לתקן אותה בערך אחר — אין `userId` להזין. אפליקציית
Grow ב־Make מגיעה עם החיבור שלה ואינה דורשת את התוסף, ולכן היא הדרך פנימה.
אלורה כבר עובדת ככה בפרודקשן על **אותו חשבון סוחר**.

## התמונה הגדולה

```
שחקן לוחץ על חבילת יהלומים
        │
        ▼
kraldor פותח שורת רכישה PENDING ושולח ל-Webhook של Make (תרחיש 1)
        │
        ▼
Make קורא ל-Grow "Create Payment Link" ומחזיר { url, processId, processToken }
        │
        ▼
השחקן משלם בעמוד הסליקה של Grow
        │
        ├──────────────► Grow שולח callback ל-/api/pay/grow/<secret>
        └──────────────► הדפדפן חוזר ל-/game/diamonds/buy/success
                                    │
                    שניהם עושים את אותו דבר:
                                    ▼
              kraldor שואל את Make (תרחיש 2) כמה העסקה שווה
                                    ▼
                    רק התשובה הזו מזכה יהלומים
```

## הכלל שכל המסמך הזה משרת

**Grow לא חותם על ה־callbacks שלו.** `/api/pay/grow/<secret>` הוא נתיב ציבורי,
וגוף הבקשה שמגיע אליו לא מאמת דבר. מה שמגן על החנות הוא שהסכום **נקרא בחזרה
מ־Grow** ולעולם לא מתוך גוף ה־callback ([grow.ts](../src/server/grow.ts)).

לכן **תרחיש 2 אינו רשות.** בלעדיו כל מי שינחש את הכתובת מדפיס יהלומים בחינם.
זה ההבדל מאלורה, שבה ה־callback רק מאריך מנוי ואין מה לזייף.

---

## מה לבנות ב-Make

שלושה תרחישים **חדשים**. אל תיגע בתרחיש של אלורה — הוא מוגדר להוראת קבע, ומנוי
שעובד בפרודקשן הוא לא מקום להתנסות.

לכל תרחיש: `Webhooks › Custom webhook` → מודול Grow → `Webhooks › Webhook response`.
בכל אחד, הפעל **Scheduling: ON / Immediately** בסיום.

### תרחיש 1 — יצירת קישור תשלום

שם מוצע: `kraldor-create-payment-link` → הכתובת נכנסת ל־`MAKE_GROW_CREATE_LINK_WEBHOOK_URL`.

**מה kraldor שולח** — כותרת `x-make-apikey: <MAKE_WEBHOOK_API_KEY>`, וגוף JSON:

```json
{
  "sum": "1.00",
  "description": "400 יהלומים KRALDOR",
  "fullName": "גיא מוסלאוי",
  "phone": "0525756333",
  "email": "guy@example.com",
  "successUrl": "https://kraldor.com/game/diamonds/buy/success",
  "cancelUrl":  "https://kraldor.com/game/diamonds/buy/cancel",
  "notifyUrl":  "https://kraldor.com/api/pay/grow/<GROW_CALLBACK_SECRET>",
  "cField1": "<purchaseId>"
}
```

**מודול Grow › Create Payment Link:**

| הגדרה | ערך | למה |
| --- | --- | --- |
| Sending Mode | **none** | אנחנו מפנים לקישור בעצמנו, בלי SMS |
| Payment Type | **חד־פעמי** (לא recurring) | יהלומים נמכרים פעם אחת. הוראת קבע כאן = חיוב חודשי לשחקן |
| Sum | `sum` | |
| Description | `description` | |
| Full Name | `fullName` | Grow דוחה שם בעל מילה אחת |
| Phone | `phone` | |
| Email | `email` | |
| **Notify URL** | `notifyUrl` | לשם מגיע חיווי התשלום. בלעדיו אין זיכוי |
| Success URL | `successUrl` | |
| Cancel URL | `cancelUrl` | |
| Custom Field 1 | `cField1` | מזהה שורת הרכישה שלנו, חוזר אלינו בחיווי |

**Webhook response** — סטטוס `200`, `Content-Type: application/json`, גוף:

```json
{
  "url": "{{2.data.url}}",
  "processId": "{{2.data.processId}}",
  "processToken": "{{2.data.processToken}}"
}
```

שמות הפלט אצל Grow הם `URL` / `Payment Link Process ID` / `Payment Link Process
Token` — מפה אותם למפתחות שלמעלה **בדיוק**. הקוד קורא לפי השמות האלה.

### תרחיש 2 — אימות עסקה (הקריטי)

שם מוצע: `kraldor-get-payment-info` → `MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL`.

**מה kraldor שולח** (עם אותה כותרת `x-make-apikey`):

```json
{ "processId": "…", "processToken": "…" }
```

**מודול Grow › Get Payment Link Info** — מפה `processId` ו־`processToken` מגוף הבקשה.

**Webhook response** — ארבעה שדות, בשמות האלה בדיוק:

```json
{
  "statusCode":    "{{2.data.statusCode}}",
  "transactionId": "{{2.data.transactionId}}",
  "sum":           "{{2.data.sum}}",
  "cField1":       "{{2.data.customFields.cField1}}"
}
```

שמות הפלט של המודול הזה לא מתועדים אצלנו. הרץ "Run once", בצע רכישת בדיקה,
והסתכל מה הוא באמת מחזיר — ואם השמות שונים, **תקן את המיפוי כאן ולא בקוד**.
זו הנקודה היחידה במסמך שנכתבה בלי לראות פלט אמיתי.

`statusCode` הוא מה שמכריע: `"2"` = שולם. כל ערך אחר נחשב "לא שולם", והרכישה
נשארת PENDING וגלויה ב־`/admin/purchases`. הכיוון הזה מכוון — תשלום אמיתי שתקוע
PENDING ניתן לשחזור, יהלומים שחולקו בטעות לא.

### תרחיש 3 — אישור קבלה (רשות)

שם מוצע: `kraldor-approve-transaction` → `MAKE_GROW_APPROVE_WEBHOOK_URL`.

**שולחים:** `{ "processId": "…", "transactionId": "…" }`
**מודול:** Grow › Approve Transaction. **תשובה:** `200`, הגוף לא נקרא.

בלעדיו Grow מנסה לשלוח את החיווי שוב שש פעמים בשעה. ה־webhook שלנו אידמפוטנטי
אז זה לא מזיק, רק רועש.

---

## משתני סביבה

```
MAKE_GROW_CREATE_LINK_WEBHOOK_URL=https://hook.eu2.make.com/xxxxxxxx
MAKE_GROW_PAYMENT_INFO_WEBHOOK_URL=https://hook.eu2.make.com/yyyyyyyy
MAKE_GROW_APPROVE_WEBHOOK_URL=                # רשות
MAKE_WEBHOOK_API_KEY=                         # רשות, מומלץ מאוד
GROW_CALLBACK_SECRET=<48 תווים, כבר קיים>
```

`GROW_USER_ID` ו־`GROW_PAGE_CODE` **יוצאים משימוש** — הם היו של ה־API הישיר.

**אימות מול Make** נעשה דרך `API Key authentication` בטופס יצירת הווהבוק, ולא
דרך שדה `secret` בגוף הבקשה כמו באלורה. Make אוכף אותו בקצה שלו, כך שבקשה זרה
נדחית **בלי לצרוך פעולה** מהתקרה החודשית — ובלי מודול Filter בתוך התרחיש. הגדר
את **אותו מפתח** בשלושת הווהבוקים; משתנה סביבה אחד מכסה את כולם.

שני הראשונים חייבים להיות מוגדרים יחד. תצורה חלקית משאירה את החנות על ספק הדמה
ומדווחת על עצמה ב־`purchaseBlockers()`, כדי שדיפלוי שהתכוון לגבות כסף ולא גובה
לא ייראה כמו דיפלוי שמעולם לא הוגדר.

## התקרה של Make — שווה לדעת מראש

התוכנית החינמית מוגבלת בפעולות לחודש (בסביבות 1,000 — תבדוק בתוכנית שלך). כל
רכישה צורכת פעולות משני תרחישים לפחות, **וזה אותו חשבון Make שאלורה רצה עליו**.

אם התקרה נגמרת באמצע החודש, שני המוצרים נופלים יחד: אצל אלורה מנוי חדש לא נפתח,
ואצל kraldor שחקן משלם ולא מקבל יהלומים. תדע את המספר לפני שהחנות נפתחת.

## מה כנראה לא נחוץ יותר

העמוד הקבוע **"Kraldor diamonds"** נוצר עבור ה־API הישיר, שדרש `pageCode`. מודול
ה־Create Payment Link ב־Make מייצר קישורים דרך החיבור שלו ולא ביקש קוד עמוד אצל
אלורה, ולכן ייתכן שהעמוד אינו בשימוש כלל.

**אל תמחק אותו לפני הרכישה האמיתית הראשונה.** תסתכל בעמוד הסליקה שנפתח: אם הלוגו
והרקע של kraldor מופיעים, העמוד כן משמש והוא נשאר. אם מה שמופיע הוא מיתוג החשבון
(כלומר "Allura"), זו בעיה בפני עצמה — קונה שרואה שם של עסק אחר פותח chargeback.

## סדר עלייה לאוויר

1. שלושת התרחישים ב־Make, פעילים.
2. משתני הסביבה ב־Vercel (`npm run vercel:env`) + דיפלוי.
3. הנחת אדמין 95% ב־`/admin/balance` → "ניצוץ" יורד ל־₪1.00.
4. רכישה אמיתית אחת בכרטיס שלך. לוודא: הסכום נעול בעמוד הסליקה · הכסף
   **בדשבורד של Grow** · שורה PAID ב־`/admin/purchases` · 400 יהלומים במאזן ·
   קבלה בלי שורת מע״מ (עוסק פטור).
5. להחזיר את ההנחה ל־`0`. **לפני** השלב הבא, לא אחריו.
6. `DIAMOND_PURCHASES_LIVE=true`.

האינטרלוקים ב־[`arePurchasesLive()`](../src/server/payments.ts) אוכפים את הסדר
הזה. הם לא אוכפים שבאמת הסתכלת בחשבון הבנק — וזו הבדיקה היחידה שקובעת: הסנדבוקס
של Grow כבר דיווח פעם על תשלום מוצלח לחלוטין עבור אלורה, בלי ששקל זז בשום מקום.
