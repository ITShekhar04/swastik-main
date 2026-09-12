# SWASTIK
### AI Adaptive Smart Scan & Spectrum Intelligence
**SIH 2025–2026 — Smart Scan Strategy for Electronic Warfare (Research Prototype)**

> **SAFE SYNTHETIC SIMULATION DISCLAIMER:**  
> This software is strictly an academic simulation and research prototype. It does not utilize real military frequencies, classified operational parameters, real intercepted communications, or weapon control logic. The webcam sensor integration is strictly a visual demonstration tool mapping harmless visual events to synthetic radar coordinates.

---

## 1. Core Innovation

A receiver cannot observe the entire electromagnetic spectrum simultaneously. Traditional fixed scanning cycles through bands in a static sequence:
$$\text{Band 1} \to \text{Band 2} \to \text{Band 3} \to \dots \to \text{Band 8}$$
This wastes critical observation time on empty channels while high-priority dynamic emitters move undetected.

**SWASTIK** replaces rigid schedules with a continuous adaptive cognitive loop:
$$\textbf{OBSERVE} \longrightarrow \textbf{PREDICT} \longrightarrow \textbf{PRIORITIZE} \longrightarrow \textbf{SCAN} \longrightarrow \textbf{LEARN} \longrightarrow \textbf{REPEAT}$$

When a simulated airborne target hops:
$$\text{Band 3} \longrightarrow \text{Band 7} \longrightarrow \text{Band 5} \longrightarrow \text{Band 6}$$
The AI scheduler dynamically tracks the trend and directs the receiver scan window to follow the situation.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SWASTIK FRONTEND (DEFENSE COMMAND HUD)                   │
│                                                                             │
│  [Mission Control] [Live Spectrum] [Object Tracking] [AI Scheduler]         │
│  [Doppler Analysis] [Signal DSP] [Live Camera Radar] [Analytics]             │
│                                                                             │
│  ┌───────────────────────┐ ┌────────────────────────┐ ┌───────────────────┐ │
│  │ 2D Canvas Radar HUD   │ │ Live Webcam Vision     │ │ Target Intel HUD  │ │
│  │ (Rings, Sweep, Blips) │ │ (Bounding Box, Track)  │ │ (Range, Band, ID) │ │
│  └───────────────────────┘ └────────────────────────┘ └───────────────────┘ │
│  ┌───────────────────────┐ ┌────────────────────────┐ ┌───────────────────┐ │
│  │ Spectrum Waterfall    │ │ Doppler / FFT Analyzer │ │ DSP Noise Filters │ │
│  │ (Heatmap, Active Band)│ │ (Micro-Doppler Sign.)  │ │ (Raw vs Filtered) │ │
│  └───────────────────────┘ └────────────────────────┘ └───────────────────┘ │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ WebSocket (/ws/live @ 12 Hz)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                     SWASTIK BACKEND (FASTAPI + PYTHON)                      │
│                                                                             │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────────┐ │
│  │ Synthetic RF     │ │ AI Smart         │ │ Digital Signal Processing    │ │
│  │ Simulator        │ │ Scheduler        │ │ (DSP & Noise Reduction)      │ │
│  │ - Emitters B1-B8 │ │ - Dynamic        │ │ - LMS Adaptive Filter        │ │
│  │ - Hopping Targets│ │   Priority Score │ │ - Notch & Bandpass Filters   │ │
│  │ - Kinematics     │ │ - 10m Recurrence │ │ - SNR Before / After dB      │ │
│  │ - Demo Scenario  │ │ - Exploit/Explore│ │ - FFT Spectral Energy        │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────────────────┘ │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────────┐ │
│  │ Vision & Camera  │ │ Doppler & Micro- │ │ Performance Analytics        │ │
│  │ Target Mapper    │ │ Doppler Engine   │ │ & Benchmark Engine           │ │
│  │ - Coordinate Map │ │ - fd = 2v / λ    │ │ - Sequential vs Random vs    │ │
│  │ - Emitter Profile│ │ - Spectrograms   │ │   Rule-based vs SWASTIK      │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ SQLite Database (Objects, Observations, Band Activity, Decisions, Logs)│ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Key Feature Modules

### A. Live 2D Synthetic Radar HUD
- Interactive coordinate grid centered at $(0, 0)$.
- Concentric distance rings at **1 km, 2 km, 5 km, 10 km, 20 km**.
- 5 km perimeter alert ring with boundary breach detection.
- Continuous 360-degree rotating phosphor sweep line with trailing decay.
- Real-time kinematic tracking:
  - Distance: $d = \sqrt{x^2 + y^2}$
  - Travelled distance: $\Delta d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$
  - Direction and bearing angle ($0^\circ - 360^\circ$).

