<script lang="ts">
  import { onMount } from "svelte";
  import { Route as RouteLegacy, router } from "tinro";
  const Route = RouteLegacy as any;
  import MainLayout from "./lib/components/MainLayout.svelte";
  import { authStore } from "./lib/stores/auth.svelte";
  import { dashboardStore } from "./lib/stores/dashboard.svelte";
  import { brandingStore } from "./lib/stores/branding.svelte";
  import { userPrefs } from "./lib/stores/userPreferences.svelte";
  import { toast } from "./lib/stores/toast.svelte";
  import { feedbackModal } from "./lib/stores/feedbackModal.svelte";
  import { inviteDetailsModal } from "./lib/stores/inviteDetailsModal.svelte";
  import { channelDetailsModal } from "./lib/stores/channelDetailsModal.svelte";
  import ToastContainer from "./lib/components/ToastContainer.svelte";
  import GlobalConfirmDialog from "./lib/components/GlobalConfirmDialog.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import GlobalErrorOverlay from "./lib/components/GlobalErrorOverlay.svelte";
  import LazyRoute from "./lib/components/LazyRoute.svelte";
  import ModuleDisabledNotice from "./lib/components/ModuleDisabledNotice.svelte";
  import NoAccessNotice from "./lib/components/NoAccessNotice.svelte";
  import { navigationStore } from "./lib/stores/navigation.svelte";
  import { getModuleForPath } from "@kotbo/contracts";
  import {
    SECURITY_LEGACY_REDIRECTS,
    resolveSecurityRedirect,
  } from "./lib/config/pages";
  import { m } from "./lib/i18n";

  const LEGACY_SECURITY_PATHS = Object.keys(SECURITY_LEGACY_REDIRECTS);

  let globalError = $state<{ message: string; stack?: string } | null>(null);
  let showKeyboardShortcuts = $state(false);

  $effect(() => {
    if (authStore.selectedGuildId && authStore.isAuthenticated) {
      userPrefs.syncFromDatabase();
    }
  });

  // Seules les pages du chemin critique restent en import statique : elles font
  // partie du premier rendu (ecran de connexion, accueil, 404). Toutes les
  // autres passent par <LazyRoute> et sont chargees a la demande - voir
  // src/lib/lazyRoutes.ts.
  import Login from "./pages/Login.svelte";
  import Activation from "./pages/Activation.svelte";

  const isPublicPage = $derived(
    /^\/\d{17,19}\/news\/?$/.test($router.path) ||
      /^\/\d{17,19}\/leveling\/classement\/?$/.test($router.path) ||
      /^\/\d{17,19}\/prestige\/classement\/?$/.test($router.path) ||
      /^\/\d{17,19}\/leveling\/clan\/?$/.test($router.path) ||
      /^\/\d{17,19}\/clan\/?$/.test($router.path) ||
      /^\/\d{17,19}\/rpg\/?$/.test($router.path) ||
      /^\/\d{17,19}\/dev\/?$/.test($router.path) ||
      /^\/\d{17,19}\/giveaways(\/[A-Za-z0-9_-]+)?\/?$/.test($router.path) ||
      ($router.path.startsWith("/profile/") && !authStore.isAuthenticated) ||
      $router.path.startsWith("/transcripts/") ||
      $router.path.startsWith("/sanction-evidence/") ||
      $router.path.startsWith("/form/") ||
      $router.path.startsWith("/appeal/") ||
      $router.path.startsWith("/verify/"),
  );

  // `/profile/<id>` cible un autre membre, `/profile/<onglet>` mon propre profil :
  // seul un snowflake Discord est traite comme un identifiant.
  function profileUserIdFromPath(path: string): string | undefined {
    const segment = path.replace(/^\/profile\/?/, "").split("/")[0];
    return segment && /^\d{17,19}$/.test(segment) ? segment : undefined;
  }

  const featureAccess = $derived(dashboardStore.state.featureAccess || {});
  const fallbackCanView = $derived(authStore.hasGuildAccess);
  const noGuildAccess = $derived(
    authStore.initialized && !authStore.hasGuildAccess,
  );
  // Une page dont la clef est refusee ne doit pas se rendre en attendant que la
  // redirection s'applique - et quand il n'existe aucune page ouverte vers ou
  // rediriger, c'est cet ecran qui reste affiche.
  const routeFeatureDenied = $derived.by(() => {
    if (!authStore.initialized || isPublicPage) return false;
    const featureKey = resolveRouteFeatureKey($router.path);
    return !!featureKey && !canViewFeature(featureKey);
  });

  function canViewFeature(featureKey: string) {
    // Meme ordre que navigationStore.canViewFeature : l'acces a la guilde
    // prime sur `featureAccess`, qui decrit la derniere guilde chargee.
    if (!fallbackCanView) return false;
    if (!featureKey) return true;
    const feature = (featureAccess as Record<string, any>)?.[featureKey];
    if (feature?.canView !== undefined) return feature.canView;
    return true;
  }

  function resolveRouteFeatureKey(path: string): string | null {
    if (path === "/" || path.startsWith("/profile")) return "dashboard";
    if (path.startsWith("/analytics")) return "analytics";
    if (path.startsWith("/inbox")) return "inbox";
    if (path.startsWith("/events")) return "events";
    if (path.startsWith("/members") || path.startsWith("/invitations"))
      return "members";
    // Les niveaux de protection sont des prereglages AutoMod, meme s'ils
    // deplacent aussi les seuils anti-raid : c'est le droit AutoMod qui ouvre
    // la page, comme sur Securite > Filtres.
    if (path.startsWith("/security/quick-setup")) return "automod";
    if (path.startsWith("/security/sanctions")) return "sanctions";
    if (path.startsWith("/security/filters")) return "automod";
    if (path.startsWith("/security/accounts")) return "double_accounts";
    if (path.startsWith("/security")) return "raid_protection";
    if (path.startsWith("/channels-management")) return "auto_thread";
    if (path.startsWith("/logs")) return "logs";
    if (path.startsWith("/activity")) return "activity";
    if (path.startsWith("/recruitment")) return "recruitment";
    if (path.startsWith("/tickets")) return "tickets";
    if (path.startsWith("/tutoring")) return "tutoring";
    if (path.startsWith("/meetings")) return "meetings";
    if (path.startsWith("/absences")) return "absences";
    if (path.startsWith("/planning")) return "absences";
    if (path.startsWith("/leveling")) return "leveling";
    if (
      path.startsWith("/economy") ||
      path.startsWith("/marketplace") ||
      path.startsWith("/quests")
    )
      return "economy";
    if (path.startsWith("/giveaways")) return "giveaways";
    if (path.startsWith("/welcome") || path.startsWith("/announcement")) return "welcome_goodbye";
    if (path.startsWith("/reaction-roles")) return "reaction_roles";
    if (path.startsWith("/triggers") || path.startsWith("/workflows")) return "workflows";
    if (path.startsWith("/suggestions")) return "suggestions";
    if (path.startsWith("/starboard")) return "starboard";
    if (path.startsWith("/embed-builder")) return "embed_builder";
    if (path.startsWith("/staff-management")) {
      const segment = path.split('/')[2] || '';
      if (segment === "roles") return "staff_roles";
      if (segment === "polls") return "polls";
      if (segment === "warnings") return "discipline";
      if (segment === "leadership") return "staff_directory";
      return "staff_directory";
    }
    if (path.startsWith("/evaluations")) return "staff_directory";
    if (path.startsWith("/management")) return "centralized_config";
    if (path.startsWith("/modules")) return "modules";
    if (path.startsWith("/server-template")) return "settings";
    if (path.startsWith("/command-access")) return "commands";
    if (path.startsWith("/settings")) return "settings";
    if (path.startsWith("/regulation")) return "regulation";
    if (path.startsWith("/news")) return "news";
    if (path.startsWith("/social-networks")) return "social_networks";
    if (path.startsWith("/backups")) return "settings";
    if (path.startsWith("/schedules")) return "settings";
    if (path.startsWith("/mcp-settings")) return "settings";
    if (path.startsWith("/fun")) return "fun";
    if (path.startsWith("/channel-health")) return "channel_health";
    if (path.startsWith("/channel-links")) return "channel_links";
    if (path.startsWith("/staff-server")) return "staff_server";
    if (path.startsWith("/widget")) return "dashboard";
    if (path.startsWith("/admin")) return "centralized_config";
    return null;
  }

  function navigate(node: HTMLElement, path: string) {
    router.goto(path);
  }

  /**
   * Une guilde qu'on n'arrive pas a resoudre ne vaut pas autorisation. Le repli
   * sur "admin" ouvrait les routes de configuration des que le serveur
   * selectionne n'etait pas dans la liste - liste pas encore lue, serveur
   * devenu inaccessible - et le test `!== "moderator"` laissait aussi passer
   * tout niveau inconnu. La liste ne porte que "admin" et "moderator", donc la
   * question posee ici est exactement celle de `authStore.isAdmin`.
   *
   * Tant que la session n'est pas chargee la reponse reste permissive, comme
   * `authStore.hasGuildAccess` : refuser pendant l'amorcage retirerait ces
   * routes de la table, et un rafraichissement sur une page de configuration
   * tomberait sur l'ecran 404 avant meme que la liste des serveurs soit connue.
   */
  const canManageSettings = $derived(
    !authStore.initialized || authStore.isAdmin,
  );

  /**
   * Module éteint auquel appartient la route courante, s'il y en a un.
   *
   * Masquer l'entrée de la barre latérale ne suffit pas : l'URL reste tapable,
   * un favori ou un lien la ramène, et la page montée derrière ne saurait
   * qu'échouer sur un 403. On la remplace par un écran qui explique et propose
   * de rallumer le module.
   */
  const disabledModuleForRoute = $derived.by(() => {
    const states = dashboardStore.state.moduleStates as
      | Record<string, boolean>
      | undefined;
    if (!states) return null;
    const moduleKey = getModuleForPath($router.path);
    if (!moduleKey) return null;
    return states[moduleKey] === false ? moduleKey : null;
  });

  onMount(() => {
    brandingStore.load();

    // Remove credentials left by the retired fragment-based OAuth flow.
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get("token");

    if (!token && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      token = hashParams.get("token");
    }

    if (token) {
      authStore.setToken(token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    void authStore.initialize().then(() => {
      if (!authStore.isAuthenticated && $router.path !== "/login" && !isPublicPage) {
        router.goto("/login");
      } else if (authStore.isAuthenticated && $router.path === "/login") {
        router.goto("/");
      }
    });

    const timer = setTimeout(() => {
      sessionStorage.removeItem("error_refreshed");
    }, 5000);

    // Keyboard shortcuts
    let gKeyPressed = false;
    let gKeyTimeout: number | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isEditing = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.getAttribute('contenteditable') === 'true'
      );

      if (isEditing) return;

      // Check for Ctrl + Shift + key combinations
      if (e.ctrlKey && e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'd':
            e.preventDefault();
            router.goto("/");
            break;
          case 'm':
            e.preventDefault();
            router.goto("/members");
            break;
          case 'c':
            e.preventDefault();
            router.goto("/settings");
            break;
          case 'l':
            e.preventDefault();
            router.goto("/activity");
            break;
          case 'n':
            e.preventDefault();
            showKeyboardShortcuts = true;
            break;
        }
        return;
      }

      // Handle G then key sequences
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        gKeyPressed = true;
        if (gKeyTimeout) clearTimeout(gKeyTimeout);
        gKeyTimeout = window.setTimeout(() => {
          gKeyPressed = false;
        }, 1000);
        return;
      }

      if (gKeyPressed) {
        switch (e.key.toLowerCase()) {
          case 'd':
            e.preventDefault();
            router.goto("/");
            gKeyPressed = false;
            if (gKeyTimeout) clearTimeout(gKeyTimeout);
            break;
          case 'm':
            e.preventDefault();
            router.goto("/members");
            gKeyPressed = false;
            if (gKeyTimeout) clearTimeout(gKeyTimeout);
            break;
          case 'c':
            e.preventDefault();
            router.goto("/settings");
            gKeyPressed = false;
            if (gKeyTimeout) clearTimeout(gKeyTimeout);
            break;
          case 'l':
            e.preventDefault();
            router.goto("/activity");
            gKeyPressed = false;
            if (gKeyTimeout) clearTimeout(gKeyTimeout);
            break;
        }
      }
    };

    // Fonction nommee : `removeEventListener` compare les references, donc une
    // fonction anonyme recreee au nettoyage ne retire jamais le listener.
    const handleOpenKeyboardShortcuts = () => {
      showKeyboardShortcuts = true;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(
      "open-keyboard-shortcuts",
      handleOpenKeyboardShortcuts,
    );

    // Global error handling - ignores network/abort errors from WS reconnections
    // and Vite dev-server internal errors to avoid infinite feedback loops
    const IGNORED_MESSAGES = [
      "Failed to fetch",
      "NetworkError",
      "Load failed",
      "AbortError",
      "The operation was aborted",
      // Vite dev-server WS errors (would cause infinite loop if logged via console)
      "send was called before connect",
      "WebSocket is closed",
    ];

    // Re-entrancy guard: prevents the handler from triggering itself
    let isHandlingRejection = false;

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isHandlingRejection) {
        event.preventDefault();
        return;
      }

      const reason = event.reason;
      const message: string = reason?.message || String(reason) || "";

      // Silently ignore network errors (e.g. from WS reconnect / API temporarily down)
      if (IGNORED_MESSAGES.some((ignored) => message.includes(ignored))) {
        event.preventDefault(); // Suppress browser console error too
        return;
      }

      isHandlingRejection = true;
      try {
        // Use queueMicrotask to avoid calling toast synchronously during Vite init
        queueMicrotask(() => {
          globalError = {
            message:
              message ||
              m.d3_err_unexpected_promise(),
            stack: reason?.stack || undefined,
          };
          toast.error(message || m.d3_err_unexpected());
          isHandlingRejection = false;
        });
      } catch {
        isHandlingRejection = false;
      }
    };

    const handleError = (event: ErrorEvent) => {
      // Only show toast for non-script-load errors
      if (
        event.message &&
        !IGNORED_MESSAGES.some((m) => event.message.includes(m))
      ) {
        globalError = {
          message: event.message || m.d3_err_generic(),
          stack: event.error?.stack || undefined,
        };
        toast.error(event.message || m.d3_err_generic());
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(
        "open-keyboard-shortcuts",
        handleOpenKeyboardShortcuts,
      );
      window.removeEventListener("error", handleError);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  });

  $effect(() => {
    if (!authStore.initialized) return;
    if (
      !authStore.isAuthenticated &&
      $router.path !== "/login" &&
      !isPublicPage
    ) {
      router.goto("/login");
      return;
    }

    if (authStore.isAuthenticated && !isPublicPage) {
      // Aucun serveur accessible : il n'y a nulle part ou rediriger, c'est
      // NoAccessNotice qui prend la main.
      if (noGuildAccess) return;

      const featureKey = resolveRouteFeatureKey($router.path);
      if (featureKey && !canViewFeature(featureKey)) {
        // `/` porte la clef `dashboard` : y renvoyer quelqu'un a qui cette
        // clef est refusee ne faisait rien du tout, et l'accueil se rendait
        // malgre le refus. On vise donc la premiere page reellement ouverte.
        const target = canViewFeature("dashboard")
          ? "/"
          : navigationStore.allItems[0]?.href;
        if (target && $router.path !== target) {
          router.goto(target);
        }
      }
    }
  });
