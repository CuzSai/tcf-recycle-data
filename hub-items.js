// Rebuilds items.json from the per-type files plus a "uses" index.
const SOURCES = [
    ["weapons", "weapon"],
    ["materials", null], // material or questItem, from the questItem flag
    ["consumables", "consumable"],
    ["shields", "shield"],
    ["helmets", "helmet"],
    ["backpacks", "backpack"],
    ["attachments", "attachment"],
];

const pretty = (id) => {
    const s = id.replaceAll("_", " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
};

export function buildItems(files, order) {
    const items = {};
    for (const [name, type] of SOURCES) {
        for (const [key, v] of Object.entries(files[name])) {
            items[key] = {
                inGameName: v.inGameName,
                description: v.description,
                type: type || (v.questItem ? "questItem" : "material"),
                rarity: v.rarity,
                weight: v.weight,
                cost: v.cost,
                sellValue: v.sellValue,
                factionRep: v.factionRep,
                tags: v.tags || [],
                stackSize: v.stackSize || 1,
                uses: {printing: {}, missions: {}, jobs: {}, quarters: {}, forge: {}},
            };
        }
    }
    const use = (item, kind, key, inGameName, amount) => {
        if (!items[item]) return;
        items[item].uses[kind][key] = {inGameName, amount};
    };
    for (const [out, costs] of Object.entries(files.printing)) {
        for (const [item, amount] of Object.entries(costs)) {
            if (item !== "SoftCurrency") use(item, "printing", out, items[out]?.inGameName, amount);
        }
    }
    for (const [kind, src] of [["missions", files.missions], ["jobs", files.jobs]]) {
        for (const [key, m] of Object.entries(src)) {
            for (const o of m.objectives || []) {
                if (o.type === "OwnNumOfItem" && o.itemToOwn) use(o.itemToOwn, kind, key, m.inGameName, o.maxProgress);
            }
        }
    }
    const pq = files.personalQuarters;
    for (const [key, lvl] of Object.entries(pq.levels)) {
        for (const [item, amount] of Object.entries(lvl.costs)) {
            if (item !== "SoftCurrency") use(item, "quarters", key, "Player Quarters Level " + lvl.level, amount);
        }
    }
    for (const [node, n] of Object.entries(pq.nodes)) {
        n.levels.forEach((l, i) => {
            for (const [item, amount] of Object.entries(l.costs)) {
                if (item !== "SoftCurrency") use(item, "quarters", `${node}.${i}`, `${pretty(node)}.${i}`, amount);
            }
        });
    }
    for (const [perk, p] of Object.entries(files.forgePerks)) {
        for (const [item, amount] of Object.entries(p.items || {})) use(item, "forge", perk, p.description, amount);
    }
    for (const [recipe, r] of Object.entries(files.forgeRecipes || {})) {
        for (const [item, amount] of Object.entries(r.ingredients || {})) use(item, "forge", recipe, recipe, amount);
    }
    // keep the previous file's key order, new keys at the end
    if (order) {
        const sorted = {};
        for (const k of order) if (items[k]) sorted[k] = items[k];
        for (const k of Object.keys(items)) if (!sorted[k]) sorted[k] = items[k];
        return sorted;
    }
    return items;
}
