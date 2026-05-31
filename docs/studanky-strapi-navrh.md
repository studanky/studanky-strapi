# Studánky — datový model a architektura Strapi v5

*Technický návrh backendu podle best practices: custom controllery/services/routes, Document Service API, škálovatelnost. Navazuje na `studanky-specifikace.md`.*

---

## 1. Principy návrhu

- **Strapi v5 Document Service API** (`strapi.documents(...)`) — Entity Service je deprecated, nepoužívat. Dokumenty se adresují přes `documentId`.
- **Tenké controllery, logika ve services.** Controller validuje a deleguje; veškerá byznys logika (sync, výpočet důvěry, denormalizace) je v services → testovatelné a znovupoužitelné z cronu i z API.
- **Denormalizace pro horké čtení.** Stav studánky pro mapu se počítá při zápisu reportu a ukládá přímo na studánku, takže mapový endpoint nečte historii reportů. Toto je hlavní rozhodnutí pro škálu.
- **Idempotence a offline-first.** Každý report nese klientský `clientReportId`, aby opakované odeslání z fronty nevytvořilo duplicitu.
- **Soukromí v outputu.** Citlivá pole (identita reportéra, raw GPS) se nikdy neposílají do veřejného API — sanitizace na úrovni controlleru.
- **TypeScript** (Strapi v5 je TS-first).

---

## 2. Content-types (kolekce) a komponenty

### 2.1 Přehled

| Typ | UID | Účel |
|---|---|---|
| Spring (studánka) | `api::spring.spring` | Hlavní entita + denormalizovaný aktuální stav pro mapu |
| Report (záznam/měření) | `api::report.report` | Jednotlivá pozorování (z ČHMÚ i od uživatelů) |
| Owner (vlastník) | `api::owner.owner` | Organizace spravující své studánky |
| Platform Config | `api::platform-config.platform-config` | **Single type** — dynamické parametry (práh čerstvosti, převod l/s → škála) |

Komponenty: `shared.geo-point` (latitude, longitude) a `config.flow-range` (scale, minLps, maxLps).

### 2.2 Spring — `api::spring.spring`

| Pole | Typ | Pozn. |
|---|---|---|
| `name` | string, required | název studánky |
| `description` | text | popisek (editovatelný vlastníkem) |
| `latitude` | decimal, required, **indexováno** | top-level (ne komponenta) kvůli rychlému bbox dotazu na mapě |
| `longitude` | decimal, required, **indexováno** | |
| `externalSource` | enum: `chmu` \| `manual` | původ; pro budoucí další zdroje |
| `externalId` | string, **index (externalSource+externalId unikátní)** | klíč pro párování při ČHMÚ syncu — **ČHMÚ `objID`** (např. `0-203-1-PB0013`) |
| `owner` | relation manyToOne → `owner`, nullable | organizační metadata (kdo zodpovídá); **není** přístupový mechanismus |
| `managers` | relation **manyWay → `admin::user`** | **řízení přístupu** — admini, kteří smí studánku spravovat v panelu (viz 2.4) |
| `lastStatus` | enum: `flowing` \| `not_flowing` \| `unknown` | **denormalizace** z posledního reportu |
| `lastFlowRateLps` | decimal, nullable | poslední naměřený průtok |
| `lastFlowScale` | integer (1–5), nullable | poslední síla na společné škále |
| `lastReportAt` | datetime, **indexováno** | čas posledního měření → aplikace z něj počítá čerstvost |

> Souřadnice studánky jsou záměrně **top-level decimal pole**, ne komponenta — mapový dotaz tak filtruje a indexuje přímo nad sloupci (`$gte`/`$lte`) bez joinu. Komponentu `geo-point` použijeme jen pro GPS zachycené u reportu.

QR kód nese **`documentId` + HMAC podpis** (viz sekce 6). Žádné extra pole není nutné — `documentId` je v v5 stabilní identifikátor.

### 2.3 Report — `api::report.report`

