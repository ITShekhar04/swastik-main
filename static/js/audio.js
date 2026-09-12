/**
 * SWASTIK / SPECTRA-X: Synthesized Tactical Audio System
 * Uses HTML5 Web Audio API to create authentic radar sweep blips,
 * alert klaxons, and tactical confirmation chirps without external audio files.
 */
class TacticalAudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.6;
    this.lastAlertTime = 0;
    this.alertCooldownMs = 3500;
  }

  _initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setVolume(val) {
    this.volume = Math.max(0.0, Math.min(1.0, parseFloat(val)));
  }

  toggleMute() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  playRadarBlip() {
    if (!this.enabled || this.volume <= 0.01) return;
    try {
      this._initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, this.ctx.currentTime + 0.04);
      
      gain.gain.setValueAtTime(this.volume * 0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch (e) {
      console.warn("Audio blip error", e);
    }
  }

  playAlertKlaxon() {
    const now = Date.now();
    if (!this.enabled || (now - this.lastAlertTime < this.alertCooldownMs)) return;
    this.lastAlertTime = now;

    try {
      this._initContext();
      if (!this.ctx) return;

      // Two-tone warble beep
      const t0 = this.ctx.currentTime;
      [0, 0.18].forEach((delay) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(750, t0 + delay);
        osc.frequency.exponentialRampToValueAtTime(520, t0 + delay + 0.12);

        gain.gain.setValueAtTime(this.volume * 0.35, t0 + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + delay + 0.14);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t0 + delay);
        osc.stop(t0 + delay + 0.15);
      });
    } catch (e) {
      console.warn("Alert audio error", e);
    }
  }

  playChirp() {
    if (!this.enabled || this.volume <= 0.01) return;
    try {
      this._initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(2400, this.ctx.currentTime + 0.03);
      
      gain.gain.setValueAtTime(this.volume * 0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (e) {
      // Ignored
    }
  }
}

window.tacticalAudio = new TacticalAudioSystem();
