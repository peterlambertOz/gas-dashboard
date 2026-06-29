"""
run_gas_forecast.py
═══════════════════════════════════════════════════════════════════════════════
Daily gas demand forecast runner — distilled from gas_demand_modelling_updated.ipynb.

Runs the YTD backcast + 16-day forward forecast using pre-trained models saved
by cell 7h of the main notebook.  Does NOT retrain models.

Prerequisites (produced by the main notebook):
  MODEL_DIR/
    nem_lgb.pkl, wind_lgb.pkl, solar_lgb.pkl, coal_lgb.pkl,
    hydro_lgb.pkl, gpg_lgb.pkl, nonpower_ols.json
  FORECAST_DIR/
    poe_empirical_table.json        ← from cell 8o
    gpg_crossplot_diagnostics.csv   ← from cell 8n

Weather download logic:
  • wx_py / wx_ytd / wx_7day CSVs are cached per calendar date.
  • Re-running on the same day re-uses today's cached files (no re-download).
  • Incremental update: if a cached wx_ytd file exists from a previous day it is
    loaded and only the gap since that file's latest row is re-fetched, then the
    two are merged and saved as today's file.  This avoids re-downloading
    Jan–Feb data that will not change.

Outputs written to FORECAST_DIR:
  gas_forecast_YYYYMMDD.csv         ← daily YTD backcast + 16-day forward (with PoE)
  gas_forecast_hourly_YYYYMMDD.csv  ← hourly NEM dispatch mix (backcast last 14d + forward)
  wx_py_YYYYMMDD.csv
  wx_ytd_YYYYMMDD.csv
  wx_7day_YYYYMMDD.csv

Usage:
  python run_gas_forecast.py
  python run_gas_forecast.py --date 2026-03-15    # back-date the run
  python run_gas_forecast.py --force-weather       # ignore cache, re-download
═══════════════════════════════════════════════════════════════════════════════
"""

import argparse
import json
import warnings
from datetime import date, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from scipy.optimize import curve_fit
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

# ── 0a. Paths ─────────────────────────────────────────────────────────────────
DATA_DIR     = Path(r"C:\Users\peter\Python\data")
FORECAST_DIR = DATA_DIR / "forecasts"
MODEL_DIR    = Path(r"C:\Users\peter\Python\models")

