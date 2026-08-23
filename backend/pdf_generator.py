from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
import io

def generate_solar_report(data: dict) -> io.BytesIO:
    buffer = io.BytesIO()
    
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
    
    elements = []
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'TitleStyle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=24,
        textColor=colors.HexColor("#2E86C1"),
        spaceAfter=20
    )
    
    h2_style = ParagraphStyle(
        'H2Style',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=18,
        textColor=colors.HexColor("#1A5276"),
        spaceAfter=10
    )
    
    body_style = ParagraphStyle(
        'BodyCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        spaceAfter=10
    )

    italic_style = ParagraphStyle(
        'ItalicCustom',
        parent=styles['Italic'],
        fontName='Helvetica',
        fontSize=10,
        spaceAfter=6
    )
    
    # Header
    elements.append(Paragraph("SuryaScope: Solar Feasibility Report", title_style))
    elements.append(Paragraph("A comprehensive analysis of your rooftop solar potential under the PM Surya Ghar Muft Bijli Yojana.", body_style))
    elements.append(Spacer(1, 0.2 * inch))
    
    # Site Details
    address = data.get("address", "Custom Polygon Area")
    elements.append(Paragraph("Site Details", h2_style))
    elements.append(Paragraph(f"<b>Location:</b> {address}", body_style))
    elements.append(Paragraph(f"<b>Gross Roof Area:</b> {data.get('gross_area_sqm', data.get('area_sqm', 0))} sq. meters", body_style))
    
    obstruction_count = data.get('obstruction_count', 0)
    obstruction_area = data.get('obstruction_area_sqm', 0)
    usable_area = data.get('usable_area_sqm', data.get('area_sqm', 0))
    
    if obstruction_count > 0:
        elements.append(Paragraph(f"<b>Obstructions Detected:</b> {obstruction_count} (AC units, water tanks, etc.)", body_style))
        elements.append(Paragraph(f"<b>Obstruction Area:</b> {obstruction_area} sq. meters", body_style))
    elements.append(Paragraph(f"<b>Usable Roof Area (net):</b> {usable_area} sq. meters", body_style))
    elements.append(Spacer(1, 0.2 * inch))
    
    # System Sizing & Generation
    elements.append(Paragraph("System Sizing &amp; Generation", h2_style))
    
    panel_count = data.get('panel_count', int((data['capacity_kw'] * 1000) / 500))
    
    system_data = [
        ["Parameter", "Value"],
        ["Recommended System Capacity", f"{data['capacity_kw']} kWp"],
        ["Estimated Annual Generation", f"{data['generation_kwh_yr']} kWh / year"],
        ["Average Daily Generation", f"{round(data['generation_kwh_yr'] / 365, 2)} kWh / day"],
        ["Estimated Panel Count", f"{panel_count} Panels (500Wp each)"],
        ["CO\u2082 Offset", f"{data.get('co2_offset_tons', 0)} tonnes / year"]
    ]
    
    t1 = Table(system_data, colWidths=[3*inch, 3*inch])
    t1.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#3498DB")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#EBF5FB")),
        ('GRID', (0, 0), (-1, -1), 1, colors.white),
        ('FONTSIZE', (0, 1), (-1, -1), 11),
        ('PADDING', (0, 0), (-1, -1), 8)
    ]))
    elements.append(t1)
    elements.append(Spacer(1, 0.3 * inch))
    
    # Financials
    elements.append(Paragraph("Financial Analysis", h2_style))
    
    R = 'Rs.'  # ₹ or Rs. depending on font availability
    
    financial_data = [
        ["Parameter", "Amount (INR)"],
        ["Estimated Gross Cost", f"{R} {data['total_cost_inr']:,.2f}"],
        ["PM Surya Ghar Subsidy", f"{R} {data['subsidy_inr']:,.2f}"],
        ["Net Payable Cost", f"{R} {data['net_cost_inr']:,.2f}"],
        ["Annual Electricity Savings", f"{R} {data.get('annual_savings_inr', 0):,.2f}"],
        ["Estimated Payback Period", f"{data['payback_years']} Years"]
    ]
    
    t2 = Table(financial_data, colWidths=[3*inch, 3*inch])
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#27AE60")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#EAFAF1")),
        ('GRID', (0, 0), (-1, -1), 1, colors.white),
        ('FONTSIZE', (0, 1), (-1, -1), 11),
        ('PADDING', (0, 0), (-1, -1), 8)
    ]))
    elements.append(t2)
    
    elements.append(Spacer(1, 0.5 * inch))
    elements.append(Paragraph("<i>Note: This is an automated feasibility report generated by SuryaScope based on satellite imagery and typical meteorological year (TMY) data. Obstructions (AC units, water tanks, etc.) have been excluded from the usable area. Actual costs and generation may vary based on site-specific factors like shading, roof tilt, and local vendor pricing.</i>", italic_style))

    doc.build(elements)
    buffer.seek(0)
    return buffer
