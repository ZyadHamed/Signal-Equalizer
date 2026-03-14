from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
from pydantic import BaseModel
from typing import List
from ECGService import mat_to_json
from FrequencyTransformService import apply_frequency_gains, compute_spectrogram
from fastapi.middleware.gzip import GZipMiddleware
class GainBand(BaseModel):
    lowerLimit: float
    upperLimit: float
    gain: float

class SignalEqualizationRequest(BaseModel):
    signal: List[float]
    sampling_rate: float
    gain_bands: List[GainBand]

class SpectrogramRequest(BaseModel):
    signal: List[float]
    sampling_rate: float
    window_size: int
    overlap: int

app = FastAPI()
origins = ["*"]
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



ALLOWED_Dataset_Extensions_For_ECG_Conversion = {'.mat'}


@app.post("/convertecgtojson")
async def ConvertECGToJSON(file: UploadFile):
    try:
        contents = await file.read()
        file_extension = os.path.splitext(file.filename)[-1]
        if file_extension not in ALLOWED_Dataset_Extensions_For_ECG_Conversion:
            return JSONResponse(
            content = {
                "message:": f"Invalid file type. Allowed dataset formats: {', '.join(ALLOWED_Dataset_Extensions_For_ECG_Conversion)}"
                },
            status_code=400
            )
        

        with open("uploadedFiles/ECGFiles/" + file.filename, "wb") as binary_file:
            binary_file.write(contents)
        
        responseDTO = mat_to_json("uploadedFiles/ECGFiles/" + file.filename)
        return responseDTO

    except Exception:
        return JSONResponse(
            content = {
                "message:": Exception
                },
            status_code=500
            )
    
  
@app.post("/applyfrequencygains")
async def ApplyFrequencyGain(request: SignalEqualizationRequest):
    try:
        # Convert Pydantic objects back to standard dictionaries for the function
        gain_bands_dict = [band.model_dump() for band in request.gain_bands]
        
        # Apply the frequency gains
        mag, phase, mod_sig = apply_frequency_gains(
            signal=request.signal,
            sampling_rate=request.sampling_rate,
            gain_bands=gain_bands_dict
        )
        
        # Convert NumPy arrays back to Python lists for JSON serialization
        return {
            "modified_fft_magnitude": mag.tolist(),
            "modified_fft_phase": phase.tolist(),
            "modified_signal": mod_sig.tolist()
        }
        
    except Exception as e:
        # Catch any unexpected errors (like bad data causing math issues)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/computespectrogram")
async def ComputeSpectrogram(request: SpectrogramRequest):
        frequencies, times, spectrogram_array = compute_spectrogram(
            data = request.signal,
            sampling_rate = request.sampling_rate,
            window_size = request.window_size,
            overlap = request.overlap
        )
        
        # Convert NumPy arrays back to Python lists for JSON serialization
        return {
            "frequencies": frequencies.tolist(),
            "times": times.tolist(),
            "spectrogram_array": spectrogram_array.tolist()
        }