const assert = require("node:assert/strict");
const fs = require("node:fs");
const readline = require("node:readline");
const {
  CPU, avrInstruction, AVRUSART, usart0Config, AVRTimer,
  timer0Config, timer1Config, timer2Config, AVRIOPort, portBConfig, portDConfig,
} = require("avr8js");

const hz = 16_000_000;
const words = new Uint16Array(16_384).fill(0xffff);
const flash = new Uint8Array(words.buffer);
let high = 0;
for (const line of fs.readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/)) {
  assert.match(line, /^:[0-9a-f]+$/i);
  const record = Buffer.from(line.slice(1), "hex");
  assert.equal(record.length, record[0] + 5);
  assert.equal(record.reduce((sum, value) => sum + value, 0) & 255, 0);
  const data = record.subarray(4, -1);
  if (record[3] === 0) flash.set(data, high + record.readUInt16BE(1));
  else if (record[3] === 4) high = data.readUInt16BE(0) * 65536;
  else assert.equal(record[3], 1);
}

const cpu = new CPU(words);
const pins = new AVRIOPort(cpu, portBConfig);
const sensor = new AVRIOPort(cpu, portDConfig);
new AVRTimer(cpu, timer0Config);
new AVRTimer(cpu, timer1Config);
new AVRTimer(cpu, timer2Config);
const uart = new AVRUSART(cpu, usart0Config, hz);
const replies = [];
uart.onLineTransmit = line => replies.push(JSON.parse(line));

const servoPulses = [[], []];
const start = [0, 0];
pins.addListener((value, oldValue) => {
  for (let index = 0; index < 2; index++) {
    const bit = 1 << (index + 1);
    if ((value ^ oldValue) & bit) {
      if (value & bit) start[index] = cpu.cycles;
      else if (start[index]) servoPulses[index].push((cpu.cycles - start[index]) / 16);
    }
  }
});

let dhtBytes = null;
sensor.setPin(2, true);
sensor.addListener((value, oldValue) => {
  if (!dhtBytes || !(value & 4) || (oldValue & 4)) return;
  const data = dhtBytes;
  dhtBytes = null;
  const edges = [[20, false], [100, true], [180, false]];
  let offset = 180;
  for (const byte of data) {
    for (let bit = 7; bit >= 0; bit--) {
      offset += 50;
      edges.push([offset, true]);
      offset += (byte & (1 << bit)) ? 70 : 27;
      edges.push([offset, false]);
    }
  }
  edges.push([offset + 50, true]);
  for (const [delay, value] of edges) cpu.addClockEvent(() => sensor.setPin(2, value), delay * 16);
});

function run(ms) {
  const end = cpu.cycles + Math.round(ms * hz / 1000);
  while (cpu.cycles < end) {
    avrInstruction(cpu);
    cpu.tick();
  }
}

function send(line) {
  for (const byte of Buffer.from(line + "\n", "ascii")) {
    assert.equal(uart.writeByte(byte), true);
    run(0.15);
  }
  run(50);
}

function request(line) {
  assert.equal(replies.length, 0);
  send(line);
  assert.equal(replies.length, 1, "missing or duplicate reply to " + line);
  const result = replies.shift();
  assert.equal(result.protocol, "pixelhome-1");
  assert.equal(result.command, line);
  return result;
}

function setSensor(temperature, humidity) {
  dhtBytes = [humidity, 0, temperature, 0, (humidity + temperature) & 255];
  run(2250);
}

function serveBridge() {
  run(150);
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", raw => {
    try {
      const { command, temperature, humidity, advance_ms } = JSON.parse(raw);
      if (temperature !== undefined) setSensor(temperature, humidity);
      if (advance_ms !== undefined) run(advance_ms);
      process.stdout.write(JSON.stringify(command ? request(command) : { ok: true }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error.message }) + "\n");
      process.exitCode = 1;
      input.close();
    }
  });
}

function testFirmware() {
run(150);
assert.ok(Math.abs(uart.baudRate - 115200) < 5000);
assert.equal(request("STATUS").door, "closed");
const closedPulse = servoPulses[0].at(-1);
assert.ok(closedPulse > 550 && closedPulse < 800, "closed servo PWM");
assert.equal(request("DOOR 1").door, "open");
assert.ok(servoPulses[0].at(-1) > 1300, "open servo PWM");
assert.equal(request("FAN 1").fan, true);
servoPulses[1].length = 0;
run(150);
assert.ok(new Set(servoPulses[1].map(value => Math.round(value / 40))).size >= 3, "fan servo sweeps");
assert.equal(request("LIGHT 75").light, 75);
send("LIGHT 999");
send("A".repeat(40) + "DOOR 1");
assert.equal(replies.length, 0);
assert.equal(request("STATUS").light, 75);

setSensor(28, 52);
const sensorState = request("STATUS");
assert.equal(sensorState.temperature, 28);
assert.equal(sensorState.humidity, 52);
run(3200);
const doorTimeout = request("STATUS");
assert.equal(doorTimeout.door, "closed");
assert.equal(doorTimeout.temperature, null, "DHT disconnected");
assert.equal(doorTimeout.fan, true, "fan still runs while host is active");
run(7150);
const watchdog = request("STATUS");
assert.equal(watchdog.fan, false);
assert.equal(watchdog.door, "closed");
assert.ok(Math.abs(servoPulses[0].at(-1) - closedPulse) < 40);
console.log("UNO HEX passed: serial protocol, door/fan PWM, DHT11 read and timeout, automatic door close, host-loss fan stop");
}

if (process.argv.includes("--bridge")) serveBridge();
else testFirmware();
