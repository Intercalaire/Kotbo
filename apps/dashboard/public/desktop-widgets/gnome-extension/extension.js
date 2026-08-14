// Kotbo - indicateur de barre supérieure GNOME Shell (stats staff)
//
// Config : ~/.config/kotbo-stats.json, format :
//   { "token": "wgt_...", "apiBase": "https://kotbo.fr" }
//
// Le token se trouve sur la page Widget du dashboard Kotbo, section
// « Widgets téléphone & PC ». C'est une clé en lecture seule.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CONFIG_PATH = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'kotbo-stats.json']);
const DEFAULT_API_BASE = 'https://kotbo.fr';
const REFRESH_SECONDS = 900;

const KotboIndicator = GObject.registerClass(
class KotboIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Kotbo Stats', false);

        this._label = new St.Label({
            text: 'Kotbo',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._statusItem = new PopupMenu.PopupMenuItem('Chargement…', { reactive: false });
        this.menu.addMenuItem(this._statusItem);

        this._detailItems = {
            messages: new PopupMenu.PopupMenuItem('', { reactive: false }),
            voice: new PopupMenu.PopupMenuItem('', { reactive: false }),
            score: new PopupMenu.PopupMenuItem('', { reactive: false }),
        };
        this.menu.addMenuItem(this._detailItems.messages);
        this.menu.addMenuItem(this._detailItems.voice);
        this.menu.addMenuItem(this._detailItems.score);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Rafraîchir');
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        const configItem = new PopupMenu.PopupMenuItem(`Config : ${CONFIG_PATH}`, { reactive: false });
        this.menu.addMenuItem(configItem);

        this._session = new Soup.Session();
        this._timeoutId = null;

        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _readConfig() {
        try {
            const file = Gio.File.new_for_path(CONFIG_PATH);
            const [ok, contents] = file.load_contents(null);
            if (!ok) return null;
            return JSON.parse(new TextDecoder('utf-8').decode(contents));
        } catch (e) {
            return null;
        }
    }

    _refresh() {
        const config = this._readConfig();
        if (!config || !config.token) {
            this._label.text = 'Kotbo';
            this._statusItem.label.text = `Configure ${CONFIG_PATH}`;
            return;
        }

        const apiBase = (config.apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
        const url = `${apiBase}/api/public/widget-data?token=${encodeURIComponent(config.token)}`;

        let message;
        try {
            message = Soup.Message.new('GET', url);
        } catch (e) {
            this._statusItem.label.text = 'URL invalide';
            return;
        }

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                if (message.get_status() !== Soup.Status.OK) {
                    this._statusItem.label.text = `Erreur API (${message.get_status()})`;
                    return;
                }
                const text = new TextDecoder('utf-8').decode(bytes.get_data());
                const stats = JSON.parse(text);

                this._label.text = `lvl ${stats.user.level} · ${stats.user.staffScore} pts`;
                this._statusItem.label.text = `${stats.server.name} - ${stats.user.staffRank}`;
                this._detailItems.messages.label.text = `Messages : ${stats.user.messageCount}`;
                this._detailItems.voice.label.text = `Vocal : ${stats.user.voiceMinutes} min`;
                this._detailItems.score.label.text = `Staff score : ${stats.user.staffScore} pts`;
            } catch (e) {
                this._statusItem.label.text = 'Erreur de connexion à Kotbo';
            }
        });
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        super.destroy();
    }
});

export default class KotboStatsExtension extends Extension {
    enable() {
        this._indicator = new KotboIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
