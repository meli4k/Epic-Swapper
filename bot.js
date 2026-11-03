import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  AttachmentBuilder,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { EpicClient } from "./src/epic.js";
import { renderLocker } from "./src/locker.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DISCORD_CONFIG = join(ROOT, "discord.json");

const quiet = { allowedMentions: { parse: [] } };
const jobs = new Map();
const lookup = new EpicClient();

function loadConfig() {
  let file = {};
  if (existsSync(DISCORD_CONFIG)) {
    try {
      file = JSON.parse(readFileSync(DISCORD_CONFIG, "utf8"));
    } catch {
      throw new Error("discord.json is not valid JSON.");
    }
  }
  return {
    token: String(file.token || process.env.DISCORD_TOKEN || "").trim(),
    guildId: String(file.guildId || process.env.DISCORD_GUILD_ID || "").trim(),
    webhookUrl: String(file.webhookUrl || process.env.DISCORD_WEBHOOK_URL || "").trim(),
  };
}

function swapWebhook() {
  const url = loadConfig().webhookUrl;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowed = host === "discord.com" || host === "discordapp.com" || host === "canary.discord.com" || host === "ptb.discord.com";
    if (parsed.protocol !== "https:" || !allowed) return "";
    if (!/^\/api\/webhooks\/\d+\/[^/]+/.test(parsed.pathname)) return "";
    return url;
  } catch {
    return "";
  }
}

function freshClient() {
  return new EpicClient(null, { persist: false, rememberDevice: false });
}

function randomName() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let name = "";
  for (let i = 0; i < 16; i += 1) name += alphabet[Math.floor(Math.random() * alphabet.length)];
  return name;
}

function formatDuration(ms) {
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function explain(message) {
  const text = String(message || "");
  if (/invalid fields were\s*\[displayName\]/i.test(text)) {
    return "Epic rejected the display name. The name failed validation, which happens when it breaks Epic's name rules or this account is not allowed to change it.";
  }
  if (/cooldown|recently|throttl|display_name_change/i.test(text)) {
    return `${text} Epic lets an account change its display name about once every two weeks.`;
  }
  return text;
}

function cancelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function confirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("swap:go").setLabel("Swap names").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function modeRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("start:swap").setLabel("Swap names").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("start:double").setLabel("Double swap (use at your own risk)").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("start:caps").setLabel("Change caps").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function doubleReviewRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("double:next").setLabel("Continue").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function doubleGoRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("double:go").setLabel("I want to double swap").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function capsTypeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("caps:type").setLabel("Type capitalization").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function capsConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("caps:go").setLabel("Change caps").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("caps:type").setLabel("Edit").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function sameLetters(left, right) {
  const fold = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("en");
  return fold(left) === fold(right);
}

function armTimer(job, userId, interaction) {
  clearTimeout(job.timer);
  job.timer = setTimeout(() => {
    if (jobs.get(userId) !== job || !["confirm", "caps", "review", "risk"].includes(job.phase)) return;
    jobs.delete(userId);
    show(interaction, { content: "That confirmation expired. Run /start again.", embeds: [], components: [] });
  }, 10 * 60 * 1000);
}

function capsModal(current) {
  const input = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Name with the capitalization you want")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(16);
  if (current) input.setValue(current.slice(0, 16));
  return new ModalBuilder()
    .setCustomId("caps:name")
    .setTitle("Change capitalization")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function show(interaction, payload) {
  const body = { ...quiet, ...payload };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(body);
    else await interaction.reply(body);
  } catch {
    await interaction.followUp(body).catch(() => {});
  }
}

async function pickFreeName(client) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = randomName();
    try {
      const check = await client.checkName(candidate);
      if (check.status === "available" || check.status === "error") return candidate;
    } catch {
      return candidate;
    }
  }
  return randomName();
}

function resultEmbed({ title, color, lines, ms, gapLabel, extra }) {
  const embed = new EmbedBuilder().setTitle(title).setColor(color).setDescription(lines.join("\n"));
  if (ms != null) embed.addFields({ name: gapLabel || "Between changes", value: formatDuration(ms) });
  for (const field of extra || []) embed.addFields(field);
  return embed;
}

function accountTag(client) {
  const id = client?.accountId?.() || "";
  return id ? `\`${id}\`` : "unknown id";
}

async function logSwap(interaction, report) {
  const url = swapWebhook();
  if (!url) return;
  const embed = new EmbedBuilder()
    .setTitle(report.title)
    .setColor(report.color)
    .setTimestamp(new Date())
    .setDescription(clip((report.lines || []).filter(Boolean).join("\n"), 4000))
    .addFields({
      name: "Discord user",
      value: `${interaction.user.username}\n\`${interaction.user.id}\``,
    });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Swap log",
        allowed_mentions: { parse: [] },
        embeds: [embed.toJSON()],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`Swap log was refused (${response.status}). Create a new webhook and put it in discord.json.`);
    }
  } catch (error) {
    console.error(error.message || "Could not send the swap log.");
  }
}

