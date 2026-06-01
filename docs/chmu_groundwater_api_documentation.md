# ČHMÚ Open Data API — Hydrologie / Groundwater

Dokumentace veřejně dostupné části API:

`https://opendata.chmi.cz/hydrology/groundwater/`

Dokumentace je zaměřená pouze na strukturu a datové formáty API. Neřeší napojení do Strapi, datový model aplikace ani implementační architekturu konzumentské aplikace.

---

## 1. Základní charakter API

ČHMÚ Open Data pro podzemní vody je publikované jako statická adresářová struktura nad HTTPS. Nejde o klasické REST API s query parametry, ale o souborové API, kde se data získávají přímým stažením JSON souborů.

Základní URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/
```

Kořenová struktura:

```text
/hydrology/groundwater/
├── characteristic/
├── historical/
├── now/
└── recent/
```

Význam hlavních větví:

| Větev | Účel |
|---|---|
| `now/` | aktuální / poslední dostupné hodnoty pro objekty podzemních vod |
| `recent/` | nedávná časová data, typicky měsíční soubory po objektech |
| `historical/` | historická data a metadata |
| `characteristic/` | dlouhodobé charakteristiky / kvantily po objektech |

---

## 2. Konvence adresářů

Každá hlavní datová větev obvykle obsahuje dvě podvětve:

```text
data/
metadata/
```

Příklad:

```text
/hydrology/groundwater/now/
├── data/
└── metadata/
```

### `metadata/`

Obsahuje popis objektů a/nebo popis dostupných časových řad.

Typicky:

```text
meta1.json
meta2.json
```

### `data/`

Obsahuje samotné časové řady ve formátu JSON.

Soubory jsou pojmenované podle identifikátoru objektu a typu datové řady.

---

## 3. Identifikace objektů

Objekty jsou identifikovány hodnotou `objID`.

Příklad:

```text
0-203-1-PB0013
```

Tento identifikátor se objevuje:

- v metadatech objektů,
- v názvech datových souborů,
- uvnitř JSON odpovědí v poli `objID`.

Datový soubor pro aktuální denní vydatnost může mít název:

```text
0-203-1-PB0013_D.json
```

Uvnitř souboru je objekt stále identifikován bez sufixu `_D`:

```json
{
  "objList": [
    {
      "objID": "0-203-1-PB0013"
    }
  ]
}
```

---

## 4. Větev `now/`

URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/now/
```

Struktura:

```text
/hydrology/groundwater/now/
├── data/
└── metadata/
```

Adresář `now/metadata/` obsahuje:

```text
meta1.json
meta2.json
```

Adresář `now/data/` obsahuje JSON soubory pojmenované typicky:

```text
{objID}_D.json
```

Příklad:

```text
0-203-1-PB0013_D.json
```

---

## 5. `now/metadata/meta1.json` — metadata objektů

URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta1.json
```

Soubor obsahuje seznam objektů podzemních vod.

### Obecný tvar odpovědi

```json
{
  "zaznamID": "530C0A251F3E0435E064020820C987EB",
  "datovyZdrojID": "hydrologie",
  "datovyTokID": "Open.Data.Metadata",
  "datumVytvoreni": "2026-05-30T16:00:12Z",
  "verzeDat": "1.0",
  "data": {
    "type": "DataCollection",
    "data": {
      "header": "objID,DBC,OBJECT_NAME,OBJECT_TYPE,GEOGR1,GEOGR2,ALTITUDE",
      "values": [
        [
          "0-203-1-PB0013",
          "PB0013",
          "Ostružná",
          "spring",
          50.1798186,
          17.0549236,
          697
        ]
      ]
    }
  }
}
```

### Kořenová pole

| Pole | Typ | Popis |
|---|---:|---|
| `zaznamID` | string | identifikátor záznamu metadat |
| `datovyZdrojID` | string | identifikátor datového zdroje, zde typicky `hydrologie` |
| `datovyTokID` | string | identifikátor datového toku, např. `Open.Data.Metadata` |
| `datumVytvoreni` | ISO datetime | čas vytvoření souboru |
| `verzeDat` | string | verze dat |
| `data` | object | vlastní datová kolekce |

### Tabulka `data.data`

`data.data.header` definuje sloupce tabulky. Hodnoty jsou v `data.data.values`.

Header:

```text
objID,DBC,OBJECT_NAME,OBJECT_TYPE,GEOGR1,GEOGR2,ALTITUDE
```

| Sloupec | Typ | Popis |
|---|---:|---|
| `objID` | string | plný identifikátor objektu |
| `DBC` | string | kratší kód objektu, např. `PB0013` |
| `OBJECT_NAME` | string | název objektu |
| `OBJECT_TYPE` | string | typ objektu, např. `spring` |
| `GEOGR1` | number | zeměpisná šířka |
| `GEOGR2` | number | zeměpisná délka |
| `ALTITUDE` | number | nadmořská výška |

Příklad jednoho záznamu:

```json
[
  "0-203-1-PB0013",
  "PB0013",
  "Ostružná",
  "spring",
  50.1798186,
  17.0549236,
  697
]
```

---

## 6. `now/metadata/meta2.json` — metadata časových řad

URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta2.json
```

