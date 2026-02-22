# Heat Escape - Game Plan

## Overview

**Game ID:** `heat-escape`
**Title:** Zachraňte tepelný reaktor (Save the Heat Reactor)
**Theme:** Sci-fi futuristic station THERMOS-7, Year 2140
**Language:** Czech (cs)
**Topic:** Heat transfer physics (vedení, proudění, záření)

**Story:** Vědecká stanice THERMOS-7 vyrábí energii pomocí řízeného tepla. Došlo k poruše - jeden systém se přehřívá, druhý ztrácí teplo. Hlavní reaktor se za 25 minut automaticky vypne. Hráči musí odhalit, jak se teplo šíří, vybrat správné materiály a složit kód k restartu.

**Color Scheme (z obrázků):**
- Primary accent: Orange/Red (`#e8652e`, `#ff6b35`) - heat/energy
- Secondary accent: Cyan/Blue (`#3ecbf0`, `#2a9fd6`) - cold/technology
- Backgrounds: Dark gray (`#1a1a2e`, `#16213e`)
- Surfaces: Dark slate (`#1e2030`)
- Text: Light (`#ece9e0`)
- Success: Green (`#58c59a`)
- Danger: Red (`#ff6b6b`)

---

## File Structure

```
games/heat-escape/
├── scenes.json
├── puzzles.json
├── dialogs.json
├── game.css
├── assets/
│   ├── scenes/
│   │   ├── intro.jpg        (z 1.jpg - reaktorová místnost)
│   │   ├── room-1.jpg       (z 3.jpg - řídicí centrum)
│   │   ├── room-2.jpg       (z 5.jpg - koridor s trubkami)
│   │   ├── room-3.jpg       (z 7.jpg - izolační komora)
│   │   ├── room-4.jpg       (z 9.jpg - energetický sloup)
│   │   ├── room-5.jpg       (z 12.jpg - jádro reaktoru)
│   │   └── victory.jpg      (TBD - finální scéna)
│   └── video/
│       ├── intro.mp4        (zkopírovat z warp-engine jako placeholder)
│       └── outro.mp4        (zkopírovat z warp-engine jako placeholder)
```

---

## Game Flow (Linear Progression)

```
intro ──► room-1 ──► room-2 ──► room-3 ──► room-4 ──► room-5 ──► victory
 │          │          │          │          │          │          │
 │        3 quizzy   group+    choice+    2 choice    cloze    outro
 │        (list)    cloze      order      (list)    (summary)  video
 │                  (list)     (list)
intro
video
```

**Prerequisite:** Engine Content Panel System (see `/plans/engine-content-panels.md`)

Každá místnost:
1. Hráč vstoupí → zobrazí se Content Panel s popisem situace (rich text v průhledném overlay)
2. Klikne na puzzle ikonu → otevře se sekvence puzzlů (list)
3. Puzzly se prochází postupně, každý lze opakovat do splnění
4. Po splnění všech → nastaví se flag → šipka se zvýrazní zeleně (check OK)
5. Šipkou přejde do další místnosti

---

## Scenes Definition

### Scene 1: `intro`
- **Background:** `assets/scenes/intro.jpg` (1.jpg)
- **Description:** Úvodní místnost s reaktorem. Mise briefing.
- **Flow:**
  - Na vstupu: přehrát intro video (placeholder z warp-engine)
  - Po videu: zobrazit dialog s popisem mise
  - Šipka vpravo → `room-1`
- **Hotspots:**
  - Arrow goTo → `room-1` (vpravo dole, ~85-100%, 70-95%)

### Scene 2: `room-1` (Řídicí centrum)
- **Background:** `assets/scenes/room-1.jpg` (3.jpg)
- **Popis pro hráče:** "Řídicí systém hlásí nejasnosti v definicích tepla. Musíš ověřit základní znalosti."
- **Hotspots:**
  - Puzzle icon (~60%, 80%) → puzzleRef: `room-1-list`
  - Arrow goTo → `room-2` (~88%, 82%) - requireFlags: `["solved_room1"]`
