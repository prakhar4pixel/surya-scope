import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  CircleMarker,
  Tooltip,
  Marker,
  useMapEvents,
  useMap,
} from 'react-leaflet';
import {
  Sun,
  FileText,
  Pentagon,
  Trash2,
  Loader2,
  Zap,
  IndianRupee,
  Clock,
  Search,
  MapPin,
  X,
  Eye,
  Download,
  ShieldAlert,
  Droplets,
  Wind,
  Box,
  Leaf,
  PenTool,
  MousePointerClick,
  Square,
  Circle as CircleIcon,
  RotateCcw,
  Check,
  Layers,
  Sparkles,
  TreePine,
  Sliders,
  Maximize2,
  Info,
  ChevronRight,
  HelpCircle,
  TrendingUp,
} from 'lucide-react';
import L from 'leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GEOMETRY & MATHEMATICAL UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Great-circle Haversine distance in meters
function haversineDistance(p1, p2) {
  const R = 6378137;
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1[0] * Math.PI) / 180) *
      Math.cos((p2[0] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters, imperial = false) {
  if (imperial) {
    const feet = meters * 3.28084;
    return feet >= 1000 ? `${(feet / 5280).toFixed(2)} mi` : `${feet.toFixed(1)} ft`;
  }
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
}

function formatArea(sqm, imperial = false) {
  if (imperial) {
    const sqft = sqm * 10.7639;
    return `${sqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq.ft`;
  }
  return `${sqm.toFixed(1)} m²`;
}

// Client-side exact spherical polygon area calculation (Shoelace on local tangent plane)
function calculatePolygonArea(points) {
  if (!points || points.length < 3) return 0;
  const R = 6378137;
  const refLat = points[0][0];
  const pointsM = points.map(p => [
    ((p[1] * Math.PI) / 180) * R * Math.cos((refLat * Math.PI) / 180),
    ((p[0] * Math.PI) / 180) * R,
  ]);
  let area = 0;
  let j = pointsM.length - 1;
  for (let i = 0; i < pointsM.length; i++) {
    area += (pointsM[j][0] + pointsM[i][0]) * (pointsM[j][1] - pointsM[i][1]);
    j = i;
  }
  return Math.abs(area / 2.0);
}

// Point in polygon test (Ray-casting algorithm)
function isPointInPolygon(point, vs) {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Douglas-Peucker line simplification for smooth freehand paths
function getSqDist(p1, p2) {
  const dx = p1[0] - p2[0], dy = p1[1] - p2[1];
  return dx * dx + dy * dy;
}

function getSqSegDist(p, p1, p2) {
  let x = p1[0], y = p1[1];
  let dx = p2[0] - x, dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2[0];
      y = p2[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyRadialDist(points, sqTolerance) {
  let prevPoint = points[0];
  const newPoints = [prevPoint];
  let point;
  for (let i = 1, len = points.length; i < len; i++) {
    point = points[i];
    if (getSqDist(point, prevPoint) > sqTolerance) {
      newPoints.push(point);
      prevPoint = point;
    }
  }
  if (prevPoint !== point) newPoints.push(point);
  return newPoints;
}

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDist = sqTolerance;
  let index;
  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (maxSqDist > sqTolerance) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

function simplifyDouglasPeucker(points, tolerance = 0.000006) {
  if (points.length <= 2) return points;
  const sqTolerance = tolerance * tolerance;
  const radPoints = simplifyRadialDist(points, sqTolerance);
  const last = radPoints.length - 1;
  const simplified = [radPoints[0]];
  simplifyDPStep(radPoints, 0, last, sqTolerance, simplified);
  simplified.push(radPoints[last]);
  return simplified;
}

// Generate circular polygon (approximating water tanks/chimneys)
function generateCirclePolygon(center, radiusMeters, numPoints = 18) {
  const R = 6378137;
  const dLat = (radiusMeters / R) * (180 / Math.PI);
  const dLng = dLat / Math.cos((center[0] * Math.PI) / 180);
  const pts = [];
  for (let i = 0; i < numPoints; i++) {
    const theta = (i / numPoints) * 2 * Math.PI;
    pts.push([
      center[0] + dLat * Math.sin(theta),
      center[1] + dLng * Math.cos(theta),
    ]);
  }
  return pts;
}

// Generate solar panel array grid overlay inside the polygon
function generatePanelGrid(roofPoints, obstructions = []) {
  if (!roofPoints || roofPoints.length < 3) return [];
  const R = 6378137;
  const refLat = roofPoints[0][0];

  // Convert roof to local meters
  const toMeters = (p) => [
    ((p[1] * Math.PI) / 180) * R * Math.cos((refLat * Math.PI) / 180),
    ((p[0] * Math.PI) / 180) * R,
  ];
  const toLatLng = (m) => [
    (m[1] / R) * (180 / Math.PI),
    (m[0] / (R * Math.cos((refLat * Math.PI) / 180))) * (180 / Math.PI),
  ];

  const roofM = roofPoints.map(toMeters);
  const obsM = obstructions.map(o => o.points.map(toMeters));

  // Find bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  roofM.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  const panelWidth = 2.0;  // 2m wide (East-West)
  const panelHeight = 1.1; // 1.1m deep (North-South)
  const gapX = 0.25;
  const gapY = 0.45;

  const panels = [];
  const maxPanels = 180; // Performance safety cap

  for (let y = minY + 0.8; y + panelHeight <= maxY - 0.8; y += panelHeight + gapY) {
    for (let x = minX + 0.8; x + panelWidth <= maxX - 0.8; x += panelWidth + gapX) {
      if (panels.length >= maxPanels) break;
      // 4 corners of panel
      const corners = [
        [x, y],
        [x + panelWidth, y],
        [x + panelWidth, y + panelHeight],
        [x, y + panelHeight],
      ];
      const center = [x + panelWidth / 2, y + panelHeight / 2];

      // Must be completely inside roof
      const insideRoof = isPointInPolygon(center, roofM) &&
        corners.every(c => isPointInPolygon(c, roofM));

      if (!insideRoof) continue;

      // Must not intersect any obstruction
      let hitsObs = false;
      for (const obs of obsM) {
        if (isPointInPolygon(center, obs) || corners.some(c => isPointInPolygon(c, obs))) {
          hitsObs = true;
          break;
        }
      }

      if (!hitsObs) {
        panels.push(corners.map(toLatLng));
      }
    }
  }
  return panels;
}

// PM Surya Ghar Subsidy formula
function calculateSubsidy(capacityKw) {
  if (capacityKw <= 2) {
    return capacityKw * 30000;
  } else if (capacityKw <= 3) {
    return 2 * 30000 + (capacityKw - 2) * 18000;
  } else {
    return 78000;
  }
}

// Client-side Solar Potential Engine
function computeSolarPotential(roofPts, obsList, tariff = 8.0, isHouseholder = true) {
  const grossArea = calculatePolygonArea(roofPts);
  if (grossArea < 3) return null;

  let obsArea = 0;
  obsList.forEach(o => {
    obsArea += calculatePolygonArea(o.points);
  });

  const usableArea = Math.max(grossArea - obsArea, 0);
  let capacityKw = usableArea / 10.0;
  capacityKw = Math.floor(capacityKw * 2) / 2.0;
  if (capacityKw < 1.0) capacityKw = 1.0;

  const panelCount = Math.floor(usableArea / 2.2);
  const generationKwhYr = capacityKw * 1400;
  const costPerKw = 60000;
  const totalCost = capacityKw * costPerKw;
  const subsidy = isHouseholder ? calculateSubsidy(capacityKw) : 0;
  const netCost = totalCost - subsidy;
  const annualSavings = generationKwhYr * tariff;
  const paybackYears = annualSavings > 0 ? netCost / annualSavings : 0;
  const co2Offset = (generationKwhYr * 0.82) / 1000;
  const treesPlanted = Math.round(co2Offset * 45);
  const lifetime25YrSavings = (generationKwhYr * 25 * tariff) - netCost;

  return {
    gross_area_sqm: Math.round(grossArea * 100) / 100,
    obstruction_area_sqm: Math.round(obsArea * 100) / 100,
    usable_area_sqm: Math.round(usableArea * 100) / 100,
    obstruction_count: obsList.length,
    capacity_kw: capacityKw,
    panel_count: panelCount,
    generation_kwh_yr: Math.round(generationKwhYr),
    daily_generation_kwh: Math.round((generationKwhYr / 365) * 10) / 10,
    total_cost_inr: Math.round(totalCost),
    subsidy_inr: Math.round(subsidy),
    net_cost_inr: Math.round(netCost),
    payback_years: Math.round(paybackYears * 10) / 10,
    annual_savings_inr: Math.round(annualSavings),
    co2_offset_tons: Math.round(co2Offset * 10) / 10,
    trees_equivalent: treesPlanted,
    lifetime_savings_inr: Math.round(lifetime25YrSavings),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAP CONTROLLER & INTERACTION ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function MapController({ flyTo }) {
  const map = useMap();
  useEffect(() => {
    if (flyTo) map.flyTo(flyTo, 19, { duration: 1.5 });
  }, [flyTo, map]);
  return null;
}

// Master Drawing & Interaction Component
function InteractiveDrawingEngine({
  toolMode,          // 'freehand' | 'polygon' | 'rectangle' | 'circle' | 'edit' | null
  drawTarget,        // 'roof' | 'obstruction'
  roofPoints,
  setRoofPoints,
  obstructions,
  setObstructions,
  currentObsLabel,
  onFinishDrawing,
  onPointAdded,
}) {
  const map = useMap();
  const [draftPoints, setDraftPoints] = useState([]);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [mousePos, setMousePos] = useState(null);
  const [draggedVtxInfo, setDraggedVtxInfo] = useState(null); // { target: 'roof'|'obs', obsIdx?, vtxIdx }
  const [startPointHovered, setStartPointHovered] = useState(false);

  const isDrawing = toolMode && toolMode !== 'edit';
  const isFreehand = toolMode === 'freehand';

  // Disable/Enable map dragging during drawing modes
  useEffect(() => {
    if (!map) return;
    if (isDrawing || draggedVtxInfo) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
    }
  }, [map, isDrawing, draggedVtxInfo]);

  // Set cursor styles on map container
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    container.classList.remove('drawing-active', 'drawing-freehand', 'editing-active');
    if (isFreehand) container.classList.add('drawing-freehand');
    else if (isDrawing) container.classList.add('drawing-active');
    else if (toolMode === 'edit') container.classList.add('editing-active');
  }, [map, toolMode, isFreehand, isDrawing]);

  // Handle map events
  useMapEvents({
    mousedown(e) {
      if (!isDrawing) return;
      const latlng = [e.latlng.lat, e.latlng.lng];

      if (toolMode === 'freehand') {
        setIsMouseDown(true);
        setDraftPoints([latlng]);
      } else if (toolMode === 'rectangle' || toolMode === 'circle') {
        setIsMouseDown(true);
        setDraftPoints([latlng]);
      }
    },

    mousemove(e) {
      const latlng = [e.latlng.lat, e.latlng.lng];
      setMousePos(latlng);

      if (!isDrawing || !isMouseDown) {
        // Handle vertex dragging
        if (draggedVtxInfo) {
          const { target, obsIdx, vtxIdx } = draggedVtxInfo;
          if (target === 'roof') {
            setRoofPoints(prev => {
              const next = [...prev];
              next[vtxIdx] = latlng;
              return next;
            });
          } else if (target === 'obs' && obsIdx !== undefined) {
            setObstructions(prev => {
              const next = [...prev];
              const obsPts = [...next[obsIdx].points];
              obsPts[vtxIdx] = latlng;
              next[obsIdx] = { ...next[obsIdx], points: obsPts };
              return next;
            });
          }
        }
        return;
      }

      if (toolMode === 'freehand') {
        setDraftPoints(prev => {
          if (prev.length === 0) return [latlng];
          const last = prev[prev.length - 1];
          const p1 = map.latLngToContainerPoint(L.latLng(last[0], last[1]));
          const p2 = map.latLngToContainerPoint(e.latlng);
          // Sample points every 8 pixels for high resolution smooth curve
          if (p1.distanceTo(p2) >= 8) {
            return [...prev, latlng];
          }
          return prev;
        });
      } else if (toolMode === 'rectangle' && draftPoints.length >= 1) {
        const start = draftPoints[0];
        const rect = [
          start,
          [start[0], latlng[1]],
          latlng,
          [latlng[0], start[1]],
        ];
        setDraftPoints(rect);
      } else if (toolMode === 'circle' && draftPoints.length >= 1) {
        const center = draftPoints[0];
        const radMeters = haversineDistance(center, latlng);
        const circlePts = generateCirclePolygon(center, Math.max(radMeters, 0.5));
        setDraftPoints(circlePts);
      }
    },

    mouseup(e) {
      if (draggedVtxInfo) {
        setDraggedVtxInfo(null);
        return;
      }

      if (!isDrawing || !isMouseDown) return;
      setIsMouseDown(false);

      if (toolMode === 'freehand') {
        if (draftPoints.length >= 4) {
          const simplified = simplifyDouglasPeucker(draftPoints, 0.000008);
          if (simplified.length >= 3) {
            commitFinishedShape(simplified);
          }
        }
        setDraftPoints([]);
      } else if (toolMode === 'rectangle' || toolMode === 'circle') {
        if (draftPoints.length >= 3) {
          commitFinishedShape(draftPoints);
        }
        setDraftPoints([]);
      }
    },

    click(e) {
      if (toolMode !== 'polygon') return;
      const latlng = [e.latlng.lat, e.latlng.lng];

      // Check snap to close if clicking near 1st point and have ≥3 points
      if (draftPoints.length >= 3) {
        const firstPt = draftPoints[0];
        const p1 = map.latLngToContainerPoint(L.latLng(firstPt[0], firstPt[1]));
        const p2 = map.latLngToContainerPoint(e.latlng);
        if (p1.distanceTo(p2) < 18) {
          // Snap closed!
          commitFinishedShape(draftPoints);
          setDraftPoints([]);
          setStartPointHovered(false);
          return;
        }
      }

      setDraftPoints(prev => [...prev, latlng]);
      if (onPointAdded) onPointAdded(latlng);
    },
  });

  const commitFinishedShape = useCallback((points) => {
    if (points.length < 3) return;
    if (drawTarget === 'roof') {
      setRoofPoints(points);
      onFinishDrawing('roof', points);
    } else {
      const newObs = {
        id: Date.now().toString(),
        points,
        label: currentObsLabel || 'Obstruction',
      };
      setObstructions(prev => [...prev, newObs]);
      onFinishDrawing('obstruction', newObs);
    }
  }, [drawTarget, currentObsLabel, setRoofPoints, setObstructions, onFinishDrawing]);

  // Midpoint vertex insertion
  const insertMidpoint = (target, obsIdx, edgeIdx) => {
    if (target === 'roof') {
      setRoofPoints(prev => {
        const next = [...prev];
        const p1 = next[edgeIdx];
        const p2 = next[(edgeIdx + 1) % next.length];
        const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        next.splice(edgeIdx + 1, 0, mid);
        return next;
      });
    } else if (target === 'obs' && obsIdx !== undefined) {
      setObstructions(prev => {
        const next = [...prev];
        const pts = [...next[obsIdx].points];
        const p1 = pts[edgeIdx];
        const p2 = pts[(edgeIdx + 1) % pts.length];
        const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        pts.splice(edgeIdx + 1, 0, mid);
        next[obsIdx] = { ...next[obsIdx], points: pts };
        return next;
      });
    }
  };

  const removeVertex = (target, obsIdx, vtxIdx, e) => {
    if (e) e.originalEvent?.stopPropagation();
    if (target === 'roof') {
      if (roofPoints.length <= 3) return;
      setRoofPoints(prev => prev.filter((_, i) => i !== vtxIdx));
    } else if (target === 'obs' && obsIdx !== undefined) {
      if (obstructions[obsIdx].points.length <= 3) return;
      setObstructions(prev => {
        const next = [...prev];
        next[obsIdx].points = next[obsIdx].points.filter((_, i) => i !== vtxIdx);
        return next;
      });
    }
  };

  const isRoofTarget = drawTarget === 'roof';
  const strokeColor = isRoofTarget ? '#38bdf8' : '#ef4444';
  const fillColor = isRoofTarget ? '#0284c7' : '#dc2626';

  return (
    <>
      {/* ── Active Draft Polygon / Path Preview ── */}
      {draftPoints.length >= 2 && (
        <>
          <Polyline
            positions={draftPoints}
            pathOptions={{ color: strokeColor, weight: 3, opacity: 0.95 }}
          />
          {draftPoints.length >= 3 && (
            <Polygon
              positions={draftPoints}
              pathOptions={{
                color: strokeColor,
                weight: 2,
                fillColor,
                fillOpacity: 0.25,
                dashArray: '6 4',
              }}
            />
          )}
          {/* Live Segment Distance Badges */}
          {draftPoints.map((pt, i) => {
            if (i === 0) return null;
            const prev = draftPoints[i - 1];
            const mid = [(prev[0] + pt[0]) / 2, (prev[1] + pt[1]) / 2];
            const dist = haversineDistance(prev, pt);
            return (
              <CircleMarker key={`draft-edge-${i}`} center={mid} radius={0} pathOptions={{ opacity: 0 }}>
                <Tooltip permanent direction="center" className={`edge-label ${!isRoofTarget ? 'obs' : ''}`}>
                  {formatDistance(dist)}
                </Tooltip>
              </CircleMarker>
            );
          })}
        </>
      )}

      {/* Guide Line to Mouse Pointer in Polygon Mode */}
      {toolMode === 'polygon' && draftPoints.length >= 1 && mousePos && (
        <Polyline
          positions={[draftPoints[draftPoints.length - 1], mousePos]}
          pathOptions={{ color: strokeColor, weight: 2, dashArray: '4 4', opacity: 0.8 }}
        />
      )}

      {/* Draft Vertex Nodes */}
      {draftPoints.map((pt, i) => {
        const isFirst = i === 0;
        return (
          <CircleMarker
            key={`draft-vtx-${i}`}
            center={pt}
            radius={isFirst ? 7 : 5}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: isFirst ? '#f59e0b' : strokeColor,
              fillOpacity: 1,
            }}
            eventHandlers={{
              mouseover: () => isFirst && draftPoints.length >= 3 && setStartPointHovered(true),
              mouseout: () => setStartPointHovered(false),
            }}
          >
            {isFirst && draftPoints.length >= 3 && (
              <Tooltip permanent direction="top" offset={[0, -10]} className="edge-label">
                Click to Close ✓
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}

      {/* Live Area Badge during Draft */}
      {draftPoints.length >= 3 && (
        <CircleMarker
          center={[
            draftPoints.reduce((s, p) => s + p[0], 0) / draftPoints.length,
            draftPoints.reduce((s, p) => s + p[1], 0) / draftPoints.length,
          ]}
          radius={0}
          pathOptions={{ opacity: 0 }}
        >
          <Tooltip permanent direction="center" className="area-badge">
            {formatArea(calculatePolygonArea(draftPoints))}
          </Tooltip>
        </CircleMarker>
      )}

      {/* ── Render Completed Roof Polygon ── */}
      {roofPoints.length >= 3 && (!isDrawing || drawTarget !== 'roof') && (
        <>
          <Polygon
            positions={roofPoints}
            pathOptions={{
              color: '#38bdf8',
              weight: 2.5,
              fillColor: '#0284c7',
              fillOpacity: 0.22,
            }}
          />
          {/* Edge distance labels */}
          {roofPoints.map((pt, i) => {
            const next = roofPoints[(i + 1) % roofPoints.length];
            const mid = [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2];
            const dist = haversineDistance(pt, next);
            return (
              <React.Fragment key={`roof-edge-${i}`}>
                <CircleMarker center={mid} radius={0} pathOptions={{ opacity: 0 }}>
                  <Tooltip permanent direction="center" className="edge-label">
                    {formatDistance(dist)}
                  </Tooltip>
                </CircleMarker>
                {/* Midpoint '+' handle in Edit Mode */}
                {toolMode === 'edit' && (
                  <CircleMarker
                    center={mid}
                    radius={6}
                    pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.9 }}
                    eventHandlers={{
                      click: (e) => {
                        e.originalEvent?.stopPropagation();
                        insertMidpoint('roof', undefined, i);
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -6]}>Click to add corner</Tooltip>
                  </CircleMarker>
                )}
              </React.Fragment>
            );
          })}
          {/* Centered Area Badge */}
          <CircleMarker
            center={[
              roofPoints.reduce((s, p) => s + p[0], 0) / roofPoints.length,
              roofPoints.reduce((s, p) => s + p[1], 0) / roofPoints.length,
            ]}
            radius={0}
            pathOptions={{ opacity: 0 }}
          >
            <Tooltip permanent direction="center" className="area-badge">
              Roof: {formatArea(calculatePolygonArea(roofPoints))}
            </Tooltip>
          </CircleMarker>
          {/* Draggable Vertex Handles in Edit Mode or Default Mode */}
          {roofPoints.map((pt, i) => (
            <CircleMarker
              key={`roof-vtx-${i}`}
              center={pt}
              radius={toolMode === 'edit' ? 8 : 5}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: toolMode === 'edit' ? '#f59e0b' : '#38bdf8',
                fillOpacity: 1,
              }}
              eventHandlers={{
                mousedown: (e) => {
                  e.originalEvent?.stopPropagation();
                  setDraggedVtxInfo({ target: 'roof', vtxIdx: i });
                },
                contextmenu: (e) => removeVertex('roof', undefined, i, e),
              }}
            >
              {toolMode === 'edit' && (
                <Tooltip direction="top" offset={[0, -10]}>
                  Drag to move (Right-click to delete)
                </Tooltip>
              )}
            </CircleMarker>
          ))}
        </>
      )}

      {/* ── Render Obstruction Polygons ── */}
      {obstructions.map((obs, obsIdx) => (
        <React.Fragment key={`obs-${obs.id || obsIdx}`}>
          <Polygon
            positions={obs.points}
            pathOptions={{
              color: '#ef4444',
              weight: 2,
              fillColor: '#ef4444',
              fillOpacity: 0.38,
              dashArray: '4 3',
            }}
          >
            <Tooltip permanent direction="center" className="obs-label">
              {obs.label} ({formatArea(calculatePolygonArea(obs.points))})
            </Tooltip>
          </Polygon>
          {/* Obstruction edge labels & handles */}
          {obs.points.map((pt, i) => {
            const next = obs.points[(i + 1) % obs.points.length];
            const mid = [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2];
            return (
              <React.Fragment key={`obs-edge-${obsIdx}-${i}`}>
                {toolMode === 'edit' && (
                  <CircleMarker
                    center={mid}
                    radius={5}
                    pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#ef4444', fillOpacity: 0.9 }}
                    eventHandlers={{
                      click: (e) => {
                        e.originalEvent?.stopPropagation();
                        insertMidpoint('obs', obsIdx, i);
                      },
                    }}
                  />
                )}
                <CircleMarker
                  center={pt}
                  radius={toolMode === 'edit' ? 7 : 4}
                  pathOptions={{
                    color: '#ffffff',
                    weight: 1.5,
                    fillColor: '#ef4444',
                    fillOpacity: 1,
                  }}
                  eventHandlers={{
                    mousedown: (e) => {
                      e.originalEvent?.stopPropagation();
                      setDraggedVtxInfo({ target: 'obs', obsIdx, vtxIdx: i });
                    },
                    contextmenu: (e) => removeVertex('obs', obsIdx, i, e),
                  }}
                />
              </React.Fragment>
            );
          })}
        </React.Fragment>
      ))}
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADDRESS & GEOSEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AddressLabel({ position, label }) {
  if (!position) return null;
  const icon = L.divIcon({
    className: 'address-marker',
    html: `<div class="addr-label"><span class="text-amber-400 font-bold">📍</span>${(label || '').split(',')[0]}</div>`,
    iconSize: [200, 30],
    iconAnchor: [100, 40],
  });
  return <Marker position={position} icon={icon} />;
}

function GeoSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function h(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const searchLocation = useCallback(async (text) => {
    if (text.length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }
    setSearching(true);
    try {
      const res = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: text, format: 'json', limit: 6, addressdetails: 1 },
        headers: { 'Accept-Language': 'en' },
      });
      setSuggestions(res.data);
      setIsOpen(res.data.length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLocation(val), 400);
  };

  const handleSelect = (item) => {
    setQuery(item.display_name);
    setIsOpen(false);
    setSuggestions([]);
    onSelect({ lat: parseFloat(item.lat), lng: parseFloat(item.lon), name: item.display_name });
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          className="w-full bg-gray-800/90 border border-gray-700/80 rounded-xl pl-9 pr-9 py-2.5 text-gray-100 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition placeholder-gray-500 shadow-inner"
          placeholder="Search any building, address, or city..."
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setSuggestions([]); setIsOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-amber-400" />
        )}
      </div>
      {isOpen && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-gray-850 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-[2000] max-h-72 overflow-y-auto divide-y divide-gray-800">
          {suggestions.map((item, i) => (
            <button
              key={item.place_id || i}
              onClick={() => handleSelect(item)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-800/80 transition text-left group"
            >
              <MapPin className="w-4 h-4 text-amber-400 mt-0.5 shrink-0 group-hover:scale-110 transition-transform" />
              <div className="min-w-0">
                <p className="text-sm text-gray-200 font-medium truncate">{item.display_name.split(',')[0]}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">{item.display_name.split(',').slice(1).join(',').trim()}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OBSTRUCTION PRESETS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OBSTRUCTION_PRESETS = [
  { id: 'ac', label: 'AC Unit / HVAC', icon: Wind, desc: 'Draw box or freehand' },
  { id: 'tank', label: 'Water Tank / Dome', icon: Droplets, desc: 'Draw circle or box' },
  { id: 'chimney', label: 'Chimney / Vent', icon: ShieldAlert, desc: 'Exclusion zone' },
  { id: 'other', label: 'Custom Obstacle', icon: Box, desc: 'Draw outline' },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN SURYASCOPE APPLICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function App() {
  const [roofPoints, setRoofPoints] = useState([]);
  const [obstructions, setObstructions] = useState([]);
  const [toolMode, setToolMode] = useState(null); // 'freehand' | 'polygon' | 'rectangle' | 'circle' | 'edit' | null
  const [drawTarget, setDrawTarget] = useState('roof'); // 'roof' | 'obstruction'
  const [currentObsLabel, setCurrentObsLabel] = useState('AC Unit');

  const [address, setAddress] = useState('JSS Academy of Technical Education, Noida');
  const [mapCenter] = useState([28.6143, 77.3588]);
  const [flyTo, setFlyTo] = useState(null);
  const [labelPos, setLabelPos] = useState([28.6143, 77.3588]);

  const [showPanels, setShowPanels] = useState(true);
  const [satelliteMode, setSatelliteMode] = useState('esri'); // 'esri' | 'osm'
  const [tariff, setTariff] = useState(8.0);
  const [unitImperial, setUnitImperial] = useState(false);
  const [isHouseholder, setIsHouseholder] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [history, setHistory] = useState([]);

  // Client-side real-time calculation
  const result = useMemo(() => {
    return computeSolarPotential(roofPoints, obstructions, tariff, isHouseholder);
  }, [roofPoints, obstructions, tariff, isHouseholder]);

  // Solar panel grid simulation overlay
  const panelGrid = useMemo(() => {
    if (!showPanels || roofPoints.length < 3) return [];
    return generatePanelGrid(roofPoints, obstructions);
  }, [showPanels, roofPoints, obstructions]);

  // Save history state before changes
  const pushHistory = useCallback(() => {
    setHistory(prev => [...prev.slice(-10), { roofPoints, obstructions }]);
  }, [roofPoints, obstructions]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setRoofPoints(last.roofPoints);
    setObstructions(last.obstructions);
    setHistory(prev => prev.slice(0, -1));
  }, [history]);

  const handleSearchSelect = useCallback((location) => {
    setAddress(location.name);
    setFlyTo([location.lat, location.lng]);
    setLabelPos([location.lat, location.lng]);
    setRoofPoints([]);
    setObstructions([]);
    setToolMode(null);
    setHistory([]);
  }, []);

  const startRoofDrawing = (mode = 'freehand') => {
    pushHistory();
    setRoofPoints([]);
    setDrawTarget('roof');
    setToolMode(mode);
  };

  const startObstructionDrawing = (label, mode = 'freehand') => {
    pushHistory();
    setCurrentObsLabel(label);
    setDrawTarget('obstruction');
    setToolMode(mode);
  };

  const handleFinishDrawing = useCallback((target) => {
    setToolMode(null);
  }, []);

  const removeObstruction = (id) => {
    pushHistory();
    setObstructions(prev => prev.filter(o => o.id !== id));
  };

  const clearAll = () => {
    pushHistory();
    setRoofPoints([]);
    setObstructions([]);
    setToolMode(null);
  };

  // Open report preview modal
  const openReportPreview = () => {
    if (!result || roofPoints.length < 3) {
      alert('Please draw a rooftop outline on the map first.');
      return;
    }
    setShowPreview(true);
  };

  // Generate Vendor PDF Report with backend fallback
  const generateReport = async () => {
    if (!result || roofPoints.length < 3) return;
    setExportingPdf(true);
    try {
      const payload = {
        polygon: roofPoints.map(p => ({ lat: p[0], lng: p[1] })),
        obstructions: obstructions.map(o => ({
          polygon: o.points.map(p => ({ lat: p[0], lng: p[1] })),
          label: o.label,
        })),
        address,
      };

      const response = await axios.post('/api/generate-report', payload, {
        responseType: 'blob',
        timeout: 10000,
      });

      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      setPdfBlobUrl(url);

      // Auto-download
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `SuryaScope_Report_${address.split(',')[0].replace(/\s+/g, '_')}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.warn('Backend PDF endpoint unreachable, providing client report information.', err);
      alert(
        'Backend server is not running or accessible. ' +
        'Please ensure the backend is available to download the full PDF report.\n\n' +
        `Summary:\n- Usable Area: ${result.usable_area_sqm} m²\n- Capacity: ${result.capacity_kw} kWp\n- PM Surya Ghar Subsidy: ₹${result.subsidy_inr.toLocaleString()}\n- Net Cost: ₹${result.net_cost_inr.toLocaleString()}`
      );
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950 font-sans text-gray-100">
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          LEFT SIDEBAR: SuryaScope Analytics & Controls
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="w-[430px] min-w-[390px] h-full bg-gray-900 shadow-2xl z-20 flex flex-col border-r border-gray-800">
        {/* Header Branding */}
        <div className="p-5 bg-gradient-to-br from-amber-500 via-orange-500 to-rose-600 relative overflow-hidden shadow-lg">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner border border-white/30">
                <Sun className="w-7 h-7 text-yellow-100 drop-shadow-md animate-spin-slow" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm font-['Outfit']">
                    SuryaScope
                  </h1>
                  <span className="text-[10px] font-bold bg-white/25 px-2 py-0.5 rounded-full text-white tracking-wide uppercase border border-white/30">
                    PM Surya Ghar
                  </span>
                </div>
                <p className="text-amber-100 text-xs font-medium mt-0.5">
                  Rooftop Solar CAD & Feasibility AI
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* Location Search */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              Search Location / Building
            </label>
            <GeoSearch onSelect={handleSearchSelect} />
          </div>

          {/* Current Address Pill */}
          <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 shadow-sm">
            <MapPin className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-300 font-medium leading-snug break-words">
                {address}
              </p>
            </div>
          </div>

          {/* Drawing Mode Selector Card */}
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4 space-y-3 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PenTool className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                  Rooftop Drawing Tool
                </span>
              </div>
              {roofPoints.length > 0 && (
                <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-700/50 px-2 py-0.5 rounded-full">
                  {roofPoints.length} Vertices
                </span>
              )}
            </div>

            {/* Quick Draw Buttons (Google Earth Style) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => startRoofDrawing('freehand')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                  toolMode === 'freehand' && drawTarget === 'roof'
                    ? 'bg-amber-500 border-amber-400 text-gray-950 shadow-lg shadow-amber-500/20'
                    : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-750 hover:border-amber-500/50 hover:text-white'
                }`}
              >
                <PenTool className="w-4 h-4 text-amber-400" />
                <div className="text-left">
                  <div className="leading-none">Freehand Path</div>
                  <span className="text-[10px] font-normal text-gray-400">Click & Drag Trace</span>
                </div>
              </button>

              <button
                onClick={() => startRoofDrawing('polygon')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                  toolMode === 'polygon' && drawTarget === 'roof'
                    ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-600/20'
                    : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-750 hover:border-blue-500/50 hover:text-white'
                }`}
              >
                <MousePointerClick className="w-4 h-4 text-blue-400" />
                <div className="text-left">
                  <div className="leading-none">Corner Polygon</div>
                  <span className="text-[10px] font-normal text-gray-400">Click vertex-by-vertex</span>
                </div>
              </button>

              <button
                onClick={() => startRoofDrawing('rectangle')}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                  toolMode === 'rectangle' && drawTarget === 'roof'
                    ? 'bg-blue-600 border-blue-400 text-white'
                    : 'bg-gray-800/80 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <Square className="w-3.5 h-3.5 text-cyan-400" />
                <span>Box / Rectangle</span>
              </button>

              <button
                onClick={() => setToolMode(toolMode === 'edit' ? null : 'edit')}
                disabled={roofPoints.length < 3}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                  toolMode === 'edit'
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : roofPoints.length < 3
                    ? 'opacity-40 cursor-not-allowed bg-gray-800 border-gray-700 text-gray-500'
                    : 'bg-gray-800/80 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 text-purple-400" />
                <span>{toolMode === 'edit' ? '✓ Done Editing' : 'Drag Vertices'}</span>
              </button>
            </div>
          </div>

          {/* Obstruction Marking Card (Available once roof is drawn) */}
          {roofPoints.length >= 3 && (
            <div className="bg-red-950/20 border border-red-800/40 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-bold text-red-200 uppercase tracking-wider">
                    Subtract Obstructions
                  </span>
                </div>
                <span className="text-[10px] text-gray-400 font-medium">
                  {obstructions.length} Marked
                </span>
              </div>

              <p className="text-xs text-gray-400">
                Select an obstruction type and sketch it over water tanks, HVAC, or stairs:
              </p>

              <div className="grid grid-cols-2 gap-2">
                {OBSTRUCTION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => startObstructionDrawing(p.label, p.id === 'tank' ? 'circle' : 'freehand')}
                    className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-medium text-left transition-all ${
                      toolMode && drawTarget === 'obstruction' && currentObsLabel === p.label
                        ? 'bg-red-600 border-red-400 text-white shadow-md'
                        : 'border-red-900/60 bg-red-950/40 text-red-200 hover:bg-red-900/40 hover:border-red-600'
                    }`}
                  >
                    <p.icon className="w-3.5 h-3.5 shrink-0 text-red-400" />
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </div>

              {obstructions.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-red-900/40 max-h-36 overflow-y-auto">
                  {obstructions.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between bg-red-950/50 border border-red-900/40 rounded-lg px-3 py-1.5 text-xs text-red-200"
                    >
                      <span className="font-medium truncate">
                        {o.label} — {formatArea(calculatePolygonArea(o.points), unitImperial)}
                      </span>
                      <button
                        onClick={() => removeObstruction(o.id)}
                        className="text-red-400 hover:text-red-200 p-0.5 rounded transition"
                        title="Remove Obstruction"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PM Surya Ghar Eligibility Toggle ── */}
          {roofPoints.length >= 3 && (
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg ${isHouseholder ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-600/20 text-gray-500'} transition-colors`}>
                    <Sun className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-200">PM Surya Ghar Yojana</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {isHouseholder ? 'Residential subsidy applied' : 'Non-residential — no subsidy'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsHouseholder(!isHouseholder)}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                    isHouseholder ? 'bg-amber-500' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
                      isHouseholder ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {!isHouseholder && (
                <div className="mt-2.5 bg-yellow-950/40 border border-yellow-800/40 rounded-xl px-3 py-2 text-[11px] text-yellow-300/90 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-yellow-400" />
                  <span>PM Surya Ghar subsidy is available only for residential households. Commercial, institutional, and industrial buildings are not eligible for the CFA subsidy.</span>
                </div>
              )}
            </div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              CALCULATION RESULTS & SYSTEM SIZING
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {result && (
            <div className="space-y-3.5 animate-fadeIn">
              {/* System Sizing Card */}
              <div className="bg-gradient-to-br from-blue-950/60 via-blue-900/30 to-indigo-950/60 p-4 rounded-2xl border border-blue-700/50 shadow-xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between border-b border-blue-800/40 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-300">
                      <Zap className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-bold text-blue-200 tracking-wide">
                      System Sizing & PV Potential
                    </h3>
                  </div>
                  <span className="text-xs font-extrabold text-blue-300 bg-blue-900/60 border border-blue-600/40 px-2.5 py-0.5 rounded-full">
                    {result.capacity_kw} kWp
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <StatBox
                    label="Gross Roof Area"
                    value={formatArea(result.gross_area_sqm, unitImperial)}
                  />
                  <StatBox
                    label="Obstruction Area"
                    value={result.obstruction_area_sqm > 0 ? `-${formatArea(result.obstruction_area_sqm, unitImperial)}` : '0 m²'}
                    accent="text-red-400"
                  />
                  <StatBox
                    label="Net Usable Area"
                    value={formatArea(result.usable_area_sqm, unitImperial)}
                    accent="text-amber-300"
                  />
                  <StatBox
                    label="500W Panels"
                    value={`${result.panel_count} Modules`}
                    accent="text-cyan-300"
                  />
                  <StatBox
                    label="Annual Generation"
                    value={`${result.generation_kwh_yr.toLocaleString()} kWh`}
                  />
                  <StatBox
                    label="Daily Average"
                    value={`${result.daily_generation_kwh} kWh/day`}
                  />
                </div>

                {/* CO2 & Green Impact Badge */}
                <div className="pt-2 border-t border-blue-800/40 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <Leaf className="w-3.5 h-3.5" />
                    <span>CO₂ Saved: {result.co2_offset_tons} t/yr</span>
                  </div>
                  <div className="flex items-center gap-1 text-emerald-300 font-medium">
                    <TreePine className="w-3.5 h-3.5" />
                    <span>{result.trees_equivalent} trees/yr</span>
                  </div>
                </div>
              </div>

              {/* PM Surya Ghar Financials & Subsidy Card */}
              <div className="bg-gradient-to-br from-emerald-950/60 via-emerald-900/30 to-teal-950/60 p-4 rounded-2xl border border-emerald-700/50 shadow-xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between border-b border-emerald-800/40 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300">
                      <IndianRupee className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-bold text-emerald-200 tracking-wide">
                      PM Surya Ghar Economics
                    </h3>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-300 bg-emerald-900/60 border border-emerald-600/40 px-2 py-0.5 rounded-full">
                    ROI in {result.payback_years} yrs
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <FinancialRow label="Estimated Gross Cost" value={`₹${result.total_cost_inr.toLocaleString()}`} />
                  <FinancialRow
                    label="PM Surya Ghar Subsidy (CFA)"
                    value={isHouseholder ? `- ₹${result.subsidy_inr.toLocaleString()}` : '₹0 (Not Eligible)'}
                    accent={isHouseholder ? 'text-emerald-400 font-bold' : 'text-gray-500'}
                  />
                  <div className="h-px bg-emerald-800/40 my-1.5" />
                  <FinancialRow
                    label="Net Customer Investment"
                    value={`₹${result.net_cost_inr.toLocaleString()}`}
                    bold
                  />
                  <FinancialRow
                    label="Annual Electricity Savings"
                    value={`₹${result.annual_savings_inr.toLocaleString()}/yr`}
                  />
                  <FinancialRow
                    label="25-Year Lifetime Savings"
                    value={`₹${result.lifetime_savings_inr.toLocaleString()}`}
                    accent="text-amber-300 font-bold"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Empty State Instructions */}
          {!result && roofPoints.length === 0 && (
            <div className="border border-dashed border-gray-700 rounded-2xl p-6 text-center text-gray-400 space-y-3 bg-gray-800/20">
              <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
                <PenTool className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-200">Draw Rooftop on Map</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Click <strong className="text-amber-400">Freehand Path</strong> to trace smoothly, or <strong className="text-blue-400">Corner Polygon</strong> to click vertices around your roof.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ─── Footer Action: Preview Report ─── */}
        <div className="p-4 border-t border-gray-800 bg-gray-900/90 space-y-2">
          <button
            onClick={openReportPreview}
            disabled={!result}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-white shadow-xl transition-all text-sm ${
              !result
                ? 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed opacity-50'
                : 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 hover:from-amber-600 hover:to-orange-600 active:scale-[0.98] shadow-amber-500/20'
            }`}
          >
            <Eye className="w-4 h-4" />
            Preview &amp; Download Report
          </button>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          RIGHT INTERACTIVE MAP CANVAS
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 h-full relative">
        <MapContainer
          center={mapCenter}
          zoom={19}
          style={{ height: '100%', width: '100%' }}
          maxZoom={22}
          zoomControl={false}
        >
          {/* Tile layer selector */}
          {satelliteMode === 'esri' ? (
            <TileLayer
              attribution="&copy; Esri World Imagery"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={22}
              maxNativeZoom={19}
            />
          ) : (
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={20}
            />
          )}

          <MapController flyTo={flyTo} />

          {/* Address marker */}
          <AddressLabel position={labelPos} label={address} />

          {/* Master Interactive Drawing Engine */}
          <InteractiveDrawingEngine
            toolMode={toolMode}
            drawTarget={drawTarget}
            roofPoints={roofPoints}
            setRoofPoints={setRoofPoints}
            obstructions={obstructions}
            setObstructions={setObstructions}
            currentObsLabel={currentObsLabel}
            onFinishDrawing={handleFinishDrawing}
          />

          {/* Realistic Solar Panel Grid Array Overlay */}
          {panelGrid.map((corners, idx) => (
            <Polygon
              key={`pv-panel-${idx}`}
              positions={corners}
              pathOptions={{
                color: '#1e3a8a',
                weight: 1,
                fillColor: '#1d4ed8',
                fillOpacity: 0.85,
              }}
            />
          ))}
        </MapContainer>

        {/* ── Top Status Bar & Drawing Helper ── */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-md px-5 py-2 rounded-full shadow-2xl z-[1000] border border-gray-700/80 flex items-center gap-3">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              toolMode === 'freehand'
                ? 'bg-amber-400 animate-ping'
                : toolMode === 'polygon'
                ? 'bg-blue-400 animate-pulse'
                : toolMode === 'edit'
                ? 'bg-purple-400 animate-pulse'
                : roofPoints.length >= 3
                ? 'bg-emerald-400'
                : 'bg-gray-500'
            }`}
          />
          <span className="text-xs font-semibold text-gray-200">
            {toolMode === 'freehand'
              ? `✏️ Freehand Mode: Click and drag across ${drawTarget === 'roof' ? 'roof' : currentObsLabel} boundary`
              : toolMode === 'polygon'
              ? `📐 Corner Mode: Click points (click 1st vertex to close)`
              : toolMode === 'edit'
              ? `✋ Edit Mode: Drag vertices or click '+' on edges to adjust`
              : roofPoints.length >= 3
              ? `SuryaScope Ready ✓ ${result?.usable_area_sqm} m² usable area calculated`
              : `Select a tool to outline your rooftop`}
          </span>
        </div>

        {/* ── Floating Map Action Toolbar (Top-Right) ── */}
        <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
          {/* Active Finish Button */}
          {toolMode && (
            <button
              onClick={() => setToolMode(null)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xl border border-emerald-400 transition transform active:scale-95 animate-bounce"
            >
              <Check className="w-4 h-4" />
              <span>Finish {drawTarget === 'roof' ? 'Roof' : currentObsLabel}</span>
            </button>
          )}

          {/* Undo Action */}
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className={`p-2.5 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-200 border border-gray-700 shadow-xl backdrop-blur-md transition ${
              history.length === 0 ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'
            }`}
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Solar Panel Array Grid Toggle */}
          <button
            onClick={() => setShowPanels(!showPanels)}
            className={`p-2.5 rounded-xl border shadow-xl backdrop-blur-md transition ${
              showPanels
                ? 'bg-blue-600/90 border-blue-400 text-white'
                : 'bg-gray-900/90 border-gray-700 text-gray-400 hover:text-white'
            }`}
            title="Toggle Solar Panel Array Overlay"
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {/* Satellite / Street Map Toggle */}
          <button
            onClick={() => setSatelliteMode(satelliteMode === 'esri' ? 'osm' : 'esri')}
            className="p-2.5 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-200 border border-gray-700 shadow-xl backdrop-blur-md transition"
            title="Toggle Satellite / Hybrid Map"
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* Clear All */}
          {(roofPoints.length > 0 || obstructions.length > 0) && (
            <button
              onClick={clearAll}
              className="p-2.5 rounded-xl bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-300 shadow-xl backdrop-blur-md transition"
              title="Clear Everything"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Bottom Solar Stats Overlay Pill ── */}
        {result && (
          <div className="absolute bottom-6 left-6 z-[1000] bg-gray-900/95 backdrop-blur-md border border-gray-700/80 rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-6 divide-x divide-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                <Sun className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">System Size</p>
                <p className="text-base font-extrabold text-white font-['Outfit']">{result.capacity_kw} kWp</p>
              </div>
            </div>

            <div className="pl-6">
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Net Investment</p>
              <p className="text-base font-extrabold text-emerald-400 font-['Outfit']">
                ₹{result.net_cost_inr.toLocaleString()}
              </p>
            </div>

            <div className="pl-6">
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Annual Generation</p>
              <p className="text-base font-extrabold text-blue-300 font-['Outfit']">
                {result.generation_kwh_yr.toLocaleString()} kWh
              </p>
            </div>

            <div className="pl-6 flex items-center gap-2">
              <span className="text-xs text-gray-400">Subsidy:</span>
              <span className="text-xs font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-700/60 px-2 py-0.5 rounded-lg">
                ₹{result.subsidy_inr.toLocaleString()} CFA
              </span>
            </div>
          </div>
        )}
      </div>
      {/* ── Report Preview Modal ── */}
      {showPreview && result && (
        <ReportPreviewModal
          result={result}
          address={address}
          isHouseholder={isHouseholder}
          exportingPdf={exportingPdf}
          onDownload={generateReport}
          onClose={() => { setShowPreview(false); if (pdfBlobUrl) { window.URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); } }}
        />
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MINI SUB-COMPONENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function StatBox({ label, value, accent }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-2.5 shadow-sm">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold mt-0.5 font-['Outfit'] ${accent || 'text-gray-100'}`}>
        {value}
      </p>
    </div>
  );
}

function FinancialRow({ label, value, accent, bold }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className={`${bold ? 'font-bold text-gray-100' : 'text-gray-400'}`}>{label}</span>
      <span className={`font-semibold font-['Outfit'] ${bold ? 'text-sm text-emerald-300 font-bold' : accent || 'text-gray-100'}`}>
        {value}
      </span>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REPORT PREVIEW MODAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ReportPreviewModal({ result, address, isHouseholder, exportingPdf, onDownload, onClose }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-gray-900 border border-gray-700 rounded-3xl shadow-2xl w-[680px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30">
              <Sun className="w-6 h-6 text-yellow-100" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white font-['Outfit']">SuryaScope Report Preview</h2>
              <p className="text-xs text-amber-100">Solar Feasibility Analysis</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Report Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Site Info */}
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Site Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-gray-400 font-semibold">Location</p>
                <p className="text-gray-100 font-medium mt-0.5 break-words">{address}</p>
              </div>
              <div>
                <p className="text-gray-400 font-semibold">Gross Roof Area</p>
                <p className="text-gray-100 font-bold mt-0.5 font-['Outfit']">{result.gross_area_sqm} m²</p>
              </div>
              <div>
                <p className="text-gray-400 font-semibold">Obstruction Area</p>
                <p className="text-red-400 font-bold mt-0.5 font-['Outfit']">-{result.obstruction_area_sqm} m²</p>
              </div>
              <div>
                <p className="text-gray-400 font-semibold">Net Usable Area</p>
                <p className="text-amber-300 font-bold mt-0.5 font-['Outfit']">{result.usable_area_sqm} m²</p>
              </div>
            </div>
          </div>

          {/* System Sizing */}
          <div className="bg-gradient-to-br from-blue-950/60 via-blue-900/30 to-indigo-950/60 border border-blue-700/50 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-blue-200 uppercase tracking-wider">System Sizing & PV Potential</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-blue-800/40">
                    <th className="text-left px-3 py-2 text-blue-200 font-bold rounded-tl-lg">Parameter</th>
                    <th className="text-right px-3 py-2 text-blue-200 font-bold rounded-tr-lg">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-800/30">
                  <tr className="hover:bg-blue-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Recommended System Capacity</td>
                    <td className="px-3 py-2 text-right text-white font-bold font-['Outfit']">{result.capacity_kw} kWp</td>
                  </tr>
                  <tr className="hover:bg-blue-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Panel Count (500Wp each)</td>
                    <td className="px-3 py-2 text-right text-white font-bold font-['Outfit']">{result.panel_count} Modules</td>
                  </tr>
                  <tr className="hover:bg-blue-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Annual Generation</td>
                    <td className="px-3 py-2 text-right text-white font-bold font-['Outfit']">{result.generation_kwh_yr.toLocaleString()} kWh/yr</td>
                  </tr>
                  <tr className="hover:bg-blue-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Daily Average Generation</td>
                    <td className="px-3 py-2 text-right text-white font-bold font-['Outfit']">{result.daily_generation_kwh} kWh/day</td>
                  </tr>
                  <tr className="hover:bg-blue-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">CO₂ Offset</td>
                    <td className="px-3 py-2 text-right text-emerald-400 font-bold font-['Outfit']">{result.co2_offset_tons} tonnes/yr</td>
                  </tr>
                  <tr className="hover:bg-blue-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Trees Equivalent</td>
                    <td className="px-3 py-2 text-right text-emerald-300 font-bold font-['Outfit']">{result.trees_equivalent} trees/yr</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Financial Analysis */}
          <div className="bg-gradient-to-br from-emerald-950/60 via-emerald-900/30 to-teal-950/60 border border-emerald-700/50 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-emerald-200 uppercase tracking-wider">Financial Analysis</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-emerald-800/40">
                    <th className="text-left px-3 py-2 text-emerald-200 font-bold rounded-tl-lg">Parameter</th>
                    <th className="text-right px-3 py-2 text-emerald-200 font-bold rounded-tr-lg">Amount (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-800/30">
                  <tr className="hover:bg-emerald-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Estimated Gross Cost</td>
                    <td className="px-3 py-2 text-right text-white font-bold font-['Outfit']">₹{result.total_cost_inr.toLocaleString()}</td>
                  </tr>
                  <tr className="hover:bg-emerald-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">PM Surya Ghar Subsidy (CFA)</td>
                    <td className={`px-3 py-2 text-right font-bold font-['Outfit'] ${isHouseholder ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {isHouseholder ? `- ₹${result.subsidy_inr.toLocaleString()}` : '₹0 (Not Eligible)'}
                    </td>
                  </tr>
                  <tr className="bg-emerald-900/30">
                    <td className="px-3 py-2.5 text-white font-bold">Net Customer Investment</td>
                    <td className="px-3 py-2.5 text-right text-emerald-300 font-extrabold text-sm font-['Outfit']">₹{result.net_cost_inr.toLocaleString()}</td>
                  </tr>
                  <tr className="hover:bg-emerald-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Annual Electricity Savings</td>
                    <td className="px-3 py-2 text-right text-white font-bold font-['Outfit']">₹{result.annual_savings_inr.toLocaleString()}/yr</td>
                  </tr>
                  <tr className="hover:bg-emerald-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">Payback Period</td>
                    <td className="px-3 py-2 text-right text-amber-300 font-bold font-['Outfit']">{result.payback_years} Years</td>
                  </tr>
                  <tr className="hover:bg-emerald-900/20 transition">
                    <td className="px-3 py-2 text-gray-300">25-Year Lifetime Savings</td>
                    <td className="px-3 py-2 text-right text-amber-300 font-extrabold font-['Outfit']">₹{result.lifetime_savings_inr.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl px-4 py-3 text-[11px] text-gray-400 leading-relaxed">
            <p><strong className="text-gray-300">Disclaimer:</strong> This is an automated feasibility report generated by SuryaScope based on satellite imagery and typical meteorological year (TMY) data. Obstructions (AC units, water tanks, etc.) have been excluded from the usable area. Actual costs and generation may vary based on site-specific factors like shading, roof tilt, and local vendor pricing.</p>
          </div>
        </div>

        {/* Modal Footer — Download Button */}
        <div className="p-5 border-t border-gray-700 bg-gray-900/95 flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm font-semibold transition"
          >
            Close
          </button>
          <button
            onClick={onDownload}
            disabled={exportingPdf}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-white shadow-xl transition-all text-sm ${
              exportingPdf
                ? 'bg-gray-700 cursor-wait'
                : 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 hover:from-amber-600 hover:to-orange-600 active:scale-[0.98] shadow-amber-500/20'
            }`}
          >
            {exportingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Download SuryaScope PDF Report
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
