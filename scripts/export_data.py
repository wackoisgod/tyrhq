import argparse
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from datetime import datetime, timezone
from pathlib import Path


CLI_PATH = os.environ.get("TYR_UNREAL_CLI", "tyr-unreal-cli")
BASE_DT_PATH = "/Game/DataTables"
BASE_REGISTRY_PATH = "/Game/DataRegistries"
TALENT_TREE_SOURCE_DIR = os.environ.get("TYR_TALENT_TREE_DIR")
CONTENT_DIR = os.environ.get("TYR_CONTENT_DIR")
RAW_OUT_DIR = "raw"
CANONICAL_OUT_DIR = "canonical"
GENERATED_OUT_DIR = "generated"
VEHICLE_IMAGES_DIR = "assets/images/vehicles"
ARMOR_MODELS_DIR = "assets/models/vehicles"
MAP_LOBBY_IMAGES_DIR = "assets/images/maps/lobby"
MAP_MINIMAP_IMAGES_DIR = "assets/images/maps/minimap"
AMMO_ICONS_DIR = "assets/images/ammo"
COMPONENT_ICONS_DIR = "assets/images/components"
TALENT_ICONS_DIR = "assets/images/talents"
UI_ICONS_DIR = "assets/images/icons"
ICON_SIZE = 128
THUMBNAIL_SIZE = 256
P4_BINARY = "p4"
SNAPCTL_BINARY = os.environ.get("SNAPCTL_BINARY", "snapctl")
PLAYTEST_DEPLOYMENT_CONFIG_DEPOT_PATH = "//Tyr/configuration/config/deployments/playtest.yaml"

SNAPSER_SNAPEND_ID = os.environ.get("SNAPSER_SNAPEND_ID")
SNAPSER_API_KEY = os.environ.get("SNAPSER_API_KEY")

DATA_EXPORTS = [
  {
    "out": "VehicleUIData.json",
    "source": f"{BASE_REGISTRY_PATH}/DR_VehicleUIDataRegistry",
    "kind": "registry",
  },
  {
    "out": "TankData.json",
    "source": f"{BASE_REGISTRY_PATH}/DR_TankDataRegistry",
    "kind": "registry",
  },
  {
    "out": "ComponentData.json",
    "source": f"{BASE_DT_PATH}/DT_ComponentData",
    "kind": "table",
  },
  {
    "out": "ComponentCategoryData.json",
    "source": f"{BASE_DT_PATH}/DT_ComponentCategoryUIData",
    "kind": "table",
  },
  {
    "out": "AmmunitionData.json",
    "source": f"{BASE_REGISTRY_PATH}/DR_AmmunitionUIDataRegistry",
    "kind": "registry",
  },
  {
    "out": "TalentTreeData.json",
    "source": f"{BASE_REGISTRY_PATH}/DR_TalentTreesDataRegistry",
    "kind": "registry",
  },
  {
    "out": "MapInfoData.json",
    "source": f"{BASE_REGISTRY_PATH}/DR_MapInfoRegistry",
    "kind": "registry",
  },
]

TALENT_TREE_TABLE_PATTERN = re.compile(r"DT_(\w+_TechTree)$")
DEPLOYMENT_INCLUDE_PATTERN = re.compile(
  r"^\s*-\s*!include\s+(maps|vehicles)/([A-Za-z0-9_-]+)\.yaml(?:\s+#.*)?\s*$"
)
ALPHA_PROGRAM_ICON_PATH = "/Game/UI/_Shared/Textures/Icon_General/T_UI_Icon_Alpha.T_UI_Icon_Alpha"

GAMEPLAY_EFFECT_EXPORT_CHUNK = 30


# ---------------------------------------------------------------------------
# CLI wrappers
# ---------------------------------------------------------------------------

def run_cli(cli_path, args, dry_run=False):
  cmd = [cli_path] + args
  if dry_run:
    print("DRY RUN:", " ".join(cmd))
    return {}
  result = subprocess.run(cmd, capture_output=True, text=True)
  if result.returncode != 0:
    raise RuntimeError(result.stderr.strip() or "tyr-unreal-cli failed")
  stdout = (result.stdout or "").strip()
  if not stdout:
    return {}
  return parse_json_output(stdout)


def run_cli_with_status(cli_path, args, dry_run=False):
  cmd = [cli_path] + args
  if dry_run:
    print("DRY RUN:", " ".join(cmd))
    return True, {}
  result = subprocess.run(cmd, capture_output=True, text=True)
  stdout = (result.stdout or "").strip()
  payload = {}
  if stdout:
    payload = parse_json_output(stdout)
  if result.returncode != 0:
    return False, payload
  return True, payload


def run_cli_capture(cli_path, args, dry_run=False):
  cmd = [cli_path] + args
  if dry_run:
    print("DRY RUN:", " ".join(cmd))
    return True, {}, "", ""
  result = subprocess.run(cmd, capture_output=True, text=True)
  stdout = (result.stdout or "").strip()
  stderr = (result.stderr or "").strip()
  payload = {}
  if stdout:
    payload = parse_json_output(stdout)
  ok = result.returncode == 0
  return ok, payload, stdout, stderr


# ---------------------------------------------------------------------------
# JSON / path helpers
# ---------------------------------------------------------------------------

def parse_json_output(text):
  if not text:
    return {}
  try:
    return json.loads(text)
  except json.JSONDecodeError:
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
      return json.loads(text[start : end + 1])
    return {}


def looks_like_file_path(value):
  if not isinstance(value, str):
    return False
  if re.match(r"^[A-Za-z]:\\", value):
    return True
  if value.startswith("/"):
    return True
  if value.endswith(".json") or value.endswith(".txt"):
    return True
  return False


def collect_file_paths(payload):
  paths = []
  if isinstance(payload, dict):
    for value in payload.values():
      paths.extend(collect_file_paths(value))
  elif isinstance(payload, list):
    for value in payload:
      paths.extend(collect_file_paths(value))
  elif looks_like_file_path(payload):
    paths.append(payload)
  return paths


def pick_existing_file(paths, ext):
  for path in paths:
    if not path.lower().endswith(ext.lower()):
      continue
    if os.path.exists(path):
      return path
  return None


def ensure_parent(path):
  Path(path).parent.mkdir(parents=True, exist_ok=True)


def load_json(path):
  data = Path(path).read_bytes()
  if data.startswith(b"\xff\xfe"):
    text = data.decode("utf-16-le")
  elif data.startswith(b"\xfe\xff"):
    text = data.decode("utf-16-be")
  elif data.startswith(b"\xef\xbb\xbf"):
    text = data.decode("utf-8-sig")
  else:
    text = data.decode("utf-8")
  text = text.lstrip("\ufeff")
  return json.loads(text)


def save_json(path, payload):
  with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")


def load_json_if_exists(path, default):
  path = Path(path)
  if not path.exists():
    return default
  return load_json(path)


def resolve_executable(command, label):
  if not command:
    raise ValueError(f"{label} is required.")
  if any(sep in command for sep in ("\\", "/")):
    if os.path.exists(command):
      return command
    raise FileNotFoundError(f"{label} not found at: {command}")
  resolved = shutil.which(command)
  if resolved:
    return resolved
  raise FileNotFoundError(f"{label} not found on PATH: {command}")


def resolve_output_path(output_root, explicit_path, relative_path, label, required=True):
  if explicit_path:
    return Path(explicit_path)
  if output_root:
    return Path(output_root) / relative_path
  if required:
    raise ValueError(f"{label} requires --output-root or an explicit override path.")
  return None


def load_vehicle_rows(vehicle_ui_path, required=False):
  path = Path(vehicle_ui_path)
  if not path.exists():
    if required:
      raise RuntimeError(f"Missing VehicleUIData export: {path}")
    return []
  rows = load_json(path)
  if not isinstance(rows, list):
    raise RuntimeError(f"VehicleUIData export is not a JSON array: {path}")
  return rows


def load_vehicle_keys(vehicle_ui_path, required=False):
  return {
    item.get("Name")
    for item in load_vehicle_rows(vehicle_ui_path, required=required)
    if item.get("Name")
  }


def load_vehicle_ids(vehicle_ui_path, required=False):
  ids = set()
  for item in load_vehicle_rows(vehicle_ui_path, required=required):
    vehicle_id = get_vehicle_id(item.get("Name"))
    if vehicle_id:
      ids.add(vehicle_id)
  return ids


def get_talent_vehicle_id(name):
  parts = (name or "").split(".")
  if len(parts) < 3:
    return ""
  return parts[2].lower()


def is_allowed_talent(item, allowed_vehicle_ids):
  if not allowed_vehicle_ids:
    return True
  return get_talent_vehicle_id(item.get("Name")) in allowed_vehicle_ids


def get_talent_tree_vehicle_id(file_name):
  stem = Path(file_name).stem
  return re.sub(r"_techtree$", "", stem, flags=re.IGNORECASE).lower()


def parse_playtest_allowlists(config_text):
  allowed_vehicle_ids = set()
  allowed_map_ids = set()

  for line in config_text.splitlines():
    if line.lstrip().startswith("#"):
      continue
    match = DEPLOYMENT_INCLUDE_PATTERN.match(line)
    if not match:
      continue
    section, value = match.groups()
    token = normalize_token(value)
    if not token:
      continue
    if section == "vehicles":
      allowed_vehicle_ids.add(token)
    elif section == "maps":
      allowed_map_ids.add(token)

  if not allowed_vehicle_ids:
    raise RuntimeError("No vehicle includes found in playtest deployment config.")
  if not allowed_map_ids:
    raise RuntimeError("No map includes found in playtest deployment config.")

  return {
    "vehicle_ids": allowed_vehicle_ids,
    "map_ids": allowed_map_ids,
  }


def load_playtest_allowlists(p4_binary, depot_path):
  result = subprocess.run(
    [p4_binary, "print", "-q", depot_path],
    capture_output=True,
    text=True,
  )
  if result.returncode != 0:
    message = (result.stderr or result.stdout or "").strip()
    raise RuntimeError(
      f"Failed to read playtest deployment config from {depot_path}: {message or 'p4 print failed'}"
    )
  return parse_playtest_allowlists(result.stdout or "")


def get_map_match_tokens(item):
  tokens = set()
  raw_name = item.get("Name") or ""
  display_name = item.get("DisplayName") or ""

  if raw_name:
    tokens.add(normalize_token(raw_name))
    if raw_name.lower().startswith("map_"):
      tokens.add(normalize_token(raw_name[4:]))
    if raw_name.lower().startswith("testmap_"):
      tokens.add(normalize_token(raw_name[8:]))

  if display_name:
    tokens.add(normalize_token(display_name))
    cleaned_display = re.sub(r"^(?:prototype|testmap):\s*", "", display_name, flags=re.IGNORECASE).strip()
    if cleaned_display:
      tokens.add(normalize_token(cleaned_display))
    map_id = get_map_id(display_name)
    if map_id:
      tokens.add(normalize_token(map_id))

  return {token for token in tokens if token}


def apply_playtest_allowlists(tmp_dir, allowed_vehicle_ids, allowed_map_ids):
  tmp_path = Path(tmp_dir)
  filter_specs = [
    ("VehicleUIData.json", lambda item: get_vehicle_id(item.get("Name")) in allowed_vehicle_ids),
    ("TankData.json", lambda item: get_vehicle_id(item.get("Name")) in allowed_vehicle_ids),
    ("TalentTreeData.json", lambda item: is_allowed_talent(item, allowed_vehicle_ids)),
    ("MapInfoData.json", lambda item: bool(get_map_match_tokens(item) & allowed_map_ids)),
  ]

  for filename, predicate in filter_specs:
    path = tmp_path / filename
    if not path.exists():
      continue
    rows = load_json(path)
    if not isinstance(rows, list):
      continue
    save_json(path, [item for item in rows if predicate(item)])


def remove_stale_files(directory, allowed_filenames, patterns, dry_run=False, verbose=False):
  dir_path = Path(directory)
  if not dir_path.exists():
    return

  allowed = set(allowed_filenames)
  seen = set()
  for pattern in patterns:
    for file_path in dir_path.glob(pattern):
      if not file_path.is_file():
        continue
      if file_path in seen or file_path.name in allowed:
        continue
      seen.add(file_path)
      if dry_run:
        print(f"DRY RUN: remove stale {file_path}")
      else:
        file_path.unlink(missing_ok=True)
      if verbose:
        print(f"  Removed stale {file_path.name}")


# ---------------------------------------------------------------------------
# Registry normalization
# ---------------------------------------------------------------------------

def convert_registry_key(key):
  if not key:
    return key
  if key.startswith("b") and len(key) > 1 and key[1].isupper():
    return key
  return key[0].upper() + key[1:]


def convert_registry_value(value):
  if isinstance(value, dict):
    return convert_registry_dict(value)
  if isinstance(value, list):
    return [convert_registry_value(item) for item in value]
  return value


def convert_registry_dict(data):
  converted = {}
  for key, value in data.items():
    new_key = convert_registry_key(key)
    converted[new_key] = convert_registry_value(value)
  return converted


def normalize_registry_export(path):
  payload = load_json(path)
  if not isinstance(payload, dict):
    return
  items = payload.get("items")
  if not isinstance(items, list):
    return
  entries = []
  for item in items:
    if not isinstance(item, dict):
      continue
    item_id = item.get("id", "")
    name = item_id.split(":", 1)[1] if ":" in item_id else item_id
    data = item.get("data", {})
    if not isinstance(data, dict):
      data = {}
    converted = convert_registry_dict(data)
    entry = {"Name": name}
    if "Name" in converted:
      converted.setdefault("DisplayName", converted["Name"])
      converted.pop("Name", None)
    entry.update(converted)
    entries.append(entry)
  save_json(path, entries)


