#include <DHT.h>
#include <Servo.h>
#include <math.h>
#include <string.h>

const byte DHT_PIN = 2;
const byte DHT_TYPE = DHT11;  // Change to DHT22 only if the module is confirmed.
const byte LIGHT_PIN = 5;     // PWM unaffected by the Servo library on UNO.
const byte DOOR_PIN = 9;
const byte FAN_PIN = 10;      // SG90 fan demonstrator, not a bare DC motor.
const byte DOOR_CLOSED = 10;
const byte DOOR_OPEN = 90;
const unsigned long DOOR_MS = 5000;
const unsigned long SENSOR_MS = 2200;
const unsigned long HOST_TIMEOUT_MS = 7000;

DHT dht(DHT_PIN, DHT_TYPE);
Servo doorServo, fanServo;
float temperature = NAN, humidity = NAN;
bool doorOpen = false, fanOn = false;
int light = 0, sweep = 30, direction = 5;
unsigned long lastSensor, doorSince, lastSweep, lastHost;
char line[32];
byte used = 0;
bool overflow = false;

void setDoor(bool open) {
  doorOpen = open;
  doorServo.write(open ? DOOR_OPEN : DOOR_CLOSED);
  if (open) doorSince = millis();
}

void setFan(bool on) {
  fanOn = on;
  if (!on) {
    sweep = 30;
    direction = 5;
    fanServo.write(sweep);
  }
}

void printReading(float reading) {
  if (isnan(reading)) Serial.print(F("null"));
  else Serial.print(reading, 1);
}

void handleCommand(const char *command) {
  if (strcmp(command, "DOOR 1") == 0) setDoor(true);
  else if (strcmp(command, "DOOR 0") == 0) setDoor(false);
  else if (strcmp(command, "FAN 1") == 0) setFan(true);
  else if (strcmp(command, "FAN 0") == 0) setFan(false);
  else if (strncmp(command, "LIGHT ", 6) == 0) {
    const char *digits = command + 6;
    size_t count = strspn(digits, "0123456789");
    if (!count || count > 3 || digits[count] != '\0') return;
    int value = atoi(digits);
    if (value > 100) return;
    light = value;
    analogWrite(LIGHT_PIN, light * 255L / 100);
  } else if (strcmp(command, "STATUS") != 0) return;
  lastHost = millis();

  Serial.print(F("{\"protocol\":\"pixelhome-1\",\"command\":\""));
  Serial.print(command);
  Serial.print(F("\",\"temperature\":"));
  printReading(temperature);
  Serial.print(F(",\"humidity\":"));
  printReading(humidity);
  Serial.print(F(",\"door\":\""));
  Serial.print(doorOpen ? F("open") : F("closed"));
  Serial.print(F("\",\"fan\":"));
  Serial.print(fanOn ? F("true") : F("false"));
  Serial.print(F(",\"light\":"));
  Serial.print(light);
  Serial.println('}');
}

void setup() {
  Serial.begin(115200);
  pinMode(LIGHT_PIN, OUTPUT);
  dht.begin();
  doorServo.attach(DOOR_PIN);
  fanServo.attach(FAN_PIN);
  setDoor(false);
  setFan(false);
  lastSensor = millis();
}

void loop() {
  const unsigned long now = millis();
  if (doorOpen && now - doorSince >= DOOR_MS) setDoor(false);
  if (fanOn && now - lastHost >= HOST_TIMEOUT_MS) setFan(false);
  if (fanOn && now - lastSweep >= 45) {
    lastSweep = now;
    sweep += direction;
    if (sweep >= 145 || sweep <= 30) direction = -direction;
    fanServo.write(sweep);
  }
  if (now - lastSensor >= SENSOR_MS) {
    lastSensor = now;
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
  }
  while (Serial.available()) {
    char next = Serial.read();
    if (next == '\n') {
      if (!overflow) {
        line[used] = '\0';
        handleCommand(line);
      }
      overflow = false;
      used = 0;
    } else if (next != '\r') {
      if (used < sizeof(line) - 1) line[used++] = next;
      else overflow = true;
    }
  }
}
