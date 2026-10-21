// Hype Inc. sound module. No dependencies. Web Audio API.
//
//   import { Sound } from "./sound/sound.js";
//   const sound = new Sound({ base: "./sound/" });
//   sound.load();                 // start early, it does not need a tap
//   sound.music("music_menu");    // starts after the first tap
//   sound.play("bubble_pop", { pitchVariance: 0.1 });
//
// iOS and Safari rules this module handles:
// - Audio stays locked until the first tap or key press. The module listens
//   for that and unlocks by itself. Music you ask for before that starts then.
// - iOS can put audio in an "interrupted" state (phone call, Siri, app
//   switch). The module resumes on the next tap or when the page is visible.
// - Audio stops while the page is hidden and resumes when it is visible.
// - navigator.audioSession (Safari 17+): "ambient" by default, so the ring /
//   silent switch mutes the game and other apps (music, podcasts) keep
//   playing. Use { session: "playback" } to ignore the silent switch.

const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "click", "keydown"];
const ONSET_LEVEL = 0.001; // -60 dBFS. Codec padding before this is skipped.

export class Sound {
  /**
   * @param {object} [opts]
   * @param {string} [opts.base] Folder that holds sounds.json and audio/.
   * @param {string} [opts.manifest] Manifest file name in base.
   * @param {string|null} [opts.storageKey] localStorage key for settings, null to skip.
   * @param {"ambient"|"playback"|null} [opts.session] iOS audio session type, null to leave as is.
   */
  constructor(opts = {}) {
    this.base = (opts.base ?? "./sound/").replace(/\/?$/, "/");
    this.manifestName = opts.manifest ?? "sounds.json";
    this.storageKey = opts.storageKey === undefined ? "hypeinc.sound" : opts.storageKey;
    this.session = opts.session === undefined ? "ambient" : opts.session;

    this.settings = { muted: false, master: 1, sfx: 0.9, music: 0.55 };
    this._readSettings();

    this.manifest = null;
    this.buffers = new Map(); // name -> { buffer, offset }
    this.voices = new Map(); // name -> [{ src, at }]
    this.wantedMusic = null; // track the game asked for
    this.current = null; // { name, src, gain }
    this.loaded = null;
    this.ctx = null;
    this._resuming = false;

    this._onGesture = this._onGesture.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  /** True after the first tap has unlocked audio. */
  get unlocked() {
    return !!this.ctx && this.ctx.state === "running";
  }

  get muted() {
    return this.settings.muted;
  }

  set muted(value) {
    this.settings.muted = !!value;
    this._applyVolumes();
    this._saveSettings();
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  /**
   * @param {"master"|"sfx"|"music"} bus
   * @param {number} value 0 to 1
   */
  setVolume(bus, value) {
    this.settings[bus] = Math.min(1, Math.max(0, Number(value) || 0));
    this._applyVolumes();
    this._saveSettings();
  }

  getVolume(bus) {
    return this.settings[bus];
  }

  /** Fetch and decode all sounds. Safe to call more than once. */
  load() {
    if (this.loaded) return this.loaded;
    this._setup();
    this.loaded = (async () => {
      const res = await fetch(this.base + this.manifestName);
      if (!res.ok) throw new Error(`sound: cannot load ${this.manifestName} (${res.status})`);
      this.manifest = await res.json();
      const sfx = Object.entries(this.manifest.sfx);
      const music = Object.entries(this.manifest.music);
      // Effects first, so taps have sound as soon as possible.
      await Promise.all(sfx.map(([name, s]) => this._loadOne(name, s.file, true)));
      await Promise.all(music.map(([name, m]) => this._loadOne(name, m.file, false)));
      if (this.wantedMusic && !this.current) this._startMusic(this.wantedMusic, 1.0);
    })();
    return this.loaded;
  }

  /**
   * Play a sound effect. Does nothing while audio is locked or the sound
   * is not loaded yet.
   * @param {string} name
   * @param {object} [o]
   * @param {number} [o.volume] 0 to 1, on top of the sound's own volume.
   * @param {number} [o.rate] Playback rate. 1 is normal, 2 is an octave up.
   * @param {number} [o.pitchVariance] Random rate change, for example 0.1 = +-10%.
   * @param {number} [o.delay] Seconds from now.
   */
  play(name, o = {}) {
    // While a tap is unlocking audio, play anyway: the sound starts as soon
    // as the unlock is done, so the very first tap is not silent.
    if (!(this.unlocked || this._resuming) || this.settings.muted) return;
    const entry = this.buffers.get(name);
    const meta = this.manifest?.sfx[name];
    if (!entry || !meta) return;

    const now = this.ctx.currentTime;
    const list = (this.voices.get(name) ?? []).filter((v) => v.alive);
    // The same sound many times in the same instant only adds noise.
    if (list.length && now - list[list.length - 1].at < (meta.minGap ?? 0.03)) return;
    const maxVoices = meta.maxVoices ?? 4;
    while (list.length >= maxVoices) {
      const old = list.shift();
      try { old.src.stop(); } catch { /* already stopped */ }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = entry.buffer;
    const variance = o.pitchVariance ?? 0;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * variance);
    const gain = this.ctx.createGain();
    gain.gain.value = (meta.volume ?? 1) * (o.volume ?? 1);
    src.connect(gain).connect(this.sfxBus);

    const voice = { src, at: now, alive: true };
    src.onended = () => { voice.alive = false; gain.disconnect(); };
    list.push(voice);
    this.voices.set(name, list);
    src.start(now + (o.delay ?? 0), entry.offset);
  }

  /**
   * Switch the music. Cross-fades from the current track.
   * @param {string|null} name Track name, or null for silence.
   * @param {object} [o]
   * @param {number} [o.fade] Fade time in seconds.
   */
  music(name, o = {}) {
    const fade = o.fade ?? 1.0;
    this.wantedMusic = name;
    if (this.current?.name === name) return;
    this._stopMusic(fade);
    if (name && (this.unlocked || this._resuming) && this.buffers.has(name)) this._startMusic(name, fade);
  }

  /** Lower the music for a moment, for example under the win fanfare. */
  duck(amount = 0.3, seconds = 2.5) {
    if (!this.current || !this.unlocked) return;
    const g = this.current.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.15);
    g.setValueAtTime(amount, t + seconds);
    g.linearRampToValueAtTime(1, t + seconds + 0.8);
  }

  // ------------------------------------------------------------ internals

  _setup() {
    if (this.ctx) return;
    if (this.session && typeof navigator !== "undefined" && navigator.audioSession) {
      try { navigator.audioSession.type = this.session; } catch { /* not allowed */ }
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.masterBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.sfxBus.connect(this.masterBus);
    this.musicBus.connect(this.masterBus);
    this.masterBus.connect(this.ctx.destination);
    this._applyVolumes();

    this.ctx.onstatechange = () => {
      if (this.ctx.state === "running") this._afterUnlock();
      else if (!document.hidden) this._armUnlock();
    };
    document.addEventListener("visibilitychange", this._onVisibility);
    if (this.ctx.state === "running") this._afterUnlock();
    else this._armUnlock();
  }

  _armUnlock() {
    for (const e of UNLOCK_EVENTS) document.addEventListener(e, this._onGesture, { capture: true, passive: true });
  }

  _disarmUnlock() {
    for (const e of UNLOCK_EVENTS) document.removeEventListener(e, this._onGesture, { capture: true });
  }

  _onGesture() {
    if (!this.ctx || document.hidden) return;
    if (this.ctx.state !== "running") {
      // Must run inside the gesture. A silent buffer helps older iOS.
      const p = this.ctx.resume();
      this._resuming = true;
      const done = () => { this._resuming = false; };
      p?.then?.(done, done);
      const silent = this.ctx.createBufferSource();
      silent.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      silent.connect(this.ctx.destination);
      silent.start(0);
      p?.then?.(() => this.ctx.state === "running" && this._afterUnlock()).catch(() => {});
    } else {
      this._afterUnlock();
    }
  }

  _afterUnlock() {
    this._disarmUnlock();
    if (this.wantedMusic && !this.current && this.buffers.has(this.wantedMusic)) {
      this._startMusic(this.wantedMusic, 1.0);
    }
  }

  _onVisibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      if (this.ctx.state === "running") this.ctx.suspend().catch(() => {});
    } else {
      // Works on most browsers. If iOS says no, the next tap unlocks again.
      this.ctx.resume().catch(() => {});
      if (this.ctx.state !== "running") this._armUnlock();
    }
  }

