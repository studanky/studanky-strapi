# Studánky — specifikace projektu

*Strukturovaný zápis myšlenkových pochodů a projektové specifikace na základě hlasové nahrávky a navazujících upřesnění.*

---

## 1. Shrnutí v jedné větě

Mobilní aplikace zaměřená výhradně na studánky, která uživateli na mapě ukáže, **zda v dané studánce teče voda a jak silně** — aby si lidé pohybující se v přírodě mohli spolehlivě naplánovat doplnění vody a nemuseli s sebou nosit zásoby pro každý případ.

---

## 2. Problém, který řešíme

Východiskem je vlastní zkušenost z přírody (turistika, běh v horách, vícedenní výlety):

- Nošení vody je těžké a nepohodlné; jednorázové plastové lahve navíc zatěžují přírodu. Lepší je vzít jednu kvalitní láhev / hrníček a doplňovat vodu cestou.
- Při plánování trasy jsou studánky na mapách vidět, **ale chybí informace, jestli v nich aktuálně teče voda.**
- Tato informace je **vysoce dynamická** — mění se podle ročního období i během týdnů. Studánka, která tekla před třemi týdny, dnes téct nemusí.
- Neexistuje žádný spolehlivý a aktuální zdroj těchto dat. Recenze na mapách jsou staré (týdny až roky), nejsou u všech studánek.
- Hlavní příčina: **neexistuje přívětivá platforma** pro zadávání ani čtení stavu studánek. Interakce je těžkopádná.

Důsledek: lidé si pro jistotu stejně nesou vodu navíc.

---

## 3. Produktová vize

Aplikace **výhradně o studánkách**. Jádrem je mapa s vyznačenými studánkami a u každé informace, **zda teče / neteče** a jak silně.

**Klíčové pravidlo (právní a etické):** Aplikace **nikdy netvrdí, že je voda pitná.** Uvádí pouze, zda voda teče či neteče a její parametry. Použití vody je na vlastní riziko uživatele. Tato disclaimer logika musí být v produktu jasně zakotvená.

**Aktuálnost dat jako prvotřídní hodnota:** protože celý problém vznikl ze zastaralých informací, musí aplikace u každé studánky vždy dávat najevo, **jak čerstvý je poslední údaj** (na mapě stavem ikony, v detailu konkrétním stářím). Bez viditelné čerstvosti aplikace ztrácí to, čím se má odlišit.

UI inspirované **Mapy.cz** (Seznam), ale laděné do **modré** (voda) místo zelené.

### 3.1 Co aplikace NENÍ (vymezení rozsahu)

- **Není plánovač tras.** Aplikace slouží jako *přehled studánek*, ne k plánování trasy.
- Uživatel typicky používá appku **doma při plánování výletu** — podívá se, kolem kterých studánek (a v jakém stavu) chce jít.
- Vlastní trasu si plánuje v jiné aplikaci. Z detailu studánky si proto může **konkrétní studánku otevřít ve své plánovací aplikaci** (např. Mapy.com) přes odkaz/deeplink ven.

---

## 4. Cílová skupina a uživatelské scénáře

Platforma má dva odlišné typy uživatelů — koncového turistu (B2C) a vlastníka studánek (B2B).

### 4.1 B2C — turista / běžec (koncový uživatel)