# ---------------------------------------------------------------------------
# Asset resolution
# ---------------------------------------------------------------------------

def extract_asset_paths(payload):
  paths = []
  if isinstance(payload, dict):
    for key in ("assets", "results", "items"):
      items = payload.get(key)
      if isinstance(items, list):
        for item in items:
          if isinstance(item, dict):
            path = (
              item.get("path")
              or item.get("asset_path")
              or item.get("object_path")
              or item.get("package_path")
            )
            if path:
              paths.append(path)
  return paths


def normalize_token(value):
  return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def asset_name_from_path(path):
  if not path:
    return ""
  tail = path.split("/")[-1]
  if "." in tail:
    parts = tail.split(".")
    tail = parts[-1] or parts[0]
  return tail


def pick_best_asset(paths, name_hint):
  hint_norm = normalize_token(name_hint)
  best_score = -1
  best_path = None
  for path in paths:
    asset_name = asset_name_from_path(path)
    asset_norm = normalize_token(asset_name)
    score = 0
    if asset_norm == hint_norm:
      score = 100
    elif asset_norm.endswith(hint_norm):
      score = 80
    elif hint_norm and hint_norm in asset_norm:
      score = 60
    elif hint_norm and hint_norm in normalize_token(path):
      score = 40
    if score > best_score:
      best_score = score
      best_path = path
  return best_path


def write_debug_log(filename, payload):
  out_dir = Path("scripts/_export_logs")
  out_dir.mkdir(parents=True, exist_ok=True)
  out_path = out_dir / filename
  with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")


def build_datatable_index(content_dir):
  if not content_dir:
    return []
  root = Path(content_dir)
  if not root.exists():
    return []
  paths = []
  for file_path in root.rglob("DT_*.uasset"):
    try:
      rel = file_path.relative_to(root)
    except ValueError:
      continue
    rel_no_ext = rel.with_suffix("")
    unreal_path = "/Game/" + "/".join(rel_no_ext.parts)
    paths.append(unreal_path)
  return paths


_DATATABLE_INDEX_CACHE = None
_DATAREGISTRY_INDEX_CACHE = None


def resolve_data_table_path_from_disk(name_hint, content_dir):
  global _DATATABLE_INDEX_CACHE
  if _DATATABLE_INDEX_CACHE is None:
    _DATATABLE_INDEX_CACHE = build_datatable_index(content_dir)
  if not _DATATABLE_INDEX_CACHE:
    return None
  return pick_best_asset(_DATATABLE_INDEX_CACHE, name_hint)


def build_dataregistry_index(content_dir):
  if not content_dir:
    return []
  root = Path(content_dir)
  if not root.exists():
    return []
  paths = []
  for file_path in root.rglob("DR_*.uasset"):
    try:
      rel = file_path.relative_to(root)
    except ValueError:
      continue
    rel_no_ext = rel.with_suffix("")
    unreal_path = "/Game/" + "/".join(rel_no_ext.parts)
    paths.append(unreal_path)
  return paths


def resolve_registry_path_from_disk(name_hint, content_dir):
  global _DATAREGISTRY_INDEX_CACHE
  if _DATAREGISTRY_INDEX_CACHE is None:
    _DATAREGISTRY_INDEX_CACHE = build_dataregistry_index(content_dir)
  if not _DATAREGISTRY_INDEX_CACHE:
    return None
  return pick_best_asset(_DATAREGISTRY_INDEX_CACHE, name_hint)


def resolve_data_table_path(cli_path, name_hint, dry_run=False):
  if dry_run:
    print(f"DRY RUN: find DataTable matching {name_hint}")
    return None
  search_terms = [name_hint, f"DT_{name_hint}"]
  class_filters = ["DataTable", "/Script/Engine.DataTable", ""]
  best_paths = []
  raw_logs = []
  for term in search_terms:
    for class_filter in class_filters:
      args = ["find_assets", "--name_contains", term, "--path_filter", BASE_DT_PATH, "--limit", "200"]
      if class_filter:
        args.extend(["--class", class_filter])
      ok, payload, stdout, stderr = run_cli_capture(cli_path, args, dry_run=dry_run)
      raw_logs.append(
        {
          "term": term,
          "class_filter": class_filter or None,
          "ok": ok,
          "stdout": stdout,
          "stderr": stderr,
        }
      )
      if not ok:
        continue
      paths = extract_asset_paths(payload)
      if paths:
        best_paths.extend(paths)
        if len(paths) == 1:
          return paths[0]

  if best_paths:
    best = pick_best_asset(best_paths, name_hint)
    if best:
      return best

  write_debug_log("datatable_find_assets.json", {"name_hint": name_hint, "attempts": raw_logs})
  return None


# ---------------------------------------------------------------------------
# Export functions
# ---------------------------------------------------------------------------

def export_data_table(cli_path, dt_path, out_path, content_dir=None, dry_run=False, verbose=False):
  if not dt_path:
    if verbose:
      print(f"Skip DataTable export for {out_path}: no DataTable path configured.")
    return None
  base_name = Path(out_path).stem
  tried = []
  candidates = [dt_path]
  fallback_names = [
    f"{BASE_DT_PATH}/{base_name}",
    f"{BASE_DT_PATH}/DT_{base_name}",
    f"{BASE_DT_PATH}/{base_name.replace('Data', '')}",
    f"{BASE_DT_PATH}/DT_{base_name.replace('Data', '')}",
  ]
  for name in fallback_names:
    if name not in candidates:
      candidates.append(name)

  for candidate in candidates:
    tried.append(candidate)
    ok, result = run_cli_with_status(
      cli_path, ["export_data_table_json", "--path", candidate], dry_run=dry_run
    )
    if not ok:
      continue
    if dry_run:
      return None
    export_paths = collect_file_paths(result)
    export_file = pick_existing_file(export_paths, ".json")
    if not export_file:
      continue
    ensure_parent(out_path)
    shutil.copyfile(export_file, out_path)
    return export_file

  resolved = resolve_data_table_path(cli_path, base_name, dry_run=dry_run)
  if resolved:
    ok, result = run_cli_with_status(
      cli_path, ["export_data_table_json", "--path", resolved], dry_run=dry_run
    )
    if ok:
      if dry_run:
        return None
      export_paths = collect_file_paths(result)
      export_file = pick_existing_file(export_paths, ".json")
      if export_file:
        ensure_parent(out_path)
        shutil.copyfile(export_file, out_path)
        if verbose:
          print(f"Resolved {base_name} -> {resolved}")
        return export_file

  resolved = resolve_data_table_path_from_disk(base_name, content_dir)
  if resolved:
    ok, result = run_cli_with_status(
      cli_path, ["export_data_table_json", "--path", resolved], dry_run=dry_run
    )
    if ok:
      if dry_run:
        return None
      export_paths = collect_file_paths(result)
      export_file = pick_existing_file(export_paths, ".json")
      if export_file:
        ensure_parent(out_path)
        shutil.copyfile(export_file, out_path)
        if verbose:
          print(f"Resolved {base_name} -> {resolved}")
        return export_file

  raise RuntimeError(
    "Failed to export DataTable. Tried: " + ", ".join(tried)
  )


def export_data_registry(cli_path, registry_path, out_path, content_dir=None, dry_run=False, verbose=False):
  if not registry_path:
    if verbose:
      print(f"Skip DataRegistry export for {out_path}: no DataRegistry path configured.")
    return None

  candidates = [registry_path]
  tried = []
  for candidate in candidates:
    tried.append(candidate)
    ok, result = run_cli_with_status(
      cli_path, ["export_data_registry_json", "--path", candidate], dry_run=dry_run
    )
    if not ok:
      continue
    if dry_run:
      return None
    export_paths = collect_file_paths(result)
    export_file = pick_existing_file(export_paths, ".json")
    if not export_file:
      continue
    ensure_parent(out_path)
    shutil.copyfile(export_file, out_path)
    if verbose:
      print(f"Resolved registry {out_path} -> {candidate}")
    return export_file

  resolved = resolve_registry_path_from_disk(Path(out_path).stem, content_dir)
  if resolved:
    ok, result = run_cli_with_status(
      cli_path, ["export_data_registry_json", "--path", resolved], dry_run=dry_run
    )
    if ok:
      if dry_run:
        return None
      export_paths = collect_file_paths(result)
      export_file = pick_existing_file(export_paths, ".json")
      if export_file:
        ensure_parent(out_path)
        shutil.copyfile(export_file, out_path)
        if verbose:
          print(f"Resolved registry {out_path} -> {resolved}")
        return export_file

  raise RuntimeError("Failed to export DataRegistry. Tried: " + ", ".join(tried))


def discover_talent_tree_tables(cli_path, content_dir=None, dry_run=False):
  """Find all DT_*_TechTree DataTables dynamically via CLI or disk."""
  tables = []

  # Try CLI discovery first
  ok, payload, stdout, stderr = run_cli_capture(
    cli_path,
    ["find_assets", "--name_contains", "TechTree", "--path_filter", BASE_DT_PATH, "--limit", "200"],
    dry_run=dry_run,
  )
  if ok:
    for asset_path in extract_asset_paths(payload):
      name = asset_name_from_path(asset_path)
      match = TALENT_TREE_TABLE_PATTERN.match(name)
      if match:
        filename = f"{match.group(1)}.json"
        tables.append((filename, asset_path))

  # Fall back to disk discovery if CLI found nothing
  if not tables and content_dir:
    root = Path(content_dir)
    if root.exists():
      for file_path in sorted(root.rglob("DT_*_TechTree.uasset")):
        try:
          rel = file_path.relative_to(root)
        except ValueError:
          continue
        rel_no_ext = rel.with_suffix("")
        unreal_path = "/Game/" + "/".join(rel_no_ext.parts)
        name = file_path.stem
        match = TALENT_TREE_TABLE_PATTERN.match(name)
        if match:
          filename = f"{match.group(1)}.json"
          tables.append((filename, unreal_path))

  return sorted(tables, key=lambda t: t[0])


def export_talent_trees(
  cli_path,
  source_dir,
  raw_out_dir,
  content_dir=None,
  allowed_vehicle_ids=None,
  dry_run=False,
  verbose=False,
):
  out_dir = Path(raw_out_dir) / "TalentTrees"
  out_dir.mkdir(parents=True, exist_ok=True)
  filenames = []
  source_dir = Path(source_dir) if source_dir else None
  if source_dir and source_dir.exists() and source_dir.is_dir():
    for file_path in sorted(source_dir.glob("*.json")):
      filename = file_path.name
      if filename.lower() == "index.json":
        continue
      vehicle_id = get_talent_tree_vehicle_id(filename)
      if allowed_vehicle_ids and vehicle_id not in allowed_vehicle_ids:
        if verbose:
          print(f"  Skip internal talent tree {filename}")
        continue
      if dry_run:
        print(f"DRY RUN: copy {file_path} -> {out_dir / filename}")
      else:
        target_path = out_dir / filename
        if file_path.resolve() != target_path.resolve():
          shutil.copyfile(file_path, target_path)
      filenames.append(filename)
  else:
    tables = discover_talent_tree_tables(cli_path, content_dir=content_dir, dry_run=dry_run)
    if not tables:
      raise RuntimeError(
        "No talent tree DataTables found via CLI or disk discovery. "
        "Provide --talent-tree-dir or --content-dir in environments where they are not auto-discoverable."
      )
    for filename, dt_path in tables:
      vehicle_id = get_talent_tree_vehicle_id(filename)
      if allowed_vehicle_ids and vehicle_id not in allowed_vehicle_ids:
        if verbose:
          print(f"  Skip internal talent tree {filename}")
        continue
      out_path = out_dir / filename
      export_data_table(cli_path, dt_path, str(out_path), dry_run=dry_run)
      filenames.append(filename)
      if verbose:
        print(f"Discovered talent tree: {filename} -> {dt_path}")
  remove_stale_files(out_dir, set(filenames) | {"index.json"}, ["*.json"], dry_run=dry_run, verbose=verbose)
  if dry_run:
    return
  save_json(out_dir / "index.json", filenames)


def get_vehicle_id(name):
  """Extract vehicle id from tag like 'Gameplay.Vehicle.Brawler' -> 'brawler'."""
  return (name or "").split(".")[-1].lower()


def material_path_to_texture_path(material_path):
  """Convert a CharMaterialImage path (MI_UI_*) to the corresponding texture path (T_UI_*).

  Material instances render with opaque backgrounds; the underlying texture assets
  export cleanly with transparent backgrounds via get_asset_thumbnail.

  Example:
    /TyrVehicleDrone/UI/MI_UI_Drone_Skin_Base_Thumb_Grid.MI_UI_Drone_Skin_Base_Thumb_Grid
    -> /TyrVehicleDrone/UI/T_UI_Drone_Skin_Base_Thumb
  """
  if not material_path:
    return None
  # Strip the .AssetName suffix if present
  base = material_path.split(".")[0]
  # Split into package path and asset name
  parts = base.rsplit("/", 1)
  if len(parts) != 2:
    return None
  pkg, asset_name = parts
  # MI_UI_Drone_Skin_Base_Thumb_Grid -> T_UI_Drone_Skin_Base_Thumb
  if not asset_name.startswith("MI_UI_"):
    return None
  texture_name = "T_UI_" + asset_name[len("MI_UI_"):]
  # Remove _Grid suffix if present
  if texture_name.endswith("_Grid"):
    texture_name = texture_name[:-len("_Grid")]
  return f"{pkg}/{texture_name}.{texture_name}"