- **Puzzle list:** `room-1-list` (3 quizzy)

### Scene 3: `room-2` (Tepelné vedení - Stanice)
- **Background:** `assets/scenes/room-2.jpg` (5.jpg)
- **Popis:** "KRITICKÁ PORUCHA: Tepelné vedení ve stanici je nestabilní. Některé materiály odvádějí teplo příliš rychle, jiné ho nebezpečně zadržují."
- **Hotspots:**
  - Puzzle icon (~62%, 82%) → puzzleRef: `room-2-list`
  - Arrow goTo → `room-3` (~88%, 82%) - requireFlags: `["solved_room2"]`
- **Puzzle list:** `room-2-list` (group + cloze)

### Scene 4: `room-3` (Únik energie)
- **Background:** `assets/scenes/room-3.jpg` (7.jpg)
- **Popis:** "NOVÝ PROBLÉM SYSTÉMU: Přenos tepla vedením je částečně pod kontrolou, ale stanice stále ztrácí velké množství tepla. Energie uniká přes stěny, potrubí a konstrukce."
- **Hotspots:**
  - Puzzle icon (~60%, 82%) → puzzleRef: `room-3-list`
  - Arrow goTo → `room-4` (~88%, 82%) - requireFlags: `["solved_room3"]`
- **Puzzle list:** `room-3-list` (choice + order)

### Scene 5: `room-4` (Ventilační systém)
- **Background:** `assets/scenes/room-4.jpg` (9.jpg)
- **Popis:** "HLÁŠENÍ VENTILAČNÍHO SYSTÉMU: Přenos tepla vedením a izolace jsou stabilizované, ale ve stanici dochází k neřízenému pohybu teplého vzduchu."
- **Hotspots:**
  - Puzzle icon (~62%, 82%) → puzzleRef: `room-4-list`
  - Arrow goTo → `room-5` (~88%, 82%) - requireFlags: `["solved_room4"]`
- **Puzzle list:** `room-4-list` (2 quizzy + choice)

### Scene 6: `room-5` (Stabilizace reaktoru - Závěrečný úkol)
- **Background:** `assets/scenes/room-5.jpg` (12.jpg)
- **Popis:** "KROK 5 - ZÁVĚREČNÝ SOUHRNNÝ ÚKOL: Pro úspěšný restart stanice THERMOS-7 je nutné ověřit, že rozumíte základním principům šíření tepla."
- **Hotspots:**
  - Puzzle icon (~62%, 82%) → puzzleRef: `room-5-cloze`
  - Arrow goTo → `victory` (~88%, 82%) - requireFlags: `["solved_room5"]`
- **Puzzle:** `room-5-cloze` (single cloze - summary)

### Scene 7: `victory`
- **Background:** `assets/scenes/victory.jpg` (TBD)
- **End scene:** `"end": true`
- **Flow:**
  - Zobrazit gratulační dialog
  - Přehrát outro video

---

## Puzzles Definition

### Room 1: `room-1-list` (kind: list)

Sekvence 3 quizzů o základech tepla.

#### Puzzle `quiz-1-1` (kind: quiz, multiSelect: true)
- **Title:** "Co je vlastně teplo?"
- **Prompt:** "Řídicí systém hlásí nejasnosti v definicích. Vyber všechna tvrzení, která o teple platí."
- **Tokens:**
  | ID | Label | Correct |
  |----|-------|---------|
  | t1 | Teplo je energie | YES |
  | t2 | Teplo je to samé co teplota | NO |
  | t3 | Teplo se může přenášet mezi tělesy | YES |
  | t4 | Teplo vždy zůstává v tělese | NO |
  | t5 | Teplo se přenáší z teplejšího na chladnější | YES |
- **solutionIds:** `["t1", "t3", "t5"]`
- **errorMessage:** "Některé odpovědi nejsou správné. Vzpomeň si, co teplo dělá a kam proudí."

