#!/usr/bin/env python3
"""Découpe un enregistrement continu en clips de captcha vocal.

Le bot énonce des codes dans un ordre aléatoire : il lui faut un fichier par
symbole pour les recombiner, là où une prise est un enregistrement continu où
les symboles se suivent, séparés par des silences.

Normalement lancé par le workflow Prepare Voice Captcha, qui découpe les quatre
prises de apps/bot/assets/captcha-voice/sources/ et commite le résultat. Cet
usage direct sert à mettre au point le découpage d'une prise récalcitrante.

Le numéro de variante doit figurer dans ACCEPTED_VARIANTS côté
voiceCaptchaService, sans quoi les clips produits seront ignorés à l'exécution.

Prérequis : pydub et ffmpeg. Pour éviter de les installer :

  docker run --rm -v "$PWD:/w" -w /w python:3.12-alpine sh -c \\
    "apk add --no-cache ffmpeg && pip install --no-cache-dir pydub && \\
     python scripts/decoupe-captcha-voice.py prise.mp3 apps/bot/assets/captcha-voice/fr 3"

Usage : decoupe-captcha-voice.py <audio> <dossier_sortie> <numero_variante>
        [--symboles ABCDEF] [--silence-min MS] [--seuil DBFS]
"""

import argparse
import os
import sys

from pydub import AudioSegment
from pydub.silence import detect_nonsilent

# Marge conservée autour de chaque segment : couper au ras du seuil de silence
# ampute l'attaque des consonnes et la fin des voyelles.
PAD_MS = 60
# Les clips sont enchaînés tels quels : sans niveau commun, le code s'entend
# en dents de scie d'un caractère à l'autre.
TARGET_PEAK_DBFS = -9.0
# Format consommé nativement par Discord, voir le NOTICE du pack.
SAMPLE_RATE, CHANNELS, BITRATE = 48000, 2, "48k"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audio", help="enregistrement continu (mp3, wav, ogg…)")
    parser.add_argument("sortie", help="dossier du pack, par exemple apps/bot/assets/captcha-voice/fr")
    parser.add_argument("variante", type=int, help="numéro de variante, à choisir libre")
    parser.add_argument("--symboles", default="ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                        help="symboles énoncés, dans l'ordre de la prise")
    parser.add_argument("--silence-min", type=int, default=400, help="durée minimale d'un silence, en ms")
    parser.add_argument("--seuil", type=float, default=-40.0, help="seuil de silence, en dBFS")
    args = parser.parse_args()

    # Un pack entierement remplace laisse son dossier absent du depot, git ne
    # versionnant pas les repertoires vides.
    os.makedirs(args.sortie, exist_ok=True)

    audio = AudioSegment.from_file(args.audio)
    segments = detect_nonsilent(audio, min_silence_len=args.silence_min, silence_thresh=args.seuil)

    # Une prise se termine souvent par du souffle ou une bribe en trop : on
    # tolère le surplus final, jamais le manque, qui décalerait tout le mapping.
    if len(segments) < len(args.symboles):
        print(f"Erreur : {len(segments)} segments détectés pour {len(args.symboles)} symboles attendus.",
              file=sys.stderr)
        print("Ajuste --seuil ou --silence-min, puis relance.", file=sys.stderr)
        return 1

    if len(segments) > len(args.symboles):
        surplus = len(segments) - len(args.symboles)
        print(f"{surplus} segment(s) en trop en fin de prise, ignoré(s).")

    for symbol, (start, end) in zip(args.symboles, segments):
        clip = audio[max(0, start - PAD_MS):min(len(audio), end + PAD_MS)]
        clip = clip.apply_gain(TARGET_PEAK_DBFS - clip.max_dBFS)
        clip = clip.set_frame_rate(SAMPLE_RATE).set_channels(CHANNELS)
        chemin = f"{args.sortie}/{symbol}-{args.variante}.ogg"
        clip.export(chemin, format="ogg", codec="libopus", bitrate=BITRATE)
        print(f"  {chemin}  {len(clip) / 1000:.2f}s")

    print(f"{len(args.symboles)} clips écrits dans {args.sortie}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
