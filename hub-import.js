// Updates the root data files from a Re:Cycle Hub export.
//
//   node hub-import.js hub-datatables-YYYY-MM-DD.json   # write changes
//   node hub-import.js <export> --dry                   # report only
//
// Then run `node sync.js` to refresh min/ and array/.
// How to get the export file: see HUB-EXPORT.md.
//
// What it does, file by file:
//   weapons.json       stats, prices, names and new weapons from PRO_Weapons + PRO_Tuning.
//                      Keeps projectileSpeed and tags (not in the hub data). New weapons
//                      without a shop or recipe get "unreleased": true.
//   shields/helmets    armour, durability, repair, perks, prices, new variants.
//   personalQuarters   all tech tree nodes (with name/category) and quarters levels.
//   materials.json     adds new materials and quest items, updates prices on existing ones.
//   consumables.json   adds new consumables, renames grenades to their real keys.
//   jobs.json          adds new named side jobs, drops jobs the hub has disabled.
//   printing.json      follows the grenade renames.
//   localization.json  names for new materials.
//   forgePerks/Recipes/Settings  forge perks (new ones, materials, ranges), ingot recipes, settings.
//   items.json         rebuilt from all of the above, including the "uses" index.
// missions.json and attachments.json are only compared, never written.

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {buildItems} from "./hub-items.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const exportPath = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry");
if (!exportPath) {
    console.error("Usage: node hub-import.js <hub-datatables.json> [--dry]");
    process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(exportPath, "utf8"));
const DT = bundle.datatables;
const LOC = bundle.localization;
for (const t of ["PRO_Weapons", "PRO_Tuning", "PRO_PlayerShield", "PRO_Helmets", "TechTreeNodes_DT", "PlayerQuarterUpgrades_DT", "Materials_DT", "PRO_Abilities", "Contract_DT"]) {
    if (!Array.isArray(DT[t])) throw new Error(`Export is missing ${t}`);
}

// ---------------------------------------------------------------- helpers
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const changes = [];
const note = (msg) => changes.push(msg);

function write(f, data) {
    // same style as the hand-edited files: 2 spaces, CRLF
    const text = JSON.stringify(data, null, 2).replace(/\n/g, "\r\n");
    if (!DRY) fs.writeFileSync(path.join(DIR, f), text);
}

function txt(s) {
    if (typeof s !== "string") return s ?? "";
    let m = s.match(/^LOCTABLE\("([^"]+)",\s*"([^"]+)"\)$/);
    if (m) return (LOC[m[1]] || {})[m[2]] ?? "";
    m = s.match(/^INVTEXT\("([\s\S]*)"\)$/);
    if (m) return m[1].replace(/\\"/g, '"');
    m = s.match(/^NSLOCTEXT\("[^"]*",\s*"[^"]*",\s*"([\s\S]*)"\)$/);
    if (m) return m[1];
    return s;
}
const strip = (s) => (typeof s === "string" && s.includes("::") ? s.split("::")[1] : s);
const round = (n) => (typeof n === "number" ? Number(n.toFixed(6)) : n);
const tags = (t) => ((t && t.GameplayTags) || []).map((g) => g.TagName);
const displayName = (r) => txt(r.m_metaUIItem?.display_name) || txt(r.m_name) || txt(r.m_weaponName);
const description = (r) => txt(r.m_metaUIItem?.description);

function costOf(shops) {
    return (shops || []).map((s) => {
        const o = {shop: s.m_shop.RowName};
        for (const i of s.m_craftingPrice.m_itemRecipeIngredients) o[i.m_costType.RowName] = i.m_costAmount;
        return o;
    });
}
const costMap = (list) => Object.fromEntries((list || []).map((c) => [c.m_costType.RowName, c.m_costAmount]));

function sellValue(r) {
    const rar = r.m_rarity;
    const o = r.m_overrideScrappingReturnsPerRarity || {};
    return o[rar] || r.m_scrappingReturnDefault; // 0 means not set (new items)
}
function factionRep(r) {
    const o = r.m_overrideScrappingReputationPerRarity || {};
    return o[r.m_rarity] || r.m_scrappingFactionProgressionIncrement;
}

// Replace fields on an existing entry without changing its key order.
function merge(target, fields, label) {
    for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        if (JSON.stringify(target[k]) !== JSON.stringify(v)) {
            if (k in target) note(`${label}.${k}: ${JSON.stringify(target[k])} -> ${JSON.stringify(v)}`);
            target[k] = v;
        }
    }
    return target;
}

