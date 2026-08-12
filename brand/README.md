# KRALDOR — נכסי מותג לדיסקורד

כל הקבצים כאן נבנים מתוך מערכת העיצוב של האתר: אותו קרסט של
`src/components/ui/Logo.tsx`, אותם צבעים מ־`src/app/globals.css`
(`--gold #c4a032`, `--gold-bright #e4c35a`, `--bone #d6c9ad`, אובסידיאן `#08080b`)
ואותו גופן — Heebo.

התיקייה הזו לא מוגשת לדפדפן (היא לא תחת `public/`), כדי לא לגרור מגה־בייט של
תמונות לכל דיפלוי.

## הקבצים

| קובץ | מידה | לאן זה הולך בדיסקורד | זמין עכשיו? |
| --- | --- | --- | --- |
| `kraldor-discord-icon-512.png` | 512×512 | Server Settings → Overview → **Server Icon** | ✅ |
| `kraldor-discord-banner-960x540.png` | 960×540 | Server Settings → Overview → **Server Banner** | ❌ דורש בוסט רמה 2 |
| `kraldor-discord-cover-1920x1080.png` | 1920×1080 | Server Settings → Invites → **Invite Splash** | ❌ דורש בוסט רמה 1 |
| `kraldor-logo-lockup-1200x400.png` | 1200×400, רקע שקוף | אמבדים, כרטיס ה־About, אווטאר של webhook להכרזות | ✅ |

השרת (`Kraldor`, guild `1533171332307484702`) הוא כרגע `premium_tier: 0` — כלומר
שני הסלוטים האלה עדיין נעולים. עד שיהיו בוסטים, הקאבר עובד יפה כתמונה נעוצה
בערוץ ההכרזות או ככותרת של פוסט "ברוכים הבאים".

הבאנר והקאבר הם *אותה* יצירה בשתי מידות, ולא שני עיצובים — לכן הם נראים כמו סט.

**הלוגו־לוקאפ שקוף נועד לרקע כהה** (הטקסט בגוון עצם בהיר). על רקע לבן הוא ייעלם.

## מחוץ לדיסקורד — דף התשלום ב־Grow

| קובץ | מידה | לאן |
| --- | --- | --- |
| `kraldor-discord-icon-512.png` | 512×512 | הגדרות העמוד ← **לוגו** (מינימום 128×128) |
| `kraldor-grow-ambience-1200x800.png` | 1200×800 | הגדרות העמוד ← **תמונת אוויר** (מינימום 493×328) |

תמונת האווירה היא הקאבר חתוך למרכז ל־3:2, כי סלוט התמונה ב־Grow צר מ־16:9 והצריחים
בתחתית הבאנר נחתכים בו. אין לה קובץ מקור נפרד — היא נגזרת:

```bash
cd brand
sips -c 1080 1620 kraldor-discord-cover-1920x1080.png --out /tmp/kr-crop.png
sips -z 800 1200 /tmp/kr-crop.png --out kraldor-grow-ambience-1200x800.png
```

הלוגו־לוקאפ **לא** מתאים כאן: דף התשלום רץ על רקע לבן (`#FFFFFF` בטאב עיצוב),
והלוקאפ שקוף עם טקסט בהיר. האייקון נושא רקע אובסידיאן משלו ולכן שורד שם.

## איך מייצרים מחדש

הכול CSS/SVG שמצולם בכרום headless — אין קובץ מקור בינארי ואין תלות בכלי גרפיקה.

```bash
cd brand/src
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

"$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=512,512   --screenshot=../kraldor-discord-icon-512.png \
  --virtual-time-budget=4000 "file://$PWD/icon.html"

"$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1920,1080 --screenshot=../kraldor-discord-cover-1920x1080.png \
  --virtual-time-budget=4000 "file://$PWD/cover.html"

"$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=960,540   --screenshot=../kraldor-discord-banner-960x540.png \
  --virtual-time-budget=4000 "file://$PWD/cover.html?w=960"

"$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --default-background-color=00000000 \
  --window-size=1200,400  --screenshot=../kraldor-logo-lockup-1200x400.png \
  --virtual-time-budget=4000 "file://$PWD/lockup.html"
```

`heebo.css` מחזיק את Heebo (עברית + לטינית, משקלים 400/700/800/900) כ־base64,
כדי שהצילום ייצא זהה גם בלי רשת. `crest.js` הוא הקרסט המשותף — כל שינוי בו
משנה את שלושת הנכסים יחד.

### שתי מלכודות ששווה לזכור
- **צילום ב־`--force-device-scale-factor=1`.** הקאבר מצויר ב־1920 ומוקטן
  ב־`transform: scale()` דרך `?w=`, אז DPR אחר יכפיל את המידה פעמיים.
- **בלי חוק מיקום גורף עם `#id > *`.** בגרסה ראשונה `#stage > *{inset:0}` בלע
  בשקט את ה־`top` של הלוקאפ ואת ה־inset של המסגרת, כי סלקטור עם id מנצח כל
  מחלקה. כל שכבה ממקמת את עצמה.