async function runSwap(interaction, job) {
  const userId = interaction.user.id;
  let report = null;
  try {
    await show(interaction, { content: "Swapping...", embeds: [], components: [] });
    await job.source.launcherAccessToken();
    await job.target.launcherAccessToken();
    const fromName = job.source.displayName();
    const toName = job.target.displayName();
    if (!fromName) throw new Error("Epic did not return a display name for the first account.");
    const temp = await pickFreeName(job.source);
    const { released, claimed, gapMs } = await job.source.swapOnto(job.target, temp, fromName);
    const gap = gapMs != null ? `Between changes: ${formatDuration(gapMs)}` : "";
    if (!released.ok) {
      const lines = [
        "Neither account was changed.",
        `**${fromName}** is still on the first account.`,
        `**${toName}** is still on the second account.`,
        "",
        explain(released.message),
      ];
      report = {
        title: "Swap did not happen",
        color: 0xff5a6e,
        lines: [
          ...lines,
          "",
          `First account ${accountTag(job.source)}: **${fromName}**`,
          `Second account ${accountTag(job.target)}: **${toName || "Unknown"}**`,
        ],
      };
      await show(interaction, {
        content: "",
        components: [],
        embeds: [resultEmbed({ title: "Swap did not happen", color: 0xff5a6e, lines })],
      });
      return;
    }
    if (!claimed?.ok) {
      const lines = [
        `The first account is now **${released.displayName || temp}**.`,
        `The second account is still **${toName}**.`,
        `**${fromName}** was released and the second account could not take it.`,
        "",
        explain(claimed?.message),
        "If the name is still free, set it on the second account from Epic's website before someone else takes it.",
      ];
      report = {
        title: "Swap did not finish",
        color: 0xffd65a,
        lines: [
          ...lines,
          "",
          `First account ${accountTag(job.source)}: ${fromName} → **${released.displayName || temp}**`,
          `Second account ${accountTag(job.target)}: **${toName || "Unknown"}**`,
          gap,
        ],
      };
      await show(interaction, {
        content: "",
        components: [],
        embeds: [resultEmbed({ title: "Swap did not finish", color: 0xffd65a, ms: gapMs, lines })],
      });
      return;
    }
    const lines = [
      `**${fromName}** is now on the second account.`,
      "",
      `First account: ${fromName} → **${released.displayName || temp}**`,
      `Second account: ${toName} → **${claimed.displayName || fromName}**`,
    ];
    report = {
      title: "Swap finished",
      color: 0x39ffa0,
      lines: [
        `**${fromName}** moved to the second account.`,
        `First account ${accountTag(job.source)}: ${fromName} → **${released.displayName || temp}**`,
        `Second account ${accountTag(job.target)}: ${toName || "Unknown"} → **${claimed.displayName || fromName}**`,
        gap,
      ],
    };
    await show(interaction, {
      content: "",
      components: [],
      embeds: [resultEmbed({ title: "Swap finished", color: 0x39ffa0, ms: gapMs, lines })],
    });
  } catch (error) {
    const message = error.message || "The swap failed.";
    report = {
      title: "Swap failed",
      color: 0xff5a6e,
      lines: [
        message,
        `First account ${accountTag(job.source)}: **${job.source.displayName() || "Unknown"}**`,
        `Second account ${accountTag(job.target)}: **${job.target?.displayName() || "Unknown"}**`,
      ],
    };
    await show(interaction, {
      content: message,
      embeds: [],
      components: [],
    });
  } finally {
    if (report) await logSwap(interaction, report);
    if (jobs.get(userId) === job) jobs.delete(userId);
  }
}