#### Puzzle `quiz-1-2` (kind: quiz, multiSelect: false)
- **Title:** "Směr přenosu tepla"
- **Prompt:** "Systém potřebuje ověřit správný směr přenosu tepla. Vyber správnou možnost. Teplo se samovolně šíří:"
- **Tokens:**
  | ID | Label | Correct |
  |----|-------|---------|
  | t1 | z chladnějšího na teplejší | NO |
  | t2 | z teplejšího na chladnější | YES |
  | t3 | oběma směry současně | NO |
- **solutionIds:** `["t2"]`
- **errorMessage:** "Špatná odpověď. Přemýšlej, kam teplo přirozeně směřuje."

#### Puzzle `quiz-1-3` (kind: quiz, multiSelect: false)
- **Title:** "Testování materiálů"
- **Prompt:** "Řídicí systém testuje materiály použité ve stanici. Který z nich vede teplo nejlépe?"
- **Tokens:**
  | ID | Label | Correct |
  |----|-------|---------|
  | t1 | dřevo | NO |
  | t2 | plast | NO |
  | t3 | kov | YES |
  | t4 | sklo | NO |
- **solutionIds:** `["t3"]`
- **errorMessage:** "Špatná odpověď. Který materiál cítíš jako studený na dotek?"

#### List config `room-1-list`:
```json
{
  "kind": "list",
  "title": "Řídicí centrum - Základy tepla",
  "items": [
    { "ref": "quiz-1-1", "options": { "blockUntilSolved": true } },
    { "ref": "quiz-1-2", "options": { "blockUntilSolved": true } },
    { "ref": "quiz-1-3", "options": { "blockUntilSolved": true } }
  ],
  "summary": {
    "showScore": true,
    "messageOk": "Výborně! Základní znalosti o teplu ověřeny. Systém odemyká další sekci.",
    "messageFail": "Některé odpovědi nebyly správné. Zkus to znovu."
  }
}
```

---

### Room 2: `room-2-list` (kind: list)

Sekvence: group (třídění materiálů) + cloze (technický protokol).

#### Puzzle `group-2-1` (kind: group)
- **Title:** "Analýza materiálů"
- **Prompt:** "Systém zaznamenal materiály použité ve stanici. Rozděl je podle schopnosti vést teplo."
- **Groups:**
  | ID | Label | Style |
  |----|-------|-------|
  | g1 | Velmi dobré vodiče tepla 🔥 | warm bg |
  | g2 | Slabší vodiče | neutral bg |
  | g3 | Izolanty ❄️ | cool bg |
- **Tokens:**
  | ID | Label | → Group |
  |----|-------|---------|
  | med | měď | g1 |
  | hlinik | hliník | g1 |
  | ocel | ocel | g1 |
  | porcelan | porcelán | g2 |
  | sklo | sklo | g2 |
  | beton | beton | g2 |
  | plast | plast | g3 |
  | drevo | dřevo | g3 |
  | guma | guma | g3 |
  | vzduch | vzduch | g3 |
- **errorMessage:** "Některé materiály jsou špatně zařazené. Vzpomeň si, které materiály cítíš jako studené na dotek."

#### Puzzle `cloze-2-2` (kind: cloze)
- **Title:** "Technický protokol vedení tepla"
- **Prompt:** "Část servisního záznamu se při poruše stanice poškodila. Doplň chybějící slova z nabídky, aby text dával smysl."
- **Text:**
  ```
  „Během detailní kontroly tepelného systému stanice THERMOS-7 jsme zjistili,
  že některé části zařízení působí na dotek výrazně {gap0},
  přestože mají stejnou {gap1} jako okolní prostředí.
  Tento jev není způsoben rozdílnou teplotou, ale tím, že materiály
  jako {gap2} mají schopnost velmi {gap3} odvádět teplo z lidské ruky.
  Přenos tepla tímto způsobem se nazývá {gap4}
  a probíhá především v {gap5} látkách,
  kde jsou částice uspořádány blízko u sebe.
  Aby se přenos tepla tímto způsobem omezil,
  nejsou kovové části zařízení ponechány bez ochrany,
  ale jsou zakryty vrstvou {gap6} materiálu.
  Tato ochranná vrstva přenos tepla {gap7}
  a pomáhá zabránit {gap8} citlivých částí systému."
  ```
