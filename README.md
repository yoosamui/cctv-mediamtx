cctv-mediamtx:

This is a web-based CCTV live monitoring dashboard powered by MediaMTX + HLS streaming, designed to display multiple IP camera feeds in a responsive grid.

It uses HLS.js to play .m3u8 streams served from a MediaMTX server and includes a custom UI for monitoring stream health in real time.

This multi-camera live surveillance dashboard connects to a MediaMTX streaming server and displays six camera feeds in a clean, responsive web interface.

Each camera stream is pulled via HLS (.m3u8) from a MediaMTX endpoint and rendered in HTML5 video players with automatic recovery, latency tuning, and status indicators.


**http://RPI5-IP:8080/**

<img width="1056" height="1052" alt="image" src="https://github.com/user-attachments/assets/62c37261-dd04-435c-8036-a14869c930c4" />


## Real-Time Streaming Capabilities

To achieve **real-time** streaming with the Live Feed, you must consider that not all devices and browsers are Real Time capable. This list shows which browsers support real-time playback.

| Platform | Browser | Delay | Real-Time | Status |
|----------|---------|-------|-----------|--------|
| 🐧 Linux Desktop | Firefox | 15s | ❌ No | ⏳ 15s Latency |
| 🐧 Linux Desktop | **Chrome** | **0s** | ✅ **Yes** | 🟢 **REAL TIME!** |
| 🪟 Windows | **Edge** | **0s** | ✅ **Yes** | 🟢 **REAL TIME!** |
| 📱 Android | **Firefox** | **0s** | ✅ **Yes** | 🟢 **REAL TIME!** |
| 📱 iOS (iPhone) | Safari | 34s | ❌ No | 🔴 34s Latency |

### Summary

**🟢 Real-Time Supported (0s delay):**
- Chrome on Linux Desktop
- Edge on Windows
- Firefox on Android

**🔴 High Latency (Not Real-Time):**
- Firefox on Linux Desktop (15s delay)
- iOS Safari on iPhone (34s delay)

> **Recommendation**: For optimal real-time performance, use Chrome (Linux), Edge (Windows), or Firefox (Android).