async function runDouble(interaction, job) {
  const userId = interaction.user.id;
  let report = null;
  const first = job.source;
  const second = job.target;
  const third = job.keeper;
  try {
    await show(interaction, { content: "Double swapping...", embeds: [], components: [] });
    await first.launcherAccessToken();
    await second.launcherAccessToken();
    await third.launcherAccessToken();
    const name1 = first.displayName();
    const name2 = second.displayName();
    const name3 = third.displayName();
    if (!name1 || !name2) throw new Error("Epic did not return a display name for every account.");
    const temp = await pickFreeName(first);
    const { released, moved, kept, gapMs, secondGapMs } = await first.swapChain(second, third, temp, name1, name2);
    const gap = gapMs != null ? `Between the first and second change: ${formatDuration(gapMs)}` : "";
    const gap2 = secondGapMs != null ? `Between the second and third change: ${formatDuration(secondGapMs)}` : "";
    const tags = [
      `First account ${accountTag(first)}`,
      `Second account ${accountTag(second)}`,
      `Third account ${accountTag(third)}`,
    ];
    const timing = { ms: gapMs, gapLabel: "First to second", extra: secondGapMs != null ? [{ name: "Second to third", value: formatDuration(secondGapMs) }] : [] };
    if (!released.ok) {
      const lines = [
        "None of the three accounts were changed.",
        `**${name1}** is still on the first account.`,
        `**${name2}** is still on the second account.`,
        `**${name3 || "The third name"}** is still on the third account.`,
        "",
        explain(released.message),
      ];
      report = {
        title: "Double swap did not happen",
        color: 0xff5a6e,
        lines: [
          ...lines,
          "",
          `${tags[0]}: **${name1}**`,
          `${tags[1]}: **${name2 || "Unknown"}**`,
          `${tags[2]}: **${name3 || "Unknown"}**`,
        ],
      };
      await show(interaction, {
        content: "",
        components: [],
        embeds: [resultEmbed({ title: "Double swap did not happen", color: 0xff5a6e, lines })],
      });
      return;
    }
    if (!moved?.ok) {
      const lines = [
        `The first account is now **${released.displayName || temp}**.`,
        `The second account is still **${name2}**.`,
        `The third account is still **${name3 || "Unknown"}**.`,
        `**${name1}** was released and the second account could not take it.`,
        "",
        explain(moved?.message),
        "If the name is still free, set it on the second account from Epic's website before someone else takes it.",
      ];
      report = {
        title: "Double swap did not finish",
        color: 0xffd65a,
        lines: [
          ...lines,
          "",
          `${tags[0]}: ${name1} → **${released.displayName || temp}**`,
          `${tags[1]}: **${name2 || "Unknown"}**`,
          `${tags[2]}: **${name3 || "Unknown"}**`,
          gap,
        ].filter(Boolean),
      };
      await show(interaction, {
        content: "",
        components: [],
        embeds: [resultEmbed({ title: "Double swap did not finish", color: 0xffd65a, lines, ...timing })],
      });
      return;
    }
    if (!kept?.ok) {
      const lines = [
        `**${name1}** is now on the second account.`,
        `The second account released **${name2}**, and the third account could not take it.`,
        `The third account is still **${name3 || "Unknown"}**.`,
        "",
        explain(kept?.message),
        "If that name is still free, set it on the third account from Epic's website before someone else takes it.",
      ];
      report = {
        title: "Double swap did not finish",
        color: 0xffd65a,
        lines: [
          ...lines,
          "",
          `${tags[0]}: ${name1} → **${released.displayName || temp}**`,
          `${tags[1]}: ${name2} → **${moved.displayName || name1}**`,
          `${tags[2]}: **${name3 || "Unknown"}**`,
          gap,
          gap2,
        ].filter(Boolean),
      };
      await show(interaction, {
        content: "",
        components: [],
        embeds: [resultEmbed({ title: "Double swap did not finish", color: 0xffd65a, lines, ...timing })],
      });
      return;
    }
    const lines = [
      `**${name1}** is now on the second account.`,
      `**${name2}** is now on the third account.`,
      "",
      `First account: ${name1} → **${released.displayName || temp}**`,
      `Second account: ${name2} → **${moved.displayName || name1}**`,
      `Third account: ${name3 || "Unknown"} → **${kept.displayName || name2}**`,
    ];
    report = {
      title: "Double swap finished",
      color: 0x39ffa0,
      lines: [
        `**${name1}** moved to the second account.`,
        `**${name2}** moved to the third account.`,
        `${tags[0]}: ${name1} → **${released.displayName || temp}**`,
        `${tags[1]}: ${name2} → **${moved.displayName || name1}**`,
        `${tags[2]}: ${name3 || "Unknown"} → **${kept.displayName || name2}**`,
        gap,
        gap2,
      ].filter(Boolean),
    };
    await show(interaction, {
      content: "",
      components: [],
      embeds: [resultEmbed({ title: "Double swap finished", color: 0x39ffa0, lines, ...timing })],
    });
  } catch (error) {
    const message = error.message || "The double swap failed.";
    report = {
      title: "Double swap failed",
      color: 0xff5a6e,
      lines: [
        message,
        `First account ${accountTag(first)}: **${first?.displayName() || "Unknown"}**`,
        `Second account ${accountTag(second)}: **${second?.displayName() || "Unknown"}**`,
        `Third account ${accountTag(third)}: **${third?.displayName() || "Unknown"}**`,
      ],
    };
    await show(interaction, {
      content: message,
      embeds: [],
      components: [],
    });
  } finally {
    if (report) await logSwap(interaction, report);
    if (jobs.get(userId) === job) jobs.delete(userId);
  }
}

