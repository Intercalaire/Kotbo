/** Rendu du markdown Discord en HTML. */
import { Guild } from 'discord.js';

export function formatChannelName(guild: { channels: { cache: Map<string, { id: string; name?: string }> } } | null, channelId: string | null): string {
  if (!channelId) return 'Aucun';
  const channel = guild?.channels.cache.get(channelId);
  return channel?.name ? `#${channel.name}` : `Salon ${channelId}`;
}

/**
 * Mentions Discord resolues en texte lisible, sans balise ni entite HTML.
 *
 * Les journaux et les messages archives repartent vers le dashboard tels
 * quels : c'est lui qui echappe et qui pose les liens. Toute mise en forme
 * appliquee ici ressortirait telle quelle a l'ecran, echappee une seconde
 * fois par le rendu.
 */
export function renderMentionsAsText(guild: Guild | null, content: string): string {
  if (!content) return content;

  return content
    .replace(/<@!?(\d+)>/g, (_match, id: string) => {
      const member = guild?.members.cache.get(id);
      return `@${member ? member.displayName || member.user.username : id}`;
    })
    .replace(/<#(\d+)>/g, (_match, id: string) => {
      const channel = guild?.channels.cache.get(id);
      return `#${channel?.name || id}`;
    })
    .replace(/<@&(\d+)>/g, (_match, id: string) => {
      const role = guild?.roles.cache.get(id);
      return `@${role?.name || id}`;
    });
}


export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function parseDiscordMarkdown(text: string, guild?: Guild | null): string {
  if (!text) return '';
  let escaped = escapeHtml(text);

  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/__(.*?)__/g, '<u>$1</u>');
  escaped = escaped.replace(/~~(.*?)~~/g, '<del>$1</del>');
  escaped = escaped.replace(/`(.*?)`/g, '<code class="px-1.5 py-0.5 rounded bg-zinc-800 font-mono text-sm">$1</code>');

  escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const safeLang = escapeHtml(lang || 'plaintext');
    const safeCode = escapeHtml(code);
    return `<pre class="p-3 my-2 rounded bg-zinc-800 font-mono text-sm overflow-x-auto"><code class="language-${safeLang}">${safeCode}</code></pre>`;
  });

  escaped = escaped.replace(/&lt;:([a-zA-Z0-9_]+):(\d+)&gt;/g, (_, name, id) => {
    const safeName = escapeHtml(name);
    const safeId = escapeHtml(id);
    return `<img class="inline-block h-[1.375em] w-auto align-middle mx-[0.15em]" src="https://cdn.discordapp.com/emojis/${safeId}.png?size=48&quality=lossless" alt=":${safeName}:" title=":${safeName}:" />`;
  });
  escaped = escaped.replace(/&lt;a:([a-zA-Z0-9_]+):(\d+)&gt;/g, (_, name, id) => {
    const safeName = escapeHtml(name);
    const safeId = escapeHtml(id);
    return `<img class="inline-block h-[1.375em] w-auto align-middle mx-[0.15em]" src="https://cdn.discordapp.com/emojis/${safeId}.gif?size=48&quality=lossless" alt=":${safeName}:" title=":${safeName}:" />`;
  });

  if (guild) {
    escaped = escaped.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
      const member = guild.members.cache.get(id);
      const user = guild.client.users.cache.get(id);
      const name = member?.displayName || user?.username || 'Utilisateur';
      const safeName = escapeHtml(name);
      return `<span class="font-semibold text-sky-400 px-1.5 py-0.5 bg-sky-500/10 rounded hover:bg-sky-500 hover:text-white transition-colors cursor-pointer">@${safeName}</span>`;
    });
    escaped = escaped.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
      const ch = guild.channels.cache.get(id);
      const safeName = escapeHtml(ch ? ch.name : 'salon-inconnu');
      return `<span class="font-semibold text-sky-400 px-1.5 py-0.5 bg-sky-500/10 rounded hover:bg-sky-500 hover:text-white transition-colors cursor-pointer">#${safeName}</span>`;
    });
    escaped = escaped.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
      const role = guild.roles.cache.get(id);
      const safeName = escapeHtml(role ? role.name : 'rôle-inconnu');
      return `<span class="font-semibold text-sky-400 px-1.5 py-0.5 bg-sky-500/10 rounded hover:bg-sky-500 hover:text-white transition-colors cursor-pointer">@${safeName}</span>`;
    });
  } else {
    escaped = escaped.replace(/&lt;@!?(\d+)&gt;/g, '<span class="font-semibold text-sky-400 px-1.5 py-0.5 bg-sky-500/10 rounded cursor-pointer">@Utilisateur</span>');
    escaped = escaped.replace(/&lt;#(\d+)&gt;/g, '<span class="font-semibold text-sky-400 px-1.5 py-0.5 bg-sky-500/10 rounded cursor-pointer">#salon</span>');
    escaped = escaped.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="font-semibold text-sky-400 px-1.5 py-0.5 bg-sky-500/10 rounded cursor-pointer">@Rôle</span>');
  }

  return escaped;
}

export function extractMediaUrls(content: string): { type: 'image' | 'video' | 'audio', url: string }[] {
  if (!content) return [];
  const urls: { type: 'image' | 'video' | 'audio', url: string }[] = [];
  const regex = /(https?:\/\/[^\s]+)/g;
  const matches = content.match(regex);
  if (matches) {
    for (const url of matches) {
      const cleanUrl = url.split('?')[0];
      if (/\.(gif|jpg|jpeg|png|webp)/i.test(cleanUrl)) {
        urls.push({ type: 'image', url });
      } else if (/\.(mp4|webm|mov|ogg)/i.test(cleanUrl)) {
        urls.push({ type: 'video', url });
      } else if (/\.(mp3|wav|ogg|flac|m4a)/i.test(cleanUrl)) {
        urls.push({ type: 'audio', url });
      } else if (/giphy\.com\/gifs\//i.test(cleanUrl)) {
        const parts = cleanUrl.split('-');
        const id = parts.at(-1);
        if (id) {
          urls.push({ type: 'image', url: `https://media.giphy.com/media/${id}/giphy.gif` });
        }
      }
    }
  }
  return urls;
}
