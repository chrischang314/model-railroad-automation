# CSB1 Auto-Updater

This folder contains a Docker/Kubernetes scaffold for automatically rebuilding
and reflashing the EX-CSB1 when `dcc-ex/myAutomation.h` changes on GitHub.

## Feasibility Summary

Native CSB1 over-the-air firmware or EXRAIL replacement is not exposed by the
documented DCC-EX workflow. The DCC-EX CSB1 manual describes software changes
and EXRAIL loading through the USB-C port, and EX-Installer itself uses Arduino
CLI to compile and upload. The practical "OTA-like" design is therefore:

```text
GitHub main branch
  -> Raspberry Pi 3 polling container
  -> Arduino CLI compile for esp32:esp32:esp32
  -> USB upload to EX-CSB1
  -> CSB1 reboots with new myAutomation.h
```

This is not true wireless flashing of the CSB1. It is unattended USB flashing
from a permanently attached Raspberry Pi.

## Raspberry Pi 3 Suitability

Suitable for this role, with caveats:

- Raspberry Pi 3 can run a 64-bit OS.
- K3s supports ARM64 and ARMv7; a K3s agent node needs far less RAM than a
  control-plane node.
- Pi 3 has only 1 GB RAM, so use it as a worker/agent, not as a Kubernetes
  server/control-plane.
- Arduino CLI ESP32 compiles may be slow and can pressure RAM. Use 64-bit
  Raspberry Pi OS Lite or Ubuntu Server, add swap, and prefer an external SSD
  or high-quality SD card.
- A more robust future design is to build firmware in GitHub Actions and have
  the Pi download/upload a precompiled artifact. This scaffold compiles locally
  because it is simpler to reason about and matches EX-Installer's Arduino CLI
  approach.

## Safety Behavior

The updater:

- Tracks the SHA-256 of `dcc-ex/myAutomation.h` plus `dcc-ex/config.csb1.h`.
- Does not flash on first run by default. It records a baseline hash first.
- Powers down/stops trains before flashing by sending `</KILL ALL>`, `<!>`,
  and `<0>` to `DCCEX_HOST:DCCEX_PORT`.
- Re-sends S1/S2 physical sensor declarations after flashing.
- Injects CSB1 WiFi credentials from a Kubernetes Secret at build time. Do not
  commit WiFi credentials to `dcc-ex/config.csb1.h`.

## Local Pi Setup From Scratch

1. Flash the Pi:

   - Use Raspberry Pi Imager.
   - Choose Raspberry Pi OS Lite 64-bit.
   - Enable SSH.
   - Set hostname, username, password, and WiFi if needed.

2. Boot and update:

   ```bash
   sudo apt update
   sudo apt full-upgrade -y
   sudo reboot
   ```

3. Add basic tools:

   ```bash
   sudo apt install -y git curl ca-certificates
   ```

4. Add swap for ESP32 compile headroom:

   ```bash
   sudo dphys-swapfile swapoff
   sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
   sudo dphys-swapfile setup
   sudo dphys-swapfile swapon
   free -h
   ```

5. Plug the Pi into the CSB1 USB-C port and find the stable serial path:

   ```bash
   ls -l /dev/serial/by-id/
   ```

   Use the resulting `/dev/serial/by-id/...` path in the Kubernetes manifest.

## Join The Pi To K3s

On your existing K3s server/control-plane node:

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

On the Pi:

```bash
curl -sfL https://get.k3s.io | \
  K3S_URL=https://<k3s-server-ip>:6443 \
  K3S_TOKEN=<node-token> \
  sh -
```

Back on your workstation/control-plane:

```bash
kubectl get nodes -o wide
kubectl label node <pi-node-name> railroad-csb1-updater=true
```

This adds the Pi as a Kubernetes node. The updater itself is the pod.

## Build And Publish The Image

After this branch is merged to `main`, GitHub Actions will build and publish a
multi-architecture image to:

```text
ghcr.io/chrischang314/model-railroad-csb1-updater:latest
```