async function signIn(interaction, job, client, text, phase) {
  job.phase = phase || (text.includes("receive") ? "target" : "source");
  const name = await client.startDeviceLogin(({ userCode, url }) => {
    show(interaction, {
      content: `${text}\n\n\`${userCode}\`\n${url}`,
      embeds: [],
      components: [cancelRow()],
    });
  }, () => job.cancel);
  if (job.cancel) throw new Error("Sign-in cancelled.");
  return name;
}

async function runCaps(interaction, job) {
  const userId = interaction.user.id;
  const current = job.source.displayName();
  const next = job.nextName;
  let report = null;
  try {
    await show(interaction, { content: "Changing capitalization...", embeds: [], components: [] });
    const result = await job.source.setDisplayName(next);
    if (!result.ok) {
      const lines = [
        `**${current}** was not changed.`,
        explain(result.message),
      ];
      report = {
        title: "Caps change did not happen",
        color: 0xff5a6e,
        lines: [...lines, "", `Account ${accountTag(job.source)}: **${current || "Unknown"}**`],
      };
      await show(interaction, {
        content: "",
        components: [],
        embeds: [resultEmbed({ title: "Caps change did not happen", color: 0xff5a6e, lines })],
      });
      return;
    }
    const applied = result.displayName || next;
    const lines = [
      `**${current}** is now **${applied}**.`,
      "Only the capitalization changed.",
    ];
    report = {
      title: "Caps changed",
      color: 0x39ffa0,
      lines: [`Account ${accountTag(job.source)}: ${current} → **${applied}**`],
    };
    await show(interaction, {
      content: "",
      components: [],
      embeds: [resultEmbed({ title: "Caps changed", color: 0x39ffa0, lines })],
    });
  } catch (error) {
    const message = error.message || "The capitalization change failed.";
    report = {
      title: "Caps change failed",
      color: 0xff5a6e,
      lines: [message, `Account ${accountTag(job.source)}: **${current || "Unknown"}**`],
    };
    await show(interaction, { content: message, embeds: [], components: [] });
  } finally {
    if (report) await logSwap(interaction, report);
    if (jobs.get(userId) === job) jobs.delete(userId);
  }
}

async function finishEarly(interaction, job, error) {
  clearTimeout(job.timer);
  const userId = interaction.user.id;
  if (jobs.get(userId) === job) jobs.delete(userId);
  const cancelled = error.message === "Sign-in cancelled.";
  await show(interaction, {
    content: cancelled ? "Cancelled." : (error.message || "Sign-in failed."),
    embeds: [],
    components: [],
  });
}

async function beginSwap(interaction, job) {
  const userId = interaction.user.id;
  job.mode = "swap";
  job.phase = "source";
  job.source = freshClient();
  job.target = null;
  try {
    await interaction.deferUpdate();
    const sourceName = await signIn(
      interaction,
      job,
      job.source,
      "Sign in to the Epic account that **has** the name you want to move."
    );
    if (!sourceName) throw new Error("Epic did not return a display name for the first account.");
    job.target = freshClient();
    const targetName = await signIn(
      interaction,
      job,
      job.target,
      `Signed in to **${sourceName}**.\n\nSign in to the account that should **receive** ${sourceName}.`
    );
    await job.source.launcherAccessToken();
    await job.target.launcherAccessToken();
    const fromName = job.source.displayName() || sourceName;
    const toName = job.target.displayName() || targetName;
    if (job.source.accountId() && job.source.accountId() === job.target.accountId()) {
      throw new Error("Those are the same Epic account. Sign in to two different accounts.");
    }
    job.phase = "confirm";
    await show(interaction, {
      content: "",
      components: [confirmRow()],
      embeds: [new EmbedBuilder()
        .setTitle("Confirm the swap")
        .setColor(0x5865f2)
        .setDescription([
          `**${fromName}** will be changed to a random name.`,
          `**${toName}** will then take **${fromName}**.`,
          "",
          "Nothing changes until you press Swap names.",
        ].join("\n"))
        .addFields(
          { name: "Has the name", value: fromName, inline: true },
          { name: "Receives the name", value: toName || "Unknown", inline: true }
        )],
    });
    armTimer(job, userId, interaction);
  } catch (error) {
    await finishEarly(interaction, job, error);
  }
}

