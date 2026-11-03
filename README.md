# Epic Swapper

Discord bot that moves an Epic Games display name from one account you sign in to onto another, and shows the public profile for a display name or account id.

Requires Node.js 18 or newer.

## Setup

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its token.
2. Put the token in `discord.json`:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "guildId": "",
  "webhookUrl": ""
}
```

`guildId` is optional. A server id registers `/start`, `/help`, and `/epic` on that server right away. Leave it empty and the commands are registered globally, which can take up to an hour to show up.

`webhookUrl` is optional. Paste a Discord webhook URL to log each swap: the Discord user, both account ids, the names before and after, and whether the swap finished. Leave it empty to skip logging. You can use `DISCORD_WEBHOOK_URL` instead of the file.

You can use `DISCORD_TOKEN` and `DISCORD_GUILD_ID` instead of the file. The file wins when a value is set there.

3. Invite the bot. On startup it prints an invite link with the `bot` and `applications.commands` scopes. It does not need extra permissions.

## Run

On Windows, double-click `bot.bat`. It installs dependencies the first time, then starts the bot.

Or from this folder:

```bash
npm install
npm start
```

Leave the process running. Closing the terminal stops the bot.

## Commands

### `/start`

Swaps a display name between two Epic accounts. The reply is only visible to you.

1. Sign in to the account that currently has the name. Discord shows a code and an Epic link. Approve the code on Epic's site. Do not send a password in Discord.
2. Sign in to the account that should receive that name.
3. Check both names, then press **Swap names**. Nothing changes before that.
4. The first account is changed to a random 16-character name, then the freed name is put on the second account.
5. The bot replies with both results and how long the change took.

Cancel is available during sign-in and on the confirmation. The confirmation expires after 10 minutes. One swap can run per Discord user at a time. Sign-ins from `/start` are not saved.

Both accounts need to be eligible to change their display name. Epic allows a change about once every two weeks. If the first account releases the name and the second account cannot take it, the bot says so. Set the name on the second account from Epic's website while it is still free.

### `/epic name:<display name or account id>`

Shows the public profile for that display name or Epic account id. A dashed or plain 32-character account id both work. The bot uses the Epic account saved in `data/session.json`.

The reply includes the account id and the profile start date. When Epic includes them, it also shows linked accounts (PlayStation, Xbox, Nintendo, Steam, and others) with the date each one was linked, plus country, language, name-change history, and public links.

If `data/session.json` is missing or Epic rejects it, `/epic` cannot run. Create or replace it on the machine running the bot:

```bash
npm run login
npm run login -- --force
```

`npm run login` prints an Epic device code in the terminal and writes `data/session.json`. If a sign-in is already saved, it prints that display name and leaves the file alone. People using the bot in Discord do not get a copy of the file.

### `/help`

Shows the same flow in Discord.

## Files

| Path | Purpose |
| --- | --- |
| `bot.js` | Discord commands and the swap flow |
| `login.js` | Saves the Epic account used by `/epic` |
| `src/epic.js` | Epic sign-in, profiles, and display name changes |
| `discord.json` | Bot token and optional server id |
| `data/session.json` | Saved Epic sign-in used by `/epic` |
| `gui/` | Desktop window and the Windows exe. It is separate from this bot. |

Keep `discord.json` and `data/session.json` private. They hold the bot token and an Epic device sign-in. Both are listed in `.gitignore`.
