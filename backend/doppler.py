"""
SWASTIK: Synthetic Doppler & Micro-Doppler Analysis Engine
Implements:
  - Radar Doppler shift physics: fd = (2 * v_radial) / lambda
  - Micro-Doppler modulation modeling for:
      * Aircraft (high speed, smooth signature)
      * Drone / Quadcopter (rotor blade periodic micro-Doppler)
      * Missile (very high speed, rapid strong shift)
      * Bird (low speed, irregular wing flap modulation)
      * Ground Radar (stationary, continuous wave)
      * Communication Link (voice/data modulation)
  - Distance vs Signal Strength path-loss model
  - Classification feature extraction
"""
import numpy as np
import math
from typing import Dict, Any, List

SPEED_OF_LIGHT = 3.0e8  # m/s

class DopplerEngine:
    def __init__(self):
        # Target archetype parameters based on Image 1
        self.signatures = {
            "Aircraft": {
                "typical_speed_ms": 280.0,
                "typical_band": "B5",  # X-band (10 GHz)
                "doppler_shift_khz": 18.0,
                "micro_doppler_desc": "High speed, large Doppler shift, smooth airframe signature",
                "rotor_mod_freq": 0.0,
                "color": "#00f0ff"
            },
            "Drone": {
                "typical_speed_ms": 40.0,
                "typical_band": "B3",  # UHF / S-band (2.4 GHz)
                "doppler_shift_khz": 2.6,
                "micro_doppler_desc": "Micro-Doppler blade harmonics (4-rotor periodic modulation)",
                "rotor_mod_freq": 120.0,  # 120 Hz blade chopping
                "color": "#00ff88"
            },
            "Missile": {
                "typical_speed_ms": 600.0,
                "typical_band": "B6",  # Ku-band (15 GHz)
                "doppler_shift_khz": 36.0,
                "micro_doppler_desc": "Extreme velocity, sharp high-frequency Doppler rise",
                "rotor_mod_freq": 0.0,
                "color": "#ff3344"
            },
            "Bird": {
                "typical_speed_ms": 15.0,
                "typical_band": "B3",  # 1.2 GHz
                "doppler_shift_khz": 0.8,
                "micro_doppler_desc": "Low velocity, chaotic wing-flutter modulation",
                "rotor_mod_freq": 8.0,  # 8 Hz flapping
                "color": "#a855f7"
            },
            "Radar": {
                "typical_speed_ms": 0.0,
                "typical_band": "B5",  # 9.8 GHz
                "doppler_shift_khz": 0.0,
                "micro_doppler_desc": "Stationary / ground-based continuous wave pattern",
                "rotor_mod_freq": 0.0,
                "color": "#ffaa00"
            },
            "Communication": {
                "typical_speed_ms": 0.0,
                "typical_band": "B4",  # 3.5 GHz
                "doppler_shift_khz": 0.0,
                "micro_doppler_desc": "Constant-envelope voice/data digital subcarrier",
                "rotor_mod_freq": 0.0,
                "color": "#38bdf8"
            },
            "Unknown Airborne Object": {
                "typical_speed_ms": 120.0,
                "typical_band": "B7",
                "doppler_shift_khz": 9.4,
                "micro_doppler_desc": "Unclassified dynamic spectrum signature",
                "rotor_mod_freq": 35.0,
                "color": "#e879f9"
            }
        }

    def compute_doppler_shift(
        self,
        center_freq_ghz: float,
        radial_velocity_ms: float
    ) -> float:
        """
        Calculates Doppler shift in kHz:
          fd = (2 * v * f0) / c
        """
        f0_hz = center_freq_ghz * 1e9
        wavelength = SPEED_OF_LIGHT / max(1e6, f0_hz)
        fd_hz = (2.0 * radial_velocity_ms) / wavelength
        return fd_hz / 1000.0  # return in kHz

    def compute_signal_strength(self, distance_km: float, tx_power_dbm: float = 60.0) -> float:
        """
        Calculates synthetic received signal strength in dBm as a function of distance.
        Uses path loss: Prx = Ptx - (20*log10(d) + 40)
        """
        d_clamped = max(0.2, distance_km)
        path_loss_db = 20.0 * math.log10(d_clamped * 1000.0) + 20.0
        prx_dbm = tx_power_dbm - path_loss_db
        return round(max(-105.0, min(-20.0, prx_dbm)), 1)

    def generate_micro_doppler_waveform(
        self,
        classification: str,
        doppler_shift_khz: float,
        duration_ms: float = 20.0,
        num_points: int = 64
    ) -> Dict[str, Any]:
        """
        Generates synthetic micro-Doppler time-series and spectral signatures
        matching the specific archetype curves illustrated in the system architecture.
        """
        t = np.linspace(0, duration_ms * 1e-3, num_points)
        profile = self.signatures.get(classification, self.signatures["Unknown Airborne Object"])
        rotor_freq = profile["rotor_mod_freq"]

        # Base Doppler oscillation (scaled for visual display)
        disp_freq = 45.0 + (abs(doppler_shift_khz) % 30) * 2.0
        base_wave = np.sin(2 * np.pi * disp_freq * t)

        if classification == "Drone":
            # Rotor micro-Doppler modulation (periodic high-frequency bursts)
            micro_mod = 0.55 * np.sin(2 * np.pi * rotor_freq * t) * np.cos(2 * np.pi * 3.5 * rotor_freq * t)
            wave = 0.6 * base_wave + micro_mod
        elif classification == "Aircraft":
            # Smooth body motion with slight atmospheric phase jitter
            wave = 0.9 * base_wave + 0.1 * np.sin(2 * np.pi * 0.5 * disp_freq * t)
        elif classification == "Missile":
            # Rapid rise with aerodynamic shock transient
            ramp = np.linspace(0.6, 1.4, num_points)
            wave = 0.85 * np.sin(2 * np.pi * (disp_freq * 1.8) * t) * ramp
        elif classification == "Bird":
            # Irregular flapping wave
            wing_flap = 0.4 * np.sin(2 * np.pi * rotor_freq * t + np.random.uniform(0, 0.5))
            wave = 0.4 * base_wave + wing_flap + 0.1 * np.random.normal(0, 0.15, num_points)
        elif classification in ["Radar", "Communication"]:
            # Continuous wave / modulated carrier
            wave = 0.8 * np.sin(2 * np.pi * 30.0 * t)
        else:
            wave = base_wave + 0.2 * np.random.normal(0, 0.2, num_points)

        # Normalize waveform between -1.0 and +1.0
        max_val = np.max(np.abs(wave)) or 1.0
        normalized_wave = np.round(wave / max_val, 3).tolist()

        # Generate synthetic Doppler spectrum (centered around Doppler shift)
        spectrum_bins = []
        center_bin = int(num_points / 2)
        shift_offset = int(np.clip(doppler_shift_khz * 0.4, -center_bin + 2, center_bin - 2))
        peak_idx = center_bin + shift_offset
        
        for i in range(num_points):
            dist_from_peak = abs(i - peak_idx)
            # Gaussian bell curve around Doppler peak
            amp = math.exp(-0.5 * (dist_from_peak / 3.2) ** 2)
            if classification == "Drone" and (abs(dist_from_peak - 8) < 2 or abs(dist_from_peak - 16) < 2):
                amp += 0.45  # Rotor micro-Doppler sidebands
            spectrum_bins.append(round(min(1.0, amp + np.random.uniform(0.02, 0.08)), 3))

        return {
            "classification": classification,
            "doppler_shift_khz": round(doppler_shift_khz, 2),
            "micro_doppler_signature": profile["micro_doppler_desc"],
            "waveform": normalized_wave,
            "spectrum": spectrum_bins
        }

DOPPLER_ENGINE = DopplerEngine()