async function warnDouble(interaction, job) {
  job.mode = "double";
  job.phase = "risk";
  await interaction.update({
    ...quiet,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("double:accept").setLabel("I want to double swap").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("swap:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    )],
    embeds: [new EmbedBuilder()
      .setTitle("Confirm the double swap")
      .setColor(0xff5a6e)
      .setDescription([
        "A double swap moves a name onto a second account, then places that account's name on a third account.",
        "",
        "Use this at your own risk. We are not responsible for lost names.",
        "Press **I want to double swap** only if you want to do this.",
        "Nothing changes until you confirm.",
      ].join("\n"))],
  });
  armTimer(job, interaction.user.id, interaction);
}

async function beginDouble(interaction, job) {
  const userId = interaction.user.id;
  job.mode = "double";
  job.phase = "source";
  job.source = freshClient();
  job.target = null;
  job.keeper = null;
  try {
    await interaction.deferUpdate();
    const firstName = await signIn(
      interaction,
      job,
      job.source,
      "Sign in to the Epic account that **has** the name you want to move.",
      "source"
    );
    if (!firstName) throw new Error("Epic did not return a display name for the first account.");
    job.target = freshClient();
    const secondName = await signIn(
      interaction,
      job,
      job.target,
      `Signed in to **${firstName}**.\n\nSign in to the account that should **receive** ${firstName}. This account's current name will be kept.`,
      "target"
    );
    if (!secondName) throw new Error("Epic did not return a display name for the second account.");
    job.keeper = freshClient();
    const thirdName = await signIn(
      interaction,
      job,
      job.keeper,
      `Signed in to **${secondName}**.\n\nSign in to the account that should **receive** ${secondName}.`,
      "third"
    );
    if (!thirdName) throw new Error("Epic did not return a display name for the third account.");
    await job.source.launcherAccessToken();
    await job.target.launcherAccessToken();
    await job.keeper.launcherAccessToken();
    const name1 = job.source.displayName() || firstName;
    const name2 = job.target.displayName() || secondName;
    const name3 = job.keeper.displayName() || thirdName;
    const ids = [job.source.accountId(), job.target.accountId(), job.keeper.accountId()].filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Those sign-ins include the same Epic account. Sign in to three different accounts.");
    }
    job.phase = "review";
    await show(interaction, {
      content: "",
      components: [doubleReviewRow()],
      embeds: [new EmbedBuilder()
        .setTitle("Check the order")
        .setColor(0x5865f2)
        .setDescription([
          `**Target:** ${name1} → **Destination:** ${name2}`,
          `**Second user:** ${name2} → **Destination:** ${name3}`,
          "",
          "Check that these are the accounts you signed in to, and that this order is right.",
          "Nothing changes on this step.",
        ].join("\n"))],
    });
    armTimer(job, userId, interaction);
  } catch (error) {
    await finishEarly(interaction, job, error);
  }
}

async function beginCaps(interaction, job) {
  const userId = interaction.user.id;
  job.mode = "caps";
  job.phase = "source";
  job.source = freshClient();
  try {
    await interaction.deferUpdate();
    const signedInName = await signIn(
      interaction,
      job,
      job.source,
      "Sign in to the Epic account whose **capitalization** you want to change."
    );
    if (!signedInName) throw new Error("Epic did not return a display name for that account.");
    await job.source.launcherAccessToken();
    const current = job.source.displayName() || signedInName;
    job.phase = "caps";
    job.interaction = interaction;
    await show(interaction, {
      content: "",
      components: [capsTypeRow()],
      embeds: [new EmbedBuilder()
        .setTitle("Change capitalization")
        .setColor(0x5865f2)
        .setDescription([
          `Current name: **${current}**`,
          "",
          "Type the same name with the capitalization you want.",
          "The letters stay the same. Epic accepts that change while a name-change cooldown is active.",
        ].join("\n"))],
    });
    armTimer(job, userId, interaction);
  } catch (error) {
    await finishEarly(interaction, job, error);
  }
}

async function submitCaps(interaction) {
  const userId = interaction.user.id;
  const job = jobs.get(userId);
  if (!job || job.mode !== "caps" || (job.phase !== "caps" && job.phase !== "confirm")) {
    await interaction.reply({
      ...quiet,
      flags: MessageFlags.Ephemeral,
      content: "That capitalization change has expired. Run /start again.",
    });
    return;
  }
  const typed = interaction.fields.getTextInputValue("name").trim();
  const current = job.source.displayName();
  if (!current) {
    await interaction.reply({
      ...quiet,
      flags: MessageFlags.Ephemeral,
      content: "Epic did not return a display name for that account.",
    });
    return;
  }
  if (!sameLetters(typed, current)) {
    await interaction.reply({
      ...quiet,
      flags: MessageFlags.Ephemeral,
      content: `**${typed || "That"}** is a different name. Only the capitalization can change. This account is **${current}**.`,
    });
    return;
  }
  if (typed === current) {
    await interaction.reply({
      ...quiet,
      flags: MessageFlags.Ephemeral,
      content: `**${current}** already uses that capitalization.`,
    });
    return;
  }
  job.nextName = typed;
  job.phase = "confirm";
  await interaction.reply({
    ...quiet,
    flags: MessageFlags.Ephemeral,
    components: [capsConfirmRow()],
    embeds: [new EmbedBuilder()
      .setTitle("Confirm the capitalization")
      .setColor(0x5865f2)
      .setDescription([
        `**${current}** will become **${typed}**.`,
        "",
        "Nothing changes until you press Change caps.",
      ].join("\n"))],
  });
  job.interaction = interaction;
  armTimer(job, userId, interaction);
}

