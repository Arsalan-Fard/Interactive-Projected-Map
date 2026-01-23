import json
import math
import os
from collections import defaultdict


def _safe_int(value):
    try:
        if value is None:
            return None
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, (int, float)) and int(value) == value:
            return int(value)
        s = str(value).strip()
        if s == "":
            return None
        return int(float(s))
    except Exception:
        return value


def _is_oneway_true(value) -> bool:
    if value is True:
        return True
    if value is False or value is None:
        return False
    s = str(value).strip().lower()
    return s in ("true", "1", "yes", "y")


def _is_oneway_false(value) -> bool:
    if value is False or value is None:
        return True
    if value is True:
        return False
    s = str(value).strip().lower()
    return s in ("false", "0", "no", "n", "")


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * r * math.asin(math.sqrt(a))


def _polyline_length_m(coords) -> float:
    if not coords or len(coords) < 2:
        return 0.0
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(coords[:-1], coords[1:]):
        total += _haversine_m(lat1, lon1, lat2, lon2)
    return float(total)


def _mercator_xy(lon, lat):
    r = 6378137.0
    x = r * math.radians(lon)
    lat = max(min(lat, 89.9), -89.9)
    y = r * math.log(math.tan(math.pi / 4.0 + math.radians(lat) / 2.0))
    return (x, y)


def _closest_point_on_segment_xy(px, py, ax, ay, bx, by):
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    ab_len_sq = abx * abx + aby * aby
    if ab_len_sq == 0:
        return (0.0, ax, ay, (px - ax) ** 2 + (py - ay) ** 2)
    t = (apx * abx + apy * aby) / ab_len_sq
    if t < 0:
        t = 0.0
    elif t > 1:
        t = 1.0
    cx = ax + t * abx
    cy = ay + t * aby
    d2 = (px - cx) ** 2 + (py - cy) ** 2
    return (float(t), float(cx), float(cy), float(d2))


def _locate_point_on_polyline(coords, point_lonlat):
    if not coords or len(coords) < 2:
        return None
    (plon, plat) = point_lonlat
    px, py = _mercator_xy(plon, plat)
    best = None
    for i in range(len(coords) - 1):
        (alon, alat) = coords[i]
        (blon, blat) = coords[i + 1]
        ax, ay = _mercator_xy(alon, alat)
        bx, by = _mercator_xy(blon, blat)
        t, _, _, d2 = _closest_point_on_segment_xy(px, py, ax, ay, bx, by)
        if best is None or d2 < best["d2"]:
            best = {"segment_index": i, "t": t, "d2": d2}
    return best


def _dedupe_coords(coords, eps=1e-12):
    out = []
    for c in coords or []:
        if not out:
            out.append(c)
            continue
        if abs(out[-1][0] - c[0]) <= eps and abs(out[-1][1] - c[1]) <= eps:
            continue
        out.append(c)
    return out


def _split_line_at_cuts(coords, cuts_sorted):
    coords = _dedupe_coords(coords)
    if len(coords) < 2:
        return []

    segments = []
    current = [coords[0]]
    cut_idx = 0
    for i in range(len(coords) - 1):
        while cut_idx < len(cuts_sorted) and cuts_sorted[cut_idx]["segment_index"] == i:
            p = cuts_sorted[cut_idx]["coord"]
            if current and (current[-1][0] != p[0] or current[-1][1] != p[1]):
                current.append(p)
            current = _dedupe_coords(current)
            if len(current) >= 2:
                segments.append(current)
            current = [p]
            cut_idx += 1

        b = coords[i + 1]
        if current and (current[-1][0] != b[0] or current[-1][1] != b[1]):
            current.append(b)

    current = _dedupe_coords(current)
    if len(current) >= 2:
        segments.append(current)
    return segments


