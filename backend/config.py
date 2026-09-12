"""
SWASTIK: SPECTRA-X Configuration
Contains synthetic frequency band definitions, AI scheduler weights,
radar range parameters, and simulation configurations.
"""
from pydantic import BaseModel
from typing import Dict, List, Optional

class BandDefinition(BaseModel):
    id: str
    name: str
    freq_range: str
    center_freq_ghz: float
    description: str
    typical_targets: List[str]
    nominal_cost: float = 1.0

SYNTHETIC_BANDS: Dict[str, BandDefinition] = {
    "B1": BandDefinition(
        id="B1",
        name="VLF / LF",
        freq_range="1.5 MHz - 30 MHz",
        center_freq_ghz=0.015,
        description="Long Range Comms, Navigation Beacons",
        typical_targets=["Ground Comms", "Beacons"],
        nominal_cost=1.0,
    ),
    "B2": BandDefinition(
        id="B2",
        name="HF",
        freq_range="30 MHz - 300 MHz",
        center_freq_ghz=0.165,
        description="Tactical Comms, Air Traffic Voice Links",
        typical_targets=["Aircraft Comms", "Tactical Radios"],
        nominal_cost=1.0,
    ),
    "B3": BandDefinition(
        id="B3",
        name="VHF / UHF",
        freq_range="300 MHz - 3.0 GHz",
        center_freq_ghz=1.65,
        description="UAV Telemetry, Airborne Data Links, ATC",
        typical_targets=["Drone", "Aircraft", "Bird"],
        nominal_cost=1.2,
    ),
    "B4": BandDefinition(
        id="B4",
        name="S / C Band",
        freq_range="3.0 GHz - 8.0 GHz",
        center_freq_ghz=5.5,
        description="Air Search Radar, Weather Radar, Wi-Fi Comms",
        typical_targets=["Aircraft", "Drone", "Ground Radar"],
        nominal_cost=1.3,
    ),
    "B5": BandDefinition(
        id="B5",
        name="X Band",
        freq_range="8.0 GHz - 12.0 GHz",
        center_freq_ghz=10.0,
        description="Airborne Intercept Radar, Precision Tracking",
        typical_targets=["Aircraft", "Missile", "Drone"],
        nominal_cost=1.5,
    ),
    "B6": BandDefinition(
        id="B6",
        name="Ku Band",
        freq_range="12.0 GHz - 18.0 GHz",
        center_freq_ghz=15.0,
        description="Missile Guidance Radar, High Res Airborne Radar",
        typical_targets=["Missile", "Aircraft"],
        nominal_cost=1.6,
    ),
    "B7": BandDefinition(
        id="B7",
        name="K Band",
        freq_range="18.0 GHz - 27.0 GHz",
        center_freq_ghz=22.5,
        description="High-Resolution Synthetic Aperture, Fast Targets",
        typical_targets=["Aircraft", "Missile", "High-Speed Drone"],
        nominal_cost=1.8,
    ),
    "B8": BandDefinition(
        id="B8",
        name="Ka Band",
        freq_range="27.0 GHz - 40.0 GHz",
        center_freq_ghz=33.5,
        description="Millimeter-Wave Radar, Close Range High Res Links",
        typical_targets=["Drone", "Radar", "Comms"],
        nominal_cost=2.0,
    ),
}

class SystemConfig(BaseModel):
    # Identification
    app_name: str = "SWASTIK"
    app_subtitle: str = "AI Adaptive Smart Scan & Spectrum Intelligence"
    system_version: str = "2.4.0-SIH"
    
    # Radar & Geometry Parameters
    radar_max_range_km: float = 20.0
    alert_boundary_km: float = 5.0
    concentric_rings_km: List[float] = [1.0, 2.0, 5.0, 10.0, 20.0]
    
    # AI Scheduler Weights
    weight_prediction: float = 0.28
    weight_recent_activity: float = 0.25
    weight_movement_trend: float = 0.20
    weight_historical: float = 0.12
    weight_uncertainty: float = 0.10
    weight_staleness: float = 0.08
    weight_cost: float = 0.03
    
    # Exploitation vs Exploration
    exploitation_ratio: float = 0.76  # 76% exploit, 24% explore
    
    # High-Activity Band Rolling Window (seconds)
    recurrence_window_seconds: float = 600.0  # 10 minutes
    
    # Simulation Parameters
    simulation_tick_rate_hz: float = 10.0
    radar_sweep_period_sec: float = 4.0
    noise_reduction_enabled: bool = True
    active_scenario: str = "smart_scan_demo"
    
    # Audio Alert Configuration
    audio_alerts_enabled: bool = True
    alert_volume: float = 0.7
    alert_cooldown_sec: float = 4.0

CONFIG = SystemConfig()
