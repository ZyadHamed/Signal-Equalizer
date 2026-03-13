from fastapi import FastAPI, File, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
from pydantic import BaseModel
from ECGService import mat_to_json


app = FastAPI()
origins = ["*"]

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
    
  