- **Tokens (word bank):**
  `studené`, `teplotu`, `kov`, `rychle`, `vedení`, `pevných`, `izolačního`, `zpomaluje`, `přehřívání`
- **Solution:**
  | Gap | Answer |
  |-----|--------|
  | gap0 | studené |
  | gap1 | teplotu |
  | gap2 | kov |
  | gap3 | rychle |
  | gap4 | vedení |
  | gap5 | pevných |
  | gap6 | izolačního |
  | gap7 | zpomaluje |
  | gap8 | přehřívání |
- **errorMessage:** "Některá slova nejsou na správném místě. Přečti si text znovu a přemýšlej o vedení tepla."

#### List config `room-2-list`:
```json
{
  "kind": "list",
  "title": "Stanice - Tepelné vedení",
  "items": [
    { "ref": "group-2-1", "options": { "blockUntilSolved": true } },
    { "ref": "cloze-2-2", "options": { "blockUntilSolved": true } }
  ],
  "summary": {
    "showScore": true,
    "messageOk": "Výborně! Tepelné vedení analyzováno. Přístup k další sekci povolen.",
    "messageFail": "Některé odpovědi nebyly správné. Zkus to znovu."
  }
}
```

---

### Room 3: `room-3-list` (kind: list)

Sekvence: choice (ANO/NE třídění) + order (seřazení materiálů).

#### Puzzle `choice-3-1` (kind: choice)
- **Title:** "Kudy teplo uniká?"
- **Prompt:** "Rozhodni, zda může danou cestou docházet k úniku tepla ze stanice."
- **Tokens (each with choices ANO/NE):**
  | ID | Text | Correct |
  |----|------|---------|
  | t1 | tenká kovová stěna | ANO |
  | t2 | silná izolační vrstva | NE |
  | t3 | neizolované potrubí | ANO |
  | t4 | vrstva vzduchu mezi stěnami | NE |
  | t5 | plastový kryt | NE |
- **Choices for each:** `[{ "value": "ano", "label": "ANO" }, { "value": "ne", "label": "NE" }]`
- **Solutions:** `{ "t1": ["ano"], "t2": ["ne"], "t3": ["ano"], "t4": ["ne"], "t5": ["ne"] }`
- **errorMessage:** "Některé odpovědi nejsou správné. Přemýšlej, kudy může teplo snadno procházet."

#### Puzzle `order-3-2` (kind: order)
- **Title:** "Seřazení materiálů"
- **Prompt:** "Inženýři potřebují navrhnout stěnu stanice tak, aby co nejméně propouštěla teplo ven. Seřaď materiály od nejlepší izolace po nejhorší."
- **Tokens:**
  | ID | Text |
  |----|------|
  | polystyren | polystyren |
  | guma | guma |
  | drevo | dřevo |
  | sklo | sklo |
  | beton | beton |
  | kov | kov |
- **Solution (od nejlepší izolace):** `["polystyren", "guma", "drevo", "sklo", "beton", "kov"]`
- **errorMessage:** "Pořadí není správné. Vzpomeň si, které materiály teplo zadržují a které propouští."

#### List config `room-3-list`:
```json
{
  "kind": "list",
  "title": "Únik energie - Izolace",
  "items": [
    { "ref": "choice-3-1", "options": { "blockUntilSolved": true } },
    { "ref": "order-3-2", "options": { "blockUntilSolved": true } }
  ],
  "summary": {
    "showScore": true,
    "messageOk": "Výborně! Úniky energie identifikovány a materiály seřazeny. Přístup povolen.",
    "messageFail": "Některé odpovědi nebyly správné. Zkus to znovu."
  }
}
```

