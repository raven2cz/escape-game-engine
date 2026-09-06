# EI-010: myšlenka, jak to má učitel používat

**Fable 5.1, 6. 9. 2026.** Psáno pro majitele produktu. Technický návrh, ze
kterého tohle vychází, je [EI-010-DESIGN.md](EI-010-DESIGN.md); ten je určený
tomu, kdo to bude stavět, a tady na něj odkazuji jen tímhle jedním místem.
Názvy z kódu nechávám anglicky, aby se daly v kódu najít.

## 1. Myšlenka v několika větách

Hra si už dnes zapisuje všechno, co potřebuje k tomu, aby přežila obnovení
stránky. Pokaždé, když tým přejde do jiné místnosti, sebere předmět, vyřeší
úlohu nebo hra nastaví nějaký příznak, engine ten stav uloží do paměti tabletu.
(Příznak, v kódu *flag*, je poznámka typu „trezor otevřen“, kterou si hra dělá
sama pro sebe, aby věděla, co už smí pustit dál.) Ten zápis vzniká v enginu na
jednom jediném místě a z tabletu odchází jedním jediným výstupem.

Celá myšlenka je: **tu samou poznámku, kterou si hra píše pro sebe, pošleme i
učiteli.** Nevymýšlíme druhý, paralelní systém hlášení. Doplníme do té poznámky
to, co v ní dnes chybí, hlavně čas a chyby, a necháme ji z tabletu odcházet
ještě jedním směrem: na server, ze kterého ji čte učitelská nástěnka
(dashboard).

Co učitel vidí: jednu tabulku, řádek na tým. V řádku je místnost, kde tým právě
je, jak dlouho tam je ve srovnání se zbytkem třídy, kolik úloh má za sebou z
kolika, kdy se tablet naposledy ozval a jestli tým hru dohrál. Pod tabulkou je
mřížka úloha × tým: vyřešeno napoprvé, vyřešeno po chybách, rozděláno,
nedotčeno. V první verzi nic víc.

Protože je to ta samá poznámka, dostaneme tři věci zadarmo. Když ve škole na
minutu vypadne Wi-Fi, nic se neztratí: tablet hraje dál ze své kopie a první
zpráva po výpadku nese celou historii, protože historie je v té poznámce
uvnitř. Nástěnka funguje pro všech šest her stejně a pro sedmou hru hned první
den, aniž by se v ní cokoliv připisovalo, protože všechno odvozuje engine z
toho, co se stalo, a ne hra z toho, co si o sobě prohlásí. A žádná hodina kvůli
tomu neskončí; k tomu se vrátím ve čtvrté části.

## 2. Váš seznam, bod po bodu

**Které předměty tým sebral.** Je tam dnes. Batoh je v uloženém stavu jako
seznam `inventory` a přežívá obnovení stránky. Učitel uvidí jména předmětů,
které tým právě má. Postavit se pro to nemusí nic kromě odeslání. Jeden háček:
batoh ukazuje jen to, co tým *má teď*, ne to, co měl a už spotřeboval. To je
Váš šestý bod a tam je odpověď horší.

**Ve které místnosti právě jsou.** Je tam dnes, pole `scene`, a vedle něj
`visited`, které místnosti už tým viděl. Učitel uvidí název místnosti a kolik
místností má tým za sebou. Návrh k tomu přidává dvě věci, které dnes chybí: od
kdy tam tým je a kolik času strávil v každé místnosti dohromady. Bez toho se
nedá poznat, kdo se zasekl; k tomu ve třetí části.

**Jak dlouho hrají.** Není tam vůbec. Engine nemá hodiny: `Date.now()` se v něm
objevuje čtyřikrát a pokaždé jde o rozpoznání gesta prstem, ne o hru. Neví se,
kdy tým začal, kdy naposledy něco udělal, ani jak dlouho je kde. Návrh to řeší
jako první krok: do uloženého stavu přibude začátek hry, čas poslední změny,
začátek pobytu v aktuální místnosti, součet času po místnostech a čas
dokončení. Učitel uvidí „hraje 23 minut, v této místnosti 6 minut“. Jedna
poctivá výhrada: čas měří hodiny tabletu. Tablet, který přes přestávku usne s
otevřenou hrou, započítá přestávku do času v místnosti. Nástěnka to ošetří tím,
že jeden pobyt v místnosti nikdy nepočítá déle, než trvá hodina, ale pořád je
to orientační údaj pro učitele v hodině, ne stopky na známkování.

