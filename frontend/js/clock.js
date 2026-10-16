window.Bosqyn = window.Bosqyn || {}
Bosqyn.pages = Bosqyn.pages || {}

;(function () {
  const fmtTime = (d) => d.toLocaleTimeString('es-PE', { hour12: false })
  const fmtDate = (d) => {
    const s = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  const fmtStamp = (d) =>
    `${d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${fmtTime(d)}`

  function tick() {
    const now = new Date()
    document.querySelectorAll('[data-clock]').forEach((el) => {
      const k = el.dataset.clock
      el.textContent = k === 'date' ? fmtDate(now) : k === 'time' ? fmtTime(now) : fmtStamp(now)
    })
  }
  Bosqyn.tickClock = tick
  setInterval(tick, 1000)
  tick()
})()