| Pole | Typ | Pozn. |
|---|---|---|
| `spring` | relation manyToOne → `spring`, **index** | |
| `source` | enum: `chmu` \| `user_verified` \| `user_anonymous` | úroveň důvěry podle původu |
| `measurementMethod` | enum: `chmu_sensor` \| `stopwatch` \| `subjective` | |
| `isFlowing` | boolean | nejdůležitější signál |
| `flowScale` | integer (1–5), nullable | společná škála |
| `flowRateLps` | decimal, nullable | naměřeno (stopky / ČHMÚ); potvrzuje, že nejde o pocit |
| `hasOdor` | boolean, nullable | |
| `turbidity` | integer (1–5), nullable | kalná → čirá |
| `measuredAt` | datetime, **index** | čas vyplnění/měření (z klienta — offline) |
| `receivedAt` | datetime | čas přijetí serverem |
| `capturedLocation` | komponenta `shared.geo-point`, nullable, **private** | GPS zařízení v okamžiku vyplnění |
| `trustScore` | integer (0–100) | spočítáno při zápisu (zdroj + geofence + metoda) |
| `reporter` | relation → users-permissions user, nullable, **private** | u anonymních prázdné |
| `clientReportId` | uid/string, **unikátní index** | idempotence offline fronty |
| `flaggedCount` | integer, default 0 | počet nahlášení nepravdivosti |

Draft & Publish u reportů **vypnout** — jsou to neměnné záznamy, ne editovaný obsah.

### 2.4 Owner — `api::owner.owner`

| Pole | Typ |
|---|---|
| `name` | string, required |
| `type` | enum: `chmu` \| `lesy_cr` \| `archdiocese` \| `tourist_assoc` \| `chko` \| `other` |
| `contactEmail` | email |
| `springs` | relation oneToMany → `spring` |

> **Scoping vlastníků (vyřešeno, Community edice — bez Enterprise):** přístup řídí relace **`managers` (manyWay → `admin::user`)** přímo na studánce + **Document Service middleware** registrovaný v `register()`, který pro ne-super-admina injektuje filtr `managers: { id: { $eq: currentUserId } }` na `findMany / findOne / update / delete` u `api::spring.spring`. Super-admin vidí vše. Owner content-type je jen organizační metadata, ne přístupový mechanismus.
>
> **Hardening (ověřit):**
>
> 1. **Filtr aplikovat jen v admin kontextu** — Document Service prochází i veřejné API; middleware musí vázat na admin auth strategii, ne jen na přítomnost `ctx.state.user` (jinak přihlášený app uživatel na veřejném `/springs/map` dostane filtr `managers` a uvidí prázdno). **Konkrétní návrh viz 2.4.1.**
> 2. **Pole `managers` editovatelné jen super-adminem** (field-level permission / kontrola v `update`), ať si owner nemění, kdo má přístup.
> 3. **`create` neudělovat** owner roli (studánky zakládá jen provozovatel).
> 4. Stejný vzor později pro `report` (filtr přes `spring.managers`).

#### 2.4.1 Návrh vylepšení middleware — robustní rozlišení admin vs. public

**Problém současné implementace:** middleware rozpoznává volajícího jen implicitně podle přítomnosti `ctx.state.user`. To nerozliší bezpečně mezi Admin Panel requestem, veřejným unauthenticated requestem, **přihlášeným `users-permissions` uživatelem**, API tokenem a interním server-side voláním. Konkrétní riziko: přihlášený app uživatel na veřejném endpointu má `ctx.state.user` vyplněný (svým UP userem) → současný kód ho omylem vezme jako admina, `isSuperAdmin` je `false` a aplikuje `managers.id = publicUser.id` → uživatel **nevidí žádné studánky**.

**Řešení:** filtr aplikovat jen tehdy, když request prošel **admin auth strategií**, ne jen když existuje nějaký user. Primární signál je `ctx.state.auth.strategy.name === 'admin'`; jako pojistku ověřit i tvar admin usera (`roles[]` s `code`), protože UP user má jen jednorobné `role`, ne pole `roles`.

