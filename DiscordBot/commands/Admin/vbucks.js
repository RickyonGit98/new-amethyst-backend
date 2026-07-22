const uuid = require("uuid");
const Users = require('../../../model/user.js');
const Profiles = require('../../../model/profiles.js');
const log = require("../../../structs/log.js");
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

module.exports = {
    commandInfo: {
        name: "vbucks",
        description: "Add V-Bucks to a user's account",
        options: [
            {
                name: "user",
                description: "The user to add V-Bucks to",
                required: true,
                type: 6
            },
            {
                name: "amount",
                description: "Amount of V-Bucks to add",
                required: true,
                type: 4
            }
        ]
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!config.moderators.includes(interaction.user.id)) {
            return interaction.editReply({ content: "You do not have moderator permissions.", ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (amount <= 0) {
            return interaction.editReply({ content: "Amount must be greater than 0.", ephemeral: true });
        }

        const user = await Users.findOne({ discordId: targetUser.id });

        if (!user) {
            return interaction.editReply({ content: "This user doesn't have an account", ephemeral: true });
        }

        try {
            const filter = { accountId: user.accountId };
            const updateCommonCore = { $inc: { 'profiles.common_core.items.Currency:MtxPurchased.quantity': amount } };
            const updateProfile0 = { $inc: { 'profiles.profile0.items.Currency:MtxPurchased.quantity': amount } };

            const updatedProfile = await Profiles.findOneAndUpdate(filter, updateCommonCore, { new: true });

            if (!updatedProfile) {
                return interaction.editReply({ content: "Profile not found for this user.", ephemeral: true });
            }

            await Profiles.updateOne(filter, updateProfile0);

            const common_core = updatedProfile.profiles.common_core;
            const newQuantity = common_core.items['Currency:MtxPurchased'].quantity;

            const purchaseId = uuid.v4();
            common_core.items[purchaseId] = {
                "templateId": "GiftBox:GB_MakeGood",
                "attributes": {
                    "fromAccountId": `[${interaction.user.username}]`,
                    "lootList": [{
                        "itemType": "Currency:MtxGiveaway",
                        "itemGuid": "Currency:MtxGiveaway",
                        "quantity": amount
                    }],
                    "params": { "userMessage": "Discord Bot" },
                    "giftedOn": new Date().toISOString()
                },
                "quantity": 1
            };

            common_core.rvn += 1;
            common_core.commandRevision += 1;

            await Profiles.updateOne(filter, { $set: { 'profiles.common_core': common_core } });

            await interaction.editReply({ content: `Added **${amount.toLocaleString()}** V-Bucks to **${user.username}** (now has ${newQuantity.toLocaleString()})`, ephemeral: true });
        } catch (err) {
            log.error(err);
            await interaction.editReply({ content: "An unexpected error occurred.", ephemeral: true });
        }
    }
};