Soubor popisuje dostupné typy časových řad pro větev `now`.

### Obecný tvar odpovědi

```json
{
  "zaznamID": "530C0A251F3F0435E064020820C987EB",
  "datovyZdrojID": "hydrologie",
  "datovyTokID": "Open.Data.Metadata",
  "datumVytvoreni": "2026-05-30T16:00:13Z",
  "verzeDat": "1.0",
  "data": {
    "type": "DataCollection",
    "data": {
      "header": "TSCON_ID,TSCON_DS,UNIT_ID,UNIT_DS",
      "values": [
        ["HD", "Hladiny - denní", "MNM", "m n.m."],
        ["YD", "Vydatnost - denní", "L_S", "l/s"]
      ]
    }
  }
}
```

### Header

```text
TSCON_ID,TSCON_DS,UNIT_ID,UNIT_DS
```

| Sloupec | Typ | Popis |
|---|---:|---|
| `TSCON_ID` | string | identifikátor typu časové řady |
| `TSCON_DS` | string | textový popis časové řady |
| `UNIT_ID` | string | strojový identifikátor jednotky |
| `UNIT_DS` | string | textový popis jednotky |

### Dostupné typy časových řad v `now`

| `TSCON_ID` | Popis | `UNIT_ID` | Jednotka |
|---|---|---|---|
| `HD` | Hladiny - denní | `MNM` | m n.m. |
| `YD` | Vydatnost - denní | `L_S` | l/s |

---

## 7. `now/data/{objID}_D.json` — aktuální datový soubor objektu

Příklad URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/now/data/0-203-1-PB0013_D.json
```

### Obecný tvar odpovědi

```json
{
  "objList": [
    {
      "objID": "0-203-1-PB0013",
      "tsList": [
        {
          "tsConID": "YD",
          "unit": "L_S",
          "tsData": [
            {
              "dt": "2026-05-30T05:00:00Z",
              "value": 1.06418
            }
          ]
        }
      ]
    }
  ]
}
```

### Kořen

| Pole | Typ | Popis |
|---|---:|---|
| `objList` | array | seznam objektů v odpovědi; u souborů po jednom objektu typicky obsahuje jeden objekt |

### Objekt v `objList`

| Pole | Typ | Popis |
|---|---:|---|
| `objID` | string | identifikátor objektu |
| `tsList` | array | seznam časových řad pro objekt |

### Časová řada v `tsList`

| Pole | Typ | Popis |
|---|---:|---|
| `tsConID` | string | typ časové řady, např. `YD` |
| `unit` | string | jednotka, např. `L_S` |
| `tsData` | array | jednotlivé hodnoty časové řady |

### Záznam v `tsData`

| Pole | Typ | Popis |
|---|---:|---|
| `dt` | ISO datetime | čas hodnoty v UTC |
| `value` | number | naměřená hodnota v jednotce uvedené v `unit` |

### Význam hodnot pro prameny

Pro prameny je nejdůležitější časová řada:

```text
tsConID = YD
unit = L_S
```

To znamená:

```text
Vydatnost - denní, l/s
```

---

## 8. Větev `recent/`

URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/recent/
```

Struktura:

```text
/hydrology/groundwater/recent/
├── data/
└── metadata/
```

Adresář `recent/metadata/` obsahuje metadatové soubory pojmenované podle data, například:

```text
meta1-20250210.json
meta1-20250211.json
meta1-20250301.json
...
```

Adresář `recent/data/` obsahuje měsíční datové soubory po objektech:

```text
{objID}_D_{YYYYMM}.json
```