```ts
// src/middlewares/document/spring-scope.ts (navrhovaná robustní verze)
const SCOPED_UID = 'api::spring.spring';
const SCOPED_ACTIONS = ['findMany', 'findOne', 'update', 'delete'];

export default () => async (context, next) => {
  // 1) jen Spring + relevantní akce
  if (context.uid !== SCOPED_UID || !SCOPED_ACTIONS.includes(context.action)) {
    return next();
  }

  const ctx = strapi.requestContext.get();

  // 2) žádný request context → interní volání (cron, bootstrap, services) → bez filtru
  if (!ctx) return next();

  // 3) ROBUSTNÍ GATE: filtruj JEN pro Admin Panel auth strategii.
  //    Vyloučí users-permissions, api-token i veřejný unauth. request.
  if (ctx.state?.auth?.strategy?.name !== 'admin') return next();

  // 4) pojistka: ověř tvar admin usera (UP user nemá pole roles[])
  const user = ctx.state.user as { id: number; roles?: { code: string }[] } | undefined;
  if (!user || !Array.isArray(user.roles)) return next();

  // 5) super-admin vidí vše
  if (user.roles.some((r) => r.code === 'strapi-super-admin')) return next();

  // 6) merge s existujícími filtry ($and), ať nepřepíšeme hledání/řazení v list view
  context.params = context.params ?? {};
  context.params.filters = {
    $and: [context.params.filters ?? {}, { managers: { id: { $eq: user.id } } }],
  };

  return next();
};
```

**Poznámky:**

- Klíčová změna oproti `src/index.ts:52`: místo „user existuje → je to admin" se gate-uje na `strategy === 'admin'`. Přesný název strategie ověřit pro danou verzi Strapi; tvar `roles[]` slouží jako nezávislá pojistka.
- Filtry se **mergují přes `$and`**, ne přepisují — admin si v list view může sám filtrovat/hledat.
- Tohle je přístupová hranice **pro admin panel**. Přístup veřejného content API (mapa, detail) řídí RBAC role + custom controllery/policy, ne tento middleware.
- U `update`/`delete` (operují přes `documentId`) ověřit, že injektovaný `filters` reálně omezuje i tyto akce; pokud ne, doplnit explicitní kontrolu vlastnictví před zápisem.

### 2.5 Platform Config — single type `api::platform-config.platform-config`

| Pole | Typ | Default |
|---|---|---|
| `freshnessThresholdDays` | integer | 14 |
| `flowScaleRanges` | repeatable komponenta `config.flow-range` | viz níže |

`config.flow-range`: `scale` (1–5), `minLps` (decimal), `maxLps` (decimal). Service `flowScaleFromLps(lps)` z toho vrátí stupeň. Veřejně čitelné přes `GET /api/platform-config`.

> **Rozšiřitelnost na země/vlastníky:** až bude potřeba, převodní tabulku osamostatníme do kolekce `flow-profile` (scope = global / country / owner) a config bude referencovat default profil. Pro MVP stačí single type.

---

## 3. Vztahy

```
Owner 1 ───── * Spring 1 ───── * Report * ───── 0..1 User (users-permissions)
                  │
                  ├─ managers * ───── * Admin User (admin::user)   ← řízení přístupu v panelu
                  └─ denormalizovaný lastStatus / lastFlowScale / lastReportAt
```

---

## 4. Custom API endpointy

| Metoda | Cesta | Akce | Auth | Fáze |
|---|---|---|---|---|
| GET | `/api/springs/map` | `spring.map` — minimální body pro mapu dle bbox | public read | MVP |
| GET | `/api/springs/:documentId` | core `findOne` (omezený populate) | public read | MVP |
| GET | `/api/springs/:documentId/reports` | `spring.reports` — stránkovaná historie (lazy load) | public read | MVP |
| GET | `/api/platform-config` | core `find` (single type) | public read | MVP |
| POST | `/api/reports` | `report.create` (override) — submit z aplikace | public + JWT | Fáze 2 |
| POST | `/api/reports/:documentId/flag` | `report.flag` — nahlášení nepravdivosti | public + JWT | Fáze 3 |
| POST | `/api/springs/sync-chmu` | `spring.syncChmu` — manuální spuštění syncu | admin only | MVP (ops) |

Custom routy se dávají do souboru s prefixem `01-` (např. `routes/01-spring-custom.ts`), aby se načetly před core routami.

