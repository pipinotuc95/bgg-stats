# Statistiche partite BGG

Sito statico (GitHub Pages) con le statistiche delle partite BGG dell'utente **THE_B** per
Briscola, TreSette, Ciapanò, Take 5, Buraco, Carcassonne, Catan e Ticket to Ride,
più le statistiche per coppie (Briscola, TreSette, Buraco) scegliendo 4 giocatori.

## Messa online
1. Crea un repository GitHub e carica questi file sul branch `main`.
2. Registra un'applicazione su https://boardgamegeek.com/applications e crea un token.
3. Nel repository: *Settings → Secrets and variables → Actions → New repository secret*,
   nome `BGG_TOKEN`, valore = il token.
4. *Settings → Pages → Source: GitHub Actions*.
5. *Actions → "Aggiorna statistiche BGG e pubblica" → Run workflow*.
   Poi si aggiorna da solo ogni giorno.

## Coppie
Nelle partite a 4 le coppie vengono riconosciute, in quest'ordine, da:
1. campo **colore/squadra** del giocatore su BGG (es. "A"/"B");
2. i **due vincitori** contro i due perdenti;
3. **punteggi uguali** a due a due.

## Personalizzare
`config.json` contiene i nomi dei giochi (espressioni regolari sul nome BGG).

## Senza token: file scaricato dal browser
Finché BGG non approva l'applicazione si può usare il bookmarklet in `tools/scarica-partite.js`
(da cliccare su boardgamegeek.com da loggati): scarica `bgg-plays.xml`.
Caricalo nella cartella `data/` del repository (Add file → Upload files): la GitHub Action
lo converte e pubblica il sito. Con `BGG_TOKEN` impostato il file non serve più.
