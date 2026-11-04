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
```

## Entwicklung

- `npm test` vor jedem Commit (Auswertungslogik in `public/stats.js`).
- Frontend bleibt ohne Build-Schritt und ohne externe Abhängigkeiten. Nach Änderungen in `public/` immer `npm run build` ausführen und `dist/erfolgstracker.html` mitcommitten (der Nutzer benutzt die Einzeldatei auf einem PC ohne Node).
- Der Nutzer speichert über die GitHub-API direkt in `data/*.json`. Vor eigenen Einträgen immer `git pull`, damit keine Änderungen überschrieben werden.
- Punkte-/Level-Regeln nur in `public/stats.js` ändern, nie doppelt im Frontend.
- Daten in `data/*.json` nie löschen oder umstrukturieren, ohne dass der Nutzer es verlangt.