// ---------------------------------------------------------------- weapons
const weapons = read("weapons.json");
const tuning = Object.fromEntries(DT.PRO_Tuning.map((t) => [t.Name, t]));

for (const w of DT.PRO_Weapons) {
    if (!w.Name.startsWith("WP_")) continue;
    const t = tuning[w.m_tuningDataTableRow?.RowName];
    if (!t) continue;
    const cost = costOf(w.m_itemShopsCraftingData);
    const soft = cost.find((c) => c.SoftCurrency !== undefined);
    const hubTags = tags(w.m_weaponTags).filter((n) => n.startsWith("Weapon.Category"));
    const old = weapons[w.Name];
    const base = weapons[w.Name.replace(/_02$/, "_01")];

    const fields = {
        inGameName: txt(w.m_weaponName) || displayName(w) || old?.inGameName,
        description: description(w) || old?.description,
        rarity: strip(w.m_rarity),
        weight: w.itemWeight,
        sellValue: sellValue(w),
        buyValue: soft ? soft.SoftCurrency : null,
        faction: cost[0]?.shop ?? null,
        factionRep: factionRep(w),
        penetration: t.m_penetration,
        directDamage: round(t.m_directDamage),
        radialDamage: round(t.m_radialDamage),
        refireTime: round(t.m_refireTime),
        reloadTime: round(t.m_reloadTime),
        ammoInClip: t.m_ammoInClip,
        ammoType: t.m_ammoTypeToUse?.RowName,
        ammoPerBullet: t.m_ammoConsumptionPerShot,
        amountOfBurst: t.m_amountOfBurst,
        burstInterval: round(t.m_burstInterval),
        amountOfImmediateFires: t.m_amountOfImmediateFires,
        movementSpeedMultiplier: round(t.m_movementSpeedMultiplier),
        weakDamageMultiplier: round(t.m_weakAreaDamageMultiplier),
        weakDamageMultiplierEnemy: round(t.m_weakAreaDamageMultiplierEnemy),
        directDamagePlayerMultiplier: round(t.m_directDamagePlayerMultiplier),
        directDamageEnemyMultiplier: round(t.m_directDamageEnemyMultiplier),
        radialDamagePlayerMultiplier: round(t.m_radialDamagePlayerMultiplier),
        radialDamageEnemyMultiplier: round(t.m_radialDamageEnemyMultiplier),
        FalloffStart: t.m_directDamageFalloffStartRange,
        FalloffEnd: t.m_directDamageFalloffEndRange,
        FalloffMultiplier: round(t.m_directDamageFalloffMultiplier),
        unequipTime: round(t.m_unequipTime),
        equipTime: round(t.m_equipTime),
        animationEquipTime: round(t.m_animationEquipTime),
        immediateFireIncreasesSpread: t.m_immediateFireIncreasesSpread,
        spinupTime: round(t.m_spinupTime),
        cost,
        modSlots: (w.m_modSlots || []).map(strip),
    };

    if (old) {
        merge(old, fields, w.Name);
        if (old.unreleased && cost.length) {
            delete old.unreleased;
            note(`${w.Name}: now released`);
        }
    } else {
        // projectileSpeed is not in the hub data; take it from the regular version
        const entry = {
            ...fields,
            tags: base?.tags || hubTags,
            projectileSpeed: base?.projectileSpeed ?? 0,
        };
        if (!cost.length) entry.unreleased = true;
        // match the field order of the existing entries
        const order = Object.keys(base || Object.values(weapons)[0]);
        const sorted = {};
        for (const k of order) if (k in entry) sorted[k] = entry[k];
        for (const k of Object.keys(entry)) if (!(k in sorted)) sorted[k] = entry[k];
        weapons[w.Name] = sorted;
        note(`NEW weapon ${w.Name} (${fields.inGameName}, ${fields.rarity}${entry.unreleased ? ", unreleased" : ""})`);
    }
}

