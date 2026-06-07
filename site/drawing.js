document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get("token")

    const fc = new fabric.Canvas("drawingCanvas", {
        isDrawingMode: false,
        selection: true,
    })
    window.fabricCanvas = fc

    // ===== サイズ調整 =====
    function setCanvasSize() {
        const pen    = document.querySelector("#pen")
        const availH = window.innerHeight - pen.offsetHeight - 8
        const size   = Math.max(100, Math.min(window.innerWidth, availH))
        fc.setWidth(size)
        fc.setHeight(size)
        fc.renderAll()
    }
    setCanvasSize()
    window.addEventListener("resize", setCanvasSize)

    // 引用画像（tokenがあればサーバーに問い合わせ、imageUrlがあればキャンバスに描画）
    if (token) {
        fetch(`${apiBaseUrl}/inquiry?token=${encodeURIComponent(token)}`)
            .then(r => r.json())
            .then(data => {
                if (!data?.base64img) return
                fabric.Image.fromURL("data:image/jpeg;base64," + data.base64img, (img) => {
                    img.scaleToWidth(fc.width)
                    fc.add(img)
                    fc.sendToBack(img)
                    fc.renderAll()
                    saveState()
                })
            })
            .catch(() => {})
    }

    // ===== ブラシ =====
    const pencil = new fabric.PencilBrush(fc)
    pencil.color = "#FFFFFF"
    pencil.width = 3

    let currentTool = "select"
    let prevDrawingMode = false

    function getColor() { return document.querySelector("#color").value }
    function getSize()  { return parseInt(document.querySelector("#bolder").value) }

    function setTool(tool) {
        currentTool = tool
        fc.isDrawingMode = (tool === "pen" || tool === "eraser")
        fc.selection     = (tool === "select")
        fc.discardActiveObject()
        fc.renderAll()

        if (tool === "pen") {
            pencil.color = getColor()
            pencil.width = getSize()
            fc.freeDrawingBrush = pencil
        } else if (tool === "eraser") {
            const eraser = new fabric.PencilBrush(fc)
            eraser.color = "rgba(255,255,255,0.01)"
            eraser.width = getSize()
            fc.freeDrawingBrush = eraser
        }

        document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tool === currentTool)
        })

        const drawingTool = tool === "pen" || tool === "eraser" || tool === "text"
        document.querySelector("#draw-controls").style.opacity = drawingTool ? "1" : "0.4"
    }

    document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
        btn.addEventListener("click", () => setTool(btn.dataset.tool))
    })

    setTool("pen")

    document.querySelector("#color").addEventListener("input", () => {
        if (currentTool === "pen") fc.freeDrawingBrush.color = getColor()
    })
    document.querySelector("#bolder").addEventListener("input", () => {
        if (currentTool !== "select") fc.freeDrawingBrush.width = getSize()
    })

    // ===== テキスト =====
    fc.on("mouse:down", (opt) => {
        if (currentTool !== "text" || opt.target || spaceDown) return
        const p = fc.getPointer(opt.e)
        const text = new fabric.IText("", {
            left: p.x, top: p.y,
            fill: getColor(),
            fontSize: Math.max(10, getSize() * 3),
            fontFamily: "sans-serif",
        })
        fc.add(text)
        fc.setActiveObject(text)
        text.enterEditing()
    })

    fc.on("text:editing:exited", (opt) => {
        if (!opt.target.text.trim()) fc.remove(opt.target)
        else saveState()
    })

    // ===== 履歴 =====
    let history = []
    let histIdx  = -1
    let loading  = false

    function saveState() {
        if (loading) return
        history = history.slice(0, histIdx + 1)
        history.push(JSON.stringify(fc.toJSON()))
        histIdx = history.length - 1
        updateHistoryBtns()
    }

    function updateHistoryBtns() {
        document.querySelector("#undo").disabled = histIdx <= 0
        document.querySelector("#redo").disabled = histIdx >= history.length - 1
    }

    // ===== 消しゴム リアルタイムプレビュー =====
    let eraserDrawing = false
    let eraserPoints  = []

    // 描画中: after:render フックで destination-out をオーバーレイ
    fc.on("after:render", (opt) => {
        if (!eraserDrawing || eraserPoints.length < 2) return
        const ctx = opt.ctx
        const vpt = fc.viewportTransform
        ctx.save()
        ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5])
        ctx.globalCompositeOperation = "destination-out"
        ctx.strokeStyle = "rgba(0,0,0,1)"
        ctx.lineWidth   = getSize()
        ctx.lineCap     = "round"
        ctx.lineJoin    = "round"
        ctx.beginPath()
        ctx.moveTo(eraserPoints[0].x, eraserPoints[0].y)
        for (let i = 1; i < eraserPoints.length; i++) ctx.lineTo(eraserPoints[i].x, eraserPoints[i].y)
        ctx.stroke()
        ctx.restore()
    })

    fc.on("mouse:down", (opt) => {
        if (currentTool !== "eraser" || spaceDown) return
        eraserDrawing = true
        eraserPoints  = [fc.getPointer(opt.e)]
    })
    fc.on("mouse:move", (opt) => {
        if (!eraserDrawing || currentTool !== "eraser" || spaceDown) return
        eraserPoints.push(fc.getPointer(opt.e))
        fc.requestRenderAll()
    })
    fc.on("mouse:up", () => {
        if (currentTool === "eraser") eraserDrawing = false
    })

    fc.on("path:created", (opt) => {
        if (currentTool !== "eraser") { saveState(); return }

        const ep = opt.path
        eraserDrawing = false
        eraserPoints  = []

        // 消しゴムと交差するオブジェクトにのみ inverted clipPath を適用
        // calculate:true で座標を必ず再計算し交差判定精度を上げる
        fc.getObjects()
            .filter(o => o !== ep && ep.intersectsWithObject(o, false, true))
            .forEach(obj => {
                const clip = new fabric.Path(ep.path, {
                    left:          ep.left,
                    top:           ep.top,
                    originX:       "center",
                    originY:       "center",
                    scaleX:        ep.scaleX,
                    scaleY:        ep.scaleY,
                    angle:         ep.angle || 0,
                    strokeWidth:   ep.strokeWidth,
                    strokeLineCap: ep.strokeLineCap,
                    strokeLineJoin:ep.strokeLineJoin,
                    stroke: "black",
                    fill:   "black",
                })

                if (!obj.clipPath) {
                    obj.clipPath = new fabric.Group([clip], {
                        absolutePositioned: true,
                        inverted: true,
                    })
                } else {
                    const grp = obj.clipPath.type === "group"
                        ? obj.clipPath
                        : new fabric.Group([obj.clipPath], { absolutePositioned: true, inverted: true })
                    grp.addWithUpdate(clip)
                    obj.clipPath = grp
                }
                obj.dirty = true
            })

        fc.remove(ep)
        fc.renderAll()
        saveState()
    })
    fc.on("object:modified", saveState)
    saveState()

    function applyHistory(idx) {
        loading = true
        fc.loadFromJSON(history[idx], () => { fc.renderAll(); loading = false; updateHistoryBtns() })
    }

    document.querySelector("#undo").addEventListener("click", () => {
        if (histIdx <= 0) return
        applyHistory(--histIdx)
    })
    document.querySelector("#redo").addEventListener("click", () => {
        if (histIdx >= history.length - 1) return
        applyHistory(++histIdx)
    })

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "z") {
            e.preventDefault()
            if (e.shiftKey) { if (histIdx < history.length - 1) applyHistory(++histIdx) }
            else            { if (histIdx > 0)                  applyHistory(--histIdx) }
            return
        }

        // 選択オブジェクトを削除
        if (e.key === "Delete" || e.key === "Backspace") {
            const active = fc.getActiveObject()
            if (!active || active.isEditing) return
            e.preventDefault()
            if (active.type === "activeSelection") {
                active.getObjects().forEach(obj => fc.remove(obj))
                fc.discardActiveObject()
            } else {
                fc.remove(active)
            }
            fc.renderAll()
            saveState()
        }
    })

    // ===== ズーム =====
    // キャンバス範囲外にパンできないようにクランプ
    function clampViewport() {
        const zoom = fc.getZoom()
        const vpt  = fc.viewportTransform
        const W = fc.width, H = fc.height
        if (zoom <= 1) {
            vpt[4] = 0
            vpt[5] = 0
        } else {
            vpt[4] = Math.min(0, Math.max(W * (1 - zoom), vpt[4]))
            vpt[5] = Math.min(0, Math.max(H * (1 - zoom), vpt[5]))
        }
        fc.setViewportTransform(vpt)
    }
    const zoomLabel = document.querySelector("#zoom-label")

    function updateZoomLabel() {
        zoomLabel.textContent = Math.round(fc.getZoom() * 100) + "%"
    }

    zoomLabel.addEventListener("click", () => {
        fc.setViewportTransform([1, 0, 0, 1, 0, 0])
        updateZoomLabel()
    })

    document.querySelector("#zoom-in").addEventListener("click",  () => applyZoom(fc.getZoom() * 1.3))
    document.querySelector("#zoom-out").addEventListener("click", () => applyZoom(fc.getZoom() / 1.3))

    function applyZoom(zoom) {
        zoom = Math.min(Math.max(zoom, 1), 10)
        const center = new fabric.Point(fc.width / 2, fc.height / 2)
        fc.zoomToPoint(center, zoom)
        clampViewport()
        updateZoomLabel()
    }

    // ホイールズーム
    fc.on("mouse:wheel", (opt) => {
        const e = opt.e
        let zoom = fc.getZoom() * (0.999 ** e.deltaY)
        zoom = Math.min(Math.max(zoom, 1), 10)
        fc.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), zoom)
        clampViewport()
        updateZoomLabel()
        e.preventDefault()
        e.stopPropagation()
    })

    // スペース+ドラッグでパン
    let spaceDown = false
    let panStart  = null

    document.addEventListener("keydown", (e) => {
        if (e.code === "Space" && !e.repeat && !spaceDown) {
            spaceDown = true
            prevDrawingMode = fc.isDrawingMode
            fc.isDrawingMode = false
            fc.defaultCursor = "grab"
            e.preventDefault()
        }
    })
    document.addEventListener("keyup", (e) => {
        if (e.code === "Space") {
            spaceDown = false
            panStart  = null
            fc.isDrawingMode = prevDrawingMode
            fc.defaultCursor = "crosshair"
        }
    })

    fc.on("mouse:down", (opt) => {
        if (!spaceDown) return
        panStart = {
            x: opt.e.clientX, y: opt.e.clientY,
            vpt: [...fc.viewportTransform]
        }
    })
    fc.on("mouse:move", (opt) => {
        if (!panStart) return
        const dx = opt.e.clientX - panStart.x
        const dy = opt.e.clientY - panStart.y
        fc.setViewportTransform([
            panStart.vpt[0], panStart.vpt[1],
            panStart.vpt[2], panStart.vpt[3],
            panStart.vpt[4] + dx,
            panStart.vpt[5] + dy,
        ])
        clampViewport()
    })
    fc.on("mouse:up", () => { panStart = null })

    // ピンチズーム（タッチ）
    let pinchDist = 0
    let pinchMidPrev = null

    fc.upperCanvasEl.addEventListener("touchstart", (e) => {
        if (e.touches.length === 2) {
            const [a, b] = e.touches
            pinchDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
            pinchMidPrev = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
            e.preventDefault()
        }
    }, { passive: false })

    fc.upperCanvasEl.addEventListener("touchmove", (e) => {
        if (e.touches.length !== 2) return
        const [a, b] = e.touches
        const newDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
        const mid     = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
        const rect    = fc.upperCanvasEl.getBoundingClientRect()

        // ズーム
        let zoom = fc.getZoom() * (newDist / pinchDist)
        zoom = Math.min(Math.max(zoom, 1), 10)
        fc.zoomToPoint(new fabric.Point(mid.x - rect.left, mid.y - rect.top), zoom)

        // パン
        if (pinchMidPrev) {
            const vpt = fc.viewportTransform
            vpt[4] += mid.x - pinchMidPrev.x
            vpt[5] += mid.y - pinchMidPrev.y
            fc.setViewportTransform(vpt)
        }

        pinchDist    = newDist
        pinchMidPrev = mid
        clampViewport()
        updateZoomLabel()
        e.preventDefault()
    }, { passive: false })

    fc.upperCanvasEl.addEventListener("touchend", () => { pinchMidPrev = null }, { passive: true })

    // ===== 画像読み込み =====
    document.querySelector("#up_btn").addEventListener("click", () => document.querySelector("#up").click())
    document.querySelector("#up").addEventListener("change", (e) => {
        const file = e.target.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            fabric.Image.fromURL(ev.target.result, (img) => {
                img.scaleToWidth(fc.width)
                fc.add(img)
                fc.sendToBack(img)
                fc.renderAll()
                saveState()
            })
        }
        reader.readAsDataURL(file)
    })

    // ===== カーソル =====
    const pointer = document.querySelector("#pointer")
    fc.on("mouse:move", (opt) => {
        const drawing = (currentTool === "pen" || currentTool === "eraser") && !spaceDown
        if (!drawing) { pointer.style.display = "none"; return }
        const zoom = fc.getZoom()
        const e    = opt.e
        pointer.style.display = "block"
        pointer.style.top    = `${e.clientY}px`
        pointer.style.left   = `${e.clientX}px`
        pointer.style.width  = `${getSize() * zoom}px`
        pointer.style.height = `${getSize() * zoom}px`
        pointer.style.background = currentTool === "eraser"
            ? "rgba(255,255,255,0.15)"
            : getColor()
        pointer.style.border = currentTool === "eraser" ? "1px solid #666" : "none"
    })
    fc.on("mouse:out", () => { pointer.style.display = "none" })
})
