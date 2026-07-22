import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const options = Object.fromEntries(
  process.argv.slice(2).map((part) => {
    const [key, ...value] = part.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);
const hostdPort = Number(options.hostdPort ?? "39012");
const simulatorPort = Number(options.simulatorPort ?? "12008");
const nativeModule = await import(
  pathToFileURL(
    resolve(options.nativeDist ?? "../../front-end/tripley-kit/libs/native/dist/index.js"),
  ).href
);
const channelModule = await import(
  pathToFileURL(resolve("packages/kiosk-host-native-channel/dist/index.js")).href
);

const native = nativeModule.createWebSocketTripleyNative({
  requiredServices: ["runtime", "tcp"],
  url: `ws://127.0.0.1:${hostdPort}`,
});
const adapter = new channelModule.NativeTcpHostTransportAdapter(native.tcp, {
  connectTimeoutMs: 3_000,
  frame: channelModule.createLengthPrefixFrameCodec({
    fixedHeader: Uint8Array.of(0x0f, 0x0f, 0x0f),
    lengthBytes: 3,
    lengthEncoding: "bcd",
    lengthIncludesFixedHeader: true,
    lengthIncludesLengthField: true,
    maxFrameBytes: 64 * 1024,
  }),
  host: options.simulatorHost ?? "127.0.0.1",
  id: "native.tcp.host-simulator",
  port: simulatorPort,
  responseTimeoutMs: 5_000,
  security: { mode: "plain" },
  writeTimeoutMs: 3_000,
});
let connected = false;

try {
  await native.connect();
  connected = true;
  const payload = options.body ? new TextEncoder().encode(options.body) : createBspAexSmokeBody();
  const result = await adapter.exchange({
    channel: "host-simulator",
    idempotencyKey: `target52-smoke-${Date.now()}`,
    payload,
    timeoutMs: 8_000,
  });
  if (result.status !== "response") {
    throw new Error(`Host simulator smoke failed: ${result.status}/${result.errorCode}`);
  }
  process.stdout.write(
    `${JSON.stringify({
      event: "target52.host-simulator.passed",
      responseBytes: result.payload.length,
      transport: "native-tcp",
    })}\n`,
  );
} finally {
  await adapter.dispose();
  if (connected) {
    await native.dispose();
  }
}

function createBspAexSmokeBody() {
  const body = new Uint8Array(726).fill(0x20);
  body.set(new TextEncoder().encode("AEX"), 8);
  return body;
}
