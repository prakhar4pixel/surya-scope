from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import math
import sys
import os

# Ensure backend/ directory is on sys.path so pdf_generator can be imported on Vercel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(title="SuryaScope API", description="API for Rooftop Solar Feasibility")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Point(BaseModel):
    lat: float
    lng: float

class Obstruction(BaseModel):
    polygon: List[Point]
    label: str = "Unknown"

class CalculateRequest(BaseModel):
    polygon: List[Point]
    obstructions: Optional[List[Obstruction]] = None
    address: Optional[str] = None

class CalculateResponse(BaseModel):
    gross_area_sqm: float
    obstruction_area_sqm: float
    usable_area_sqm: float
    obstruction_count: int
    capacity_kw: float
    panel_count: int
    generation_kwh_yr: float
    total_cost_inr: float
    subsidy_inr: float
    net_cost_inr: float
    payback_years: float
    annual_savings_inr: float
    co2_offset_tons: float

def calculate_polygon_area(polygon: List[Point]) -> float:
    if len(polygon) < 3:
        return 0.0
    R = 6378137
    ref_lat = polygon[0].lat
    points_m = []
    for p in polygon:
        x = math.radians(p.lng) * R * math.cos(math.radians(ref_lat))
        y = math.radians(p.lat) * R
        points_m.append((x, y))
    area = 0.0
    j = len(points_m) - 1
    for i in range(len(points_m)):
        area += (points_m[j][0] + points_m[i][0]) * (points_m[j][1] - points_m[i][1])
        j = i
    return abs(area / 2.0)

def pm_surya_ghar_subsidy(capacity_kw: float) -> float:
    if capacity_kw <= 2:
        return capacity_kw * 30000
    elif capacity_kw <= 3:
        return (2 * 30000) + ((capacity_kw - 2) * 18000)
    else:
        return 78000

@app.get("/")
def read_root():
    return {"message": "Welcome to SuryaScope API"}

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "SuryaScope API"}

@app.post("/api/calculate", response_model=CalculateResponse)
def calculate_solar_potential(req: CalculateRequest):
    gross_area_sqm = calculate_polygon_area(req.polygon)
    
    if gross_area_sqm < 5:
        raise HTTPException(status_code=400, detail="Polygon area too small")

    # Calculate obstruction areas
    obstruction_area_sqm = 0.0
    obstruction_count = 0
    if req.obstructions:
        for obs in req.obstructions:
            obs_area = calculate_polygon_area(obs.polygon)
            obstruction_area_sqm += obs_area
            obstruction_count += 1

    usable_area_sqm = max(gross_area_sqm - obstruction_area_sqm, 0)

    # 1 kW requires ~10 sqm
    capacity_kw = usable_area_sqm / 10.0
    capacity_kw = math.floor(capacity_kw * 2) / 2.0
    if capacity_kw < 1.0:
        capacity_kw = 1.0
    
    # Panel count (assuming 500Wp panels, each ~2.2 sqm)
    panel_count = int(usable_area_sqm / 2.2)
        
    # ~1400 kWh/yr per kW in India
    generation_kwh_yr = capacity_kw * 1400
    
    cost_per_kw = 60000
    total_cost_inr = capacity_kw * cost_per_kw
    subsidy_inr = pm_surya_ghar_subsidy(capacity_kw)
    net_cost_inr = total_cost_inr - subsidy_inr
    
    annual_savings_inr = generation_kwh_yr * 8
    payback_years = net_cost_inr / annual_savings_inr if annual_savings_inr > 0 else 0
    
    # CO2 offset: ~0.82 kg CO2 per kWh in India grid
    co2_offset_tons = (generation_kwh_yr * 0.82) / 1000

    return CalculateResponse(
        gross_area_sqm=round(gross_area_sqm, 2),
        obstruction_area_sqm=round(obstruction_area_sqm, 2),
        usable_area_sqm=round(usable_area_sqm, 2),
        obstruction_count=obstruction_count,
        capacity_kw=capacity_kw,
        panel_count=panel_count,
        generation_kwh_yr=round(generation_kwh_yr, 2),
        total_cost_inr=round(total_cost_inr, 2),
        subsidy_inr=round(subsidy_inr, 2),
        net_cost_inr=round(net_cost_inr, 2),
        payback_years=round(payback_years, 2),
        annual_savings_inr=round(annual_savings_inr, 2),
        co2_offset_tons=round(co2_offset_tons, 2)
    )

@app.post("/api/generate-report")
def generate_report_endpoint(req: CalculateRequest):
    calc = calculate_solar_potential(req)
    
    data = {
        "address": req.address or "Custom Polygon Area",
        "gross_area_sqm": calc.gross_area_sqm,
        "obstruction_area_sqm": calc.obstruction_area_sqm,
        "usable_area_sqm": calc.usable_area_sqm,
        "obstruction_count": calc.obstruction_count,
        "area_sqm": calc.usable_area_sqm,
        "capacity_kw": calc.capacity_kw,
        "panel_count": calc.panel_count,
        "generation_kwh_yr": calc.generation_kwh_yr,
        "total_cost_inr": calc.total_cost_inr,
        "subsidy_inr": calc.subsidy_inr,
        "net_cost_inr": calc.net_cost_inr,
        "payback_years": calc.payback_years,
        "annual_savings_inr": calc.annual_savings_inr,
        "co2_offset_tons": calc.co2_offset_tons
    }
    
    from pdf_generator import generate_solar_report
    pdf_buffer = generate_solar_report(data)
    
    return Response(
        content=pdf_buffer.getvalue(), 
        media_type="application/pdf", 
        headers={"Content-Disposition": "attachment; filename=SuryaScope_Report.pdf"}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