// ------------------------------------------------------- shields, helmets
function armour(file, table) {
    const data = read(file);
    for (const r of DT[table]) {
        if (r.Name === "PlayerDefault") continue;
        const rarity = strip(r.m_rarity);
        const name = displayName(r);
        const fields = {
            inGameName: name ? `${rarity} ${name}` : data[r.Name]?.inGameName,
            description: description(r) || data[r.Name]?.description,
            rarity,
            weight: r.itemWeight,
            armorAmount: r.m_armorAmount,
            durability: r.m_durabilityMax,
            sellValue: sellValue(r),
            factionRep: factionRep(r),
            repair: {
                baseCost: r.m_repairCostBase,
                costModifierBroken: r.m_repairCostModifierBroken,
                maxPrice: r.m_repairCostMaxDurability,
                durabilityBrokenPriceModifier: r.m_durabilityBrokenPriceModifier,
            },
            perks: (r.m_perks || []).map((p) => p.RowName),
            cost: costOf(r.m_itemShopsCraftingData),
        };
        if (data[r.Name]) merge(data[r.Name], fields, r.Name);
        else {
            data[r.Name] = fields;
            note(`NEW ${file.replace(".json", "")} ${r.Name} (${fields.inGameName})`);
        }
    }
    return data;
}
const shields = armour("shields.json", "PRO_PlayerShield");
const helmets = armour("helmets.json", "PRO_Helmets");

// ----------------------------------------------------- personal quarters
const quarters = read("personalQuarters.json");
const nodes = {};
for (const r of DT.TechTreeNodes_DT) {
    nodes[r.Name] = {
        name: txt(r.m_perkName),
        category: (r.m_categories || []).map(strip)[0] || "",
        type: r.m_nodePerkType,
        PQLevelRequired: r.m_playerQuarterLevelRequired,
        tier: r.m_tier,
        levels: (r.m_perkLevels || []).map((l) => ({
            upgradeAmount: round(l.m_perkAmount),
            upgradeTime: l.m_upgradeSeconds,
            costs: costMap(l.m_upgradeCosts),
        })),
    };
    const old = quarters.nodes[r.Name];
    if (!old) note(`NEW tech node ${r.Name} (${nodes[r.Name].name}, ${nodes[r.Name].category})`);
    else if (JSON.stringify(old.levels) !== JSON.stringify(nodes[r.Name].levels)) note(`tech node ${r.Name}: levels changed`);
}
for (const k of Object.keys(quarters.nodes)) if (!nodes[k]) note(`REMOVED tech node ${k}`);
// The game stores the cost of leaving a level on that level's row. The tracker
// stores the cost of reaching a level on the level itself, so shift by one.
const levels = {};
const byLevel = Object.fromEntries(DT.PlayerQuarterUpgrades_DT.map((r) => [r.m_level, r]));
for (const r of DT.PlayerQuarterUpgrades_DT) {
    const prev = byLevel[r.m_level - 1];
    levels[r.Name] = {
        level: r.m_level,
        upgradesRequired: r.m_nodeUpgradesRequired,
        costs: prev ? costMap(prev.m_costs) : {},
        upgradeTime: prev ? prev.m_upgradeTimeSeconds : 0,
    };
    if (JSON.stringify(quarters.levels[r.Name]) !== JSON.stringify(levels[r.Name])) note(`quarters ${r.Name}: ${JSON.stringify(quarters.levels[r.Name])} -> ${JSON.stringify(levels[r.Name])}`);
}
quarters.nodes = nodes;
quarters.levels = levels;

