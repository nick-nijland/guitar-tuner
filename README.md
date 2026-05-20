# 🎸 Guitar Tuner

A chromatic tuner for guitar, bass, and banjo — built with Angular 21, running entirely in the browser.

**Live app:** https://nick-nijland.github.io/guitar-tuner

## Features

- **Microphone-based pitch detection** using autocorrelation with parabolic interpolation
- **Guitar** — Standard, Half Step Down, D Standard, FACGCE tunings
- **Bass guitar** — Standard 4-string (E1–A1–D2–G2)
- **Banjo** — Open G (gDGBD)
- Visual needle gauge with flat / in-tune / sharp colour zones
- Installable as a PWA — works offline, adds to your home screen

## Install on iPhone

1. Open **https://nick-nijland.github.io/guitar-tuner** in Safari
2. Tap the share button → **Add to Home Screen**

## Run locally

Requires Node.js 24+.

```bash
npm install
npm start        # dev server at http://localhost:4200
npm run build    # production build
```

## How it works

The app captures audio via `getUserMedia`, runs autocorrelation on the raw time-domain samples each animation frame to find the fundamental period, then converts that to a frequency and matches it against the active string set. A 5-frame moving average smooths the needle. Bass strings (down to 41 Hz) are handled by using a 4096-sample buffer so periods that long fit within the analysis window.