**Zda dosáhli cíle hry.** Dnes jen tím, že tým stojí na poslední scéně. Engine
ji zobrazí, ale nezapíše; když se tým vrátí o místnost zpět, není po dohrání
ani stopa. Tři hry k tomu ještě nastavují příznak `game_completed`, ale nic ho
nečte. Prošel jsem všech šest her: v každé je východ za posledním zámkem, takže
na poslední scénu se nedá dostat jinak než dohráním. Není co rozlišovat. Návrh:
při prvním vstupu na poslední scénu se zapíše čas dokončení `completedAt` a už
se nemění. Učitel uvidí „dohráno v 10:42, po 31 minutách“. Ve hrách se nemusí
měnit nic.

**Dialog jako stav.** Není tam, a ověřil jsem si to v kódu. Když proběhne
dialog, nezůstane po něm žádný záznam. Pole `contentShown`, které vypadá, jako
že by to mohlo dělat, eviduje otevřené obsahové panely (text nebo obrázek, který
se otevře klepnutím na místo ve scéně), ne dialogy. Dialog po sobě zanechá stopu
jen nepřímo: když na konci nastaví příznak (tak vzniká `game_completed` ve
třech hrách), nebo když ho spouští jednorázová událost, a pak je zapsaná ta
událost, ne dialog. Warp-engine má šestnáct dialogů, heat-escape žádný.

Vaši větu „dialog může být stav“ jde číst dvěma způsoby. Které dialogy už
proběhly: to jde zapisovat lacině, jednou mapou `dialogsShown` naplněnou ve
chvíli, kdy dialog končí, stejně jako se dnes zapisují obsahové panely. Je to
omezené počtem dialogů ve hře, dohromady třiadvacet ve všech šesti. V odevzdaném
návrhu to není a přidal bych to do prvního kroku. Kde uvnitř dialogu tým právě
je: to bych nezapisoval. Dialog trvá vteřiny a obnovení stránky ho stejně zavře.

Co učitel uvidí: milník typu „potkali Leeuwenhoeka“. Na nástěnce bude jen
tehdy, když hra řekne, který dialog je milník; jinak v podrobnostech týmu.
Upřímně: pro učitele je dialog zajímavý jako milník příběhu, a hry, kde na tom
záleží, si to už dnes značí příznakem (leeuwenhoek má třeba `met_leeuwenhoek`).
Zapsal bych to, protože je to levné a příští hra si pak nemusí nastavovat
příznak jen proto, aby ji bylo vidět, ale není to bod, na kterém nástěnka stojí.

**Které předměty už spotřebovali.** Není tam, a je to horší než u dialogu. Když
tým předmět použije a hra ho spotřebuje, funkce `_removeItemFromInventory` ho
prostě vystřihne ze seznamu. Potom se „nikdy nesebral“ a „sebral a použil“
nedají rozeznat. Pro učitele je to skutečný rozdíl: tým bez klíče potřebuje
nápovědu, kde klíč je; tým, který klíč už použil, je za tím. Náprava je malá:
mapa `itemsUsed` (předmět → ano), zapsaná v té samé funkci, omezená počtem
předmětů ve hře; ve všech šesti hrách je jich dohromady čtyřiadvacet. V
odevzdaném návrhu to není; patří to do prvního kroku vedle dialogů. Učitel pak
u každého předmětu hry uvidí jedno ze tří: nemá, má, použil.

**Kolik udělali chyb, chybovost na úloze.** Tohle je na Vašem seznamu
nejcennější a zároveň jediné, co stojí skutečnou práci. Proč: špatná odpověď se
dnes nejen nezapisuje, ona se většinou ani nedostane k enginu. Sedmačtyřicet z
dvaašedesáti úloh, které mají odpověď (seznamy úloh jsou jen obálky), má
nastaveno „drž otevřeno, dokud není vyřešeno“ (`blockUntilSolved`). Špatná
odpověď u nich znamená, že úloha zůstane na obrazovce, žák zkusí znovu, a
engine se dozví až o konečném úspěchu. Platí to i pro všech devět otázek
fyzikálního kvízu v reactoru, tedy přesně pro to, kde se učí. Zbylých patnáct se
po chybě zavře a výsledek se také nikam nezapíše; jediná reakce na chybu, kterou
hry mají, je hláška. Zápis „vyřešeno“ je ano/ne: napoprvé a napodeváté je ta
samá zapsaná skutečnost. A u seznamů úloh, což je skoro čtyřicet procent všech
úloh v katalogu, se výsledky jednotlivých kroků sice sestaví, ale jen v paměti,
a zahodí.

