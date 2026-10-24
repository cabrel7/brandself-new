---
managed-by: claude-system-v5
name: ffmpeg
description: Utiliser pour manipuler vidéo/audio avec FFmpeg (déjà installé) — extraction de frames pour analyser un bug visuel depuis un screencast, compression, conversion, optimisation web, GIF de démo.
---

# FFmpeg — vidéo/audio en ligne de commande

## video-debug : analyser un bug UI depuis un screencast
```bash
# Extraire 1 frame/seconde d'un enregistrement pour inspecter un bug visuel
ffmpeg -i bug.mp4 -vf fps=1 frames/frame_%03d.png
# Extraire uniquement les frames où l'image change (scènes) — cible le moment du bug
ffmpeg -i bug.mp4 -vf "select='gt(scene,0.1)',showinfo" -vsync vfr frames/change_%03d.png
# Frame à un instant précis
ffmpeg -ss 00:00:07 -i bug.mp4 -frames:v 1 moment.png
```
Puis lis les PNG extraits pour analyser le rendu au moment du bug.

## Optimisation web
```bash
# MP4 web-friendly (H.264, faststart pour streaming progressif)
ffmpeg -i in.mov -c:v libx264 -crf 23 -preset medium -movflags +faststart -c:a aac out.mp4
# WebM (VP9) plus léger
ffmpeg -i in.mp4 -c:v libvpx-vp9 -crf 32 -b:v 0 -c:a libopus out.webm
# Réduire la résolution
ffmpeg -i in.mp4 -vf "scale=1280:-2" out_720.mp4
```

## GIF de démo (léger)
```bash
ffmpeg -i demo.mp4 -vf "fps=12,scale=720:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i demo.mp4 -i palette.png -vf "fps=12,scale=720:-1:flags=lanczos,paletteuse" demo.gif
```

## Audio / infos
```bash
ffprobe -v quiet -print_format json -show_format -show_streams in.mp4   # métadonnées JSON
ffmpeg -i in.mp4 -vn -c:a libmp3lame -q:a 2 out.mp3                     # extraire l'audio
```

## Règles
- `-crf` : 18 (haute qualité) → 28 (compressé). 23 = bon défaut.
- Toujours `-movflags +faststart` pour une vidéo servie sur le web.
- Vérifie la sortie avec `ffprobe` avant de livrer.
