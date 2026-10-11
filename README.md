# WhatsApp Desktop for Linux

<p align="center">
  <img src="data/icons/128/apps/whatsapp-desktop.png" alt="WhatsApp Desktop Logo" width="128" height="128">
</p>

<p align="center">
  <b>WhatsApp Web Desktop Client for Linux</b> — engineered specifically for modern Linux distributions with tray integration, native system notifications, custom fonts, advanced Arabic text support, and privacy shielding.
</p>

<p align="center">
  <a href="https://github.com/seotarek/whatsapp-desktop"><img alt="GitHub Repo" src="https://img.shields.io/badge/GitHub-seotarek%2Fwhatsapp--desktop-10b981"></a>
  <img alt="built on" src="https://img.shields.io/badge/built%20on-Electron%2040-22c55e">
  <img alt="license" src="https://img.shields.io/badge/license-GPL--3.0--or--later-64748b">
</p>

---

## Overview

**WhatsApp Desktop** loads `web.whatsapp.com` in a lightweight, sandboxed Electron container with full native desktop integration. It preserves user security and privacy without third-party proxy servers or reverse engineering.

### Key Features

- **System Tray Integration:** Runs silently in the system tray when the window is closed (`close-to-tray`). Never misses a message.
- **Flawless Arabic (BiDi) & English Alignment:** First-class bidirectional text engine. Automatically aligns mixed Arabic and English sentences accurately according to each paragraph's primary language.
- **Distinct System Notifications:** Delivers native system banners per incoming message with sender photo and quick action triggers.
- **Privacy Mode (Ctrl+Alt+P):** Instantly blurs messages, chats, and sensitive media when stepping away from the desk.
- **Custom Fonts & Scaling:** Distinct font configurations for Arabic and Latin text directly from system-installed fonts.
- **Hardware-Accelerated Smooth Scrolling:** Optimized rendering layers and smooth GPU composite acceleration.

---

## Installation & Build

### Requirements
- Node.js (>= 18)
- npm

### Running from source
```bash
git clone https://github.com/seotarek/whatsapp-desktop.git
cd whatsapp-desktop
npm install
npm start
```

---

## Author & Maintainer

Developed and maintained by **[Tarek (seotarek)](https://github.com/seotarek)**.

## License

This project is licensed under the **GNU General Public License v3.0 or later** - see the [LICENSE](LICENSE) file for details.
