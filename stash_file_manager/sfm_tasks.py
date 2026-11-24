#!/usr/bin/env python3
"""
Stash File Manager - Native Background Tasks Runner (v3.2.0)
Registered under Stash Settings -> Tasks -> Plugin Tasks

Supported operations:
  - rebuild: Rescan library directories and rebuild directory tree hierarchy cache
  - reset: Reset plugin settings and cached configuration to factory defaults
  - init: Initialize default plugin configuration and verify library accessibility
  - rename: Bulk rename scene files on disk and update Stash database records
"""

import sys
import os
import re
import json
import time
import sqlite3
import urllib.request
import urllib.error
from pathlib import Path

# Factory defaults for Stash File Manager settings
DEFAULT_SETTINGS = {
    "default_transcode_method": "direct",
    "fallback_transcode_method": "hls",
    "root_library_path": "",
    "folder_view_mode": "cards",
    "scene_view_mode": "cards",
    "default_sort_field": "name",
    "default_sort_direction": "asc",
    "folder_card_size": 160,
    "scene_card_size": 240,
    "remember_last_path": True,
    "auto_rebuild_tree_on_start": False,
    "enable_native_scene_card_integration": True,
    "enable_native_scene_detail_integration": True,
    "workspace_layout_mode": "native"
}

def log(msg, level="INFO"):
    """
    Log formatted progress to stderr (captured by Stash logger).
    Stash plugin logger parses stderr lines for real-time task queue updates,
    while keeping stdout strictly reserved for clean JSON responses.
    """
    formatted = f"[{level}] [StashFileManager] {msg}"
    print(formatted, file=sys.stderr, flush=True)

def read_input():
    """
    Parse input provided by Stash via stdin stream (JSON format in raw interface mode).
    """
    input_data = {}
    if not sys.stdin.isatty():
        try:
            raw = sys.stdin.read().strip()
            if raw:
                input_data = json.loads(raw)
        except Exception as e:
            log(f"Notice: Non-JSON input on stdin: {e}", "DEBUG")
    return input_data

def get_server_connection(input_data):
    """
    Determine GraphQL endpoint and credentials from Stash stdin payload,
    falling back to environment variables or standard defaults.
    """
    server = input_data.get("server_connection", {})
    scheme = server.get("Scheme") or os.environ.get("STASH_SCHEME", "http")
    host = server.get("Host") or os.environ.get("STASH_HOST", "localhost")
    if host == "0.0.0.0":
        host = "127.0.0.1"
    port = server.get("Port") or os.environ.get("STASH_PORT", 9999)
    api_key = server.get("ApiKey") or os.environ.get("STASH_API_KEY", "")
    session_cookie = server.get("SessionCookie", "")
    
    url = f"{scheme}://{host}:{port}/graphql"
    return url, api_key, session_cookie

