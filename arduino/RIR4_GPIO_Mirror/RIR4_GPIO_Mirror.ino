/*
 * RIR4 to GPIO Mirror
 *
 * Reads Azatrax RIR4 IR detectors via I2C and mirrors their states
 * to four digital output pins. Drives pin LOW when detector is
 * occupied, HIGH when vacant. (Polarity convention determined
 * empirically to match DCC-EX AT() expectations.)
 *
 * Pin mapping:
 *   Detector 1 -> D4
 *   Detector 2 -> D5
 *   Detector 3 -> D6
 *   Detector 4 -> D7
 *
 * Polls the RIR4 every 50ms.
 */

#include <Azatrax.h>

// Match the I2C address set by your RIR4 DIP switches
Azatrax RIR4(0x38);

// Output pins for each detector's mirrored state
const uint8_t OUTPUT_PINS[4] = {4, 5, 6, 7};

// How often to poll the RIR4 (milliseconds)
const unsigned long POLL_INTERVAL = 50;

unsigned long lastPoll = 0;

void setup() {
  Serial.begin(9600);
  Serial.println("RIR4 GPIO Mirror starting...");

  for (uint8_t i = 0; i < 4; i++) {
    pinMode(OUTPUT_PINS[i], OUTPUT);
    digitalWrite(OUTPUT_PINS[i], LOW);
  }

  Serial.println("Output pins configured. Polling RIR4...");
}

void loop() {
  if (millis() - lastPoll < POLL_INTERVAL) {
    return;
  }
  lastPoll = millis();

  byte detectorBitmap = RIR4.getDetData(0x00);

  if (detectorBitmap == 0xFF) {
    Serial.println("WARN: RIR4 did not respond as expected");
    return;
  }

  // Drive LOW when occupied, HIGH when vacant.
  // This polarity was empirically determined to match the
  // EXRAIL AT(positive_vpin) behavior on the CSB1 side.
  for (uint8_t i = 0; i < 4; i++) {
    bool occupied = (detectorBitmap >> i) & 0x01;
    digitalWrite(OUTPUT_PINS[i], occupied ? LOW : HIGH);
  }

  // Diagnostic output: print state on change
  static byte lastBitmap = 0xFF;
  if (detectorBitmap != lastBitmap) {
    Serial.print("Detectors: ");
    for (int8_t i = 3; i >= 0; i--) {
      Serial.print(((detectorBitmap >> i) & 0x01) ? "X" : ".");
    }
    Serial.println();
    lastBitmap = detectorBitmap;
  }
}