### 4.1 Mapový endpoint (controller → service)

```ts
// src/api/spring/controllers/spring.ts
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::spring.spring', ({ strapi }) => ({
  async map(ctx) {
    await this.validateQuery(ctx);              // v5: validace query
    const { bbox } = ctx.query;                 // "minLng,minLat,maxLng,maxLat"
    const points = await strapi
      .service('api::spring.spring')
      .findInBbox(bbox);
    return { data: points };                    // jen sanitizovaná veřejná pole
  },

  async reports(ctx) {
    const { documentId } = ctx.params;
    const { page = 1, pageSize = 20 } = ctx.query;
    return strapi.service('api::spring.spring').history(documentId, +page, +pageSize);
  },
}));
```

```ts
// src/api/spring/services/spring.ts (výřez)
async findInBbox(bbox: string) {
  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
  return strapi.documents('api::spring.spring').findMany({
    filters: {
      latitude:  { $gte: minLat, $lte: maxLat },
      longitude: { $gte: minLng, $lte: maxLng },
    },
    // POUZE pole nutná pro mapu — žádná historie reportů:
    fields: ['name', 'latitude', 'longitude', 'lastStatus', 'lastReportAt'],
  });
}
```

> Aplikace si stáhne `lastReportAt` + práh z `platform-config` a **třetí stav „zastaralé" dopočítá sama** vůči aktuálnímu času. Server vrací jen `flowing/not_flowing` + timestamp (konzistentní se specifikací, sekce 7.2).

Historie přes `pagination` (lazy load). Pro stabilní nekonečné scrollování zvážit **cursor-based** stránkování podle `measuredAt` místo offsetu.

### 4.2 Submit reportu (Fáze 2) — byznys logika v service

```ts
// src/api/report/services/report.ts (výřez)
async submit(input, user) {
  // 1) idempotence offline fronty
  const existing = await strapi.documents('api::report.report').findMany({
    filters: { clientReportId: input.clientReportId }, limit: 1,
  });
  if (existing.length) return existing[0];

  // 2) ověření studánky + HMAC z QR
  const spring = await this.resolveSignedSpring(input.springId, input.sig);

  // 3) geofence 200 m + skóre důvěry
  const trust = this.computeTrust({ spring, input, user });

  // 4) převod l/s → škála ze sdílené konfigurace
  const flowScale = input.flowRateLps != null
    ? await strapi.service('api::platform-config.platform-config').flowScaleFromLps(input.flowRateLps)
    : input.flowScale;

  // 5) zápis přes Document Service API
  const report = await strapi.documents('api::report.report').create({
    data: {
      spring: spring.documentId,
      source: user ? 'user_verified' : 'user_anonymous',
      measurementMethod: input.flowRateLps != null ? 'stopwatch' : 'subjective',
      isFlowing: input.isFlowing,
      flowScale, flowRateLps: input.flowRateLps,
      hasOdor: input.hasOdor, turbidity: input.turbidity,
      measuredAt: input.measuredAt, receivedAt: new Date(),
      capturedLocation: input.location, trustScore: trust,
      reporter: user?.id ?? null, clientReportId: input.clientReportId,
    },
  });

  // 6) denormalizace aktuálního stavu na studánku
  await strapi.service('api::spring.spring').refreshLatest(spring.documentId);
  return report;
}
```

`refreshLatest(documentId)` najde poslední důvěryhodný report studánky a přepíše `lastStatus / lastFlowScale / lastFlowRateLps / lastReportAt`. Volá ho jak `report.submit`, tak ČHMÚ sync — jediné místo pravdy pro denormalizaci.

---

## 5. ČHMÚ sync (cron + service)

Naplánovaná úloha jen **spouští service** — žádná logika v cronu.

```ts
// config/cron-tasks.ts
export default {
  chmuSync: {
    task: async ({ strapi }) => {
      await strapi.service('api::spring.spring').syncFromChmu();
    },
    options: { rule: '30 0 * * *', tz: 'Europe/Prague' }, // 00:30 místního času
  },
};
```

