# Updating the data from the Re:Cycle Hub

The hub (hub.liightning.dev) serves the live game tables to logged-in users.
`hub-import.js` turns an export of those tables into the files in this repo.

## 1. Export from the hub

1. Open https://hub.liightning.dev/tools/calc and sign in with Discord.
2. Press F12, open the Console tab, paste the snippet below and press Enter.
   (Chrome may ask you to type `allow pasting` first.)
3. Chrome saves `hub-datatables-YYYY-MM-DD.json` (about 5 MB). If it shows a
   Save window, save it to Downloads.

```js
(async () => {
  const tables = ["PRO_Weapons","PRO_Tuning","PRO_Mods","PRO_PlayerShield","PRO_Helmets","PRO_Bags",
    "PRO_Abilities","Pro_KeyCards","Contract_DT","Locations_DT","TechTreeNodes_DT",
    "PlayerQuarterUpgrades_DT","QuestItems_DT","Materials_DT","Factions_DT","Currencies_DT"];
  const strings = ["ST_Contracts","ST_Weapons","ST_Station","ST_Materials","ST_Equipment",
    "ST_Abilities","ST_Mods","ST_Factions"];
  const bundle = {datatables: {}, localization: {}, fetchedAt: new Date().toISOString()};
  for (const t of tables) {
    const r = await fetch("/api/datatables/" + t);
    if (r.ok) bundle.datatables[t] = await r.json(); else console.warn("skipped", t, r.status);
  }
  for (const s of strings) {
    const r = await fetch("/api/localization/" + s);
    if (r.ok) bundle.localization[s] = await r.json(); else console.warn("skipped", s, r.status);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(bundle)], {type: "application/json"}));
  a.download = "hub-datatables-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
})();
```

## 2. Import

```
node hub-import.js C:\Users\<you>\Downloads\hub-datatables-YYYY-MM-DD.json --dry
node hub-import.js C:\Users\<you>\Downloads\hub-datatables-YYYY-MM-DD.json
node sync.js
```

`--dry` prints every change without writing anything. Read it before the real
run. Running the import twice in a row reports 0 changes the second time.

## What gets updated

| File | From the hub |
|---|---|
| weapons.json | stats, prices, names, new weapons. New weapons with no shop or recipe get `"unreleased": true`, removed again once they are sold. `projectileSpeed` and `tags` are not in the hub data and are kept (new `_02` weapons copy them from their `_01`). |
| shields.json, helmets.json | armour, durability, repair, perks, recipes, new variants |
| personalQuarters.json | every tech tree node (now with `name` and `category`) and the quarters levels. The game stores the cost of *leaving* a level on its row; this file stores the cost of *reaching* it, so the script shifts by one. |
| materials.json | new materials and quest items; price, rarity, weight and stack size of existing ones |
| consumables.json | new consumables. Grenades use their real keys (`ShockGrenade_0x`). New ones get `tuning: null`, because the hub's tuning rows for abilities are shared and not per item. |
| jobs.json | new jobs from the `NEW-` series and the Badum faction; jobs the game disabled are removed. The plain `Easy-/Medium-/Hard-` rows are original-game leftovers and are skipped. |
| printing.json | follows key renames |
| localization.json | names for materials that had none |
| items.json | rebuilt from all of the above, including the `uses` index |

`missions.json` and `attachments.json` are only compared: anything new is
listed as `NOT ADDED` and has to be added by hand.

## Things that need a human

- Hub field names are Unreal's (`m_directDamage`, ...). If the import stops
  with "Export is missing ..." or numbers come out empty, a table or field was
  renamed; fix the mapping in `hub-import.js`.
- A per-rarity price override of 0 is treated as "not set" and the item's
  default price is used instead.
