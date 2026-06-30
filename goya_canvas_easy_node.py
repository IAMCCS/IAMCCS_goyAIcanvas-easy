
"""IAMCCS GoyAIcanvas Easy all-in-one node.

The Easy editor owns its hidden state and directly exposes image, mask, crop and
prepared inpaint/outpaint tensors for real ComfyUI workflows.
"""
from __future__ import annotations

import base64
import io
import json
import os
import time
from typing import Any, Dict, Tuple
from urllib.parse import quote

import numpy as np
import torch
from PIL import Image, ImageFilter

try:
    import folder_paths
except Exception:
    folder_paths = None

try:
    from aiohttp import web
    from server import PromptServer
except Exception:
    web = None
    PromptServer = None


BUILD = "IAMCCS_GoyAIcanvas_Easy_AllInOne_20260626"
_ROUTES_REGISTERED = False
EASY_OUTPUT_SUBFOLDER = "goya_output"


def _strip_data_url(value: str) -> str:
    value = str(value or "").strip()
    if value.lower().startswith("data:") and "," in value:
        return value.split(",", 1)[1]
    return value


def _decode_data_image(value: str, mode: str) -> Image.Image | None:
    value = _strip_data_url(value)
    if not value:
        return None
    try:
        raw = base64.b64decode(value)
        return Image.open(io.BytesIO(raw)).convert(mode)
    except Exception:
        return None