Co se musí postavit, druhý krok návrhu: každý z osmi druhů úloh řekne „špatně,
držím“ jednou společnou cestou, a spouštěč úloh (společný kus kódu, kterým
prochází každá úloha) zapíše každé jedno vyhodnocení jako řádek: kdy, která
úloha, dobře nebo špatně, drženo nebo zavřeno, a co tým odpověděl. Ukládá se to
do pole `puzzleResults`, které v uloženém stavu existuje už dnes a je pořád
prázdné. Kroky seznamu nesou, do kterého seznamu a na které pozici patří.
Zvlášť se rozliší „špatně“ od „klepnul na OK s prázdnou úlohou“, aby se
nedovyplněná úloha nepočítala jako chyba, a dvojité klepnutí na OK je jeden
pokus, ne dva.

Co učitel uvidí: u týmu a úlohy „napoprvé“, „po třech chybách“, „rozděláno“
nebo „nedotčeno“; a přes celou třídu, kterou otázku dostala špatně většina týmů
a co na ni odpovídali.

Dvě věci, aby to učitele nemátlo. Za prvé je to za tým, ne za žáka; jeden
tablet je jeden tým a engine nikdy neví, kdo drží prst. Nástěnka bude všude
říkat „tým“, aby si nikdo špatnou odpověď nepřečetl jako odpověď jednoho
dítěte. Za druhé: u otázky se čtyřmi možnostmi jsou nejvýš tři chybné pokusy,
pak vyhraje hádání. „Tři chyby“ u takové otázky znamená „prohádali se“, ne
„těžká otázka“. Proto bych na nástěnce neukazoval chybovost v procentech;
ukazoval bych počet chybných pokusů před vyřešením, a vedle něj, kolik možností
úloha měla. Tomu učitel rozumí a nepodvede ho to.

Je na Vašem seznamu něco, co je špatný nápad? Není. Dvě věci tam jsou, tři
potřebují pár řádků, jedna potřebuje pořádnou práci. Jediné, s čím bych se
hádal, je slovo chybovost jako poměr; číslo pokusů je poctivější.

## 3. Co bych přidal a proč

Krátce, a u každého jen to, co to učiteli dovolí udělat v hodině.

**Kdo se zasekl.** Čas v aktuální místnosti proti tomu, kolik tam strávily
ostatní týmy, a k tomu, která úloha je právě otevřená a od kdy. Učitel jde ke
správnému stolu dřív, než to tým vzdá, a nechodí ke stolu, kde je všechno v
pořádku. Tohle je jediný důvod, proč do stavu přidávám čas po místnostech;
samotné „hraje 23 minut“ nikomu neřekne, kde je problém.

**Naposledy viděn.** Kdy server naposledy dostal od tabletu zprávu, plus tichý
signál každých třicet vteřin, že tablet žije. Bez toho se „osm minut bez
pokroku“ nedá odlišit od „tablet usnul“ nebo „vypadla Wi-Fi“, a učitel by
chodil k týmu, který se jen nemůže připojit.

**Jak daleko jsou.** Úlohy hotové z celkového počtu a místnosti viděné z
celkového počtu. Engine si to spočítá sám z dat hry, takže to má všech šest her
bez jakéhokoli dopisování. Učitel drží tempo: zbývá patnáct minut a nejpomalejší
tým má čtyři z deseti.

**Co odpověděli.** Ne jen že špatně, ale co zvolili. Když všech šest týmů
vybralo B, je to o výkladu, ne o týmech, a učitel to má na příští hodinu. U úloh
s volným textem je to to, co děti napsaly; jde to jen učiteli toho týmu a bude
to tak napsané v dokumentaci rozhraní.

**Celá hodina zpětně.** Server nepřepisuje, ukládá každou přijatou zprávu. Po
hodině se dá projít celý průběh každého týmu, ne jen konečný stav. Učitel si
připraví příští hodinu z toho, co třída nezvládla; to v hodině samotné nestihne.

## 4. Co Vás to stojí

**Žádná hodina neskončí.** Jediný spínač, který týmům maže rozehranou hru, je
`saveVersion` hry, a nic z tohohle se ho nedotýká. Všechno, co přibývá, má
výchozí hodnotu, takže tým, kterému se engine vymění uprostřed hodiny, hraje dál
a od té chvíle se mu navíc zapisuje čas a chyby. Ověřil jsem si to na tom, jak
engine načítá starý stav: porovnává jen podpis hry, ne tvar uložených dat.