async function beginLocker(interaction) {
  const userId = interaction.user.id;
  if (jobs.has(userId)) {
    await interaction.reply({
      ...quiet,
      flags: MessageFlags.Ephemeral,
      content: "You already have a request in progress. Cancel that one first.",
    });
    return;
  }
  const job = { phase: "source", mode: "locker", cancel: false, source: freshClient(), target: null, timer: null, interaction };
  jobs.set(userId, job);
  try {
    await interaction.deferReply({ ...quiet, flags: MessageFlags.Ephemeral });
    const name = await signIn(
      interaction,
      job,
      job.source,
      "Sign in to the Epic account whose Fortnite locker you want to see."
    );
    if (!name) throw new Error("Epic did not return a display name for that account.");
    await show(interaction, { content: `Reading the locker for **${name}**...`, embeds: [], components: [] });
    const profile = await job.source.queryAthena();
    const sheets = await renderLocker(profile, job.source.displayName() || name);
    if (!sheets.length) {
      await show(interaction, {
        content: `**${name}** has no Fortnite cosmetics on this account.`,
        embeds: [],
        components: [],
      });
      return;
    }
    await show(interaction, {
      content: `Locker for **${name}**.`,
      embeds: [],
      components: [],
      files: sheets.map((sheet) => new AttachmentBuilder(sheet.file, { name: sheet.name })),
    });
  } catch (error) {
    if (jobs.get(userId) !== job) return;
    await show(interaction, {
      content: error?.message === "Sign-in cancelled." ? "Cancelled." : (error?.message || "The locker could not be read."),
      embeds: [],
      components: [],
    });
  } finally {
    if (jobs.get(userId) === job) jobs.delete(userId);
  }
}

async function startSwap(interaction) {
  const userId = interaction.user.id;
  if (jobs.has(userId)) {
    await interaction.reply({
      ...quiet,
      flags: MessageFlags.Ephemeral,
      content: "You already have a request in progress. Cancel that one first.",
    });
    return;
  }
  const job = { phase: "mode", mode: "", cancel: false, source: null, target: null, timer: null, interaction };
  jobs.set(userId, job);
  await interaction.reply({
    ...quiet,
    flags: MessageFlags.Ephemeral,
    components: modeRow(),
    embeds: [new EmbedBuilder()
      .setTitle("What do you want to do?")
      .setColor(0x5865f2)
      .setDescription([
        "**Swap names** moves a display name from one account you sign in to onto another.",
        "**Double swap (use at your own risk)** places the second account's current name on a third account. You have to confirm before it starts. We are not responsible for lost names.",
        "**Change caps** signs in to one account and changes only the capitalization.",
      ].join("\n\n"))],
  });
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle("Epic name bot")
    .setColor(0x00e5ff)
    .setDescription([
      "**`/start`** asks whether to swap names, double swap, or change capitalization.",
      "**Swap names**",
      "1. Sign in to the account that currently has the name.",
      "2. Sign in to the account that should receive it.",
      "3. Check both names, then press Swap names.",
      "4. The first account is changed to a random name, then the freed name is put on the second account.",
      "5. The bot replies with both results and how long the change took.",
      "",
      "**Double swap**",
      "Use this when the account receiving the name also has a name you want to keep.",
      "On /start, press the red **Double swap (use at your own risk)** button. A confirm message appears. Press **I want to double swap** to continue, or cancel.",
      "1. Sign in to the account that has the name you want to move.",
      "2. Sign in to the account that should receive that name.",
      "3. Sign in to the account that should receive the second account's current name.",
      "4. Check the order. Target goes to the second account, then that account's name goes to the third.",
      "5. A second confirmation shows the process. It says to use this at your own risk, and that lost names are not our responsibility. Press I want to double swap only if you want to do this, or cancel.",
      "The first account changes to a random name, the second account takes that name, and the third account takes the name the second account just released. The third account's previous name is replaced.",
      "",
      "**`/locker`** signs in to one account and draws its Fortnite locker. Skins, back blings, pickaxes, gliders, emotes, and the other cosmetic types are separate pictures.",
      "",
      "**Change caps**",
      "1. Sign in to the account whose capitalization you want to change.",
      "2. Type the same name with the capitalization you want.",
      "3. Press Change caps. The letters stay the same, so Epic accepts it during a name-change cooldown.",
      "",
      "Approve each code on Epic's site. The code is only visible to you. Do not send a password in Discord.",
      "Every account in the swap needs to be eligible. Epic lets an account change its display name about once every two weeks.",
      "",
      "**`/epic`** shows the profile for a display name or an account id. Only you can see that reply.",
      "It includes the account id, the display name, the profile start date, every linked account Epic returns, and any public links.",
      "",
      "`/epic` uses the Epic account saved on the machine running this bot.",
    ].join("\n"));
}

