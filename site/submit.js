document.querySelector("#submit").addEventListener("click", async (e) => {
    const urlParams = new URLSearchParams(window.location.search)

    const fc      = window.fabricCanvas
    const savedVpt = [...fc.viewportTransform]
    fc.setViewportTransform([1, 0, 0, 1, 0, 0])
    const b64 = fc.toDataURL({
        format: "png",
        multiplier: 500 / fc.width,
    })
    fc.setViewportTransform(savedVpt)
    const isAnonym = document.querySelector("#anonym").checked
    const isSpoiler = document.querySelector("#spoiler").checked

    let text = null
    if (document.querySelector("#msgtext").value) text = document.querySelector("#msgtext").value

    const r = await fetch(`${apiBaseUrl}/submit`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            image: b64,
            token: urlParams.get("token"),
            text: text,
            anonym: isAnonym,
            spoiler: isSpoiler
        })
    })

    if (r.status == 200) {
        alert("正常送信しました")
    } else {
        alert("ぉゎ〜")
    }
})