def _image_to_tensor(img: Image.Image) -> torch.Tensor:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _mask_to_tensor(mask: Image.Image) -> torch.Tensor:
    arr = np.asarray(mask.convert("L"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _parse_json(value: str, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        data = json.loads(value or "{}")
        return data if isinstance(data, dict) else dict(fallback)
    except Exception:
        return dict(fallback)


def _parse_crop(crop_value: Any, width: int, height: int) -> Tuple[int, int, int, int, Dict[str, Any]]:
    data = crop_value if isinstance(crop_value, dict) else {}
    unit = str(data.get("unit", "px"))
    if unit == "norm":
        x = float(data.get("x", 0.0)) * width
        y = float(data.get("y", 0.0)) * height
        w = float(data.get("w", 1.0)) * width
        h = float(data.get("h", 1.0)) * height
    else:
        x = float(data.get("x", 0))
        y = float(data.get("y", 0))
        w = float(data.get("w", width))
        h = float(data.get("h", height))
    x1 = max(0, min(max(0, width - 1), int(round(x))))
    y1 = max(0, min(max(0, height - 1), int(round(y))))
    x2 = max(x1 + 1, min(width, int(round(x + w))))
    y2 = max(y1 + 1, min(height, int(round(y + h))))
    box = {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1, "unit": "px"}
    return x1, y1, x2, y2, box


def _parse_outpaint(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    rect = data.get("source_rect") if isinstance(data.get("source_rect"), dict) else {}
    return {
        "enabled": bool(data.get("enabled", False)),
        "left": max(0, int(float(data.get("left", 0) or 0))),
        "top": max(0, int(float(data.get("top", 0) or 0))),
        "right": max(0, int(float(data.get("right", 0) or 0))),
        "bottom": max(0, int(float(data.get("bottom", 0) or 0))),
        "fill": str(data.get("fill", "black") or "black"),
        "feathering": max(0, int(float(data.get("feathering", 0) or 0))),
        "source_is_prepared": bool(data.get("source_is_prepared", False)),
        "source_rect": {
            "x": max(0, int(float(rect.get("x", data.get("left", 0)) or 0))),
            "y": max(0, int(float(rect.get("y", data.get("top", 0)) or 0))),
            "w": max(1, int(float(rect.get("w", 1) or 1))),
            "h": max(1, int(float(rect.get("h", 1) or 1))),
            "unit": "px",
        },
    }


def _feather_mask(mask: Image.Image, radius: int) -> Image.Image:
    radius = max(0, int(radius or 0))
    if radius <= 0:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(radius=radius))


def _prepare_outpaint(img: Image.Image, outpaint: dict[str, Any]) -> tuple[Image.Image, Image.Image]:
    left, top, right, bottom = (int(outpaint[k]) for k in ("left", "top", "right", "bottom"))
    if not outpaint.get("enabled") or left + top + right + bottom <= 0:
        return img, Image.new("L", img.size, 0)
    feathering = int(outpaint.get("feathering", 0) or 0)
    if outpaint.get("source_is_prepared"):
        rect = outpaint.get("source_rect") if isinstance(outpaint.get("source_rect"), dict) else {}
        x = max(0, min(img.width - 1, int(rect.get("x", left) or 0)))
        y = max(0, min(img.height - 1, int(rect.get("y", top) or 0)))
        w = max(1, min(img.width - x, int(rect.get("w", img.width - left - right) or 1)))
        h = max(1, min(img.height - y, int(rect.get("h", img.height - top - bottom) or 1)))
        mask = Image.new("L", img.size, 255)
        mask.paste(Image.new("L", (w, h), 0), (x, y))
        return img, _feather_mask(mask, feathering)
    fill = (0, 0, 0) if outpaint.get("fill") == "black" else (255, 255, 255)
    prepared = Image.new("RGB", (img.width + left + right, img.height + top + bottom), fill)
    prepared.paste(img.convert("RGB"), (left, top))
    mask = Image.new("L", prepared.size, 255)
    mask.paste(Image.new("L", img.size, 0), (left, top))
    return prepared, _feather_mask(mask, feathering)


def _asset_base_dir() -> str:
    if folder_paths is not None:
        base = folder_paths.get_input_directory()
    else:
        base = os.path.join(os.getcwd(), "input")
    path = os.path.join(base, "IAMCCS_goyai_canvas")
    os.makedirs(path, exist_ok=True)
    return path

def _project_base_dir() -> str:
    path = os.path.join(_asset_base_dir(), "projects")
    os.makedirs(path, exist_ok=True)
    return path


def _easy_output_base_dir() -> str:
    if folder_paths is not None:
        base = folder_paths.get_output_directory()
    else:
        base = os.path.join(os.getcwd(), "output")
    path = os.path.join(base, EASY_OUTPUT_SUBFOLDER)
    os.makedirs(path, exist_ok=True)
    return path


def _gallery_hidden_path() -> str:
    return os.path.join(_asset_base_dir(), "gallery_hidden.json")


def _load_gallery_hidden() -> set[str]:
    try:
        with open(_gallery_hidden_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return set()
    values = data.get("hidden") if isinstance(data, dict) else data
    if not isinstance(values, list):
        return set()
    return {_safe_gallery_name(item) for item in values if _safe_gallery_name(item)}


def _save_gallery_hidden(hidden: set[str]) -> None:
    path = _gallery_hidden_path()
    tmp_path = f"{path}.tmp"
    payload = {"hidden": sorted(_safe_gallery_name(item) for item in hidden if _safe_gallery_name(item))}
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp_path, path)


def _safe_gallery_name(value: str) -> str:
    name = str(value or "").replace("\\", "/").strip().lstrip("/")
    parts = [part for part in name.split("/") if part and part not in {".", ".."}]
    return "/".join(parts)


def _gallery_file_path(name: str) -> str | None:
    safe = _safe_gallery_name(name)
    if not safe:
        return None
    base = os.path.abspath(_easy_output_base_dir())
    path = os.path.abspath(os.path.join(base, *safe.split("/")))
    if not path.startswith(base + os.sep):
        return None
    if not os.path.isfile(path):
        return None
    return path


def _settings_path() -> str:
    return os.path.join(os.path.dirname(__file__), "goya_settings.json")


def _safe_name(value: str, suffix: str = "") -> str:
    raw = os.path.basename(str(value or "").strip()) or f"goyai_project{suffix}"
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in raw)
    if suffix and not safe.lower().endswith(suffix.lower()):
        safe += suffix
    return safe


def _folder_list(kind: str) -> list[str]:
    if folder_paths is None:
        return []
    names: list[str] = []
    for candidate in (kind,):
        try:
            values = folder_paths.get_filename_list(candidate)
            if values:
                names.extend(str(v) for v in values)
        except Exception:
            pass
    seen = set()
    out = []
    for name in names:
        if name not in seen:
            seen.add(name)
            out.append(name)
    return sorted(out, key=lambda x: x.lower())


def _detect_comfy_root() -> str:
    base = getattr(folder_paths, "base_path", None) if folder_paths is not None else None
    if isinstance(base, str) and base:
        return os.path.abspath(base)
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, "..", ".."))


