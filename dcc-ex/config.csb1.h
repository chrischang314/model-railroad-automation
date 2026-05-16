// config.csb1.h - Minimal EX-CSB1 configuration for automated reflashing.
//
// This file is copied to CommandStation-EX/config.h by ota-updater before
// compiling. It intentionally avoids storing WiFi credentials in git.
//
// DONT_TOUCH_WIFI_CONF tells DCC-EX not to overwrite the WiFi settings already
// stored on the command station. This matters because the layout currently
// talks to the CSB1 at 192.168.4.22.

#define MOTOR_SHIELD_TYPE EXCSB1

#define ENABLE_WIFI true
#define DONT_TOUCH_WIFI_CONF
#define WIFI_HOSTNAME "dccex"
#define WIFI_CHANNEL 1

// EX-CSB1 kits typically include a 128x32 OLED. Change this if your display is
// physically different.
#define OLED_DRIVER 128,32
#define SCROLLMODE 1
