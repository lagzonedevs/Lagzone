/* Thin WebSocket client with auto-reconnect + typed event handlers. */
export class Net {
  constructor(url) {
    this.url = url;
    this.handlers = {};
    this.ws = null;
    this.ready = false;
    this.queue = [];
  }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  emit(type, data) { (this.handlers[type] || []).forEach((fn) => fn(data)); }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => { this.ready = true; this.emit("open"); this.queue.forEach((m) => this.ws.send(m)); this.queue = []; };
    this.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.emit(m.type, m); };
    this.ws.onclose = () => { this.ready = false; this.emit("close"); setTimeout(() => this.connect(), 1500); };
    this.ws.onerror = () => {};
    return this;
  }
  send(type, data = {}) {
    const m = JSON.stringify({ type, ...data });
    if (this.ready && this.ws.readyState === 1) this.ws.send(m); else this.queue.push(m);
  }
}