- **Plánování doma:** uživatel v určité lokalitě vyhledá studánky a jejich stav. Aplikace je čistě **informativní**, neplánuje trasy.
- **Mapový přehled:** komunikace probíhá přes mapu. Studánky se zobrazují podle toho, **kam se uživatel dívá a jak je zazoomovaný** — body se při oddálení **seskupují (clustering)**.
- **Ikona studánky — tři stavy:**
  - **teče** (dle posledního aktuálního reportu),
  - **neteče** (dle posledního aktuálního reportu),
  - **zastaralé / neaktualizováno** — poslední report je starší než práh čerstvosti; stav se zobrazí neutrálně („neznámo"), protože po čase už spolehlivě nevíme. Tento stav **přebíjí** poslední teče/neteče.
- **Detail studánky:** po kliknutí kompletní informace + **historie záznamů** (scroll = **lazy loading**) a vždy **konkrétní stáří** posledního záznamu („ověřeno před 3 dny").
- **Odchod ven:** z detailu lze studánku otevřít ve vlastní plánovací aplikaci uživatele.

### 4.2 B2B — vlastník studánek (správa přes Strapi)

- Vlastníci (Lesy ČR, arcibiskupství, ČHMÚ, turistické svazy, CHKO…) se přihlásí do **administrace ve Strapi CMS**. **Účty jim vytváří provozovatel platformy.**
- V administraci vidí **studánky, kterých jsou vlastníky.**
- **Mohou:** měnit u svých studánek název, popisek a další parametry.
- **Nemohou:** přidávat ani odebírat studánky — to může **pouze provozovatel**, aby zůstaly **synchronizované QR kódy**.
- (Pozdější fáze:) čtení problémů nahlášených uživateli u jejich studánek.

---

## 5. Zdroje dat

Data o stavu studánek vznikají dvěma cestami:

### 5.1 Data z ČHMÚ (jednodušší, startovní zdroj)

- Český hydrometeorologický ústav monitoruje cca **300 studánek** po ČR a pravidelně měří průtok vody.
- ✅ **Ověřeno přímou komunikací s ČHMÚ**, že se reálně jedná o studánky (ne o vodočetné stanice na řekách).
- Data jsou dostupná přes (open) API, aktualizovaná v určité periodě.
- Záměr: na vlastním serveru **fetchovat data (např. každou noc)** a aktualizovat ty studánky, u kterých se hodnoty změnily.
- ✅ **Jednotky vyřešeny dle ČHMÚ Open Data:** vydatnost pramenů je řada `YD` („vydatnost denní") v jednotce **l/s**. Sedí přímo na metodu se stopkami i na pole `flowRateLps`. API je statická souborová struktura (`opendata.chmi.cz/hydrology/groundwater/now/`), `objID` slouží jako párovací klíč.

### 5.2 QR kódy na studánkách (uživatelský sběr, Fáze 2)

- S ČHMÚ je již domluveno umístění **nerezových QR kódů**; stejně se budou oslovovat i další vlastníci.
- QR kód obsahuje **URL s ID studánky** (deeplink): systémový fotoaparát buď otevře formulář v nainstalované aplikaci, nebo nasměruje na stažení z obchodu.
- Uživatel naskenuje QR → otevře se formulář → zadá záznam:

| Parametr | Typ | Poznámka |
|---|---|---|
| Teče voda? | boolean | teče / neteče — nejdůležitější a nejlevnější signál, vždy |
| Síla průtoku | škála 1–5 | viz 5.3 — buď subjektivní odhad, nebo převod z měřeného l/s |
| Zápach | boolean | ano / ne |
| Zabarvení | škála 1–5 | kalná → čirá |

- Na mapě se zobrazuje jen *teče / neteče* (+ stav čerstvosti); po rozkliknutí studánky uživatel vidí **historii záznamů**.

### 5.3 Síla průtoku — dva kompatibilní přístupy (společná škála 1–5)

Aby data ze dvou zdrojů byla porovnatelná, **společnou osou je škála 1–5.** Od začátku je třeba myslet na oba přístupy:

- **Subjektivní odhad (fallback):** rychlá volba 1–5. Nižší tření, ale nižší váha/důvěra.
- **Měření stopkami (preferované, Fáze 2):** ČHMÚ měří průtok stopováním času na napuštění 1 litru → **l/s**. V aplikaci budou **stopky**, uživatel naplní nádobu o známém objemu a appka spočítá l/s.
  - Naměřené **l/s se převede na škálu 1–5** podle **převodní tabulky uložené jako dynamický parametr ve Strapi** (viz 7.2) — takže sedí na stejnou osu jako subjektivní odhad i jako data ČHMÚ a tabulku lze do budoucna měnit podle země, vlastníka apod. bez zásahu do dat.
  - Samotná hodnota **l/s se u studánky zobrazí jako doplňková, potvrzující informace** — že nejde o pocit, ale o měření. Měřený záznam má **vyšší váhu/důvěru**.
- Boolean *teče/neteče* zůstává vždy jako základní signál nezávisle na metodě.

---

## 6. Byznys model

- Postavit kvalitní aplikaci, vzbudit zájem o studánky a turistiku v ČR.
- Vybudovat **infrastrukturu** (QR kódy + sběr dat), expandovat za hranice po Evropě.
- Financovat provoz **dotacemi** od soukromých organizací zaměřených na přírodu / turismus.
- **Exit:** prodej celé infrastruktury Seznamu (nebo podobnému hráči).
- *Poznámka: silnější/průběžný byznys model zatím není definovaný.*

---

## 7. Technická architektura

```
ČHMÚ API ──(noční Cron: fetch + parsing)──► Strapi (CMS + admin vlastníků) ──► Flutter aplikace
                                                                                    │
                                          (offline-first sběr) ◄── fronta záznamů ──┘
```

- **Mobilní aplikace:** Flutter (základ hotový).
- **Backend:** Strapi v5 (CMS) — škálovatelnost + samospráva vlastníků, minimum administrativy na straně provozovatele.
- **Mapový podklad:** **Mapy.cz** (dobrá cenová politika).
- **Datová struktura studánky (předběžně):** název, popisek, souřadnice, aktuální stav teče/neteče, historie měření (parametry + čas), síla průtoku 1–5, naměřené l/s + příznak „měřeno".
- **Globální konfigurace (Strapi) — dynamické parametry:** **práh čerstvosti dat** (výchozí 14 dní) a **převodní tabulka l/s → škála 1–5**; obojí měnitelné bez předělávání dat i bez nového releasu, do budoucna i na úrovni zemí/vlastníků (viz 7.2).
- **Agregace pro mapu:** aplikace stáhne jen body studánek + stav + timestamp posledního reportu. Detail (historie) se načte až po kliknutí, přes **lazy loading**.
- **Archivace dat:** záznamy se po čase **archivují** (uživatelům se nezobrazují, ale nemažou — jsou hodnotou projektu).

### 7.1 Konektivita: kde je potřeba internet a kde ne

- **Mapa + přehled studánek (čtení):** vyžaduje internet. Používá se hlavně **doma při plánování**.
- **Sběr dat / reporting: offline-first.**
  1. Uživatel v terénu naskenuje QR. ID studánky je v QR kódu → **aplikace i offline ví, o jakou studánku jde.**
  2. Vyplní formulář. Spolu se záznamem se **na místě** zachytí **GPS + lokální timestamp** (viz 8.1).
  3. Pokud se nepodaří odeslat, záznam se uloží do **lokální databáze** a vznikne **fronta**.
  4. Jakmile je uživatel online, fronta se odešle do Strapi.

### 7.2 Dynamické parametry, stav čerstvosti a tři stavy ikony

- **Dynamické parametry ve Strapi (jediný zdroj pravdy):**
  - **práh čerstvosti** (výchozí **14 dní**) — po jeho překročení je report „zastaralý",
  - **převodní tabulka l/s → škála 1–5** — pro sjednocení měřených a subjektivních dat.
  - Obojí měnitelné bez předělávání dat i bez nového releasu aplikace; do budoucna i různé hodnoty podle země / vlastníka.
- Aplikace si parametry **stáhne (a nacachuje)** a **stav ikony spočítá sama** z časového razítka posledního reportu vůči aktuálnímu „teď" (teče / neteče / zastaralé). Výpočet je tak vždy přesný a nezávislý na čase fetchování. Zastaralý stav **přebíjí** poslední teče/neteče a zobrazí se neutrálně.
- **Platí už v MVP:** ČHMÚ data se sice nemažou, ale **noční cron aktualizuje jen některé studánky** — studánka bez čerstvého měření může pár dní „viset". Třístavová ikona proto dává smysl od začátku a otestuje logiku čerstvosti ještě před příchodem komunitních reportů.

---

## 8. Bezpečnostní výzvy (pozdější fáze)

Aplikace má být **zdarma, bez nutnosti registrace.** To přináší problémy s důvěryhodností dat:

- **Dvě úrovně reportů:** *ověřený* (přihlášení) vs. *anonymní* (menší váha / k ověření; nezahazují se).
- **Kombinace ověřených a neověřených dat** — potřeba mechanismu vážení a ochrany před podvody.
- **Nahlašování nepravdivých tvrzení:** uživatel nahlásí nesedící záznam; více nahlášení = signál podvodu.
- **Systém odměňování** za nahlašování stavu — zatím nevymyšlený.

### 8.1 QR kód a ověření přítomnosti u studánky (rozhodnuto)

Vytištěný QR je **statický**, takže nemůže nést rotující časový prvek ani jednorázový klíč. Zvolená vrstvená obrana:

1. **Podepsaný QR (HMAC):** QR nese `id studánky` + podpis tajným klíčem provozovatele. → Brání vyrobení/uhádnutí URL pro neexistující/cizí studánky. *Neřeší* vyfocení a opakované použití.
2. **GPS + timestamp ze zařízení:** zachyceny **při vyplnění formuláře**, přibaleny k záznamu. Server provede **geofence** a uloží čas vyplnění i odeslání.
   - **Tolerance geofence: 200 m** — reálná přítomnost, ale velkorysá vůči nepřesnému GPS v lese i odchylce souřadnice ČHMÚ od umístění QR.
   - Ukládat raw GPS a vyhodnocovat **měkce (skóre důvěry)**.
   - ⚠️ Stampovat při **vyplnění**, ne při odeslání.
3. **Serverové heuristiky:** anomálie (vzdálené studánky v krátkém čase, GPS daleko od studánky, opakovaně identické hodnoty…).
4. **Křížová kontrola davem** + funkce „nahlásit nepravdivý záznam".

> Motivace falšovat data je nízká → pro v1 stačí **podepsaný QR + geofence + pár heuristik**. Nepřekombinovávat kryptografií brzy.

---

## 9. Právní rámec, soukromí a vlastnictví dat

> ⚠️ Toto nejsou právní rady — nejsem právník. Jde o doporučení podle best practices; finální znění (ToS, smlouvy, privacy policy) je vhodné nechat ověřit právníkem, zvlášť před expanzí do EU.

### 9.1 Vlastnictví dat (klíčové pro exit)

- **Uživatelské reporty (B2C):** ToS udělují provozovateli **širokou, časově neomezenou, převoditelnou a sublicencovatelnou licenci** k vloženému obsahu. „Převoditelná" je zásadní — bez ní nelze data při prodeji předat.
- **Data od vlastníků (B2B):** smlouva ujasní, že metadata i sbíraná data patří / jsou licencována provozovateli. Vyjasnit roli **správce vs. zpracovatele**.
- **Odvozená / agregovaná data** (historie, archiv) jsou výslovně majetkem platformy.

### 9.2 GDPR a soukromí

- **Minimalizace dat:** v1 / MVP **nesbírá GPS ani osobní údaje** → nižší zátěž; držet co nejdéle.
- S příchodem **GPS a přihlášení** jde o osobní údaje → nutné: právní titul, účel, **privacy policy**, práva subjektů (přístup, výmaz), souhlas se zpracováním polohy.
- **Anonymní reporty** = méně osobních údajů; preferovat anonymizaci, kde stačí.
- **Archivace:** archivovaná data **anonymizovat / pseudonymizovat** — hodnota zůstane bez vazby na osobu.

### 9.3 Odpovědnost a disclaimer

- Pravidlo o **nepitnosti** patří do ToS jako **omezení odpovědnosti** — platforma informuje o průtoku, neručí za kvalitu/pitnost, užití na vlastní riziko.

### 9.4 Připravenost architektury

- v1 funguje **bez GPS a ověřování**, ale **Strapi i aplikace mají být na tento směr připravené** — datová pole (poloha / timestamp / skóre důvěry) a flow navrhnout dopředu, i když se zatím neplní.

---

## 10. Aktuální stav

- ✅ Založené Strapi.
- ✅ Založená „plain" Flutter aplikace.
- ✅ Hotový design, jak má aplikace vypadat.
- 🔄 Probíhá komunikace s partnery (vlastníky studánek).

---

## 11. MVP — definice

- Mobilní aplikace s **mapou** (Mapy.cz), studánkami (clustering, **třístavová ikona: teče / neteče / zastaralé**).
- **Pouze studánky z ČHMÚ** (cca 300), data ze Strapi.
- **Stav čerstvosti od začátku** — protože cron aktualizuje jen některé studánky, neaktuální se zobrazí jako „zastaralé" (práh ze Strapi, výchozí 14 dní); v detailu vždy konkrétní stáří záznamu.
- **Bez skenování QR kódů, bez sběru dat od uživatelů** → odpadá nutnost řešit bezpečnostní vrstvy.
- Detail studánky s historickými měřeními (+ odchod do vlastní plánovací aplikace).

MVP je čistá **reprezentace dat** z ČHMÚ skrz Strapi do aplikace.

### 11.1 Strategický kontext MVP

- MVP se **nestanovuje na metriky** — je to **mezistupeň / odrazový můstek**, ne samostatně „smysluplný" produkt.
- Smyslem je dostat ven **alespoň něco, na co se může začít nabalovat komunita.**
- **Největší hodnota přijde později** — v QR kódech a ve sběru informací o studánkách, které **nejsou automaticky a elektronicky monitorovány** (mimo ~300 lokalit ČHMÚ).

---

## 12. Roadmapa po MVP (fáze)

- **Fáze 1 — MVP:** read-only data z ČHMÚ, mapa (clustering, **třístavová ikona teče/neteče/zastaralé**), detail s konkrétním stářím záznamu, noční cron. Cron aktualizuje jen některé studánky, takže logika čerstvosti se uplatní hned.
- **Fáze 2 — komunitní sběr:** QR kódy, offline-first reporting + fronta, anonymní reporty, podepsaný QR; **stopky pro měření l/s jako preferovaná metoda + subjektivní fallback na společné škále 1–5**. (Zatím bez GPS.)
- **Fáze 3 — důvěryhodnost:** přihlášení, ověřený vs. anonymní report, GPS geofence (200 m), heuristiky, nahlašování nepravd, systém odměňování.
- **Fáze 4 — provoz dat:** archivace + anonymizace, ladění vážení a prahů podle reálného provozu.
- **Fáze 5 — expanze:** lokalizace, další vlastníci a země v EU, dotace na provoz → příprava na exit.

---

## 13. Plán vývoje MVP (konkrétní kroky)

1. **Připravit Strapi na data**
   - Datová struktura studánek (s poli připravenými i na budoucí GPS / timestamp / skóre důvěry / l/s — viz 9.4).
   - Globální konfigurace včetně prahu čerstvosti (viz 7.2).
   - Administrace pro vlastníky (rozšiřitelná).
   - Utilita pro automatizované stahování a parsování raw dat z ČHMÚ.
   - **Cron** (po půlnoci): stáhne data → rozparsuje → zjistí aktualizované studánky → aktualizuje → vytvoří „ověřený" záznam.
2. **Aplikace** — naplnit Strapi daty, postavit UI, napojit na Strapi (mapa s clusteringem, detail s lazy loadingem).
3. **Konektor / parser ČHMÚ** — dotáhnout napojení na API + Cron.

---

## 14. Nefunkční požadavky

- **Platformy:** iOS + Android (Flutter); určit minimální verze OS.
- **Lokalizace:** navrhnout **vícejazyčně od začátku** (kvůli EU), i když v1 bude jen česky.
- **Výkon:** plynulý **clustering** při stovkách/tisících bodů; **lazy loading** historie.
- **Spolehlivost:** fallback, když je ČHMÚ nedostupné — ukázat poslední známá data.
- **Aktuálnost jako prvotřídní požadavek:** vždy zobrazit stáří posledního reportu; třístavová ikona; práh čerstvosti **konfigurovatelný v Strapi** (výchozí 14 dní).

---

## 15. Rizika a předpoklady

- **Závislost na ČHMÚ API** — změna formátu, omezení přístupu nebo zrušení open API by připravilo MVP o jediný zdroj dat. *Předpoklad: API zůstane dostupné a stabilní.*
- **Ochota partnerů** — celá QR fáze stojí na tom, že vlastníci umístí kódy a budou studánky spravovat.
- **Adopce komunitou** — hodnota QR fáze závisí na dostatku přispěvatelů. Bez kritické masy jsou data řídká a zastaralá (tedy původní problém, jen přesunutý).
- **Závislost na Mapy.cz** — třetí strana; změna cen/podmínek zvedá náklady (zároveň je to potenciální kupec → spíš příležitost).
- **Koncentrované financování** — dotace + exit na jednoho kupce.

---

## 16. Glosář

- **Studánka** — bod v terénu s vodním zdrojem; entita v platformě (název, souřadnice, stav, historie).
- **Report** — jeden záznam o stavu studánky (teče, průtok, zápach, zabarvení) od uživatele nebo z ČHMÚ.
- **Měření** — report s objektivně naměřeným průtokem (l/s, stopky), vyšší váha než subjektivní odhad.
- **Vlastník (B2B)** — organizace spravující své studánky ve Strapi.
- **Ověřený / anonymní report** — od přihlášeného vs. nepřihlášeného uživatele; liší se vahou důvěry.
- **Geofence** — kontrola, že GPS uživatele je v toleranci (200 m) od souřadnic studánky.
- **Clustering** — seskupování blízkých bodů na mapě při oddálení.
- **Práh čerstvosti** — doba (výchozí 14 dní), po níž se report považuje za zastaralý.
- **l/s vs. m³/s** — litry/m³ za sekundu (průtok); „m/s" je rychlost proudění, nezaměňovat.

---

## 17. Otevřené otázky / co zatím chybí

- Přesný **formát ČHMÚ API** a **jednotky** — ✅ vyřešeno (statické soubory, vydatnost v l/s; viz 5.1).
- **Hodnoty převodní tabulky l/s → škála 1–5** (mechanismus rozhodnut: dynamický parametr ve Strapi; chybí konkrétní rozsahy, ideálně sladěné s kategorizací ČHMÚ — viz 5.3).
- Přesná finální datová struktura studánky a sada parametrů.
- Konkrétní podoba **systému odměňování**.
- Detaily **vážení** ověřených vs. anonymních a měřených vs. subjektivních dat.
- Potvrzení **prahu čerstvosti** provozem (výchozí 14 dní).
- Detaily **archivace / anonymizace** dat.
- **Průběžný** (nikoli jen exitový) byznys model.
