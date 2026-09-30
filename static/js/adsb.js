/**
 * SWASTIK: Live ADS-B Commercial Aircraft Tracking Module
 * Passive civilian aircraft tracking via OpenSky Network REST API.
 * Integrates directly into SWASTIK Mission Control Tactical Radar HUD.
 */
class ADSBController {
  constructor() {
    this.enabled = true;
    this.syntheticRFEnabled = true;
    this.mode = 'live'; // 'live' | 'demo'
    this.locationKey = 'delhi';
    this.customLat = 28.5562;
    this.customLon = 77.1000;
    this.radiusKm = 100;
    
    this.aircraft = [];
    this.selectedAircraft = null;
    this.status = 'CONNECTING';
    this.statusText = 'ADS-B CONNECTING...';
    this.lastUpdateTime = null;
    this.pollIntervalMs = 20000; // 20 seconds polling to respect OpenSky rate limits
    this.pollTimer = null;
    this.tickTimer = null;

    this.presets = {
      delhi: { name: 'Delhi (IGI Airport - VIDP)', lat: 28.5562, lon: 77.1000 },
      mumbai: { name: 'Mumbai (CSIA - VABB)', lat: 19.0896, lon: 72.8656 },
      bengaluru: { name: 'Bengaluru (KIA - VOBL)', lat: 13.1986, lon: 77.7066 },
      hyderabad: { name: 'Hyderabad (RGIA - VOHS)', lat: 17.2403, lon: 78.4294 },
      bhopal: { name: 'Bhopal (Raja Bhoj - VABP)', lat: 23.2875, lon: 77.3378 },
      indore: { name: 'Indore (Devi Ahilyabai - VAID)', lat: 22.7218, lon: 75.8011 },
      custom: { name: 'Custom Coordinates...', lat: 28.5562, lon: 77.1000 }
    };
  }

  init() {
    this._bindEvents();
    this.fetchAircraft();
    this._startPolling();
    this._startSecondTicker();
  }

