import { EpicClient } from "./epic.js";

function emptySwap() {
  return {
    phase: "idle",
    mode: "single",
    cancel: false,
    source: null,
    target: null,
    third: null,
    code: "",
    url: "",
    message: "",
    sourceName: "",
    targetName: "",
    thirdName: "",
    sourceId: "",
    targetId: "",
    thirdId: "",
    error: "",
    result: null,
  };
}

function idleLogin() {
  return {
    active: false,
    phase: "idle",
    code: "",
    url: "",
    message: "",
    error: "",
    cancel: false,
  };
}

function randomName() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let name = "";
  for (let i = 0; i < 16; i += 1) name += alphabet[Math.floor(Math.random() * alphabet.length)];
  return name;
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

function formatDuration(ms) {
  if (ms == null) return "";
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function createService(sessionPath) {
  const lookup = new EpicClient(sessionPath);
  let generation = 0;
  let confirmWait = null;
  let swap = emptySwap();
  let sessionGen = 0;
  let sessionLogin = idleLogin();

  function freshClient() {
    return new EpicClient(null, { persist: false, rememberDevice: false });
  }

  function sessionStatus() {
    if (!sessionLogin.active) lookup.load();
    return {
      signedIn: lookup.signedIn(),
      name: lookup.displayName(),
      accountId: lookup.accountId(),
      lasting: Boolean(lookup.session?.secret),
    };
  }

  function state() {
    return {
      session: sessionStatus(),
      sessionLogin: {
        active: sessionLogin.active,
        phase: sessionLogin.phase,
        code: sessionLogin.code,
        url: sessionLogin.url,
        message: sessionLogin.message,
        error: sessionLogin.error,
      },
      swap: {
        phase: swap.phase,
        mode: swap.mode,
        code: swap.code,
        url: swap.url,
        message: swap.message,
        sourceName: swap.sourceName,
        targetName: swap.targetName,
        thirdName: swap.thirdName,
        sourceId: swap.sourceId,
        targetId: swap.targetId,
        thirdId: swap.thirdId,
        error: swap.error,
        result: swap.result,
      },
    };
  }

  function waitForConfirm(gen) {
    return new Promise((resolveConfirm, rejectConfirm) => {
      const timer = setTimeout(() => {
        if (gen !== generation) return;
        confirmWait = null;
        rejectConfirm(new Error("That confirmation expired. Start again."));
      }, 10 * 60 * 1000);
      confirmWait = {
        gen,
        timer,
        resolve: () => {
          clearTimeout(timer);
          resolveConfirm();
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectConfirm(error);
        },
      };
    });
  }

  function assertCanStart() {
    if (["source", "target", "third", "review", "confirm", "swapping"].includes(swap.phase)) {
      throw new Error("A swap is already in progress. Cancel that one first.");
    }
    if (confirmWait) {
      const pending = confirmWait;
      confirmWait = null;
      clearTimeout(pending.timer);
      pending.reject(new Error("replaced"));
    }
  }

  function beginSwap() {
    assertCanStart();
    generation += 1;
    const gen = generation;
    const source = freshClient();
    swap = {
      ...emptySwap(),
      phase: "source",
      mode: "single",
      source,
      message: "Sign in to the Epic account that has the name you want to move.",
    };
    runSwapJob(gen, source);
  }

  function beginDoubleSwap() {
    assertCanStart();
    generation += 1;
    const gen = generation;
    const source = freshClient();
    swap = {
      ...emptySwap(),
      phase: "source",
      mode: "double",
      source,
      message: "Sign in to the Epic account that has the name you want to move.",
    };
    runDoubleJob(gen, source);
  }

  function cancelSwap() {
    if (swap.phase === "swapping") return { ok: false, error: "That swap is already running." };
    if (!["source", "target", "third", "review", "confirm"].includes(swap.phase)) return { ok: true };
    swap.cancel = true;
    swap.code = "";
    swap.url = "";
    swap.message = "";
    swap.phase = "error";
    swap.error = "Cancelled.";
    if (confirmWait) {
      const pending = confirmWait;
      confirmWait = null;
      clearTimeout(pending.timer);
      pending.reject(new Error("Sign-in cancelled."));
    }
    return { ok: true };
  }

  function confirmSwap() {
    if (swap.phase === "swapping") return;
    if ((swap.phase === "confirm" || swap.phase === "review") && !confirmWait) return;
    if (!confirmWait || confirmWait.gen !== generation || (swap.phase !== "confirm" && swap.phase !== "review")) {
      throw new Error("That swap has expired. Start again.");
    }
    const pending = confirmWait;
    confirmWait = null;
    clearTimeout(pending.timer);
    if (swap.phase === "review") {
      swap.phase = "confirm";
      swap.message = "";
      pending.resolve();
      return;
    }
    swap.phase = "swapping";
    swap.message = swap.mode === "double" ? "Double swapping..." : "Swapping...";
    pending.resolve();
  }

  async function executeSwap(source, target, fromName, toName) {
    await source.launcherAccessToken();
    await target.launcherAccessToken();
    const temp = await pickFreeName(source);
    const { released, claimed, gapMs } = await source.swapOnto(target, temp, fromName);
    const gap = gapMs == null ? "" : formatDuration(gapMs);
    if (!released.ok) {
      return {
        tone: "bad",
        title: "Swap did not happen",
        gap: "",
        accounts: {
          first: { before: fromName, after: fromName },
          second: { before: toName, after: toName },
        },
        lines: [
          "Neither account was changed.",
          `${fromName} is still on the first account.`,
          `${toName} is still on the second account.`,
          explain(released.message),
        ].filter(Boolean),
      };
    }
    if (!claimed?.ok) {
      return {
        tone: "warn",
        title: "Swap did not finish",
        gap,
        accounts: {
          first: { before: fromName, after: released.displayName || temp },
          second: { before: toName, after: toName },
        },
        lines: [
          `The first account is now ${released.displayName || temp}.`,
          `The second account is still ${toName}.`,
          `${fromName} was released and the second account could not take it.`,
          explain(claimed?.message),
          "If the name is still free, set it on the second account from Epic's website before someone else takes it.",
        ].filter(Boolean),
      };
    }
    return {
      tone: "ok",
      title: "Swap finished",
      gap,
      accounts: {
        first: { before: fromName, after: released.displayName || temp },
        second: { before: toName, after: claimed.displayName || fromName },
      },
      lines: [
        `${fromName} is now on the second account.`,
        `First account: ${fromName} → ${released.displayName || temp}`,
        `Second account: ${toName} → ${claimed.displayName || fromName}`,
      ],
    };
  }

  async function executeDouble(source, target, third, name1, name2, name3) {
    await source.launcherAccessToken();
    await target.launcherAccessToken();
    await third.launcherAccessToken();
    const temp = await pickFreeName(source);
    const { released, moved, kept, gapMs, secondGapMs } = await source.swapChain(target, third, temp, name1, name2);
    const gap = gapMs == null ? "" : formatDuration(gapMs);
    const secondGap = secondGapMs == null ? "" : formatDuration(secondGapMs);
    const timing = [
      gap ? `First change to second: ${gap}` : "",
      secondGap ? `Second change to third: ${secondGap}` : "",
    ];
    if (!released.ok) {
      return {
        tone: "bad",
        title: "Double swap did not happen",
        gap: "",
        accounts: {
          first: { before: name1, after: name1 },
          second: { before: name2, after: name2 },
          third: { before: name3, after: name3 },
        },
        lines: [
          "None of the three accounts were changed.",
          `${name1} is still on the first account.`,
          `${name2} is still on the second account.`,
          `${name3} is still on the third account.`,
          explain(released.message),
        ].filter(Boolean),
      };
    }
    if (!moved?.ok) {
      return {
        tone: "warn",
        title: "Double swap did not finish",
        gap: "",
        accounts: {
          first: { before: name1, after: released.displayName || temp },
          second: { before: name2, after: name2 },
          third: { before: name3, after: name3 },
        },
        lines: [
          `The first account is now ${released.displayName || temp}.`,
          `The second account is still ${name2}.`,
          `The third account is still ${name3}.`,
          `${name1} was released and the second account could not take it.`,
          explain(moved?.message),
          "If the name is still free, set it on the second account from Epic's website before someone else takes it.",
          ...timing,
        ].filter(Boolean),
      };
    }
    if (!kept?.ok) {
      return {
        tone: "warn",
        title: "Double swap did not finish",
        gap: "",
        accounts: {
          first: { before: name1, after: released.displayName || temp },
          second: { before: name2, after: moved.displayName || name1 },
          third: { before: name3, after: name3 },
        },
        lines: [
          `${name1} is now on the second account.`,
          `The second account released ${name2}, and the third account could not take it.`,
          `The third account is still ${name3}.`,
          explain(kept?.message),
          "If that name is still free, set it on the third account from Epic's website before someone else takes it.",
          ...timing,
        ].filter(Boolean),
      };
    }
    return {
      tone: "ok",
      title: "Double swap finished",
      gap: "",
      accounts: {
        first: { before: name1, after: released.displayName || temp },
        second: { before: name2, after: moved.displayName || name1 },
        third: { before: name3, after: kept.displayName || name2 },
      },
      lines: [
        `${name1} is now on the second account.`,
        `${name2} is now on the third account.`,
        `First account: ${name1} → ${released.displayName || temp}`,
        `Second account: ${name2} → ${moved.displayName || name1}`,
        `Third account: ${name3 || "Unknown"} → ${kept.displayName || name2}`,
        ...timing,
      ].filter(Boolean),
    };
  }

  function deviceLogin(client, gen) {
    return client.startDeviceLogin(({ userCode, url }) => {
      if (gen !== generation || swap.cancel) return;
      swap.code = userCode;
      swap.url = url;
    }, () => gen !== generation || swap.cancel);
  }

  async function runDoubleJob(gen, source) {
    try {
      const sourceName = await deviceLogin(source, gen);
      if (gen !== generation) return;
      if (!sourceName) throw new Error("Epic did not return a display name for the first account.");

      const target = freshClient();
      swap.target = target;
      swap.sourceName = sourceName;
      swap.sourceId = source.accountId();
      swap.code = "";
      swap.url = "";
      swap.phase = "target";
      swap.message = `Signed in to ${sourceName}. Sign in to the account that should receive that name. This account's current name will be kept.`;

      const targetName = await deviceLogin(target, gen);
      if (gen !== generation) return;
      if (!targetName) throw new Error("Epic did not return a display name for the second account.");

      const third = freshClient();
      swap.third = third;
      swap.targetName = target.displayName() || targetName;
      swap.targetId = target.accountId();
      swap.code = "";
      swap.url = "";
      swap.phase = "third";
      swap.message = `Signed in to ${swap.targetName}. Sign in to the account that should receive ${swap.targetName}.`;

      const thirdName = await deviceLogin(third, gen);
      if (gen !== generation) return;
      if (!thirdName) throw new Error("Epic did not return a display name for the third account.");

      await source.launcherAccessToken();
      await target.launcherAccessToken();
      await third.launcherAccessToken();
      if (gen !== generation) return;

      const name1 = source.displayName() || sourceName;
      const name2 = target.displayName() || targetName;
      const name3 = third.displayName() || thirdName;
      const ids = [source.accountId(), target.accountId(), third.accountId()].filter(Boolean);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Those sign-ins include the same Epic account. Sign in to three different accounts.");
      }

      swap.sourceName = name1;
      swap.targetName = name2;
      swap.thirdName = name3;
      swap.sourceId = source.accountId();
      swap.targetId = target.accountId();
      swap.thirdId = third.accountId();
      swap.code = "";
      swap.url = "";
      swap.phase = "review";
      swap.message = "";
      await waitForConfirm(gen);
      if (gen !== generation) return;

      swap.phase = "confirm";
      swap.message = "";
      await waitForConfirm(gen);
      if (gen !== generation) return;

      swap.phase = "swapping";
      swap.message = "Double swapping...";
      const result = await executeDouble(source, target, third, name1, name2, name3);
      if (gen !== generation) return;
      swap.phase = "done";
      swap.message = "";
      swap.error = "";
      swap.result = result;
    } catch (error) {
      if (gen !== generation) return;
      if (error?.message === "replaced") return;
      swap.phase = "error";
      swap.code = "";
      swap.url = "";
      swap.message = "";
      swap.result = null;
      swap.error = error?.message === "Sign-in cancelled." ? "Cancelled." : (error?.message || "The double swap failed.");
    } finally {
      if (gen === generation) {
        swap.source = null;
        swap.target = null;
        swap.third = null;
      }
    }
  }

  async function runSwapJob(gen, source) {
    try {
      const sourceName = await source.startDeviceLogin(({ userCode, url }) => {
        if (gen !== generation || swap.cancel) return;
        swap.code = userCode;
        swap.url = url;
      }, () => gen !== generation || swap.cancel);
      if (gen !== generation) return;
      if (!sourceName) throw new Error("Epic did not return a display name for the first account.");

      const target = freshClient();
      swap.target = target;
      swap.sourceName = sourceName;
      swap.sourceId = source.accountId();
      swap.code = "";
      swap.url = "";
      swap.phase = "target";
      swap.message = `Signed in to ${sourceName}. Sign in to the account that should receive that name.`;

      const targetName = await target.startDeviceLogin(({ userCode, url }) => {
        if (gen !== generation || swap.cancel) return;
        swap.code = userCode;
        swap.url = url;
      }, () => gen !== generation || swap.cancel);
      if (gen !== generation) return;

      await source.launcherAccessToken();
      await target.launcherAccessToken();
      if (gen !== generation) return;

      const fromName = source.displayName() || sourceName;
      const toName = target.displayName() || targetName || "";
      const fromId = source.accountId();
      const toId = target.accountId();
      if (fromId && fromId === toId) {
        throw new Error("Those are the same Epic account. Sign in to two different accounts.");
      }

      swap.sourceName = fromName;
      swap.targetName = toName;
      swap.sourceId = fromId;
      swap.targetId = toId;
      swap.code = "";
      swap.url = "";
      swap.phase = "confirm";
      swap.message = "";
      await waitForConfirm(gen);
      if (gen !== generation) return;

      swap.phase = "swapping";
      swap.message = "Swapping...";
      const result = await executeSwap(source, target, fromName, toName);
      if (gen !== generation) return;
      swap.phase = "done";
      swap.message = "";
      swap.error = "";
      swap.result = result;
    } catch (error) {
      if (gen !== generation) return;
      if (error?.message === "replaced") return;
      swap.phase = "error";
      swap.code = "";
      swap.url = "";
      swap.message = "";
      swap.result = null;
      swap.error = error?.message === "Sign-in cancelled." ? "Cancelled." : (error?.message || "The swap failed.");
    } finally {
      if (gen === generation) {
        swap.source = null;
        swap.target = null;
        swap.third = null;
      }
    }
  }

  function beginSessionLogin(force) {
    if (sessionLogin.active) throw new Error("A sign-in is already in progress.");
    if (lookup.signedIn() && !force) return;
    sessionGen += 1;
    const gen = sessionGen;
    sessionLogin = {
      active: true,
      phase: "waiting",
      code: "",
      url: "",
      message: force
        ? "Removing the saved Epic sign-in..."
        : "Approve this code on Epic's site. Do not enter a password here.",
      error: "",
      cancel: false,
    };
    runSessionLogin(gen, Boolean(force));
  }

  async function runSessionLogin(gen, force) {
    let removed = false;
    try {
      if (force && lookup.signedIn()) {
        await lookup.logout();
        removed = true;
      }
      if (gen !== sessionGen) return;
      if (sessionLogin.cancel) {
        sessionLogin.active = false;
        sessionLogin.phase = "idle";
        sessionLogin.code = "";
        sessionLogin.url = "";
        sessionLogin.message = removed ? "Cancelled. The previous sign-in was removed." : "Cancelled.";
        return;
      }
      sessionLogin.message = "Approve this code on Epic's site. Do not enter a password here.";
      const name = await lookup.startDeviceLogin(({ userCode, url }) => {
        if (gen !== sessionGen || sessionLogin.cancel) return;
        sessionLogin.code = userCode;
        sessionLogin.url = url;
      }, () => gen !== sessionGen || sessionLogin.cancel);
      if (gen !== sessionGen) return;
      sessionLogin.active = false;
      sessionLogin.code = "";
      sessionLogin.url = "";
      if (!lookup.session?.secret) {
        sessionLogin.phase = "error";
        sessionLogin.error = "Epic signed in, but did not save a lasting device sign-in. Profile lookup will stop working when this token expires. Sign in again.";
        sessionLogin.message = "";
        return;
      }
      sessionLogin.phase = "done";
      sessionLogin.error = "";
      sessionLogin.message = `Saved the sign-in for ${name || lookup.accountId()}.`;
    } catch (error) {
      if (gen !== sessionGen) return;
      const cancelled = error?.message === "Sign-in cancelled.";
      sessionLogin.active = false;
      sessionLogin.code = "";
      sessionLogin.url = "";
      sessionLogin.phase = cancelled ? "idle" : "error";
      sessionLogin.error = cancelled ? "" : (error?.message || "Sign-in failed.");
      sessionLogin.message = cancelled
        ? (removed ? "Cancelled. The previous sign-in was removed." : "Cancelled.")
        : "";
    }
  }

  function cancelSession() {
    if (!sessionLogin.active) return;
    sessionLogin.cancel = true;
    sessionLogin.code = "";
    sessionLogin.url = "";
    sessionLogin.message = "Cancelling...";
  }

  async function logoutSession() {
    sessionGen += 1;
    sessionLogin = idleLogin();
    await lookup.logout();
  }

  async function lookupName(name) {
    const queried = String(name || "").trim();
    if (!lookup.signedIn()) {
      throw new Error("Sign in on the Account tab first. Profile lookup uses that saved Epic account.");
    }
    return { profile: await lookup.describeName(queried) };
  }

  return {
    state,
    beginSwap,
    beginDoubleSwap,
    cancelSwap,
    confirmSwap,
    beginSessionLogin,
    cancelSession,
    logoutSession,
    lookupName,
  };
}