### B. Live Spectrum Waterfall (Heatmap)
- 8 Synthetic Frequency Bands ($B1$ through $B8$, mapping to VLF/LF through Ka-band).
- Continuous vertical time-scrolling intensity heatmap.
- Glowing tactical receiver scan bracket indicating real-time receiver focus.
- Overlays for predicted high-probability regions and exploration regions.

### C. AI Dynamic Priority & Decision Engine
- Transparent scoring formula:
  $$\text{Priority}(b) = w_{\text{pred}} \cdot P(b) + w_{\text{recent}} \cdot A_{\text{recent}}(b) + w_{\text{trend}} \cdot T(b) + w_{\text{uncert}} \cdot U(b) + w_{\text{staleness}} \cdot \Delta t(b) - w_{\text{cost}} \cdot C(b)$$
- Explainable AI reason breakdown: Recent activity, Prediction, Trend, Historical, Uncertainty, Staleness.
- **Rolling 10-minute recurrence pattern analyzer**: Computes average interval between bursts and calculates soft adaptive revisit predictions.
- **Exploitation vs Exploration Contextual Bandit**: Balances high-value active channels with periodic exploration scans so low-activity bands (like B8) are never starved.

### D. Doppler Effect & Micro-Doppler Analysis
- Radar Doppler equation:
  $$f_D = \frac{2 v_r}{\lambda} = \frac{2 v_r f_0}{c}$$
- Micro-Doppler signatures for airborne targets:
  - **Aircraft**: High speed ($280\text{ m/s}$), smooth signature ($+18\text{ kHz}$).
  - **Drone (Quadcopter)**: Micro-Doppler rotor blade modulation ($+2.6\text{ kHz}$, 120 Hz blade chopping).
  - **Missile**: Extreme velocity ($600\text{ m/s}$), rapid steep Doppler shift ($+36\text{ kHz}$).
  - **Bird**: Low speed, chaotic wing-flapping modulation ($+0.8\text{ kHz}$).
  - **Ground Radar & Comms**: Continuous wave / modulated carrier baseline.

### E. RF Signal Quality & DSP Noise Reduction
- Digital Signal Processing pipeline:
  $$\text{Raw Synthetic Signal} \to \text{Noise Estimation} \to \text{Adaptive LMS Filter} \to \text{Stabilization} \to \text{Clean Signal}$$
- Dual waveform visualization: **Raw Noisy Signal** vs **Clean Filtered Signal**.
- Dynamic metrics: SNR Before (dB), SNR After (dB), Noise Level, and FFT Spectral Energy.

### F. Live Camera-to-Synthetic Radar Visualization
- In-browser computer vision motion detection via laptop webcam.
- Visual bounding box mapping to synthetic radar range (e.g. 42 m) and bearing (137°).
- Creates synthetic emitter profile ($4.72\text{ GHz} \pm 0.18\text{ GHz}$, activity level 82%).
- Web Audio API alarm beeps and visual alert banner.
- **Full Screen Alert Mode** high-visibility overlay.
- Automatic target timeout (`LOST` state) and clearance when object leaves view.

### G. One-Click "Smart Scan Demo"
Orchestrates an 8-step live walkthrough:
1. Object detected in Band 3 $\to$ AI scans B3.
2. Object hops to Band 7 $\to$ AI follows and scans B7.
3. Object hops to Band 5 $\to$ AI follows to B5.
4. Drone bursts high activity in Band 4 $\to$ AI prioritizes B4.
5. Band 8 has not been observed for long $\to$ Exploration scan assigned.
6. Rolling 10-minute recurrence pattern detected on B5 $\to$ Soft revisit scheduled.
7. Unusual pattern appears $\to$ Uncertainty rises, AI investigates.
8. Model updates based on observations $\to$ Learning cycle complete!

---

## 4. Quick Start Guide

### Prerequisites
- Python 3.10+ (tested on Python 3.14)
- Packages: `fastapi`, `uvicorn`, `numpy`, `scipy`, `scikit-learn`, `opencv-python`

### Installation & Launch

```powershell
# 1. Clone or navigate to the directory
cd "c:\Users\DELL\Desktop\swastik 2"

# 2. Run the one-click launcher
python run.py
```

The launcher starts the FastAPI backend server and automatically opens `http://127.0.0.1:8000` in your web browser.

### Running Automated Tests

```powershell
python -m unittest tests/test_swastik.py
```

---

## 5. Hero Tagline
> **“FIXED SCANNING FOLLOWS A SCHEDULE. SWASTIK FOLLOWS THE SITUATION.”**  
> **“DON’T SCAN EVERYTHING EQUALLY. SCAN WHAT MATTERS NEXT.”**  
> **OBSERVE → PREDICT → PRIORITIZE → SCAN → LEARN → REPEAT**