Příklady:

```text
0-203-1-PB0013_D_202501.json
0-203-1-PB0013_D_202505.json
0-203-1-PB0013_D_202605.json
```

---

## 9. `recent/data/{objID}_D_{YYYYMM}.json` — měsíční časová data

Příklad URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/recent/data/0-203-1-PB0013_D_202605.json
```

### Obecný tvar odpovědi

```json
{
  "objList": [
    {
      "objID": "0-203-1-PB0013",
      "tsList": [
        {
          "tsConID": "YD",
          "unit": "L_S",
          "tsData": [
            {
              "dt": "2026-05-01T05:00:00Z",
              "value": 1.14733
            },
            {
              "dt": "2026-05-02T05:00:00Z",
              "value": 1.14733
            }
          ]
        }
      ]
    }
  ]
}
```

Struktura je stejná jako u `now/data/{objID}_D.json`, ale `tsData` obsahuje více hodnot za daný měsíc.

### Název souboru

```text
{objID}_D_{YYYYMM}.json
```

| Segment | Význam |
|---|---|
| `{objID}` | identifikátor objektu, např. `0-203-1-PB0013` |
| `_D` | denní data |
| `{YYYYMM}` | měsíc dat, např. `202605` |
| `.json` | JSON formát |

### Poznámka k úplnosti měsíců

Aktuální měsíc nemusí obsahovat všechny dny měsíce, protože se jedná o průběžně doplňovaná recent data.

---

## 10. Větev `historical/`

URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/historical/
```

Struktura:

```text
/hydrology/groundwater/historical/
├── data/
└── metadata/
```

Adresář `historical/metadata/` obsahuje:

```text
meta1.json
meta2.json
```

### `historical/metadata/meta2.json`

Soubor popisuje dostupné historické typy časových řad.

Obecný tvar:

```json
{
  "zaznamID": "2E026C9E2626188DE064020820AA46CE",
  "datovyZdrojID": "hydrologie",
  "datovyTokID": "Open.Data.Metadata",
  "datumVytvoreni": "2025-02-13T08:10:03Z",
  "verzeDat": "1.0",
  "data": {
    "type": "DataCollection",
    "data": {
      "header": "TSCON_ID,TSCON_DS,UNIT_ID,UNIT_DS",
      "values": [
        ["HD", "Hladiny - denní", "MNM", "m n.m."],
        ["HT", "Hladiny - týdenní", "MNM", "m n.m."],
        ["YD", "Vydatnost - denní", "L_S", "l/s"],
        ["YT", "Vydatnost - týdenní", "L_S", "l/s"],
        ["TD", "Teploty vody - denní", "0C", "°C"],
        ["TT", "Teploty vody - týdenní", "0C", "°C"]
      ]
    }
  }
}
```

### Dostupné typy historických časových řad

| `TSCON_ID` | Popis | `UNIT_ID` | Jednotka |
|---|---|---|---|
| `HD` | Hladiny - denní | `MNM` | m n.m. |
| `HT` | Hladiny - týdenní | `MNM` | m n.m. |
| `YD` | Vydatnost - denní | `L_S` | l/s |
| `YT` | Vydatnost - týdenní | `L_S` | l/s |
| `TD` | Teploty vody - denní | `0C` | °C |
| `TT` | Teploty vody - týdenní | `0C` | °C |

### `historical/metadata/meta1.json`

Soubor obsahuje metadata historických objektů. Tvar odpovědi odpovídá obecnému metadatovému vzoru ČHMÚ:

```json
{
  "zaznamID": "...",
  "datovyZdrojID": "hydrologie",
  "datovyTokID": "Open.Data.Metadata",
  "datumVytvoreni": "...",
  "verzeDat": "1.0",
  "data": {
    "type": "DataCollection",
    "data": {
      "header": "...",
      "values": []
    }
  }
}
```

---

## 11. Větev `characteristic/`

URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/characteristic/
```

Struktura:

```text
/hydrology/groundwater/characteristic/
├── data/
└── metadata/
```

Adresář `characteristic/metadata/` obsahuje JSON Schema:

```text
GCHAR_SCHEMA.json
```

Adresář `characteristic/data/` obsahuje charakteristiky po objektech:

```text
GCHAR_{objID}.json
```

Příklad:

```text
GCHAR_0-203-1-PB0013.json
```

---

## 12. `characteristic/metadata/GCHAR_SCHEMA.json`

URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/characteristic/metadata/GCHAR_SCHEMA.json
```

