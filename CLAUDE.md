# Erfolgstracker – Hinweise für Claude-Sessions

Dieses Repo ist ein persönlicher Erfolgstracker (Node ≥ 18, keine Abhängigkeiten). Details: README.md.

## Am Ende jeder Session: Erfolg eintragen

Wenn in einer Session etwas Nennenswertes erreicht wurde (Feature gebaut, Problem gelöst, Meilenstein erreicht), trage es ein und committe die Datenänderung mit:

```bash
node tracker.js session "Kurzer Titel" "Was erreicht wurde und was der nächste Schritt ist" --points 15
```

Punkte-Richtwert: 10 Kleinigkeit · 15 normale Session · 25–40 großer Schritt · 50+ Meilenstein. Keine Erfolge erfinden; wenn nichts erreicht wurde, nichts eintragen.

Weitere Einträge, wenn der Nutzer sie nennt (nie ohne Angabe raten):

```bash
node tracker.js workout <Typ> <Minuten> [Notiz] [--date YYYY-MM-DD]
node tracker.js checkin --meals 1-5 [--veggies] --snacks 0-2 --water N [--alcohol] --mood 1-5
node tracker.js milestone add "Titel" --cat uni|praktikum|sidehustle|fitness|finanzen|persoenlich --due YYYY-MM-DD
node tracker.js milestone done "Titelteil" [--grade 1.7 --ects 5]
node tracker.js fixed add <Name> <Betrag> [monthly|quarterly|yearly|weekly]
node tracker.js income add <Name> <Betrag> [Intervall]
node tracker.js expense <Betrag> [Kategorie] [Notiz]
node tracker.js summary
node tracker.js ziele        # Zielbewertung 0–100 % je Lebensbereich
```

## Fotos vom Nutzer (Essen, Training, Noten, Kassenzettel)

Lädt der Nutzer hier ein Foto hoch, gehört es in den Tracker:

1. Bild ansehen und einordnen: Mahlzeit → `checkin`, Training/Fitness-App/Uhr → `workout`, Notenübersicht/Zeugnis → `milestone done --grade`, Kassenzettel → `expense`, alles andere Erreichte → `session`.
2. Nur eintragen, was im Bild erkennbar ist. Für Essen: Mahlzeitenqualität 1–5 und Gemüse ja/nein lassen sich schätzen; Snacks, Wasser, Alkohol und Stimmung nicht. Wenn der Nutzer sie nicht nennt, in **einer** kurzen Nachricht nachfragen (z. B. „Snacks heute: keine/etwas/viel? Wasser? Alkohol?“), nicht raten. Mehrere Essensfotos am selben Tag: ein Check-in pro Tag, das Bild der Hauptmahlzeit anhängen, die anderen in der Notiz erwähnen.
3. Bild nach Cloudinary hochladen (nicht ins Repo): MCP-Tool `sign-upload` mit `folder: "erfolgstracker/<JJJJ-MM>"`, `tags: ["erfolgstracker", "<essen|training|uni|finanzen|erfolg>"]`, `context: "alt=<kurze Beschreibung>"`, dann mit `curl` an `https://api.cloudinary.com/v1_1/<cloud_name>/image/upload` posten (alle `upload_params` als Formularfelder, Pfad als `-F 'file=@"<pfad>"'`). Die `secure_url` aus der Antwort als `--photo <URL>` eintragen. Datum mit `--date` setzen, wenn das Foto nicht von heute ist. Fallback ohne Cloudinary: `--photo <lokaler Pfad>` kopiert nach `data/photos/`.
4. Kurz bestätigen, was eingetragen wurde (Punkte nennen), dann `git add data && git commit && git push`.

## Konsum (Cannabis), Körper, Importe

- Nennt der Nutzer seinen Konsum („heute 4× gedampft bei 300, 1× Bong“): `node tracker.js konsum --vape 4 --temp 300 --smoke 1`. Ein Eintrag pro Tag, erneuter Aufruf überschreibt. Ziel des Nutzers: weg von Bong + Tabak, weniger und kühler verdampfen. Nicht moralisieren, Fortschritt an den Zahlen festmachen (Tage ohne Tabak, Belastung pro Woche).
- Kraftwerte: `node tracker.js lift Klimmzug 20 5` (Zusatz-kg, Wiederholungen). Kraftziel steht in settings.goals.lift.
- Gewicht: in `data/health.json` unter `weight` mit `{date, kg, source: "manuell"}` eintragen (oder im Wochen-Check).
- Apple-Health-Export (`export.zip`) hochgeladen: `node import-health.js <datei> --dry`, Vorschau zeigen, dann ohne `--dry` speichern.
- Kontoauszug-CSV hochgeladen: `node import-bank.js <datei>`, Vorschau zeigen, Kategorien mit dem Nutzer klären, dann `--apply`.
- Noten: Module als Meilensteine `category: "uni"`, `done: true`, `grade`, `ects`, `points: 0` (Historie zählt nicht als Gamification-Punkte), Nichtbestandenes als offener Meilenstein mit Versuchszähler in der Notiz.

## Wöchentlicher Coach (geplanter Task, sonntags)

Ein geplanter Task startet jede Woche eine Session, die den Wochen-Rückblick aus den Daten schreibt und den Fragebogen stellt. Antworten landen über `node tracker.js review …` in `data/reviews.json` (Feld `coach` = Empfehlung für die nächste Woche). Ohne Antwort wird nichts eingetragen. Ton: knapp, konkret, du-Form, Zahlen aus den Daten nennen, nicht belehren.

## Entwicklung

- `npm test` vor jedem Commit (Auswertungslogik in `public/stats.js`).
- Frontend bleibt ohne Build-Schritt und ohne externe Abhängigkeiten. Nach Änderungen in `public/` immer `npm run build` ausführen und `dist/erfolgstracker.html` mitcommitten (der Nutzer benutzt die Einzeldatei auf einem PC ohne Node).
- Der Nutzer speichert über die GitHub-API direkt in `data/*.json`. Vor eigenen Einträgen immer `git pull`, damit keine Änderungen überschrieben werden.
- Punkte-/Level-Regeln nur in `public/stats.js` ändern, nie doppelt im Frontend.
- Daten in `data/*.json` nie löschen oder umstrukturieren, ohne dass der Nutzer es verlangt.