You can also build it manually.

Build for the Pi's architecture. Prefer ARM64 if you installed a 64-bit OS:

```bash
docker buildx create --use --name railroad-builder
docker buildx build \
  --platform linux/arm64 \
  -t ghcr.io/chrischang314/model-railroad-csb1-updater:latest \
  --push \
  ./ota-updater
```

For a mixed cluster, publish both ARM64 and amd64:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/chrischang314/model-railroad-csb1-updater:latest \
  --push \
  ./ota-updater
```

## Deploy To Kubernetes

1. Create the WiFi Secret in the cluster:

   ```bash
   kubectl -n railroad create secret generic csb1-wifi \
     --from-literal=ssid='<your-ssid>' \
     --from-literal=password='<your-password>'
   ```

2. Edit `ota-updater/k8s/deployment.yaml`.
3. Replace:

   ```yaml
   /dev/serial/by-id/REPLACE_WITH_CSB1_USB_SERIAL
   ```

   with your actual `/dev/serial/by-id/...` path.

4. Apply:

   ```bash
   kubectl apply -f ota-updater/k8s/deployment.yaml
   kubectl -n railroad logs -f deploy/csb1-ota-updater
   ```

The first run records a baseline and does not flash. To force an initial flash:

```bash
kubectl -n railroad set env deploy/csb1-ota-updater FORCE_FLASH=true
```

After the force flash succeeds, remove the override:

```bash
kubectl -n railroad set env deploy/csb1-ota-updater FORCE_FLASH-
```

## Manual One-Shot Test On The Pi

Before Kubernetes, you can run the container directly:

```bash
docker run --rm -it \
  --privileged \
  --device /dev/serial/by-id/<your-csb1-device>:/dev/csb1 \
  -e DEVICE_PORT=/dev/csb1 \
  -e DCCEX_HOST=192.168.4.22 \
  -v csb1-updater-state:/state \
  -v csb1-updater-work:/work \
  ghcr.io/chrischang314/model-railroad-csb1-updater:latest \
  --once
```

To force a flash during the one-shot test:

```bash
docker run --rm -it \
  --privileged \
  --device /dev/serial/by-id/<your-csb1-device>:/dev/csb1 \
  -e DEVICE_PORT=/dev/csb1 \
  -e DCCEX_HOST=192.168.4.22 \
  -e FORCE_FLASH=true \
  -v csb1-updater-state:/state \
  -v csb1-updater-work:/work \
  ghcr.io/chrischang314/model-railroad-csb1-updater:latest \
  --once
```

## Operational Notes

- Do not run JMRI, EX-WebThrottle over USB, Arduino IDE, or EX-Installer on the
  Pi while the updater is flashing. Only one process can own the USB serial
  port.
- The CSB1 will reboot during upload. WiFi and the web control app will drop
  temporarily.
- Keep `dcc-ex/config.csb1.h` conservative. A bad `config.h` can change WiFi,
  motor driver, or display behavior. WiFi credentials belong in the Kubernetes
  Secret, not in git.
- Treat automatic flashing like CI/CD for physical hardware. Start with
  `AUTO_FLASH=false` or `FLASH_ON_FIRST_RUN=false`, watch logs, then enable
  full automation once one manual force flash succeeds.

## Source Notes

- DCC-EX's EX-CSB1 manual describes configuration/software changes by
  connecting the board over USB-C to a computer.
- DCC-EX's EX-Installer documentation says EX-Installer uses Arduino CLI to
  upload DCC-EX products.
- EX-Installer source confirms the EX-CSB1 FQBN is `esp32:esp32:esp32`, ESP32
  support is pinned to Arduino ESP32 core `2.0.17`, and upload adds
  `UploadSpeed=115200`.
- CommandStation-EX source contains no ArduinoOTA/esp_ota implementation; the
  only OTA hit in the current source is a partition-scheme note mentioning
  `"NO OTA (2MB APP, 2MB SPIFFS)"`.
