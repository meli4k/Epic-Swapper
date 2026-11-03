import { EpicClient } from "./src/epic.js";

const replace = process.argv.includes("--force");
const client = new EpicClient();

try {
  if (client.signedIn() && !replace) {
    const name = client.displayName() || client.accountId() || "saved account";
    console.log(`data/session.json is already signed in as ${name}.`);
    console.log("The bot uses this account for /epic.");
    console.log("Run npm run login -- --force to replace it.");
    process.exit(0);
  }

  if (replace && client.signedIn()) {
    console.log("Removing the saved Epic sign-in...");
    await client.logout();
  }

  console.log("Sign in to the Epic account this bot should use for /epic.");
  const name = await client.startDeviceLogin(({ userCode, url }) => {
    console.log("");
    console.log(`Code: ${userCode}`);
    console.log(url);
    console.log("");
    console.log("Approve that code on Epic's site. Do not paste a password here.");
  });

  if (!client.session?.secret) {
    console.error("Epic signed in, but did not save a lasting device sign-in.");
    console.error("/epic will stop working when this token expires. Run npm run login again.");
    process.exit(1);
  }

  console.log(`Saved data/session.json for ${name || client.accountId()}.`);
  console.log("Leave that file on the machine that runs the bot. Do not send it to anyone.");
} catch (error) {
  console.error(error.message || "Sign-in failed.");
  process.exit(1);
}