**Nic se v šesti hrách nepřepisuje.** Nástěnka se naplní ze všech šesti hned
první den z toho, co si engine odvodí sám. Hra *může* později prohlásit, které
příznaky nebo scény jsou milníky a jak se mají jmenovat, ale jen když o to
nějaký učitel požádá, a je to volitelné. Jednu úpravu ve hrách doporučuji
nezávisle: leeuwenhoek má sedm úloh, ke kterým se nedá dostat z žádného místa
hry, pozůstatky z doby, kdy sloužil jako ukázka. Smazat je nic nerestartuje,
protože co není dosažitelné, nemůže být v žádném uloženém stavu.

**Kolik vydání a v jakém pořadí.** Tři, a čtvrté volitelné.

1. Engine 1.1.0: čas, zápis každého vyhodnocení, odvozený postup a sepsaná
   dokumentace toho, co tablet posílá. Jedno vydání, aby se formát pohnul jen
   jednou. Součástí je oprava EI-030: jeden ztracený požadavek na soubor s
   úlohami dnes způsobí, že do obnovení stránky nejde otevřít žádná úloha.
   Našlo se to při návrhu a opraví se tady, protože se ta funkce stejně mění.
2. Engine 1.2.0: odesílání. Tablet pořád ukládá napřed k sobě a teprve potom
   posílá na server; když server neodpovídá, zkouší to znovu a hru to nikdy
   nezdrží.
3. Server a nástěnka v0: v repozitáři hostovaného běhového prostředí, které dnes
   neexistuje. Jedna tabulka a jedna mřížka, jak jsem popsal v první části.
   Tuhle verzi dát před jednoho učitele dřív, než se cokoli přidá.
4. Volitelně, až po tom učiteli: milníky a popisky ve hrách.

**Co uvidíte kdy.** Po 1.1.0 učitel neuvidí nic; tablet si od té chvíle
zapisuje historii, která se dá vyčíst z jeho paměti, a to je vše. Po 1.2.0
tablet posílá, ale není kam, dokud není server. Nástěnka je poslední krok a
stojí na hostovaném běhovém prostředí, které se musí postavit. Říkám to takhle
napřímo, protože je to největší položka a není v tomhle návrhu.

**Jedno riziko.** Když se engine uprostřed hodiny vrátí na verzi před 1.1.0,
tým přijde o časy, ne o postup. Řešení je jít vpřed a opravit, ne zpět, což už
postup vydávání říká.

**Co musíte rozhodnout, než kdokoli začne.**

1. Za tým, nikdy za žáka. Potvrdit.
2. Volné textové odpovědi jdou učiteli toho týmu. Ano, nebo ne; doporučuji ano.
3. Dva chybějící zápisy, proběhlé dialogy a spotřebované předměty, přidat do
   1.1.0. Doporučuji ano, obojí je malé.
4. Seznam úloh po obnovení stránky dnes začíná od prvního kroku. Se zapsanými
   výsledky by mohl pokračovat tam, kde byl. Mění to, co vidí žák, takže je to
   Vaše volba; nástěnka to nepotřebuje.
5. Sedm nedosažitelných úloh v leeuwenhoekovi smazat. Ano, nebo ne.
6. Kolik týmů ve třídě, kolik tabletů, jak dlouhá hodina. Určuje to velikost
   serveru; Vy to víte, nikde v repozitáři to není.
7. Kdo a kdy staví hostované běhové prostředí. Bez něj nástěnka není.

## 5. Jedna otázka pro učitele

Nikdo se učitele nezeptal, a z celého návrhu je jedna věc, kterou nedokážu
odhadnout z dat: **dívá se na to učitel během hodiny, nebo až po ní?**

Rozhoduje to pořadí práce. Když během hodiny, pak je nejdůležitější spolehlivé
odesílání, „naposledy viděn“ a ostrý signál „zasekl se“, a musí to jít přes
školní Wi-Fi bez zaškobrtnutí; to je většina práce na serveru. Když až po ní,
pak stačí, aby tablet historii posbíral a odevzdal na konci, a první, co se má
postavit, je přehled po hodině: kterou otázku třída nezvládla a co odpovídala.
Živá část může počkat. Obojí se dá postavit, ale ne ve stejném pořadí, a v0
nástěnky by měla být to, co učitel opravdu použije jako první.

Vy na to možná odpovíte sám: stojí učitel u tabule s obrazovkou, nebo chodí mezi
lavicemi s tabletem v ruce? Když chodí, je to živá nástěnka a musí se vejít na
tablet. Když stojí, je to přehled a stačí mu projektor po hodině.