def build_patched_walking_network(base_edges_fc, base_nodes_fc, override_nodes_fc=None, override_edges_fc=None):
    base_edges = list((base_edges_fc or {}).get("features", []) or [])
    base_nodes = list((base_nodes_fc or {}).get("features", []) or [])

    override_nodes = list((override_nodes_fc or {}).get("features", []) or [])
    override_edges = list((override_edges_fc or {}).get("features", []) or [])

    indices_by_uv = defaultdict(list)
    for idx, feat in enumerate(base_edges):
        props = feat.get("properties", {}) or {}
        u = _safe_int(props.get("u"))
        v = _safe_int(props.get("v"))
        indices_by_uv[(u, v)].append(idx)

    cuts_by_feature = defaultdict(list)
    override_nodes_by_id = {}
    for feat in override_nodes:
        props = feat.get("properties", {}) or {}
        node_id = _safe_int(props.get("id", props.get("osmid")))
        if node_id is not None:
            override_nodes_by_id[node_id] = feat

        if props.get("snapped_kind") != "edge":
            continue
        fi = props.get("edge_feature_index")
        if fi is None:
            continue
        try:
            fi = int(fi)
        except Exception:
            continue
        if fi < 0 or fi >= len(base_edges):
            continue

        coords = (base_edges[fi].get("geometry", {}) or {}).get("coordinates")
        if not coords or len(coords) < 2:
            continue

        si = props.get("edge_segment_index")
        t = props.get("edge_segment_t")
        try:
            si = int(si)
        except Exception:
            si = None
        try:
            t = float(t)
        except Exception:
            t = None

        point = (feat.get("geometry", {}) or {}).get("coordinates")
        if not point or len(point) < 2:
            continue
        point = (float(point[0]), float(point[1]))

        if si is None or t is None or si < 0 or si >= len(coords) - 1:
            located = _locate_point_on_polyline(coords, point)
            if not located:
                continue
            si = located["segment_index"]
            t = located["t"]
        t = max(0.0, min(1.0, float(t)))

        cuts_by_feature[fi].append(
            {
                "node_id": node_id,
                "segment_index": si,
                "t": t,
                "coord": point,
            }
        )

    # If a base edge is two-way, also split its reverse directed edge(s) at the same inserted nodes.
    # This ensures the inserted node is traversable in both directions even if the editor only snapped one direction.
    for fi, cuts in list(cuts_by_feature.items()):
        base_feat = base_edges[fi]
        props = base_feat.get("properties", {}) or {}
        if _is_oneway_true(props.get("oneway")):
            continue
        u = _safe_int(props.get("u"))
        v = _safe_int(props.get("v"))
        if u is None or v is None:
            continue

        for rfi in indices_by_uv.get((v, u), []):
            if rfi == fi:
                continue
            rcoords = (base_edges[rfi].get("geometry", {}) or {}).get("coordinates")
            if not rcoords or len(rcoords) < 2:
                continue
            for cut in cuts:
                located = _locate_point_on_polyline(rcoords, cut["coord"])
                if not located:
                    continue
                cuts_by_feature[rfi].append(
                    {
                        "node_id": cut["node_id"],
                        "segment_index": int(located["segment_index"]),
                        "t": float(located["t"]),
                        "coord": cut["coord"],
                    }
                )

    replacement_by_feature = {}
    for fi, raw_cuts in cuts_by_feature.items():
        feat = base_edges[fi]
        coords = (feat.get("geometry", {}) or {}).get("coordinates")
        if not coords or len(coords) < 2:
            continue

        # Order cuts along the edge by metric length from the start of the polyline.
        prefix = [0.0]
        for (lon1, lat1), (lon2, lat2) in zip(coords[:-1], coords[1:]):
            prefix.append(prefix[-1] + _haversine_m(lat1, lon1, lat2, lon2))

        cuts = []
        for cut in raw_cuts:
            si = int(cut["segment_index"])
            t = float(cut["t"])
            if si < 0 or si >= len(coords) - 1:
                continue
            (lon1, lat1) = coords[si]
            (lon2, lat2) = coords[si + 1]
            seg_len = _haversine_m(lat1, lon1, lat2, lon2)
            measure = prefix[si] + t * seg_len
            cuts.append({**cut, "measure_m": float(measure)})

        cuts.sort(key=lambda c: (c["segment_index"], c["t"], c["measure_m"]))
        # Dedupe by node id (prefer earliest occurrence).
        seen_node_ids = set()
        cuts_deduped = []
        for cut in cuts:
            nid = cut["node_id"]
            if nid in seen_node_ids:
                continue
            seen_node_ids.add(nid)
            cuts_deduped.append(cut)

        if not cuts_deduped:
            continue

        cuts_for_split = sorted(cuts_deduped, key=lambda c: (c["measure_m"], c["segment_index"], c["t"]))
        geom_cuts = [
            {"segment_index": int(c["segment_index"]), "t": float(c["t"]), "coord": c["coord"]} for c in cuts_for_split
        ]

        split_geoms = _split_line_at_cuts(coords, sorted(geom_cuts, key=lambda c: (c["segment_index"], c["t"])))
        if len(split_geoms) != len(cuts_for_split) + 1:
            # Safety: if splitting failed (degenerate cuts), skip replacement.
            continue

        props = dict(feat.get("properties", {}) or {})
        u0 = _safe_int(props.get("u"))
        v0 = _safe_int(props.get("v"))
        if u0 is None or v0 is None:
            continue

        chain = [u0] + [_safe_int(c["node_id"]) for c in cuts_for_split] + [v0]
        new_features = []
        base_osmid = props.get("osmid")
        for seg_idx, seg_coords in enumerate(split_geoms):
            seg_props = dict(props)
            seg_props["u"] = chain[seg_idx]
            seg_props["v"] = chain[seg_idx + 1]
            seg_props["length"] = _polyline_length_m(seg_coords)
            if isinstance(base_osmid, (str, int, float)) and base_osmid is not None:
                seg_props["osmid"] = f"{base_osmid}:split:{seg_idx}"
            else:
                seg_props["osmid"] = f"split:{fi}:{seg_idx}"
            new_features.append(
                {
                    "type": "Feature",
                    "properties": seg_props,
                    "geometry": {"type": "LineString", "coordinates": seg_coords},
                }
            )

        replacement_by_feature[fi] = new_features

    patched_edges = []
    for idx, feat in enumerate(base_edges):
        if idx in replacement_by_feature:
            patched_edges.extend(replacement_by_feature[idx])
            continue
        props = dict(feat.get("properties", {}) or {})
        if "length" not in props:
            coords = (feat.get("geometry", {}) or {}).get("coordinates")
            if coords and len(coords) >= 2:
                props["length"] = _polyline_length_m(coords)
        patched_edges.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": feat.get("geometry"),
            }
        )

    # Append manual override edges (ensure they have length).
    for feat in override_edges:
        props = dict(feat.get("properties", {}) or {})
        coords = (feat.get("geometry", {}) or {}).get("coordinates")
        if "length" not in props and coords and len(coords) >= 2:
            props["length"] = _polyline_length_m(coords)
        props.setdefault("osmid", "manual:unknown")
        patched_edges.append({"type": "Feature", "properties": props, "geometry": feat.get("geometry")})

    # Build patched nodes by appending overrides (keep base intact).
    base_node_ids = set()
    patched_nodes = []
    for feat in base_nodes:
        props = feat.get("properties", {}) or {}
        nid = _safe_int(props.get("osmid", props.get("id")))
        if nid is not None:
            base_node_ids.add(nid)
        patched_nodes.append(feat)

    for feat in override_nodes:
        props = feat.get("properties", {}) or {}
        nid = _safe_int(props.get("id", props.get("osmid")))
        if nid is None or nid in base_node_ids:
            continue
        patched_nodes.append(feat)
        base_node_ids.add(nid)

    edges_fc = {"type": "FeatureCollection", "features": patched_edges}
    nodes_fc = {"type": "FeatureCollection", "features": patched_nodes}
    return edges_fc, nodes_fc