def export_vehicle_thumbnails(cli_path, tmp_dir, images_dir, size=THUMBNAIL_SIZE, dry_run=False, verbose=False):
  """Export vehicle thumbnail PNGs with transparent backgrounds from texture assets."""
  vehicle_ui_path = Path(tmp_dir) / "VehicleUIData.json"
  if not vehicle_ui_path.exists():
    if verbose:
      print("Skip vehicle thumbnails: VehicleUIData.json not found in temp dir.")
    return

  vehicles = load_json(vehicle_ui_path)
  out_dir = Path(images_dir)
  out_dir.mkdir(parents=True, exist_ok=True)

  # Collect texture paths mapped to vehicle id (derived from CharMaterialImage)
  to_export = {}
  for vehicle in vehicles:
    char_icon = vehicle.get("CharMaterialImage")
    if not char_icon or char_icon == "None":
      continue
    vehicle_id = get_vehicle_id(vehicle.get("Name"))
    if not vehicle_id or vehicle_id in ("basetank", "spectatortank"):
      continue
    texture_path = material_path_to_texture_path(char_icon)
    if texture_path:
      to_export[vehicle_id] = texture_path
    else:
      print(f"  Warning: could not derive texture path for {vehicle_id} from {char_icon}")

  remove_stale_files(
    out_dir,
    {f"{vehicle_id}.png" for vehicle_id in to_export},
    ["*.png"],
    dry_run=dry_run,
    verbose=verbose,
  )

  if not to_export:
    if verbose:
      print("No vehicle texture paths found.")
    return

  if dry_run:
    print(f"DRY RUN: would export {len(to_export)} vehicle thumbnails to {out_dir}")
    for vid, tex_path in sorted(to_export.items()):
      print(f"  {vid}.png <- {tex_path}")
    return

  # Export individually with transparent backgrounds and correct filenames
  count = 0
  for vehicle_id, tex_path in sorted(to_export.items()):
    out_path = out_dir / f"{vehicle_id}.png"
    ok, _ = run_cli_with_status(
      cli_path,
      [
        "get_asset_thumbnail",
        "--path", tex_path,
        "--size", str(size),
        "--background_mode", "transparent",
        "--output_path", str(out_path.resolve()),
      ],
    )
    if ok:
      count += 1
      if verbose:
        print(f"  Exported {vehicle_id}.png (transparent)")
    else:
      print(f"  Warning: failed to export thumbnail for {vehicle_id} ({tex_path})")

  print(f"Exported {count} vehicle thumbnails to {out_dir}")


def get_map_id(display_name):
  """Derive a clean map slug from the display name."""
  name = re.sub(r"^(?:prototype|testmap):\s*", "", display_name, flags=re.IGNORECASE).strip()
  return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def export_map_textures(cli_path, tmp_dir, lobby_dir, minimap_dir,
                        dry_run=False, verbose=False):
  """Export map lobby and minimap texture PNGs at native resolution."""
  map_data_path = Path(tmp_dir) / "MapInfoData.json"
  if not map_data_path.exists():
    if verbose:
      print("Skip map textures: MapInfoData.json not found in temp dir.")
    return

  maps = load_json(map_data_path)
  lobby_out = Path(lobby_dir)
  minimap_out = Path(minimap_dir)
  lobby_out.mkdir(parents=True, exist_ok=True)
  minimap_out.mkdir(parents=True, exist_ok=True)

  to_export = []
  for entry in maps:
    display = entry.get("DisplayName", "")
    map_id = get_map_id(display)
    if not map_id:
      continue
    lobby = entry.get("LobbyTexture")
    minimap = entry.get("MinimapTexture")
    to_export.append((map_id, lobby, minimap))

  remove_stale_files(
    lobby_out,
    {f"{map_id}.png" for map_id, lobby_tex, _ in to_export if lobby_tex and lobby_tex != "None"},
    ["*.png"],
    dry_run=dry_run,
    verbose=verbose,
  )
  remove_stale_files(
    minimap_out,
    {f"{map_id}.png" for map_id, _, minimap_tex in to_export if minimap_tex and minimap_tex != "None"},
    ["*.png"],
    dry_run=dry_run,
    verbose=verbose,
  )

  if dry_run:
    print(f"DRY RUN: would export {len(to_export)} map texture sets")
    return

  count = 0
  for map_id, lobby_tex, minimap_tex in to_export:
    if lobby_tex and lobby_tex != "None":
      out_path = lobby_out / f"{map_id}.png"
      ok, _ = run_cli_with_status(cli_path, [
        "export_texture_asset", "--path", lobby_tex,
        "--format", "png", "--output_path", str(out_path.resolve()),
      ])
      if ok:
        count += 1
      elif verbose:
        print(f"  Warning: failed lobby texture export for {map_id}")

    if minimap_tex and minimap_tex != "None":
      out_path = minimap_out / f"{map_id}.png"
      ok, _ = run_cli_with_status(cli_path, [
        "export_texture_asset", "--path", minimap_tex,
        "--format", "png", "--output_path", str(out_path.resolve()),
      ])
      if ok:
        count += 1
      elif verbose:
        print(f"  Warning: failed minimap texture export for {map_id}")

  print(f"Exported {count} map textures to {lobby_out} and {minimap_out}")


def export_item_icons(cli_path, tmp_dir, ammo_dir, component_dir, talent_dir, ui_icons_dir,
                      size=ICON_SIZE, dry_run=False, verbose=False):
  """Export ammo, component, and talent icon PNGs from Unreal texture assets."""
  for out_dir in (ammo_dir, component_dir, talent_dir, ui_icons_dir):
    Path(out_dir).mkdir(parents=True, exist_ok=True)

  to_export = []  # list of (category, id, texture_path, out_path)
  allowed_vehicle_ids = load_vehicle_ids(Path(tmp_dir) / "VehicleUIData.json", required=True)

  # Ammo icons
  ammo_path = Path(tmp_dir) / "AmmunitionData.json"
  if ammo_path.exists():
    for entry in load_json(ammo_path):
      icon = entry.get("AmmunitionIcon")
      if not icon or icon == "None":
        continue
      ammo_id = (entry.get("Name") or "").split(".")[-1].lower()
      if ammo_id:
        to_export.append(("ammo", ammo_id, icon, Path(ammo_dir) / f"{ammo_id}.png"))

  # Component icons
  comp_path = Path(tmp_dir) / "ComponentData.json"
  if comp_path.exists():
    for entry in load_json(comp_path):
      icon = entry.get("ComponentIcon")
      if not icon or icon == "None":
        continue
      comp_id = (entry.get("Name") or "").split(".")[-1].lower()
      if comp_id:
        to_export.append(("component", comp_id, icon, Path(component_dir) / f"{comp_id}.png"))

  # Talent icons
  talent_path = Path(tmp_dir) / "TalentTreeData.json"
  if talent_path.exists():
    for entry in load_json(talent_path):
      if not is_allowed_talent(entry, allowed_vehicle_ids):
        continue
      icon = entry.get("TalentIcon")
      if not icon or icon == "None":
        continue
      parts = (entry.get("Name") or "").split(".")
      talent_id = "-".join(parts[-2:]).lower() if len(parts) >= 2 else parts[-1].lower()
      if talent_id:
        to_export.append(("talent", talent_id, icon, Path(talent_dir) / f"{talent_id}.png"))

  to_export.append(("ui", "alpha-program", ALPHA_PROGRAM_ICON_PATH, Path(ui_icons_dir) / "alpha-program.png"))

  remove_stale_files(
    ammo_dir,
    {out_path.name for category, _, _, out_path in to_export if category == "ammo"},
    ["*.png"],
    dry_run=dry_run,
    verbose=verbose,
  )
  remove_stale_files(
    component_dir,
    {out_path.name for category, _, _, out_path in to_export if category == "component"},
    ["*.png"],
    dry_run=dry_run,
    verbose=verbose,
  )
  remove_stale_files(
    talent_dir,
    {out_path.name for category, _, _, out_path in to_export if category == "talent"},
    ["*.png"],
    dry_run=dry_run,
    verbose=verbose,
  )
  remove_stale_files(
    ui_icons_dir,
    {out_path.name for category, _, _, out_path in to_export if category == "ui"},
    ["*.png"],
    dry_run=dry_run,
    verbose=verbose,
  )

  if not to_export:
    if verbose:
      print("No item icons found to export.")
    return

  if dry_run:
    print(f"DRY RUN: would export {len(to_export)} item icons")
    for cat, item_id, tex, _ in sorted(to_export):
      print(f"  [{cat}] {item_id}.png <- {tex}")
    return

  count = 0
  for cat, item_id, tex_path, out_path in to_export:
    ok, _ = run_cli_with_status(
      cli_path,
      [
        "export_texture_asset",
        "--path", tex_path,
        "--format", "png",
        "--output_path", str(out_path.resolve()),
      ],
    )
    if ok:
      count += 1
      if verbose:
        print(f"  [{cat}] Exported {item_id}.png")
    else:
      print(f"  Warning: failed to export {cat} icon for {item_id} ({tex_path})")

  print(f"Exported {count} item icons ({ammo_dir}, {component_dir}, {talent_dir})")


# ---------------------------------------------------------------------------
# Tag / effect normalization
# ---------------------------------------------------------------------------

def normalize_tag_obj(tag_obj):
  if not isinstance(tag_obj, dict):
    return {"TagName": "None"}
  return {"TagName": tag_obj.get("TagName", "None")}


def normalize_tag_list(tags):
  if not isinstance(tags, list):
    return []
  normalized = []
  for tag in tags:
    if isinstance(tag, dict):
      normalized.append({"TagName": tag.get("TagName", "None")})
  return normalized


def extract_tags(text):
  return re.findall(r'TagName="([^"]+)"', text or "")


def extract_tag_requirement(line, label):
  idx = line.find(label)
  if idx == -1:
    return []
  section = line[idx + len(label) :]
  next_markers = [",IgnoreTags=", ",TagQuery="]
  end = len(section)
  for marker in next_markers:
    pos = section.find(marker)
    if pos != -1 and pos < end:
      end = pos
  return extract_tags(section[:end])


def parse_tag_name(text):
  tags = extract_tags(text)
  if tags:
    return tags[0]
  return ""


def normalize_tag_ref(value):
  if isinstance(value, dict):
    return value
  if isinstance(value, str):
    tag = parse_tag_name(value)
    return {"TagName": tag or "None"}
  return {"TagName": "None"}


def parse_effect_pair(value, effect_key):
  if isinstance(value, dict):
    return value
  if not isinstance(value, str):
    return None
  event_tag = parse_tag_name(value)
  match = re.search(rf'{effect_key}="([^"]+)"', value)
  effect_path = match.group(1) if match else ""
  return {
    "EventTag": {"TagName": event_tag or "None"},
    effect_key: effect_path or "None",
  }


def normalize_tag_container(value):
  if isinstance(value, dict):
    return value
  if not isinstance(value, str):
    return None
  tags = extract_tags(value)
  return {"GameplayTags": [{"TagName": tag} for tag in tags]}


def normalize_component_data(path):
  data = load_json(path)
  if not isinstance(data, list):
    return
  for component in data:
    if not isinstance(component, dict):
      continue
    if isinstance(component.get("EventTag"), str):
      component["EventTag"] = normalize_tag_ref(component.get("EventTag"))
    if isinstance(component.get("EventEffectPairs"), list):
      pairs = []
      for entry in component.get("EventEffectPairs") or []:
        parsed = parse_effect_pair(entry, "ComponentGameplayEffect")
        if parsed:
          pairs.append(parsed)
      component["EventEffectPairs"] = pairs
    if isinstance(component.get("Categories"), str):
      normalized = normalize_tag_container(component.get("Categories"))
      if normalized is not None:
        component["Categories"] = normalized
  save_json(path, data)


def normalize_talent_data(path):
  data = load_json(path)
  if not isinstance(data, list):
    return
  for talent in data:
    if not isinstance(talent, dict):
      continue
    if isinstance(talent.get("EventTag"), str):
      talent["EventTag"] = normalize_tag_ref(talent.get("EventTag"))
    if isinstance(talent.get("EventEffectPairs"), list):
      pairs = []
      for entry in talent.get("EventEffectPairs") or []:
        parsed = parse_effect_pair(entry, "TalentGameplayEffect")
        if parsed:
          pairs.append(parsed)
      talent["EventEffectPairs"] = pairs
  save_json(path, data)


# ---------------------------------------------------------------------------
# Effect path collection
# ---------------------------------------------------------------------------

def collect_effect_paths_from_components(components):
  paths = set()
  for component in components:
    main = component.get("ComponentGameplayEffect")
    if main and main != "None":
      paths.add(main)
    for pair in component.get("EventEffectPairs", []) or []:
      if isinstance(pair, dict):
        effect_path = pair.get("ComponentGameplayEffect")
      elif isinstance(pair, str):
        match = re.search(r'ComponentGameplayEffect="([^"]+)"', pair)
        effect_path = match.group(1) if match else ""
      else:
        effect_path = ""
      if effect_path and effect_path != "None":
        paths.add(effect_path)
  return paths


def collect_effect_paths_from_talents(talents):
  paths = set()
  for talent in talents:
    main = talent.get("TalentGameplayEffect")
    if main and main != "None":
      paths.add(main)
    for pair in talent.get("EventEffectPairs", []) or []:
      if isinstance(pair, dict):
        effect_path = pair.get("TalentGameplayEffect")
      elif isinstance(pair, str):
        match = re.search(r'TalentGameplayEffect="([^"]+)"', pair)
        effect_path = match.group(1) if match else ""
      else:
        effect_path = ""
      if effect_path and effect_path != "None":
        paths.add(effect_path)
  return paths


