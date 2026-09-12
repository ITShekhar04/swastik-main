/**
 * SWASTIK / SPECTRA-X: Main Application Client Controller
 * Orchestrates WebSocket telemetry, canvas managers, Chart.js graphs,
 * tab routing, Smart Scan Demo scenario execution, and user controls.
 */

let radarHUD = null;
let waterfallCanvas = null;
let cameraController = null;

// Chart instances
let dspWaveformChart = null;
let dspFftChart = null;
let camFluctuationChart = null;
let analyticsBenchmarkChart = null;
let schedulerReasonChart = null;

// WebSocket connection
let ws = null;
let currentTelemetry = null;

document.addEventListener('DOMContentLoaded', () => {
  initTacticalTabs();
  initAudioControls();
  initRadarAndWaterfall();
  initCameraController();
  initDSPCharts();
  initCamFluctuationChart();
  initAnalyticsCharts();
  initSchedulerReasonChart();
  initControls();
  connectWebSocket();
  fetchDopplerArchetypes();
  initDopplerInteractiveSuite();
});

/* ==========================================================================
   Tab Navigation
   ========================================================================== */
window.switchTabDirect = function(targetId) {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(b => {
    if (b.getAttribute('data-tab') === targetId) b.classList.add('active');
    else b.classList.remove('active');
  });

  tabPanes.forEach(p => {
    if (p.id === targetId) p.classList.add('active');
    else p.classList.remove('active');
  });

  if (window.tacticalAudio) window.tacticalAudio.playChirp();

  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
    if (dspWaveformChart) dspWaveformChart.resize();
    if (analyticsBenchmarkChart) analyticsBenchmarkChart.resize();
    if (camFluctuationChart) camFluctuationChart.resize();
    if (targetId === 'tab-doppler' && typeof renderDopplerFrame === 'function') {
      renderDopplerFrame();
    }
    if (targetId === 'tab-tracking' && typeof redrawDopplerArchetypesMiniCanvases === 'function') {
      redrawDopplerArchetypesMiniCanvases();
    }
  }, 50);
};

function initTacticalTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      if (targetId) window.switchTabDirect(targetId);
    });
  });
}

/* ==========================================================================
   Audio Controls
   ========================================================================== */
function initAudioControls() {
  const muteBtn = document.getElementById('btn-toggle-mute');
  const volSlider = document.getElementById('audio-volume-slider');
  const testBtn = document.getElementById('btn-test-alert-sound');

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      const isEnabled = window.tacticalAudio.toggleMute();
      muteBtn.textContent = isEnabled ? "🔊 AUDIO: ON" : "🔇 AUDIO: MUTED";
      muteBtn.classList.toggle('btn-danger', !isEnabled);
    });
  }

  if (volSlider) {
    volSlider.addEventListener('input', (e) => {
      window.tacticalAudio.setVolume(e.target.value);
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', () => {
      window.tacticalAudio.playAlertKlaxon();
    });
  }
}

/* ==========================================================================
   Radar & Waterfall Canvases
   ========================================================================== */
function initRadarAndWaterfall() {
  radarHUD = new TacticalRadarHUD('mission-radar-canvas');
  waterfallCanvas = new SpectrumWaterfallCanvas('spectrum-waterfall-canvas');
  
  // Secondary radar for Tracking tab if present
  if (document.getElementById('tracking-radar-canvas')) {
    window.trackingRadarHUD = new TacticalRadarHUD('tracking-radar-canvas');
  }
  // Dedicated radar for Live Camera Radar tab if present
  if (document.getElementById('camera-radar-canvas')) {
    window.cameraRadarHUD = new TacticalRadarHUD('camera-radar-canvas');
  }
}

/* ==========================================================================
   Camera Radar Controller
   ========================================================================== */
function initCameraController() {
  cameraController = new LiveCameraRadarController();
}

/* ==========================================================================
   WebSocket Live Stream
   ========================================================================== */
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket connected to SWASTIK live telemetry.");
    const statusPill = document.getElementById('system-online-pill');
    if (statusPill) {
      statusPill.className = "status-pill online";
      statusPill.innerHTML = '<span class="dot"></span> SYSTEM ONLINE';
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      currentTelemetry = data;
      renderLiveTelemetry(data);
    } catch (err) {
      console.error("WS telemetry parse error:", err);
    }
  };

  ws.onclose = () => {
    console.warn("WebSocket disconnected. Reconnecting in 2.5s...");
    const statusPill = document.getElementById('system-online-pill');
    if (statusPill) {
      statusPill.className = "status-pill warning";
      statusPill.innerHTML = '<span class="dot"></span> RECONNECTING';
    }
    setTimeout(connectWebSocket, 2500);
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };
}

/* ==========================================================================
   Render Live Telemetry to HUD
   ========================================================================== */
function renderLiveTelemetry(data) {
  // 1. Top Header Indicators
  const latencyEl = document.getElementById('header-latency');
  const confEl = document.getElementById('header-confidence');
  if (latencyEl) latencyEl.textContent = `${data.processing_latency_ms} ms`;
  if (confEl) confEl.textContent = `${Math.round(data.ai_confidence * 100)}%`;

  // 2. Demo Step Badge
  const demoBadge = document.getElementById('demo-step-badge');
  const demoDesc = document.getElementById('demo-step-desc');
  if (demoBadge) demoBadge.textContent = `STEP ${data.demo_step} / 8`;
  if (demoDesc) demoDesc.textContent = data.demo_description;

  // 3. Update 2D Radar Canvas
  if (radarHUD) radarHUD.updateTargets(data.active_objects);
  if (window.trackingRadarHUD) window.trackingRadarHUD.updateTargets(data.active_objects);
  if (window.cameraRadarHUD) window.cameraRadarHUD.updateTargets(data.active_objects);

  // 4. Update Spectrum Waterfall Canvas
  if (waterfallCanvas && data.bands) {
    const scores = {};
    data.bands.forEach(b => {
      scores[b.band_id] = b.activity_score / 100.0;
    });
    waterfallCanvas.pushBandActivity(
      scores,
      data.current_scan_band,
      data.next_scan_band,
      "B8"
    );
  }

  // 5. Update Band Schedule Chips (B1 to B8)
  updateBandChips(data.bands, data.current_scan_band, data.next_scan_band);

  // 6. Update Target Intel Card
  if (data.active_objects && data.active_objects.length > 0) {
    renderPrimaryTarget(data.active_objects[0]);
  }

  // 7. Update AI Scheduler Panel
  renderSchedulerPanel(data.current_decision, data.bands, data.exploit_balance_pct, data.explore_balance_pct);

  // 8. Update DSP Signal Quality
  renderDSPMetrics(data.signal_quality);

  // 9. Update Active Alerts
  renderAlerts(data.active_alerts);

  // 10. Update Event Log
  renderEventLog(data.recent_events);

  // 11. Update Synthetic Frequency Fluctuation Plot
  updateSyntheticFluctuationChart(data);
}