def build_graph_from_geojson(nodes_fc, edges_fc):
    import networkx as nx

    G = nx.MultiDiGraph()
    G.graph["crs"] = "EPSG:4326"

    node_coords = {}
    for feat in (nodes_fc or {}).get("features", []) or []:
        props = feat.get("properties", {}) or {}
        nid = _safe_int(props.get("osmid", props.get("id")))
        geom = feat.get("geometry", {}) or {}
        coords = geom.get("coordinates")
        if nid is None or not coords or len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        node_coords[nid] = (lon, lat)
        G.add_node(nid, x=lon, y=lat)

    for feat in (edges_fc or {}).get("features", []) or []:
        props = feat.get("properties", {}) or {}
        u = _safe_int(props.get("u"))
        v = _safe_int(props.get("v"))
        geom = feat.get("geometry", {}) or {}
        coords = geom.get("coordinates")
        if u is None or v is None:
            continue

        if u not in G or v not in G:
            if coords and len(coords) >= 2:
                lon1, lat1 = coords[0]
                lon2, lat2 = coords[-1]
                if u not in G:
                    G.add_node(u, x=float(lon1), y=float(lat1))
                if v not in G:
                    G.add_node(v, x=float(lon2), y=float(lat2))
            else:
                continue

        length = props.get("length")
        try:
            length = float(length)
        except Exception:
            length = _polyline_length_m(coords) if coords and len(coords) >= 2 else 0.0

        edge_attrs = dict(props)
        edge_attrs["length"] = length
        edge_attrs["geometry"] = geom
        G.add_edge(u, v, **edge_attrs)

        # For manual edges created in the editor, treat oneway=false as bidirectional.
        osmid = props.get("osmid")
        if isinstance(osmid, str) and osmid.startswith("manual:") and _is_oneway_false(props.get("oneway")):
            G.add_edge(v, u, **edge_attrs)

    return G


def load_geojson(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_patched_from_files(
    *,
    base_edges_path,
    base_nodes_path,
    override_nodes_path=None,
    override_edges_path=None,
):
    base_edges_fc = load_geojson(base_edges_path)
    base_nodes_fc = load_geojson(base_nodes_path)
    override_nodes_fc = load_geojson(override_nodes_path) if override_nodes_path else None
    override_edges_fc = load_geojson(override_edges_path) if override_edges_path else None

    edges_fc, nodes_fc = build_patched_walking_network(
        base_edges_fc=base_edges_fc,
        base_nodes_fc=base_nodes_fc,
        override_nodes_fc=override_nodes_fc,
        override_edges_fc=override_edges_fc,
    )
    graph = build_graph_from_geojson(nodes_fc, edges_fc)
    return graph, edges_fc, nodes_fc
