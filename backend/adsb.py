"""
backend/adsb.py - Isolated ADS-B Live Aircraft Tracking Service
Retrieves publicly available civilian ADS-B state vectors from OpenSky Network REST API.
Passive visualization only - unclassified civilian tracking data.
"""
import os
import math
import time
import json
import base64
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Tuple

AIRSPACE_PRESETS: Dict[str, Dict[str, Any]] = {
    "delhi": {
        "name": "Delhi (Indira Gandhi Intl - VIDP)",
        "lat": 28.5562,
        "lon": 77.1000,
        "region": "Northern India"
    },
    "mumbai": {
        "name": "Mumbai (Chhatrapati Shivaji Intl - VABB)",
        "lat": 19.0896,
        "lon": 72.8656,
        "region": "Western India"
    },
    "bengaluru": {
        "name": "Bengaluru (Kempegowda Intl - VOBL)",
        "lat": 13.1986,
        "lon": 77.7066,
        "region": "Southern India"
    },
    "hyderabad": {
        "name": "Hyderabad (Rajiv Gandhi Intl - VOHS)",
        "lat": 17.2403,
        "lon": 78.4294,
        "region": "Central-Southern India"
    },
    "bhopal": {
        "name": "Bhopal (Raja Bhoj Airport - VABP)",
        "lat": 23.2875,
        "lon": 77.3378,
        "region": "Central India"
    },
    "indore": {
        "name": "Indore (Devi Ahilyabai Holkar - VAID)",
        "lat": 22.7218,
        "lon": 75.8011,
        "region": "Central India"
    }
}