# ---------------------------------------------------------------------------
# Gameplay effect export + parsing
# ---------------------------------------------------------------------------

def parse_effect_export(text, export_file):
  effect = {
    "export_file": export_file,
    "tags": {"gameplay_effect": [], "owned": [], "remove_effects_with_tags": []},
    "tag_requirements": {
      "application": {"require": [], "ignore": [], "tag_query": None},
      "ongoing": {"require": [], "ignore": [], "tag_query": None},
      "removal": {"require": [], "ignore": [], "tag_query": None},
    },
    "modifiers": [],
    "executions": [],
    "gameplay_cues": [],
  }
  modifiers = effect["modifiers"]
  in_modifiers = False
  lines = text.splitlines()
  for line in lines:
    line = line.strip()
    if not line:
      continue
    if line.startswith("=== GAMEPLAY EFFECT:"):
      name = line.replace("=== GAMEPLAY EFFECT:", "").replace("===", "").strip()
      effect["name"] = name
      continue
    if line.startswith("Path:"):
      parts = [part.strip() for part in line.replace("Path:", "").split("|")]
      if parts:
        asset_path = parts[0]
        effect["asset_path"] = asset_path
        if ".Default__" in asset_path:
          prefix, suffix = asset_path.split(".Default__", 1)
          effect["effect_path"] = f"{prefix}.{suffix.replace('Default__', '')}"
        else:
          effect["effect_path"] = asset_path
      for part in parts[1:]:
        if part.startswith("Class:"):
          effect["class"] = part.replace("Class:", "").strip()
        elif part.startswith("Time:"):
          effect["export_time"] = part.replace("Time:", "").strip()
      continue
    if line.startswith("DurationPolicy:"):
      effect["duration_policy"] = line.replace("DurationPolicy:", "").strip()
      continue
    if line.startswith("DurationMagnitude:"):
      effect["duration_magnitude"] = line.replace("DurationMagnitude:", "").strip()
      continue
    if line.startswith("Period:"):
      effect["period"] = line.replace("Period:", "").strip()
      continue
    if line.startswith("ChanceToApplyToTarget:"):
      effect["chance_to_apply"] = line.replace("ChanceToApplyToTarget:", "").strip()
      continue
    if line.startswith("StackingType:"):
      effect["stacking_type"] = line.replace("StackingType:", "").strip()
      continue
    if line.startswith("StackLimitCount:"):
      value = line.replace("StackLimitCount:", "").strip()
      effect["stack_limit_count"] = int(value) if value.isdigit() else value
      continue
    if line.startswith("StackDurationRefreshPolicy:"):
      effect["stack_duration_refresh_policy"] = line.replace("StackDurationRefreshPolicy:", "").strip()
      continue
    if line.startswith("StackPeriodResetPolicy:"):
      effect["stack_period_reset_policy"] = line.replace("StackPeriodResetPolicy:", "").strip()
      continue
    if line.startswith("GameplayEffectTags:"):
      effect["tags"]["gameplay_effect"] = extract_tags(line)
      continue
    if line.startswith("OwnedTags:"):
      effect["tags"]["owned"] = extract_tags(line)
      continue
    if line.startswith("RemoveEffectsWithTags:"):
      effect["tags"]["remove_effects_with_tags"] = extract_tags(line)
      continue
    if line.startswith("ApplicationTagRequirements:"):
      effect["tag_requirements"]["application"]["require"] = extract_tag_requirement(
        line, "RequireTags=("
      )
      effect["tag_requirements"]["application"]["ignore"] = extract_tag_requirement(
        line, "IgnoreTags=("
      )
      continue
    if line.startswith("OngoingTagRequirements:"):
      effect["tag_requirements"]["ongoing"]["require"] = extract_tag_requirement(
        line, "RequireTags=("
      )
      effect["tag_requirements"]["ongoing"]["ignore"] = extract_tag_requirement(
        line, "IgnoreTags=("
      )
      continue
    if line.startswith("RemovalTagRequirements:"):
      effect["tag_requirements"]["removal"]["require"] = extract_tag_requirement(
        line, "RequireTags=("
      )
      effect["tag_requirements"]["removal"]["ignore"] = extract_tag_requirement(
        line, "IgnoreTags=("
      )
      continue
    if line.startswith("=== MODIFIERS ==="):
      in_modifiers = True
      continue
    if line.startswith("=== EXECUTIONS ==="):
      in_modifiers = False
      continue
    if line.startswith("=== GAMEPLAY CUES ==="):
      in_modifiers = False
      continue
    if in_modifiers and line.startswith("["):
      match = re.match(r"\[\d+\]\s+Attribute:\s*(.*?)\s+\((.*?)\)\s+\|\s+Op:\s*(.*)", line)
      if match:
        attribute, set_name, op = match.groups()
        modifiers.append(
          {"attribute": attribute.strip(), "set": set_name.strip(), "op": op.strip()}
        )
      continue
    if in_modifiers and line.startswith("Magnitude:") and modifiers:
      magnitude = line.replace("Magnitude:", "").strip()
      modifiers[-1]["magnitude"] = magnitude
      mag_match = re.search(r"MagnitudeCalculationType=([A-Za-z0-9_]+)", magnitude)
      if mag_match:
        modifiers[-1]["magnitude_type"] = mag_match.group(1)
      class_match = re.search(r'CalculationClassMagnitude="([^"]+)"', magnitude)
      if class_match:
        modifiers[-1]["calculation_class"] = class_match.group(1)
      continue
  if "effect_path" not in effect:
    effect["effect_path"] = effect.get("asset_path", "")
  return effect


def export_gameplay_effects_summary(cli_path, tmp_dir, dry_run=False):
  component_path = Path(tmp_dir) / "ComponentData.json"
  talent_path = Path(tmp_dir) / "TalentTreeData.json"
  components = load_json(component_path)
  allowed_vehicle_ids = load_vehicle_ids(Path(tmp_dir) / "VehicleUIData.json", required=True)
  talents = [
    entry for entry in load_json(talent_path)
    if is_allowed_talent(entry, allowed_vehicle_ids)
  ]
  component_effects = collect_effect_paths_from_components(components)
  talent_effects = collect_effect_paths_from_talents(talents)
  effect_paths = sorted(component_effects | talent_effects)

  effects = []
  errors = []
  seen_paths = set()
  if dry_run:
    print(f"DRY RUN: would export {len(effect_paths)} gameplay effects")
    return

  for i in range(0, len(effect_paths), GAMEPLAY_EFFECT_EXPORT_CHUNK):
    chunk = effect_paths[i : i + GAMEPLAY_EFFECT_EXPORT_CHUNK]
    payload = run_cli(
      cli_path, ["export_gameplay_effect_batch", "--paths", ",".join(chunk)]
    )
    export_files = collect_file_paths(payload)
    export_files = [
      path for path in export_files if path.lower().endswith(".txt") and os.path.exists(path)
    ]
    if not export_files:
      errors.append({"batch_start": i, "message": "No export files found in CLI output"})
      continue
    for export_file in export_files:
      try:
        with open(export_file, "r", encoding="utf-8", errors="ignore") as handle:
          parsed = parse_effect_export(handle.read(), export_file)
        effect_path = parsed.get("effect_path")
        if not effect_path or effect_path in seen_paths:
          continue
        seen_paths.add(effect_path)
        effects.append(parsed)
      except Exception as exc:
        errors.append({"export_file": export_file, "message": str(exc)})

  summary = {
    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    "source": {
      "component_data": str(component_path),
      "talent_tree_data": str(talent_path),
      "component_effect_count": len(component_effects),
      "talent_effect_count": len(talent_effects),
      "unique_effect_count": len(effect_paths),
    },
    "errors": errors,
    "effects": effects,
  }
  out_path = Path(tmp_dir) / "GameplayEffectsSummary.json"
  ensure_parent(out_path)
  with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(summary, handle, indent=2)
    handle.write("\n")


# ---------------------------------------------------------------------------
# Minimization (raw -> site-ready)
# ---------------------------------------------------------------------------

def select_fields(item, allowed_fields):
  return {key: item.get(key) for key in allowed_fields if key in item}


def minimize_vehicle_ui(rows):
  trimmed = []
  for item in rows:
    entry = {
      "Name": item.get("Name"),
      "VehicleName": item.get("VehicleName"),
      "VehicleClassTag": normalize_tag_obj(item.get("VehicleClassTag")),
      "bVehicleSelectable_External": item.get("bVehicleSelectable_External"),
      "bVehicleSelectable_Internal": item.get("bVehicleSelectable_Internal"),
    }
    trimmed.append(entry)
  return trimmed


def minimize_tank_data(rows, allowed_vehicle_keys=None):
  trimmed = []
  for item in rows:
    if allowed_vehicle_keys is not None and item.get("Name") not in allowed_vehicle_keys:
      continue
    entry = {"Name": item.get("Name")}
    for key, value in item.items():
      if key == "Name":
        continue
      if key in ("VehicleName", "ProxyVisionRadius", "CamoPercentage", "bIsWorkInProgress"):
        entry[key] = value
        continue
      if isinstance(value, bool):
        continue
      if isinstance(value, (int, float)):
        entry[key] = value
    trimmed.append(entry)
  return trimmed


def minimize_components(rows):
  trimmed = []
  for item in rows:
    entry = {
      "Name": item.get("Name"),
      "ComponentName": item.get("ComponentName"),
      "ComponentDescription": item.get("ComponentDescription"),
      "ComponentIcon": item.get("ComponentIcon", "None"),
      "ComponentPointValues": item.get("ComponentPointValues"),
      "ComponentType": item.get("ComponentType"),
      "ComponentGameplayEffect": item.get("ComponentGameplayEffect"),
      "EventTag": normalize_tag_obj(item.get("EventTag")),
      "EventEffectPairs": [],
      "Categories": {"GameplayTags": []},
    }
    for pair in item.get("EventEffectPairs", []) or []:
      if not isinstance(pair, dict):
        continue
      entry["EventEffectPairs"].append(
        {
          "EventTag": normalize_tag_obj(pair.get("EventTag")),
          "ComponentGameplayEffect": pair.get("ComponentGameplayEffect"),
        }
      )
    categories = item.get("Categories", {}) or {}
    entry["Categories"]["GameplayTags"] = normalize_tag_list(
      categories.get("GameplayTags")
    )
    trimmed.append(entry)
  return trimmed


def minimize_component_categories(rows):
  return [
    {
      "Name": item.get("Name"),
      "CategoryName": item.get("CategoryName"),
    }
    for item in rows
  ]


def minimize_ammunition(rows):
  keep = [
    "Name",
    "Description",
    "AmmunitionIcon",
    "DamageModifier",
    "PenetrationModifier",
    "ReloadModifier",
    "DispersionModifier",
    "DetectionModifier",
    "VelocityModifier",
    "AmmunitionUClass",
    "bCanBeLoadedInSecondary",
    "bIsSelectable",
  ]
  return [select_fields(item, keep) for item in rows]


def minimize_talents(rows, allowed_vehicle_ids=None):
  keep = [
    "Name",
    "TalentName",
    "TalentDescription",
    "TalentSupplementalDescription",
    "TalentIcon",
    "TalentGameplayEffect",
    "TalentPointValues",
    "TalentType",
    "EventTag",
    "EventEffectPairs",
  ]
  trimmed = []
  for item in rows:
    if allowed_vehicle_ids is not None and not is_allowed_talent(item, allowed_vehicle_ids):
      continue
    entry = select_fields(item, keep)
    entry["EventTag"] = normalize_tag_obj(item.get("EventTag"))
    pairs = []
    for pair in item.get("EventEffectPairs", []) or []:
      if not isinstance(pair, dict):
        continue
      pairs.append(
        {
          "EventTag": normalize_tag_obj(pair.get("EventTag")),
          "TalentGameplayEffect": pair.get("TalentGameplayEffect"),
        }
      )
    entry["EventEffectPairs"] = pairs
    trimmed.append(entry)
  return trimmed


def minimize_effects(summary):
  effects = []
  for effect in summary.get("effects", []) or []:
    if not effect.get("effect_path"):
      continue
    mods = []
    for mod in effect.get("modifiers", []) or []:
      attribute = mod.get("attribute")
      if not attribute:
        continue
      mods.append(
        {
          "attribute": attribute,
          "op": mod.get("op"),
          "magnitude": mod.get("magnitude"),
          "magnitude_type": mod.get("magnitude_type"),
        }
      )
    effects.append(
      {
        "effect_path": effect.get("effect_path"),
        "stack_limit_count": effect.get("stack_limit_count"),
        "tags": {
          "gameplay_effect": list(
            dict.fromkeys(effect.get("tags", {}).get("gameplay_effect", []))
          )
        },
        "modifiers": mods,
      }
    )
  return {
    "generated_at_utc": summary.get("generated_at_utc"),
    "effects": effects,
  }


def minimize_map_info(rows):
  keep = ["Name", "DisplayName", "MinimapTexture", "LobbyTexture"]
  return [select_fields(item, keep) for item in rows]


def minimize_native_component_data(rows, allowed_vehicle_keys=None):
  trimmed = []
  for item in rows:
    if allowed_vehicle_keys is not None and item.get("vehicleKey") not in allowed_vehicle_keys:
      continue
    trimmed.append(
      {
        "vehicleKey": item.get("vehicleKey"),
        "nativeComponents": item.get("nativeComponents", []),
      }
    )
  return trimmed