Soubor je JSON Schema pro soubory `GCHAR_{objID}.json`.

### Kořenová struktura

```json
{
  "objID": "0-203-1-PB0013",
  "charList": []
}
```

| Pole | Typ | Popis |
|---|---:|---|
| `objID` | string | identifikátor objektu |
| `charList` | array | seznam charakteristik objektu |

### Charakteristika v `charList`

| Pole | Typ | Popis |
|---|---:|---|
| `charType` | string | typ charakteristiky |
| `unit` | string | jednotka |
| `quantile` | integer | kvantil |
| `distance` | string | fragmentace / perioda |
| `charData` | object | tabulková data charakteristiky |

### `charType`

| Hodnota | Význam |
|---|---|
| `Y` | vydatnost pramene |
| `H` | nadmořská výška hladiny ve vrtu |

### `unit`

| Hodnota | Význam |
|---|---|
| `L_S` | l/s |
| `MNM` | m n.m. |

Pravidla podle schématu:

| `charType` | Povolená jednotka |
|---|---|
| `Y` | `L_S` |
| `H` | `MNM` |

### `quantile`

Povolené hodnoty:

```text
5, 15, 25, 50, 75, 85, 95
```

### `distance`

| Hodnota | Význam |
|---|---|
| `W` | týden |
| `M` | měsíc |

### `charData`

`charData` je tabulka typu `DataCollection`.

Header:

```text
fragID,Value
```

| Sloupec | Typ | Popis |
|---|---:|---|
| `fragID` | integer | index období / fragmentu |
| `Value` | number | hodnota charakteristiky |

---

## 13. `characteristic/data/GCHAR_{objID}.json`

Příklad URL:

```text
https://opendata.chmi.cz/hydrology/groundwater/characteristic/data/GCHAR_0-203-1-PB0013.json
```

### Obecný tvar odpovědi

```json
{
  "objID": "0-203-1-PB0013",
  "charList": [
    {
      "charType": "Y",
      "unit": "L_S",
      "quantile": 5,
      "distance": "W",
      "charData": {
        "type": "DataCollection",
        "data": {
          "header": "fragID,Value",
          "values": [
            [1, 0.748],
            [2, 0.737],
            [3, 0.727]
          ]
        }
      }
    }
  ]
}
```

### Interpretace

Příklad výše znamená:

- objekt `0-203-1-PB0013`,
- charakteristika typu `Y` = vydatnost pramene,
- jednotka `L_S` = l/s,
- kvantil `5`,
- členění `W` = týdenní,
- hodnoty jsou tabulka `fragID → Value`.

U týdenních dat `fragID` odpovídá indexu týdne. U měsíčních dat odpovídá indexu měsíce.

---

## 14. Společný formát `DataCollection`

ČHMÚ v metadatech a charakteristikách často používá obecný tabulkový wrapper:

```json
{
  "type": "DataCollection",
  "data": {
    "header": "col1,col2,col3",
    "values": [
      ["value1", "value2", "value3"]
    ]
  }
}
```

### Pravidla parsování

1. `header` je string se sloupci oddělenými čárkou.
2. `values` je pole řádků.
3. Každý řádek je pole hodnot.
4. Pořadí hodnot v řádku odpovídá pořadí sloupců v `header`.
5. Parser by neměl spoléhat na pojmenovaná pole uvnitř řádku — řádky jsou poziční pole.

Příklad:

```json
{
  "header": "objID,DBC,OBJECT_NAME,OBJECT_TYPE,GEOGR1,GEOGR2,ALTITUDE",
  "values": [
    [
      "0-203-1-PB0013",
      "PB0013",
      "Ostružná",
      "spring",
      50.1798186,
      17.0549236,
      697
    ]
  ]
}
```

---

## 15. Společný formát časových řad

Datové soubory časových řad používají wrapper:

```json
{
  "objList": [
    {
      "objID": "0-203-1-PB0013",
      "tsList": [
        {
          "tsConID": "YD",
          "unit": "L_S",
          "tsData": [
            {
              "dt": "2026-05-30T05:00:00Z",
              "value": 1.06418
            }
          ]
        }
      ]
    }
  ]
}
```

### Pole

