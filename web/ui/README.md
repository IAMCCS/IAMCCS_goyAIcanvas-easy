# ADVANCED MODE – CORE PROTETTO

I file in questa directory sono il **CORE** dell'applicazione (modalità ADVANCED).

## Regole

1. **NON importare** questi file da `modes/easy/`, `modes/video/`, `modes/visual/`
2. **NON accedere** al loro DOM da file di altre modalità
3. **NON spostare** elementi DOM da questa directory verso container di altre modalità

## Se hai bisogno di funzionalità simili in un'altra modalità

Crea un pannello **standalone** nella cartella della modalità.

Esempio: `VisualControlPanel.js` replica Curves/Levels/Adjust senza importare `ToolsPanel.js`.

## File in questa directory

| File | Scopo |
|------|-------|
| `ToolsPanel.js` | Left toolbar (Imagining/Drawing/Transform/Selection) |
| `Canvas.js` | CanvasView (zoom/pan/draw) |
| `CanvasToolbar.js` | Top-right controls |
| `LayersPanel.js` | Layer stack + thumbnails |
| `LayerPromptPanel.js` | Per-layer prompt editing |
| `GlobalPromptPanel.js` | Global prompts |
| `StylePresetsPanel.js` | Style presets |
| `ImagingControls.js` | Steps/CFG/Sampler/Scheduler/Seed |
| `ExportPanel.js` | Save/Load/Export |
| `GalleryPanel.js` | Gallery output |
| `StatusBar.js` | Zoom/position statusbar |

## Contratto `modules` (unica API per le modalità)

Le modalità ricevono un oggetto `modules` da `LayoutRouter`:

```js
{
    layerManager,     // engine/LayerManager.js
    maskManager,      // engine/MaskManager.js
    promptManager,    // engine/PromptManager.js
    qwenBridge,       // engine/QwenEngineBridge.js
    workflowRunner,   // engine/WorkflowRunner.js
    canvasView        // ui/Canvas.js (istanza condivisa – Easy la usa per il canvas)
}
```

Questa è l'**unica superficie di comunicazione** tra le modalità e il core.

### API pubbliche di WorkflowRunner usabili dalle modalità

- `setSeed(n)`, `setSteps(n)`, `setCfg(n)`
- `setSampler(name)`, `setScheduler(name)`
- `runWorkflow()`
- `engine`, `activePanel`, `fl2PanelScenario` (per routing scenario)

### API pubbliche di CanvasView usabili dalle modalità

- `centerAndFit()`, `zoom(factor)`, `resetView()`
- `resize(w, h)`

### EventBus (passato separatamente)

- `on(event, handler)`, `off(event, handler)`, `emit(event, data)`
- Namespace: `easy:*`, `video:*`, `visual:*`, `ui:*`
