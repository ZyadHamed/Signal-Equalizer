import pywt
import numpy as np

def decompose_wavelet(signal: np.ndarray, wavelet: str = 'db4', level: int = 5) -> dict:
    """
    Decompose a signal into wavelet levels and return coefficients as a dictionary.

    Parameters
    ----------
    signal  : 1D numpy array of audio samples.
    wavelet : Wavelet type (e.g. 'db4', 'db6', 'haar', 'sym5').
    level   : Number of decomposition levels.

    Returns
    -------
    dict with keys:
        - 'approximation' : lowest frequency component (cA at deepest level)
        - 'detail_1' ... 'detail_N' : detail levels from highest to lowest frequency
    """
    coeffs = pywt.wavedec(signal, wavelet, level=level)

    # coeffs[0]  = approximation (cA) — lowest frequency
    # coeffs[1:] = details cD_level down to cD_1 (high -> low freq)
    result = {
        "approximation": coeffs[0].tolist(),
    }

    for i, detail in enumerate(coeffs[1:], start=1):
        result[f"detail_{i}"] = detail.tolist()

    return result





import pywt
import numpy as np
import librosa
from scipy.signal import welch



# ── 2. Apply wavelet-domain gains ─────────────────────────────────────────────

def apply_wavelet_gains(
    signal: np.ndarray,
    gain_bands: list[dict],
    wavelet: str = 'db4',
    level: int = 5,
) -> tuple[dict, np.ndarray]:
    """
    Apply per-level gains to a signal in the wavelet domain, analogous
    to apply_frequency_gains() in the FFT domain.

    Parameters
    ----------
    signal     : 1D numpy array of audio samples.
    gain_bands : List of dicts, each specifying which level to scale and by
                 how much.  Two formats are supported:

                 # 1. Scale the entire level uniformly
                 { "level": "approximation", "gain": 0.5 }
                 { "level": "detail_3",      "gain": 2.0 }

                 # 2. Scale a coefficient index range within a level
                 { "level": "detail_2", "gain": 1.5,
                   "coeff_start": 100, "coeff_end": 400 }

    wavelet    : Wavelet family (must match the one used for analysis).
    level      : Decomposition depth (must match analysis).

    Returns
    -------
    ( coefficients_dict, reconstructed_signal )

        coefficients_dict : { level_name -> modified np.ndarray }
        reconstructed_signal : np.ndarray rebuilt via waverec
    """
    signal = np.asarray(signal, dtype=np.float64)
    coeffs = pywt.wavedec(signal, wavelet, level=level)
    level_names = ["approximation"] + [f"detail_{i}" for i in range(1, level + 1)]

    # Work on mutable copies
    modified = [c.copy() for c in coeffs]
    name_to_idx = {name: i for i, name in enumerate(level_names)}

    for band in gain_bands:
        lvl_name = band.get("level")
        gain     = band.get("gain", 1.0)

        if lvl_name not in name_to_idx:
            raise ValueError(
                f"Unknown level '{lvl_name}'. "
                f"Valid options: {list(name_to_idx.keys())}"
            )

        idx   = name_to_idx[lvl_name]
        coeff = modified[idx]

        # Optional coefficient-range mask
        c_start = band.get("coeff_start", 0)
        c_end   = band.get("coeff_end",   len(coeff))
        coeff[c_start:c_end] *= gain

    # Reconstruct
    reconstructed = pywt.waverec(modified, wavelet)
    # waverec may add 1 sample — trim to original length
    reconstructed = reconstructed[:len(signal)]

    coefficients_dict = {name: modified[i] for i, name in enumerate(level_names)}

    return coefficients_dict, reconstructed