  _bindEvents() {
    // Aircraft selected hook from radar.js
    window.onAircraftSelected = (aircraft) => {
      this.selectedAircraft = aircraft;
      this.renderSelectedAircraftPanel();
      if (window.swastikAudio && window.swastikAudio.playChirp) {
        window.swastikAudio.playChirp();
      }
    };

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      this.destroy();
    });
  }

  _startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.enabled) {
        this.fetchAircraft(true);
      }
    }, this.pollIntervalMs);
  }

  _startSecondTicker() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      this._updateTimeElapsedLabel();
    }, 1000);
  }

  destroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  async fetchAircraft(isBackground = false) {
    if (!isBackground) {
      this._setStatus('CONNECTING', 'ADS-B CONNECTING...');
    }

    try {
      let url = `/api/adsb/aircraft?mode=${this.mode}&radius_km=${this.radiusKm}`;
      if (this.locationKey === 'custom') {
        url += `&lat=${this.customLat}&lon=${this.customLon}`;
      } else {
        url += `&location=${this.locationKey}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      this.aircraft = data.aircraft || [];
      this.lastUpdateTime = Date.now();

      if (this.mode === 'demo') {
        this._setStatus('DEMO', 'DEMO ADS-B DATA (SIMULATED)');
      } else if (data.status === 'RATE_LIMITED' || data.status === 'API_RATE_LIMIT') {
        this._setStatus('RATE_LIMITED', 'ADS-B LIVE ● (RATE LIMITED - CACHED)');
      } else if (data.status === 'OFFLINE' || data.status === 'OFFLINE_CACHED') {
        this._setStatus('OFFLINE', 'ADS-B OFFLINE (FALLBACK ACTIVE)');
      } else if (this.aircraft.length === 0) {
        this._setStatus('NO_AIRCRAFT', 'NO AIRCRAFT DETECTED');
      } else {
        this._setStatus('LIVE', 'ADS-B LIVE ●');
      }

      this._syncToRadar();
      this.renderControls();
      
      // Auto-select first aircraft if none selected
      if (!this.selectedAircraft && this.aircraft.length > 0) {
        this.selectedAircraft = this.aircraft[0];
      }
      this.renderSelectedAircraftPanel();

    } catch (err) {
      console.warn('[ADSB] Fetch error (graceful fallback active):', err);
      if (this.aircraft.length === 0) {
        this._setStatus('OFFLINE', 'ADS-B OFFLINE');
      } else {
        this._setStatus('OFFLINE', 'ADS-B LIVE ● (CACHED DATA)');
      }
      this.renderControls();
    }
  }

  _setStatus(code, text) {
    this.status = code;
    this.statusText = text;
  }

  _syncToRadar() {
    const listToRender = this.enabled ? this.aircraft : [];
    if (window.radarHUD) {
      window.radarHUD.showSyntheticRF = this.syntheticRFEnabled;
      window.radarHUD.showADSBLayer = this.enabled;
      window.radarHUD.updateADSBAircraft(listToRender);
    }
    if (window.trackingRadarHUD) {
      window.trackingRadarHUD.showSyntheticRF = this.syntheticRFEnabled;
      window.trackingRadarHUD.showADSBLayer = this.enabled;
      window.trackingRadarHUD.updateADSBAircraft(listToRender);
    }
  }

  toggleLayer(layerName, isChecked) {
    if (layerName === 'adsb') {
      this.enabled = isChecked;
      if (this.enabled && this.aircraft.length === 0) {
        this.fetchAircraft();
      }
    } else if (layerName === 'synthetic') {
      this.syntheticRFEnabled = isChecked;
    }
    this._syncToRadar();
    this.renderControls();
  }

  toggleMode(newMode) {
    this.mode = newMode || (this.mode === 'live' ? 'demo' : 'live');
    this.fetchAircraft();
  }

  setLocation(locKey, customLat, customLon) {
    this.locationKey = locKey;
    if (locKey === 'custom' && customLat && customLon) {
      this.customLat = Number(customLat) || this.customLat;
      this.customLon = Number(customLon) || this.customLon;
    }
    this.fetchAircraft();
  }

  setRange(radiusKm) {
    this.radiusKm = Number(radiusKm) || 100;
    if (window.radarHUD && window.radarHUD.setRangeKm) {
      window.radarHUD.setRangeKm(this.radiusKm);
    }
    if (window.trackingRadarHUD && window.trackingRadarHUD.setRangeKm) {
      window.trackingRadarHUD.setRangeKm(this.radiusKm);
    }
    this.fetchAircraft();
  }

  _updateTimeElapsedLabel() {
    const el = document.getElementById('adsb-last-update-text');
    if (!el) return;
    if (!this.lastUpdateTime) {
      el.textContent = 'Updated: --';
      return;
    }
    const sec = Math.floor((Date.now() - this.lastUpdateTime) / 1000);
    el.textContent = `Updated: ${sec}s ago`;
  }

  renderControls() {
    // 1. Status pill
    const statusPill = document.getElementById('adsb-status-pill');
    if (statusPill) {
      statusPill.textContent = this.statusText;
      statusPill.className = 'status-pill';
      if (this.status === 'LIVE') statusPill.classList.add('online');
      else if (this.status === 'DEMO') statusPill.classList.add('warning');
      else if (this.status === 'CONNECTING') statusPill.classList.add('active');
      else statusPill.classList.add('offline');
    }

    // 2. Count badge
    const countBadge = document.getElementById('adsb-count-badge');
    if (countBadge) {
      countBadge.textContent = `LIVE AIRCRAFT: ${String(this.aircraft.length).padStart(2, '0')}`;
    }

    // 3. Mode switch button text
    const modeBtn = document.getElementById('adsb-mode-toggle-btn');
    if (modeBtn) {
      if (this.mode === 'demo') {
        modeBtn.innerHTML = '🧪 MODE: <strong style="color: #ffaa00;">DEMO (SIMULATED)</strong>';
        modeBtn.classList.add('btn-gold');
      } else {
        modeBtn.innerHTML = '🌐 MODE: <strong style="color: #00ff88;">LIVE ADS-B</strong>';
        modeBtn.classList.remove('btn-gold');
      }
    }

    // 4. Center Coordinates readout
    const centerReadout = document.getElementById('adsb-center-readout');
    if (centerReadout) {
      const preset = this.presets[this.locationKey] || this.presets.delhi;
      const lat = (this.locationKey === 'custom') ? this.customLat : preset.lat;
      const lon = (this.locationKey === 'custom') ? this.customLon : preset.lon;
      centerReadout.textContent = `Center: ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E | Radius: ${this.radiusKm} km`;
    }
  }

  renderSelectedAircraftPanel() {
    const a = this.selectedAircraft;
    const panel = document.getElementById('adsb-contact-panel');
    if (!panel) return;

    if (!a) {
      panel.innerHTML = `
        <div style="color: #64748b; font-family: monospace; font-size: 0.75rem; padding: 12px; text-align: center;">
          SELECT AN AIRCRAFT (✈) ON RADAR HUD TO VIEW ADS-B TELEMETRY
        </div>
      `;
      return;
    }

    const isDemoBadge = a.is_demo ? 
      '<span class="disclaimer-badge" style="background: rgba(255,170,0,0.2); color: #ffaa00; margin-left: 6px;">SIMULATED</span>' : 
      '<span class="disclaimer-badge" style="background: rgba(0,255,136,0.2); color: #00ff88; margin-left: 6px;">AUTHENTIC ADS-B</span>';

    panel.innerHTML = `
      <div style="background: rgba(5, 12, 24, 0.85); border: 1px solid #1e3a5f; border-radius: 4px; padding: 10px; font-family: monospace; font-size: 0.76rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e3a5f; padding-bottom: 6px; margin-bottom: 8px;">
          <div>
            <span style="color: #38bdf8; font-size: 1.05rem; font-weight: bold;">✈ ${a.callsign || 'N/A'}</span>
            ${isDemoBadge}
          </div>
          <span style="color: #94a3b8; font-size: 0.72rem;">ICAO24: <strong style="color: #fff;">${a.id || 'N/A'}</strong></span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
          <div class="data-row">
            <span class="data-label">ORIGIN:</span>
            <span class="data-value highlight-cyan">${a.country || 'N/A'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">STATUS:</span>
            <span class="data-value ${a.on_ground ? 'highlight-amber' : 'highlight-green'}">${a.status || 'N/A'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">ALTITUDE:</span>
            <span class="data-value highlight-green">${a.altitude_label || 'N/A'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">GROUND SPEED:</span>
            <span class="data-value highlight-cyan">${a.speed_label || 'N/A'} (${a.speed_kmh ? a.speed_kmh + ' km/h' : 'N/A'})</span>
          </div>
          <div class="data-row">
            <span class="data-label">HEADING:</span>
            <span class="data-value">${a.heading_deg !== undefined ? a.heading_deg + '°' : 'N/A'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">VERTICAL RATE:</span>
            <span class="data-value highlight-amber">${a.vertical_rate_label || 'N/A'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">DISTANCE FROM CENTER:</span>
            <span class="data-value highlight-gold">${a.distance !== undefined ? a.distance.toFixed(1) + ' km' : 'N/A'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">BEARING:</span>
            <span class="data-value">${a.bearing_deg !== undefined ? a.bearing_deg + '°' : 'N/A'}</span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: #64748b; border-top: 1px solid rgba(30, 58, 95, 0.4); padding-top: 4px;">
          <span>GPS: ${a.latitude ? a.latitude.toFixed(4) : '--'}°N, ${a.longitude ? a.longitude.toFixed(4) : '--'}°E</span>
          <span>Contact: <strong style="color: #cbd5e1;">${a.last_contact || 'Recent'}</strong></span>
        </div>
      </div>
    `;
  }
}

// Global Singleton Instance
window.ADSB = new ADSBController();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.ADSB.init());
} else {
  window.ADSB.init();
}