// ------------------------------------------------------------- materials
const materials = read("materials.json");
const localization = read("localization.json");
function materialFields(r, questItem) {
    return {
        inGameName: displayName(r),
        description: description(r),
        rarity: strip(r.m_rarity),
        tags: tags(r.m_itemTags).slice(0, 1),
        weight: r.itemWeight,
        stackSize: r.m_maxAmountPerStack,
        sellValue: sellValue(r),
        factionRep: factionRep(r),
        questItem,
        cost: costOf(r.m_itemShopsCraftingData),
    };
}
for (const [table, questItem] of [["Materials_DT", false], ["QuestItems_DT", true]]) {
    for (const r of DT[table] || []) {
        const fields = materialFields(r, questItem);
        if (materials[r.Name]) {
            // names, tags and descriptions in the old files are hand-checked; only prices move
            const m = materials[r.Name];
            merge(m, {sellValue: fields.sellValue, factionRep: fields.factionRep, rarity: fields.rarity, stackSize: fields.stackSize, weight: fields.weight}, r.Name);
        } else if (fields.inGameName) {
            materials[r.Name] = fields;
            note(`NEW material ${r.Name} (${fields.inGameName}, ${fields.rarity})`);
        }
        if (materials[r.Name] && !localization.Materials?.[r.Name]) {
            localization.Materials ||= {};
            localization.Materials[r.Name] = {lore: "", name: materials[r.Name].inGameName, description: materials[r.Name].description};
            note(`localization: added ${r.Name}`);
        }
    }
}

// ------------------------------------------------------------------ forge
// Optional: exports made before the forge tables were added to the snippet lack them.
let forgePerks = read("forgePerks.json");
let forgeRecipes = read("forgeRecipes.json");
let forgeSettings = read("forgeSettings.json");
const FORGE_TABLES = ["RolledPerks_DT", "AlienForgeIngotsRecipes_DT", "AlienForgeSettings_DT"];
if (FORGE_TABLES.every((t) => Array.isArray(DT[t]))) {
    const s = DT.AlienForgeSettings_DT[0];
    const rarityMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [strip(k), v]));
    const settings = {
        catalystAmount: s.m_requiredAmountCatalyst,
        maxInputItems: s.m_maxAmountOfInputItems,
        rarityAmount: rarityMap(s.m_raritiesToAmountMap),
        timer_Default: s.m_defaultTimerValue,
        timer_Ingots: s.m_ingotsTimer,
        timer_BaseItemCatalyst: rarityMap(s.m_raritiesToTimerMapBaseItemAndCatalyst),
        timer_Lottery: rarityMap(s.m_raritiesToTimerMapLotteryTicket),
        probability_Lottery: rarityMap(s.m_raritiesToProbabilityMapLotteryTicket),
        sideProducts: Object.fromEntries((s.m_possibleSideProductsAndWeights || []).map((x) => [x.m_weightedReward.m_reward.RowName, x.m_weightedReward.m_weight])),
    };
    if (JSON.stringify(settings) !== JSON.stringify(forgeSettings)) note(`forgeSettings: ${JSON.stringify(forgeSettings)} -> ${JSON.stringify(settings)}`);
    forgeSettings = settings;

    const recipes = {};
    for (const r of DT.AlienForgeIngotsRecipes_DT) {
        recipes[r.Name] = {
            rewardAmount: r.m_amountOfRewards,
            ingredients: Object.fromEntries(r.m_requiredMaterials.map((m) => [m.m_ingredient.RowName, m.m_amount])),
            rewardChance: Object.fromEntries(r.m_possibleRewardsAndWeights.map((m) => [m.m_reward.RowName, m.m_weight])),
        };
        if (!forgeRecipes[r.Name]) note(`NEW forge recipe ${r.Name}`);
        else if (JSON.stringify(forgeRecipes[r.Name]) !== JSON.stringify(recipes[r.Name])) note(`forge recipe ${r.Name} changed`);
    }
    forgeRecipes = recipes;

    // How many of a material a perk roll uses depends on the material's rarity.
    const materialRarity = Object.fromEntries(DT.Materials_DT.map((m) => [m.Name, strip(m.m_rarity)]));
    for (const p of DT.RolledPerks_DT) {
        const hosts = (p.m_materialsHostingThisPerk || []).map((m) => m.RowName);
        if (!hosts.length) continue; // not forgeable (e.g. night vision comes from the helmet upgrade)
        const ov = p.m_attributeModiferRolledValueOverride;
        const entry = {
            description: txt(p.m_displayName),
            elite: p.m_isElitePerk,
            equipment: tags(p.m_itemTags),
            items: Object.fromEntries(hosts.map((m) => [m, settings.rarityAmount[materialRarity[m]] ?? 1])),
            attributes: (p.m_attributeModifiers || []).map((a) => ({
                attribute: a.m_attribute, type: a.m_modifierType, value: a.m_modifierValue, minValue: a.m_minAttributeValue,
                duration: a.m_duration, lerpTime: a.m_lerpTime, lerpStartValue: a.m_lerpStartModifierValue,
                lerpEndValue: a.m_lerpEndModifierValue, runtimeValue: a.m_runtimeAttributeValue,
            })),
        };
        if (ov) entry.attributeOverrides = {minValue: ov.m_minValue, stepGranularity: ov.m_stepGranularity, numSteps: ov.m_numSteps, calculatedMaxValue: ov.m_calculatedMaxValue};
        if (forgePerks[p.Name]) merge(forgePerks[p.Name], entry, p.Name);
        else {
            forgePerks[p.Name] = entry;
            note(`NEW forge perk ${p.Name} (${entry.description}; ${hosts.join(", ")})`);
        }
    }
} else {
    note("forge: skipped, export has no forge tables (re-export with the current HUB-EXPORT.md snippet)");
}

