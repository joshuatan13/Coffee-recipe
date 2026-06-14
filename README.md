# ☕ Brew Log

A lightweight, mobile-first web app to track the coffees you love and dial in
your espresso & pour over recipes. Built for coffee experimenters who like to
optimise one variable at a time.

It's a **single-page PWA** — no accounts, no backend, no build step. All data is
stored privately in your browser (`localStorage`) and the app works fully
offline once loaded. Add it to your phone's home screen and it behaves like a
native app.

## Three modes

1. **🫘 Beans** — review coffees you buy
   - Roaster, origin, variety, type, process, roast level, roast date (with a
     live "days off roast" freshness counter), altitude, price, weight
   - Roaster's tasting notes **and** your own notes
   - A 6-axis cupping score (aroma, acidity, sweetness, body, balance,
     aftertaste) plus an overall star rating
   - Free-form experience/observations for how a bean evolves

2. **☕ Espresso** — per-setup shot recipes
   - Grinder + grind setting, machine, basket
   - Dose → yield with **auto-calculated ratio**, shot time, temperature
   - Puck prep, pre-infusion, pressure, TDS/EY
   - Tasting notes + a dedicated **"what to improve next time"** field

3. **🫗 Pour Over** — per-setup brew recipes
   - Grinder + grind setting, brewer, filter paper
   - Dose : water with **auto ratio**, temperature, bloom (water + time)
   - A **step-by-step pour schedule** you can add/remove pours from
   - Agitation/technique, total brew time, drawdown, TDS/EY
   - Tasting notes + **"what to improve next time"**

Each recipe captures its **full equipment configuration**, so the same bean
brewed on a V60 Switch vs. an Orea O1 are tracked as separate, comparable
recipes. Use **Duplicate** on any recipe to clone it and tweak a single variable
for your next experiment.

## Gear

The **Gear & Settings** tab manages the equipment lists that populate the
recipe dropdowns. It comes pre-loaded with:

- **Grinders:** 1Zpresso J-Ultra, Femobook A4Z
- **Espresso machines:** Gaggia E24
- **Pour over brewers:** Glass V60 Switch, V60 Neo, Orea O1 (plastic),
  Origami (ceramic), Cafe Deep 27
- **Filter papers:** Hario V60, Cafec T90 (med-dark)

Add or remove any of these freely. The Settings section also lets you
**export/import a JSON backup** and erase all data.

## Privacy & passcode lock

Your journal lives **only in your browser on your device** — it's never sent to
a server and never committed to this repo. Each visitor gets their own empty
app, so nobody who finds the URL can see or change your data.

For on-device privacy (e.g. someone picking up your phone), set a **passcode**
in *Gear & Settings → Privacy lock*. It uses the Web Crypto API (PBKDF2 +
AES-GCM) to **encrypt your journal at rest** — when locked, the stored data is
unreadable without the passcode, and the app gates behind a lock screen on
open. There's no recovery if you forget it, so keep a JSON backup (Export).

## Running it

It's just static files — open `index.html` in any browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

For the installable PWA / offline behaviour, serve over HTTPS (e.g. GitHub
Pages) and tap your browser's "Add to Home Screen".

### Deploy to GitHub Pages

Enable Pages on this repo (Settings → Pages → deploy from branch) and the app
will be live at `https://<user>.github.io/<repo>/`.

## Inspiration

Variable choices draw on the home-coffee community (r/espresso, r/pourover) and
brewers like James Hoffmann and Lance Hedrick — temperature-by-roast-level,
bloom tuning, controlled agitation, and tracking dose/yield/ratio/time so you
always know which knob you turned.

## Tech

Vanilla HTML/CSS/JS. No dependencies. ~1 file each. Dark mode follows your
system setting.
