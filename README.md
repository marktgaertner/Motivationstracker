# Erfolgstracker

Persönlicher Erfolgstracker als eigenes Programm: Workouts, schnelle Essens-Check-ins, Meilensteine (Uni, Praktikum, Sidehustle …), Finanzen (Fixkosten, Einnahmen, Ausgaben, Sparziel) und Session-Erfolge – alles auf einem Dashboard mit Punkten, Leveln und Streaks.

- **Keine Abhängigkeiten.** Nur Node.js (≥ 18). Kein Build, kein Hosting, keine Kosten.
- **Daten gehören dir.** Alles liegt als lesbare JSON-Dateien in `data/`. Jedes Tool (oder du per Hand) kann sie bearbeiten.
- **Aktualisiert sich aus Sessions.** Claude-Sessions tragen Erfolge über das CLI ein und committen sie; beim nächsten `git pull` ist das Dashboard aktuell.

## Einrichtung (einmalig)

1. **Node.js installieren** (falls `node -v` im Terminal nichts ausgibt):
   - Windows: `winget install OpenJS.NodeJS.LTS` in der Eingabeaufforderung, oder Installer von https://nodejs.org/ (LTS). Danach ein neues Terminal öffnen.
   - macOS: `brew install node` oder Installer von https://nodejs.org/.
2. **Repository holen:**
   ```bash
   git clone https://github.com/marktgaertner/Motivationstracker.git
   cd Motivationstracker
   ```
   Ohne Git: auf GitHub „Code → Download ZIP“, entpacken, Terminal im entpackten Ordner öffnen.

## Start

Windows: Doppelklick auf `start.bat` (prüft Node, startet den Server, öffnet den Browser).

macOS/Linux: `./start.sh`

Oder in jedem Terminal **im Projektordner**:

```bash
npm start
```

Dann im Browser `http://127.0.0.1:4321` öffnen. Der Server läuft nur lokal (127.0.0.1). Beenden mit `Strg+C`.

Ohne Server geht es auch: `public/index.html` direkt im Browser öffnen. Dann werden die Daten nur im Browser (localStorage) gespeichert – Import/Export gibt es unter Einstellungen.

## Bedienung

| Bereich | Was passiert |
|---|---|
| Übersicht | Punkte & Level, Workouts/Woche gegen Ziel, Essens-Score, freies Monatsbudget, Aktivitäts-Heatmap, nächste Meilensteine, letzte Erfolge |
| Workouts | Eintragen (Typ, Minuten, Intensität, Notiz), Wochenverlauf, Streak „Wochen in Folge Ziel erreicht“ |
| Essen | 15-Sekunden-Umfrage: Mahlzeitenqualität, Gemüse, Snacks, Wasser, Alkohol, Stimmung → Score 0–10, 14-Tage-Verlauf |
| Meilensteine | Uni (mit Note & ECTS → gewichteter Schnitt), Praktikum, Sidehustle, Fitness, Finanzen, Persönlich |
| Finanzen | Fixkosten & Einnahmen mit Intervall (monatlich/vierteljährlich/jährlich/wöchentlich), variable Ausgaben, Sparziel |
| Sessions | Erfolge aus Arbeits-/Claude-Sessions mit frei wählbaren Punkten |
| ⚙︎ | Ziele (Workouts/Woche, Wasser), Name, Währung, Export/Import |

Tastatur: `1`–`6` wechseln die Bereiche.

## Kommandozeile

```bash
node tracker.js summary                                   # Textübersicht
node tracker.js workout Kraft 45 "Push Tag"
node tracker.js checkin --meals 4 --veggies --snacks 1 --water 6 --mood 4
node tracker.js milestone add "Statistik II" --cat uni --due 2027-02-10
node tracker.js milestone done "Statistik II" --grade 1.7 --ects 5
node tracker.js session "Landingpage live" "Nächster Schritt: erste 10 Besucher" --points 25
node tracker.js fixed add Miete 650 monthly
node tracker.js income add BAföG 900 monthly
node tracker.js expense 23.50 Essen "Wocheneinkauf"
node tracker.js help
```

Alle Befehle akzeptieren `--date YYYY-MM-DD` für Nachträge.

## Punkte & Level

| Ereignis | Punkte |
|---|---|
| Workout | 10 + 1 je 5 Minuten (max. 40) |
| Essens-Check-in | 5, +3 ab Score 7 |
| Meilenstein Uni | 60, Bonus +40 (Note ≤ 1,5), +25 (≤ 2,0), +10 (≤ 2,5) |
| Meilenstein Praktikum | 100 |
| Meilenstein Sidehustle | 60 |
| Andere Meilensteine | 40 |
| Session-Erfolg | frei, Standard 15 |

Level: Start 0 · Anlauf 100 · Routine 250 · Momentum 500 · Disziplin 850 · Fokus 1300 · Flow 1900 · Ausdauer 2600 · Meister 3500 · Legende 4600 · Unaufhaltsam 6000. Regeln stehen in `public/stats.js` und lassen sich dort anpassen.

## Datenstruktur

```
data/
  settings.json    { name, weeklyWorkoutGoal, dailyWaterGoal, currency }
  workouts.json    [{ id, date, type, minutes, intensity, note }]
  checkins.json    [{ id, date, meals 1-5, veggies, snacks 0-2, water, alcohol, mood 1-5, note }]
  milestones.json  [{ id, title, category, due, done, doneAt, grade, ects, note }]
  finances.json    { fixedCosts[], income[], expenses[], savings: { target, current } }
  sessions.json    [{ id, date, title, summary, points }]
```

Backup: Ordner `data/` kopieren oder in der App exportieren. Da die Daten persönlich sind, sollte das Repository privat bleiben.

## Projektstruktur

```
server.js        lokaler HTTP-Server + JSON-API (/api/data, /api/<sammlung>)
tracker.js       CLI
lib/store.js     Dateispeicher (wird von Server und CLI geteilt)
public/          Frontend ohne Build: index.html, app.js, style.css
public/stats.js  Auswertungslogik, gemeinsam für Browser und Node
test.js          Tests der Auswertungslogik: npm test
```

## Mögliche nächste Schritte

- Automatischer Import von Workouts aus Strava/Apple Health/Google Fit (CSV-Import wäre der günstigste Weg).
- Wöchentlicher Bericht per CLI (`summary --week`), z. B. als Cron.
- Sidehustle-Kennzahlen (Umsatz, Kunden) als eigene Sammlung.
