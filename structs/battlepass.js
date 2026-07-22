const fs = require("fs");
const path = require("path");
const log = require("./log.js");

const XP_PER_LEVEL = 80000;
const MAX_LEVEL = 1000;
const MAX_BATTLEPASS_TIER = 100;

function calculateLevelFromXP(xp) {
    if (!xp || xp < 0) return 1;
    const level = Math.floor(xp / XP_PER_LEVEL) + 1;
    return Math.min(level, MAX_LEVEL);
}

function getXPForNextLevel(currentXP) {
    const currentLevel = calculateLevelFromXP(currentXP);
    const xpForNextLevel = currentLevel * XP_PER_LEVEL;
    return xpForNextLevel - currentXP;
}

function getXpToNextLevel(currentLevel) {
    return XP_PER_LEVEL;
}

function getBattlePassData(season) {
    try {
        const filePath = path.join(__dirname, `../responses/Athena/BattlePass/Season${season}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        }
        return null;
    } catch (err) {
        log.error(`Error loading Battle Pass data for season ${season}: ${err.message}`);
        return null;
    }
}

function grantTierRewards(tier, battlePassData, hasBattlePass, athena, profile, applyChanges) {
    if (!battlePassData || tier < 0 || tier >= battlePassData.freeRewards.length) {
        return { items: [], notifications: [] };
    }

    const items = [];
    const notifications = [];

    const freeTier = battlePassData.freeRewards[tier] || {};
    for (const itemTemplate in freeTier) {
        const quantity = freeTier[itemTemplate];
        if (quantity > 0) {
            const result = grantReward(itemTemplate, quantity, athena, profile, applyChanges, tier, false);
            if (result.item) items.push(result.item);
            if (result.notification) notifications.push(result.notification);
        }
    }

    if (hasBattlePass) {
        const paidTier = battlePassData.paidRewards[tier] || {};
        for (const itemTemplate in paidTier) {
            const quantity = paidTier[itemTemplate];
            if (quantity > 0) {
                const result = grantReward(itemTemplate, quantity, athena, profile, applyChanges, tier, true);
                if (result.item) items.push(result.item);
                if (result.notification) notifications.push(result.notification);
            }
        }
    }

    return { items, notifications };
}

function grantReward(templateId, quantity, athena, profile, applyChanges, tier, isPaid) {
    const itemId = `${templateId.split(":")[0]}_${tier}_${isPaid ? "Paid" : "Free"}`;

    if (templateId.toLowerCase().startsWith("token:athenaseasonxpboost")) {
        athena.stats.attributes.season_match_boost = (athena.stats.attributes.season_match_boost || 0) + quantity;
        applyChanges.push({
            changeType: "statModified",
            name: "season_match_boost",
            value: athena.stats.attributes.season_match_boost
        });
        return { item: null, notification: null };
    }

    if (templateId.toLowerCase().startsWith("token:athenaseasonfriendxpboost")) {
        athena.stats.attributes.season_friend_match_boost = (athena.stats.attributes.season_friend_match_boost || 0) + quantity;
        applyChanges.push({
            changeType: "statModified",
            name: "season_friend_match_boost",
            value: athena.stats.attributes.season_friend_match_boost
        });
        return { item: null, notification: null };
    }

    if (templateId.toLowerCase().startsWith("currency:mtxgiveaway")) {
        if (!profile.items.Currency) {
            profile.items.Currency = {};
        }
        if (!profile.items.Currency.MtxPurchased) {
            profile.items.Currency.MtxPurchased = {
                templateId: "Currency:MtxPurchased",
                attributes: { platform: "Shared" },
                quantity: 0
            };
        }
        profile.items.Currency.MtxPurchased.quantity += quantity;

        applyChanges.push({
            changeType: "itemQuantityChanged",
            itemId: "Currency.MtxPurchased",
            quantity: profile.items.Currency.MtxPurchased.quantity
        });

        return {
            item: null,
            notification: {
                type: "CurrencyReward",
                primary: true,
                lootResult: {
                    items: [{
                        itemType: "Currency:MtxPurchased",
                        itemGuid: "Currency.MtxPurchased",
                        quantity: quantity
                    }]
                }
            }
        };
    }

    const itemGuid = `${itemId}_${Date.now()}`;
    const item = {
        templateId: templateId,
        attributes: {
            max_level_bonus: 0,
            level: 1,
            item_seen: false,
            xp: 0,
            variants: [],
            favorite: false
        },
        quantity: quantity
    };

    athena.items[itemGuid] = item;

    applyChanges.push({
        changeType: "itemAdded",
        itemId: itemGuid,
        item: item
    });

    return {
        item: { itemId: itemGuid, item: item },
        notification: {
            type: "BattlePassReward",
            primary: true,
            lootResult: {
                items: [{
                    itemType: templateId,
                    itemGuid: itemGuid,
                    quantity: quantity
                }]
            }
        }
    };
}

async function awardXP(accountId, xpAmount, profiles) {
    try {
        if (!profiles || !profiles.profiles || !profiles.profiles.athena) {
            log.error(`Invalid profiles for accountId ${accountId}`);
            return { success: false };
        }

        const athena = profiles.profiles.athena;
        const commonCore = profiles.profiles.common_core;

        if (!athena.stats.attributes.season) {
            athena.stats.attributes.season = {
                num_wins: 0,
                num_high_bracket: 0,
                num_low_bracket: 0
            };
        }

        const currentXP = athena.stats.attributes.book_xp || 0;
        const currentLevel = athena.stats.attributes.book_level || 1;
        const newXP = currentXP + xpAmount;
        const newLevel = calculateLevelFromXP(newXP);

        athena.stats.attributes.book_xp = newXP;
        athena.stats.attributes.xp = newXP;
        athena.stats.attributes.season.book_xp = newXP;

        const applyChanges = [];
        const notifications = [];

        if (newLevel !== currentLevel) {
            athena.stats.attributes.book_level = newLevel;
            athena.stats.attributes.level = newLevel;
            athena.stats.attributes.season.book_level = newLevel;

            log.backend(`Player ${accountId} leveled up from ${currentLevel} to ${newLevel} (XP: ${newXP})`);

            const hasBattlePass = athena.stats.attributes.book_purchased || false;
            const season = 12;
            const battlePassData = getBattlePassData(season);

            if (battlePassData && hasBattlePass) {
                for (let tier = currentLevel; tier < Math.min(newLevel, MAX_BATTLEPASS_TIER); tier++) {
                    const rewards = grantTierRewards(tier, battlePassData, hasBattlePass, athena, commonCore, applyChanges);
                    notifications.push(...rewards.notifications);
                }
            }
        }

        applyChanges.push(
            {
                changeType: "statModified",
                name: "book_xp",
                value: newXP
            },
            {
                changeType: "statModified",
                name: "xp",
                value: newXP
            },
            {
                changeType: "statModified",
                name: "book_level",
                value: newLevel
            },
            {
                changeType: "statModified",
                name: "level",
                value: newLevel
            }
        );

        athena.rvn += 1;
        athena.commandRevision += 1;
        athena.updated = new Date().toISOString();

        if (applyChanges.some(c => c.itemId && c.itemId.includes("Currency"))) {
            commonCore.rvn += 1;
            commonCore.commandRevision += 1;
            commonCore.updated = new Date().toISOString();
        }

        await profiles.updateOne({
            $set: {
                "profiles.athena": athena,
                "profiles.common_core": commonCore
            }
        });

        return {
            success: true,
            oldXP: currentXP,
            newXP: newXP,
            oldLevel: currentLevel,
            newLevel: newLevel,
            xpGained: xpAmount,
            leveledUp: newLevel > currentLevel,
            applyChanges: applyChanges,
            notifications: notifications
        };

    } catch (err) {
        log.error(`Error awarding XP: ${err.message}`);
        return { success: false, error: err.message };
    }
}

module.exports = {
    calculateLevelFromXP,
    getXPForNextLevel,
    getXpToNextLevel,
    getBattlePassData,
    grantTierRewards,
    awardXP,
    XP_PER_LEVEL,
    MAX_LEVEL,
    MAX_BATTLEPASS_TIER
};
