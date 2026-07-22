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
const session = new channelModule.PersistentNativeTcpHostSession(native.tcp, {
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
  inbound: new channelModule.HostInboundMessageRegistry(),
  port: simulatorPort,
  reconnect: { initialDelayMs: 250, maxDelayMs: 2_000, multiplier: 2 },
  responseTimeoutMs: 5_000,
  routeFrame: () => ({ kind: "response" }),
  security: { mode: "plain" },
  writeTimeoutMs: 3_000,
});
let connected = false;

try {
  await native.connect();
  connected = true;
  await session.start();
  const payload = options.body ? new TextEncoder().encode(options.body) : createBspAexSmokeBody();
  const results = [];
  for (let index = 0; index < 2; index += 1) {
    const result = await session.exchange({
      channel: "host-simulator",
      idempotencyKey: `target53-smoke-${Date.now()}-${index}`,
      payload,
      timeoutMs: 8_000,
    });
    if (result.status !== "response") {
      throw new Error(`Host simulator smoke failed: ${result.status}/${result.errorCode}`);
    }
    results.push(result);
  }
  process.stdout.write(
    `${JSON.stringify({
      event: "target53.host-simulator.passed",
      exchanges: results.length,
      generation: session.generation,
      responseBytes: results.map((result) => result.payload.length),
      transport: "persistent-native-tcp",
    })}\n`,
  );
} finally {
  await session.dispose();
  if (connected) {
    await native.dispose();
  }
}

function createBspAexSmokeBody() {
  const body = new Uint8Array(726).fill(0x20);
  body.set(new TextEncoder().encode("AEX"), 8);
  return body;
}