---

### Room 4: `room-4-list` (kind: list)

Sekvence: choice (směr vzduchu + důvod) + choice (přiřazení typů přenosu tepla).

#### Puzzle `choice-4-1` (kind: choice)
- **Title:** "Kam se vzduch pohybuje?"
- **Prompt:** "V místnosti se nachází zdroj tepla. Označ, jakým směrem se začne pohybovat ohřátý vzduch a proč."
- **Tokens (each with own choices):**
  | ID | Text | Choices | Correct |
  |----|------|---------|---------|
  | smer | Jakým směrem se pohybuje ohřátý vzduch? | dolů / nahoru / do stran | nahoru |
  | duvod | Proč se teplý vzduch pohybuje tímto směrem? | je těžší / je lehčí / je studenější | je lehčí |
- **Choices for `smer`:** `[{ "value": "dolu", "label": "dolů" }, { "value": "nahoru", "label": "nahoru" }, { "value": "do-stran", "label": "do stran" }]`
- **Choices for `duvod`:** `[{ "value": "tezsi", "label": "je těžší" }, { "value": "lehci", "label": "je lehčí" }, { "value": "studenejsi", "label": "je studenější" }]`
- **Solutions:** `{ "smer": ["nahoru"], "duvod": ["lehci"] }`
- **errorMessage:** "Špatná odpověď. Přemýšlej, co se děje s teplým vzduchem u radiátoru a proč."

#### Puzzle `choice-4-2` (kind: choice)
- **Title:** "Způsoby přenosu tepla"
- **Prompt:** "Řídicí systém zaznamenal různé situace ve stanici. U každé urči, jakým způsobem se zde teplo přenáší."
- **Tokens (each with choices vedení/proudění/záření):**
  | ID | Text | Correct |
  |----|------|---------|
  | sA | A) teplý radiátor ohřívá vzduch v místnosti | proudění |
  | sB | B) kovová trubka se zahřívá od horkého zařízení | vedení |
  | sC | C) teplý vzduch stoupá ke stropu | proudění |
  | sD | D) Slunce ohřívá vnější plášť stanice | záření |
  | sE | E) ventilátor rozhání teplý vzduch po místnosti | proudění |
  | sF | F) lžíce se zahřívá v horkém čaji | vedení |
- **Choices for each:** `[{ "value": "vedení", "label": "vedení" }, { "value": "proudění", "label": "proudění" }, { "value": "záření", "label": "záření" }]`
- **Solutions:** `{ "sA": ["proudění"], "sB": ["vedení"], "sC": ["proudění"], "sD": ["záření"], "sE": ["proudění"], "sF": ["vedení"] }`
- **errorMessage:** "Některé odpovědi nejsou správné. Vzpomeň si: vedení = přímý kontakt, proudění = pohyb tekutiny/plynu, záření = bez hmotného prostředí."

#### List config `room-4-list`:
```json
{
  "kind": "list",
  "title": "Ventilační systém - Proudění",
  "items": [
    { "ref": "choice-4-1", "options": { "blockUntilSolved": true } },
    { "ref": "choice-4-2", "options": { "blockUntilSolved": true } }
  ],
  "summary": {
    "showScore": true,
    "messageOk": "Výborně! Ventilační systém nastaven. Přístup k reaktoru povolen.",
    "messageFail": "Některé odpovědi nebyly správné. Zkus to znovu."
  }
}
```

---

### Room 5: `room-5-cloze` (kind: cloze) - Final Summary

Single cloze puzzle (no list wrapper needed).

