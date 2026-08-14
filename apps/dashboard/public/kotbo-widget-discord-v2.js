/**
 * Kotbo - installation du widget dans le Profile Board Discord.
 *
 * À exécuter dans la console DevTools de Discord Desktop avec Vencord.
 * Ce script utilise uniquement la session Discord locale : il ne lit, ne copie
 * et ne transmet aucun token.
 */
(async function installKotboProfileWidget() {
  "use strict";

  const KOTBO_APPLICATION_ID = "1481651387317354598";
  const discordChunks = globalThis.webpackChunkdiscord_app;

  if (!discordChunks) {
    throw new Error("Ce script doit être exécuté dans la console de Discord Desktop avec Vencord.");
  }

  const webpackRequire = discordChunks.push([[Symbol()], {}, require => require]);
  discordChunks.pop();

  const modules = Object.values(webpackRequire.c);
  const api = modules
    .map(module => module?.exports?.Bo)
    .find(candidate => typeof candidate?.get === "function" && typeof candidate?.put === "function");
  const userStore = modules
    .map(module => module?.exports?.A)
    .find(candidate => typeof candidate?.getCurrentUser === "function");

  if (!api || !userStore) {
    throw new Error("Modules Discord introuvables. Mets Discord et Vencord à jour, redémarre, puis réessaie.");
  }

  const currentUser = userStore.getCurrentUser();
  if (!currentUser?.id) {
    throw new Error("Impossible de déterminer le compte Discord connecté.");
  }

  const profileResponse = await api.get({ url: `/users/${currentUser.id}/profile` });
  const widgets = Array.isArray(profileResponse?.body?.widgets)
    ? structuredClone(profileResponse.body.widgets)
    : [];

  const alreadyInstalled = widgets.some(widget =>
    widget?.data?.type === "application" &&
    String(widget?.data?.application_id) === KOTBO_APPLICATION_ID
  );

  if (alreadyInstalled) {
    console.info("%c✓ Le widget Kotbo est déjà installé.", "color:#22c55e;font-weight:700");
    return;
  }

  widgets.unshift({
    data: {
      type: "application",
      application_id: KOTBO_APPLICATION_ID,
    },
  });

  await api.put({
    url: "/users/@me/widgets",
    body: { widgets },
  });

  console.info(
    "%c✓ Widget Kotbo ajouté. Recharge Discord avec Ctrl+R.",
    "color:#22c55e;font-weight:700",
  );
})();