/* ==========================================================================
   Band Chips Bar (B1 - B8)
   ========================================================================== */
function updateBandChips(bands, currentScan, nextScan) {
  const container = document.getElementById('band-bar-chips');
  if (!container || !bands) return;

  container.innerHTML = '';
  bands.forEach(b => {
    const chip = document.createElement('div');
    const isCurrent = (b.band_id === currentScan);
    const isNext = (b.band_id === nextScan);

    chip.className = `band-chip ${isCurrent ? 'active-scan' : ''} ${isNext ? 'next-scan' : ''}`;
    
    let pClass = 'priority-low';
    if (b.current_priority >= 70) pClass = 'priority-high';
    else if (b.current_priority >= 35) pClass = 'priority-med';
    if (b.band_id === 'B8') pClass = 'priority-explore';

    chip.innerHTML = `
      <div class="band-name">${b.band_id}</div>
      <div class="band-priority ${pClass}">${b.current_priority.toFixed(0)}</div>
      <div style="font-size: 8px; color: #64748b; margin-top: 2px;">${isCurrent ? 'SCANNING' : (isNext ? 'NEXT' : b.priority_level)}</div>
    `;

    chip.addEventListener('click', () => {
      // Manual inspection
      if (window.tacticalAudio) window.tacticalAudio.playChirp();
      showBandDetailModal(b);
    });

    container.appendChild(chip);
  });
}

/* ==========================================================================
   Target Intel Panel
   ========================================================================== */
function renderPrimaryTarget(target) {
  const idEl = document.getElementById('intel-target-id');
  const classEl = document.getElementById('intel-target-class');
  const bandEl = document.getElementById('intel-target-band');
  const distEl = document.getElementById('intel-target-dist');
  const dirEl = document.getElementById('intel-target-dir');
  const speedEl = document.getElementById('intel-target-speed');
  const statusEl = document.getElementById('intel-target-status');
  const riskEl = document.getElementById('intel-target-risk');
  const confEl = document.getElementById('intel-target-conf');

  if (idEl) idEl.textContent = target.object_id;
  if (classEl) classEl.textContent = target.classification;
  if (bandEl) bandEl.textContent = target.current_band;
  if (distEl) distEl.textContent = `${target.distance.toFixed(1)} km`;
  if (dirEl) dirEl.textContent = `${target.direction} (${target.heading_deg.toFixed(0)}°)`;
  if (speedEl) speedEl.textContent = `${target.velocity_kmh.toFixed(0)} km/h`;
  if (statusEl) statusEl.textContent = target.status;
  
  if (riskEl) {
    riskEl.textContent = target.risk_level;
    riskEl.className = `data-value highlight-${target.risk_level === 'HIGH' ? 'red' : (target.risk_level === 'MEDIUM' ? 'amber' : 'green')}`;
  }
  if (confEl) confEl.textContent = `${Math.round(target.confidence * 100)}%`;

  // Render Kinematics Box
  const prevCoordEl = document.getElementById('kinematics-prev-coord');
  const currCoordEl = document.getElementById('kinematics-curr-coord');
  const distRadarEl = document.getElementById('kinematics-dist-radar');
  const distTravelEl = document.getElementById('kinematics-dist-travel');

  if (prevCoordEl) prevCoordEl.textContent = `(${target.prev_x.toFixed(1)}, ${target.prev_y.toFixed(1)})`;
  if (currCoordEl) currCoordEl.textContent = `(${target.x.toFixed(1)}, ${target.y.toFixed(1)})`;
  if (distRadarEl) distRadarEl.textContent = `${target.distance.toFixed(2)} km`;
  if (distTravelEl) distTravelEl.textContent = `${target.distance_travelled.toFixed(2)} km`;
}

/* ==========================================================================
   AI Scheduler Panel & Ranked Table
   ========================================================================== */
function renderSchedulerPanel(decision, bands, exploitPct, explorePct) {
  if (!decision) return;

  const currBandEl = document.getElementById('sched-current-band');
  const nextBandEl = document.getElementById('sched-next-band');
  const prioScoreEl = document.getElementById('sched-prio-score');
  const predScoreEl = document.getElementById('sched-pred-score');
  const reasonTextEl = document.getElementById('sched-reason-text');

  if (currBandEl) currBandEl.textContent = decision.previous_band || "B3";
  if (nextBandEl) nextBandEl.textContent = decision.selected_band;
  if (prioScoreEl) prioScoreEl.textContent = decision.priority_score.toFixed(1);
  if (predScoreEl) predScoreEl.textContent = `${decision.prediction_score.toFixed(0)}%`;
  if (reasonTextEl) reasonTextEl.textContent = decision.reason;

  // Exploit vs Explore bars
  const barExploit = document.getElementById('balance-exploit-fill');
  const barExplore = document.getElementById('balance-explore-fill');
  const txtExploit = document.getElementById('balance-exploit-text');
  const txtExplore = document.getElementById('balance-explore-text');

  if (barExploit) barExploit.style.width = `${exploitPct}%`;
  if (barExplore) barExplore.style.width = `${explorePct}%`;
  if (txtExploit) txtExploit.textContent = `${exploitPct.toFixed(0)}%`;
  if (txtExplore) txtExplore.textContent = `${explorePct.toFixed(0)}%`;

  // Update Reason Breakdown Pie Chart
  if (schedulerReasonChart && decision.reason_breakdown) {
    const rb = decision.reason_breakdown;
    schedulerReasonChart.data.datasets[0].data = [
      rb.recent_activity_pct,
      rb.prediction_pct,
      rb.movement_trend_pct,
      rb.historical_activity_pct,
      rb.uncertainty_pct,
      rb.time_since_scan_pct
    ];
    schedulerReasonChart.update();
  }

  // Update 10-Minute Recurrence Pattern box (specifically for B5)
  if (bands) {
    const b5 = bands.find(b => b.band_id === "B5");
    if (b5) {
      const obsCount = document.getElementById('b5-obs-count');
      const avgInt = document.getElementById('b5-avg-interval');
      const nextAct = document.getElementById('b5-next-act');
      const nextRev = document.getElementById('b5-next-revisit');

      if (obsCount) obsCount.textContent = `${b5.observation_count}`;
      if (avgInt) avgInt.textContent = b5.average_recurrence_interval_sec ? `${b5.average_recurrence_interval_sec}s` : "Calculating...";
      if (nextAct) nextAct.textContent = b5.predicted_next_activity_time ? "In ~12s (Adaptive)" : "Pending Hits";
      if (nextRev) nextRev.textContent = "Soft Revisit Scheduled";
    }

    // Auto-updating Ranked Table in AI Scheduler tab
    renderRankedBandsTable(bands, decision.selected_band);
  }
}