#### Puzzle `room-5-cloze` (kind: cloze)
- **Title:** "Závěrečný souhrnný úkol"
- **Prompt:** "Pro úspěšný restart stanice THERMOS-7 je nutné ověřit, že rozumíte základním principům šíření tepla. Doplň chybějící slova z nabídky tak, aby text dával smysl a správně shrnoval, co jste se během mise naučili."
- **Text:**
  ```
  „Teplo je forma {gap0}, která se samovolně přenáší z tělesa
  s vyšší {gap1} na těleso s nižší teplotou.
  V pevných látkách se teplo šíří především {gap2},
  což je typické zejména pro {gap3} materiály.
  Aby se přenos tepla zpomalil a energie zbytečně neunikala,
  používají se {gap4} materiály, které vedení tepla {gap5}.
  V plynech a kapalinách se teplo šíří hlavně {gap6},
  kdy se teplejší částice pohybují {gap7} a chladnější klesají dolů.
  Správným řízením přenosu tepla lze zajistit,
  že technická zařízení pracují {gap8} a bezpečně."
  ```
- **Tokens (word bank):**
  `energie`, `teplotou`, `vedením`, `kovové`, `izolační`, `zpomalují`, `prouděním`, `vzhůru`, `stabilně`
- **Solution:**
  | Gap | Answer |
  |-----|--------|
  | gap0 | energie |
  | gap1 | teplotou |
  | gap2 | vedením |
  | gap3 | kovové |
  | gap4 | izolační |
  | gap5 | zpomalují |
  | gap6 | prouděním |
  | gap7 | vzhůru |
  | gap8 | stabilně |
- **errorMessage:** "Některá slova nejsou na správném místě. Přečti si celý text a vzpomeň si, co jsi se naučil v předchozích místnostech."

---

## Events Definition

| ID | Trigger | Scene | Action |
|----|---------|-------|--------|
| `evt-intro-video` | enterScene `intro` | intro | playVideo `intro.mp4` (non-skippable) |
| `evt-intro-content` | enterScene `intro` (after video) | intro | openContent `content-intro` |
| `evt-room1-content` | enterScene `room-1` | room-1 | openContent `content-room1` |
| `evt-room1-solved` | stateChange, requireFlags `solved_room1` | room-1 | highlightHotspot arrow + toast "Puzzly splněny!" |
| `evt-room2-content` | enterScene `room-2` | room-2 | openContent `content-room2` |
| `evt-room2-solved` | stateChange, requireFlags `solved_room2` | room-2 | highlightHotspot arrow |
| `evt-room3-content` | enterScene `room-3` | room-3 | openContent `content-room3` |
| `evt-room3-solved` | stateChange, requireFlags `solved_room3` | room-3 | highlightHotspot arrow |
| `evt-room4-content` | enterScene `room-4` | room-4 | openContent `content-room4` |
| `evt-room4-solved` | stateChange, requireFlags `solved_room4` | room-4 | highlightHotspot arrow |
| `evt-room5-content` | enterScene `room-5` | room-5 | openContent `content-room5` |
| `evt-room5-solved` | stateChange, requireFlags `solved_room5` | room-5 | highlightHotspot arrow |
| `evt-victory` | enterScene `victory` | victory | openContent `content-victory` + playVideo `outro.mp4` |

---

## Content Panels (Room Descriptions)

Používají nový Content Panel systém (viz `/plans/engine-content-panels.md`).
Každá místnost má Content Panel s popisem situace v rich textu, zobrazený přes background.

### `content-intro`
- **Title:** "Mise: Zachraňte tepelný reaktor"
- **Body (Markdown):**
  ```markdown
  ## Je rok 2140.

  Vědecká stanice **THERMOS-7** vyrábí energii pomocí řízeného tepla.

  Došlo ale k poruše — jeden systém se přehřívá, druhý ztrácí teplo
  a hlavní reaktor se za **25 minut** automaticky vypne.

  **Odhalte, jak se teplo šíří, vyberte správné materiály
  a složte kód k restartu.**

  *Každý úkol = část hesla. Bez znalostí to dopadne špatně.*
  ```

### `content-room1`
- **Title:** "Řídicí centrum"
- **Body:** Řídicí systém hlásí nejasnosti v definicích tepla. Musíš ověřit základní znalosti.