</script>

{#snippet handleLegacyRedirect(moduleId: string)}
  {@const mapping: Record<string, string> = {
    'regulation': '/regulation',
    'sanctions': '/security/sanctions',
    'logs': '/logs',
    'recruitment': '/recruitment',
    'tickets': '/tickets',
    'meetings': '/planning',
    'fun': '/fun',
  }}
  {@const target = mapping[moduleId] || "/modules"}
  <div use:navigate={target}></div>
{/snippet}

{#if globalError}
  <GlobalErrorOverlay
    errorMsg={globalError.message}
    errorStack={globalError.stack}
  />
{:else}
  <svelte:boundary>
    {#if isPublicPage}
      <LazyRoute
        path="/:serverId/news"
        load={() => import("./pages/News.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/leveling/classement"
        load={() => import("./pages/LevelingPublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/prestige/classement"
        load={() => import("./pages/PrestigePublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/leveling/clan"
        load={() => import("./pages/LevelingClanPublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/clan"
        load={() => import("./pages/LevelingClanPublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/rpg"
        load={() => import("./pages/RpgClanPublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/dev"
        load={() => import("./pages/ClanBoardPublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/giveaways"
        load={() => import("./pages/GiveawaysPublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId })}
      />
      <LazyRoute
        path="/:serverId/giveaways/:giveawayId"
        load={() => import("./pages/GiveawaysPublic.svelte")}
        props={(meta) => ({ serverId: meta.params.serverId, giveawayId: meta.params.giveawayId })}
      />
      <LazyRoute
        path="/profile/:userId"
        load={() => import("./pages/PublicProfile.svelte")}
        props={(meta) => ({ userId: meta.params.userId })}
      />
      <LazyRoute
        path="/transcripts/:transcriptId"
        load={() => import("./pages/TranscriptDetail.svelte")}
        props={(meta) => ({ transcriptId: meta.params.transcriptId })}
      />
      <LazyRoute
        path="/sanction-evidence/:fileId"
        load={() => import("./pages/SanctionEvidenceFile.svelte")}
        props={(meta) => ({ fileId: meta.params.fileId })}
      />
      <LazyRoute
        path="/form/:formId"
        load={() => import("./pages/PublicForm.svelte")}
        props={(meta) => ({ formId: meta.params.formId })}
      />
      <LazyRoute
        path="/appeal/:guildId"
        load={() => import("./pages/PublicAppeal.svelte")}
        props={(meta) => ({ guildId: meta.params.guildId })}
      />
      <LazyRoute
        path="/verify/:guildId/:token"
        load={() => import("./pages/Verify.svelte")}
        props={(meta) => ({ guildId: meta.params.guildId, token: meta.params.token })}
      />

      <!-- Fallback pages publiques -->
      <Route fallback>
        <NotFound />
      </Route>
    {:else}
      <Route path="/login">
        <Login />
      </Route>

      {#if authStore.isAuthenticated}
        {#if dashboardStore.state.error === "activation_requise"}
          <Route path="/*">
            <Activation />
          </Route>
        {:else if noGuildAccess || routeFeatureDenied}
          <MainLayout>
            <NoAccessNotice reason={noGuildAccess ? "guild" : "feature"} />
          </MainLayout>
        {:else if disabledModuleForRoute}
          <MainLayout>
            <ModuleDisabledNotice moduleKey={disabledModuleForRoute} />
          </MainLayout>
        {:else}
          <MainLayout>
            <LazyRoute
              path="/"
              load={() => import("./pages/Home.svelte")}
            />

            <LazyRoute
              path="/analytics/*"
              load={() => import("./pages/Analytics.svelte")}
            />
            <LazyRoute
              path="/activity"
              load={() => import("./pages/ActivityLog.svelte")}
            />
            {#if authStore.isBotAdmin}
              <LazyRoute
                path="/admin"
                load={() => import("./pages/admin/Overview.svelte")}
              />
              <LazyRoute
                path="/admin/servers"
                load={() => import("./pages/admin/Servers.svelte")}
              />
              <LazyRoute
                path="/admin/shards"
                load={() => import("./pages/admin/Shards.svelte")}
              />
              <LazyRoute
                path="/admin/security"
                load={() => import("./pages/admin/Security.svelte")}
              />
              <LazyRoute
                path="/admin/content"
                load={() => import("./pages/admin/Content.svelte")}
              />
              <LazyRoute
                path="/admin/config"
                load={() => import("./pages/admin/Config.svelte")}
              />
              <LazyRoute
                path="/admin/activation"
                load={() => import("./pages/admin/Activation.svelte")}
              />
              <LazyRoute
                path="/admin/modules"
                load={() => import("./pages/admin/Modules.svelte")}
              />
              <LazyRoute
                path="/admin/whitelabel"
                load={() => import("./pages/admin/WhiteLabel.svelte")}
              />
              <LazyRoute
                path="/admin/broadcast"
                load={() => import("./pages/admin/Broadcast.svelte")}
              />
              <LazyRoute
                path="/admin/gdpr"
                load={() => import("./pages/admin/Gdpr.svelte")}
              />
              <LazyRoute
                path="/admin/audit"
                load={() => import("./pages/admin/Audit.svelte")}
              />
            {/if}
            <LazyRoute
              path="/logs/*"
              load={() => import("./pages/Logs.svelte")}
            />
            <LazyRoute
              path="/workflows"
              load={() => import("./pages/Workflows.svelte")}
            />
            <!-- Securite : six pages, la plupart decoupees en onglets.
                 Les anciennes URL sont redirigees plus bas. -->
            <LazyRoute
              path="/security/quick-setup"
              load={() => import("./pages/security/QuickSetup.svelte")}
            />
            <LazyRoute
              path="/security/anti-raid/*"
              load={() => import("./pages/security/AntiRaid.svelte")}
            />
            <LazyRoute
              path="/security/filters/*"
              load={() => import("./pages/security/Filters.svelte")}
            />
            <LazyRoute
              path="/security/accounts/*"
              load={() => import("./pages/security/Accounts.svelte")}
            />
            <LazyRoute
              path="/security/sanctions/*"
              load={() => import("./pages/security/Sanctions.svelte")}
            />
            <!-- Sans etoile, et surtout pas apres les autres pages du groupe :
                 les routes de Tinro ne s'excluent pas, `/security/*` captait
                 aussi `/security/anti-raid` et consorts, et la vue d'ensemble
                 se rajoutait sous chacune d'elles. La vue d'ensemble n'ayant
                 pas d'onglets, une route exacte suffit ; lui en donner un jour
                 demandera d'ajouter sa route ici, sous celles de ses voisines. -->
            <LazyRoute
              path="/security"
              load={() => import("./pages/security/Overview.svelte")}
            />
            <LazyRoute
              path="/regulation"
              load={() => import("./pages/Regulation.svelte")}
            />
            <LazyRoute
              path="/news/*"
              load={() => import("./pages/News.svelte")}
            />
            <LazyRoute
              path="/social-networks/*"
              load={() => import("./pages/SocialNetworks.svelte")}
            />
            <!-- Une seule route : le premier segment peut etre un ID Discord
                 (profil d'un autre membre) ou un nom d'onglet (mon profil). -->
            <LazyRoute
              path="/profile/*"
              load={() => import("./pages/Profile.svelte")}
              props={() => ({ userId: profileUserIdFromPath($router.path) })}
              remountKey={() => profileUserIdFromPath($router.path)}
            />
            {#if canManageSettings}
              <LazyRoute
                path="/management"
                load={() => import("./pages/ManagementCenter.svelte")}
              />
              <LazyRoute
                path="/modules"
                load={() => import("./pages/ModuleCatalog.svelte")}
              />
              <LazyRoute
                path="/server-template"
                load={() => import("./pages/ServerTemplate.svelte")}
              />
              <LazyRoute
                path="/migration"
                load={() => import("./pages/Migration.svelte")}
              />
              <LazyRoute
                path="/campaigns"
                load={() => import("./pages/Campaigns.svelte")}
              />
              <Route path="/module-settings/:moduleId" let:meta>
                <!-- Simple redirect logic for legacy URLs -->
                {@render handleLegacyRedirect(meta.params.moduleId)}
              </Route>
              <LazyRoute
                path="/notifications"
                load={() => import("./pages/NotificationsSettings.svelte")}
              />
              <LazyRoute
                path="/command-access/*"
                load={() => import("./pages/CommandAccess.svelte")}
              />
              <LazyRoute
                path="/settings"
                load={() => import("./pages/GeneralSettings.svelte")}
              />
              <LazyRoute
                path="/backups"
                load={() => import("./pages/Backups.svelte")}
              />
              <LazyRoute
                path="/schedules"
                load={() => import("./pages/Schedules.svelte")}
              />
              <LazyRoute
                path="/mcp-settings"
                load={() => import("./pages/MCPSettings.svelte")}
              />
              <LazyRoute
                path="/custom-bot"
                load={() => import("./pages/CustomBot.svelte")}
              />
              <LazyRoute
                path="/automations"
                load={() => import("./pages/ModuleCatalog.svelte")}
              />
              <LazyRoute
                path="/staff-management/*"
                load={() => import("./pages/StaffManagement.svelte")}
              />
              <LazyRoute
                path="/channels-management/*"
                load={() => import("./pages/ChannelsManagement.svelte")}
              />
            {/if}

            <LazyRoute
              path="/channel-health/*"
              load={() => import("./pages/ChannelHealth.svelte")}
            />
            <LazyRoute
              path="/pulse/*"
              load={() => import("./pages/Pulse.svelte")}
            />
            <LazyRoute
              path="/reputation"
              load={() => import("./pages/Reputation.svelte")}
            />
            <Route path="/satisfaction">
              <div use:navigate={"/tickets"}></div>
            </Route>
            <LazyRoute
              path="/seasons"
              load={() => import("./pages/Seasons.svelte")}
            />
            <LazyRoute
              path="/prestige/*"
              load={() => import("./pages/Prestige.svelte")}
            />
            <Route path="/predictions">
              <div use:navigate={"/pulse"}></div>
            </Route>
            <LazyRoute
              path="/evaluations"
              load={() => import("./pages/Evaluations.svelte")}
            />
            <LazyRoute
              path="/marketplace/*"
              load={() => import("./pages/Marketplace.svelte")}
            />
            <LazyRoute
              path="/quests"
              load={() => import("./pages/Quests.svelte")}
            />
            <!-- Le widget de profil est devenu un onglet des parametres utilisateur. -->
            <Route path="/widget">
              <div use:navigate={"/userSettings/widget"}></div>
            </Route>
            <LazyRoute
              path="/channel-links"
              load={() => import("./pages/ChannelLinks.svelte")}
            />
            <LazyRoute
              path="/staff-server"
              load={() => import("./pages/StaffServerLinks.svelte")}
            />

            <LazyRoute
              path="/members/*"
              load={() => import("./pages/Members.svelte")}
            />
            <LazyRoute
              path="/recruitment"
              load={() => import("./pages/Recruitment.svelte")}
            />
            <LazyRoute
              path="/forms"
              load={() => import("./pages/CustomForms.svelte")}
            />
            <LazyRoute
              path="/forms/builder/:formId"
              load={() => import("./pages/FormBuilder.svelte")}
              props={(meta) => ({ formId: meta.params.formId })}
            />
            <LazyRoute
              path="/forms/:formId/responses"
              load={() => import("./pages/CustomFormResponses.svelte")}
              props={(meta) => ({ formId: meta.params.formId })}
            />
            <LazyRoute
              path="/tickets/*"
              load={() => import("./pages/Tickets.svelte")}
            />
            <LazyRoute
              path="/transcripts-list"
              load={() => import("./pages/Transcripts.svelte")}
            />
            <LazyRoute
              path="/message-search"
              load={() => import("./pages/MessageSearch.svelte")}
            />
            <LazyRoute
              path="/meetings"
              load={() => import("./pages/Meetings.svelte")}
            />
            <Route path="/absences">
              <div use:navigate={"/planning"}></div>
            </Route>
            <LazyRoute
              path="/planning/*"
              load={() => import("./pages/Planning.svelte")}
            />
            <LazyRoute
              path="/inbox/*"
              load={() => import("./pages/Inbox.svelte")}
            />
            <LazyRoute
              path="/tutoring"
              load={() => import("./pages/Tutoring.svelte")}
            />
            <LazyRoute
              path="/leveling/*"
              load={() => import("./pages/Leveling.svelte")}
            />
            <!-- Avant `/economy/*`, et surtout sur un chemin voisin plutot que dessous :
                 les routes de Tinro ne s'excluent pas, `/economy/*` capterait aussi
                 `/economy/quick-setup` et empilerait la page Economie sous celle-ci. -->
            <LazyRoute
              path="/economy-setup"
              load={() => import("./pages/EconomyQuickSetup.svelte")}
            />
            <LazyRoute
              path="/economy/*"
              load={() => import("./pages/Economy.svelte")}
            />
            <LazyRoute
              path="/giveaways/*"
              load={() => import("./pages/Giveaways.svelte")}
            />
            <LazyRoute
              path="/welcome/*"
              load={() => import("./pages/Announcement.svelte")}
            />
            <LazyRoute
              path="/announcement/*"
              load={() => import("./pages/Announcement.svelte")}
            />
            <LazyRoute
              path="/reaction-roles"
              load={() => import("./pages/ReactionRoles.svelte")}
            />
            <LazyRoute
              path="/triggers"
              load={() => import("./pages/Triggers.svelte")}
            />
            <!-- Redirections des URL d'avant la refonte securite. Un seul
                 <Route> par prefixe : `resolveSecurityRedirect` reporte les
                 segments d'onglet eventuels sur la nouvelle adresse. -->
            {#each LEGACY_SECURITY_PATHS as legacyPath (legacyPath)}
              <Route path="{legacyPath}/*">
                <div use:navigate={resolveSecurityRedirect($router.path) ?? "/security"}></div>
              </Route>
              <Route path={legacyPath}>
                <div use:navigate={resolveSecurityRedirect(legacyPath) ?? "/security"}></div>
              </Route>
            {/each}
            <LazyRoute
              path="/suggestions"
              load={() => import("./pages/Suggestions.svelte")}
            />
            <LazyRoute
              path="/starboard"
              load={() => import("./pages/Starboard.svelte")}
            />
            <LazyRoute
              path="/embed-builder"
              load={() => import("./pages/EmbedBuilder.svelte")}
            />
            <LazyRoute
              path="/fun"
              load={() => import("./pages/FunSettings.svelte")}
            />
            <LazyRoute
              path="/clans"
              load={() => import("./pages/Clans.svelte")}
            />
            <LazyRoute
              path="/drops"
              load={() => import("./pages/Drops.svelte")}
            />

            <LazyRoute
              path="/invitations/:code"
              load={() => import("./pages/InvitationDetail.svelte")}
              props={(meta) => ({ code: meta.params.code })}
              remountKey={(meta) => meta.params.code}
            />
            <LazyRoute
              path="/invitations/*"
              load={() => import("./pages/Invitations.svelte")}
            />

            <LazyRoute
              path="/events"
              load={() => import("./pages/Events.svelte")}
            />
            <LazyRoute
              path="/events/edit/:eventId"
              load={() => import("./pages/EventEditor.svelte")}
              props={(meta) => ({ eventId: meta.params.eventId })}
            />
            <LazyRoute
              path="/events/control/:eventId"
              load={() => import("./pages/EventControl.svelte")}
              props={(meta) => ({ eventId: meta.params.eventId })}
            />

            <LazyRoute
              path="/userSettings/*"
              load={() => import("./pages/UserSettings.svelte")}
            />

            <!-- Fallback for authenticated users -->
            <Route fallback>
              <NotFound />
            </Route>
          </MainLayout>
        {/if}
      {:else if $router.path !== "/login"}
        <!-- Fallback for unauthenticated users -->
        <Route path="/*">
          <div class="flex items-center justify-center min-h-screen">
            <div
              class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"
            ></div>
          </div>
        </Route>
      {/if}
    {/if}

    {#snippet failed(error)}
      <GlobalErrorOverlay
        errorMsg={error instanceof Error ? error.message : String(error)}
        errorStack={error instanceof Error ? error.stack : undefined}
      />
    {/snippet}
  </svelte:boundary>
{/if}

<ToastContainer />
<GlobalConfirmDialog />
<CommandPalette />

{#if inviteDetailsModal.open}
  {#await import("./lib/components/invitations/InviteDetailsModal.svelte") then module}
    {@const InviteDetailsModal = module.default}
    <InviteDetailsModal />
  {/await}
{/if}

{#if channelDetailsModal.open}
  {#await import("./lib/components/channels/ChannelDetailsModal.svelte") then module}
    {@const ChannelDetailsModal = module.default}
    <ChannelDetailsModal />
  {/await}
{/if}

{#if feedbackModal.open}
  {#await import("./lib/components/FeedbackModal.svelte") then module}
    {@const FeedbackModal = module.default}
    <FeedbackModal />
  {/await}
{/if}

{#if showKeyboardShortcuts}
  {#await import("./lib/components/KeyboardShortcutsModal.svelte") then module}
    {@const KeyboardShortcutsModal = module.default}
    <KeyboardShortcutsModal
      isOpen={showKeyboardShortcuts}
      onClose={() => showKeyboardShortcuts = false}
    />
  {/await}
{/if}
