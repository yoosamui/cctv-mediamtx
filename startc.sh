#!/bin/bash

# Move to the correct folder first so it finds mediamtx and mediamtx.yml
cd /home/pi/cctv_media/mediamtx

# Start MediaMTX safely
./mediamtx  /etc/cctv/mediamtx.yml  &

# Wait 2 seconds to let MediaMTX open its network sockets BEFORE FFmpeg connects
sleep 3

# 3. Start the Python server in the FOREGROUND and bind to all IPs (0.0.0.0)
# NO '&' at the end of this line. This keeps the systemd service alive.
python3 -m http.server 8080 -b 0.0.0.0

