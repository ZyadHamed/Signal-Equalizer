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