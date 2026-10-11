/*
 * The notification tone.
 * Plays via native desktop audio (canberra-gtk-play / pw-play / paplay)
 * or falls back to Web Audio decoding.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const NAMES = ['message-new-instant', 'message'];
const PROFILES = ['stereo', ''];
const EXTENSIONS = { '.oga': 'audio/ogg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

const themeName = () => {
  try {
    return execFileSync('gsettings', ['get', 'org.gnome.desktop.sound', 'theme-name'],
                        { encoding: 'utf8', timeout: 2000 }).trim().replace(/^'|'$/g, '') ||
           'freedesktop';
  } catch (e) {
    return 'freedesktop';
  }
};

const dataDirs = () => {
  const dirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  const home = process.env.XDG_DATA_HOME ||
               path.join(process.env.HOME || '/root', '.local', 'share');
  return [home, ...dirs];
};

const find = () => {
  const themes = [...new Set([themeName(), 'freedesktop'])];
  for (const dir of dataDirs()) {
    for (const theme of themes) {
      for (const profile of PROFILES) {
        for (const name of NAMES) {
          for (const [ext, mime] of Object.entries(EXTENSIONS)) {
            const file = path.join(dir, 'sounds', theme, profile, name + ext);
            if (fs.existsSync(file)) return { file, mime, name };
          }
        }
      }
    }
  }
  return null;
};

let cached;

const tone = () => {
  if (cached !== undefined) return cached;
  cached = null;

  const hit = find();
  if (!hit) {
    console.warn('no notification sound found in the desktop sound theme');
    return cached;
  }

  try {
    const bytes = fs.readFileSync(hit.file);
    if (bytes.length && bytes.length < 2 * 1024 * 1024)
      cached = { data: bytes.toString('base64'), mime: hit.mime, file: hit.file, name: hit.name };
  } catch (e) {
    console.warn('could not read %s: %s', hit.file, e.message);
  }
  return cached;
};

// Play sound natively through Linux audio daemon
const playNative = () => {
  const hit = find();
  const file = hit ? hit.file : null;

  // Try canberra-gtk-play first (standard GNOME event sound player)
  try {
    const cp = spawn('canberra-gtk-play', ['-i', 'message-new-instant'], {
      detached: true,
      stdio: 'ignore'
    });
    cp.unref();
    return true;
  } catch (e) {}

  // Fallback to direct sound file players if canberra fails
  if (file && fs.existsSync(file)) {
    const players = [
      { cmd: 'pw-play', args: [file] },
      { cmd: 'paplay', args: [file] },
      { cmd: 'aplay', args: ['-q', file] }
    ];

    for (const p of players) {
      try {
        const cp = spawn(p.cmd, p.args, { detached: true, std: 'ignore' });
        cp.unref();
        return true;
      } catch (e) {}
    }
  }

  return false;
};

module.exports = { tone, playNative };