def write_minimized_exports(tmp_dir, raw_out_dir):
  raw_out = Path(raw_out_dir)
  raw_out.mkdir(parents=True, exist_ok=True)
  vehicle_ui_path = Path(tmp_dir) / "VehicleUIData.json"
  allowed_vehicle_keys = load_vehicle_keys(vehicle_ui_path, required=True)
  allowed_vehicle_ids = load_vehicle_ids(vehicle_ui_path, required=True)

  minimize_map = {
    "VehicleUIData.json": lambda rows: minimize_vehicle_ui(rows),
    "TankData.json": lambda rows: minimize_tank_data(rows, allowed_vehicle_keys),
    "ComponentData.json": minimize_components,
    "ComponentCategoryData.json": minimize_component_categories,
    "AmmunitionData.json": minimize_ammunition,
    "TalentTreeData.json": lambda rows: minimize_talents(rows, allowed_vehicle_ids),
    "GameplayEffectsSummary.json": minimize_effects,
    "MapInfoData.json": minimize_map_info,
    "NativeComponentData.json": lambda rows: minimize_native_component_data(rows, allowed_vehicle_keys),
  }
  for filename, minimize_fn in minimize_map.items():
    src_path = os.path.join(tmp_dir, filename)
    if os.path.exists(src_path):
      save_json(raw_out / filename, minimize_fn(load_json(src_path)))


# ---------------------------------------------------------------------------
# Website data generation (raw -> website-consumable)
# ---------------------------------------------------------------------------

def get_last_key_segment(value=""):
  return (value or "").split(".")[-1]


def get_id(value=""):
  return get_last_key_segment(value).lower()


def get_scoped_talent_id(value=""):
  parts = (value or "").split(".")
  return "-".join(parts[-2:]).lower()


def slugify(value=""):
  return re.sub(r"(^-+|-+$)", "", re.sub(r"[^a-z0-9]+", "-", (value or "").lower()))


def title_case(value=""):
  parts = re.split(r"[\s._-]+", (value or "").lower())
  return " ".join(part[:1].upper() + part[1:] for part in parts if part)


def parse_localized_text(value=""):
  if not value:
    return ""
  quoted_strings = re.findall(r'"([^"]+)"', value)
  if not quoted_strings:
    return value
  return quoted_strings[-1]


def clean_text(value=""):
  return re.sub(
    r"\s+",
    " ",
    re.sub(
      r"</?>",
      "",
      re.sub(r"\{[^}]+\}", "value", parse_localized_text(str(value or "")).replace("_", " ")),
    ),
  ).strip()


def get_effect_id(effect_path=""):
  file_name = (effect_path or "").split("/")[-1]
  return slugify(re.sub(r"_C$", "", file_name).replace(".", "-"))


def ensure_clean_output(canonical_root, generated_root):
  canonical_root = Path(canonical_root)
  generated_root = Path(generated_root)
  shutil.rmtree(canonical_root, ignore_errors=True)
  shutil.rmtree(generated_root, ignore_errors=True)

  for directory in [
    canonical_root,
    canonical_root / "vehicles",
    canonical_root / "ammo",
    canonical_root / "components",
    canonical_root / "talents",
    canonical_root / "talent-trees",
    canonical_root / "effects",
    canonical_root / "maps",
    generated_root,
  ]:
    directory.mkdir(parents=True, exist_ok=True)


def write_entity_files(directory, entities):
  directory = Path(directory)
  directory.mkdir(parents=True, exist_ok=True)
  for entity in entities:
    save_json(directory / f"{entity['id']}.json", entity)


def write_asset_manifest(
  generated_root,
  armor_models_dir=None,
  map_lobby_dir=None,
  map_minimap_dir=None,
):
  generated_root = Path(generated_root)
  output_root = generated_root.parent
  armor_models_dir = Path(armor_models_dir) if armor_models_dir else output_root / ARMOR_MODELS_DIR
  map_lobby_dir = Path(map_lobby_dir) if map_lobby_dir else output_root / MAP_LOBBY_IMAGES_DIR
  map_minimap_dir = Path(map_minimap_dir) if map_minimap_dir else output_root / MAP_MINIMAP_IMAGES_DIR

  armor_files = {path.name for path in armor_models_dir.iterdir()} if armor_models_dir.exists() else set()
  vehicle_armor_ids = sorted(
    path.stem
    for path in armor_models_dir.glob("*.glb")
    if not path.name.endswith("-visual.glb")
    and f"{path.stem}-visual.glb" in armor_files
    and f"{path.stem}-armor.json" in armor_files
  ) if armor_models_dir.exists() else []

  map_lobby_ids = {
    path.stem
    for path in map_lobby_dir.glob("*.png")
  } if map_lobby_dir.exists() else set()
  map_minimap_ids = {
    path.stem
    for path in map_minimap_dir.glob("*.png")
  } if map_minimap_dir.exists() else set()
  map_image_ids = sorted(map_lobby_ids & map_minimap_ids)

  save_json(
    generated_root / "asset-manifest.json",
    {
      "generatedAt": datetime.now(timezone.utc).isoformat(),
      "vehicleArmorIds": vehicle_armor_ids,
      "mapImageIds": map_image_ids,
    },
  )

  print(
    f"Generated asset manifest: {len(vehicle_armor_ids)} armor entries, "
    f"{len(map_image_ids)} map image entries"
  )


def is_finite_number(value):
  return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def build_canonical_game_data(
  raw_root,
  canonical_root=CANONICAL_OUT_DIR,
  generated_root=GENERATED_OUT_DIR,
  armor_models_dir=None,
  map_lobby_dir=None,
  map_minimap_dir=None,
):
  raw_root = Path(raw_root)
  canonical_root = Path(canonical_root) if canonical_root not in (None, "") else None
  generated_root = Path(generated_root)

  if canonical_root is None:
    generated_root.mkdir(parents=True, exist_ok=True)
  else:
    ensure_clean_output(canonical_root, generated_root)

  tanks_raw = load_json(raw_root / "TankData.json")
  vehicle_ui_raw = load_json(raw_root / "VehicleUIData.json")
  ammo_raw = load_json(raw_root / "AmmunitionData.json")
  component_raw = load_json(raw_root / "ComponentData.json")
  component_categories_raw = load_json(raw_root / "ComponentCategoryData.json")
  talents_raw = load_json(raw_root / "TalentTreeData.json")
  effects_summary_raw = load_json_if_exists(raw_root / "GameplayEffectsSummary.json", {"effects": []})
  talent_tree_index_raw = load_json(raw_root / "TalentTrees" / "index.json")
  native_component_raw = load_json_if_exists(raw_root / "NativeComponentData.json", [])
  maps_raw = load_json(raw_root / "MapInfoData.json")

  now = datetime.now(timezone.utc).isoformat()
  raw_source = "python-export"

  allowed_vehicle_ui = vehicle_ui_raw
  allowed_vehicle_keys = {item.get("Name") for item in allowed_vehicle_ui if item.get("Name")}
  allowed_vehicle_ids = {get_id(item.get("Name")) for item in allowed_vehicle_ui if item.get("Name")}
  allowed_talent_rows = [
    entry for entry in talents_raw
    if get_talent_vehicle_id(entry.get("Name")) in allowed_vehicle_ids
  ]
  allowed_talent_tree_files = [
    file_name for file_name in talent_tree_index_raw
    if get_talent_tree_vehicle_id(file_name) in allowed_vehicle_ids
  ]
  allowed_native_component_rows = [
    entry for entry in native_component_raw
    if entry.get("vehicleKey") in allowed_vehicle_keys
  ]
  tank_by_key = {item.get("Name"): item for item in tanks_raw if item.get("Name")}

  natives_by_vehicle_key = {}
  natives_by_component_key = {}
  for entry in allowed_native_component_rows:
    vehicle_key = entry.get("vehicleKey")
    natives = [
      {
        "componentId": get_id(native_component.get("componentKey")),
        "level": native_component.get("level"),
      }
      for native_component in (entry.get("nativeComponents") or [])
    ]
    natives_by_vehicle_key[vehicle_key] = natives
    for native_component in entry.get("nativeComponents") or []:
      component_key = native_component.get("componentKey")
      natives_by_component_key.setdefault(component_key, []).append(
        {
          "vehicleId": get_id(vehicle_key),
          "level": native_component.get("level"),
        }
      )

  component_effect_paths = {
    pair.get("ComponentGameplayEffect")
    for entry in component_raw
    for pair in (entry.get("EventEffectPairs") or [])
    if pair.get("ComponentGameplayEffect") not in (None, "", "None")
  }
  talent_effect_paths = {
    pair.get("TalentGameplayEffect")
    for entry in allowed_talent_rows
    for pair in (entry.get("EventEffectPairs") or [])
    if pair.get("TalentGameplayEffect") not in (None, "", "None")
  }
  allowed_effect_paths = component_effect_paths | talent_effect_paths

  category_by_key = {}
  for item in component_categories_raw:
    key = item.get("Name")
    if not key:
      continue
    label_source = clean_text(item.get("CategoryName")) or get_last_key_segment(item.get("Name"))
    category_by_key[key] = {
      "id": slugify(label_source),
      "label": title_case(label_source),
    }

  effects = []
  for effect in effects_summary_raw.get("effects", []) or []:
    effect_path = effect.get("effect_path")
    if effect_path not in allowed_effect_paths:
      continue
    effects.append(
      {
        "id": get_effect_id(effect_path),
        "path": effect_path,
        "stackLimit": int(effect.get("stack_limit_count") or 1),
        "tags": [
          *[tag for tag in (effect.get("tags", {}) or {}).get("gameplay_effect", []) if tag],
          *[tag for tag in (effect.get("tags", {}) or {}).get("asset_tags", []) if tag],
        ],
        "modifiers": [
          {
            "attribute": modifier.get("attribute", ""),
            "op": modifier.get("op", ""),
            "magnitude": modifier.get("magnitude", ""),
            "magnitudeType": modifier.get("magnitude_type", ""),
          }
          for modifier in (effect.get("modifiers") or [])
        ],
      }
    )
  effects.sort(key=lambda item: item["id"])
  effect_ids_by_path = {effect["path"]: effect["id"] for effect in effects}

  ammo = []
  for entry in ammo_raw:
    ammo_id = get_id(entry.get("Name"))
    name = title_case(get_last_key_segment(entry.get("Name")))
    ammo.append(
      {
        "id": ammo_id,
        "key": entry.get("Name"),
        "slug": slugify(name),
        "name": name,
        "description": clean_text(entry.get("Description")) if entry.get("Description") not in (None, "", "TODO") else f"{name} ammunition.",
        "icon": entry.get("AmmunitionIcon", ""),
        "selectable": True if ammo_id == "standard" else bool(entry.get("bIsSelectable")),
        "canLoadSecondary": bool(entry.get("bCanBeLoadedInSecondary")),
        "modifiers": {
          "damage": float(entry.get("DamageModifier", 1)),
          "penetration": float(entry.get("PenetrationModifier", 1)),
          "reload": float(entry.get("ReloadModifier", 1)),
          "dispersion": float(entry.get("DispersionModifier", 1)),
          "detection": float(entry.get("DetectionModifier", 1)),
          "velocity": float(entry.get("VelocityModifier", 1)),
        },
        "source": {
          "key": entry.get("Name"),
        },
      }
    )
  ammo.sort(key=lambda item: item["name"])

  components = []
  for entry in component_raw:
    category_tag = (((entry.get("Categories") or {}).get("GameplayTags") or [{}])[0] or {}).get("TagName", "")
    category = category_by_key.get(category_tag, {"id": "uncategorized", "label": "Uncategorized"})
    effect_paths = [
      pair.get("ComponentGameplayEffect")
      for pair in (entry.get("EventEffectPairs") or [])
      if pair.get("ComponentGameplayEffect") not in (None, "", "None")
    ]
    event_tags = [
      ((pair.get("EventTag") or {}).get("TagName"))
      for pair in (entry.get("EventEffectPairs") or [])
      if ((pair.get("EventTag") or {}).get("TagName")) not in (None, "", "None")
    ]
    name = clean_text(entry.get("ComponentName")) or title_case(get_last_key_segment(entry.get("Name")))
    components.append(
      {
        "id": get_id(entry.get("Name")),
        "key": entry.get("Name"),
        "slug": slugify(name),
        "name": name,
        "description": clean_text(entry.get("ComponentDescription")) or f"{name} component.",
        "icon": entry.get("ComponentIcon", ""),
        "categoryId": category["id"],
        "category": category["label"],
        "pointValues": entry.get("ComponentPointValues") or [],
        "tagIds": [
          tag.get("TagName")
          for tag in ((entry.get("Categories") or {}).get("GameplayTags") or [])
          if tag.get("TagName")
        ],
        "eventTags": event_tags,
        "effectIds": [effect_ids_by_path[path] for path in effect_paths if path in effect_ids_by_path],
        "effectPaths": effect_paths,
        "nativeVehicles": sorted(
          natives_by_component_key.get(entry.get("Name"), []),
          key=lambda item: item["vehicleId"],
        ),
        "source": {
          "key": entry.get("Name"),
        },
      }
    )
  components.sort(key=lambda item: item["name"])

  talents = []
  for entry in allowed_talent_rows:
    effect_paths = [
      pair.get("TalentGameplayEffect")
      for pair in (entry.get("EventEffectPairs") or [])
      if pair.get("TalentGameplayEffect") not in (None, "", "None")
    ]
    name = clean_text(entry.get("TalentName")) or title_case(get_last_key_segment(entry.get("Name")))
    talent_id = get_scoped_talent_id(entry.get("Name"))
    talents.append(
      {
        "id": talent_id,
        "key": entry.get("Name"),
        "slug": slugify(f"{talent_id}-{name}"),
        "name": name,
        "description": clean_text(entry.get("TalentDescription")) or f"{name} talent.",
        "supplementalDescription": clean_text(entry.get("TalentSupplementalDescription")),
        "icon": entry.get("TalentIcon", ""),
        "type": entry.get("TalentType", "Unknown"),
        "maxPoints": len(entry.get("TalentPointValues") or []),
        "pointValues": entry.get("TalentPointValues") or [],
        "eventTags": [
          ((pair.get("EventTag") or {}).get("TagName"))
          for pair in (entry.get("EventEffectPairs") or [])
          if ((pair.get("EventTag") or {}).get("TagName")) not in (None, "", "None")
        ],
        "effectIds": [effect_ids_by_path[path] for path in effect_paths if path in effect_ids_by_path],
        "effectPaths": effect_paths,
        "source": {
          "key": entry.get("Name"),
        },
      }
    )
  talents.sort(key=lambda item: item["name"])
  talent_by_key = {talent["key"]: talent for talent in talents}

  talent_trees = []
  for file_name in allowed_talent_tree_files:
    tree = load_json(raw_root / "TalentTrees" / file_name)
    tree_id = file_name.replace("_TechTree.json", "").lower()
    nodes = []
    for node in tree.get("tech_nodes", []):
      nodes.append(
        {
          "talentId": (talent_by_key.get(node.get("gameplay_tag")) or {}).get("id") or get_scoped_talent_id(node.get("gameplay_tag")),
          "tier": int(node.get("tier") or 0),
          "row": int(node.get("row") or 0),
          "maxPoints": int(node.get("max_points") or 0),
          "isKeystone": bool(node.get("is_keystone")),
          "prerequisiteIds": [
            (talent_by_key.get(value) or {}).get("id") or get_scoped_talent_id(value)
            for value in (node.get("prerequisites") or [])
          ],
        }
      )
    nodes.sort(key=lambda item: (item["tier"], item["row"]))
    talent_trees.append(
      {
        "id": tree_id,
        "slug": slugify(tree_id),
        "name": title_case(tree_id),
        "vehicleId": tree_id,
        "version": int(((tree.get("metadata") or {}).get("version")) or tree.get("version") or 0),
        "talentCount": len(tree.get("tech_nodes", [])),
        "nodes": nodes,
        "source": {
          "file": file_name,
        },
      }
    )
  talent_trees.sort(key=lambda item: item["name"])

  vehicles = []
  for vehicle in allowed_vehicle_ui:
    vehicle_key = vehicle.get("Name")
    vehicle_id = get_id(vehicle_key)
    tank = tank_by_key.get(vehicle_key, {})
    name = clean_text(vehicle.get("VehicleName")) or title_case(vehicle_id)
    class_id = get_id(((vehicle.get("VehicleClassTag") or {}).get("TagName")) or "unknown")
    class_label = title_case(get_last_key_segment(((vehicle.get("VehicleClassTag") or {}).get("TagName")) or "Unknown"))
    stats = {
      key: value
      for key, value in tank.items()
      if is_finite_number(value)
    }
    vehicles.append(
      {
        "id": vehicle_id,
        "key": vehicle_key,
        "slug": slugify(name),
        "name": name,
        "classId": class_id,
        "classLabel": class_label,
        "isWorkInProgress": bool(tank.get("bIsWorkInProgress")),
        "selectable": True,
        "stats": stats,
        "loadout": {
          "componentSlotCount": 3,
          "ammoSlotCount": 3,
          "defaultAmmoIds": ["standard", "standard", "standard"],
          "previewAmmoSlot": 0,
          "talentTreeId": vehicle_id,
        },
        "nativeComponents": sorted(
          natives_by_vehicle_key.get(vehicle_key, []),
          key=lambda item: item["level"],
        ),
        "source": {
          "tankKey": tank.get("Name") or vehicle_key,
          "vehicleUiKey": vehicle_key,
        },
      }
    )
  vehicles = [vehicle for vehicle in vehicles if vehicle["id"] != "basetank"]
  vehicles.sort(key=lambda item: item["name"])

  maps = []
  for entry in maps_raw:
    raw_display = clean_text(entry.get("DisplayName")) or entry.get("Name")
    is_prototype = bool(re.match(r"^prototype:\s*", raw_display, flags=re.IGNORECASE))
    name = re.sub(r"^prototype:\s*", "", raw_display, flags=re.IGNORECASE).strip()
    map_id = slugify(name)
    maps.append(
      {
        "id": map_id,
        "slug": map_id,
        "name": name,
        "displayName": raw_display,
        "status": "prototype" if is_prototype else "released",
        "source": {
          "key": entry.get("Name"),
          "minimapTexture": entry.get("MinimapTexture", ""),
          "lobbyTexture": entry.get("LobbyTexture", ""),
        },
      }
    )
  maps.sort(key=lambda item: item["name"])

  bundle = {
    "metadata": {
      "schemaVersion": 1,
      "generatedAt": now,
      "rawSource": raw_source,
    },
    "vehicles": vehicles,
    "ammo": ammo,
    "components": components,
    "talents": talents,
    "talentTrees": talent_trees,
    "effects": effects,
    "maps": maps,
  }

  canonical_index = {
    "schemaVersion": 1,
    "generatedAt": now,
    "counts": {
      "vehicles": len(vehicles),
      "ammo": len(ammo),
      "components": len(components),
      "talents": len(talents),
      "talentTrees": len(talent_trees),
      "effects": len(effects),
      "maps": len(maps),
    },
    "files": {
      "vehicles": [f"vehicles/{item['id']}.json" for item in vehicles],
      "ammo": [f"ammo/{item['id']}.json" for item in ammo],
      "components": [f"components/{item['id']}.json" for item in components],
      "talents": [f"talents/{item['id']}.json" for item in talents],
      "talentTrees": [f"talent-trees/{item['id']}.json" for item in talent_trees],
      "effects": [f"effects/{item['id']}.json" for item in effects],
      "maps": [f"maps/{item['id']}.json" for item in maps],
    },
  }

  if canonical_root is not None:
    write_entity_files(canonical_root / "vehicles", vehicles)
    write_entity_files(canonical_root / "ammo", ammo)
    write_entity_files(canonical_root / "components", components)
    write_entity_files(canonical_root / "talents", talents)
    write_entity_files(canonical_root / "talent-trees", talent_trees)
    write_entity_files(canonical_root / "effects", effects)
    write_entity_files(canonical_root / "maps", maps)
    save_json(canonical_root / "index.json", canonical_index)
  save_json(generated_root / "runtime.json", bundle)
  write_asset_manifest(
    generated_root,
    armor_models_dir=armor_models_dir,
    map_lobby_dir=map_lobby_dir,
    map_minimap_dir=map_minimap_dir,
  )

  print(
    f"Generated website data: {len(vehicles)} vehicles, {len(components)} components, "
    f"{len(talents)} talents, {len(maps)} maps"
  )