// ----------------------------------------------------------- consumables
// The game renamed the grenades; the stash reports the ShockGrenade keys.
const RENAMES = {
    Consumable_Grenade_01: "ShockGrenade_01",
    Consumable_Grenade_02: "ShockGrenade_02",
    Consumable_Grenade_03: "ShockGrenade_03",
    Consumable_Grenade_04: "ShockGrenade_04",
    Consumable_Grenade_05: "ShockGrenade_05",
};
const consumablesOld = read("consumables.json");
const consumables = {};
for (const [k, v] of Object.entries(consumablesOld)) {
    const nk = RENAMES[k] || k;
    if (nk !== k) note(`RENAMED consumable ${k} -> ${nk}`);
    consumables[nk] = v;
}
for (const r of DT.PRO_Abilities) {
    if (!/^(Consumable_|ShockGrenade_|OTecStim_)/.test(r.Name)) continue; // deployable abilities are not items
    const fields = {
        inGameName: displayName(r),
        description: description(r),
        rarity: strip(r.m_rarity),
        tags: tags(r.m_itemTags).slice(0, 1),
        weight: r.itemWeight,
        stackSize: r.m_maxAmountPerStack,
        sellValue: sellValue(r),
        factionRep: factionRep(r),
        cost: costOf(r.m_itemShopsCraftingData),
    };
    if (consumables[r.Name]) merge(consumables[r.Name], fields, r.Name);
    else {
        consumables[r.Name] = {
            inGameName: fields.inGameName, description: fields.description, rarity: fields.rarity, tags: fields.tags,
            weight: fields.weight, stackSize: fields.stackSize, sellValue: fields.sellValue, factionRep: fields.factionRep,
            action: null, tuning: null, cost: fields.cost,
        };
        note(`NEW consumable ${r.Name} (${fields.inGameName})`);
    }
}
const printing = {};
for (const [k, v] of Object.entries(read("printing.json"))) printing[RENAMES[k] || k] = v;