for _d in [FORECAST_DIR, MODEL_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ── 0b. Physical constants ────────────────────────────────────────────────────
HDD_BASE   = 18.0
CDD_BASE   = 24.0
MWH_TO_TJ  = 0.0036
EFFICIENCY = 0.37       # gas turbine heat rate denominator

# ── 0c. Capacity assumptions (2026) ──────────────────────────────────────────
CAP_WIND_NEM   = (17.64 - 6.20)  / (16.64 - 6.20)   # ~1.11
CAP_SOLAR_NEM  = (11.75 - 2.5)   / (9.75  - 2.5)    # ~1.28
CAP_COAL_NEM   = (19.84 - 19.84) / (23.0  - 19.84)  # 0.0

# ── 0d. PoE analogue settings ─────────────────────────────────────────────────
POE_DOY_WINDOW   = 21
POE_BANDWIDTH    = 0.5
POE_WINSOR_SIGMA = 3.0
POE_MIN_POOL     = 60
POE_FEATURES     = ["hdd18_nem", "cdd24_nem", "wind_speed_100m",
                    "solar_radiation", "temp"]

# ── 0e. Feature column lists — must match training exactly ────────────────────
# These are re-declared here so the script is self-contained; they MUST stay in
# sync with the main notebook cells 3b, 4c, 5c, 6d, 6e, 7a.

FEATURE_COLS_NEM = [
    "hour", "month", "dow", "is_weekend", "is_monfri",
    "sin_hour", "cos_hour", "sin_seasonal", "cos_seasonal",
    "hdd18_nem", "hdd18_nem_app", "cdd24_nem",
    "hdd_x_morning", "hdd_x_evening", "cdd_x_evening",
    "wind_speed_100m", "solar_radiation", "apparent_temp",
    "cap_t", "cap_t_x_solar", "cap_t_x_hour",
    "decay_1pct", "decay_2pct", "decay_3pct",
]

# NOTE: Wind feature list includes per-site columns.  The model predict() call
# fills missing site columns with NaN before inference (same as the notebook).
FEATURE_COLS_WIND_CORE = [
    "hour", "month", "is_weekend",
    "sin_hour", "cos_hour", "sin_seasonal", "cos_seasonal",
    "wind_speed_100m", "wind_speed",
    "cap_wind_nem", "cap_wind_x_speed",
    "wind_pc_agg",
    "decay_1pct", "decay_2pct",
]

SOLAR_FEATURE_COLS_CORE = [
    "hour", "month", "is_weekend",
    "sin_hour", "cos_hour", "sin_seasonal", "cos_seasonal",
    "solar_radiation", "cloud_cover",
    "cap_solar_nem", "cap_solar_x_rad",
    "cap_t_x_solar",
    "decay_1pct", "decay_2pct",
]

FEATURE_COLS_COAL = [
    "hour", "month", "dow", "is_weekend",
    "sin_hour", "cos_hour", "sin_seasonal", "cos_seasonal",
    "hdd18_nem", "cdd24_nem",
    "wind_speed_100m", "solar_radiation",
    "pred_wind", "pred_solar",
    "demand_minus_renewables",
    "cap_coal_nem",
    "decay_1pct", "decay_2pct", "decay_3pct",
]

FEATURE_COLS_HYDRO = [
    "hour", "month", "dow", "is_weekend",
    "sin_hour", "cos_hour", "sin_seasonal", "cos_seasonal",
    "hdd18_nem", "cdd24_nem",
    "wind_speed_100m",
    "pred_wind", "pred_solar",
    "demand_minus_renewables",
    "hydro_lag7d",
    "decay_1pct",
]

FEATURE_COLS_GPG = [
    "forecast_residual",
    "hour", "month", "dow", "is_weekend", "is_monfri",
    "sin_hour", "cos_hour", "sin_seasonal", "cos_seasonal",
    "hdd18_nem_app", "cdd24_nem",
    "wind_speed_100m", "solar_radiation",
    "pred_wind", "pred_solar", "pred_coal",
    "pred_hydro",
    "hydro_lag7d",
    "temp", "apparent_temp",
    "gas_lag7d",
]

NP_COMMON_FEATURES = [
    "sin_seasonal", "cos_seasonal",
    "doy", "month",
    "is_weekend", "is_monfri",
    "decay_1pct", "decay_2pct", "decay_3pct",
    "hdd18_se", "hdd18_se_app",
]

NP_STATE_HDD = {
    "vic": ["hdd18_vic", "hdd18_vic_app"],
    "nsw": ["hdd18_nsw", "hdd18_nsw_app"],
    "sa":  ["hdd18_sa",  "hdd18_sa_app"],
    "tas": ["hdd18_tas", "hdd18_tas_app"],
}

STATE_NP_FEATURES = {
    state: NP_STATE_HDD[state] + NP_COMMON_FEATURES
    for state in NP_STATE_HDD
}

# ── 0f. Site definitions (from notebook cell 8a) ──────────────────────────────
# Sets, weights and coordinates for weather download.
SITES = {
    "Melbourne":      {"lat": -37.814, "lon": 144.963, "roles": {"aggregate","se_weight","solar_site"}, "aggregate_weight": 2.0, "se_weight": 2.0},
    "Geelong":        {"lat": -38.149, "lon": 144.352, "roles": {"aggregate","se_weight","solar_site"}, "aggregate_weight": 2.0, "se_weight": 2.0},
    "Sydney":         {"lat": -33.869, "lon": 151.209, "roles": {"aggregate","se_weight","solar_site"}, "aggregate_weight": 1.0, "se_weight": 1.0},
    "Adelaide":       {"lat": -34.929, "lon": 138.601, "roles": {"aggregate","se_weight","solar_site"}, "aggregate_weight": 1.0, "se_weight": 1.0},
    "Canberra":       {"lat": -35.281, "lon": 149.130, "roles": {"aggregate","se_weight","solar_site"}, "aggregate_weight": 0.5, "se_weight": 0.5},
    "Hobart":         {"lat": -42.882, "lon": 147.327, "roles": {"aggregate","se_weight","solar_site"}, "aggregate_weight": 0.5, "se_weight": 0.5},
    "Brisbane":       {"lat": -27.468, "lon": 153.028, "roles": {"aggregate","solar_site"},             "aggregate_weight": 1.0},
    "Bendigo":        {"lat": -36.767, "lon": 144.283, "roles": {"solar_site"}},
    "Broken_Hill":    {"lat": -31.950, "lon": 141.467, "roles": {"solar_site"}},
    "Cairns":         {"lat": -16.917, "lon": 145.767, "roles": {"solar_site"}},
    "Chinchilla":     {"lat": -26.733, "lon": 150.633, "roles": {"solar_site"}},
    "Dubbo":          {"lat": -32.267, "lon": 148.600, "roles": {"solar_site"}},
    "Gold_Coast":     {"lat": -28.000, "lon": 153.433, "roles": {"solar_site"}},
    "Longreach":      {"lat": -23.433, "lon": 144.267, "roles": {"solar_site"}},
    "Mildura":        {"lat": -34.233, "lon": 142.133, "roles": {"solar_site"}},
    "Moree":          {"lat": -29.467, "lon": 149.833, "roles": {"solar_site"}},
    "Newcastle":      {"lat": -32.917, "lon": 151.750, "roles": {"solar_site"}},
    "Port_Augusta":   {"lat": -32.490, "lon": 137.763, "roles": {"solar_site"}},
    "Shepparton":     {"lat": -36.383, "lon": 145.400, "roles": {"solar_site"}},
    "Townsville":     {"lat": -19.250, "lon": 146.817, "roles": {"solar_site"}},
    "Wagga_Wagga":    {"lat": -35.117, "lon": 147.367, "roles": {"solar_site"}},
    "Wollongong":     {"lat": -34.425, "lon": 150.893, "roles": {"solar_site"}},
    "Ararat":         {"lat": -37.283, "lon": 143.000, "roles": {"wind_farm","solar_site"}},
    "Bald_Hills":     {"lat": -38.417, "lon": 145.617, "roles": {"wind_farm","solar_site"}},
    "Ballarat":       {"lat": -37.562, "lon": 143.849, "roles": {"solar_site"}},
    "Bango":          {"lat": -34.733, "lon": 149.050, "roles": {"wind_farm","solar_site"}},
    "Boco_Rock":      {"lat": -36.983, "lon": 149.283, "roles": {"wind_farm","solar_site"}},
    "Coopers_Gap":    {"lat": -26.817, "lon": 151.033, "roles": {"wind_farm","solar_site"}},
    "Crookwell_NSW":  {"lat": -34.467, "lon": 149.467, "roles": {"wind_farm","solar_site"}},
    "Dulacca":        {"lat": -26.667, "lon": 149.783, "roles": {"wind_farm","solar_site"}},
    "Glen_Innes":     {"lat": -29.733, "lon": 151.733, "roles": {"wind_farm","solar_site"}},
    "Hallett":        {"lat": -33.417, "lon": 138.900, "roles": {"wind_farm","solar_site"}},
    "Jamestown":      {"lat": -33.207, "lon": 138.600, "roles": {"wind_farm","solar_site"}},
    "Mortlake":       {"lat": -38.083, "lon": 142.800, "roles": {"wind_farm","solar_site"}},
    "Musselroe":      {"lat": -40.883, "lon": 148.183, "roles": {"wind_farm","solar_site"}},
    "Nundle":         {"lat": -31.467, "lon": 151.133, "roles": {"wind_farm","solar_site"}},
    "Portland_VIC":   {"lat": -38.335, "lon": 141.604, "roles": {"wind_farm","solar_site"}},
    "Rye_Park_NSW":   {"lat": -34.517, "lon": 148.767, "roles": {"wind_farm","solar_site"}},
    "Snowtown":       {"lat": -33.775, "lon": 138.217, "roles": {"wind_farm","solar_site"}},
    "Warrnambool":    {"lat": -38.384, "lon": 142.487, "roles": {"solar_site"}},
    "Wonthaggi":      {"lat": -38.608, "lon": 145.716, "roles": {"wind_farm","solar_site"}},
    "Woolnorth":      {"lat": -40.683, "lon": 144.717, "roles": {"wind_farm","solar_site"}},
    "Yorke_Peninsula":{"lat": -34.917, "lon": 137.583, "roles": {"wind_farm","solar_site"}},
}

STATE_HDD_WEIGHTS = {
    "vic": {"Melbourne": 2.0, "Geelong": 2.0, "Ballarat": 0.5, "Ararat": 0.5},
    "nsw": {"Sydney": 1.0, "Canberra": 0.5, "Newcastle": 0.5, "Wagga_Wagga": 0.5},
    "sa":  {"Adelaide": 1.0, "Port_Augusta": 0.5},
    "tas": {"Hobart": 1.0, "Musselroe": 0.5},
}

ALL_VARS = [
    "temperature_2m", "apparent_temperature",
    "shortwave_radiation", "cloud_cover",
    "wind_speed_10m", "wind_speed_100m", "wind_direction_100m",
]


# ══════════════════════════════════════════════════════════════════════════════
# 1. UTILITY FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def turbine_power_curve(speed_ms, rated_speed=12.5, cut_in=3.0, cut_out=25.0):
    """Smooth cubic turbine power curve (0→1 normalised output)."""
    out = np.zeros_like(speed_ms, dtype=float)
    mask_ramp  = (speed_ms >= cut_in) & (speed_ms < rated_speed)
    mask_rated = (speed_ms >= rated_speed) & (speed_ms < cut_out)
    out[mask_ramp]  = ((speed_ms[mask_ramp] - cut_in) / (rated_speed - cut_in)) ** 3
    out[mask_rated] = 1.0
    return out


def compute_state_hdd(df, state_weights, hdd_base=HDD_BASE):
    """Add hdd18_{state} and hdd18_{state}_app columns from per-site temperature cols."""
    for state, sites in state_weights.items():
        total_w   = sum(sites.values())
        t_agg     = np.zeros(len(df))
        t_app_agg = np.zeros(len(df))
        actual_w  = 0.0
        for site, w in sites.items():
            t_col   = f"{site}_temperature_2m"
            ta_col  = f"{site}_apparent_temperature"
            if t_col in df.columns:
                t_agg     += df[t_col].fillna(0).values * w
                actual_w  += w
            if ta_col in df.columns:
                t_app_agg += df[ta_col].fillna(0).values * w
        denom          = actual_w if actual_w > 0 else total_w
        df[f"hdd18_{state}"]     = np.clip(hdd_base - t_agg / denom,     0, None)
        df[f"hdd18_{state}_app"] = np.clip(hdd_base - t_app_agg / denom, 0, None)
        df[f"cdd24_{state}"]     = np.clip(t_agg / denom - 24.0,         0, None)
    return df


def add_calendar_and_decay(df, anchor=pd.Timestamp("2020-01-01")):
    """Add standard calendar + seasonal + decay columns to an hourly frame."""
    df["datetime"]     = pd.to_datetime(df["datetime"])
    df["date"]         = df["datetime"].dt.normalize()
    df["hour"]         = df["datetime"].dt.hour
    df["doy"]          = df["datetime"].dt.dayofyear
    df["dow"]          = df["datetime"].dt.dayofweek
    df["month"]        = df["datetime"].dt.month
    df["year"]         = df["datetime"].dt.year
    df["is_weekend"]   = (df["dow"] >= 5).astype(int)
    df["is_monfri"]    = df["dow"].isin([0, 4]).astype(int)
    df["sin_hour"]     = np.sin(2 * np.pi * df["hour"]  / 24)
    df["cos_hour"]     = np.cos(2 * np.pi * df["hour"]  / 24)
    df["sin_seasonal"] = np.sin(2 * np.pi * df["doy"]   / 365.25)
    df["cos_seasonal"] = np.cos(2 * np.pi * df["doy"]   / 365.25)
    _days = (df["datetime"] - anchor).dt.total_seconds() / 86400
    for pct in [1, 2, 3]:
        k = np.log(1 + pct / 100) / 365.25
        df[f"decay_{pct}pct"] = np.exp(-k * _days)
    return df


def add_interaction_terms(df):
    """Interaction terms used by NEM and GPG models."""
    df["hdd_x_morning"] = df["hdd18_nem_app"] * df["hour"].isin([6,7,8,9]).astype(float)
    df["hdd_x_evening"] = df["hdd18_nem_app"] * df["hour"].isin([17,18,19,20]).astype(float)
    df["cdd_x_evening"] = df["cdd24_nem"]     * df["hour"].isin([17,18,19,20]).astype(float)
    return df


def add_capacity_features(df,
                           cap_wind=CAP_WIND_NEM,
                           cap_solar=CAP_SOLAR_NEM,
                           cap_coal=CAP_COAL_NEM):
    """Add capacity index columns for forecast / backcast periods."""
    df["cap_t"]             = 1.0
    df["cap_wind_nem"]      = cap_wind
    df["cap_wind_x_speed"]  = df["cap_wind_nem"] * df["wind_speed_100m"]
    df["cap_solar_nem"]     = cap_solar
    df["cap_solar_x_rad"]   = df["cap_solar_nem"] * df["solar_radiation"]
    df["cap_coal_nem"]      = cap_coal
    df["cap_t_x_solar"]     = df["cap_t"] * df["solar_radiation"]
    df["cap_t_x_hour"]      = df["cap_t"] * df["hour"]
    return df


def add_solar_features(df):
    """Aggregate per-site shortwave/cloud to solar_radiation and cloud_cover."""
    solar_sites = {n: i for n, i in SITES.items() if "solar_site" in i["roles"]}
    rad_cols  = [f"{n}_shortwave_radiation" for n in solar_sites if f"{n}_shortwave_radiation" in df.columns]
    cc_cols   = [f"{n}_cloud_cover"         for n in solar_sites if f"{n}_cloud_cover"         in df.columns]
    if rad_cols:
        df["solar_radiation"] = df[rad_cols].mean(axis=1)
    if cc_cols:
        df["cloud_cover"] = df[cc_cols].mean(axis=1)
    return df


def add_wind_power_curve(df):
    """Add turbine power curve aggregate across wind farm sites."""
    wind_sites = {n for n, i in SITES.items() if "wind_farm" in i["roles"]}
    pc_cols = []
    for name in wind_sites:
        speed_col = f"{name}_wind_speed_100m"
        pc_col    = f"{name}_power_curve"
        if speed_col in df.columns:
            df[pc_col] = turbine_power_curve(df[speed_col].values)
            pc_cols.append(pc_col)
    df["wind_pc_agg"] = df[pc_cols].mean(axis=1) if pc_cols else 0.0
    return df


def ensure_cols(df, cols, fill=np.nan):
    """Add any missing columns filled with `fill`."""
    for col in cols:
        if col not in df.columns:
            df[col] = fill
    return df


# ══════════════════════════════════════════════════════════════════════════════
# 2. WEATHER DOWNLOAD
# ══════════════════════════════════════════════════════════════════════════════

def _fetch_historical(lat, lon, start, end):
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {"latitude": lat, "longitude": lon,
              "start_date": str(start), "end_date": str(end),
              "hourly": ",".join(ALL_VARS), "timezone": "Australia/Brisbane"}
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    df = pd.DataFrame(r.json()["hourly"])
    df["datetime"] = pd.to_datetime(df["time"])
    return df.drop(columns=["time"])


def _fetch_forecast_wx(lat, lon):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {"latitude": lat, "longitude": lon,
              "hourly": ",".join(ALL_VARS),
              "timezone": "Australia/Brisbane", "forecast_days": 16}
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    df = pd.DataFrame(r.json()["hourly"])
    df["datetime"] = pd.to_datetime(df["time"])
    return df.drop(columns=["time"])


def _fetch_site(lat, lon, history_start, today):
    df_hist = _fetch_historical(lat, lon, history_start, today - timedelta(days=1))
    df_fc   = _fetch_forecast_wx(lat, lon)
    df_all  = pd.concat([df_hist, df_fc], ignore_index=True)
    return df_all.drop_duplicates(subset=["datetime"]).sort_values("datetime")


def _build_wx_frame(site_frames):
    """
    Aggregate per-site frames into the combined weather frame used by the models.
    Returns wx_fc (full year), wx_py, wx_ytd, wx_7day.
    """
    today = date.today()
    agg_sites = {n: i for n, i in SITES.items() if "aggregate" in i["roles"]}
    se_sites  = {n: i for n, i in SITES.items() if "se_weight"  in i["roles"]}

    agg_total = sum(i["aggregate_weight"] for i in agg_sites.values())
    se_total  = sum(i["se_weight"]        for i in se_sites.values())

    base_dt = site_frames[next(iter(agg_sites))]["datetime"]
    wx_fc   = pd.DataFrame({"datetime": base_dt.values})

    # Population-weighted aggregates
    for var in ALL_VARS:
        wx_fc[var] = sum(
            site_frames[n][var].values * i["aggregate_weight"]
            for n, i in agg_sites.items() if n in site_frames
        ) / agg_total

    # HDD / CDD
    wx_fc["hdd18_nem"]     = (HDD_BASE - wx_fc["temperature_2m"]).clip(lower=0)
    wx_fc["cdd24_nem"]     = (wx_fc["temperature_2m"] - CDD_BASE).clip(lower=0)
    wx_fc["hdd18_nem_app"] = (HDD_BASE - wx_fc["apparent_temperature"]).clip(lower=0)

    se_temp     = sum(site_frames[n]["temperature_2m"].values      * i["se_weight"]
                      for n, i in se_sites.items() if n in site_frames) / se_total
    se_app_temp = sum(site_frames[n]["apparent_temperature"].values * i["se_weight"]
                      for n, i in se_sites.items() if n in site_frames) / se_total
    wx_fc["hdd18_se"]     = np.clip(HDD_BASE - se_temp,     0, None)
    wx_fc["hdd18_se_app"] = np.clip(HDD_BASE - se_app_temp, 0, None)

    # Per-site temperature cols for state HDD
    for site, info in SITES.items():
        if site in site_frames:
            df_s = site_frames[site].set_index("datetime")
            idx  = wx_fc["datetime"]
            for var in ("temperature_2m", "apparent_temperature"):
                col = f"{site}_{var}"
                wx_fc[col] = df_s[var].reindex(idx).values if var in df_s.columns else np.nan

    wx_fc = compute_state_hdd(wx_fc, STATE_HDD_WEIGHTS)

    # Per-site wind cols
    wind_sites = {n: i for n, i in SITES.items() if "wind_farm" in i["roles"]}
    for name in wind_sites:
        if name not in site_frames:
            continue
        df_s = site_frames[name].set_index("datetime")
        idx  = wx_fc["datetime"]
        wx_fc[f"{name}_wind_speed_10m"]    = df_s["wind_speed_10m"].reindex(idx).values
        wx_fc[f"{name}_wind_speed_100m"]   = df_s["wind_speed_100m"].reindex(idx).values
        wd_rad = np.deg2rad(df_s["wind_direction_100m"].reindex(idx).values)
        wx_fc[f"{name}_wind_dir_sin_100m"] = np.sin(wd_rad)
        wx_fc[f"{name}_wind_dir_cos_100m"] = np.cos(wd_rad)

    # Power curve
    pc_cols = []
    for name in wind_sites:
        speed_col = f"{name}_wind_speed_100m"
        pc_col    = f"{name}_power_curve"
        if speed_col in wx_fc.columns:
            wx_fc[pc_col] = turbine_power_curve(wx_fc[speed_col].values)
            pc_cols.append(pc_col)
    wx_fc["wind_pc_agg"] = wx_fc[pc_cols].mean(axis=1) if pc_cols else 0.0

    # Per-site solar cols
    solar_sites = {n: i for n, i in SITES.items() if "solar_site" in i["roles"]}
    for name in solar_sites:
        if name not in site_frames:
            continue
        df_s = site_frames[name].set_index("datetime")
        idx  = wx_fc["datetime"]
        wx_fc[f"{name}_shortwave_radiation"] = df_s["shortwave_radiation"].reindex(idx).values
        wx_fc[f"{name}_cloud_cover"]         = df_s["cloud_cover"].reindex(idx).values

    # Rename to training-data names
    wx_fc = wx_fc.rename(columns={
        "temperature_2m":       "temp",
        "apparent_temperature": "apparent_temp",
        "shortwave_radiation":  "solar_radiation",
        "wind_speed_10m":       "wind_speed",
        "wind_speed_100m":      "wind_speed_100m",
    })

    # Calendar / decay
    wx_fc = add_calendar_and_decay(wx_fc)

    # Split
    ytd_start = pd.Timestamp(date(today.year, 1, 1))
    wx_py   = wx_fc[wx_fc["date"].dt.year == today.year - 1].copy().reset_index(drop=True)
    wx_ytd  = wx_fc[(wx_fc["date"] >= ytd_start) &
                    (wx_fc["date"] <  pd.Timestamp(today))].copy().reset_index(drop=True)
    wx_7day = wx_fc[wx_fc["date"] >= pd.Timestamp(today)].copy().reset_index(drop=True)

    return wx_py, wx_ytd, wx_7day


CACHE_REUSE_DAYS = 30   # look back up to this many days for a reusable YTD file


def _find_best_cache(today, ytd_path):
    """
    Search FORECAST_DIR for wx_ytd_*.csv files from the past CACHE_REUSE_DAYS days
    (excluding today's file, which we're about to create).  Returns the most
    recent usable file as (path, DataFrame), or (None, None) if none found.

    "Usable" means:
      • Filename date is within the current calendar year (no cross-year reuse).
      • File is readable and has a parseable 'date' column.
      • The file's latest data row is before today (stale-future rows are ignored).
    """
    ytd_start  = date(today.year, 1, 1)
    cutoff     = today - timedelta(days=CACHE_REUSE_DAYS)

    candidates = sorted(FORECAST_DIR.glob("wx_ytd_????????.csv"), reverse=True)
    for path in candidates:
        if path == ytd_path:
            continue
        # Parse date from filename
        try:
            file_date = date.fromisoformat(
                f"{path.stem[-8:-4]}-{path.stem[-4:-2]}-{path.stem[-2:]}"
            )
        except ValueError:
            continue
        # Must be same calendar year and within the lookback window
        if file_date < cutoff or file_date.year != today.year:
            continue
        try:
            df = pd.read_csv(path, parse_dates=["datetime", "date"])
            prev_max = df["date"].max().date()
            if prev_max < ytd_start:
                continue   # empty or cross-year stale data
            print(f"  Found reusable cache: {path.name}  "
                  f"(file date {file_date}, data covers → {prev_max})")
            return path, df, prev_max
        except Exception as e:
            print(f"  Skipping {path.name}: {e}")
            continue

    return None, None, None


def get_weather(today, force=False):
    """
    Return (wx_py, wx_ytd, wx_7day) for today.

    Cache strategy
    ──────────────
    1. Today's complete files already on disk → load and return immediately.
    2. A wx_ytd file exists from any run within the past CACHE_REUSE_DAYS days
       (same calendar year) → load it, fetch only the gap between that file's
       last row and yesterday, merge all rows, save as today's files.
    3. No usable cache found → full download from 1 Jan.

    The 30-day window means the script stays incremental even when run weekly
    or fortnightly, without ever re-fetching data that won't have changed.
    Use --force-weather to bypass all caching.
    """
    today_str = today.strftime("%Y%m%d")
    ytd_path  = FORECAST_DIR / f"wx_ytd_{today_str}.csv"
    fwd_path  = FORECAST_DIR / f"wx_7day_{today_str}.csv"
    py_path   = FORECAST_DIR / f"wx_py_{today_str}.csv"
    ytd_start = date(today.year, 1, 1)

    # ── Case 1: today's files already on disk ────────────────────────────────
    if not force and ytd_path.exists() and fwd_path.exists() and py_path.exists():
        print(f"Weather cache hit for {today_str} — loading from disk")
        wx_py   = pd.read_csv(py_path,  parse_dates=["datetime", "date"])
        wx_ytd  = pd.read_csv(ytd_path, parse_dates=["datetime", "date"])
        wx_7day = pd.read_csv(fwd_path, parse_dates=["datetime", "date"])
        print(f"  wx_ytd : {len(wx_ytd):,} rows  wx_7day : {len(wx_7day):,} rows")
        return wx_py, wx_ytd, wx_7day

    # ── Case 2: look for any reusable YTD file in the past 30 days ───────────
    prev_wx_ytd = None
    gap_start   = ytd_start   # default: full download from 1 Jan

    if not force:
        _, prev_wx_ytd, prev_max = _find_best_cache(today, ytd_path)
        if prev_wx_ytd is not None:
            gap_start = prev_max + timedelta(days=1)
            print(f"  Incremental fetch: {gap_start} → {today - timedelta(days=1)}"
                  f"  ({(today - gap_start).days} days)")
        else:
            print(f"  No reusable cache within {CACHE_REUSE_DAYS} days — "
                  f"full download from {ytd_start}")

    # ── Download per-site frames (gap only, or full YTD if no cache) ──────────
    # Always fetch the 16-day forward forecast regardless of gap size.
    need_hist = gap_start <= today - timedelta(days=1)

    DOWNLOAD_RETRIES = 3
    DOWNLOAD_RETRY_DELAY = 5   # seconds between retries

    print(f"\nDownloading {len(SITES)} sites…")
    site_frames = {}
    for name, info in SITES.items():
        last_exc = None
        for attempt in range(1, DOWNLOAD_RETRIES + 1):
            try:
                frames = []
                if need_hist:
                    frames.append(_fetch_historical(
                        info["lat"], info["lon"], gap_start, today - timedelta(days=1)
                    ))
                frames.append(_fetch_forecast_wx(info["lat"], info["lon"]))
                df_all = pd.concat(frames, ignore_index=True)
                site_frames[name] = (
                    df_all.drop_duplicates(subset=["datetime"]).sort_values("datetime")
                )
                last_exc = None
                print(f"  OK    {name}")
                break   # success
            except Exception as e:
                last_exc = e
                if attempt < DOWNLOAD_RETRIES:
                    import time
                    print(f"  RETRY {attempt}/{DOWNLOAD_RETRIES}  {name}: {e}")
                    time.sleep(DOWNLOAD_RETRY_DELAY)
        if last_exc is not None:
            print(f"  WARN  {name}: failed after {DOWNLOAD_RETRIES} attempts — {last_exc}")

    wx_py, wx_ytd_new, wx_7day = _build_wx_frame(site_frames)

    # ── Merge cached rows with newly downloaded gap ───────────────────────────
    if prev_wx_ytd is not None and len(wx_ytd_new) > 0:
        # Retain everything in the cached file strictly before gap_start,
        # then append the freshly downloaded rows.
        prev_keep = prev_wx_ytd[prev_wx_ytd["date"].dt.date < gap_start].copy()
        wx_ytd = (
            pd.concat([prev_keep, wx_ytd_new], ignore_index=True)
            .drop_duplicates(subset=["datetime"])
            .sort_values("datetime")
            .reset_index(drop=True)
        )
        print(f"  Merged: {len(prev_keep):,} cached + {len(wx_ytd_new):,} new "
              f"= {len(wx_ytd):,} total YTD rows")
    else:
        wx_ytd = wx_ytd_new

    # ── Save today's files ────────────────────────────────────────────────────
    wx_py.to_csv(py_path,   index=False)
    wx_ytd.to_csv(ytd_path, index=False)
    wx_7day.to_csv(fwd_path, index=False)
    print(f"Saved wx files → {FORECAST_DIR}")

    return wx_py, wx_ytd, wx_7day


# ══════════════════════════════════════════════════════════════════════════════
# 3. MODEL LOADING
# ══════════════════════════════════════════════════════════════════════════════

def load_models():
    """Load all pre-trained models from MODEL_DIR (saved by notebook cell 7h)."""
    print(f"\nLoading models from {MODEL_DIR}…")
    models = {}
    for key in ["nem", "wind", "solar", "coal", "hydro", "gpg"]:
        path = MODEL_DIR / f"{key}_lgb.pkl"
        models[key] = joblib.load(path)
        print(f"  ✓  {key}_lgb.pkl")

    # Non-power OLS coefficients
    with open(MODEL_DIR / "nonpower_ols.json") as f:
        ols = json.load(f)
    print(f"  ✓  nonpower_ols.json  "
          f"(α={ols['intercept']:.1f}  β_HDD={ols['beta_hdd18']:.4f})")

    # Per-state non-power LightGBM
    state_models = {}
    for state in ["vic", "nsw", "sa", "tas"]:
        path = MODEL_DIR / f"nonpower_{state}_lgb.pkl"
        if path.exists():
            state_models[state] = joblib.load(path)
            print(f"  ✓  nonpower_{state}_lgb.pkl")
        else:
            print(f"  !  nonpower_{state}_lgb.pkl not found — state will use OLS fallback")
            state_models[state] = None

    return models, ols, state_models


# ══════════════════════════════════════════════════════════════════════════════
# 4. FEATURE CONSTRUCTION
# ══════════════════════════════════════════════════════════════════════════════

def build_hourly_features(wx, seasonal_lags_df=None):
    """
    Build the full hourly feature frame from a weather frame.
    `seasonal_lags_df` is a DataFrame with [month, hour] → lag means,
    used to bootstrap gas/coal/hydro lag features.
    """
    h = wx.copy()

    # Ensure solar_radiation / cloud_cover are aggregated from per-site cols
    if "solar_radiation" not in h.columns or h["solar_radiation"].isna().all():
        h = add_solar_features(h)

    # Add wind power curve if not present
    if "wind_pc_agg" not in h.columns:
        h = add_wind_power_curve(h)

    h = add_interaction_terms(h)
    h = add_capacity_features(h)

    # Lag features — merge seasonal means by month/hour (fast vectorised join)
    # seasonal_lags_df must have columns: month, hour, gas_lag7d, hydro_lag7d, coal_lag7d
    # matching the names saved by notebook cell 7h-lag.
    lag_cols = ["gas_lag7d", "hydro_lag7d", "coal_lag7d"]
    if seasonal_lags_df is not None:
        missing = [c for c in lag_cols if c not in h.columns]
        if missing:
            h = h.merge(
                seasonal_lags_df[["month", "hour"] + [c for c in lag_cols if c in seasonal_lags_df.columns]],
                on=["month", "hour"],
                how="left",
            )
    for col in lag_cols:
        if col not in h.columns:
            h[col] = np.nan

    h["demand_minus_renewables"] = h["hdd18_nem"] * 1000 + 8000  # placeholder

    return h


def _is_generic_names(names):
    """True if LightGBM assigned Column_N placeholder names (no named features)."""
    return all(n.startswith("Column_") for n in names[:3]) if names else True


def _model_features(model, fallback):
    """
    Return the feature list to use for a model.
    If the model has real named features, use them.
    If it only has generic Column_N names (trained without a DataFrame),
    return the fallback list — prediction will be done positionally.
    """
    if hasattr(model, "feature_name_"):
        names = list(model.feature_name_)
        if not _is_generic_names(names):
            return names
    return fallback


def _predict(model, h, cols):
    """
    Predict from h using cols.
    If cols are real named columns present in h, select by name.
    If cols are generic Column_N names, predict positionally using the
    fallback column order — the model receives h[cols_present].values
    where cols_present is the fallback list in order.
    This handles models trained with .values arrays (no column names).
    """
    if _is_generic_names(cols):
        # Positional: cols IS the fallback list, already in training order
        # ensure_cols has already added any missing cols as NaN
        return model.predict(h[cols].values)
    else:
        ensure_cols(h, cols)
        return model.predict(h[cols].values)


def run_cascade(h, models):
    """
    Run the full NEM dispatch cascade on hourly frame h.
    Uses _model_features() to get column lists: real names if the model
    was trained with a DataFrame, static fallback lists (in training order)
    if it was trained with .values arrays and has generic Column_N names.
    Returns h with all pred_* columns populated.
    """
    nem_lgb   = models["nem"]
    wind_lgb  = models["wind"]
    solar_lgb = models["solar"]
    coal_lgb  = models["coal"]
    hydro_lgb = models["hydro"]
    gpg_lgb   = models["gpg"]

    cols_nem   = _model_features(nem_lgb,   FEATURE_COLS_NEM)
    cols_wind  = _model_features(wind_lgb,  FEATURE_COLS_WIND_CORE)
    cols_solar = _model_features(solar_lgb, SOLAR_FEATURE_COLS_CORE)
    cols_coal  = _model_features(coal_lgb,  FEATURE_COLS_COAL)
    cols_hydro = _model_features(hydro_lgb, FEATURE_COLS_HYDRO)
    cols_gpg   = _model_features(gpg_lgb,   FEATURE_COLS_GPG)

    ensure_cols(h, cols_nem)
    h["pred_nem_h"] = np.maximum(0, _predict(nem_lgb, h, cols_nem))

    ensure_cols(h, cols_wind)
    h["pred_wind"] = np.maximum(0, _predict(wind_lgb, h, cols_wind))

    ensure_cols(h, cols_solar)
    h["pred_solar"] = np.maximum(0, _predict(solar_lgb, h, cols_solar))

    h["demand_minus_renewables"] = (h["pred_nem_h"] - h["pred_wind"] - h["pred_solar"]).clip(lower=0)

    ensure_cols(h, cols_coal)
    h["pred_coal"] = np.maximum(0, _predict(coal_lgb, h, cols_coal))

    ensure_cols(h, cols_hydro)
    h["pred_hydro"] = np.maximum(0, _predict(hydro_lgb, h, cols_hydro))

    h["forecast_residual"] = (h["pred_nem_h"] - h["pred_wind"] - h["pred_solar"] - h["pred_coal"]).clip(lower=0)

    ensure_cols(h, cols_gpg)
    h["pred_gpg_mwh"] = np.maximum(0, _predict(gpg_lgb, h, cols_gpg))
    h["pred_gpg_tj"]  = h["pred_gpg_mwh"] * MWH_TO_TJ / EFFICIENCY

    h["residual_unclipped"] = (
        h["pred_nem_h"] - h["pred_wind"] - h["pred_solar"]
        - h["pred_coal"] - h["pred_hydro"] - h["pred_gpg_mwh"]
    )

    return h


def aggregate_to_daily(h, ols, state_models):
    """Aggregate hourly cascade output to daily TJ + non-power demand."""
    daily = h.groupby("date").agg(
        pred_gpg_tj    = ("pred_gpg_tj",    "sum"),
        pred_nem_mwh   = ("pred_nem_h",     "sum"),
        pred_wind_mwh  = ("pred_wind",      "sum"),
        pred_solar_mwh = ("pred_solar",     "sum"),
        pred_coal_mwh  = ("pred_coal",      "sum"),
        pred_hydro_mwh = ("pred_hydro",     "sum"),
        hdd18_nem      = ("hdd18_nem",      "mean"),
        cdd24_nem      = ("cdd24_nem",      "mean"),
        hdd18_se       = ("hdd18_se",       "mean"),
        hdd18_se_app   = ("hdd18_se_app",   "mean"),
        hdd18_vic      = ("hdd18_vic",      "mean"),
        hdd18_vic_app  = ("hdd18_vic_app",  "mean"),
        hdd18_nsw      = ("hdd18_nsw",      "mean"),
        hdd18_nsw_app  = ("hdd18_nsw_app",  "mean"),
        hdd18_sa       = ("hdd18_sa",       "mean"),
        hdd18_sa_app   = ("hdd18_sa_app",   "mean"),
        hdd18_tas      = ("hdd18_tas",      "mean"),
        hdd18_tas_app  = ("hdd18_tas_app",  "mean"),
        wind_speed_100m = ("wind_speed_100m", "mean"),
        solar_radiation = ("solar_radiation", "mean"),
        is_weekend     = ("is_weekend",     "first"),
        is_monfri      = ("is_monfri",      "first"),
        sin_seasonal   = ("sin_seasonal",   "first"),
        cos_seasonal   = ("cos_seasonal",   "first"),
        doy            = ("doy",            "first"),
        month          = ("month",          "first"),
        decay_1pct     = ("decay_1pct",     "first"),
        decay_2pct     = ("decay_2pct",     "first"),
        decay_3pct     = ("decay_3pct",     "first"),
    ).reset_index()

    # Per-state non-power LightGBM
    for state, model in state_models.items():
        feats   = STATE_NP_FEATURES[state]
        missing = [f for f in feats if f not in daily.columns]
        for col in missing:
            daily[col] = 0.0
        if model is not None:
            daily[f"pred_{state}_nonpower_tj"] = np.maximum(0, model.predict(daily[feats].values))
        else:
            # OLS fallback for this state
            daily[f"pred_{state}_nonpower_tj"] = np.maximum(0,
                ols["intercept"]
                + ols["beta_hdd18"]   * daily["hdd18_se"]
                + ols["beta_weekend"] * daily["is_weekend"]
                + ols["beta_monfri"]  * daily["is_monfri"]
            ) * 0.25  # rough equal-state split

    daily["pred_nonpower_tj"] = sum(
        daily[f"pred_{s}_nonpower_tj"] for s in ["vic", "nsw", "sa", "tas"]
    )

    # SE OLS crosscheck column (for diagnostics)
    daily["pred_nonpower_tj_ols"] = np.maximum(0,
        ols["intercept"]
        + ols["beta_hdd18"]   * daily["hdd18_se"]
        + ols["beta_weekend"] * daily["is_weekend"]
        + ols["beta_monfri"]  * daily["is_monfri"]
    )

    daily["pred_total_tj"] = daily["pred_gpg_tj"] + daily["pred_nonpower_tj"]
    return daily


# ══════════════════════════════════════════════════════════════════════════════
# 5. POE BANDS
# ══════════════════════════════════════════════════════════════════════════════

def load_poe_params():
    """Load continuous_params from poe_empirical_table.json (cell 8o output)."""
    path = FORECAST_DIR / "poe_empirical_table.json"
    if not path.exists():
        print(f"  WARN: {path.name} not found — PoE bands will be skipped")
        return None
    with open(path) as f:
        data = json.load(f)
    return {int(k): v for k, v in data["continuous_params"].items()}


def _sinusoid(doy, A, phi, C):
    return A * np.sin(2 * np.pi * doy / 365.25 + phi) + C


def get_poe_offset(doy, horizon, pct_key, continuous_params):
    if continuous_params is None:
        return 0.0
    fitted_horizons = sorted(continuous_params.keys())
    if horizon <= fitted_horizons[0]:
        hz_lo = hz_hi = fitted_horizons[0]; t = 0.0
    elif horizon >= fitted_horizons[-1]:
        hz_lo = hz_hi = fitted_horizons[-1]; t = 0.0
    else:
        for k in range(len(fitted_horizons) - 1):
            if fitted_horizons[k] <= horizon <= fitted_horizons[k + 1]:
                hz_lo = fitted_horizons[k]; hz_hi = fitted_horizons[k + 1]
                t = (horizon - hz_lo) / (hz_hi - hz_lo); break

    def eval_s(hz):
        p = continuous_params.get(hz, {}).get(pct_key)
        return _sinusoid(doy, p["A"], p["phi"], p["C"]) if p else 0.0

    return eval_s(hz_lo) + t * (eval_s(hz_hi) - eval_s(hz_lo))


def apply_poe_to_daily(daily, continuous_params, horizon_fn):
    """
    Add PoE10/50/90 columns to a daily frame.
    `horizon_fn(idx)` returns the forecast horizon (int, days ahead) for row idx.
    """
    doys    = pd.to_datetime(daily["date"]).dt.dayofyear.values
    n       = len(daily)

    for band, err_key, clip_zero in [
        ("poe10", "p90", True),   # PoE10 = high demand = P90 of errors
        ("poe90", "p10", True),   # PoE90 = low demand  = P10 of errors
        ("poe50", "p50", False),
    ]:
        for component, col_suffix in [("gpg", "gpg_tj"), ("np", "nonpwr_tj"), ("total", "total_tj")]:
            pred_col    = "pred_gpg_tj" if component == "gpg" else \
                          "pred_nonpower_tj" if component == "np" else "pred_total_tj"
            err_col_key = f"{err_key}_{col_suffix.replace('nonpwr_tj','np_tj')}"
            offsets = np.array([
                get_poe_offset(doys[i], horizon_fn(i), err_col_key, continuous_params)
                for i in range(n)
            ])
            vals = daily[pred_col].values + offsets
            if clip_zero:
                vals = np.maximum(0, vals)
            daily[f"{band}_{col_suffix}"] = np.round(vals, 1)

    return daily


# ══════════════════════════════════════════════════════════════════════════════
# 6. MAIN RUNNER
# ══════════════════════════════════════════════════════════════════════════════

def run_forecast(today=None, force_weather=False):
    if today is None:
        today = date.today()

    today_str = today.strftime("%Y%m%d")
    print(f"\n{'='*65}")
    print(f"  Gas Demand Forecast Runner — {today_str}")
    print(f"{'='*65}\n")

    # ── Load models ───────────────────────────────────────────────────────────
    models, ols, state_models = load_models()

    # Retrieve actual feature column lists from loaded wind/solar models

    # ── Load PoE params ───────────────────────────────────────────────────────
    continuous_params = load_poe_params()

    # ── Get weather ───────────────────────────────────────────────────────────
    wx_py, wx_ytd, wx_7day = get_weather(today, force=force_weather)

    # ── Seasonal lag means (bootstrap for lag features) ─────────────────────────
    # Load from seasonal_lag_means.csv saved by notebook cell 7h-lag.
    # This reproduces the same bootstrap used in notebook cell 8b-pre:
    # historical df_h means by month/hour for gas_se_mwh, hydro_mwh, coal_mwh.
    lag_path = MODEL_DIR / "seasonal_lag_means.csv"
    if lag_path.exists():
        lag_means = pd.read_csv(lag_path)
        print(f"  Lag means loaded from {lag_path.name}  ({len(lag_means)} rows)")
    else:
        print(f"  WARNING: {lag_path.name} not found — lag features will be NaN")
        print(f"  Run notebook cell 7h-lag to generate this file.")
        lag_means = None

    print(f"\nBuilding features…")

    # ── YTD backcast ──────────────────────────────────────────────────────────
    bc = build_hourly_features(wx_ytd, seasonal_lags_df=lag_means)
    bc = run_cascade(bc, models)
    daily_bc = aggregate_to_daily(bc, ols, state_models)
    daily_bc = apply_poe_to_daily(daily_bc, continuous_params,
                                  horizon_fn=lambda i: 0)   # backcast = h=0
    daily_bc["period"] = "backcast"
    print(f"  YTD backcast  : {len(daily_bc)} days "
          f"({daily_bc['date'].min().date()} → {daily_bc['date'].max().date()})")

    # ── 16-day forward forecast ───────────────────────────────────────────────
    fc = build_hourly_features(wx_7day, seasonal_lags_df=lag_means)

    fc = run_cascade(fc, models)
    daily_fc = aggregate_to_daily(fc, ols, state_models)
    daily_fc = apply_poe_to_daily(daily_fc, continuous_params,
                                  horizon_fn=lambda i: min(i + 1, 16))
    daily_fc["period"] = "forecast"
    print(f"  16-day forecast: {len(daily_fc)} days "
          f"({daily_fc['date'].min().date()} → {daily_fc['date'].max().date()})")

    # ── Print forward forecast table ──────────────────────────────────────────
    print(f"\n{'Date':<12} {'GPG TJ':>8} {'NP TJ':>8} {'Total TJ':>9} "
          f"{'PoE90':>7} {'PoE10':>7} {'HDD':>6}")
    print("─" * 62)
    for _, row in daily_fc.iterrows():
        print(f"{str(row['date'].date()):<12} "
              f"{row['pred_gpg_tj']:>8.1f} "
              f"{row['pred_nonpower_tj']:>8.1f} "
              f"{row['pred_total_tj']:>9.1f} "
              f"{row.get('poe90_total_tj', float('nan')):>7.1f} "
              f"{row.get('poe10_total_tj', float('nan')):>7.1f} "
              f"{row['hdd18_se']:>6.2f}")

    # ── Combine and export daily CSV ──────────────────────────────────────────
    daily_out = pd.concat([daily_bc, daily_fc], ignore_index=True)
    daily_out["date"] = pd.to_datetime(daily_out["date"])
    daily_out = daily_out.sort_values("date").reset_index(drop=True)

    # Standardise PoE column names (p10_* → poe90_* convention)
    _renames = {
        "p10_gpg_tj":    "poe90_gpg_tj",
        "p90_gpg_tj":    "poe10_gpg_tj",
        "p10_nonpwr_tj": "poe90_nonpwr_tj",
        "p90_nonpwr_tj": "poe10_nonpwr_tj",
        "p10_total_tj":  "poe90_total_tj",
        "p90_total_tj":  "poe10_total_tj",
    }
    daily_out = daily_out.rename(columns={k: v for k, v in _renames.items()
                                          if k in daily_out.columns})

    # ── Add weather regime classification ─────────────────────────────────────
    _thresh_path = FORECAST_DIR / "regime_thresholds.json"
    if _thresh_path.exists():
        with open(_thresh_path) as _f:
            _thresh = {int(k): v for k, v in json.load(_f).items()}

        def _classify(row):
            if pd.isna(row["hdd18_se"]):
                return "Normal"
            doy = max(1, min(int(row["doy"]), 366))
            hdd_p67, wind_p33, wind_p67, solar_p33 = _thresh.get(doy, _thresh[196])[:4]
            cold  = row["hdd18_se"]       >= hdd_p67
            dark  = not pd.isna(row["solar_radiation"]) and row["solar_radiation"] <= solar_p33
            calm  = not pd.isna(row["wind_speed_100m"]) and row["wind_speed_100m"] <= wind_p33
            windy = not pd.isna(row["wind_speed_100m"]) and row["wind_speed_100m"] >= wind_p67
            if not cold:       return "Normal"
            if dark and calm:  return "Dunkelflaute"
            if calm:           return "Cold & still"
            if dark:           return "Cold & dark"
            if windy:          return "Cold front"
            return "Normal"

        daily_out["weather_regime"] = daily_out.apply(_classify, axis=1)
        print(f"  Regimes: {daily_out['weather_regime'].value_counts().to_dict()}")
    else:
        daily_out["weather_regime"] = "Normal"
        print(f"  WARNING: regime_thresholds.json not found — run notebook cell 1g-thresholds")

    out_daily = FORECAST_DIR / f"gas_forecast_{today_str}.csv"
    daily_out.to_csv(out_daily, index=False)
    print(f"\n✅ Saved {out_daily.name}  ({len(daily_out)} rows)")

    # ── Export hourly dispatch CSV ────────────────────────────────────────────
    HOURLY_COLS = [
        "datetime", "date", "hour",
        "pred_nem_h", "pred_wind", "pred_solar", "pred_coal", "pred_hydro",
        "pred_gpg_mwh", "pred_gpg_tj",
        "forecast_residual", "residual_unclipped",
        "hdd18_nem", "temp",
    ]
    RENAME_H = {
        "pred_nem_h":        "pred_nem_mwh",
        "pred_wind":         "pred_wind_mwh",
        "pred_solar":        "pred_solar_mwh",
        "pred_coal":         "pred_coal_mwh",
        "pred_hydro":        "pred_hydro_mwh",
        "forecast_residual": "pred_residual_clipped_mwh",
        "residual_unclipped":"pred_residual_mwh",
    }

    fc_h  = fc[[c for c in HOURLY_COLS if c in fc.columns]].copy()
    fc_h["period"] = "forecast"
    fc_h  = fc_h.rename(columns=RENAME_H)

    bc_h  = bc[[c for c in HOURLY_COLS if c in bc.columns]].copy()
    bc_h["period"] = "backcast"
    cutoff = pd.Timestamp(bc_h["datetime"].max()) - pd.Timedelta(days=14)
    bc_h  = bc_h[bc_h["datetime"] >= cutoff]
    bc_h  = bc_h.rename(columns=RENAME_H)

    hourly_out_df = pd.concat([bc_h, fc_h], ignore_index=True).sort_values("datetime")
    hourly_out_df["datetime"] = hourly_out_df["datetime"].astype(str)
    hourly_out_df["date"]     = hourly_out_df["date"].astype(str)

    out_hourly = FORECAST_DIR / f"gas_forecast_hourly_{today_str}.csv"
    hourly_out_df.to_csv(out_hourly, index=False)
    print(f"✅ Saved {out_hourly.name}  ({len(hourly_out_df):,} rows)")
    print(f"\nDone.")

    return daily_out, hourly_out_df


# ══════════════════════════════════════════════════════════════════════════════
# 7. ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Daily gas demand forecast runner")
    parser.add_argument("--date", default=None,
                        help="Run date as YYYY-MM-DD (default: today)")
    parser.add_argument("--force-weather", action="store_true",
                        help="Ignore weather cache and re-download all sites")
    args = parser.parse_args()

    run_date = date.fromisoformat(args.date) if args.date else date.today()
    run_forecast(today=run_date, force_weather=args.force_weather)