```ts
// config/server.ts — zapnutí cronu
export default ({ env }) => ({
  // ...
  cron: { enabled: true, tasks: require('./cron-tasks').default },
});
```

### 5.1 Povaha ČHMÚ Open Data (groundwater)

**Není to REST API, ale statická souborová struktura nad HTTPS** (`https://opendata.chmi.cz/hydrology/groundwater/`). Data se získávají stahováním JSON souborů. Relevantní pro prameny je větev `now/`:

- `now/metadata/meta1.json` — seznam objektů ve formátu `DataCollection` (header + poziční `values`). Sloupce: `objID, DBC, OBJECT_NAME, OBJECT_TYPE, GEOGR1 (šířka), GEOGR2 (délka), ALTITUDE`. **Prameny mají `OBJECT_TYPE = 'spring'`.**
- `now/data/{objID}_D.json` — aktuální hodnota objektu: `objList[].tsList[].tsData[]`. Pro prameny je relevantní řada **`tsConID = 'YD'` (vydatnost denní), `unit = 'L_S'`** → hodnota je **vydatnost v l/s**. Poslední bod v `tsData` má `dt` (UTC) a `value`.

> **Tím se uzavírá otevřená otázka jednotek:** ČHMÚ dává l/s, což přímo plní `flowRateLps` a sedí na metodu se stopkami — žádný převod m³/s není potřeba.

### 5.2 `chmu-client.ts` — stahování a parsování

1. GET `now/metadata/meta1.json`, naparsovat `DataCollection` **pozičně** (řádky jsou pole, ne pojmenované objekty), filtr `OBJECT_TYPE === 'spring'` → seznam `{ objID, name, lat=GEOGR1, lng=GEOGR2, altitude }`.
2. Pro každý `objID`: GET `now/data/{objID}_D.json`, v `tsList` najít řadu podle **`tsConID==='YD' && unit==='L_S'`** (ne podle pořadí v poli), vzít poslední bod `tsData` → `{ dt, valueLps }`.
3. Ošetřit okrajové stavy z dokumentace: soubor nemusí existovat (404), `tsData` může být **prázdné** (→ stav `unknown`), objekt může mít víc řad.

### 5.3 `syncFromChmu()` — service

1. Načíst seznam pramenů z `meta1.json`. **Upsert ČHMÚ studánek** (`externalSource='chmu'`, `externalId=objID`): vytvořit chybějící, aktualizovat název/souřadnice. (ČHMÚ studánky spravuje provozovatel; QR se zatím neřeší.)
2. Pro každý objekt stáhnout aktuální hodnotu (viz 5.2). Odvodit:
   - `flowRateLps = valueLps`,
   - `isFlowing = valueLps > 0` (prázdné `tsData` → `unknown`),
   - `measuredAt = dt`,
   - `flowScale = flowScaleFromLps(valueLps)`.
3. **Jen pokud je `dt` novější** než `lastReportAt` studánky → vytvořit nový `report` (`source='chmu'`, `measurementMethod='chmu_sensor'`) přes Document Service a zavolat `refreshLatest`. → idempotence: cron běží denně, ale ČHMÚ aktualizuje jen některé objekty.
4. **Throttling:** ~300 objektů = ~300 jednotlivých stažení. Omezit souběh (např. concurrency 5–10, `p-limit`), timeout, retry; jedna selhavší stanice nesmí shodit běh (`try/catch` per objekt). Při výpadku ČHMÚ **nechat poslední data** (fallback dle NFR).
5. Volitelně podmíněné dotazy (`If-Modified-Since`) a logování výsledku do kolekce `job-log` pro observabilitu.

> Lifecycle hooky v5 **nejsou** doporučená cesta pro tohle — logika patří do service volané cronem a controllerem. Document-service middleware (`strapi.documents.use()`) je vhodný jen pro průřezové věci (např. univerzální sanitizace), ne pro hlavní tok.

---

## 6. QR podpis a ověření přítomnosti