  async _loadOne(name, file, trimLead) {
    try {
      const res = await fetch(this.base + file);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.arrayBuffer();
      const buffer = await new Promise((ok, fail) => {
        const p = this.ctx.decodeAudioData(data, ok, fail);
        if (p && p.then) p.then(ok, fail);
      });
      this.buffers.set(name, { buffer, offset: trimLead ? onset(buffer) : 0 });
    } catch (err) {
      console.warn(`sound: cannot load ${file}`, err);
    }
  }

  _startMusic(name, fade) {
    const meta = this.manifest.music[name];
    const { buffer } = this.buffers.get(name);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    // The file holds the loop plus its first second again. Looping inside
    // the file (not at its edges) keeps the loop seamless, even when the
    // decoder adds silence at the start or end of the MP3.
    src.loop = true;
    src.loopStart = meta.loopStart;
    src.loopEnd = meta.loopStart + meta.loopSeconds;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + Math.max(0.05, fade));
    src.connect(gain).connect(this.musicBus);
    src.start(t);
    this.current = { name, src, gain, startedAt: t };
  }

  _stopMusic(fade) {
    if (!this.current) return;
    const { src, gain } = this.current;
    this.current = null;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    src.stop(t + Math.max(0.05, fade) + 0.05);
    src.onended = () => gain.disconnect();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.masterBus.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.02);
    this.musicBus.gain.setTargetAtTime(s.music, t, 0.02);
  }

  _readSettings() {
    if (!this.storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || "null");
      if (saved) Object.assign(this.settings, saved);
    } catch { /* private mode or blocked storage */ }
  }

  _saveSettings() {
    if (!this.storageKey) return;
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }
}

/** Seconds of near-silence at the start (codec padding). */
function onset(buffer) {
  const data = buffer.getChannelData(0);
  const max = Math.min(data.length, Math.floor(buffer.sampleRate * 0.2));
  for (let i = 0; i < max; i++) {
    if (Math.abs(data[i]) > ONSET_LEVEL) return Math.max(0, i / buffer.sampleRate - 0.001);
  }
  return 0;
}
