const log = require("../structs/log.js");
const https = require("https");

class CheckForUpdate {
    static async checkForUpdate(currentVersion) {
        try {
            const response = await new Promise((resolve, reject) => {
                https.get("https://raw.githubusercontent.com/RickyonGit98/Amethyst/main/package.json", (res) => {
                    let data = "";
                    res.on("data", chunk => data += chunk);
                    res.on("end", () => resolve({ ok: res.statusCode === 200, json: () => JSON.parse(data) }));
                }).on("error", reject);
            });
            if (!response.ok) {
                log.error(`Failed to fetch package.json. Status: ${response.status}`);
                return false;
            }
            if (!response.ok) {
                log.error(`Failed to fetch package.json. Status: ${response.status}`);
                return false;
            }

            const packageJson = response.json();
            const latestVersion = packageJson.version;

            if (isNewerVersion(latestVersion, currentVersion)) {
                log.checkforupdate(`A new version of the Backend has been released! ${currentVersion} -> ${latestVersion}, Download it from the GitHub repo.`);
                return true;
            }

            return false;
        } catch (error) {
            log.error(`Error while checking for updates: ${error.message}`);
            return false;
        }
    }
}

function isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < latestParts.length; i++) {
        if (latestParts[i] > (currentParts[i] || 0)) {
            return true;
        } else if (latestParts[i] < (currentParts[i] || 0)) {
            return false;
        }
    }

    return false;
}

module.exports = CheckForUpdate;