def _seedvr2_candidate_dirs(existing_only: bool = True) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    def _push(path: str | None) -> None:
        if not path:
            return
        resolved = os.path.abspath(path)
        if resolved in seen:
            return
        if not existing_only or os.path.isdir(resolved):
            candidates.append(resolved)
            seen.add(resolved)

    if folder_paths is not None:
        mapping = getattr(folder_paths, "folder_names_and_paths", {}) or {}
        if isinstance(mapping, dict):
            for name, entry in mapping.items():
                if str(name).lower() not in {"seedvr2", "seedvr", "seedvr2_dit", "seedvr2_vae", "upscale_models"}:
                    continue
                paths = entry[0] if isinstance(entry, tuple) and entry else entry
                try:
                    for path in paths or []:
                        _push(str(path))
                except Exception:
                    pass

        models_root = getattr(folder_paths, "models_dir", None)
        if isinstance(models_root, str) and models_root:
            for name in ("SEEDVR2", "SeedVR2", "seedvr2"):
                _push(os.path.join(models_root, name))

    comfy_root = _detect_comfy_root()
    for name in ("SEEDVR2", "SeedVR2", "seedvr2"):
        _push(os.path.join(comfy_root, "models", name))

    return candidates


def _list_seedvr2_models(kind: str = "seedvr2_dit") -> list[str]:
    items: list[str] = []
    exts = (".safetensors", ".ckpt", ".gguf", ".pt", ".pth")

    def _is_vae(rel_path: str, file_lower: str) -> bool:
        if "vae" in file_lower:
            return True
        return any("vae" in part.lower() for part in rel_path.replace("\\", "/").split("/"))

    for base in _seedvr2_candidate_dirs():
        try:
            for root, _dirs, files in os.walk(base):
                for filename in files:
                    lower = filename.lower()
                    if not any(lower.endswith(ext) for ext in exts):
                        continue
                    rel = os.path.relpath(os.path.join(root, filename), base).replace("\\", "/")
                    is_vae = _is_vae(rel, lower)
                    if kind == "seedvr2_vae" and not is_vae:
                        continue
                    if kind == "seedvr2_dit" and is_vae:
                        continue
                    items.append(rel)
        except Exception:
            pass
    return sorted(dict.fromkeys(items), key=lambda x: x.lower())


def _read_easy_settings() -> dict[str, Any]:
    path = _settings_path()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        easy = data.get("goyai_easy_backend", {})
        return easy if isinstance(easy, dict) else {}
    except Exception:
        return {}