- QR obsahuje URL `https://studanky.app/s/{documentId}?sig={HMAC}`.
- `sig = HMAC_SHA256(documentId, SERVER_SECRET)` — generuje se při **vytvoření studánky provozovatelem** (custom admin akce / service). Tajný klíč v env proměnné.
- Při submitu server podpis **přepočítá a ověří** → brání podvržení URL pro neexistující/cizí studánku. Statický podpis je v pořádku, slouží k autenticitě QR, ne k jednorázovosti.
- Přítomnost řeší **GPS geofence 200 m** + timestamp z okamžiku vyplnění (viz spec 8.1). `trustScore` se skládá ze zdroje (přihlášený > anonym), shody geofence a metody (měřeno > subjektivně).

---

## 7. Oprávnění, soukromí a výkon

- **Public role:** povolit pouze čtení `spring.map`, `spring.findOne`, `spring.reports`, `platform-config.find`; (Fáze 2) `report.create`, `report.flag`.
- **Sanitizace outputu:** v custom controllerech používat `this.sanitizeOutput` / `sanitizeQuery` / `validateQuery`. Pole `reporter` a `capturedLocation` označit jako **private** → nikdy nejdou ven (GDPR, spec 9.2).
- **Rate limiting** na `POST /reports`, zvlášť pro anonymní.
- **Indexy:** `(externalSource, externalId)` unikátní, `(latitude, longitude)`, `report.spring`, `report.measuredAt`, `report.clientReportId` unikátní.
- **Cache:** `spring.map` a `platform-config` jsou ideální pro cache (CDN/Redis) — mění se zřídka, čtou se hodně.

---

## 8. Struktura projektu

```
src/
  api/
    spring/
      content-types/spring/schema.json
      controllers/spring.ts          # map, reports, syncChmu
      services/spring.ts             # findInBbox, history, refreshLatest, syncFromChmu
      services/chmu-client.ts        # fetch + parse ČHMÚ
      routes/spring.ts               # core router
      routes/01-spring-custom.ts     # /map, /:id/reports, /sync-chmu
    report/
      content-types/report/schema.json
      controllers/report.ts          # create (override), flag
      services/report.ts             # submit, computeTrust, resolveSignedSpring
      routes/report.ts
      routes/01-report-custom.ts     # /:id/flag
    owner/ ...
    platform-config/                 # single type + flowScaleFromLps
  components/
    shared/geo-point.json
    config/flow-range.json
  middlewares/
    document/spring-scope.ts         # admin-scope filtr managers (Document Service middleware)
  index.ts                           # register: strapi.documents.use(springScope); bootstrap: cron
config/
  cron-tasks.ts
  server.ts
```

---

## 9. Co je v MVP a co později

- **MVP:** Spring + Report + Platform Config content-types; ČHMÚ sync (cron + service); endpointy `map`, `findOne`, `reports`, `platform-config`; denormalizace `lastStatus/lastReportAt`; tři stavy ikony (čerstvost). Žádné submit/auth/QR/GPS.
- **Fáze 2:** `report.submit` (offline-first, idempotence), QR HMAC, stopky → l/s → škála. (Owner scoping `managers` + middleware lze nasadit už v MVP, je nezávislý na sběru dat.)
- **Fáze 3:** přihlášení, `trustScore`, geofence, `flag`, odměňování.

---

## 10. Otevřené implementační otázky

- **Owner scoping — vyřešeno:** `managers` (manyWay → `admin::user`) + Document Service middleware, **Community edice, bez EE** (viz 2.4). Navržen robustní gate na admin auth strategii (viz 2.4.1); zbývá ověřit přesný název strategie pro danou verzi, omezení pole `managers` na super-admina, vynucení filtru u `update`/`delete` a neudělení `create` owner roli.
- ~~Formát ČHMÚ API~~ **vyřešeno** dokumentací: statické soubory, vydatnost `YD` v **l/s**, `objID` jako `externalId`, `OBJECT_TYPE='spring'` (viz 5.1–5.3).
- **Konkrétní rozsahy `flow-range`** (l/s → 1–5) — nyní mají základ (data jsou v l/s); ideálně doladit podle **reálné distribuce vydatností** napříč ~300 prameny, kterou odhalí první běh syncu.
- **Stránkování historie:** offset vs cursor-based pro lazy load.
- **Cache vrstva** map endpointu (kdy zavést).
