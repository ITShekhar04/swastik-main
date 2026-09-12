"""
SWASTIK: Pydantic Data Models
Defines data structures for objects, observations, bands, scheduler decisions,
Doppler profiles, DSP signals, and WebSocket packets.
"""
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any

class ObjectModel(BaseModel):
    object_id: str
    classification: str
    x: float
    y: float
    prev_x: float = 0.0
    prev_y: float = 0.0
    distance: float
    prev_distance: float = 0.0
    distance_travelled: float = 0.0
    direction: str
    heading_deg: float = 0.0
    velocity_kmh: float = 0.0
    radial_velocity_ms: float = 0.0
    current_band: str
    confidence: float
    status: str
    risk_level: str = "MEDIUM"  # Abstract simulation priority: LOW / MEDIUM / HIGH
    history: List[Dict[str, Any]] = Field(default_factory=list)
    emitter_profile: Optional[Dict[str, Any]] = None
    created_at: float = 0.0

class BandActivityModel(BaseModel):
    band_id: str
    name: str
    freq_range: str
    activity_score: float
    observation_count: int
    last_active_time: Optional[float] = None
    seconds_since_last_scan: float = 0.0
    average_recurrence_interval_sec: Optional[float] = None
    predicted_next_activity_time: Optional[float] = None
    uncertainty: float = 0.2
    current_priority: float = 0.0
    priority_level: str = "LOW"  # HIGH / MEDIUM / LOW

class ReasonBreakdown(BaseModel):
    recent_activity_pct: float
    prediction_pct: float
    movement_trend_pct: float
    historical_activity_pct: float
    uncertainty_pct: float
    time_since_scan_pct: float

class ScanDecisionModel(BaseModel):
    selected_band: str
    previous_band: Optional[str] = None
    priority_score: float
    prediction_score: float
    exploration_score: float
    exploitation_score: float
    uncertainty_score: float
    reason: str
    reason_breakdown: ReasonBreakdown
    decision_type: str = "EXPLOIT"  # EXPLOIT / EXPLORE
    timestamp: float

class AlertModel(BaseModel):
    alert_id: str
    timestamp: float
    time_str: str
    object_id: str
    alert_type: str
    distance: float
    band: str
    classification: str
    confidence: float
    severity: str  # WARNING / CRITICAL / INFO
    message: str
    acknowledged: bool = False

class SignalQualityModel(BaseModel):
    snr_before_db: float
    snr_after_db: float
    noise_level_db: float
    signal_quality_pct: float
    filter_status: str
    noise_reduction_enabled: bool
    raw_signal: List[float]
    filtered_signal: List[float]
    time_axis: List[float]
    fft_freqs: List[float] = Field(default_factory=list)
    fft_amplitudes: List[float] = Field(default_factory=list)

class DopplerProfileModel(BaseModel):
    object_id: str
    classification: str
    center_freq_ghz: float
    radial_velocity_ms: float
    doppler_shift_khz: float
    signal_strength_db: float
    confidence: float
    micro_doppler_signature: str
    waveform: List[float]
    spectrum: List[float]

class StrategyBenchmark(BaseModel):
    strategy_name: str
    detection_probability: float
    false_alarm_rate: float
    avg_detection_delay_ms: float
    scan_efficiency: float
    prediction_accuracy: float
    exploration_coverage: float
    avg_scan_cost: float

class LiveTelemetryPacket(BaseModel):
    system_status: str
    simulation_mode: bool
    ai_confidence: float
    processing_latency_ms: float
    timestamp: float
    current_scan_band: str
    next_scan_band: str
    exploit_balance_pct: float
    explore_balance_pct: float
    active_objects: List[ObjectModel]
    bands: List[BandActivityModel]
    current_decision: ScanDecisionModel
    signal_quality: SignalQualityModel
    active_alerts: List[AlertModel]
    recent_events: List[Dict[str, Any]]