def _write_easy_settings(settings: dict[str, Any]) -> None:
    path = _settings_path()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    data["goyai_easy_backend"] = dict(settings or {})
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def _settings_payload() -> dict[str, Any]:
    settings = _read_easy_settings()
    models = {
        "unet": _folder_list("unet"),
        "diffusion_models": _folder_list("diffusion_models"),
        "seedvr2_dit": _folder_list("seedvr2_dit") or _list_seedvr2_models("seedvr2_dit"),
        "seedvr2_vae": _folder_list("seedvr2_vae") or _list_seedvr2_models("seedvr2_vae"),
        "clip": _folder_list("clip"),
        "vae": _folder_list("vae"),
        "checkpoints": _folder_list("checkpoints"),
        "loras": _folder_list("loras"),
    }
    model_roots: dict[str, list[str]] = {}
    if folder_paths is not None:
        try:
            mapping = getattr(folder_paths, "folder_names_and_paths", {}) or {}
            for key in ("unet", "diffusion_models", "seedvr2_dit", "seedvr2_vae", "clip", "vae", "checkpoints", "loras"):
                entry = mapping.get(key)
                if isinstance(entry, tuple) and entry:
                    model_roots[key] = [str(p) for p in (entry[0] or [])]
        except Exception:
            model_roots = {}
    return {
        "schema": "iamccs.goyai.easy.settings",
        "build": BUILD,
        "settings": settings,
        "models": models,
        "model_roots": model_roots,
        "project_dir": _project_base_dir(),
        "truth": "Backend settings are discovered from ComfyUI folder_paths, including extra_model_paths.yaml.",
    }



def _workflow_path(mode: str) -> str:
    safe = "".join(ch for ch in str(mode or "") if ch.isalnum() or ch in "_-").lower()
    if safe not in {"edit", "i2i", "inpaint", "outpaint", "remove_bg"}:
        safe = "inpaint"
    return os.path.join(os.path.dirname(__file__), "workflows", f"goyai_easy_{safe}.json")