# ---------------------------------------------------------------------------
# Snapser manifest → native component data
# ---------------------------------------------------------------------------

def export_native_component_data(
  tmp_dir,
  snapctl_binary,
  snapend_id,
  api_key,
  dry_run=False,
  verbose=False,
):
  """Download Snapser manifest and extract vehicle→native component mappings."""
  manifest_dir = os.path.join(tmp_dir, "snapser")
  os.makedirs(manifest_dir, exist_ok=True)
  allowed_vehicle_keys = load_vehicle_keys(
    Path(tmp_dir) / "VehicleUIData.json",
    required=not dry_run,
  )

  print("Downloading Snapser manifest...")
  cmd = [
    snapctl_binary, "snapend", "download",
    "--snapend-id", snapend_id,
    "--category", "snapend-manifest",
    "--format", "json",
    "--out-path", manifest_dir,
    "--api-key", api_key,
  ]
  if dry_run:
    print("DRY RUN:", " ".join(cmd))
    return
  result = subprocess.run(cmd, capture_output=True, text=True)
  if result.returncode != 0:
    print(f"WARNING: snapctl failed: {result.stderr.strip()}")
    print("Skipping native component data export.")
    return

  # Find the downloaded manifest file
  manifest_path = None
  for fname in os.listdir(manifest_dir):
    if fname.endswith(".json") and "manifest" in fname:
      manifest_path = os.path.join(manifest_dir, fname)
      break

  if not manifest_path:
    print("WARNING: No manifest file found after download. Skipping native component data.")
    return

  with open(manifest_path, "r", encoding="utf-8") as f:
    manifest = json.load(f)

  # Find trackables settings
  trackables = None
  for s in manifest.get("settings", []):
    if s.get("id") == "trackables":
      trackables = s
      break

  if not trackables:
    print("WARNING: No trackables settings in manifest. Skipping native component data.")
    return

  # Extract vehicle progression tracks and their component rewards
  vehicle_natives = []
  for xp_setting in trackables.get("data", {}).get("xp_settings", []):
    name = xp_setting.get("name", "")
    if not name.endswith("-Progression"):
      continue

    # e.g. "Gameplay-Vehicle-Drone-Progression" → "Gameplay.Vehicle.Drone"
    vehicle_key = name.replace("-Progression", "").replace("-", ".")

    native_components = []
    for level in xp_setting.get("levels", []):
      rewards = level.get("level_completion_rewards", {}).get("items", {})
      for reward_id in rewards:
        if reward_id.startswith("Gameplay-Item-Component-") and reward_id != "Gameplay-Item-Component-Slot":
          # e.g. "Gameplay-Item-Component-CoreAmp" → "Gameplay.Components.CoreAmp"
          comp_name = reward_id.replace("Gameplay-Item-Component-", "")
          component_key = f"Gameplay.Components.{comp_name}"
          native_components.append({
            "componentKey": component_key,
            "level": level["index"] + 1,
          })

    if vehicle_key in allowed_vehicle_keys:
      vehicle_natives.append({
        "vehicleKey": vehicle_key,
        "nativeComponents": native_components,
      })

  vehicle_natives.sort(key=lambda x: x["vehicleKey"])

  out_path = os.path.join(tmp_dir, "NativeComponentData.json")
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(vehicle_natives, f, indent=2)
    f.write("\n")

  total = sum(len(v["nativeComponents"]) for v in vehicle_natives)
  print(f"Exported native component data: {len(vehicle_natives)} vehicles, {total} component assignments.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Armor viewer data export
# ---------------------------------------------------------------------------

ARMOR_TEXTURE_REGISTRY = f"{BASE_REGISTRY_PATH}/DR_ArmorTextureDataRegistry"
VEHICLE_UI_REGISTRY = f"{BASE_REGISTRY_PATH}/DR_VehicleUIDataRegistry"
VISUAL_MESH_OVERRIDES = {
  "blink": "/TyrVehicleBlink/Meshes/SK_Blink_Tank_Visual.SK_Blink_Tank_Visual",
  "ram": "/TyrVehicleRam/Meshes/SK_Ram_Visual_01.SK_Ram_Visual_01",
}

# Map from registry vehicle tag to mesh/texture naming convention
# Registry ID: "TyrArmorTextureData:Gameplay.Vehicle.Vanguard"
# Mesh: /TyrVehicle{Name}/Meshes/SK_{Name}_Base_Armor_01
# Armor texture: /TyrVehicle{Name}/Textures/T_{Name}_Base_Armor_01_Armor
# Module ColorId: /TyrVehicle{Name}/Textures/T_{Name}_Base_Armor_01_Module_Color_Id

def get_first(data, *keys, default=None):
  if not isinstance(data, dict):
    return default
  for key in keys:
    if key in data:
      return data[key]
  return default


def blueprint_generated_class_to_asset_path(path):
  if not path or path == "None":
    return None
  path = path.strip()
  if path.endswith("_C"):
    path = path[:-2]
  return path


def read_dependency_lines(path):
  try:
    with open(path, "r", encoding="utf-8") as handle:
      return [line.strip() for line in handle.readlines()]
  except UnicodeDecodeError:
    with open(path, "r", encoding="utf-16-le") as handle:
      return [line.strip() for line in handle.readlines()]


def resolve_visual_mesh_dependency(cli_path, blueprint_path, dry_run=False, verbose=False):
  ok, payload = run_cli_with_status(
    cli_path,
    ["export_asset_dependencies", "--path", blueprint_path],
    dry_run=dry_run,
  )
  if not ok:
    return None

  dep_file = pick_existing_file(collect_file_paths(payload), ".txt")
  if not dep_file:
    return None

  for line in read_dependency_lines(dep_file):
    if not line.startswith("- "):
      continue

    dependency = line[2:].strip()
    if "/Meshes/SK_" not in dependency:
      continue
    if "_Base_Visual" not in dependency:
      continue
    if "Tread" in dependency or "Armor" in dependency:
      continue
    return dependency

  if verbose:
    print(f"  Warning: no visual mesh dependency found for {blueprint_path}")
  return None


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth_predictor(a, b, c):
  p = a + b - c
  pa = abs(p - a)
  pb = abs(p - b)
  pc = abs(p - c)
  if pa <= pb and pa <= pc:
    return a
  if pb <= pc:
    return b
  return c


def decode_png_rgba(path):
  data = Path(path).read_bytes()
  if not data.startswith(PNG_SIGNATURE):
    raise ValueError(f"Not a PNG file: {path}")

  offset = len(PNG_SIGNATURE)
  ihdr = None
  idat_chunks = []
  while offset + 8 <= len(data):
    chunk_length = struct.unpack_from(">I", data, offset)[0]
    chunk_type = data[offset + 4 : offset + 8]
    chunk_start = offset + 8
    chunk_end = chunk_start + chunk_length
    chunk_data = data[chunk_start:chunk_end]
    offset = chunk_end + 4

    if chunk_type == b"IHDR":
      ihdr = chunk_data
    elif chunk_type == b"IDAT":
      idat_chunks.append(chunk_data)
    elif chunk_type == b"IEND":
      break

  if ihdr is None:
    raise ValueError(f"PNG missing IHDR chunk: {path}")

  width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
    ">IIBBBBB", ihdr
  )
  if bit_depth != 8:
    raise ValueError(f"Unsupported PNG bit depth {bit_depth}: {path}")
  if compression != 0 or filter_method != 0 or interlace != 0:
    raise ValueError(f"Unsupported PNG encoding parameters: {path}")

  channels_by_color_type = {
    0: 1,  # grayscale
    2: 3,  # rgb
    4: 2,  # grayscale + alpha
    6: 4,  # rgba
  }
  channels = channels_by_color_type.get(color_type)
  if channels is None:
    raise ValueError(f"Unsupported PNG color type {color_type}: {path}")

  stride = width * channels
  decompressed = zlib.decompress(b"".join(idat_chunks))
  expected = height * (stride + 1)
  if len(decompressed) < expected:
    raise ValueError(f"PNG pixel data truncated: {path}")

  raw_pixels = bytearray()
  prev_scanline = bytes(stride)
  pos = 0
  for _ in range(height):
    filter_type = decompressed[pos]
    pos += 1
    scanline = bytearray(decompressed[pos : pos + stride])
    pos += stride
    recon = bytearray(stride)

    for i, value in enumerate(scanline):
      left = recon[i - channels] if i >= channels else 0
      up = prev_scanline[i]
      up_left = prev_scanline[i - channels] if i >= channels else 0

      if filter_type == 0:
        recon[i] = value
      elif filter_type == 1:
        recon[i] = (value + left) & 0xFF
      elif filter_type == 2:
        recon[i] = (value + up) & 0xFF
      elif filter_type == 3:
        recon[i] = (value + ((left + up) // 2)) & 0xFF
      elif filter_type == 4:
        recon[i] = (value + paeth_predictor(left, up, up_left)) & 0xFF
      else:
        raise ValueError(f"Unsupported PNG filter type {filter_type}: {path}")

    raw_pixels.extend(recon)
    prev_scanline = bytes(recon)

  rgba = bytearray()
  if color_type == 6:
    rgba = raw_pixels
  elif color_type == 2:
    for i in range(0, len(raw_pixels), 3):
      rgba.extend((raw_pixels[i], raw_pixels[i + 1], raw_pixels[i + 2], 255))
  elif color_type == 0:
    for value in raw_pixels:
      rgba.extend((value, value, value, 255))
  elif color_type == 4:
    for i in range(0, len(raw_pixels), 2):
      rgba.extend((raw_pixels[i], raw_pixels[i], raw_pixels[i], raw_pixels[i + 1]))

  return {
    "width": width,
    "height": height,
    "data": bytes(rgba),
  }


def parse_glb_triangle_count(path):
  data = Path(path).read_bytes()
  if len(data) < 20:
    raise ValueError(f"Invalid GLB file: {path}")

  magic, version, total_length = struct.unpack_from("<4sII", data, 0)
  if magic != b"glTF":
    raise ValueError(f"Invalid GLB magic: {path}")
  if version != 2:
    raise ValueError(f"Unsupported GLB version {version}: {path}")
  if total_length > len(data):
    raise ValueError(f"GLB length exceeds file size: {path}")

  offset = 12
  json_chunk = None
  while offset + 8 <= len(data):
    chunk_length, chunk_type = struct.unpack_from("<I4s", data, offset)
    offset += 8
    chunk_data = data[offset : offset + chunk_length]
    offset += chunk_length
    if chunk_type == b"JSON":
      json_chunk = chunk_data
      break

  if json_chunk is None:
    raise ValueError(f"GLB missing JSON chunk: {path}")

  gltf = json.loads(json_chunk.decode("utf-8").rstrip("\x00 ").strip())
  meshes = gltf.get("meshes") or []
  if not meshes or not meshes[0].get("primitives"):
    raise ValueError(f"GLB missing mesh primitives: {path}")

  primitive = meshes[0]["primitives"][0]
  accessor_index = primitive.get("indices")
  if accessor_index is None:
    raise ValueError(f"GLB primitive missing indices accessor: {path}")

  accessors = gltf.get("accessors") or []
  accessor = accessors[accessor_index]
  return int(accessor.get("count", 0)) // 3


def process_vehicle_armor_data(vehicle_id, models_dir, temp_dir):
  models_dir = Path(models_dir)
  temp_dir = Path(temp_dir)
  glb_path = models_dir / f"{vehicle_id}.glb"
  armor_tex_path = temp_dir / f"{vehicle_id}_armor.png"
  module_tex_path = temp_dir / f"{vehicle_id}_module.png"
  out_path = models_dir / f"{vehicle_id}-armor.json"

  if not glb_path.exists():
    print(f"  Skip {vehicle_id}: no GLB")
    return False
  if not armor_tex_path.exists():
    print(f"  Skip {vehicle_id}: no armor texture")
    return False

  tri_count = parse_glb_triangle_count(glb_path)
  armor_tex = decode_png_rgba(armor_tex_path)
  width = armor_tex["width"]
  height = armor_tex["height"]
  armor_triangles = []
  section_ids = []
  armor_pixels = armor_tex["data"]
  for i in range(0, len(armor_pixels), 4):
    thickness = armor_pixels[i + 2]
    fifty_fifty = 1 if armor_pixels[i + 1] != 0 else 0
    section_id = armor_pixels[i + 3]
    armor_triangles.append([thickness, fifty_fifty])
    section_ids.append(section_id)

  is_module = [0] * tri_count
  is_absorb = [0] * tri_count
  if module_tex_path.exists():
    module_tex = decode_png_rgba(module_tex_path)
    module_pixels = module_tex["data"]
    module_count = 0
    limit = min(tri_count, module_tex["width"] * module_tex["height"])
    for triangle_index in range(limit):
      pixel_index = triangle_index * 4
      module_id = module_pixels[pixel_index + 2]
      absorb_flag = 1 if module_pixels[pixel_index + 1] != 0 else 0
      if module_id > 0:
        is_module[triangle_index] = 1
        is_absorb[triangle_index] = absorb_flag
        module_count += 1
    print(f"  {vehicle_id}: {tri_count} tris, {module_count} modules")
  else:
    print(f"  {vehicle_id}: {tri_count} tris (no module texture)")

  save_json(
    out_path,
    {
      "vehicleId": vehicle_id,
      "textureWidth": width,
      "textureHeight": height,
      "triangles": armor_triangles,
      "isModule": is_module,
      "isAbsorb": is_absorb,
      "sectionIds": section_ids,
    },
  )
  return True


def process_armor_viewer_outputs(models_dir, temp_dir, dry_run=False, verbose=False):
  models_dir = Path(models_dir)
  temp_dir = Path(temp_dir)
  print(f"Processing armor data from: {temp_dir}")

  if not temp_dir.exists():
    print(f"Texture directory not found: {temp_dir}")
    print("Armor JSON generation skipped.")
    return 0

  glb_files = sorted(
    file_path.name
    for file_path in models_dir.glob("*.glb")
    if not file_path.name.endswith("-visual.glb")
  )
  expected_armor_json = {
    glb_name.replace(".glb", "-armor.json")
    for glb_name in glb_files
  }
  remove_stale_files(
    models_dir,
    expected_armor_json,
    ["*-armor.json"],
    dry_run=dry_run,
    verbose=verbose,
  )

  if dry_run:
    print(f"DRY RUN: would process armor data for {len(glb_files)} vehicles")
    return len(glb_files)

  count = 0
  for glb_name in glb_files:
    vehicle_id = glb_name[:-4]
    if process_vehicle_armor_data(vehicle_id, models_dir, temp_dir):
      count += 1

  try:
    shutil.rmtree(temp_dir)
    print(f"Cleaned up texture temp dir: {temp_dir}")
  except OSError:
    print(f"Warning: could not clean up {temp_dir}")

  print(f"Processed {count} vehicles.")
  return count

def export_armor_viewer_data(cli_path, tmp_dir, out_dir, dry_run=False, verbose=False):
  """Export armor meshes (GLB), armor textures, and module textures for the 3D armor viewer."""
  registry_path = os.path.join(tmp_dir, "ArmorTextureData.json")
  vehicle_ui_path = os.path.join(tmp_dir, "VehicleUIData.json")

  # Export the armor texture registry
  export_data_registry(
    cli_path, ARMOR_TEXTURE_REGISTRY, registry_path,
    dry_run=dry_run, verbose=verbose,
  )

  if not os.path.exists(vehicle_ui_path):
    export_data_registry(
      cli_path, VEHICLE_UI_REGISTRY, vehicle_ui_path,
      dry_run=dry_run, verbose=verbose,
    )

  if dry_run:
    print("DRY RUN: would export armor viewer data")
    return

  if not os.path.exists(registry_path):
    print("Skip armor export: ArmorTextureData.json not found.")
    return

  normalize_registry_export(registry_path)
  vehicles = load_json(registry_path)
  vehicle_ui = {}
  allowed_vehicle_ids = set()
  if os.path.exists(vehicle_ui_path):
    normalize_registry_export(vehicle_ui_path)
    for entry in load_json(vehicle_ui_path):
      tag = get_first(entry, "Name", "name", default="")
      vehicle_name = tag.split(".")[-1]
      vehicle_id = vehicle_name.lower()
      if vehicle_id:
        vehicle_ui[vehicle_id] = entry
        allowed_vehicle_ids.add(vehicle_id)

  if not allowed_vehicle_ids:
    raise RuntimeError("No allowed vehicles found in VehicleUIData.json; refusing to export armor data.")

  out = Path(out_dir)
  out.mkdir(parents=True, exist_ok=True)
  allowed_model_files = set()
  # Save textures alongside GLBs; the exporter processes and cleans them up afterward.
  tmp = out / "_textures"
  tmp.mkdir(parents=True, exist_ok=True)

  count = 0
  for entry in vehicles:
    tag = entry.get("Name", "")
    vehicle_name = tag.split(".")[-1]  # "Gameplay.Vehicle.Vanguard" → "Vanguard"
    vehicle_id = vehicle_name.lower()

    if not vehicle_name or vehicle_id in ("basetank", "spectatortank"):
      continue
    if vehicle_id not in allowed_vehicle_ids:
      continue

    # Derive asset paths from naming convention
    plugin = f"TyrVehicle{vehicle_name}"
    mesh_path = f"/{plugin}/Meshes/SK_{vehicle_name}_Base_Armor_01"
    armor_tex_path = f"/{plugin}/Textures/T_{vehicle_name}_Base_Armor_01_Armor"
    module_path = f"/{plugin}/Textures/T_{vehicle_name}_Base_Armor_01_Module"

    glb_out = out / f"{vehicle_id}.glb"
    visual_glb_out = out / f"{vehicle_id}-visual.glb"
    armor_png = tmp / f"{vehicle_id}_armor.png"
    module_png = tmp / f"{vehicle_id}_module.png"
    allowed_model_files.add(glb_out.name)
    allowed_model_files.add(visual_glb_out.name)

    if verbose:
      print(f"  Exporting armor data for {vehicle_id}...")

    # 1. Export mesh as GLB
    ok, _ = run_cli_with_status(cli_path, [
      "export_mesh_to_gltf",
      "--path", mesh_path,
      "--format", "glb",
      "--output_path", str(glb_out.resolve()),
    ])
    if not ok:
      print(f"  Warning: failed to export mesh for {vehicle_id}")
      continue

    # 1b. Export visual mesh from the cinematic actor blueprint dependencies
    ui_entry = vehicle_ui.get(vehicle_id, {})
    cinematic_actor = get_first(ui_entry, "CinematicActor", "cinematicActor")
    cinematic_blueprint = blueprint_generated_class_to_asset_path(cinematic_actor)
    visual_mesh_path = VISUAL_MESH_OVERRIDES.get(vehicle_id)
    if cinematic_blueprint:
      visual_mesh_path = resolve_visual_mesh_dependency(
        cli_path,
        cinematic_blueprint,
        dry_run=dry_run,
        verbose=verbose,
      ) or visual_mesh_path

    if visual_mesh_path:
      ok, _ = run_cli_with_status(cli_path, [
        "export_mesh_to_gltf",
        "--path", visual_mesh_path,
        "--format", "glb",
        "--output_path", str(visual_glb_out.resolve()),
      ])
      if not ok and verbose:
        print(f"  Warning: failed to export visual mesh for {vehicle_id}")
    elif verbose:
      print(f"  Warning: no visual mesh resolved for {vehicle_id}")

    # 2. Export armor texture (100x17 triangle-indexed, thickness in B channel)
    ok, _ = run_cli_with_status(cli_path, [
      "export_texture_asset",
      "--path", armor_tex_path,
      "--format", "png",
      "--output_path", str(armor_png.resolve()),
    ])
    if not ok:
      print(f"  Warning: failed to export armor texture for {vehicle_id}")
      continue

    # 3. Export module texture (triangle-indexed, matches gameplay triangle lookup)
    ok, _ = run_cli_with_status(cli_path, [
      "export_texture_asset",
      "--path", module_path,
      "--format", "png",
      "--output_path", str(module_png.resolve()),
    ])
    if not ok:
      if verbose:
        print(f"  Warning: no module texture for {vehicle_id}")

    count += 1
    if verbose:
      print(f"  Exported {vehicle_id}: mesh + textures")

  remove_stale_files(
    out,
    allowed_model_files,
    ["*.glb"],
    dry_run=dry_run,
    verbose=verbose,
  )

  processed_count = process_armor_viewer_outputs(
    out,
    tmp,
    dry_run=dry_run,
    verbose=verbose,
  )

  print(f"Exported armor source data for {count} vehicles to {out}")
  print(f"Generated armor JSON for {processed_count} vehicles.")


def main():
  parser = argparse.ArgumentParser(description="Export website-consumable Tyr data via tyr-unreal-cli.")
  parser.add_argument(
    "--output-root",
    default=None,
    help="Root folder for the standalone data repo layout.",
  )
  parser.add_argument(
    "--cli-path",
    default=CLI_PATH,
    help="Unreal CLI binary or full path. Defaults to TYR_UNREAL_CLI or tyr-unreal-cli on PATH.",
  )
  parser.add_argument(
    "--p4-binary",
    default=P4_BINARY,
    help="Perforce CLI binary or full path. Defaults to p4 on PATH.",
  )
  parser.add_argument(
    "--snapctl-binary",
    default=SNAPCTL_BINARY,
    help="Snapctl binary or full path. Defaults to SNAPCTL_BINARY or snapctl on PATH.",
  )
  parser.add_argument(
    "--deployment-config",
    default=PLAYTEST_DEPLOYMENT_CONFIG_DEPOT_PATH,
    help="Perforce depot path to the deployment config allowlist.",
  )
  parser.add_argument("--skip-tables", action="store_true", help="Skip DataTable/DataRegistry exports.")
  parser.add_argument(
    "--skip-talent-trees", action="store_true", help="Skip talent tree exports."
  )
  parser.add_argument(
    "--talent-tree-dir",
    default=TALENT_TREE_SOURCE_DIR,
    help="Optional source folder for talent tree JSON files. Defaults to TYR_TALENT_TREE_DIR when set.",
  )
  parser.add_argument(
    "--skip-effects", action="store_true", help="Skip gameplay effects summary export."
  )
  parser.add_argument(
    "--skip-snapser", action="store_true", help="Skip Snapser manifest download and native component export."
  )
  parser.add_argument(
    "--content-dir",
    default=CONTENT_DIR,
    help="Optional Unreal Content root for DataTable discovery fallback. Defaults to TYR_CONTENT_DIR when set.",
  )
  parser.add_argument(
    "--snapend-id",
    default=SNAPSER_SNAPEND_ID,
    help="Snapser snapend id. Defaults to SNAPSER_SNAPEND_ID.",
  )
  parser.add_argument(
    "--snapser-api-key",
    default=SNAPSER_API_KEY,
    help="Snapser API key. Defaults to SNAPSER_API_KEY.",
  )
  parser.add_argument(
    "--raw-out",
    default=None,
    help="Optional output folder for minimized raw data. Defaults to <output-root>/raw when --include-raw is set.",
  )
  parser.add_argument(
    "--vehicle-images-dir",
    "--images-dir",
    dest="vehicle_images_dir",
    default=None,
    help="Output folder for vehicle thumbnail PNGs. Defaults to <output-root>/assets/images/vehicles.",
  )
  parser.add_argument(
    "--map-lobby-dir",
    default=None,
    help="Output folder for map lobby images. Defaults to <output-root>/assets/images/maps/lobby.",
  )
  parser.add_argument(
    "--map-minimap-dir",
    default=None,
    help="Output folder for map minimap images. Defaults to <output-root>/assets/images/maps/minimap.",
  )
  parser.add_argument(
    "--ammo-icons-dir",
    default=None,
    help="Output folder for ammo icons. Defaults to <output-root>/assets/images/ammo.",
  )
  parser.add_argument(
    "--component-icons-dir",
    default=None,
    help="Output folder for component icons. Defaults to <output-root>/assets/images/components.",
  )
  parser.add_argument(
    "--talent-icons-dir",
    default=None,
    help="Output folder for talent icons. Defaults to <output-root>/assets/images/talents.",
  )
  parser.add_argument(
    "--ui-icons-dir",
    default=None,
    help="Output folder for UI icons. Defaults to <output-root>/assets/images/icons.",
  )
  parser.add_argument(
    "--armor-models-dir",
    default=None,
    help="Output folder for armor models and armor JSON. Defaults to <output-root>/assets/models/vehicles.",
  )
  parser.add_argument(
    "--thumbnail-size",
    type=int,
    default=THUMBNAIL_SIZE,
    help="Thumbnail size in pixels (default: 256).",
  )
  parser.add_argument(
    "--skip-thumbnails",
    action="store_true",
    help="Skip vehicle thumbnail export.",
  )
  parser.add_argument(
    "--skip-map-textures",
    action="store_true",
    help="Skip map lobby and minimap texture export.",
  )
  parser.add_argument(
    "--skip-armor",
    action="store_true",
    help="Skip armor viewer data export (meshes + textures).",
  )
  parser.add_argument(
    "--skip-icons",
    action="store_true",
    help="Skip ammo, component, and talent icon export.",
  )
  parser.add_argument(
    "--keep-tmp",
    action="store_true",
    help="Keep temp directory after export for debugging.",
  )
  parser.add_argument(
    "--include-raw",
    action="store_true",
    help="Write minimized raw data into the output root.",
  )
  parser.add_argument(
    "--canonical-out",
    default=None,
    help="Output folder for canonical data. Defaults to <output-root>/canonical.",
  )
  parser.add_argument(
    "--generated-out",
    default=None,
    help="Output folder for generated runtime data. Defaults to <output-root>/generated.",
  )
  parser.add_argument(
    "--skip-canonical",
    action="store_true",
    help="Skip writing canonical per-entity JSON output.",
  )
  parser.add_argument(
    "--generate-canonical",
    action="store_true",
    help="Deprecated compatibility flag. Website data is generated automatically.",
  )
  parser.add_argument("--verbose", action="store_true", help="Print resolved paths.")
  parser.add_argument("--dry-run", action="store_true", help="Print commands only.")
  args = parser.parse_args()

  cli_path = resolve_executable(args.cli_path, "tyr-unreal-cli")
  p4_binary = resolve_executable(args.p4_binary, "p4")
  snapctl_binary = None
  if not args.skip_snapser:
    snapctl_binary = resolve_executable(args.snapctl_binary, "snapctl")
    if not args.snapend_id:
      raise ValueError("Snapser is enabled but --snapend-id / SNAPSER_SNAPEND_ID is not set.")
    if not args.snapser_api_key:
      raise ValueError("Snapser is enabled but --snapser-api-key / SNAPSER_API_KEY is not set.")

  deployment_allowlists = load_playtest_allowlists(p4_binary, args.deployment_config)
  allowed_vehicle_ids = deployment_allowlists["vehicle_ids"]
  allowed_map_ids = deployment_allowlists["map_ids"]

  include_raw = args.include_raw or bool(args.raw_out)
  output_root = Path(args.output_root) if args.output_root else None
  canonical_out = resolve_output_path(
    output_root,
    args.canonical_out,
    CANONICAL_OUT_DIR,
    "canonical output",
    required=not args.dry_run,
  )
  generated_out = resolve_output_path(
    output_root,
    args.generated_out,
    GENERATED_OUT_DIR,
    "generated output",
    required=not args.dry_run,
  )
  raw_out = resolve_output_path(
    output_root,
    args.raw_out,
    RAW_OUT_DIR,
    "raw output",
    required=False,
  )
  vehicle_images_dir = resolve_output_path(
    output_root,
    args.vehicle_images_dir,
    VEHICLE_IMAGES_DIR,
    "vehicle image output",
    required=not args.skip_thumbnails,
  )
  map_lobby_dir = resolve_output_path(
    output_root,
    args.map_lobby_dir,
    MAP_LOBBY_IMAGES_DIR,
    "map lobby output",
    required=not args.skip_map_textures,
  )
  map_minimap_dir = resolve_output_path(
    output_root,
    args.map_minimap_dir,
    MAP_MINIMAP_IMAGES_DIR,
    "map minimap output",
    required=not args.skip_map_textures,
  )
  ammo_icons_dir = resolve_output_path(
    output_root,
    args.ammo_icons_dir,
    AMMO_ICONS_DIR,
    "ammo icon output",
    required=not args.skip_icons,
  )
  component_icons_dir = resolve_output_path(
    output_root,
    args.component_icons_dir,
    COMPONENT_ICONS_DIR,
    "component icon output",
    required=not args.skip_icons,
  )
  talent_icons_dir = resolve_output_path(
    output_root,
    args.talent_icons_dir,
    TALENT_ICONS_DIR,
    "talent icon output",
    required=not args.skip_icons,
  )
  ui_icons_dir = resolve_output_path(
    output_root,
    args.ui_icons_dir,
    UI_ICONS_DIR,
    "ui icon output",
    required=not args.skip_icons,
  )
  armor_models_dir = resolve_output_path(
    output_root,
    args.armor_models_dir,
    ARMOR_MODELS_DIR,
    "armor model output",
    required=not args.skip_armor,
  )

  if args.verbose:
    print(
      f"Deployment allowlist: {len(allowed_vehicle_ids)} vehicles, {len(allowed_map_ids)} maps "
      f"from {args.deployment_config}"
    )

  tmp_dir = tempfile.mkdtemp(prefix="aggro_export_")
  if args.verbose:
    print(f"Temp directory: {tmp_dir}")

  try:
    run_cli(cli_path, ["ping"], dry_run=args.dry_run)

    # Phase 1: Export + Normalize to temp directory
    if not args.skip_tables:
      for spec in DATA_EXPORTS:
        out_path = os.path.join(tmp_dir, spec["out"])
        source = spec["source"]
        kind = spec.get("kind", "table")
        if kind == "registry":
          export_data_registry(
            cli_path,
            source,
            out_path,
            content_dir=args.content_dir,
            dry_run=args.dry_run,
            verbose=args.verbose,
          )
          if not args.dry_run:
            normalize_registry_export(out_path)
        else:
          export_data_table(
            cli_path,
            source,
            out_path,
            content_dir=args.content_dir,
            dry_run=args.dry_run,
            verbose=args.verbose,
          )
        if args.dry_run:
          continue
        if spec["out"] == "ComponentData.json":
          normalize_component_data(out_path)
        if spec["out"] == "TalentTreeData.json":
          normalize_talent_data(out_path)

    if not args.skip_tables and not args.dry_run:
      apply_playtest_allowlists(tmp_dir, allowed_vehicle_ids, allowed_map_ids)

    # Phase 1b: Export talent trees directly to final location
    if not args.skip_talent_trees:
      export_talent_trees(
        cli_path, args.talent_tree_dir, raw_out if include_raw and raw_out else Path(tmp_dir) / "_raw",
        content_dir=args.content_dir,
        allowed_vehicle_ids=allowed_vehicle_ids,
        dry_run=args.dry_run,
        verbose=args.verbose,
      )

    # Phase 1c: Export gameplay effects (reads from tmp_dir)
    if not args.skip_effects:
      export_gameplay_effects_summary(cli_path, tmp_dir, dry_run=args.dry_run)

    # Phase 1d: Export vehicle thumbnails
    if not args.skip_thumbnails:
      export_vehicle_thumbnails(
        cli_path, tmp_dir, vehicle_images_dir,
        size=args.thumbnail_size, dry_run=args.dry_run, verbose=args.verbose,
      )

    # Phase 1e: Export map textures (lobby + minimap)
    if not args.skip_map_textures:
      export_map_textures(
        cli_path, tmp_dir, map_lobby_dir, map_minimap_dir,
        dry_run=args.dry_run, verbose=args.verbose,
      )

    # Phase 1e2: Export ammo, component, and talent icons
    if not args.skip_icons:
      export_item_icons(
        cli_path, tmp_dir, ammo_icons_dir, component_icons_dir, talent_icons_dir, ui_icons_dir,
        dry_run=args.dry_run, verbose=args.verbose,
      )

    # Phase 1f: Export armor viewer data (meshes + textures)
    if not args.skip_armor:
      export_armor_viewer_data(
        cli_path, tmp_dir, armor_models_dir,
        dry_run=args.dry_run, verbose=args.verbose,
      )

    # Phase 1g: Download Snapser manifest and extract native component data
    if not args.skip_snapser:
      export_native_component_data(
        tmp_dir,
        snapctl_binary=snapctl_binary,
        snapend_id=args.snapend_id,
        api_key=args.snapser_api_key,
        dry_run=args.dry_run,
        verbose=args.verbose,
      )

    # Phase 2: Minimize + Write to raw output
    if not args.dry_run:
      generation_raw_root = raw_out if include_raw and raw_out else (Path(tmp_dir) / "_raw")
      write_minimized_exports(tmp_dir, generation_raw_root)
      build_canonical_game_data(
        generation_raw_root,
        canonical_root=None if args.skip_canonical else canonical_out,
        generated_root=generated_out,
        armor_models_dir=armor_models_dir,
        map_lobby_dir=map_lobby_dir,
        map_minimap_dir=map_minimap_dir,
      )

  finally:
    if args.keep_tmp:
      print(f"Temp directory kept at: {tmp_dir}")
    else:
      shutil.rmtree(tmp_dir, ignore_errors=True)

  print("Export complete.")


if __name__ == "__main__":
  main()