// ------------------------------------------------------------------ jobs
const jobs = read("jobs.json");
const contracts = Object.fromEntries(DT.Contract_DT.map((c) => [c.Name, c]));
const itemNames = {};
for (const f of ["weapons", "materials", "consumables", "shields", "helmets", "backpacks", "attachments"]) {
    const src = {weapons, materials, consumables, shields, helmets}[f] || read(f + ".json");
    for (const [k, v] of Object.entries(src)) itemNames[k] = v.inGameName;
}
function objective(o) {
    const type = strip(o.m_objectiveType);
    const out = {type, maxProgress: o.m_objectiveMaxProgress};
    if (type === "OwnNumOfItem") out.itemToOwn = o.m_itemToOwnRowHandle.RowName;
    if (type === "Kills") out.killConditions = o.m_actionKillConditions;
    if (type === "DeadDrop") {
        out.deadDropLocation = o.m_deadDropLocation.RowName;
        out.deadDropItem = o.m_deadDropItemRowHandle.RowName;
    }
    return out;
}
// Some job texts are missing from the hub's string tables; localization.json has them.
const contractText = (c, field) => {
    const own = localization.Contracts?.[c.Name] || localization.Contracts?.["Contract_" + c.Name] || {};
    const hub = txt(field === "name" ? c.m_name : c.m_contractDescription);
    return hub && hub !== "None" ? hub : own[field] || "";
};
function contract(c) {
    const rep = c.m_contractCompletedFactionReputationIncrease;
    return {
        inGameName: contractText(c, "name"),
        description: contractText(c, "description"),
        faction: c.m_factionRowHandle.RowName,
        factionReputation: rep,
        difficulty: strip(c.m_contractDifficulty),
        failConditions: c.m_failConditions || [],
        image: (c.m_backgroundImage || "").split(".").pop(),
        objectives: (c.m_objectives || []).map(objective),
        rewards: [
            ...(c.m_rewards || []).map((r) => ({
                item: r.m_rewardRowHandle.DataTable === "Currencies_DT" ? r.m_rewardRowHandle.RowName : itemNames[r.m_rewardRowHandle.RowName] || r.m_rewardRowHandle.RowName,
                amount: r.m_amount,
                isEndOfChainReward: r.m_isEndOfMissionChainReward,
                isUnlockReward: r.m_isShopOrCraftingUnlock,
            })),
            {item: "Faction Reputation", amount: rep},
        ],
        unlockLevel: c.m_unlockData?.m_level ?? 0,
        unlockContracts: (c.m_unlockData?.m_contracts || []).map((u) => txt(contracts[u.RowName]?.m_name) || u.RowName),
    };
}
for (const [k, c] of Object.entries(contracts)) {
    if (c.m_isMainContract || !c.m_isEnabled || jobs[k]) continue;
    // the current rotation is the NEW- series plus Badum; the rest are original-game leftovers
    if (!k.startsWith("NEW-") && c.m_factionRowHandle.RowName !== "Badum") continue;
    const name = contractText(c, "name");
    if (!name || !(c.m_objectives || []).length) continue; // unnamed rows are not in rotation
    jobs[k] = contract(c);
    note(`NEW job ${k} (${name}, ${c.m_factionRowHandle.RowName})`);
}
for (const k of Object.keys(jobs)) {
    if (contracts[k] && !contracts[k].m_isEnabled) {
        delete jobs[k];
        note(`REMOVED job ${k} (disabled in game)`);
    }
}

// ---------------------------------------------------- compare-only files
const missions = read("missions.json");
for (const c of Object.values(contracts)) {
    if (c.m_isMainContract && c.m_isEnabled && !missions[c.Name]) note(`NOT ADDED: new main mission ${c.Name} (${txt(c.m_name)}) - add by hand`);
}
const attachments = read("attachments.json");
for (const r of DT.PRO_Mods || []) if (!attachments[r.Name]) note(`NOT ADDED: new attachment ${r.Name} (${displayName(r)}) - add by hand`);

// ----------------------------------------------------------------- items
const oldItems = read("items.json");
const items = buildItems({
    weapons, materials, consumables, shields, helmets,
    backpacks: read("backpacks.json"), attachments, printing, missions, jobs,
    personalQuarters: quarters, forgePerks, forgeRecipes,
}, Object.keys(oldItems).map((k) => RENAMES[k] || k));

// ----------------------------------------------------------------- write
write("weapons.json", weapons);
write("shields.json", shields);
write("helmets.json", helmets);
write("personalQuarters.json", quarters);
write("materials.json", materials);
write("consumables.json", consumables);
write("printing.json", printing);
write("jobs.json", jobs);
write("localization.json", localization);
write("forgePerks.json", forgePerks);
write("forgeRecipes.json", forgeRecipes);
write("forgeSettings.json", forgeSettings);
write("items.json", items);

console.log(changes.join("\n"));
console.log(`\n${changes.length} changes${DRY ? " (dry run, nothing written)" : ". Now run: node sync.js"}`);