def _register_routes() -> None:
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED or PromptServer is None or web is None:
        return
    _ROUTES_REGISTERED = True

    try:
        static_root = os.path.join(os.path.dirname(__file__), "web")
        if os.path.isdir(static_root):
            PromptServer.instance.app.router.add_static(
                "/iamccs/goyai_easy_static/",
                static_root,
                follow_symlinks=True,
            )
    except Exception as exc:
        print(f"[IAMCCS_goyAIcanvas-easy] static route registration skipped: {exc}")

    @PromptServer.instance.routes.get("/iamccs/goyai_easy/workflow/{mode}")
    async def iamccs_goyai_easy_workflow(request):
        path = _workflow_path(request.match_info.get("mode", "inpaint"))
        if not os.path.exists(path):
            return web.json_response({"error": f"workflow not found: {os.path.basename(path)}"}, status=404)
        with open(path, "r", encoding="utf-8-sig") as handle:
            return web.json_response(json.load(handle))

    @PromptServer.instance.routes.post("/iamccs/goyai_easy/save_asset")
    async def iamccs_goyai_easy_save_asset(request):
        payload = await request.json()
        image = _decode_data_image(str(payload.get("image") or ""), "RGBA")
        if image is None:
            return web.json_response({"error": "missing image"}, status=400)
        prefix = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in str(payload.get("prefix") or "goyai_easy"))
        filename = f"{prefix}_{int(time.time() * 1000)}.png"
        path = os.path.join(_asset_base_dir(), filename)
        image.save(path)
        response = {"name": filename, "subfolder": "IAMCCS_goyai_canvas", "type": "input", "path": path, "build": BUILD}
        if bool(payload.get("gallery")):
            gallery_prefix = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in str(payload.get("gallery_prefix") or prefix))
            gallery_name = f"{gallery_prefix}_{int(time.time() * 1000)}.png"
            gallery_path = os.path.join(_easy_output_base_dir(), gallery_name)
            gallery_image = Image.new("RGB", image.size, (255, 255, 255))
            gallery_image.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
            gallery_image.save(gallery_path)
            response.update({
                "gallery_name": gallery_name,
                "gallery_url": f"/iamccs/goyai_easy/gallery/get?name={quote(gallery_name)}",
                "gallery_path": gallery_path,
            })
        return web.json_response(response)

    @PromptServer.instance.routes.get("/iamccs/goyai_easy/gallery/list")
    async def iamccs_goyai_easy_gallery_list(request):
        base = _easy_output_base_dir()
        hidden = _load_gallery_hidden()
        items = []
        for root, _dirs, files in os.walk(base):
            for filename in files:
                if not filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    continue
                path = os.path.join(root, filename)
                rel = os.path.relpath(path, base).replace("\\", "/")
                if rel in hidden:
                    continue
                try:
                    mtime = os.path.getmtime(path)
                except OSError:
                    mtime = 0
                items.append({
                    "name": rel,
                    "file": rel,
                    "mtime": mtime,
                    "url": f"/iamccs/goyai_easy/gallery/get?name={quote(rel)}",
                })
        items.sort(key=lambda item: item.get("mtime", 0), reverse=True)
        return web.json_response({"items": items[:80], "folder": EASY_OUTPUT_SUBFOLDER, "build": BUILD})

    @PromptServer.instance.routes.post("/iamccs/goyai_easy/gallery/hide")
    async def iamccs_goyai_easy_gallery_hide(request):
        payload = await request.json()
        name = _safe_gallery_name(payload.get("name", ""))
        if not name:
            return web.json_response({"error": "missing gallery item name"}, status=400)
        hidden = _load_gallery_hidden()
        hidden.add(name)
        _save_gallery_hidden(hidden)
        return web.json_response({"ok": True, "name": name, "hidden_count": len(hidden)})

    @PromptServer.instance.routes.post("/iamccs/goyai_easy/gallery/show")
    async def iamccs_goyai_easy_gallery_show(request):
        payload = await request.json()
        name = _safe_gallery_name(payload.get("name", ""))
        if not name:
            return web.json_response({"error": "missing gallery item name"}, status=400)
        hidden = _load_gallery_hidden()
        hidden.discard(name)
        _save_gallery_hidden(hidden)
        return web.json_response({"ok": True, "name": name, "hidden_count": len(hidden)})

    @PromptServer.instance.routes.get("/iamccs/goyai_easy/gallery/get")
    async def iamccs_goyai_easy_gallery_get(request):
        path = _gallery_file_path(request.query.get("name", ""))
        if not path:
            return web.json_response({"error": "image not found"}, status=404)
        return web.FileResponse(path)

    @PromptServer.instance.routes.get("/iamccs/goyai_easy/settings")
    async def iamccs_goyai_easy_settings(request):
        return web.json_response(_settings_payload())

    @PromptServer.instance.routes.post("/iamccs/goyai_easy/settings")
    async def iamccs_goyai_easy_save_settings(request):
        payload = await request.json()
        settings = payload.get("settings", payload)
        if not isinstance(settings, dict):
            return web.json_response({"error": "settings must be an object"}, status=400)
        _write_easy_settings(settings)
        return web.json_response(_settings_payload())

    @PromptServer.instance.routes.post("/iamccs/goyai_easy/project/save")
    async def iamccs_goyai_easy_project_save(request):
        payload = await request.json()
        project = payload.get("project", payload)
        if not isinstance(project, dict):
            return web.json_response({"error": "project must be an object"}, status=400)
        filename = _safe_name(str(payload.get("filename") or project.get("name") or "goyai_project"), ".goya")
        path = os.path.join(_project_base_dir(), filename)
        project.setdefault("schema", "iamccs.goyai.project")
        project["saved_at"] = int(time.time())
        project["build"] = BUILD
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(project, handle, ensure_ascii=False, indent=2)
        return web.json_response({"name": filename, "path": path, "project": project, "build": BUILD})

    @PromptServer.instance.routes.post("/iamccs/goyai_easy/project/load")
    async def iamccs_goyai_easy_project_load(request):
        payload = await request.json()
        filename = _safe_name(str(payload.get("filename") or ""), ".goya")
        path = os.path.join(_project_base_dir(), filename)
        if not os.path.exists(path):
            return web.json_response({"error": "project not found", "name": filename}, status=404)
        with open(path, "r", encoding="utf-8") as handle:
            return web.json_response({"name": filename, "path": path, "project": json.load(handle), "build": BUILD})


