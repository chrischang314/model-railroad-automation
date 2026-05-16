FROM python:3.12-slim-bookworm

ARG TARGETARCH
ARG TARGETVARIANT
ARG ARDUINO_CLI_VERSION=0.35.3

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git bash \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pyserial

RUN set -eux; \
  case "${TARGETARCH}/${TARGETVARIANT}" in \
    "amd64/") cli_arch="Linux_64bit" ;; \
    "arm64/") cli_arch="Linux_ARM64" ;; \
    "arm/v7") cli_arch="Linux_ARMv7" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}/${TARGETVARIANT}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/arduino-cli.tar.gz \
    "https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_${cli_arch}.tar.gz"; \
  tar -xzf /tmp/arduino-cli.tar.gz -C /usr/local/bin arduino-cli; \
  chmod +x /usr/local/bin/arduino-cli; \
  rm /tmp/arduino-cli.tar.gz; \
  arduino-cli version

WORKDIR /app
COPY updater.py /app/updater.py

ENV STATE_DIR=/state
ENV WORK_DIR=/work
ENV POLL_SECONDS=300
ENV FLASH_ON_FIRST_RUN=false
ENV AUTO_FLASH=true
ENV MODEL_REPO_URL=https://github.com/chrischang314/model-railroad-automation.git
ENV MODEL_REPO_BRANCH=main
ENV AUTOMATION_FILE=dcc-ex/myAutomation.h
ENV CONFIG_FILE=dcc-ex/config.csb1.h
ENV COMMANDSTATION_REPO_URL=https://github.com/DCC-EX/CommandStation-EX.git
ENV COMMANDSTATION_REF=v5.6.0-Prod
ENV FQBN=esp32:esp32:esp32
ENV DEVICE_PORT=/dev/ttyUSB0
ENV DCCEX_HOST=192.168.4.22
ENV DCCEX_PORT=2560

ENTRYPOINT ["python", "/app/updater.py"]