### `content-room2`
- **Title:** "KRITICKÁ PORUCHA"
- **Body:** Tepelné vedení ve stanici je nestabilní. Některé materiály odvádějí teplo příliš rychle, jiné ho nebezpečně zadržují. Vaším úkolem je analyzovat materiály a rozhodnout, kde je chyba.

### `content-room3`
- **Title:** "NOVÝ PROBLÉM SYSTÉMU"
- **Body:** Přenos tepla vedením je částečně pod kontrolou, ale stanice stále ztrácí velké množství tepla. Energie uniká přes stěny, potrubí a konstrukce. Vaším úkolem je zjistit, kudy teplo uniká a jakým způsobem ho co nejlépe zadržet.

### `content-room4`
- **Title:** "HLÁŠENÍ VENTILAČNÍHO SYSTÉMU"
- **Body:** Přenos tepla vedením a izolace jsou stabilizované, ale ve stanici dochází k neřízenému pohybu teplého vzduchu. V některých částech se hromadí teplo, jinde je naopak příliš chladno. Pomozte správně nastavit proudění vzduchu ve stanici.

### `content-room5`
- **Title:** "ZÁVĚREČNÝ SOUHRNNÝ ÚKOL"
- **Body:** Stabilizace tepelného systému. Pro úspěšný restart stanice THERMOS-7 je nutné ověřit, že rozumíte základním principům šíření tepla.

### `content-victory`
- **Title:** "MISE SPLNĚNA!"
- **Body:** Gratulace! Reaktor byl úspěšně restartován. Stanice THERMOS-7 je opět v bezpečném provozu.

---

## Hotspot Layout (approximate % positions from background images)

Každý background má:
- **Puzzle icon** (oranžový kruh s puzzle kousky): přibližně `x:60%, y:80%, w:8%, h:13%`
- **Arrow** (oranžová/cyan šipka vpravo): přibližně `x:85%, y:78%, w:14%, h:18%`
- Arrow má stavy: default (viditelná ale requireFlags) + solved state (zelená check)

---

## Implementation Steps

### Phase 0: Engine Enhancement (PREREQUISITE)
0. Implementovat Content Panel systém (viz `/plans/engine-content-panels.md`)
   - Nový modul `/engine/content.js` pro rich text overlay panely
   - Podpora Markdown renderingu v průhledných overlay oknech
   - Integrace do engine action systému (`openContent`)
   - i18n podpora přes `@key@fallback` pattern

### Phase 1: Assets Setup
1. Vytvořit adresářovou strukturu `games/heat-escape/assets/scenes/` a `assets/video/`
2. Zkopírovat background obrázky (1,3,5,7,9,12.jpg) do `assets/scenes/` s přejmenováním
3. Zkopírovat intro.mp4 a outro.mp4 z warp-engine jako placeholder

### Phase 2: Core Configuration
4. Vytvořit `puzzles.json` - všechny puzzle definice (14 puzzlů + 4 listy)
5. Vytvořit `scenes.json` - scény, hotspoty, meta, eventy, content panels
6. Vytvořit `dialogs.json` - minimální (jen pokud potřebujeme NPC-style dialog pro victory)

### Phase 3: Styling
7. Vytvořit `game.css` - theme variables, heat-themed colors (orange/red accent)

### Phase 4: Testing & Polish
8. Otestovat celý průchod
9. Doladit pozice hotspotů
10. Připravit finální victory background

---

## Open Questions / Notes

- **Victory background (victory.jpg):** Zatím nemáme - buď použít upravený obrázek nebo placeholder
- **Intro/Outro videa:** Placeholder z warp-engine, později nahradit vlastními
- **Room descriptions:** Budou řešeny přes nový Content Panel systém (viz samostatný plán)
- **Image 11:** Pouze textový popis pro generování backgroundu room-5, není herní asset
- **Room 4 ÚKOL 1:** Implementováno jako 1 choice puzzle se 2 řádky (směr + důvod) místo 2 samostatných quizzů