class IAMCCSGoyaCanvasEasyNode:
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "goya_easy_state": ("STRING", {"multiline": True, "default": "{}"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("goya_easy_state",)
    FUNCTION = "run"
    CATEGORY = "IAMCCS/Goya"

    def run(self, goya_easy_state: str = "{}", mask_blur: int = 0, invert_mask: bool = False):
        state = _parse_json(goya_easy_state, {})
        state.setdefault("schema", "iamccs.goyai.easy.state")
        state.setdefault("build", BUILD)
        state["truth"] = "GoyAIcanvas Easy is an all-in-one editor node."
        return (json.dumps(state, ensure_ascii=False),)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")


def _easy_state_to_outputs(state: Dict[str, Any], mask_blur: int = 0, invert_mask: bool = False):
    img = _decode_data_image(str(state.get("source_image_b64") or ""), "RGB")
    if img is None:
        img = Image.new("RGB", (1024, 576), (0, 0, 0))
    width, height = img.size

    mask = _decode_data_image(str(state.get("mask_b64") or ""), "L")
    if mask is None:
        mask = Image.new("L", (width, height), 0)
    elif mask.size != (width, height):
        mask = mask.resize((width, height), Image.Resampling.NEAREST)
    if mask_blur > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=int(mask_blur)))
    if invert_mask:
        mask = Image.fromarray(255 - np.asarray(mask.convert("L"), dtype=np.uint8), "L")

    sketch = _decode_data_image(str(state.get("sketch_b64") or ""), "RGBA")
    if sketch is None:
        sketch = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    elif sketch.size != (width, height):
        sketch = sketch.resize((width, height), Image.Resampling.BILINEAR)

    x1, y1, x2, y2, box = _parse_crop(state.get("crop"), width, height)
    cropped = img.crop((x1, y1, x2, y2))
    cropped_mask = mask.crop((x1, y1, x2, y2))
    outpaint = _parse_outpaint(state.get("outpaint"))
    prepared_image, prepared_mask = _prepare_outpaint(img, outpaint)

    coverage = float(np.asarray(mask.convert("L"), dtype=np.float32).mean() / 255.0)
    prepared_coverage = float(np.asarray(prepared_mask.convert("L"), dtype=np.float32).mean() / 255.0)
    manifest = {
        "schema": "iamccs.goyai.easy.manifest",
        "build": BUILD,
        "operation": str(state.get("operation") or "editor"),
        "prompt": str(state.get("prompt") or ""),
        "source_size": [width, height],
        "crop_box": box,
        "mask_coverage": round(coverage, 6),
        "outpaint": outpaint,
        "transform": state.get("transform") if isinstance(state.get("transform"), dict) else {},
        "backend_settings": state.get("backend_settings") if isinstance(state.get("backend_settings"), dict) else {},
        "layers": state.get("layers") if isinstance(state.get("layers"), list) else [],
        "gallery": state.get("gallery") if isinstance(state.get("gallery"), list) else [],
        "prepared_size": list(prepared_image.size),
        "prepared_mask_coverage": round(prepared_coverage, 6),
        "prepared_mask_feathering": int(outpaint.get("feathering", 0) or 0),
        "truth": "IAMCCS Goya Easy all-in-one state rendered into graph-ready tensors.",
    }
    report = {**manifest, "invert_mask": bool(invert_mask), "mask_blur": int(mask_blur)}
    return (
        _image_to_tensor(img),
        _image_to_tensor(cropped),
        _mask_to_tensor(mask),
        _mask_to_tensor(cropped_mask),
        _image_to_tensor(prepared_image),
        _mask_to_tensor(prepared_mask),
        _image_to_tensor(sketch.convert("RGB")),
        json.dumps(box, ensure_ascii=False),
        json.dumps(report, ensure_ascii=False, indent=2),
        json.dumps(manifest, ensure_ascii=False, indent=2),
    )


_register_routes()
