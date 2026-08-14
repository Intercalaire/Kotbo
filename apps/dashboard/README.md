# Dashboard Kotbo

Dashboard Svelte 5 et Vite du monorepo Kotbo. Les commandes doivent de préférence être lancées depuis la racine du dépôt après `bun install` et la configuration du fichier `.env`.

```bash
bun dev:dashboard                              # Serveur de développement
bun build:dashboard                            # Build de production
bun lint:dashboard                             # ESLint
bun run --filter @kotbo/dashboard check        # Typecheck Svelte
```

Le dashboard lit notamment `VITE_API_URL` depuis le `.env` de la racine. Par défaut, l'API locale du bot est attendue sur `http://localhost:8787` et Vite sert le dashboard sur `http://localhost:5173`.

Les fichiers de traduction dans `src/lib/paraglide` sont générés et ne doivent pas être versionnés. Vite les génère pendant `dev` et `build`; pour un typecheck isolé sur un checkout propre, lancez d'abord :

```bash
bun run --filter @kotbo/dashboard build:i18n
```
