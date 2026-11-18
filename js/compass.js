// compass.js — device heading, with iOS permission handling
export class Compass {
  constructor() {
    this.heading = null;
    this.listeners = new Set();
    this._handlers = [];
    this._started = false;
    this._lastEventTs = 0;
    this._permission = 'unknown'; // 'granted' | 'denied' | 'prompt' | 'unknown'
  }

  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  _emit(h) {
    this.heading = h;
    for (const cb of this.listeners) try { cb(h); } catch {}
  }

  needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined'
      && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  async requestPermission() {
    if (!this.needsPermission()) { this._permission = 'granted'; return 'granted'; }
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      this._permission = r;
      return r;
    } catch (e) {
      this._permission = 'denied';
      return 'denied';
    }
  }

  // try to start without an explicit user gesture (works on Android)
  async tryStart() {
    if (this._started) return true;
    if (this.needsPermission()) return false; // needs tap
    return this.start();
  }

  start() {
    if (this._started) return true;
    this._started = true;

    const onAbs = (e) => {
      if (e.absolute === false && e.webkitCompassHeading == null && (e.alpha == null)) return;
      const h = this._extract(e);
      if (h == null) return;
      this._lastEventTs = Date.now();
      this._emit(h);
    };

    // prefer absolute event when available
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onAbs, true);
      this._handlers.push(['deviceorientationabsolute', onAbs, true]);
    }
    window.addEventListener('deviceorientation', onAbs, true);
    this._handlers.push(['deviceorientation', onAbs, true]);

    // also handle orientation change for screen angle correction
    const onOrient = () => { /* re-emit last if any */ };
    window.addEventListener('orientationchange', onOrient);
    this._handlers.push(['orientationchange', onOrient, false]);

    return true;
  }

  _extract(e) {
    let raw = null;
    if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) {
      raw = e.webkitCompassHeading; // iOS: already 0..360, clockwise from north
    } else if (e.absolute && typeof e.alpha === 'number') {
      raw = (360 - e.alpha) % 360; // alpha is CCW from north in device frame
    } else if (typeof e.alpha === 'number' && (e.absolute === true)) {
      raw = (360 - e.alpha) % 360;
    }
    if (raw == null || !isFinite(raw)) return null;
    // correct for screen orientation
    const so = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (typeof window.orientation === 'number' ? window.orientation : 0);
    return ((raw - so) % 360 + 360) % 360;
  }

  stop() {
    for (const [type, fn, capture] of this._handlers) {
      window.removeEventListener(type, fn, capture);
    }
    this._handlers = [];
    this._started = false;
  }

  // true if we've received a real heading recently
  alive() { return Date.now() - this._lastEventTs < 4000 && this._lastEventTs > 0; }
}