| Pole | Úroveň | Typ | Popis |
|---|---|---:|---|
| `objList` | root | array | seznam objektů |
| `objID` | object | string | identifikátor objektu |
| `tsList` | object | array | seznam časových řad |
| `tsConID` | time series | string | typ časové řady |
| `unit` | time series | string | jednotka |
| `tsData` | time series | array | hodnoty |
| `dt` | data point | ISO datetime | čas hodnoty |
| `value` | data point | number | hodnota |

---

## 16. Přehled jednotek

| `UNIT_ID` / `unit` | Význam |
|---|---|
| `L_S` | litry za sekundu |
| `MNM` | metry nad mořem |
| `0C` | stupně Celsia |

Poznámka: `0C` je zápis použitý v metadatech historických řad pro teplotu vody.

---

## 17. Přehled typů časových řad

| Kód | Popis | Jednotka |
|---|---|---|
| `HD` | hladiny - denní | `MNM` |
| `HT` | hladiny - týdenní | `MNM` |
| `YD` | vydatnost - denní | `L_S` |
| `YT` | vydatnost - týdenní | `L_S` |
| `TD` | teploty vody - denní | `0C` |
| `TT` | teploty vody - týdenní | `0C` |

Ve větvi `now` byly ověřeny hlavně:

| Kód | Popis | Jednotka |
|---|---|---|
| `HD` | hladiny - denní | `MNM` |
| `YD` | vydatnost - denní | `L_S` |

---

## 18. Typy objektů

V metadatech objektů je pole:

```text
OBJECT_TYPE
```

Ověřená hodnota:

```text
spring
```

Příklad:

```json
[
  "0-203-1-PB0013",
  "PB0013",
  "Ostružná",
  "spring",
  50.1798186,
  17.0549236,
  697
]
```

---

## 19. Příklady requestů

### Stažení kořenového indexu

```bash
curl "https://opendata.chmi.cz/hydrology/groundwater/"
```

### Stažení metadat aktuálních objektů

```bash
curl "https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta1.json"
```

### Stažení popisu aktuálních časových řad

```bash
curl "https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta2.json"
```

### Stažení aktuální hodnoty objektu

```bash
curl "https://opendata.chmi.cz/hydrology/groundwater/now/data/0-203-1-PB0013_D.json"
```

### Stažení měsíčních recent dat objektu

```bash
curl "https://opendata.chmi.cz/hydrology/groundwater/recent/data/0-203-1-PB0013_D_202605.json"
```

### Stažení schématu charakteristik

```bash
curl "https://opendata.chmi.cz/hydrology/groundwater/characteristic/metadata/GCHAR_SCHEMA.json"
```

### Stažení charakteristik objektu

```bash
curl "https://opendata.chmi.cz/hydrology/groundwater/characteristic/data/GCHAR_0-203-1-PB0013.json"
```

---

## 20. Doporučený postup parsování API

Tato sekce popisuje pouze obecný postup práce s API, nikoli napojení do konkrétní databáze nebo aplikace.

### 1. Načíst metadata objektů

```text
GET /hydrology/groundwater/now/metadata/meta1.json
```

Získáš seznam objektů s:

- identifikátorem,
- názvem,
- typem objektu,
- souřadnicemi,
- nadmořskou výškou.

### 2. Načíst metadata časových řad

```text
GET /hydrology/groundwater/now/metadata/meta2.json
```

Získáš mapování kódů jako `YD` nebo `HD` na popis a jednotku.

### 3. Pro vybraný objekt stáhnout datový soubor

```text
GET /hydrology/groundwater/now/data/{objID}_D.json
```

Například:

```text
GET /hydrology/groundwater/now/data/0-203-1-PB0013_D.json
```

### 4. V souboru vybrat požadovanou časovou řadu

Pro vydatnost pramene:

```text
tsConID = YD
unit = L_S
```

### 5. Zpracovat `tsData`

Každá položka má:

```json
{
  "dt": "2026-05-30T05:00:00Z",
  "value": 1.06418
}
```

---

## 21. Chybové a okrajové stavy

Protože API funguje jako statické soubory, je vhodné počítat s těmito situacemi:

### Soubor nemusí existovat

Ne každý objekt musí mít soubor pro každou kombinaci období nebo typu dat.