function clip(value, max = 1024) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function discordDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

function linkedLines(linked) {
  return linked.map((entry) => {
    const parts = [`**${entry.platform}**`];
    if (entry.name) parts.push(entry.name);
    for (const item of entry.ids || []) parts.push(`\`${item.id}\``);
    if (entry.region) parts.push(entry.region);
    const linkedAt = discordDate(entry.linkedAt);
    if (linkedAt) parts.push(linkedAt);
    return parts.join(" · ");
  });
}

function linkLines(links) {
  return links.map((entry) => {
    const parts = [`**${entry.label}**`];
    if (entry.name) parts.push(entry.name);
    if (entry.url) parts.push(entry.url);
    return parts.join(" · ");
  });
}

function addBlocks(embed, title, lines) {
  if (!lines.length) return;
  let block = [];
  let size = 0;
  let page = 1;
  const flush = () => {
    if (!block.length) return;
    const name = page === 1 ? title : `${title} (${page})`;
    embed.addFields({ name, value: clip(block.join("\n")) });
    block = [];
    size = 0;
    page += 1;
  };
  for (const line of lines) {
    const next = clip(line, 200);
    if (size + next.length + 1 > 1000) flush();
    block.push(next);
    size += next.length + 1;
  }
  flush();
}

function lookupEmbed(info) {
  if (!info.found) {
    return new EmbedBuilder()
      .setTitle(info.name || "Profile")
      .setColor(0xff5a6e)
      .setDescription(info.error || "No Epic profile uses that display name.");
  }
  const embed = new EmbedBuilder()
    .setTitle(info.publicName || info.name || "Profile")
    .setColor(0x00e5ff);
  const started = discordDate(info.created);
  if (started) embed.addFields({ name: "Started", value: started, inline: true });
  if (info.accountId) embed.addFields({ name: "Account id", value: info.accountId, inline: true });
  const facts = [];
  if (info.country) facts.push(`**Country** · ${info.country}`);
  if (info.language) facts.push(`**Language** · ${info.language}`);
  const changed = discordDate(info.lastDisplayNameChange);
  if (changed) facts.push(`**Last name change** · ${changed}`);
  if (info.displayNameChanges != null) facts.push(`**Name changes** · ${info.displayNameChanges}`);
  if (facts.length) embed.addFields({ name: "Account", value: clip(facts.join("\n")) });
  addBlocks(embed, "Linked accounts", linkedLines(info.linked || []));
  if (!info.linked?.length) {
    embed.addFields({ name: "Linked accounts", value: "Epic did not list any linked accounts for this profile." });
  }
  addBlocks(embed, "Links", linkLines(info.links || []));
  return embed;
}

async function lookupName(interaction) {
  const name = interaction.options.getString("name", true).trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  lookup.load();
  if (!lookup.signedIn()) {
    await show(interaction, {
      content: "No Epic sign-in is saved in this folder, so /epic cannot run yet.",
    });
    return;
  }
  try {
    const info = await lookup.describeName(name);
    await show(interaction, { content: "", embeds: [lookupEmbed(info)] });
  } catch (error) {
    await show(interaction, { content: error.message || "Could not load that profile.", embeds: [] });
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Swap names, double swap, or change capitalization"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("How this bot works"),
  new SlashCommandBuilder()
    .setName("locker")
    .setDescription("Draw the Fortnite locker for an account you sign in to"),
  new SlashCommandBuilder()
    .setName("epic")
    .setDescription("Show the Epic profile for a display name or account id")
    .addStringOption((option) => option
      .setName("name")
      .setDescription("Display name or account id")
      .setRequired(true)
      .setMaxLength(36)),
].map((command) => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  const config = loadConfig();
  const rest = new REST({ version: "10" }).setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(ready.user.id, config.guildId)
    : Routes.applicationCommands(ready.user.id);
  await rest.put(route, { body: commands });
  console.log(`Logged in as ${ready.user.tag}`);
  console.log(config.guildId ? "Slash commands registered for that server." : "Slash commands registered. They can take up to an hour to appear.");
  console.log(`Invite: https://discord.com/api/oauth2/authorize?client_id=${ready.user.id}&scope=bot%20applications.commands&permissions=0`);
  console.log(swapWebhook()
    ? "Swap results will be posted to the webhook."
    : "No swap webhook configured. Add webhookUrl to discord.json to log swaps.");
  await reportEpicSession();
});