class ADSBService:
    def __init__(self):
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl_sec: float = 12.0
        self.username = os.environ.get("OPENSKY_USERNAME")
        self.password = os.environ.get("OPENSKY_PASSWORD")

    def get_presets(self) -> Dict[str, Any]:
        return {
            key: {
                "key": key,
                "name": val["name"],
                "lat": val["lat"],
                "lon": val["lon"],
                "region": val["region"]
            }
            for key, val in AIRSPACE_PRESETS.items()
        }

    def _calculate_bounding_box(self, center_lat: float, center_lon: float, radius_km: float) -> Tuple[float, float, float, float]:
        delta_lat = radius_km / 111.0
        cos_lat = max(0.01, math.cos(math.radians(center_lat)))
        delta_lon = radius_km / (111.0 * cos_lat)

        lamin = max(-90.0, center_lat - delta_lat)
        lamax = min(90.0, center_lat + delta_lat)
        lomin = max(-180.0, center_lon - delta_lon)
        lomax = min(180.0, center_lon + delta_lon)
        return lamin, lomin, lamax, lomax

    def _geo_to_radar_xy(self, lat: float, lon: float, center_lat: float, center_lon: float) -> Tuple[float, float, float, float]:
        lat_dist_km = (lat - center_lat) * 111.0
        cos_lat = math.cos(math.radians(center_lat))
        lon_dist_km = (lon - center_lon) * 111.0 * cos_lat

        x = round(lon_dist_km, 2)
        y = round(lat_dist_km, 2)
        dist_km = round(math.hypot(x, y), 2)
        bearing = round((math.degrees(math.atan2(x, y)) + 360.0) % 360.0, 1)
        return x, y, dist_km, bearing

    def get_aircraft(
        self,
        center_lat: float = 28.5562,
        center_lon: float = 77.1000,
        radius_km: float = 100.0,
        mode: str = "live"
    ) -> Dict[str, Any]:
        now = time.time()
        radius_km = max(10.0, min(300.0, radius_km))

        if mode == "demo":
            demo_aircraft = self._generate_demo_aircraft(center_lat, center_lon, radius_km)
            return {
                "status": "DEMO",
                "status_label": "DEMO ADS-B DATA (SIMULATED)",
                "center": {"lat": center_lat, "lon": center_lon, "radius_km": radius_km},
                "aircraft_count": len(demo_aircraft),
                "aircraft": demo_aircraft,
                "timestamp": now,
                "source": "SWASTIK Synthetic ADS-B Generator",
                "disclaimer": "DEMO MODE: Simulated civilian aircraft data for testing and demonstration."
            }

        cache_key = f"{round(center_lat, 2)}_{round(center_lon, 2)}_{int(radius_km)}"
        cached = self.cache.get(cache_key)

        if cached and (now - cached["timestamp"] < self.cache_ttl_sec):
            return cached["data"]

        lamin, lomin, lamax, lomax = self._calculate_bounding_box(center_lat, center_lon, radius_km)
        url = (
            f"https://opensky-network.org/api/states/all?"
            f"lamin={lamin:.4f}&lomin={lomin:.4f}&lamax={lamax:.4f}&lomax={lomax:.4f}"
        )

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "SWASTIK-Defense-Research/2.4"})
            if self.username and self.password:
                creds = f"{self.username}:{self.password}".encode("utf-8")
                b64_creds = base64.b64encode(creds).decode("utf-8")
                req.add_header("Authorization", f"Basic {b64_creds}")

            with urllib.request.urlopen(req, timeout=4.5) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    raw_states = payload.get("states", []) or []
                    parsed_aircraft = self._parse_state_vectors(raw_states, center_lat, center_lon, radius_km)

                    result = {
                        "status": "CONNECTED",
                        "status_label": "ADS-B LIVE ●",
                        "center": {"lat": center_lat, "lon": center_lon, "radius_km": radius_km},
                        "aircraft_count": len(parsed_aircraft),
                        "aircraft": parsed_aircraft,
                        "timestamp": now,
                        "source": "OpenSky Network REST API",
                        "disclaimer": "Passive civilian ADS-B visualization. Data availability depends on OpenSky Network."
                    }

                    self.cache[cache_key] = {"timestamp": now, "data": result}
                    return result

        except urllib.error.HTTPError as http_err:
            if cached:
                cached["data"]["status"] = "RATE_LIMITED"
                cached["data"]["status_label"] = "ADS-B LIVE (CACHED - RATE LIMITED)"
                return cached["data"]

            fallback_aircraft = self._generate_demo_aircraft(center_lat, center_lon, radius_km)
            return {
                "status": "API_RATE_LIMIT",
                "status_label": "ADS-B OFFLINE (RATE LIMITED) - SHOWING DEMO",
                "center": {"lat": center_lat, "lon": center_lon, "radius_km": radius_km},
                "aircraft_count": len(fallback_aircraft),
                "aircraft": fallback_aircraft,
                "timestamp": now,
                "source": "OpenSky Network (Rate Limited - Graceful Demo Fallback)",
                "disclaimer": "Live OpenSky API rate limit reached. Displaying graceful demo fallback. Existing SWASTIK simulation unaffected."
            }

        except Exception as e:
            if cached:
                cached["data"]["status"] = "OFFLINE_CACHED"
                cached["data"]["status_label"] = "ADS-B OFFLINE (USING LAST DATA)"
                return cached["data"]

            fallback_aircraft = self._generate_demo_aircraft(center_lat, center_lon, radius_km)
            return {
                "status": "OFFLINE",
                "status_label": "ADS-B OFFLINE - DEMO ACTIVE",
                "center": {"lat": center_lat, "lon": center_lon, "radius_km": radius_km},
                "aircraft_count": len(fallback_aircraft),
                "aircraft": fallback_aircraft,
                "timestamp": now,
                "source": "Local Offline Mode",
                "disclaimer": "Live network connection unavailable. Existing SWASTIK simulation remains operational."
            }

    def _parse_state_vectors(
        self,
        states: List[List[Any]],
        center_lat: float,
        center_lon: float,
        radius_km: float
    ) -> List[Dict[str, Any]]:
        aircraft_list = []
        now = time.time()

        for s in states:
            if not isinstance(s, list) or len(s) < 11:
                continue

            icao24 = s[0]
            callsign = (s[1] or "").strip().upper()
            country = s[2] or "N/A"
            last_contact_time = s[4] or s[3] or now
            lon = s[5]
            lat = s[6]
            baro_altitude = s[7]
            on_ground = bool(s[8])
            velocity_ms = s[9]
            heading_deg = s[10]
            vertical_rate_ms = s[11] if len(s) > 11 else None
            geo_altitude = s[13] if len(s) > 13 else None

            if lat is None or lon is None:
                continue

            x, y, dist_km, bearing = self._geo_to_radar_xy(lat, lon, center_lat, center_lon)

            if dist_km > radius_km:
                continue

            altitude_m = baro_altitude if baro_altitude is not None else (geo_altitude or 0.0)
            altitude_ft = round(altitude_m * 3.28084) if altitude_m is not None else None
            speed_kmh = round(velocity_ms * 3.6, 1) if velocity_ms is not None else None
            speed_kt = round(velocity_ms * 1.94384, 1) if velocity_ms is not None else None
            vertical_rate_fpm = round(vertical_rate_ms * 196.85, 1) if vertical_rate_ms is not None else None
            sec_ago = max(0, int(now - last_contact_time))

            vr_sign = "+" if (vertical_rate_fpm and vertical_rate_fpm > 0) else ""
            vr_label = f"{vr_sign}{vertical_rate_fpm} ft/min" if vertical_rate_fpm is not None else "N/A"

            aircraft_list.append({
                "id": icao24,
                "object_id": callsign or icao24,
                "callsign": callsign or icao24,
                "country": country,
                "latitude": round(lat, 4),
                "longitude": round(lon, 4),
                "altitude_m": round(altitude_m, 1) if altitude_m is not None else None,
                "altitude_ft": altitude_ft,
                "altitude_label": f"{altitude_ft:,} ft" if altitude_ft is not None else "N/A",
                "speed_ms": velocity_ms,
                "speed_kmh": speed_kmh,
                "speed_kt": speed_kt,
                "speed_label": f"{speed_kt} kt" if speed_kt is not None else "N/A",
                "heading": round(heading_deg, 1) if heading_deg is not None else 0.0,
                "heading_deg": round(heading_deg, 1) if heading_deg is not None else 0.0,
                "vertical_rate_ms": vertical_rate_ms,
                "vertical_rate_fpm": vertical_rate_fpm,
                "vertical_rate_label": vr_label,
                "on_ground": on_ground,
                "status": "On Ground" if on_ground else "Airborne",
                "last_contact": f"{sec_ago} sec ago" if sec_ago < 120 else f"{sec_ago // 60}m ago",
                "last_contact_sec": sec_ago,
                "x": x,
                "y": y,
                "distance": dist_km,
                "bearing_deg": bearing,
                "is_adsb": True,
                "is_demo": False
            })

        aircraft_list.sort(key=lambda a: a["distance"])
        return aircraft_list

    def _generate_demo_aircraft(self, center_lat: float, center_lon: float, radius_km: float) -> List[Dict[str, Any]]:
        presets = [
            {"cs": "IGO204", "country": "India", "dist_pct": 0.25, "bearing": 42, "alt": 4200, "spd": 210, "hdg": 235, "vr": -4.2},
            {"cs": "AIC312", "country": "India", "dist_pct": 0.45, "bearing": 135, "alt": 8500, "spd": 245, "hdg": 310, "vr": 0.0},
            {"cs": "SEJ108", "country": "India", "dist_pct": 0.18, "bearing": 220, "alt": 1800, "spd": 160, "hdg": 120, "vr": 6.5},
            {"cs": "VTI445", "country": "India", "dist_pct": 0.62, "bearing": 290, "alt": 9800, "spd": 260, "hdg": 95, "vr": -2.0},
            {"cs": "UAE502", "country": "United Arab Emirates", "dist_pct": 0.78, "bearing": 275, "alt": 11200, "spd": 270, "hdg": 85, "vr": 0.0},
            {"cs": "AXB621", "country": "India", "dist_pct": 0.35, "bearing": 185, "alt": 3400, "spd": 195, "hdg": 15, "vr": 4.0},
            {"cs": "QTR571", "country": "Qatar", "dist_pct": 0.85, "bearing": 315, "alt": 11800, "spd": 275, "hdg": 110, "vr": 0.0},
            {"cs": "THY716", "country": "Turkey", "dist_pct": 0.90, "bearing": 340, "alt": 10500, "spd": 265, "hdg": 140, "vr": -1.5}
        ]

        aircraft_list = []
        for p in presets:
            dist = round(radius_km * p["dist_pct"], 1)
            b_rad = math.radians(p["bearing"])
            x = round(dist * math.sin(b_rad), 2)
            y = round(dist * math.cos(b_rad), 2)
            lat = round(center_lat + (y / 111.0), 4)
            lon = round(center_lon + (x / (111.0 * max(0.01, math.cos(math.radians(center_lat))))), 4)

            alt_m = p["alt"]
            alt_ft = round(alt_m * 3.28084)
            spd_ms = p["spd"]
            spd_kt = round(spd_ms * 1.94384, 1)
            vr_ms = p["vr"]
            vr_fpm = round(vr_ms * 196.85, 1)

            vr_sign = "+" if vr_fpm > 0 else ""
            vr_label = f"{vr_sign}{vr_fpm} ft/min" if vr_fpm != 0 else "Level (0 ft/min)"

            aircraft_list.append({
                "id": f"demo_{p['cs'].lower()}",
                "object_id": p["cs"],
                "callsign": p["cs"],
                "country": p["country"],
                "latitude": lat,
                "longitude": lon,
                "altitude_m": alt_m,
                "altitude_ft": alt_ft,
                "altitude_label": f"{alt_ft:,} ft",
                "speed_ms": spd_ms,
                "speed_kmh": round(spd_ms * 3.6, 1),
                "speed_kt": spd_kt,
                "speed_label": f"{spd_kt} kt",
                "heading": p["hdg"],
                "heading_deg": p["hdg"],
                "vertical_rate_ms": vr_ms,
                "vertical_rate_fpm": vr_fpm,
                "vertical_rate_label": vr_label,
                "on_ground": False,
                "status": "Airborne (Simulated)",
                "last_contact": "2 sec ago",
                "last_contact_sec": 2,
                "x": x,
                "y": y,
                "distance": dist,
                "bearing_deg": p["bearing"],
                "is_adsb": True,
                "is_demo": True
            })

        return aircraft_list

ADSB_SERVICE = ADSBService()