> **Empiricky ověřeno (2026-05):** větev `now/` je pro prameny **neúplná** — řada
> objektů uvedených v `now/metadata/meta1.json` nemá v `now/data/` žádný soubor
> (HTTP 404), zatímco `recent/data/{objID}_D_{YYYYMM}.json` pro ně poslední
> hodnotu obsahuje. Pro úplné pokrytí je proto vhodný fallback `now → recent`.
> Tvar prezentace `now/` jako „poslední hodnoty pro objekty" (sekce 1) tedy
> neznamená, že soubor existuje pro každý objekt.

### `tsData` může být prázdné

Syntakticky existující časová řada nemusí obsahovat žádné hodnoty.

### Objekt může mít více časových řad

Vždy filtruj podle `tsConID` a `unit`, ne podle pořadí v poli `tsList`.

### Metadata se mohou změnit

Soubor `meta1.json` má vlastní `datumVytvoreni` a může se měnit v čase.

### Recent data nemusí být souvislá

V adresáři `recent/data/` mohou u některých objektů chybět některé měsíce.

### Hodnoty jsou číselné, ale význam určuje jednotka

Vždy interpretuj `value` až společně s `unit`.

---

## 22. Shrnutí nejdůležitějších endpointů

| Účel | URL |
|---|---|
| kořen groundwater API | `https://opendata.chmi.cz/hydrology/groundwater/` |
| aktuální data | `https://opendata.chmi.cz/hydrology/groundwater/now/` |
| metadata aktuálních objektů | `https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta1.json` |
| metadata aktuálních časových řad | `https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta2.json` |
| aktuální data objektu | `https://opendata.chmi.cz/hydrology/groundwater/now/data/{objID}_D.json` |
| recent data | `https://opendata.chmi.cz/hydrology/groundwater/recent/` |
| měsíční recent data objektu | `https://opendata.chmi.cz/hydrology/groundwater/recent/data/{objID}_D_{YYYYMM}.json` |
| historická metadata | `https://opendata.chmi.cz/hydrology/groundwater/historical/metadata/` |
| charakteristiky | `https://opendata.chmi.cz/hydrology/groundwater/characteristic/` |
| schéma charakteristik | `https://opendata.chmi.cz/hydrology/groundwater/characteristic/metadata/GCHAR_SCHEMA.json` |
| charakteristiky objektu | `https://opendata.chmi.cz/hydrology/groundwater/characteristic/data/GCHAR_{objID}.json` |

---

## 23. Minimální příklad kompletního čtení objektu

Objekt:

```text
0-203-1-PB0013
```

### 1. Metadata objektu

```text
GET https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta1.json
```

Najít řádek:

```json
[
  "0-203-1-PB0013",
  "PB0013",
  "Ostružná",
  "spring",
  50.1798186,
  17.0549236,
  697
]
```

### 2. Metadata časových řad

```text
GET https://opendata.chmi.cz/hydrology/groundwater/now/metadata/meta2.json
```

Relevantní řádek:

```json
["YD", "Vydatnost - denní", "L_S", "l/s"]
```

### 3. Aktuální hodnota

```text
GET https://opendata.chmi.cz/hydrology/groundwater/now/data/0-203-1-PB0013_D.json
```

Odpověď:

```json
{
  "objList": [
    {
      "objID": "0-203-1-PB0013",
      "tsList": [
        {
          "tsConID": "YD",
          "unit": "L_S",
          "tsData": [
            {
              "dt": "2026-05-30T05:00:00Z",
              "value": 1.06418
            }
          ]
        }
      ]
    }
  ]
}
```

Interpretace:

```text
Objekt: 0-203-1-PB0013
Název: Ostružná
Typ: spring
Souřadnice: 50.1798186, 17.0549236
Nadmořská výška: 697 m
Časová řada: YD
Měřená veličina: vydatnost - denní
Jednotka: l/s
Čas hodnoty: 2026-05-30T05:00:00Z
Hodnota: 1.06418 l/s
```

---

## 24. Poznámky k datům

- Časy v ukázkových datových souborech jsou ve formátu ISO 8601 s `Z`, tedy UTC.
- Souřadnice v `GEOGR1` a `GEOGR2` jsou desetinná čísla.
- `GEOGR1` odpovídá zeměpisné šířce.
- `GEOGR2` odpovídá zeměpisné délce.
- U pramenů je relevantní veličina `YD`, tedy denní vydatnost v `L_S`.
- Pro vrty může být relevantní veličina `HD`, tedy hladina v `MNM`.
- Historická metadata uvádějí i teplotu vody (`TD`, `TT`) v jednotce `0C`.