async function reportEpicSession() {
  lookup.load();
  if (!lookup.signedIn()) {
    console.log("No saved Epic sign-in. /epic is off until you run npm run login on this machine.");
    return;
  }
  try {
    await lookup.ensureToken();
    console.log(`Epic lookup account: ${lookup.displayName() || lookup.accountId()}`);
  } catch (error) {
    console.error(error.message || "The saved Epic sign-in could not be used.");
    console.error("Run npm run login on this machine to save a new one.");
  }
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "start") await startSwap(interaction);
      else if (interaction.commandName === "help") await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, embeds: [helpEmbed()] });
      else if (interaction.commandName === "locker") await beginLocker(interaction);
      else if (interaction.commandName === "epic") await lookupName(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "caps:name") await submitCaps(interaction);
      return;
    }
    if (!interaction.isButton()) return;
    const job = jobs.get(interaction.user.id);
    if (!job) {
      await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That request has expired. Run /start again." });
      return;
    }
    if (interaction.customId === "start:swap" || interaction.customId === "start:double" || interaction.customId === "start:caps") {
      if (job.phase !== "mode") {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That request has expired. Run /start again." });
        return;
      }
      if (interaction.customId === "start:swap") await beginSwap(interaction, job);
      else if (interaction.customId === "start:double") await warnDouble(interaction, job);
      else await beginCaps(interaction, job);
      return;
    }
    if (interaction.customId === "double:accept") {
      if (job.phase !== "risk") {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That double swap has expired. Run /start again." });
        return;
      }
      await beginDouble(interaction, job);
      return;
    }
    if (interaction.customId === "caps:type") {
      if (job.mode !== "caps" || (job.phase !== "caps" && job.phase !== "confirm") || job.phase === "swapping") {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That capitalization change has expired. Run /start again." });
        return;
      }
      await interaction.showModal(capsModal(job.source?.displayName() || ""));
      return;
    }
    if (interaction.customId === "swap:cancel") {
      job.cancel = true;
      clearTimeout(job.timer);
      if (job.phase === "swapping") {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That request is already running." });
        return;
      }
      if (job.phase === "source" || job.phase === "target" || job.phase === "third") {
        await interaction.deferUpdate();
        return;
      }
      jobs.delete(interaction.user.id);
      await interaction.update({ ...quiet, content: "Cancelled.", embeds: [], components: [] });
      return;
    }
    if (interaction.customId === "swap:go") {
      if (job.mode !== "swap" || job.phase !== "confirm") {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That swap has expired. Run /start again." });
        return;
      }
      job.phase = "swapping";
      clearTimeout(job.timer);
      await interaction.deferUpdate();
      await runSwap(interaction, job);
      return;
    }
    if (interaction.customId === "double:next") {
      if (job.mode !== "double" || job.phase !== "review") {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That double swap has expired. Run /start again." });
        return;
      }
      const name1 = job.source.displayName();
      const name2 = job.target.displayName();
      const name3 = job.keeper.displayName();
      job.phase = "confirm";
      await interaction.deferUpdate();
      await show(interaction, {
        content: "",
        components: [doubleGoRow()],
        embeds: [new EmbedBuilder()
          .setTitle("Confirm the double swap")
          .setColor(0x5865f2)
          .setDescription([
            `1. **${name1}** changes to a random name. That frees **${name1}**.`,
            `2. **${name2}** takes **${name1}**. That frees **${name2}**. This is that account's one name change.`,
            `3. **${name3}** takes **${name2}**. **${name3}** is replaced.`,
            "",
            "Use this at your own risk. We are not responsible for lost names.",
            "Press **I want to double swap** only if you want to do this.",
            "Nothing changes until you press that button.",
          ].join("\n"))],
      });
      armTimer(job, interaction.user.id, interaction);
      return;
    }
    if (interaction.customId === "double:go") {
      if (job.mode !== "double" || job.phase !== "confirm") {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That double swap has expired. Run /start again." });
        return;
      }
      job.phase = "swapping";
      clearTimeout(job.timer);
      await interaction.deferUpdate();
      await runDouble(interaction, job);
      return;
    }
    if (interaction.customId === "caps:go") {
      if (job.mode !== "caps" || job.phase !== "confirm" || !job.nextName) {
        await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral, content: "That capitalization change has expired. Run /start again." });
        return;
      }
      job.phase = "swapping";
      clearTimeout(job.timer);
      await interaction.deferUpdate();
      await runCaps(interaction, job);
    }
  } catch (error) {
    console.error(error.message || error);
    if (!interaction.isRepliable()) return;
    const payload = { ...quiet, flags: MessageFlags.Ephemeral, content: error.message || "Something went wrong." };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

const config = loadConfig();
if (!config.token) {
  console.error("Add your Discord bot token, then run this again.");
  console.error('Create discord.json: {"token":"YOUR_BOT_TOKEN","guildId":""}');
  console.error("guildId is optional. A server id makes /start, /help, and /epic appear immediately.");
  process.exit(1);
}

client.login(config.token);