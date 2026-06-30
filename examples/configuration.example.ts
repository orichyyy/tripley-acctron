await config.set("host.ip", "192.168.10.20", {
  scope: "device",
  provider: "sqlite",
  reason: "admin-updated-host-ip",
});

await config.set("withdrawal.maxAmount", 20000, {
  scope: "device",
  provider: "sqlite",
  reason: "admin-updated-withdrawal-limit",
});

const maxAmount = config.getOrThrow<number>("withdrawal.maxAmount");
const hostIp = config.getOrThrow<string>("host.ip");
