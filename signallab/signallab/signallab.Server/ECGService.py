import os, warnings, copy
import numpy as np
import pandas as pd
import scipy.io
import matplotlib.pyplot as plt
from tqdm import tqdm
from scipy.stats import skew, kurtosis
import wfdb
warnings.filterwarnings('ignore')
import joblib

import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import torchvision

from sklearn.metrics import (
    classification_report, roc_auc_score,
    roc_curve, auc, confusion_matrix, f1_score
)
def load_ecg(path):
    mat = scipy.io.loadmat(path)
    if 'val' in mat:
        ecg = mat['val']
    elif 'ECG' in mat:
        ecg = mat['ECG']['data'][0][0]
    else:
        for k, v in mat.items():
            if not k.startswith('_'):
                ecg = v
                break
    return ecg.astype(np.float32)

LEAD_NAMES = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6']
SAMPLING_RATE    = 500
FIXED_LENGTH     = 4096
NUM_LEADS        = 12
HUBERT_INPUT_LEN = 500

CLASS_NAMES = [
    'Normal Sinus Rhythm',
    'Atrial Fibrillation (AF)',
    'First-degree AV Block (I-AVB)',
    'Left Bundle Branch Block (LBBB)',
    'Right Bundle Branch Block (RBBB)',
    'Premature Atrial Contraction (PAC)',
    'Premature Ventricular Contraction (PVC)',
    'ST-Segment Depression (STD)',
    'ST-Segment Elevation (STE)',
]
NUM_CLASSES = 9

def load_ecg(path):
    mat = scipy.io.loadmat(path)
    if 'val' in mat:
        ecg = mat['val']
    elif 'ECG' in mat:
        ecg = mat['ECG']['data'][0][0]
    else:
        for k, v in mat.items():
            if not k.startswith('_'):
                ecg = v
                break
    return ecg.astype(np.float32)

def mat_to_json(path: str) -> dict:
    base = path
    for ext in (".mat", ".hea", ".dat", ".csv"):
        if path.endswith(ext):
            base = path[: -len(ext)]
            break

    mat_path = base + ".mat"
    hea_path = base + ".hea"
    dat_path = base + ".dat"
    csv_path = base + ".csv"

    wfdb_sig_names = None

    if os.path.exists(csv_path):
        # ── .csv path ────────────────────────────────────────────────────────
        df = pd.read_csv(csv_path)

        # Normalise column names to lowercase for flexible matching
        df.columns = df.columns.str.strip().str.lower()

        if "time" not in df.columns or "amplitude" not in df.columns:
            raise Exception(
                "CSV file must contain 'time' and 'amplitude' columns. "
                f"Found columns: {list(df.columns)}"
            )

        time_col = df["time"].to_numpy(dtype=np.float64)
        amp_col  = df["amplitude"].to_numpy(dtype=np.float64)

        # Infer sampling frequency from time deltas
        if len(time_col) > 1:
            dt = np.median(np.diff(time_col))
            fs = round(1.0 / dt) if dt > 0 else 500
        else:
            fs = 500

        ecg            = amp_col[np.newaxis, :]   # shape: (1, samples)
        channels       = ["ECG"]

    elif os.path.exists(mat_path):
        # ── .mat path ────────────────────────────────────────────────────────
        ecg = load_ecg(mat_path)
        fs  = 500

        if os.path.exists(hea_path):
            with open(hea_path, "r") as f:
                first_line = f.readline().strip().split()
            if len(first_line) >= 3:
                try:
                    fs = int(first_line[2])
                except ValueError:
                    pass

    elif os.path.exists(hea_path) and os.path.exists(dat_path):
        # ── WFDB path — both .hea AND .dat must be present ───────────────────
        record         = wfdb.rdrecord(base)
        ecg            = record.p_signal
        fs             = record.fs
        wfdb_sig_names = record.sig_name

    elif os.path.exists(hea_path) and not os.path.exists(dat_path):
        # ── .hea uploaded without .dat ───────────────────────────────────────
        raise Exception(
            f"A .hea file was uploaded but the companion .dat file is missing. "
            f"Please upload both '{os.path.basename(base)}.hea' "
            f"and '{os.path.basename(base)}.dat' together."
        )

    else:
        raise Exception(
            f"No recognisable ECG file found for record: '{os.path.basename(base)}'. "
            f"Upload a .mat file, a .csv file, or both .hea and .dat files together."
        )

    # ── Normalise shape to (leads, samples) ─────────────────────────────────
    if not os.path.exists(csv_path):
        ecg = np.array(ecg, dtype=np.float64)

        if ecg.ndim == 1:
            ecg = ecg[np.newaxis, :]

        if ecg.shape[0] > ecg.shape[1]:
            ecg = ecg.T

        num_leads = ecg.shape[0]

        # ── Assign channel names ─────────────────────────────────────────────
        if wfdb_sig_names and len(wfdb_sig_names) == num_leads:
            channels = wfdb_sig_names
        elif num_leads <= len(LEAD_NAMES):
            channels = LEAD_NAMES[:num_leads]
        else:
            channels = [f"Lead_{i + 1}" for i in range(num_leads)]

    # ── Build output ─────────────────────────────────────────────────────────
    signals = ecg.T.tolist()

    return {
        "signals":  signals,
        "channels": channels,
        "fs":       int(fs),
    }


