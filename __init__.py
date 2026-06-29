"""Standalone IAMCCS_goyAIcanvas-easy custom node package."""
from __future__ import annotations

from .goya_canvas_easy_node import IAMCCSGoyaCanvasEasyNode

NODE_CLASS_MAPPINGS = {
    "IAMCCSGoyaCanvasEasyNode": IAMCCSGoyaCanvasEasyNode,
    "IAMCCS_goyAIcanvas-easy": IAMCCSGoyaCanvasEasyNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "IAMCCSGoyaCanvasEasyNode": "IAMCCS_goyAIcanvas-easy",
    "IAMCCS_goyAIcanvas-easy": "IAMCCS_goyAIcanvas-easy (legacy compat)",
}

WEB_DIRECTORY = "web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[IAMCCS_goyAIcanvas-easy] standalone Easy node loaded")