function renderRankedBandsTable(bands, nextSelectedBand) {
  const tbody = document.getElementById('ranked-bands-tbody');
  if (!tbody) return;

  const sorted = [...bands].sort((a, b) => b.current_priority - a.current_priority);
  tbody.innerHTML = '';

  sorted.forEach((b, idx) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    tr.style.background = (b.band_id === nextSelectedBand) ? 'rgba(0, 240, 255, 0.12)' : 'transparent';

    let decisionLabel = 'SKIP';
    let decisionColor = '#64748b';
    if (b.band_id === nextSelectedBand) {
      decisionLabel = 'NEXT SCAN';
      decisionColor = '#00f0ff';
    } else if (b.band_id === 'B8') {
      decisionLabel = 'EXPLORE';
      decisionColor = '#c084fc';
    } else if (b.current_priority > 50) {
      decisionLabel = 'HIGH PRIO';
      decisionColor = '#ffaa00';
    }

    tr.innerHTML = `
      <td style="padding: 6px 10px; font-weight: bold; color: #94a3b8;">#${idx + 1}</td>
      <td style="padding: 6px 10px; font-weight: bold; color: #fff;">${b.band_id} <span style="font-size: 10px; color: #64748b;">(${b.name})</span></td>
      <td style="padding: 6px 10px; color: #00ff88;">${(b.activity_score).toFixed(0)}%</td>
      <td style="padding: 6px 10px; font-weight: bold; color: ${b.current_priority > 70 ? '#ff2a4b' : (b.current_priority > 35 ? '#ffaa00' : '#00ff88')}">${b.current_priority.toFixed(1)}</td>
      <td style="padding: 6px 10px; color: #94a3b8;">${b.observation_count} hits</td>
      <td style="padding: 6px 10px; color: #94a3b8;">${b.seconds_since_last_scan.toFixed(1)}s ago</td>
      <td style="padding: 6px 10px; font-weight: bold; color: ${decisionColor};">${decisionLabel}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================================================
   DSP Signal Quality
   ========================================================================== */
function initDSPCharts() {
  const canvasWave = document.getElementById('dsp-waveform-chart');
  if (canvasWave) {
    dspWaveformChart = new Chart(canvasWave, {
      type: 'line',
      data: {
        labels: Array.from({ length: 96 }, (_, i) => i),
        datasets: [
          {
            label: 'Raw Noisy Signal',
            borderColor: '#ffaa00',
            borderWidth: 1.2,
            data: new Array(96).fill(0),
            pointRadius: 0,
            tension: 0.1
          },
          {
            label: 'Clean Filtered Signal',
            borderColor: '#00ff88',
            borderWidth: 2,
            data: new Array(96).fill(0),
            pointRadius: 0,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'monospace' } } }
        },
        scales: {
          x: { display: false },
          y: {
            grid: { color: 'rgba(30, 58, 95, 0.4)' },
            ticks: { color: '#64748b', font: { family: 'monospace' } }
          }
        }
      }
    });
  }

  const canvasFft = document.getElementById('dsp-fft-chart');
  if (canvasFft) {
    dspFftChart = new Chart(canvasFft, {
      type: 'bar',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => `${i * 10}Hz`),
        datasets: [{
          label: 'FFT Spectral Energy',
          backgroundColor: 'rgba(0, 240, 255, 0.7)',
          data: new Array(24).fill(0)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#64748b', font: { family: 'monospace', size: 9 } } },
          y: { grid: { color: 'rgba(30, 58, 95, 0.4)' }, ticks: { color: '#64748b' } }
        }
      }
    });
  }
}

function renderDSPMetrics(dsp) {
  if (!dsp) return;

  const snrBeforeEl = document.getElementById('dsp-snr-before');
  const snrAfterEl = document.getElementById('dsp-snr-after');
  const noiseLvlEl = document.getElementById('dsp-noise-level');
  const sigQualEl = document.getElementById('dsp-signal-quality');
  const filterStatEl = document.getElementById('dsp-filter-status');

  if (snrBeforeEl) snrBeforeEl.textContent = `${dsp.snr_before_db.toFixed(1)} dB`;
  if (snrAfterEl) snrAfterEl.textContent = `${dsp.snr_after_db.toFixed(1)} dB`;
  if (noiseLvlEl) noiseLvlEl.textContent = `${dsp.noise_level_db.toFixed(1)} dB`;
  if (sigQualEl) sigQualEl.textContent = `${dsp.signal_quality_pct.toFixed(1)}%`;
  if (filterStatEl) filterStatEl.textContent = dsp.filter_status;

  // Update Waveform Chart
  if (dspWaveformChart && dsp.raw_signal && dsp.filtered_signal) {
    dspWaveformChart.data.datasets[0].data = dsp.raw_signal.slice(0, 96);
    dspWaveformChart.data.datasets[1].data = dsp.filtered_signal.slice(0, 96);
    dspWaveformChart.update();
  }

  // Update FFT Chart
  if (dspFftChart && dsp.fft_freqs && dsp.fft_amplitudes) {
    dspFftChart.data.labels = dsp.fft_freqs.slice(0, 24).map(f => `${f}Hz`);
    dspFftChart.data.datasets[0].data = dsp.fft_amplitudes.slice(0, 24);
    dspFftChart.update();
  }
}

/* ==========================================================================
   Synthetic Frequency Fluctuation Chart (Webcam Target)
   ========================================================================= */
function initCamFluctuationChart() {
  const canvas = document.getElementById('cam-fluctuation-chart');
  if (!canvas) return;

  const initFreqs = [];
  const initActs = [];
  const initLabels = [];
  const nowMs = Date.now();
  for (let i = 20; i >= 0; i--) {
    const t = new Date(nowMs - i * 1000);
    initLabels.push(t.toTimeString().split(' ')[0].substring(3));
    initFreqs.push(parseFloat((4.72 + Math.sin(i * 0.4) * 0.12).toFixed(3)));
    initActs.push(Math.round(80 + Math.cos(i * 0.5) * 10));
  }

  camFluctuationChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: initLabels,
      datasets: [
        {
          label: 'Synthetic Frequency (GHz)',
          borderColor: '#00f0ff',
          backgroundColor: 'rgba(0, 240, 255, 0.1)',
          yAxisID: 'yFreq',
          data: initFreqs,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4
        },
        {
          label: 'Activity Level (%)',
          borderColor: '#00ff88',
          yAxisID: 'yAct',
          data: initActs,
          tension: 0.35,
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'monospace', size: 10 } } }
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { color: '#64748b', font: { family: 'monospace', size: 9 }, maxTicksLimit: 6 }
        },
        yFreq: {
          type: 'linear',
          position: 'left',
          min: 4.3,
          max: 5.2,
          grid: { color: 'rgba(30, 58, 95, 0.3)' },
          ticks: { color: '#00f0ff', font: { family: 'monospace', size: 9 } }
        },
        yAct: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 100,
          grid: { display: false },
          ticks: { color: '#00ff88', font: { family: 'monospace', size: 9 } }
        }
      }
    }
  });

  window.updateCamFluctuationChart = (times, acts, freqs) => {
    if (!camFluctuationChart || !freqs || freqs.length === 0) return;
    camFluctuationChart.data.labels = times.map(t => `${t}`);
    camFluctuationChart.data.datasets[0].data = freqs;
    camFluctuationChart.data.datasets[1].data = acts;
    const minF = Math.min(...freqs);
    const maxF = Math.max(...freqs);
    const pad = Math.max(0.1, (maxF - minF) * 0.25);
    camFluctuationChart.options.scales.yFreq.min = Math.max(0, parseFloat((minF - pad).toFixed(2)));
    camFluctuationChart.options.scales.yFreq.max = parseFloat((maxF + pad).toFixed(2));
    camFluctuationChart.update('none');
  };
}

function updateSyntheticFluctuationChart(data) {
  if (!camFluctuationChart) return;

  let currentFreq = 4.72;
  let currentAct = 82;

  if (data && data.camera_status && data.camera_status.active_targets && data.camera_status.active_targets.length > 0) {
    const primary = data.camera_status.active_targets[0];
    currentFreq = primary.synthetic_frequency_ghz || 4.72;
    currentAct = primary.synthetic_activity_pct || 85;
  } else if (data && data.bands && data.current_scan_band) {
    const currentBandObj = data.bands.find(b => b.band_id === data.current_scan_band);
    const BAND_BASE_FREQS = {
      B1: 0.02, B2: 0.15, B3: 1.65, B4: 5.20,
      B5: 9.80, B6: 15.0, B7: 22.5, B8: 34.0
    };
    const baseF = BAND_BASE_FREQS[data.current_scan_band] || 5.0;
    const jitter = Math.sin(Date.now() / 850) * 0.15 + (Math.random() - 0.5) * 0.04;
    currentFreq = parseFloat((baseF + jitter).toFixed(3));
    currentAct = Math.round((currentBandObj ? currentBandObj.activity_score : 75) + (Math.random() - 0.5) * 5);
  } else {
    currentFreq = parseFloat((4.72 + (Math.random() - 0.5) * 0.16).toFixed(3));
    currentAct = Math.round(78 + Math.random() * 12);
  }

  const dsFreq = camFluctuationChart.data.datasets[0].data;
  const dsAct = camFluctuationChart.data.datasets[1].data;

  dsFreq.push(currentFreq);
  if (dsFreq.length > 20) dsFreq.shift();

  dsAct.push(currentAct);
  if (dsAct.length > 20) dsAct.shift();

  // Dynamic autoscale for yFreq
  const minF = Math.min(...dsFreq);
  const maxF = Math.max(...dsFreq);
  const pad = Math.max(0.08, (maxF - minF) * 0.22);
  camFluctuationChart.options.scales.yFreq.min = Math.max(0, parseFloat((minF - pad).toFixed(2)));
  camFluctuationChart.options.scales.yFreq.max = parseFloat((maxF + pad).toFixed(2));

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0].substring(3);
  camFluctuationChart.data.labels.push(timeStr);
  if (camFluctuationChart.data.labels.length > 20) camFluctuationChart.data.labels.shift();

  camFluctuationChart.update('none');
}

/* ==========================================================================
   Analytics Benchmark Chart (Fixed vs Random vs Rule vs SWASTIK)
   ========================================================================== */
function initAnalyticsCharts() {
  const canvas = document.getElementById('analytics-benchmark-chart');
  if (!canvas) return;

  analyticsBenchmarkChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Detection Rate (%)', 'Scan Efficiency (x100)', 'Exploration Coverage (%)', 'Intercept Delay (ms / 3)'],
      datasets: [
        {
          label: 'SWASTIK Adaptive Scan',
          backgroundColor: '#00f0ff',
          data: [94.2, 84.0, 98.5, 8.1]
        },
        {
          label: 'Rule-Based Priority Scan',
          backgroundColor: '#ffaa00',
          data: [68.0, 58.0, 54.0, 27.3]
        },
        {
          label: 'Sequential Fixed Scan (B1-B8)',
          backgroundColor: '#64748b',
          data: [44.0, 36.0, 100.0, 49.3]
        },
        {
          label: 'Random Uniform Scan',
          backgroundColor: '#ff2a4b',
          data: [32.0, 24.0, 88.0, 71.6]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#cbd5e1', font: { family: 'monospace' } } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { family: 'monospace' } } },
        y: {
          grid: { color: 'rgba(30, 58, 95, 0.4)' },
          ticks: { color: '#94a3b8', font: { family: 'monospace' } }
        }
      }
    }
  });
}

/* ==========================================================================
   Explainable AI Reason Breakdown Chart
   ========================================================================== */
function initSchedulerReasonChart() {
  const canvas = document.getElementById('scheduler-reason-chart');
  if (!canvas) return;

  schedulerReasonChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Recent Activity', 'AI Prediction', 'Movement Trend', 'Historical Hits', 'Uncertainty (UCB)', 'Staleness'],
      datasets: [{
        data: [28, 25, 20, 12, 10, 5],
        backgroundColor: ['#00f0ff', '#00ff88', '#38bdf8', '#ffaa00', '#c084fc', '#f43f5e'],
        borderColor: '#0a1120',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#cbd5e1', font: { family: 'monospace', size: 10 } }
        }
      }
    }
  });
}

/* ==========================================================================
   Doppler Archetypes Fetcher
   ========================================================================== */
async function fetchDopplerArchetypes() {
  try {
    const res = await fetch('/api/doppler/archetypes/all');
    const data = await res.json();
    window.dopplerArchetypesData = data;
    renderDopplerArchetypes(data);
  } catch (e) {
    console.warn("Could not fetch Doppler archetypes", e);
  }
}

function renderDopplerArchetypes(archetypes) {
  window.dopplerArchetypesData = archetypes;
  const container = document.getElementById('doppler-archetypes-grid');
  if (!container || !archetypes) return;

  container.innerHTML = '';
  Object.keys(archetypes).forEach(k => {
    const arch = archetypes[k];
    const card = document.createElement('div');
    card.className = 'tactical-card';
    card.style.padding = '10px';
    card.style.cursor = 'pointer';
    card.title = `Click to inspect ${k} in Doppler Analysis Scope`;
    card.onclick = () => {
      if (typeof window.switchTabDirect === 'function') window.switchTabDirect('tab-doppler');
      if (typeof window.selectDopplerArchetype === 'function') window.selectDopplerArchetype(k);
    };

    card.innerHTML = `
      <div class="card-header" style="margin-bottom: 6px;">
        <div class="card-title" style="color: ${arch.color}; font-size: 0.82rem;">${k}</div>
        <div class="card-subtitle">${arch.typical_band}</div>
      </div>
      <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 6px;">${arch.micro_doppler_signature}</div>
      <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 0.75rem; margin-bottom: 6px;">
        <span>Speed: <strong style="color: #fff;">${arch.typical_speed_ms} m/s</strong></span>
        <span>Doppler: <strong style="color: ${arch.color};">+${arch.doppler_shift_khz} kHz</strong></span>
      </div>
      <canvas id="doppler-canvas-${k}" width="240" height="55" style="width: 100%; height: 55px; background: #040814; border: 1px solid #1e3a5f; border-radius: 3px;"></canvas>
    `;
    container.appendChild(card);
  });

  setTimeout(() => {
    redrawDopplerArchetypesMiniCanvases();
  }, 100);
}

window.redrawDopplerArchetypesMiniCanvases = function() {
  if (!window.dopplerArchetypesData) return;
  const archetypes = window.dopplerArchetypesData;
  Object.keys(archetypes).forEach(k => {
    const arch = archetypes[k];
    const c = document.getElementById(`doppler-canvas-${k}`);
    if (c && arch.waveform) {
      if (c.clientWidth > 0 && Math.abs(c.width - c.clientWidth) > 4) {
        c.width = c.clientWidth;
      }
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.strokeStyle = arch.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const step = c.width / arch.waveform.length;
      const midY = c.height / 2;
      arch.waveform.forEach((val, i) => {
        const y = midY - val * (midY - 4);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * step, y);
      });
      ctx.stroke();
    }
  });
};

/* ==========================================================================
   Doppler Analysis & Interactive Suite
   ========================================================================== */
let activeDopplerArchetype = 'Aircraft';
let dopplerAnimFrame = null;
let dopplerPhase = 0;
let dopplerHistorySTFT = [];
let lastSTFTPushTime = 0;

const DOPPLER_ARCHETYPES = {
  Aircraft: {
    name: 'Aircraft (Fighter / Commercial)',
    speed: 280,
    freq: 10.0,
    color: '#00f0ff',
    desc: 'Jet Turbine Compressor Rotation + Continuous Smooth Skin Doppler Line',
    microMod: 'Turbine blade modulation (low envelope ripple, high velocity shift)',
    classification: 'Aircraft (High Confidence)',
    drawWave: (ctx, w, h, t) => {
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const rad = (x / w) * 16 * Math.PI + t * 8;
        const y = (h / 2) + Math.sin(rad) * (h * 0.32) + Math.sin(rad * 0.1) * (h * 0.08);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    getSpectrum: (bins) => {
      return bins.map((f, i) => {
        const center = 69; // +18.7 kHz peak
        const dist = Math.abs(i - center);
        let amp = Math.exp(-dist * dist / 8);
        amp += Math.random() * 0.04;
        return Math.min(1.0, Math.max(0.02, amp));
      });
    }
  },
  Drone: {
    name: 'Drone / UAV (Quad-rotor)',
    speed: 18,
    freq: 10.0,
    color: '#ffaa00',
    desc: 'High-RPM Multi-Blade Harmonic Modulation Flashes (4 Rotors, 120 Hz BPF)',
    microMod: 'Rotor Blade Harmonic Sidebands (±6 kHz periodic chopping)',
    classification: 'Drone / UAV (High Confidence)',
    drawWave: (ctx, w, h, t) => {
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const rad = (x / w) * 22 * Math.PI + t * 4;
        const envelope = 0.4 + 0.6 * Math.abs(Math.sin(rad * 0.25 + t * 10));
        const y = (h / 2) + Math.sin(rad * 1.8) * (h * 0.38) * envelope;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    getSpectrum: (bins) => {
      return bins.map((f, i) => {
        let amp = 0.04 + Math.random() * 0.04;
        [51, 46, 56, 41, 61].forEach((peak, idx) => {
          const weight = idx === 0 ? 0.9 : 0.55 / (idx * 0.8);
          const dist = Math.abs(i - peak);
          amp += Math.exp(-dist * dist / 5) * weight;
        });
        return Math.min(1.0, Math.max(0.02, amp));
      });
    }
  },
  Missile: {
    name: 'Hypersonic Missile / High-G Munition',
    speed: 620,
    freq: 10.0,
    color: '#ff2a4b',
    desc: 'Hypervelocity Steep Trajectory + High Doppler Rate Acceleration Gradient',
    microMod: 'Rapid Frequency Sweep & Ionized Shockwave Friction Fluctuation',
    classification: 'Missile / High-G Threat (CRITICAL)',
    drawWave: (ctx, w, h, t) => {
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const rad = (x / w) * 36 * Math.PI + t * 16;
        const y = (h / 2) + Math.sin(rad) * (h * 0.42);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    getSpectrum: (bins) => {
      return bins.map((f, i) => {
        const center = 91; // +41.3 kHz
        const dist = Math.abs(i - center);
        let amp = Math.exp(-dist * dist / 6) * 0.95;
        amp += Math.random() * 0.05;
        return Math.min(1.0, Math.max(0.02, amp));
      });
    }
  },
  Bird: {
    name: 'Biological / Bird Flock',
    speed: 12,
    freq: 10.0,
    color: '#c084fc',
    desc: 'Low-Frequency Wing Flap Flutter (6–8 Hz) & Chaotic Kinematic Swarm',
    microMod: 'Non-rigid Wing Beat Fluctuation (6 Hz Flutter)',
    classification: 'Biological Clutter (Bird / Low Threat)',
    drawWave: (ctx, w, h, t) => {
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const flap = Math.sin((x / w) * 4 * Math.PI + t * 4);
        const rad = (x / w) * 12 * Math.PI + t * 2;
        const y = (h / 2) + (Math.sin(rad) * 0.22 + flap * 0.24 + (Math.random() - 0.5) * 0.04) * (h * 0.7);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    getSpectrum: (bins) => {
      return bins.map((f, i) => {
        const center = 51;
        const dist = Math.abs(i - center);
        let amp = Math.exp(-dist * dist / 28) * 0.52;
        amp += (Math.random() - 0.5) * 0.06;
        return Math.max(0.03, Math.min(1.0, amp));
      });
    }
  },
  Radar: {
    name: 'Ground Radar Emitter / Fixed Infrastructure',
    speed: 0,
    freq: 10.0,
    color: '#64748b',
    desc: 'Stationary Zero-Doppler Clutter Baseline + Emitter Antenna Rotation Sweeps',
    microMod: 'Zero Radial Motion / Antenna Beam Rotation Scan (0.2 Hz)',
    classification: 'Ground Station / Static Infrastructure',
    drawWave: (ctx, w, h, t) => {
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const pulse = Math.sin((x / w) * 6 * Math.PI + t * 2) > 0.8 ? 1 : 0;
        const rad = (x / w) * 24 * Math.PI;
        const y = (h / 2) + (pulse * Math.sin(rad) * (h * 0.4));
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    getSpectrum: (bins) => {
      return bins.map((f, i) => {
        const center = 50; // exact zero
        const dist = Math.abs(i - center);
        let amp = Math.exp(-dist * dist / 2.5) * 0.98;
        amp += Math.random() * 0.02;
        return Math.min(1.0, Math.max(0.01, amp));
      });
    }
  },
  Communication: {
    name: 'Communication Link (Digital / Voice)',
    speed: 0,
    freq: 3.5,
    color: '#38bdf8',
    desc: 'Stationary Constant-Envelope Digital QPSK / FSK Carrier Baseline',
    microMod: 'Digital Modulation Sidebands / Zero Radial Motion',
    classification: 'Communication Link (Ground/Air Emitter)',
    drawWave: (ctx, w, h, t) => {
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const bit = Math.floor((x / w) * 8 + t * 2) % 2;
        const phase = bit * Math.PI;
        const rad = (x / w) * 20 * Math.PI + phase;
        const y = (h / 2) + Math.sin(rad) * (h * 0.35);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    getSpectrum: (bins) => {
      return bins.map((f, i) => {
        const center = 50; // zero Doppler
        const dist = Math.abs(i - center);
        let amp = Math.exp(-dist * dist / 3.5) * 0.85;
        if (Math.abs(i - 46) < 2 || Math.abs(i - 54) < 2) amp += 0.25;
        amp += Math.random() * 0.02;
        return Math.min(1.0, Math.max(0.01, amp));
      });
    }
  }
};

window.selectDopplerArchetype = function(name) {
  if (!DOPPLER_ARCHETYPES[name]) return;
  activeDopplerArchetype = name;
  const arch = DOPPLER_ARCHETYPES[name];

  ['Aircraft', 'Drone', 'Missile', 'Bird', 'Radar', 'Communication'].forEach(t => {
    const btn = document.getElementById(`dbtn-${t}`);
    if (btn) btn.classList.toggle('active', t === name);
  });

  const descEl = document.getElementById('doppler-stft-desc');
  if (descEl) descEl.textContent = arch.desc;

  const speedSlider = document.getElementById('calc-speed-slider');
  const freqSlider = document.getElementById('calc-freq-slider');
  if (speedSlider) speedSlider.value = arch.speed;
  if (freqSlider) freqSlider.value = arch.freq;

  updateDopplerCalculations();
  if (window.tacticalAudio) window.tacticalAudio.playBeep(650, 0.04);
};

function updateDopplerCalculations() {
  const speedSlider = document.getElementById('calc-speed-slider');
  const freqSlider = document.getElementById('calc-freq-slider');
  if (!speedSlider || !freqSlider) return;

  const v = parseFloat(speedSlider.value);
  const f0_ghz = parseFloat(freqSlider.value);

  const kmh = (v * 3.6).toFixed(0);
  const elSpeedVal = document.getElementById('calc-speed-val');
  if (elSpeedVal) elSpeedVal.textContent = `${v} m/s (${kmh} km/h)`;

  let bandLabel = 'Custom Band';
  if (f0_ghz < 3) bandLabel = 'UHF / L-Band';
  else if (f0_ghz < 8) bandLabel = 'S/C-Band';
  else if (f0_ghz <= 12) bandLabel = 'X-Band';
  else if (f0_ghz <= 18) bandLabel = 'Ku-Band';
  else if (f0_ghz <= 27) bandLabel = 'K-Band';
  else bandLabel = 'Ka-Band';

  const elFreqVal = document.getElementById('calc-freq-val');
  if (elFreqVal) elFreqVal.textContent = `${f0_ghz.toFixed(1)} GHz (${bandLabel})`;

  // lambda = c / f0 = 0.3 / f0_ghz (meters)
  const lambda_m = 0.3 / f0_ghz;
  const lambda_cm = lambda_m * 100;

  // fd = 2 * v * f0 / c = (2 * v * f0_ghz) / 300 (kHz)
  const fd_khz = (2 * v * f0_ghz) / 300;

  const elWavelength = document.getElementById('calc-wavelength');
  if (elWavelength) {
    elWavelength.textContent = `${lambda_m.toFixed(4)} m (${lambda_cm.toFixed(2)} cm)`;
  }

  const elShift = document.getElementById('calc-doppler-shift');
  if (elShift) {
    elShift.textContent = `+${fd_khz.toFixed(2)} kHz (${(fd_khz * 1000).toFixed(0)} Hz)`;
  }

  const elMod = document.getElementById('calc-micro-mod');
  const elClass = document.getElementById('calc-classification');

  let modText = '';
  let classText = '';
  let classColor = '#00ff88';

  if (v === 0) {
    if (activeDopplerArchetype === 'Communication') {
      modText = 'Digital QPSK/FSK Modulation Sidebands / Zero Radial Motion';
      classText = 'Communication Link (Stationary Emitter)';
      classColor = '#38bdf8';
    } else {
      modText = 'Stationary Emitter / Zero Radial Motion';
      classText = 'Ground Tower / Static Radar';
      classColor = '#94a3b8';
    }
  } else if (v < 15) {
    modText = 'Non-rigid Wing Beat Flap Modulation (5-8 Hz)';
    classText = 'Bird Flock / Biomimetic Clutter';
    classColor = '#c084fc';
  } else if (v <= 45) {
    modText = 'High-RPM Rotor Blade Harmonics (120 Hz sidebands)';
    classText = 'Drone / UAV (Quad-rotor)';
    classColor = '#ffaa00';
  } else if (v <= 350) {
    modText = 'Jet Turbine Engine Modulation + Smooth Airframe';
    classText = 'Aircraft / Fighter Jet';
    classColor = '#00f0ff';
  } else {
    modText = 'Hypervelocity Shockwave / Extreme Acceleration Gradient';
    classText = 'Hypersonic Missile / High-G Munition';
    classColor = '#ff2a4b';
  }

  if (elMod) elMod.textContent = modText;
  if (elClass) {
    elClass.textContent = classText;
    elClass.style.color = classColor;
  }
}

function renderDopplerFrame() {
  const tabPane = document.getElementById('tab-doppler');
  if (!tabPane || !tabPane.classList.contains('active')) return;

  const arch = DOPPLER_ARCHETYPES[activeDopplerArchetype] || DOPPLER_ARCHETYPES.Aircraft;

  // 1. Time-Domain Waveform Canvas
  const waveCanvas = document.getElementById('doppler-live-wave-canvas');
  if (waveCanvas) {
    if (waveCanvas.clientWidth > 0 && Math.abs(waveCanvas.width - waveCanvas.clientWidth) > 4) {
      waveCanvas.width = waveCanvas.clientWidth;
    }
    const ctx = waveCanvas.getContext('2d');
    const w = waveCanvas.width;
    const h = waveCanvas.height;

    ctx.fillStyle = '#030814';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.45)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 35) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy < h; gy += 25) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // Baseline
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Waveform
    ctx.strokeStyle = arch.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = arch.color;
    ctx.shadowBlur = 6;
    arch.drawWave(ctx, w, h, dopplerPhase);
    ctx.shadowBlur = 0;

    // Overlay tag
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText('LIVE RX VOLTAGE s(t)', 8, 14);
  }

  // 2. Frequency-Domain Doppler Spectrum Canvas (-50 to +50 kHz)
  const specCanvas = document.getElementById('doppler-live-spec-canvas');
  let currentBins = [];
  if (specCanvas) {
    if (specCanvas.clientWidth > 0 && Math.abs(specCanvas.width - specCanvas.clientWidth) > 4) {
      specCanvas.width = specCanvas.clientWidth;
    }
    const ctx = specCanvas.getContext('2d');
    const w = specCanvas.width;
    const h = specCanvas.height;

    ctx.fillStyle = '#030814';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.45)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy < h; gy += 30) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // Zero Doppler center marker
    const midX = w / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Generate 100 bins
    const numBins = 100;
    const bins = new Array(numBins).fill(0);
    currentBins = arch.getSpectrum(bins);

    // Draw Spectrum area & curve
    ctx.beginPath();
    ctx.moveTo(0, h);
    const stepX = w / (numBins - 1);
    currentBins.forEach((amp, i) => {
      const px = i * stepX;
      const py = h - (amp * (h - 22));
      ctx.lineTo(px, py);
    });
    ctx.lineTo(w, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, arch.color + '66');
    grad.addColorStop(1, arch.color + '05');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = arch.color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = arch.color;
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Axis Labels
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText('-50 kHz', 6, h - 6);
    ctx.fillText('0', midX - 3, h - 6);
    ctx.fillText('+50 kHz', w - 48, h - 6);
  }

  // 3. Micro-Doppler Time-Frequency Spectrogram (STFT Waterfall)
  const stftCanvas = document.getElementById('doppler-spectrogram-canvas');
  if (stftCanvas && currentBins.length > 0) {
    if (stftCanvas.clientWidth > 0 && Math.abs(stftCanvas.width - stftCanvas.clientWidth) > 4) {
      stftCanvas.width = stftCanvas.clientWidth;
    }
    const now = Date.now();
    if (now - lastSTFTPushTime > 60) {
      lastSTFTPushTime = now;
      dopplerHistorySTFT.push(currentBins);
      if (dopplerHistorySTFT.length > 90) {
        dopplerHistorySTFT.shift();
      }
    }

    const ctx = stftCanvas.getContext('2d');
    const w = stftCanvas.width;
    const h = stftCanvas.height;

    ctx.fillStyle = '#020610';
    ctx.fillRect(0, 0, w, h);

    const colW = w / 90;
    const numBins = currentBins.length;
    const binH = h / numBins;

    dopplerHistorySTFT.forEach((slice, colIdx) => {
      const px = colIdx * colW;
      slice.forEach((val, bIdx) => {
        const py = h - ((bIdx + 1) * binH);
        if (val > 0.08) {
          if (val > 0.7) ctx.fillStyle = '#fffa65';
          else if (val > 0.4) ctx.fillStyle = arch.color;
          else ctx.fillStyle = 'rgba(0, 100, 200, ' + (val * 1.5) + ')';
          ctx.fillRect(px, py, colW + 0.5, binH + 0.5);
        }
      });
    });

    // Zero Doppler guideline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axis legend
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText('+50 kHz', 6, 12);
    ctx.fillText('0 kHz', 6, (h / 2) + 3);
    ctx.fillText('-50 kHz', 6, h - 5);
    ctx.fillText('TIME FLOW ──▶', w - 85, h - 5);
  }

  dopplerPhase += 0.04;
}

function initDopplerInteractiveSuite() {
  const speedSlider = document.getElementById('calc-speed-slider');
  const freqSlider = document.getElementById('calc-freq-slider');

  if (speedSlider) {
    speedSlider.addEventListener('input', () => {
      updateDopplerCalculations();
      const v = parseFloat(speedSlider.value);
      if (DOPPLER_ARCHETYPES[activeDopplerArchetype]) {
        DOPPLER_ARCHETYPES[activeDopplerArchetype].speed = v;
      }
    });
  }

  if (freqSlider) {
    freqSlider.addEventListener('input', () => {
      updateDopplerCalculations();
      const f = parseFloat(freqSlider.value);
      if (DOPPLER_ARCHETYPES[activeDopplerArchetype]) {
        DOPPLER_ARCHETYPES[activeDopplerArchetype].freq = f;
      }
    });
  }

  // Initialize display
  updateDopplerCalculations();

  // Start continuous 60fps animation loop
  function loop() {
    renderDopplerFrame();
    dopplerAnimFrame = requestAnimationFrame(loop);
  }
  if (!dopplerAnimFrame) {
    dopplerAnimFrame = requestAnimationFrame(loop);
  }
}

/* ==========================================================================
   Alerts & Event Log
   ========================================================================== */
function renderAlerts(alerts) {
  const container = document.getElementById('active-alerts-container');
  if (!container || !alerts) return;

  if (alerts.length === 0) {
    container.innerHTML = '<div style="color: #64748b; font-family: monospace; font-size: 0.8rem; padding: 6px;">NO ACTIVE SYSTEM ALERTS</div>';
    return;
  }

  container.innerHTML = '';
  alerts.forEach(a => {
    const box = document.createElement('div');
    box.className = 'active-alert-box';
    box.innerHTML = `
      <div>
        <div style="color: #ff2a4b; font-weight: bold; font-family: monospace; font-size: 0.85rem;">
          ⚠ ALERT: ${a.object_id} [${a.band}]
        </div>
        <div style="font-size: 0.78rem; color: #cbd5e1; margin-top: 2px;">
          ${a.message}
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px; font-family: monospace;">
          Range: ${a.distance.toFixed(1)} km | Conf: ${(a.confidence * 100).toFixed(0)}% | Time: ${a.time_str}
        </div>
      </div>
      <button class="btn-tactical btn-danger" style="font-size: 0.72rem; padding: 4px 8px;" onclick="ackAlert('${a.alert_id}')">ACK</button>
    `;
    container.appendChild(box);
  });
}

window.ackAlert = (alertId) => {
  fetch(`/api/alerts/${alertId}/ack`, { method: 'POST' }).catch(() => {});
};

function renderEventLog(events) {
  const container = document.getElementById('live-event-log');
  if (!container || !events) return;

  container.innerHTML = '';
  events.forEach(e => {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = `
      <span class="log-time">[${e.time_str}]</span>
      <span class="log-cat ${e.category}">${e.category}</span>
      <span style="color: #e2e8f0;">${e.message}</span>
    `;
    container.appendChild(row);
  });
  container.scrollTop = container.scrollHeight;
}

window.logEvent = (cat, msg) => {
  const container = document.getElementById('live-event-log');
  if (!container) return;
  const now = new Date().toTimeString().split(' ')[0];
  const row = document.createElement('div');
  row.className = 'log-entry';
  row.innerHTML = `
    <span class="log-time">[${now}]</span>
    <span class="log-cat ${cat}">${cat}</span>
    <span style="color: #e2e8f0;">${msg}</span>
  `;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
};

/* ==========================================================================
   User Controls & Scenario Actions
   ========================================================================== */
function initControls() {
  // Smart Scan Demo Step Button
  const btnDemoStep = document.getElementById('btn-step-demo');
  if (btnDemoStep) {
    btnDemoStep.addEventListener('click', () => {
      fetch('/api/simulation/demo-step', { method: 'POST' });
    });
  }

  // Simulation Controls: Start / Pause / Reset
  const btnStart = document.getElementById('btn-sim-start');
  const btnPause = document.getElementById('btn-sim-pause');
  const btnReset = document.getElementById('btn-sim-reset');

  if (btnStart) btnStart.addEventListener('click', () => fetch('/api/simulation/start', { method: 'POST' }));
  if (btnPause) btnPause.addEventListener('click', () => fetch('/api/simulation/pause', { method: 'POST' }));
  if (btnReset) btnReset.addEventListener('click', () => fetch('/api/simulation/reset', { method: 'POST' }));

  // Scenario Selector
  const scenarioSelect = document.getElementById('select-scenario');
  if (scenarioSelect) {
    scenarioSelect.addEventListener('change', (e) => {
      fetch(`/api/simulation/scenario/${e.target.value}`, { method: 'POST' });
    });
  }

  // Noise Reduction DSP Toggle
  const btnDspToggle = document.getElementById('btn-toggle-dsp');
  if (btnDspToggle) {
    btnDspToggle.addEventListener('click', () => {
      fetch('/api/signal-quality/toggle', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          btnDspToggle.textContent = data.noise_reduction_enabled ? "DSP FILTERING: ON" : "DSP FILTERING: BYPASS";
          btnDspToggle.classList.toggle('btn-gold', !data.noise_reduction_enabled);
        });
    });
  }

  // Target Injector Form
  const formAddTarget = document.getElementById('form-add-target');
  if (formAddTarget) {
    formAddTarget.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('inject-id').value;
      const type = document.getElementById('inject-type').value;
      const x = parseFloat(document.getElementById('inject-x').value);
      const y = parseFloat(document.getElementById('inject-y').value);
      const band = document.getElementById('inject-band').value;

      fetch('/api/simulation/add-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object_id: id,
          classification: type,
          x: x,
          y: y,
          vx: -120,
          vy: 80,
          current_band: band
        })
      });
    });
  }

  // Exploit / Explore Slider
  const sliderExploit = document.getElementById('slider-exploit-ratio');
  if (sliderExploit) {
    sliderExploit.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exploitation_ratio: val })
      });
    });
  }
}
