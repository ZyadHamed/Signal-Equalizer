import numpy as np
from scipy import signal

def apply_frequency_gains(signal, sampling_rate, gain_bands):
    signal = np.array(signal)
    n = len(signal)
    fft_data = np.fft.rfft(signal)        # rfft is 2x faster for real signals
    freqs    = np.fft.rfftfreq(n, d=1/sampling_rate)

    modified_fft = np.copy(fft_data)

    for band in gain_bands:
        mask = (freqs >= band['lowerLimit']) & (freqs <= band['upperLimit'])
        modified_fft[mask] *= band['gain']

    modified_signal = np.fft.irfft(modified_fft, n=n) if gain_bands else signal

    magnitude = np.abs(modified_fft)
    phase     = np.angle(modified_fft)

    return magnitude, phase, modified_signal

def compute_spectrogram(data, sampling_rate, window_size=256, overlap=128):
    data = np.array(data)
    # Compute the spectrogram
    frequencies, times, spectrogram_array = signal.spectrogram(
        x=data,
        fs=sampling_rate,
        nperseg=window_size,
        noverlap=overlap
    )
    
    return frequencies, times, spectrogram_array



import json
from dataclasses import dataclass

import numpy as np


@dataclass
class EQResult:
    sample_rate: int
    num_samples: int
    equalized_signal: list[float]


def apply_mask_eq(
    audio: np.ndarray,
    sample_rate: int,
    config: dict,
    gains: dict[str, float],
) -> EQResult:
    mask_size = config["metadata"]["mask_size"]
    config_sr = config["metadata"]["sample_rate"]

    if sample_rate != config_sr:
        raise ValueError(
            f"Audio sample rate ({sample_rate} Hz) does not match "
            f"mask config sample rate ({config_sr} Hz)."
        )

    instrument_names = list(config["masks"].keys())
    if set(gains.keys()) != set(instrument_names):
        raise ValueError(
            f"Gains keys {sorted(gains.keys())} do not match "
            f"instrument names {sorted(instrument_names)}."
        )

    # Work in float64 throughout
    signal = audio.astype(np.float64)

    # FFT — use the full signal length; mask indices index into [0, mask_size)
    spectrum = np.fft.rfft(signal, n=mask_size)

    output_spectrum = np.zeros_like(spectrum)

    for instrument, data in config["masks"].items():
        indices = np.array(data["indices"], dtype=np.int64)
        values  = np.array(data["values"],  dtype=np.float64)
        gain    = gains[instrument]

        # Keep only indices that fall within the rfft output length
        rfft_len = len(spectrum)
        valid    = indices < rfft_len

        inst_spectrum = np.zeros_like(spectrum)
        inst_spectrum[indices[valid]] = spectrum[indices[valid]] * values[valid]
        output_spectrum += inst_spectrum * gain

    equalized = np.fft.irfft(output_spectrum, n=mask_size)

    # Trim or pad to original signal length
    n = len(signal)
    if len(equalized) >= n:
        equalized = equalized[:n]
    else:
        equalized = np.pad(equalized, (0, n - len(equalized)))

    return EQResult(
        sample_rate=sample_rate,
        num_samples=n,
        equalized_signal=equalized.tolist(),
    )