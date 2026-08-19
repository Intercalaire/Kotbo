import { router } from 'tinro';
import { API_BASE_URL } from '../api';

class AuthStore {
    // Compatibility marker for components that still gate requests on `token`.
    // It is never persisted and contains no credential.
    token = $state<string | null>(null);
    user = $state<any>(null);
    member = $state<any>(null);
    guilds = $state<any[]>([]);
    selectedGuildId = $state(localStorage.getItem('kotbo_guild_id') || null);
    loading = $state(true);
    initialized = $state(false);
    private initialization: Promise<void> | null = null;

    constructor() {
        this.initialization = this.initialize();
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initialization) return this.initialization;

        this.initialization = (async () => {
            this.loading = true;
            const legacyToken = localStorage.getItem('kotbo_token');
            localStorage.removeItem('kotbo_token');

            if (legacyToken) {
                await fetch(`${API_BASE_URL}/api/auth/migrate`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${legacyToken}` },
                }).catch(() => undefined);
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
                    credentials: 'include',
                    headers: { Accept: 'application/json' },
                });
                if (response.ok) {
                    const data = await response.json();
                    this.user = data.user;
                    if (this.user) {
                        // Mark authenticated as soon as the session is confirmed valid, so UI
                        // relying on isAuthenticated doesn't wait on the slower user/guilds calls.
                        this.token = 'cookie-session';
                    }
                    await Promise.all([this.fetchUser(), this.fetchGuilds()]);
                } else {
                    this.clearLocalSession();
                }
            } catch {
                this.clearLocalSession();
            } finally {
                this.initialized = true;
                this.loading = false;
            }
        })();

        return this.initialization;
    }

    // Kept for removal of legacy callback fragments. New authentication is
    // established exclusively by the HttpOnly session cookie.
    setToken(_token: string | null) {
        localStorage.removeItem('kotbo_token');
    }

    private clearLocalSession() {
        this.token = null;
        this.user = null;
        this.member = null;
        this.guilds = [];
        this.clearGuildSelection();
    }

    /**
     * La guilde selectionnee est persistee, mais elle n'appartient qu'a la
     * session qui l'a choisie. Sans cette purge, l'identifiant survivait a une
     * deconnexion : le compte suivant sur le meme navigateur repartait sur le
     * serveur du precedent, et `getGuildId` le reemettait tel quel tant que la
     * liste des guildes n'etait pas encore chargee.
     */
    private clearGuildSelection() {
        this.selectedGuildId = null;
        localStorage.removeItem('kotbo_guild_id');
    }

    async fetchUser() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/me`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            if (res.ok) {
                this.user = await res.json();
            } else {
                this.clearLocalSession();
            }
        } catch (err) {
            console.error('Fetch user error:', err);
        }
    }

    async fetchGuilds() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/guilds`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            if (res.ok) {
                const data = await res.json();
                this.guilds = Array.isArray(data?.guilds)
                    ? data.guilds.filter((guild: any) => guild.botPresent)
                    : [];
                if (this.guilds.length === 0) {
                    this.clearGuildSelection();
                } else if (!this.selectedGuildId || !this.guilds.some((guild) => guild.id === this.selectedGuildId)) {
                    this.setGuild(this.guilds[0].id);
                }
            }
        } catch (err) {
            console.error('Fetch guilds error:', err);
        }
    }

    setGuild(guildId: string) {
        this.selectedGuildId = guildId;
        localStorage.setItem('kotbo_guild_id', guildId);

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('kotbo-dashboard-refresh-request'));
        }
    }

    async logout() {
        try {
            await fetch(`${API_BASE_URL}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
        } finally {
            this.clearLocalSession();
            router.goto('/login');
        }
    }

    get isAuthenticated() {
        return !!this.token;
    }

    get currentGuild() {
        return this.guilds.find((guild: any) => guild.id === this.selectedGuildId) ?? null;
    }

    /**
     * Une guilde qu'on n'arrive pas a resoudre ne vaut pas autorisation.
     * `find` rend `undefined` aussi bien pour un serveur interdit que pour un
     * compte sans aucun serveur, et comparer ce `undefined` a `'none'` faisait
     * repondre "autorise" a qui n'avait acces a rien.
     *
     * Tant que la session n'est pas chargee la reponse reste permissive :
     * refuser pendant l'amorcage viderait la navigation a chaque
     * rafraichissement, avant meme que la liste des serveurs soit connue.
     */
    get hasGuildAccess() {
        if (!this.initialized) return true;
        const guild = this.currentGuild;
        return !!guild && guild.accessLevel !== 'none';
    }

    get isAdmin() {
        return this.currentGuild?.accessLevel === 'admin';
    }

    get isBotAdmin() {
        return !!this.user?.isBotAdmin;
    }
}

export const authStore = new AuthStore();