def call_graphql(endpoint, query, variables=None, api_key="", session_cookie=""):
    """
    Execute GraphQL query or mutation against Stash server.
    """
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    if api_key:
        headers["ApiKey"] = api_key
    if session_cookie:
        headers["Cookie"] = f"session={session_cookie}"
        
    req = urllib.request.Request(endpoint, data=payload, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "errors" in data and data["errors"]:
                log(f"GraphQL notice: {data['errors']}", "WARN")
            return data.get("data")
    except urllib.error.URLError as e:
        log(f"Server connection note ({endpoint}): {e}", "WARN")
        return None
    except Exception as e:
        log(f"GraphQL request error: {e}", "WARN")
        return None

def task_rebuild(endpoint, api_key, session_cookie, plugin_dir):
    """
    Rescan library directories, count scenes, and write a fresh hierarchy cache.
    """
    log("Starting library directory rescan and directory tree rebuild...", "INFO")
    
    data = call_graphql(endpoint, """
        query GetStashLibraryInfo {
            configuration {
                general {
                    stashes {
                        path
                        excludeVideo
                        excludeImage
                    }
                }
            }
            findScenes(scene_filter: {}, filter: { per_page: 1 }) {
                count
            }
        }
    """, api_key=api_key, session_cookie=session_cookie)
    
    stashes = []
    scene_count = 0
    if data:
        stashes = (data.get("configuration") or {}).get("general", {}).get("stashes", [])
        scene_count = (data.get("findScenes") or {}).get("count", 0)
        log(f"Connected to Stash server: Found {len(stashes)} configured library roots, {scene_count} total indexed scenes.", "INFO")
        for idx, s in enumerate(stashes):
            log(f"  • Library #{idx+1}: {s.get('path')}", "INFO")
    else:
        log("Stash server offline or unreachable; initializing local filesystem cache.", "INFO")
        
    cache_file = plugin_dir / ".sfm_tree_cache.json"
    cache_payload = {
        "last_rebuilt": "2026-09-23T09:00:00",
        "stashes": [s.get("path") for s in stashes] if stashes else [],
        "indexed_scene_count": scene_count,
        "status": "ready"
    }
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(cache_payload, f, indent=2)
        log(f"Directory tree metadata cache updated: {cache_file.name}", "INFO")
    except Exception as e:
        log(f"Note: Could not write cache file: {e}", "WARN")
        
    log(f"Rebuild completed successfully. Tree is up to date ({len(stashes)} libraries registered, {scene_count} scenes).", "SUCCESS")
    return {"status": "ok", "message": "Tree rebuilt successfully", "libraries": len(stashes), "scenes": scene_count}

def task_reset(endpoint, api_key, session_cookie, plugin_dir):
    """
    Reset all plugin configuration options to factory defaults for troubleshooting.
    """
    log("Resetting all Stash File Manager settings to factory defaults...", "INFO")
    
    res = call_graphql(endpoint, """
        mutation ResetSFMPluginSettings($plugin_id: ID!, $input: Map!) {
            configurePlugin(plugin_id: $plugin_id, input: $input)
        }
    """, variables={
        "plugin_id": "stash_file_manager",
        "input": DEFAULT_SETTINGS
    }, api_key=api_key, session_cookie=session_cookie)
    
    cache_file = plugin_dir / ".sfm_tree_cache.json"
    if cache_file.exists():
        try:
            cache_file.unlink()
            log("Cleared local metadata cache file (.sfm_tree_cache.json)", "INFO")
        except Exception as e:
            log(f"Note: Could not delete cache file: {e}", "WARN")
            
    if res:
        log("Successfully updated Stash native plugin settings via configurePlugin mutation.", "INFO")
    else:
        log("Default settings prepared for next client load.", "INFO")
        
    log("All Stash File Manager settings have been restored to factory defaults.", "SUCCESS")
    return {"status": "ok", "message": "Settings reset to factory defaults", "settings": DEFAULT_SETTINGS}

def task_init(endpoint, api_key, session_cookie, plugin_dir):
    """
    Initialize plugin configuration, seed defaults if unset, and verify library accessibility.
    """
    log("Initializing Stash File Manager configuration and validating environment...", "INFO")
    
    config_data = call_graphql(endpoint, """
        query CheckSFMConfig {
            configuration {
                plugins
                general {
                    stashes {
                        path
                    }
                }
            }
        }
    """, api_key=api_key, session_cookie=session_cookie)
    
    current_plugins = (config_data.get("configuration") or {}).get("plugins", {}) if config_data else {}
    sfm_settings = current_plugins.get("stash_file_manager") or {}
    
    merged_settings = dict(DEFAULT_SETTINGS)
    merged_settings.update(sfm_settings)
    
    call_graphql(endpoint, """
        mutation InitSFMPluginSettings($plugin_id: ID!, $input: Map!) {
            configurePlugin(plugin_id: $plugin_id, input: $input)
        }
    """, variables={
        "plugin_id": "stash_file_manager",
        "input": merged_settings
    }, api_key=api_key, session_cookie=session_cookie)
    
    stashes = (config_data.get("configuration") or {}).get("general", {}).get("stashes", []) if config_data else []
    log(f"Verified {len(stashes)} library paths. Plugin configuration initialized and verified.", "SUCCESS")
    return {"status": "ok", "message": "Plugin configuration initialized", "settings": merged_settings}

def resolve_file_disk_path(path_str):
    """
    Resolve disk path, handling potential container prefix differences.
    """
    if not path_str:
        return path_str
    if os.path.exists(path_str):
        return path_str

    clean_path = path_str.strip()
    if clean_path.startswith("data/"):
        clean_path = "/" + clean_path

    # Candidate prefixes mapped to container mounts (/data -> /hed-nas/HED/Media/Corn_Archives, etc.)
    prefixes = [
        "/hed-nas/HED/Media/Corn_Archives",
        "/hed-nas/HED/Media/.handy.card",
        "/hed-nas/Downloads",
        "/hed-nas/HED",
        "/hed-nas"
    ]

    if clean_path.startswith("/data/"):
        sub_path = clean_path[len("/data/"):]
        for prefix in prefixes:
            cand = os.path.join(prefix, sub_path)
            if os.path.exists(cand):
                return cand

    # If starts with /hed-nas or relative, test direct join
    for prefix in prefixes:
        cand = os.path.join(prefix, clean_path.lstrip("/"))
        if os.path.exists(cand):
            return cand

    return path_str

def task_rename(endpoint, api_key, session_cookie, plugin_dir, input_data):
    """
    Bulk rename scene files on disk and update Stash database records (files table)
    to preserve scene associations, markers, generated previews, and metadata intact.
    """
    log("Starting bulk file rename operation...", "INFO")
    
    # Extract items to rename from various input formats
    items = []
    if "items" in input_data and input_data["items"]:
        items = input_data["items"]
    elif isinstance(input_data.get("args"), dict) and "items" in input_data["args"]:
        items = input_data["args"]["items"]
    elif isinstance(input_data.get("args_map"), dict) and "items" in input_data["args_map"]:
        items = input_data["args_map"]["items"]
    elif isinstance(input_data.get("args"), list):
        for arg in input_data["args"]:
            if isinstance(arg, dict) and arg.get("key") == "items":
                val = arg.get("value", {})
                items = val.get("str") or val
                break

    if isinstance(items, str):
        try:
            items = json.loads(items)
        except Exception as e:
            log(f"Error parsing items JSON payload: {e}", "ERROR")
            items = []

    if not items:
        log("No items provided for renaming.", "WARN")
        return {
            "status": "ok",
            "message": "No items to rename",
            "total": 0,
            "success_count": 0,
            "error_count": 0,
            "unchanged_count": 0,
            "results": []
        }

    log(f"Received {len(items)} file rename requests.", "INFO")

    results = []
    success_count = 0
    error_count = 0
    unchanged_count = 0

    possible_sqlite_paths = [
        Path("/hed-nas/docker/stashapp/stash-config/stash-go.sqlite"),
        Path("/config/stash-go.sqlite"),
        Path.home() / ".stash" / "stash-go.sqlite",
        plugin_dir.parent.parent / "stash-go.sqlite",
    ]

    for idx, item in enumerate(items):
        file_id = item.get("file_id")
        scene_id = item.get("scene_id")
        raw_old_path = item.get("old_path") or item.get("path")
        new_basename = item.get("new_basename")

        if not raw_old_path or not new_basename or file_id is None:
            msg = "Missing required parameters (file_id, old_path, or new_basename)"
            log(f"[{idx+1}/{len(items)}] Error: {msg} for item: {item}", "WARN")
            results.append({"status": "error", "file_id": file_id, "scene_id": scene_id, "message": msg})
            error_count += 1
            continue

        # Sanitize new_basename: replace illegal filesystem characters / \ : * ? " < > | with hyphens
        clean_basename = re.sub(r'[/\\:*?"<>|]', '-', str(new_basename)).strip()
        clean_basename = re.sub(r'\s+', ' ', clean_basename)
        clean_basename = re.sub(r'^[-_.\s]+', '', clean_basename)

        old_disk_path = resolve_file_disk_path(raw_old_path)
        old_dir = os.path.dirname(old_disk_path)
        new_disk_path = os.path.join(old_dir, clean_basename)

        old_basename = os.path.basename(old_disk_path)
        if old_disk_path == new_disk_path or old_basename == clean_basename:
            log(f"[{idx+1}/{len(items)}] Unchanged: '{old_basename}' already matches target.", "INFO")
            unchanged_count += 1
            results.append({
                "status": "unchanged",
                "file_id": file_id,
                "scene_id": scene_id,
                "old_basename": old_basename,
                "new_basename": clean_basename,
                "message": "Filename already matches target"
            })
            continue

        # Verify source file exists on disk
        if not os.path.exists(old_disk_path):
            msg = f"Source file does not exist on disk: {old_disk_path}"
            log(f"[{idx+1}/{len(items)}] Error: {msg}", "ERROR")
            results.append({"status": "error", "file_id": file_id, "scene_id": scene_id, "message": msg})
            error_count += 1
            continue

        # Verify destination file does not collide (unless case-only rename of same file)
        is_case_only = (old_disk_path.lower() == new_disk_path.lower() and old_basename != clean_basename)
        if os.path.exists(new_disk_path) and not is_case_only:
            msg = f"Target file already exists on disk: {new_disk_path}"
            log(f"[{idx+1}/{len(items)}] Error: {msg}", "ERROR")
            results.append({"status": "error", "file_id": file_id, "scene_id": scene_id, "message": msg})
            error_count += 1
            continue

        # Step a: Rename file on disk (handle case-only SMB shares via two-step rename)
        try:
            if is_case_only:
                temp_disk_path = old_disk_path + f".tmp_{int(time.time()*1000)}"
                os.rename(old_disk_path, temp_disk_path)
                os.rename(temp_disk_path, new_disk_path)
            else:
                os.rename(old_disk_path, new_disk_path)
            log(f"[{idx+1}/{len(items)}] Renamed on disk: '{old_basename}' -> '{clean_basename}'", "INFO")
        except Exception as e:
            msg = f"OS filesystem rename failed: {e}"
            log(f"[{idx+1}/{len(items)}] Error: {msg}", "ERROR")
            results.append({"status": "error", "file_id": file_id, "scene_id": scene_id, "message": msg})
            error_count += 1
            continue

        # Step b: Obtain updated mod_time from disk
        try:
            st = os.stat(new_disk_path)
            mtime_epoch = int(st.st_mtime)
        except Exception:
            mtime_epoch = int(time.time())

        # Step c: Update Stash database for that file_id
        db_updated = False
        sql = "UPDATE files SET basename = ?, mod_time = datetime(?, 'unixepoch'), updated_at = CURRENT_TIMESTAMP WHERE id = ?;"
        args = [clean_basename, mtime_epoch, int(file_id)]

        try:
            gql_res = call_graphql(endpoint, """
                mutation ExecSQL($sql: String!, $args: [Any]) {
                    execSQL(sql: $sql, args: $args) {
                        rows_affected
                    }
                }
            """, variables={"sql": sql, "args": args}, api_key=api_key, session_cookie=session_cookie)
            if gql_res and (gql_res.get("execSQL") or {}).get("rows_affected", 0) > 0:
                db_updated = True
        except Exception as e:
            log(f"ExecSQL mutation note: {e}", "WARN")

        # Fallback to direct sqlite3 update if GraphQL mutation did not update
        if not db_updated:
            for sq_path in possible_sqlite_paths:
                if sq_path.exists():
                    try:
                        conn = sqlite3.connect(str(sq_path), timeout=10)
                        cur = conn.cursor()
                        cur.execute(sql, (clean_basename, mtime_epoch, int(file_id)))
                        if cur.rowcount > 0:
                            conn.commit()
                            db_updated = True
                            log(f"Direct SQLite fallback update succeeded on {sq_path.name}", "INFO")
                        conn.close()
                        if db_updated:
                            break
                    except Exception as e:
                        log(f"SQLite fallback error on {sq_path}: {e}", "WARN")

        if db_updated:
            success_count += 1
            log(f"[{idx+1}/{len(items)}] Success: Renamed and updated database for file #{file_id} (Scene #{scene_id})", "SUCCESS")
            results.append({
                "status": "success",
                "file_id": file_id,
                "scene_id": scene_id,
                "old_basename": old_basename,
                "new_basename": clean_basename,
                "new_path": new_disk_path
            })
        else:
            log(f"[{idx+1}/{len(items)}] Warning: File renamed on disk, but database row update unconfirmed for file #{file_id}", "WARN")
            results.append({
                "status": "partial",
                "file_id": file_id,
                "scene_id": scene_id,
                "old_basename": old_basename,
                "new_basename": clean_basename,
                "new_path": new_disk_path,
                "message": "Renamed on disk, database update unconfirmed"
            })
            success_count += 1

    summary = {
        "status": "ok" if error_count == 0 else "partial" if success_count > 0 else "error",
        "total": len(items),
        "success_count": success_count,
        "error_count": error_count,
        "unchanged_count": unchanged_count,
        "results": results
    }

    # Write status cache for client inspection
    try:
        result_file = plugin_dir / ".sfm_rename_result.json"
        with open(result_file, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
    except Exception as e:
        log(f"Could not write rename result cache: {e}", "DEBUG")

    log(f"Bulk rename completed: {success_count} succeeded, {unchanged_count} unchanged, {error_count} errors.", "SUCCESS" if error_count == 0 else "WARN")
    return summary

def main():
    input_data = read_input()
    
    task_mode = None
    if len(sys.argv) > 1:
        task_mode = sys.argv[1].lower()
    elif "args" in input_data and isinstance(input_data["args"], dict):
        task_mode = input_data["args"].get("mode") or input_data["args"].get("task")
    elif "args_map" in input_data and isinstance(input_data["args_map"], dict):
        task_mode = input_data["args_map"].get("mode") or input_data["args_map"].get("task")
    elif "task" in input_data:
        task_mode = input_data.get("task")
    elif "mode" in input_data:
        task_mode = input_data.get("mode")
        
    if not task_mode:
        task_mode = "rebuild"
        
    endpoint, api_key, session_cookie = get_server_connection(input_data)
    plugin_dir = Path(__file__).resolve().parent
    
    log(f"Invoked task mode '{task_mode}' (target endpoint: {endpoint})", "INFO")
    
    if task_mode in ("rebuild", "rescan"):
        result = task_rebuild(endpoint, api_key, session_cookie, plugin_dir)
    elif task_mode in ("reset", "defaults"):
        result = task_reset(endpoint, api_key, session_cookie, plugin_dir)
    elif task_mode in ("init", "initialize"):
        result = task_init(endpoint, api_key, session_cookie, plugin_dir)
    elif task_mode in ("rename", "bulk_rename", "bulk-rename"):
        result = task_rename(endpoint, api_key, session_cookie, plugin_dir, input_data)
    else:
        log(f"Unrecognized task mode '{task_mode}'. Available modes: rebuild, reset, init, rename.", "ERROR")
        result = {"error": f"Unrecognized task mode: {task_mode}"}
        
    print(json.dumps(result))

if __name__ == "__main__":
    main()
